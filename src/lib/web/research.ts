import type { ChatSource } from "@/lib/db/schema";
import { checkUrl } from "@/lib/nexus/ssrf";
import { extractPage, type ExtractedPage } from "./extract";
import { assertPublicHost, safeFetch, WebFetchError } from "./safe-fetch";
import { searchWeb, type SearchResult } from "./search";
import type { SourceDoc } from "./inject";

export interface ResearchState {
  docs: SourceDoc[];
  providers: Map<number, string>;
  unread: SearchResult[];
  read: Set<string>;
}

export function newResearch(): ResearchState {
  return { docs: [], providers: new Map(), unread: [], read: new Set() };
}

export function toSources(s: ResearchState): ChatSource[] {
  return s.docs.map((d) => ({ n: d.n, title: d.title, url: d.url, date: d.date, provider: s.providers.get(d.n) }));
}

function addDoc(s: ResearchState, d: Omit<SourceDoc, "n">, provider?: string): SourceDoc {
  const existing = s.docs.find((x) => x.url === d.url);
  if (existing) {
    // A fetched page replaces the short search snippet for the same URL.
    if (d.text.length > existing.text.length) existing.text = d.text;
    existing.title = d.title || existing.title;
    existing.date = d.date ?? existing.date;
    return existing;
  }
  const doc = { ...d, n: s.docs.length + 1 };
  s.docs.push(doc);
  if (provider) s.providers.set(doc.n, provider);
  return doc;
}

export async function doSearch(
  s: ResearchState,
  query: string,
  signal?: AbortSignal,
): Promise<{ provider: string; count: number; error?: string }> {
  const out = await searchWeb(query, 6, signal);
  for (const r of out.results) {
    addDoc(s, { title: r.title, url: r.url, date: r.date, text: r.snippet }, out.provider);
    if (!s.read.has(r.url) && !s.unread.some((u) => u.url === r.url)) s.unread.push(r);
  }
  if (out.results.length === 0) {
    const trail = out.attempts.map((a) => `${a.provider}: ${a.error ?? "0 результатов"}`).join("; ");
    return { provider: out.provider, count: 0, error: `Нет результатов (${trail})` };
  }
  return { provider: out.provider, count: out.results.length };
}

/** Optional JS-rendering browser service (e.g. Browserless). Without it, JS-only sites cannot be read. */
export function renderServiceConfigured(): boolean {
  return Boolean(process.env.BROWSERLESS_URL?.trim() && process.env.BROWSERLESS_TOKEN?.trim());
}

async function renderViaService(url: string, signal?: AbortSignal): Promise<string> {
  const base = (process.env.BROWSERLESS_URL as string).replace(/\/$/, "");
  const token = process.env.BROWSERLESS_TOKEN as string;
  const check = checkUrl(url);
  if (!check.ok) throw new WebFetchError(check.reason, "blocked");
  await assertPublicHost(check.url);
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 25_000);
  signal?.addEventListener("abort", () => ac.abort(), { once: true });
  try {
    const res = await fetch(`${base}/content?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: check.url.toString(), gotoOptions: { waitUntil: "networkidle2", timeout: 20000 } }),
      signal: ac.signal,
    });
    if (!res.ok) throw new WebFetchError(`Браузерный сервис: HTTP ${res.status}`, "http");
    return (await res.text()).slice(0, 2_000_000);
  } catch (e) {
    if (e instanceof WebFetchError) throw e;
    throw new WebFetchError(ac.signal.aborted ? "Таймаут браузерного сервиса" : "Браузерный сервис недоступен", "network");
  } finally {
    clearTimeout(t);
  }
}

export interface BrowseResult extends ExtractedPage {
  finalUrl: string;
  status: number;
  redirects: string[];
  truncated: boolean;
  renderedBy: "http" | "browserless";
}

export async function browse(url: string, opts: { render?: boolean; maxChars?: number; signal?: AbortSignal } = {}): Promise<BrowseResult> {
  const res = await safeFetch(url, { signal: opts.signal });
  let page = extractPage(res.body, res.finalUrl, opts.maxChars ?? 12_000);
  let renderedBy: BrowseResult["renderedBy"] = "http";
  if ((opts.render || page.likelyNeedsJs) && renderServiceConfigured()) {
    try {
      const html = await renderViaService(res.finalUrl, opts.signal);
      page = extractPage(html, res.finalUrl, opts.maxChars ?? 12_000);
      renderedBy = "browserless";
    } catch {
      /* keep the plain-HTTP result */
    }
  }
  return { ...page, finalUrl: res.finalUrl, status: res.status, redirects: res.redirects, truncated: res.truncated, renderedBy };
}

export async function doRead(
  s: ResearchState,
  url: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; title: string; chars: number; error?: string }> {
  s.read.add(url);
  s.unread = s.unread.filter((u) => u.url !== url);
  try {
    const page = await browse(url, { maxChars: 6000, signal });
    const note = page.likelyNeedsJs && !renderServiceConfigured() ? "\n[Страница, вероятно, требует JavaScript — HTTP-чтение дало мало текста.]" : "";
    addDoc(s, { title: page.title, url: page.finalUrl, date: page.published, text: `${page.description ? `${page.description}\n` : ""}${page.text}${note}` });
    return { ok: true, title: page.title, chars: page.text.length };
  } catch (e) {
    return { ok: false, title: url, chars: 0, error: e instanceof Error ? e.message : "ошибка чтения" };
  }
}
