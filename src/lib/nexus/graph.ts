import type { MemoryItem } from "./types";

export type NodeKind = "component" | "api" | "test" | "doc" | "config" | "module" | "package" | "task" | "decision";

export interface GNode {
  id: string;
  label: string;
  kind: NodeKind;
  path?: string;
}
export interface GEdge {
  from: string;
  to: string;
  kind: "import" | "tests" | "documents" | "mentions" | "decides";
}
export interface Graph {
  nodes: GNode[];
  edges: GEdge[];
}

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+(?:\*|\{[\s\S]*?\})\s+from\s+|require\(\s*|import\(\s*)["']([^"']+)["']/g;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", "/index.ts", "/index.tsx", "/index.js"];

export function parseImports(src: string): string[] {
  const out: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(src))) if (m[1]) out.push(m[1]);
  return out;
}

export function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const parts = from.split("/").slice(0, -1);
    for (const seg of spec.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    base = parts.join("/");
  } else return null;
  for (const e of EXTS) if (files.has(base + e)) return base + e;
  return null;
}

export function kindOf(path: string, src = ""): NodeKind {
  if (/\.(test|spec)\.[jt]sx?$/.test(path) || /(^|\/)(__tests__|e2e)\//.test(path)) return "test";
  if (/\/api\/.*route\.[jt]s$/.test(path) || /(^|\/)pages\/api\//.test(path)) return "api";
  if (/\.mdx?$/.test(path)) return "doc";
  if (/(^|\/)(package\.json|tsconfig.*\.json|next\.config|.*\.config\.[mc]?[jt]s|\.env.*)/.test(path)) return "config";
  if (/\.[jt]sx$/.test(path) || /export default function [A-Z]/.test(src)) return "component";
  return "module";
}

export function buildDependencyGraph(files: Record<string, string>, opts: { includeExternal?: boolean } = {}): Graph {
  const set = new Set(Object.keys(files));
  const nodes = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const code = Object.keys(files).filter((p) => /\.[mc]?[jt]sx?$/.test(p));
  for (const p of code) nodes.set(p, { id: p, label: p.split("/").pop() ?? p, kind: kindOf(p, files[p]), path: p });
  for (const p of code) {
    for (const spec of parseImports(files[p] ?? "")) {
      const target = resolveImport(p, spec, set);
      if (target && nodes.has(target)) edges.push({ from: p, to: target, kind: "import" });
      else if (!target && opts.includeExternal && !spec.startsWith(".") && !spec.startsWith("@/")) {
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : (spec.split("/")[0] ?? spec);
        const id = `pkg:${pkg}`;
        if (!nodes.has(id)) nodes.set(id, { id, label: pkg, kind: "package" });
        edges.push({ from: p, to: id, kind: "import" });
      }
    }
  }
  return { nodes: [...nodes.values()], edges };
}

/** Knowledge graph = dependency graph + docs, tests, tasks and architecture decisions. */
export function buildKnowledgeGraph(
  files: Record<string, string>,
  memory: MemoryItem[],
  tasks: { id: string; title: string; prompt: string }[],
): Graph {
  const g = buildDependencyGraph(files);
  const nodes = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = [...g.edges];
  const paths = Object.keys(files);
  for (const p of paths) {
    if (!nodes.has(p) && /\.mdx?$/.test(p)) nodes.set(p, { id: p, label: p.split("/").pop() ?? p, kind: "doc", path: p });
  }
  const bySubject = (testPath: string) => {
    const base = (testPath.split("/").pop() ?? "").replace(/\.(test|spec)\.[jt]sx?$/, "");
    return paths.find((p) => p !== testPath && !/\.(test|spec)\./.test(p) && (p.split("/").pop() ?? "").replace(/\.[^.]+$/, "") === base);
  };
  for (const n of nodes.values()) {
    if (n.kind === "test" && n.path) {
      const subj = bySubject(n.path);
      if (subj && nodes.has(subj)) edges.push({ from: n.id, to: subj, kind: "tests" });
    }
    if (n.kind === "doc" && n.path) {
      const text = files[n.path] ?? "";
      for (const other of nodes.values()) {
        if (other.id === n.id || !other.path || other.kind === "doc") continue;
        if (text.includes(other.path) || (other.label.length > 5 && text.includes(other.label))) edges.push({ from: n.id, to: other.id, kind: "documents" });
      }
    }
  }
  const mention = (text: string, id: string, label: string, kind: "mentions" | "decides", from: string) => {
    for (const n of nodes.values()) {
      if (!n.path || n.id === from) continue;
      if (text.includes(n.path) || (n.label.length > 5 && text.includes(n.label))) edges.push({ from, to: n.id, kind });
    }
    void id;
    void label;
  };
  for (const m of memory.filter((x) => x.kind === "architecture" || x.kind === "convention")) {
    const id = `mem:${m.id}`;
    nodes.set(id, { id, label: m.title, kind: "decision" });
    mention(`${m.title} ${m.body}`, id, m.title, "decides", id);
  }
  for (const t of tasks.slice(0, 30)) {
    const id = `task:${t.id}`;
    nodes.set(id, { id, label: t.title, kind: "task" });
    mention(t.prompt, id, t.title, "mentions", id);
  }
  return { nodes: [...nodes.values()], edges };
}

export interface Positioned extends GNode {
  x: number;
  y: number;
}

/** Small deterministic force-directed layout. */
export function layoutGraph(g: Graph, width: number, height: number, iterations = 160): Positioned[] {
  const n = g.nodes.length;
  const pos = g.nodes.map((node, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = Math.min(width, height) * 0.38;
    return { ...node, x: width / 2 + Math.cos(a) * r, y: height / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
  });
  const idx = new Map(pos.map((p, i) => [p.id, i]));
  const k = Math.sqrt((width * height) / Math.max(1, n)) * 0.7;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[i];
        const b = pos[j];
        if (!a || !b) continue;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 0.01;
        const f = (k * k) / d2;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }
    for (const e of g.edges) {
      const a = pos[idx.get(e.from) ?? -1];
      const b = pos[idx.get(e.to) ?? -1];
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d * d) / k / 40;
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
    for (const p of pos) {
      p.vx += (width / 2 - p.x) * 0.01;
      p.vy += (height / 2 - p.y) * 0.01;
      const m = Math.hypot(p.vx, p.vy) || 1;
      const lim = 12 * t + 1;
      p.x = Math.min(width - 20, Math.max(20, p.x + (p.vx / m) * Math.min(m, lim)));
      p.y = Math.min(height - 20, Math.max(20, p.y + (p.vy / m) * Math.min(m, lim)));
      p.vx = 0;
      p.vy = 0;
    }
  }
  return pos.map((p) => ({ id: p.id, label: p.label, kind: p.kind, path: p.path, x: p.x, y: p.y }));
}
