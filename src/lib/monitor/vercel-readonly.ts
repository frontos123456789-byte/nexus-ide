import { urls } from "@/lib/auth/config";

/**
 * The ONLY code path through which the Vercel Monitor talks to Vercel.
 *
 *  - It has no `method` parameter: every request is a GET, so the monitor cannot create, change or delete
 *    projects or deployments, even by accident.
 *  - Paths are checked against an allow-list of read endpoints.
 *  - The token comes from the user's own `vercel_monitor` connection (a read-only Vercel Integration installation).
 */

export class MonitorApiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "vercel_error",
    readonly resetAt?: number,
  ) {
    super(message);
  }
}

const ALLOWED: RegExp[] = [
  /^\/v9\/projects$/,
  /^\/v6\/deployments$/,
  /^\/v13\/deployments\/[\w.-]{1,128}$/,
  /^\/v3\/deployments\/[\w.-]{1,128}\/events$/,
  /^\/v2\/teams\/[\w.-]{1,128}$/,
  /^\/v2\/user$/,
];

export const isAllowedReadPath = (path: string): boolean => ALLOWED.some((r) => r.test(path));

export async function vercelGet<T>(token: string, teamId: string | null | undefined, path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
  if (!isAllowedReadPath(path)) throw new MonitorApiError(`Путь ${path} не входит в список разрешённых read-only запросов`, 500, "path_not_allowed");
  const url = new URL(`${urls.vercelApi()}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
      throw new MonitorApiError("Достигнут лимит Vercel API — обновление приостановлено", 429, "rate_limited", reset || undefined);
    }
    if (res.status === 401) throw new MonitorApiError("Доступ Vercel отозван или токен недействителен. Подключите Vercel заново.", 401, "unauthorized");
    if (res.status === 403) throw new MonitorApiError(`У интеграции нет прав на чтение: ${err?.message ?? "forbidden"}. Проверьте разрешения Projects и Deployments (Read).`, 403, "forbidden");
    throw new MonitorApiError(err?.message ?? `Vercel HTTP ${res.status}`, res.status === 404 ? 404 : 502, err?.code ?? "vercel_error");
  }
  return json as T;
}
