import { createTwoFilesPatch, diffLines } from "diff";
import { normalizePath } from "@/lib/utils/path";
import type { Change } from "./types";

/** Extracts the first JSON object from a model answer (handles ``` fences and prose around it). */
export function extractJson<T = unknown>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text].filter((x): x is string => Boolean(x));
  for (const c of candidates) {
    const start = c.indexOf("{");
    const startArr = c.indexOf("[");
    const from = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
    if (from === -1) continue;
    const open = c[from];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = from; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try {
          return JSON.parse(c.slice(from, i + 1)) as T;
        } catch {
          break;
        }
      }
    }
  }
  return null;
}

export const FILE_FORMAT_HINT =
  "Для каждого изменённого или нового файла выведи блок строго в таком формате (содержимое — ПОЛНЫЙ файл):\n=== FILE: путь/к/файлу ===\n<содержимое>\n=== END FILE ===\nДля удаления файла: === DELETE: путь ===. Никакого текста внутри блоков кроме кода.";

/** Parses `=== FILE: path ===` blocks into proposed changes relative to the current workspace. */
export function parseFileBlocks(text: string, current: Record<string, string>): Change[] {
  const out: Change[] = [];
  const re = /===\s*FILE:\s*(.+?)\s*===\r?\n([\s\S]*?)\r?\n?===\s*END FILE\s*===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const path = safePath(m[1] ?? "");
    if (!path) continue;
    let content = m[2] ?? "";
    const fence = /^```[\w-]*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(content.trim());
    if (fence) content = fence[1] ?? content;
    out.push({ path, before: current[path] ?? null, after: content });
  }
  const del = /===\s*DELETE:\s*(.+?)\s*===/g;
  while ((m = del.exec(text))) {
    const path = safePath(m[1] ?? "");
    if (path && path in current) out.push({ path, before: current[path] ?? null, after: null });
  }
  return dedupeChanges(out);
}

export function safePath(raw: string): string | null {
  const cleaned = raw.replace(/^[`'"]+|[`'"]+$/g, "").trim();
  if (cleaned.split(/[\\/]/).includes("..") || /^([a-z]:)?[\\/]/i.test(cleaned) || cleaned.includes("\0")) return null;
  const p = normalizePath(cleaned);
  if (!p || p.length > 240 || /(^|\/)(\.git|node_modules)(\/|$)/.test(p)) return null;
  return p;
}

export function dedupeChanges(cs: Change[]): Change[] {
  const map = new Map<string, Change>();
  for (const c of cs) map.set(c.path, c);
  return [...map.values()].filter((c) => c.before !== c.after);
}

export function unifiedDiff(c: Change): string {
  return createTwoFilesPatch(`a/${c.path}`, `b/${c.path}`, c.before ?? "", c.after ?? "", "", "", { context: 3 });
}

export function changeStats(c: Change): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const p of diffLines(c.before ?? "", c.after ?? "")) {
    if (p.added) added += p.count ?? 0;
    else if (p.removed) removed += p.count ?? 0;
  }
  return { added, removed };
}

/** Builds Change[] by diffing two full file maps (used to turn an isolated agent workspace into a diff). */
export function diffWorkspaces(base: Record<string, string>, next: Record<string, string>): Change[] {
  const out: Change[] = [];
  for (const [path, after] of Object.entries(next)) {
    if (base[path] !== after) out.push({ path, before: base[path] ?? null, after });
  }
  for (const path of Object.keys(base)) if (!(path in next)) out.push({ path, before: base[path] ?? null, after: null });
  return out;
}

/** Compact context for prompts: tree + selected files, bounded by a character budget. */
export function buildContext(files: Record<string, string>, focus: string[], budget = 28_000): string {
  const paths = Object.keys(files).sort();
  let out = `Дерево проекта:\n${paths.slice(0, 300).join("\n")}\n`;
  const ordered = [...focus.filter((p) => p in files), ...paths.filter((p) => !focus.includes(p))];
  for (const p of ordered) {
    if (!focus.includes(p) && out.length > budget * 0.6) break;
    const body = files[p] ?? "";
    const chunk = `\n--- ${p} ---\n${body.slice(0, focus.includes(p) ? 12_000 : 2_000)}\n`;
    if (out.length + chunk.length > budget) break;
    out += chunk;
  }
  return out;
}
