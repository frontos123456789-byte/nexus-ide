import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { accounts, connectedProviders, integrationAuditLogs, providerPermissions, users, type Account, type ConnectedProvider } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";
import { AuthError, getDb } from "./db";
import * as github from "./providers/github";

export type ProviderId = "github" | "vercel";

export interface IdentityProfile {
  id: string;
  login: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
}

export interface IdentityTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

const accAad = (provider: string, userId: string) => `account:${provider}:${userId}`;
const connAad = (provider: string, userId: string) => `connection:${provider}:${userId}`;
const isUniqueViolation = (e: unknown) => (e as { code?: string } | null)?.code === "23505" || (e as { cause?: { code?: string } } | null)?.cause?.code === "23505";

function tokenColumns(provider: ProviderId, userId: string, t: IdentityTokens) {
  return {
    accessTokenEnc: encryptSecret(t.accessToken, accAad(provider, userId)),
    refreshTokenEnc: t.refreshToken ? encryptSecret(t.refreshToken, accAad(provider, userId)) : null,
    expiresAt: t.expiresAt ?? null,
    scope: t.scope ?? null,
  };
}

/**
 * Sign in or link an identity.
 *  - login: (provider, providerAccountId) already known → that user; otherwise a NEW user is created.
 *           E-mail is stored for display only and is NEVER used to find or merge an existing user.
 *  - link : requires `currentUserId` (a verified session). An identity that already belongs to another user is refused,
 *           so nobody can take over or absorb somebody else's account.
 */
export async function signInOrLink(o: { provider: ProviderId; profile: IdentityProfile; tokens: IdentityTokens; kind: "login" | "link"; currentUserId?: string }): Promise<{ userId: string; created: boolean }> {
  const db = await getDb();
  const find = async () => (await db.select().from(accounts).where(and(eq(accounts.provider, o.provider), eq(accounts.providerAccountId, o.profile.id))).limit(1))[0];
  const now = new Date();

  const refreshExisting = async (acc: Account) => {
    await db
      .update(accounts)
      .set({ login: o.profile.login, displayName: o.profile.name, avatarUrl: o.profile.avatar, ...tokenColumns(o.provider, acc.userId, o.tokens), updatedAt: now })
      .where(eq(accounts.id, acc.id));
  };

  const existing = await find();

  if (o.kind === "link") {
    if (!o.currentUserId) throw new AuthError("session_required", "Для привязки нужна активная сессия Nexus", 401);
    if (existing && existing.userId !== o.currentUserId) throw new AuthError("already_linked_elsewhere", "Этот аккаунт уже привязан к другому пользователю Nexus", 409);
    if (existing) {
      await refreshExisting(existing);
      return { userId: existing.userId, created: false };
    }
    const mine = (await db.select().from(accounts).where(and(eq(accounts.userId, o.currentUserId), eq(accounts.provider, o.provider))).limit(1))[0];
    if (mine) throw new AuthError("provider_already_linked", "К вашему аккаунту уже привязан другой аккаунт этого провайдера — сначала отвяжите его", 409);
    try {
      await db.insert(accounts).values({ userId: o.currentUserId, provider: o.provider, providerAccountId: o.profile.id, login: o.profile.login, displayName: o.profile.name, avatarUrl: o.profile.avatar, ...tokenColumns(o.provider, o.currentUserId, o.tokens) });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AuthError("already_linked_elsewhere", "Этот аккаунт уже привязан к другому пользователю Nexus", 409);
      throw e;
    }
    return { userId: o.currentUserId, created: false };
  }

  if (existing) {
    await refreshExisting(existing);
    await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, existing.userId));
    return { userId: existing.userId, created: false };
  }

  const userId = randomUUID();
  try {
    await db.transaction(async (tx) => {
      await tx.insert(users).values({ id: userId, displayName: o.profile.name || o.profile.login, avatarUrl: o.profile.avatar, email: o.profile.email });
      await tx.insert(accounts).values({ userId, provider: o.provider, providerAccountId: o.profile.id, login: o.profile.login, displayName: o.profile.name, avatarUrl: o.profile.avatar, ...tokenColumns(o.provider, userId, o.tokens) });
    });
  } catch (e) {
    // Two concurrent first sign-ins of the same identity: the unique index decided, use the winner (no duplicate users).
    if (isUniqueViolation(e)) {
      const winner = await find();
      if (winner) {
        await refreshExisting(winner);
        return { userId: winner.userId, created: false };
      }
    }
    throw e;
  }
  return { userId, created: true };
}

export async function unlinkAccount(userId: string, provider: ProviderId): Promise<void> {
  const db = await getDb();
  const mine = await db.select().from(accounts).where(eq(accounts.userId, userId));
  if (mine.length < 2) throw new AuthError("last_identity", "Нельзя отвязать единственный способ входа", 409);
  await db.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));
}

/** Valid user-to-server access token of an identity (refreshes GitHub App tokens that expire). */
export async function userAccessToken(userId: string, provider: "github"): Promise<string | null> {
  const db = await getDb();
  const acc = (await db.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, provider))).limit(1))[0];
  if (!acc?.accessTokenEnc) return null;
  if (acc.expiresAt && acc.expiresAt.getTime() < Date.now() + 60_000) {
    const refresh = acc.refreshTokenEnc ? decryptSecret(acc.refreshTokenEnc, accAad(provider, userId)) : null;
    if (!refresh) return null;
    try {
      const t = await github.refreshUserToken(refresh);
      await db.update(accounts).set({ ...tokenColumns(provider, userId, t), updatedAt: new Date() }).where(eq(accounts.id, acc.id));
      return t.accessToken;
    } catch {
      return null;
    }
  }
  return decryptSecret(acc.accessTokenEnc, accAad(provider, userId));
}

/* ------------------------------- connections ------------------------------- */

export async function getConnection(userId: string, provider: ProviderId): Promise<ConnectedProvider | null> {
  const db = await getDb();
  const r = (await db.select().from(connectedProviders).where(and(eq(connectedProviders.userId, userId), eq(connectedProviders.provider, provider), eq(connectedProviders.status, "active"))).limit(1))[0];
  return r ?? null;
}

export async function saveConnection(o: { userId: string; provider: ProviderId; externalId: string; login?: string | null; avatar?: string | null; teamId?: string | null; accessToken?: string; metadata?: Record<string, unknown> }): Promise<ConnectedProvider> {
  const db = await getDb();
  const values = {
    status: "active",
    externalId: o.externalId,
    externalLogin: o.login ?? null,
    externalAvatarUrl: o.avatar ?? null,
    teamId: o.teamId ?? null,
    accessTokenEnc: o.accessToken ? encryptSecret(o.accessToken, connAad(o.provider, o.userId)) : null,
    metadata: o.metadata ?? {},
    connectedAt: new Date(),
    revokedAt: null,
  };
  const rows = await db
    .insert(connectedProviders)
    .values({ userId: o.userId, provider: o.provider, ...values })
    .onConflictDoUpdate({ target: [connectedProviders.userId, connectedProviders.provider], set: values })
    .returning();
  return rows[0] as ConnectedProvider;
}

export function connectionToken(c: ConnectedProvider): string | null {
  return c.accessTokenEnc ? decryptSecret(c.accessTokenEnc, connAad(c.provider, c.userId)) : null;
}

/** Marks the connection revoked and wipes its token and permission rows. */
export async function revokeConnection(userId: string, provider: ProviderId): Promise<void> {
  const db = await getDb();
  const c = (await db.select().from(connectedProviders).where(and(eq(connectedProviders.userId, userId), eq(connectedProviders.provider, provider))).limit(1))[0];
  if (!c) return;
  await db.delete(providerPermissions).where(eq(providerPermissions.connectionId, c.id));
  await db.update(connectedProviders).set({ status: "revoked", revokedAt: new Date(), accessTokenEnc: null }).where(eq(connectedProviders.id, c.id));
}

/** Webhook path: revoke every active connection that points at an external installation. */
export async function revokeByExternal(provider: ProviderId, externalId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.select().from(connectedProviders).where(and(eq(connectedProviders.provider, provider), eq(connectedProviders.externalId, externalId), eq(connectedProviders.status, "active")));
  for (const r of rows) await revokeConnection(r.userId, provider);
  return rows.length;
}

export async function getPermissions(connectionId: string, kind?: string): Promise<{ kind: string; resource: string; access: string }[]> {
  const db = await getDb();
  const rows = await db.select().from(providerPermissions).where(kind ? and(eq(providerPermissions.connectionId, connectionId), eq(providerPermissions.kind, kind)) : eq(providerPermissions.connectionId, connectionId));
  return rows.map((r) => ({ kind: r.kind, resource: r.resource, access: r.access }));
}

export async function replacePermissions(connectionId: string, kind: string, items: { resource: string; access: string }[]): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(providerPermissions).where(and(eq(providerPermissions.connectionId, connectionId), eq(providerPermissions.kind, kind)));
    const uniq = [...new Map(items.map((i) => [i.resource, i])).values()];
    if (uniq.length) await tx.insert(providerPermissions).values(uniq.map((i) => ({ connectionId, kind, resource: i.resource, access: i.access })));
  });
}

export async function patchMetadata(connection: ConnectedProvider, patch: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await db.update(connectedProviders).set({ metadata: { ...connection.metadata, ...patch } }).where(eq(connectedProviders.id, connection.id));
}

/* ------------------------------- audit ------------------------------- */

export async function writeAudit(e: { userId?: string | null; provider: string; actor: string; action: string; target?: string; ok?: boolean; detail?: string; source?: string }): Promise<void> {
  try {
    const db = await getDb();
    await db.insert(integrationAuditLogs).values({ userId: e.userId ?? null, provider: e.provider, actor: e.actor, action: e.action, target: e.target ?? "", ok: e.ok ?? true, detail: e.detail?.slice(0, 500), source: e.source ?? "nexus" });
  } catch {
    /* audit must never break the request */
  }
}

export async function listAudit(userId: string, limit = 60) {
  const db = await getDb();
  return db.select().from(integrationAuditLogs).where(eq(integrationAuditLogs.userId, userId)).orderBy(desc(integrationAuditLogs.createdAt)).limit(limit);
}
