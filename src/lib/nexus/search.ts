import { tokenize } from "./memory";

interface Chunk {
  path: string;
  start: number;
  end: number;
  text: string;
  tf: Map<string, number>;
  len: number;
}

export interface SearchIndex {
  chunks: Chunk[];
  hashes: Map<string, string>;
  df: Map<string, number>;
  avgLen: number;
}

const SYNONYMS: Record<string, string[]> = {
  auth: ["login", "session", "token", "password", "signin", "jwt"],
  login: ["auth", "signin", "session"],
  db: ["database", "sql", "query", "postgres", "table"],
  database: ["db", "sql", "query", "schema"],
  fetch: ["request", "http", "api", "axios", "get", "post"],
  api: ["fetch", "endpoint", "route", "request", "handler"],
  error: ["exception", "catch", "throw", "fail", "ошибка"],
  ошибка: ["error", "exception", "catch"],
  ui: ["component", "render", "view", "jsx"],
  component: ["ui", "render", "props", "jsx"],
  test: ["spec", "expect", "describe", "assert"],
  style: ["css", "tailwind", "theme", "class"],
  file: ["path", "fs", "read", "write"],
  config: ["settings", "env", "options"],
  delete: ["remove", "unlink", "drop"],
  save: ["write", "persist", "store"],
};

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `${s.length}:${h}`;
}

function chunkFile(path: string, text: string, size = 24, overlap = 6): Chunk[] {
  const lines = text.split("\n");
  const out: Chunk[] = [];
  for (let i = 0; i < Math.max(1, lines.length); i += size - overlap) {
    const slice = lines.slice(i, i + size);
    const body = slice.join("\n");
    const tokens = [...tokenize(body), ...tokenize(path)];
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    out.push({ path, start: i + 1, end: i + slice.length, text: body, tf, len: tokens.length });
    if (i + size >= lines.length) break;
  }
  return out;
}

function recompute(idx: SearchIndex): void {
  idx.df = new Map();
  let total = 0;
  for (const c of idx.chunks) {
    total += c.len;
    for (const t of c.tf.keys()) idx.df.set(t, (idx.df.get(t) ?? 0) + 1);
  }
  idx.avgLen = idx.chunks.length ? total / idx.chunks.length : 1;
}

export function emptyIndex(): SearchIndex {
  return { chunks: [], hashes: new Map(), df: new Map(), avgLen: 1 };
}

/** Incremental update: only changed/removed files are re-chunked. Returns number of files re-indexed. */
export function updateIndex(idx: SearchIndex, files: Record<string, string>): number {
  let changed = 0;
  const paths = new Set(Object.keys(files));
  for (const p of [...idx.hashes.keys()]) {
    if (!paths.has(p)) {
      idx.hashes.delete(p);
      idx.chunks = idx.chunks.filter((c) => c.path !== p);
      changed++;
    }
  }
  for (const [p, text] of Object.entries(files)) {
    if (/node_modules\/|\.lock$|package-lock/.test(p) || text.length > 300_000) continue;
    const h = hash(text);
    if (idx.hashes.get(p) === h) continue;
    idx.chunks = idx.chunks.filter((c) => c.path !== p);
    idx.chunks.push(...chunkFile(p, text));
    idx.hashes.set(p, h);
    changed++;
  }
  if (changed) recompute(idx);
  return changed;
}

export interface SearchHit {
  path: string;
  start: number;
  end: number;
  score: number;
  snippet: string;
}

export function expandQuery(q: string): { term: string; weight: number }[] {
  const base = tokenize(q);
  const out = new Map<string, number>();
  for (const t of base) {
    out.set(t, 1);
    for (const s of SYNONYMS[t] ?? []) if (!out.has(s)) out.set(s, 0.45);
  }
  return [...out].map(([term, weight]) => ({ term, weight }));
}

export function search(idx: SearchIndex, query: string, opts: { pathFilter?: string; limit?: number } = {}): SearchHit[] {
  const terms = expandQuery(query);
  if (terms.length === 0 || idx.chunks.length === 0) return [];
  const N = idx.chunks.length;
  const k1 = 1.4;
  const b = 0.75;
  let filter: RegExp | null = null;
  if (opts.pathFilter?.trim()) {
    try {
      filter = new RegExp(opts.pathFilter.trim().replace(/\*/g, ".*"), "i");
    } catch {
      filter = null;
    }
  }
  const scored: SearchHit[] = [];
  for (const c of idx.chunks) {
    if (filter && !filter.test(c.path)) continue;
    let score = 0;
    for (const { term, weight } of terms) {
      const f = c.tf.get(term);
      if (!f) continue;
      const df = idx.df.get(term) ?? 1;
      const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      score += weight * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.len) / idx.avgLen)));
    }
    if (score > 0) scored.push({ path: c.path, start: c.start, end: c.end, score, snippet: c.text.split("\n").slice(0, 8).join("\n") });
  }
  const best = new Map<string, SearchHit>();
  for (const h of scored.sort((a, b2) => b2.score - a.score)) if (!best.has(h.path)) best.set(h.path, h);
  return [...best.values()].slice(0, opts.limit ?? 20);
}
