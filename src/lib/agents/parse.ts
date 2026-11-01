import { normalizePath } from "@/lib/utils/path";
import type { DirectorPlan, FileProposal, ReviewIssue, ReviewResult, SubTask, WorkerRole } from "./types";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/* --------------------------------- JSON ---------------------------------- */

function findBalanced(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParse(text: string): unknown {
  const attempts = [text, text.replace(/,\s*([}\]])/g, "$1")];
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** Extracts the first JSON object from free-form model output. */
export function extractJson(text: string): unknown {
  const candidates: string[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) candidates.push(m[1]);
  candidates.push(text);
  for (const c of candidates) {
    const direct = tryParse(c.trim());
    if (direct !== undefined && isRecord(direct)) return direct;
    const balanced = findBalanced(c);
    if (balanced) {
      const parsed = tryParse(balanced);
      if (parsed !== undefined && isRecord(parsed)) return parsed;
    }
  }
  return undefined;
}

/* ----------------------------- director plan ------------------------------ */

const ROLES: readonly WorkerRole[] = ["architect", "coder", "reviewer"];

function toRole(v: unknown): WorkerRole | null {
  if (typeof v !== "string") return null;
  const r = v.trim().toLowerCase();
  return (ROLES as readonly string[]).includes(r) ? (r as WorkerRole) : null;
}

function hasCycle(tasks: SubTask[]): boolean {
  const remaining = new Map(tasks.map((t) => [t.id, new Set(t.dependsOn)]));
  let progressed = true;
  while (remaining.size > 0 && progressed) {
    progressed = false;
    for (const [id, deps] of remaining) {
      if (deps.size === 0) {
        remaining.delete(id);
        for (const other of remaining.values()) other.delete(id);
        progressed = true;
      }
    }
  }
  return remaining.size > 0;
}

export const MAX_PLAN_TASKS = 6;

export function parsePlan(text: string): DirectorPlan | null {
  const json = extractJson(text);
  if (!isRecord(json) || !Array.isArray(json.tasks)) return null;

  const tasks: SubTask[] = [];
  const seen = new Set<string>();
  json.tasks.forEach((raw: unknown, idx: number) => {
    if (tasks.length >= MAX_PLAN_TASKS || !isRecord(raw)) return;
    const agent = toRole(raw.agent);
    if (!agent) return;
    let id = nonEmptyString(typeof raw.id === "number" ? String(raw.id) : raw.id) ?? `t${idx + 1}`;
    if (seen.has(id)) id = `t${idx + 1}_${tasks.length}`;
    seen.add(id);
    const title = nonEmptyString(raw.title) ?? `${agent} #${tasks.length + 1}`;
    const instruction = nonEmptyString(raw.instruction) ?? title;
    const dependsOn = Array.isArray(raw.dependsOn)
      ? raw.dependsOn.map((d: unknown) => (typeof d === "number" ? String(d) : nonEmptyString(d))).filter((d): d is string => !!d)
      : [];
    const files = Array.isArray(raw.files)
      ? raw.files
          .map((f: unknown) => nonEmptyString(f))
          .filter((f): f is string => !!f)
          .map(normalizePath)
          .filter(Boolean)
      : [];
    tasks.push({ id, agent, title, instruction, dependsOn, files });
  });

  if (!tasks.some((t) => t.agent === "coder")) return null;

  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) t.dependsOn = Array.from(new Set(t.dependsOn.filter((d) => ids.has(d) && d !== t.id)));

  // Structural normalization: design first, review last.
  const architect = tasks.find((t) => t.agent === "architect");
  const coders = tasks.filter((t) => t.agent === "coder");
  if (architect) {
    architect.dependsOn = [];
    for (const c of coders) if (c.dependsOn.length === 0) c.dependsOn = [architect.id];
  }
  for (const r of tasks.filter((t) => t.agent === "reviewer")) {
    if (r.dependsOn.length === 0) r.dependsOn = coders.map((c) => c.id);
  }

  if (hasCycle(tasks)) return null;
  return { summary: nonEmptyString(json.summary) ?? "", tasks };
}

export function defaultPlan(task: string): DirectorPlan {
  const short = task.length > 120 ? `${task.slice(0, 117)}…` : task;
  return {
    summary: short,
    tasks: [
      {
        id: "t1",
        agent: "architect",
        title: "Проектирование решения",
        instruction: `Спроектируй решение задачи: ${task}`,
        dependsOn: [],
        files: [],
      },
      {
        id: "t2",
        agent: "coder",
        title: "Реализация",
        instruction: `Реализуй задачу целиком: ${task}`,
        dependsOn: ["t1"],
        files: [],
      },
      {
        id: "t3",
        agent: "reviewer",
        title: "Ревью изменений",
        instruction: "Проверь предложенные изменения на ошибки и соответствие задаче.",
        dependsOn: ["t2"],
        files: [],
      },
    ],
  };
}

/* ------------------------------ file blocks ------------------------------- */

function sanitizePath(raw: string): string | null {
  const trimmed = raw.trim().replace(/^["'`]|["'`]$/g, "");
  if (!trimmed || /(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return null;
  const path = normalizePath(trimmed);
  if (!path || path.length > 200) return null;
  return path;
}

function stripFence(content: string): string {
  let c = content.replace(/^\r?\n/, "");
  const open = /^```[\w+-]*[ \t]*\r?\n/;
  if (open.test(c)) {
    c = c.replace(open, "");
    c = c.replace(/\r?\n?```[ \t]*\s*$/, "");
  }
  return c.replace(/\s+$/, "") + "\n";
}

export interface FileBlock {
  path: string;
  content: string;
}

/** Parses `<file path="...">…</file>` blocks (with a fenced-info-string fallback). */
export function parseFileBlocks(text: string): FileBlock[] {
  const blocks = new Map<string, string>();
  const tag = /<file\s+path\s*=\s*["']([^"'\n]+)["']\s*>([\s\S]*?)<\/file>/gi;
  let m: RegExpExecArray | null;
  while ((m = tag.exec(text)) !== null) {
    const path = sanitizePath(m[1]);
    if (path) blocks.set(path, stripFence(m[2]));
  }
  if (blocks.size === 0) {
    const fenced = /```[\w+-]*[ \t]+(?:path=|file=|filename=)?["']?([^\s"'`\n]+\.[\w]+)["']?[ \t]*\r?\n([\s\S]*?)```/g;
    while ((m = fenced.exec(text)) !== null) {
      const path = sanitizePath(m[1]);
      if (path) blocks.set(path, m[2].replace(/\s+$/, "") + "\n");
    }
  }
  return Array.from(blocks, ([path, content]) => ({ path, content }));
}

export function toProposals(blocks: FileBlock[], existingPaths: ReadonlySet<string>): FileProposal[] {
  return blocks.map((b) => ({
    path: b.path,
    content: b.content,
    action: existingPaths.has(b.path) ? "modify" : "create",
  }));
}

/* --------------------------------- review --------------------------------- */

export function parseReview(text: string): ReviewResult {
  const json = extractJson(text);
  if (isRecord(json)) {
    const verdictRaw = nonEmptyString(json.verdict)?.toLowerCase();
    const verdict: ReviewResult["verdict"] =
      verdictRaw === "approve" || verdictRaw === "approved"
        ? "approve"
        : verdictRaw === "changes" || verdictRaw === "reject"
          ? "changes"
          : "unknown";
    const issues: ReviewIssue[] = [];
    if (Array.isArray(json.issues)) {
      for (const raw of json.issues as unknown[]) {
        if (!isRecord(raw)) continue;
        const message = nonEmptyString(raw.message);
        if (!message) continue;
        const sev = nonEmptyString(raw.severity)?.toLowerCase();
        issues.push({
          severity: sev === "error" || sev === "warning" ? sev : "info",
          file: nonEmptyString(raw.file),
          message,
        });
      }
    }
    return { verdict, summary: nonEmptyString(json.summary) ?? "", issues };
  }
  return { verdict: "unknown", summary: text.trim().slice(0, 600), issues: [] };
}
