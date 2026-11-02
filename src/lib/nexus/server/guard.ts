import { timingSafeEqual } from "node:crypto";

/**
 * Privileged routes (DB, proxy, deploy, docker, figma, git, env) use the owner's tokens, and the app is public.
 * They therefore require the header `x-nexus-key` to equal NEXUS_ADMIN_KEY.
 * If the variable is not set: allowed only outside production (local development).
 */
export function requireAccess(req: Request): Response | null {
  const expected = process.env.NEXUS_ADMIN_KEY?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return Response.json(
        { error: "Серверные инструменты отключены: задайте NEXUS_ADMIN_KEY в окружении сервера.", code: "not_configured" },
        { status: 403 },
      );
    }
    return null;
  }
  const given = req.headers.get("x-nexus-key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: "Неверный ключ доступа Nexus (x-nexus-key)", code: "unauthorized" }, { status: 401 });
  }
  return null;
}

const hits = new Map<string, number[]>();

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Sliding-window in-memory limiter (per server instance — best-effort on serverless). */
export function rateLimit(req: Request, bucket: string, max: number, windowMs = 60_000): Response | null {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    return Response.json({ error: "Слишком много запросов, повторите позже", code: "rate_limited" }, { status: 429 });
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const k of hits.keys()) hits.delete(k);
  return null;
}

/** Tokens may be stored under legacy aliases; `VERCEL` is a system flag on Vercel so it is only trusted when token-shaped. */
export function envToken(kind: "github" | "vercel" | "figma" | "openrouter"): string | undefined {
  const e = process.env;
  const pick = (...vals: (string | undefined)[]) => vals.map((v) => v?.trim()).find((v) => v && v.length > 8);
  if (kind === "github") return pick(e.GITHUB_TOKEN, e.GITHUB);
  if (kind === "vercel") return pick(e.VERCEL_TOKEN, e.VERCEL && e.VERCEL.length > 20 ? e.VERCEL : undefined);
  if (kind === "figma") return pick(e.FIGMA_TOKEN);
  return pick(e.OPENROUTER_API_KEY, e.OPENROUTER);
}

export async function readJson<T>(req: Request, maxBytes = 6_000_000): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) return null;
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export const bad = (message: string, status = 400) => Response.json({ error: message }, { status });
