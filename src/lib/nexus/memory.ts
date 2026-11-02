import type { MemoryItem } from "./types";

export const MEMORY_LIMITS = { maxItems: 200, maxChars: 60_000 };

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "for", "и", "в", "на", "с", "по", "что", "как", "это", "не"]);

export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export function searchMemory(items: MemoryItem[], query: string): MemoryItem[] {
  const q = tokenize(query);
  if (q.length === 0) return [...items].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  const scored = items.map((it) => {
    const title = tokenize(it.title);
    const body = tokenize(it.body);
    const tags = it.tags.flatMap(tokenize);
    let score = 0;
    for (const t of q) {
      if (title.includes(t)) score += 3;
      if (tags.includes(t)) score += 2;
      if (body.includes(t)) score += 1;
    }
    return { it, score: score + (it.pinned && score > 0 ? 1 : 0) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.it.updatedAt - a.it.updatedAt)
    .map((s) => s.it);
}

export function memorySize(items: MemoryItem[]): number {
  return items.reduce((n, i) => n + i.title.length + i.body.length, 0);
}

/** Enforces the capacity limit by evicting the oldest non-pinned entries. Returns kept items and evicted ones. */
export function enforceLimit(items: MemoryItem[], limits = MEMORY_LIMITS): { kept: MemoryItem[]; evicted: MemoryItem[] } {
  const kept = [...items];
  const evicted: MemoryItem[] = [];
  const order = [...items].filter((i) => !i.pinned).sort((a, b) => a.updatedAt - b.updatedAt);
  while ((kept.length > limits.maxItems || memorySize(kept) > limits.maxChars) && order.length > 0) {
    const victim = order.shift();
    if (!victim) break;
    kept.splice(kept.indexOf(victim), 1);
    evicted.push(victim);
  }
  return { kept, evicted };
}

/** Builds a compact memory block for prompts, most relevant first, within a character budget. */
export function memoryContext(items: MemoryItem[], query: string, budget = 4000): string {
  const ranked = searchMemory(items, query);
  const pinned = items.filter((i) => i.pinned && !ranked.includes(i));
  let out = "";
  for (const it of [...pinned, ...ranked]) {
    const line = `- [${it.kind}] ${it.title}: ${it.body.replace(/\s+/g, " ").slice(0, 400)}\n`;
    if (out.length + line.length > budget) break;
    out += line;
  }
  return out;
}
