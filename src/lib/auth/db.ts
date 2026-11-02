import { databaseConfigured } from "./config";

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * Lazily loads the Drizzle client and makes sure the account tables exist.
 * `@/db` throws at import time without DATABASE_URL, so it must never be imported statically from auth code.
 */
export async function getDb() {
  if (!databaseConfigured()) throw new AuthError("database_not_configured", "База данных не настроена (DATABASE_URL) — аккаунты недоступны", 503);
  const [{ db }, { ensureSchema }] = await Promise.all([import("@/db"), import("./ddl")]);
  await ensureSchema();
  return db;
}
