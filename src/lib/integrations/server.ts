import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { envToken } from "@/lib/nexus/server/guard";

/**
 * Server-only helpers for external integrations (GitHub / Vercel / Telegram).
 *
 * Authorization model (no shared admin key as a substitute for user auth):
 *  - every user connects THEIR OWN token; it is validated against the provider, encrypted with AES-256-GCM and kept in an
 *    httpOnly + SameSite=Strict cookie — the browser JavaScript can never read it;
 *  - the owner's env tokens (GITHUB/VERCEL/TELEGRAM_BOT_TOKEN) are only usable together with a matching NEXUS_ADMIN_KEY header;
 *  - state-changing requests require a custom CSRF header and a same-origin Origin.
 */

export interface SessionData {
  github?: string;
  vercel?: string;
  telegram?: string;
  teamId?: string;
  /** Display names resolved when the token was connected. */
  logins?: { github?: string; vercel?: string; telegram?: string };
}

export const COOKIE = "nexus_int";

function secretKey(): Buffer {
  const base =
    process.env.NEXUS_SESSION_SECRET?.trim() ||
    process.env.NEXUS_ADMIN_KEY?.trim() ||
    envToken("openrouter") ||
    envToken("github") ||
    "nexus-dev-only-secret";
  return createHash("sha256").update(`nexus-session:${base}`).digest();
}

export function encrypt(data: object): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64url");
}

export function decrypt<T>(value: string): T | null {
  try {
    const buf = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", secretKey(), buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function readSession(req: Request): SessionData {
  const raw = parseCookies(req)[COOKIE];
  return (raw ? decrypt<SessionData>(raw) : null) ?? {};
}

export function sessionCookie(data: SessionData): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const empty = !data.github && !data.vercel && !data.telegram;
  return `${COOKIE}=${empty ? "" : encrypt(data)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${empty ? 0 : 60 * 60 * 24 * 7}${secure}`;
}

/** Owner access = NEXUS_ADMIN_KEY configured AND supplied (constant-time). */
export function isOwner(req: Request): boolean {
  const expected = process.env.NEXUS_ADMIN_KEY?.trim();
  if (!expected) return false;
  const a = Buffer.from(req.headers.get("x-nexus-key") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function tokenFor(req: Request, provider: "github" | "vercel" | "telegram"): string | undefined {
  const s = readSession(req);
  if (s[provider]) return s[provider];
  if (isOwner(req)) {
    if (provider === "telegram") return process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
    return envToken(provider);
  }
  return undefined;
}

/** CSRF: SameSite=Strict cookie + custom header (cannot be set cross-origin without CORS) + Origin check. */
export function csrfCheck(req: Request): Response | null {
  if (req.method === "GET" || req.method === "HEAD") return null;
  if (req.headers.get("x-nexus-csrf") !== "1") return Response.json({ error: "CSRF: отсутствует заголовок x-nexus-csrf", code: "csrf" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    try {
      if (new URL(origin).host !== host) return Response.json({ error: "CSRF: чужой Origin", code: "csrf" }, { status: 403 });
    } catch {
      return Response.json({ error: "CSRF: некорректный Origin", code: "csrf" }, { status: 403 });
    }
  }
  return null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "error",
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
  toResponse(): Response {
    return Response.json({ error: this.message, code: this.code, ...this.extra }, { status: this.status });
  }
}

export function requireConfirm(body: { confirm?: unknown }, what: string): void {
  if (body.confirm !== true) throw new ApiError(`Требуется подтверждение: ${what}`, 409, "confirm_required", { what });
}

export function verifyHmacSha256(secret: string, payload: string, signatureHeader: string | null): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`);
  const given = Buffer.from(signatureHeader);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/* ---------------- audit log (memory ring buffer + best-effort Postgres) ---------------- */

export interface AuditEvent {
  id: string;
  ts: number;
  actor: string;
  action: string;
  target: string;
  ok: boolean;
  detail?: string;
  source: "nexus" | "github-webhook";
}

const g = globalThis as typeof globalThis & { __nexusAudit?: AuditEvent[]; __nexusAuditTable?: Promise<boolean> };

function ring(): AuditEvent[] {
  return (g.__nexusAudit ??= []);
}

async function pgQuery(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] } | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const { pool } = await import("@/db");
    g.__nexusAuditTable ??= pool
      .query(
        "CREATE TABLE IF NOT EXISTS audit_log (id text PRIMARY KEY, ts bigint NOT NULL, actor text NOT NULL, action text NOT NULL, target text NOT NULL, ok boolean NOT NULL, detail text, source text NOT NULL)",
      )
      .then(() => true)
      .catch(() => false);
    if (!(await g.__nexusAuditTable)) return null;
    return await pool.query(sql, params);
  } catch {
    return null;
  }
}

export async function audit(e: Omit<AuditEvent, "id" | "ts" | "source"> & { source?: AuditEvent["source"]; ts?: number }): Promise<void> {
  const ev: AuditEvent = { id: randomBytes(8).toString("hex"), ts: e.ts ?? Date.now(), source: e.source ?? "nexus", actor: e.actor, action: e.action, target: e.target, ok: e.ok, detail: e.detail?.slice(0, 500) };
  const r = ring();
  r.push(ev);
  if (r.length > 500) r.splice(0, r.length - 500);
  await pgQuery("INSERT INTO audit_log (id, ts, actor, action, target, ok, detail, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING", [ev.id, ev.ts, ev.actor, ev.action, ev.target, ev.ok, ev.detail ?? null, ev.source]);
}

export async function recentAudit(filter: (e: AuditEvent) => boolean, limit = 60): Promise<AuditEvent[]> {
  const res = await pgQuery("SELECT id, ts, actor, action, target, ok, detail, source FROM audit_log ORDER BY ts DESC LIMIT 400");
  const fromDb: AuditEvent[] = (res?.rows ?? []).map((r) => ({
    id: String(r.id),
    ts: Number(r.ts),
    actor: String(r.actor),
    action: String(r.action),
    target: String(r.target),
    ok: Boolean(r.ok),
    detail: r.detail ? String(r.detail) : undefined,
    source: r.source === "github-webhook" ? "github-webhook" : "nexus",
  }));
  const merged = new Map<string, AuditEvent>();
  for (const e of [...ring(), ...fromDb]) merged.set(e.id, e);
  return [...merged.values()].filter(filter).sort((a, b) => b.ts - a.ts).slice(0, limit);
}
