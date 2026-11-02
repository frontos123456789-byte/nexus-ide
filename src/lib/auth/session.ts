import { and, eq, gt, isNull } from "drizzle-orm";
import { accounts, sessions, users, type Account, type User } from "@/db/schema";
import { isSecureDeployment, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS } from "./config";
import { randomToken, sha256Hex } from "./crypto";
import { getDb } from "./db";

/**
 * Server-side sessions.
 *  - the cookie holds a random 256-bit token; the DB holds only its SHA-256 (a DB leak does not leak sessions);
 *  - cookie: HttpOnly, SameSite=Lax, Secure (+ `__Host-` prefix) on HTTPS deployments, Path=/;
 *  - absolute lifetime 30 days + idle timeout 7 days (sliding, written at most every 5 minutes);
 *  - a new token is issued on every sign-in (session fixation protection) and the previous one is revoked.
 */

export const sessionCookieName = () => (isSecureDeployment() ? "__Host-nexus_session" : "nexus_session");

export function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function serializeCookie(name: string, value: string, o: { maxAge: number; sameSite?: "Lax" | "Strict"; path?: string }): string {
  return `${name}=${value}; Path=${o.path ?? "/"}; HttpOnly; SameSite=${o.sameSite ?? "Lax"}; Max-Age=${o.maxAge}${isSecureDeployment() ? "; Secure" : ""}`;
}

export const clearCookie = (name: string, path = "/") => serializeCookie(name, "", { maxAge: 0, path });

export interface SessionContext {
  sessionId: string;
  user: User;
  accounts: Account[];
}

export async function createSession(userId: string, req: Request): Promise<{ setCookie: string; sessionId: string }> {
  const db = await getDb();
  // Session fixation: drop whatever session this browser had before.
  const old = parseCookies(req)[sessionCookieName()];
  if (old) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sha256Hex(old)));
  const token = randomToken(32);
  const now = Date.now();
  const id = sha256Hex(token);
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(now + SESSION_ABSOLUTE_MS),
    idleExpiresAt: new Date(now + SESSION_IDLE_MS),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 200),
  });
  return { sessionId: id, setCookie: serializeCookie(sessionCookieName(), token, { maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000) }) };
}

/** Returns the active session of the request, or null. Never throws when the DB is not configured. */
export async function getSession(req: Request): Promise<SessionContext | null> {
  const token = parseCookies(req)[sessionCookieName()];
  if (!token || token.length < 20) return null;
  let db;
  try {
    db = await getDb();
  } catch {
    return null;
  }
  const id = sha256Hex(token);
  const now = new Date();
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 5 * 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, idleExpiresAt: new Date(Math.min(now.getTime() + SESSION_IDLE_MS, row.s.expiresAt.getTime())) })
      .where(eq(sessions.id, id));
  }
  const accs = await db.select().from(accounts).where(eq(accounts.userId, row.u.id));
  return { sessionId: id, user: row.u, accounts: accs };
}

export async function destroySession(req: Request, all = false): Promise<void> {
  const ctx = await getSession(req);
  if (!ctx) return;
  const db = await getDb();
  const now = new Date();
  if (all) await db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, ctx.user.id), isNull(sessions.revokedAt)));
  else await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, ctx.sessionId));
}
