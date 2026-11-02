import { lookup } from "node:dns/promises";
import { checkUrl, isPrivateIp } from "@/lib/nexus/ssrf";

/**
 * SSRF-hardened HTTP fetch for the AI web tools (Node.js runtime only).
 * - only http/https, no credentials, no localhost / private ranges
 * - every hostname is resolved and ALL addresses must be public
 * - redirects are followed manually and each hop is re-validated
 * - hard timeout and response size cap
 * NOTE: this is a plain HTTP client. It does NOT execute JavaScript (see browser-render.ts for that).
 */

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  redirects: string[];
  truncated: boolean;
}

export class WebFetchError extends Error {
  constructor(
    message: string,
    readonly code: "blocked" | "timeout" | "http" | "network" | "too_large" | "unsupported",
  ) {
    super(message);
    this.name = "WebFetchError";
  }
}

export async function assertPublicHost(url: URL): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (isPrivateIp(host)) throw new WebFetchError("Приватный IP заблокирован", "blocked");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new WebFetchError(`Не удалось разрешить домен ${host}`, "network");
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new WebFetchError("Домен указывает на приватный адрес — заблокировано", "blocked");
  }
}

const TEXTUAL = /^(text\/|application\/(xhtml\+xml|xml|json|ld\+json|rss\+xml|atom\+xml))/i;

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
  accept?: string;
}

export async function safeFetch(rawUrl: string, o: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = o.timeoutMs ?? 12_000;
  const maxBytes = o.maxBytes ?? 1_500_000;
  const maxRedirects = o.maxRedirects ?? 5;
  const redirects: string[] = [];
  let current = rawUrl;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const check = checkUrl(current);
      if (!check.ok) throw new WebFetchError(check.reason, "blocked");
      await assertPublicHost(check.url);

      let res: Response;
      try {
        res = await fetch(check.url, {
          redirect: "manual",
          signal: ac.signal,
          headers: {
            "user-agent": "Mozilla/5.0 (compatible; NexusAI/2.0; +https://nexus-ide-lime.vercel.app)",
            accept: o.accept ?? "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            "accept-language": "ru,en;q=0.8",
          },
        });
      } catch (e) {
        if (ac.signal.aborted) throw new WebFetchError(`Таймаут ${Math.round(timeoutMs / 1000)} с`, "timeout");
        throw new WebFetchError(e instanceof Error ? e.message : "Сетевая ошибка", "network");
      }

      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location") as string, check.url).toString();
        redirects.push(next);
        current = next;
        await res.body?.cancel().catch(() => undefined);
        continue;
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (res.status >= 400) {
        await res.body?.cancel().catch(() => undefined);
        throw new WebFetchError(`HTTP ${res.status}`, "http");
      }
      if (contentType && !TEXTUAL.test(contentType)) {
        await res.body?.cancel().catch(() => undefined);
        throw new WebFetchError(`Тип содержимого не поддерживается: ${contentType.split(";")[0]}`, "unsupported");
      }

      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      if (reader) {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
              chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
              truncated = true;
              await reader.cancel().catch(() => undefined);
              break;
            }
            chunks.push(value);
          }
        } catch {
          if (ac.signal.aborted) throw new WebFetchError("Таймаут при чтении страницы", "timeout");
          throw new WebFetchError("Обрыв соединения", "network");
        }
      }
      const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
      const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
      let body: string;
      try {
        body = new TextDecoder(charset && charset !== "utf8" ? charset : "utf-8").decode(merged);
      } catch {
        body = merged.toString("utf8");
      }
      return { finalUrl: current, status: res.status, contentType, body, redirects, truncated };
    }
    throw new WebFetchError("Слишком много перенаправлений", "http");
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
}
