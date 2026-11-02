import * as cheerio from "cheerio";
import { envToken } from "@/lib/nexus/server/guard";
import { safeFetch } from "./safe-fetch";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export type SearchProviderId = "tavily" | "brave" | "duckduckgo" | "wikipedia";

export interface SearchOutcome {
  provider: SearchProviderId;
  results: SearchResult[];
  attempts: { provider: SearchProviderId; error?: string; count: number }[];
}

function key(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 8 ? v : undefined;
}

export function configuredSearchProviders(): { id: SearchProviderId; keyed: boolean; ready: boolean }[] {
  return [
    { id: "tavily", keyed: true, ready: Boolean(key("TAVILY_API_KEY")) },
    { id: "brave", keyed: true, ready: Boolean(key("BRAVE_API_KEY") ?? key("BRAVE_SEARCH_API_KEY")) },
    { id: "duckduckgo", keyed: false, ready: true },
    { id: "wikipedia", keyed: false, ready: true },
  ];
}

async function json<T>(url: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function tavily(q: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const k = key("TAVILY_API_KEY") as string;
  const j = await json<{ results?: { title: string; url: string; content: string; published_date?: string }[] }>(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${k}` },
      body: JSON.stringify({ query: q, max_results: max, search_depth: "basic" }),
    },
    signal,
  );
  return (j.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content?.slice(0, 400) ?? "", date: r.published_date?.slice(0, 10) }));
}

async function brave(q: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const k = (key("BRAVE_API_KEY") ?? key("BRAVE_SEARCH_API_KEY")) as string;
  const j = await json<{ web?: { results?: { title: string; url: string; description?: string; page_age?: string }[] } }>(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${max}`,
    { headers: { "x-subscription-token": k, accept: "application/json" } },
    signal,
  );
  return (j.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: cheerio.load(r.description ?? "").text().slice(0, 400),
    date: r.page_age?.slice(0, 10),
  }));
}

/** Keyless best-effort provider: parses DuckDuckGo's HTML endpoint (may be rate-limited / challenged). */
async function duckduckgo(q: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await safeFetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { timeoutMs: 9000, signal });
  const $ = cheerio.load(res.body);
  const out: SearchResult[] = [];
  $(".result").each((_, el) => {
    if (out.length >= max) return;
    const a = $(el).find("a.result__a").first();
    let href = a.attr("href") ?? "";
    if (!href) return;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      href = u.searchParams.get("uddg") ?? u.toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//.test(href) || /duckduckgo\.com\/y\.js/.test(href)) return;
    out.push({ title: a.text().trim(), url: href, snippet: $(el).find(".result__snippet").first().text().trim().slice(0, 400) });
  });
  if (out.length === 0) throw new Error("пустая выдача (возможна защитная проверка DuckDuckGo)");
  return out;
}

async function wikipedia(q: string, max: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const lang = /[а-яё]/i.test(q) ? "ru" : "en";
  const j = await json<{ query?: { search?: { title: string; snippet: string; timestamp?: string }[] } }>(
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${max}&format=json&origin=*`,
    { headers: { "user-agent": "NexusAI/2.0 (https://nexus-ide-lime.vercel.app)" } },
    signal,
  );
  return (j.query?.search ?? []).map((r) => ({
    title: r.title,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`,
    snippet: cheerio.load(r.snippet).text().slice(0, 400),
    date: r.timestamp?.slice(0, 10),
  }));
}

const IMPL: Record<SearchProviderId, (q: string, max: number, s?: AbortSignal) => Promise<SearchResult[]>> = {
  tavily,
  brave,
  duckduckgo,
  wikipedia,
};

/** Tries providers in order (keyed first). Never fabricates results: returns an empty list + error trail instead. */
export async function searchWeb(query: string, max = 6, signal?: AbortSignal): Promise<SearchOutcome> {
  const attempts: SearchOutcome["attempts"] = [];
  for (const p of configuredSearchProviders()) {
    if (!p.ready) continue;
    try {
      const results = (await IMPL[p.id](query.slice(0, 300), max, signal)).filter((r) => r.url && r.title);
      attempts.push({ provider: p.id, count: results.length });
      if (results.length > 0) return { provider: p.id, results, attempts };
    } catch (e) {
      attempts.push({ provider: p.id, count: 0, error: e instanceof Error ? e.message : "ошибка" });
    }
    if (signal?.aborted) break;
  }
  return { provider: attempts[attempts.length - 1]?.provider ?? "wikipedia", results: [], attempts };
}

export { envToken };
