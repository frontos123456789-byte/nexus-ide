import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Nexus account model.
 *
 *  users                  – one row per human. Never merged by e-mail: identities are linked only through a verified session.
 *  accounts               – login identities (GitHub / Vercel "Sign in"). Unique per (provider, providerAccountId).
 *  sessions               – server-side sessions; only the SHA-256 of the cookie token is stored.
 *  connected_providers    – API access granted to Nexus (GitHub App installation / Vercel Integration installation).
 *  provider_permissions   – what Nexus may touch inside a connection (repo allow-list, env-key allow-list, granted scopes).
 *  integration_audit_logs – who did what, through which integration.
 *
 * Keep `src/lib/auth/ddl.ts` in sync: it creates the same tables idempotently at runtime (serverless-friendly).
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  /** Informational only — NEVER used to match or merge accounts. */
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // github | vercel
    providerAccountId: text("provider_account_id").notNull(),
    login: text("login").notNull(),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    /** AES-256-GCM envelopes (see src/lib/auth/crypto.ts). */
    accessTokenEnc: text("access_token_enc"),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_provider_pid_uq").on(t.provider, t.providerAccountId), index("accounts_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256(cookie token) hex. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    /** Absolute lifetime. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Idle timeout: the session dies if not used before this moment. */
    idleExpiresAt: timestamp("idle_expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const connectedProviders = pgTable(
  "connected_providers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // github | vercel
    status: text("status").notNull().default("active"), // active | revoked
    /** GitHub: installation id. Vercel: integration configuration id (icfg_…). */
    externalId: text("external_id").notNull(),
    externalLogin: text("external_login"),
    externalAvatarUrl: text("external_avatar_url"),
    /** Vercel team id (null = personal account). */
    teamId: text("team_id"),
    /** Vercel integration access token (encrypted). GitHub uses short-lived installation tokens, nothing is stored. */
    accessTokenEnc: text("access_token_enc"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("connected_user_provider_uq").on(t.userId, t.provider)],
);

export const providerPermissions = pgTable(
  "provider_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id").notNull().references(() => connectedProviders.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // repo | env_key | scope
    resource: text("resource").notNull(),
    access: text("access").notNull().default("read"), // read | write
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("perm_conn_kind_res_uq").on(t.connectionId, t.kind, t.resource)],
);

export const integrationAuditLogs = pgTable(
  "integration_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id"),
    provider: text("provider").notNull(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    ok: boolean("ok").notNull().default(true),
    detail: text("detail"),
    source: text("source").notNull().default("nexus"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type ConnectedProvider = typeof connectedProviders.$inferSelect;
