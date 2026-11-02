import { pool } from "@/db";

/**
 * Idempotent DDL mirroring src/db/schema.ts. Runs once per server process (guarded by a Postgres advisory lock),
 * so a fresh database — local or on Vercel — works without a separate migration step.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name text NOT NULL,
    avatar_url text,
    email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    provider_account_id text NOT NULL,
    login text NOT NULL,
    display_name text,
    avatar_url text,
    access_token_enc text,
    refresh_token_enc text,
    expires_at timestamptz,
    scope text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_pid_uq ON accounts (provider, provider_account_id)`,
  `CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts (user_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    idle_expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    user_agent text
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id)`,
  `CREATE TABLE IF NOT EXISTS connected_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    external_id text NOT NULL,
    external_login text,
    external_avatar_url text,
    team_id text,
    access_token_enc text,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    connected_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS connected_user_provider_uq ON connected_providers (user_id, provider)`,
  `CREATE TABLE IF NOT EXISTS provider_permissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id uuid NOT NULL REFERENCES connected_providers(id) ON DELETE CASCADE,
    kind text NOT NULL,
    resource text NOT NULL,
    access text NOT NULL DEFAULT 'read',
    granted_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS perm_conn_kind_res_uq ON provider_permissions (connection_id, kind, resource)`,
  `CREATE TABLE IF NOT EXISTS integration_audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid,
    provider text NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    target text NOT NULL DEFAULT '',
    ok boolean NOT NULL DEFAULT true,
    detail text,
    source text NOT NULL DEFAULT 'nexus',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS audit_user_idx ON integration_audit_logs (user_id, created_at)`,
];

const g = globalThis as typeof globalThis & { __nexusSchemaReady?: Promise<void> };

export function ensureSchema(): Promise<void> {
  g.__nexusSchemaReady ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(727001)");
      try {
        for (const s of STATEMENTS) await client.query(s);
      } finally {
        await client.query("SELECT pg_advisory_unlock(727001)");
      }
    } finally {
      client.release();
    }
  })().catch((e) => {
    g.__nexusSchemaReady = undefined;
    throw e;
  });
  return g.__nexusSchemaReady;
}
