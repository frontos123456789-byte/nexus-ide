import { lookup } from "node:dns/promises";
import { z } from "zod";
import { checkUrl, isPrivateIp } from "@/lib/nexus/ssrf";
import { bad, rateLimit, readJson, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
  url: z.string().max(2000),
  headers: z.record(z.string().max(200), z.string().max(4000)).default({}),
  body: z.string().max(1_000_000).optional(),
  timeoutMs: z.number().int().min(500).max(30_000).default(15_000),
});

const FORBIDDEN_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "x-nexus-key"]);
const MAX_BYTES = 1_000_000;

/** Server-side proxy for the API Testing Studio with SSRF protection, timeout, size limit and no redirect following. */
export async function POST(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const limited = rateLimit(req, "nexus-http", 60);
  if (limited) return limited;
  const parsed = schema.safeParse(await readJson<unknown>(req, 1_500_000));
  if (!parsed.success) return bad("Некорректный запрос");
  const { method, url, headers, body, timeoutMs } = parsed.data;
  const check = checkUrl(url);
  if (!check.ok) return bad(check.reason, 400);
  try {
    const addrs = await lookup(check.url.hostname.replace(/^\[|\]$/g, ""), { all: true });
    if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) return bad("Адрес разрешается в приватную сеть — заблокировано", 400);
  } catch {
    return bad("Не удалось разрешить домен", 400);
  }
  const outHeaders = new Headers();
  for (const [k, v] of Object.entries(headers)) if (!FORBIDDEN_HEADERS.has(k.toLowerCase()) && /^[\w-]+$/.test(k)) outHeaders.set(k, v);
  const started = Date.now();
  try {
    const res = await fetch(check.url, {
      method,
      headers: outHeaders,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let truncated = false;
    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    const outH: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (k.toLowerCase() !== "set-cookie") outH[k] = v;
    });
    return Response.json({ status: res.status, statusText: res.statusText, headers: outH, body: text, size, truncated, ms: Date.now() - started, redirected: res.status >= 300 && res.status < 400 });
  } catch (err) {
    return bad(err instanceof Error && err.name === "TimeoutError" ? "Таймаут запроса" : `Ошибка запроса: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}
