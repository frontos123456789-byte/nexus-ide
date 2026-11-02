import { describe, expect, it } from "vitest";
import { resolvePolicy, DEFAULT_POLICY, normalizePolicy } from "./permissions";
import { redact, scanText, scanFiles } from "./secrets";
import { enforceLimit, memoryContext, searchMemory } from "./memory";
import { rankModels, routeChain } from "./router";
import { budgetStatus, breakdownBy, DEFAULT_RATES } from "./cost";
import { hasConflicts, merge3, parseConflicts, renderMerge, resolveConflict } from "./merge";
import { runWorkflow, validateWorkflow, type Workflow } from "./workflow";
import { classifySql } from "./sql-guard";
import { checkUrl, isPrivateIp } from "./ssrf";
import { extractJson, parseFileBlocks, diffWorkspaces } from "./changes";
import { buildDependencyGraph, buildKnowledgeGraph, parseImports, resolveImport } from "./graph";
import { computeHealth, decisionCount } from "./health";
import { emptyIndex, search, updateIndex } from "./search";
import { auditCode, diagnoseWorkspace } from "./audit";
import { animationToCss, contrastRatio, parseCssVars, tokensToCss, DEFAULT_TOKENS } from "./design";
import { renderScenario, validateScenario } from "./scenarios";
import type { MemoryItem } from "./types";

const mem = (id: string, o: Partial<MemoryItem> = {}): MemoryItem => ({ id, kind: "doc", title: id, body: "", tags: [], pinned: false, createdAt: 1, updatedAt: 1, ...o });

describe("permissions", () => {
  it("takes the strictest policy and never auto-allows dangerous caps", () => {
    expect(resolvePolicy("read", DEFAULT_POLICY)).toBe("allow");
    expect(resolvePolicy("read", DEFAULT_POLICY, { read: "deny" })).toBe("deny");
    expect(resolvePolicy("delete", { ...DEFAULT_POLICY, delete: "allow" })).toBe("ask");
    expect(resolvePolicy("write", { ...DEFAULT_POLICY, write: "allow" }, { write: "ask" })).toBe("ask");
  });
  it("normalizes junk", () => {
    expect(normalizePolicy({ read: "bogus", write: "deny" }).read).toBe("allow");
    expect(normalizePolicy({ write: "deny" }).write).toBe("deny");
  });
});

describe("secrets", () => {
  const gh = `ghp_${"a1B2c3D4e5".repeat(4)}`;
  it("detects and masks tokens", () => {
    const f = scanText("a.ts", `const t = "${gh}";`);
    expect(f[0]?.ruleId).toBe("github-token");
    expect(f[0]?.preview).not.toContain(gh);
  });
  it("ignores placeholders, env refs and nexus-ignore", () => {
    expect(scanText("a.ts", 'const k = "your_api_key_here_123456";')).toHaveLength(0);
    expect(scanText("a.ts", "const k = process.env.API_KEY_SECRET_VALUE;")).toHaveLength(0);
    expect(scanText("a.ts", `const t = "${gh}"; // nexus-ignore`)).toHaveLength(0);
  });
  it("supports allowlist by fingerprint", () => {
    const f = scanText("a.ts", `x = "${gh}"`);
    expect(scanText("a.ts", `x = "${gh}"`, [f[0]?.fingerprint ?? ""])).toHaveLength(0);
  });
  it("redacts", () => {
    expect(redact(`token ${gh} end`)).not.toContain(gh);
    expect(redact("postgres://user:hunter2pass@host/db")).not.toContain("hunter2pass");
  });
  it("scans maps and skips lockfiles", () => {
    expect(scanFiles({ "package-lock.json": `"${gh}"`, "x.ts": `y="${gh}"` })).toHaveLength(1);
  });
});

describe("memory", () => {
  it("searches by title/tags/body", () => {
    const items = [mem("a", { title: "Database choice", body: "postgres" }), mem("b", { title: "UI", body: "tailwind" })];
    expect(searchMemory(items, "postgres")[0]?.id).toBe("a");
    expect(searchMemory(items, "zzz")).toHaveLength(0);
  });
  it("evicts oldest non-pinned over the limit", () => {
    const items = [mem("old", { updatedAt: 1 }), mem("pin", { updatedAt: 0, pinned: true }), mem("new", { updatedAt: 9 })];
    const { kept, evicted } = enforceLimit(items, { maxItems: 2, maxChars: 1e6 });
    expect(evicted.map((i) => i.id)).toEqual(["old"]);
    expect(kept.map((i) => i.id).sort()).toEqual(["new", "pin"]);
  });
  it("builds bounded context", () => {
    const items = [mem("a", { title: "arch", body: "x".repeat(1000), kind: "architecture" })];
    expect(memoryContext(items, "arch", 100)).toBe("");
    expect(memoryContext(items, "arch", 2000)).toContain("[architecture]");
  });
});

describe("router", () => {
  it("prefers code models for code and honours manual + disabled", () => {
    const ids = routeChain("code", 1000, { disabled: [] });
    expect(ids[0]).toMatch(/flint|code/);
    expect(routeChain("code", 1000, { disabled: [], manualModel: "openrouter/free" })[0]).toBe("openrouter/free");
    expect(routeChain("code", 1000, { disabled: ["openrouter/free"] })).not.toContain("openrouter/free");
  });
  it("penalizes small context windows", () => {
    const cat = [
      { id: "a:free", label: "A", vendor: "x", contextWindow: 1000 },
      { id: "b:free", label: "B", vendor: "x", contextWindow: 100000 },
    ];
    expect(rankModels("chat", 5000, { disabled: [] }, cat)[0]?.model.id).toBe("b:free");
  });
  it("never routes to paid models", () => {
    expect(rankModels("chat", 1, { disabled: [] }, [{ id: "openai/gpt-x", label: "p", vendor: "o" }])).toHaveLength(0);
  });
});

describe("cost", () => {
  const ev = (n: number, est = false) => ({ id: String(n), ts: Date.now(), feature: "f", project: "p", model: "m", promptTokens: n, completionTokens: n, estimated: est });
  it("flags budget levels", () => {
    expect(budgetStatus([ev(10)], { dailyTokens: 1000, dailyRequests: 10, monthlyUsd: 1 }, DEFAULT_RATES).level).toBe("ok");
    expect(budgetStatus([ev(450)], { dailyTokens: 1000, dailyRequests: 10, monthlyUsd: 1 }, DEFAULT_RATES).level).toBe("warn");
    expect(budgetStatus([ev(600)], { dailyTokens: 1000, dailyRequests: 10, monthlyUsd: 1 }, DEFAULT_RATES).level).toBe("blocked");
  });
  it("separates actual and estimated tokens", () => {
    const b = breakdownBy([ev(5), ev(5, true)], (e) => e.model, DEFAULT_RATES)[0];
    expect(b?.actualTokens).toBe(10);
    expect(b?.estimatedTokens).toBe(10);
  });
});

describe("merge3", () => {
  it("merges non-overlapping edits", () => {
    const base = "a\nb\nc\nd";
    const segs = merge3(base, "a\nB\nc\nd", "a\nb\nc\nD");
    expect(hasConflicts(segs)).toBe(false);
    expect(renderMerge(segs)).toBe("a\nB\nc\nD");
  });
  it("reports conflicts and resolves them", () => {
    const segs = merge3("a\nb\nc", "a\nX\nc", "a\nY\nc");
    expect(hasConflicts(segs)).toBe(true);
    const text = renderMerge(segs);
    const blocks = parseConflicts(text);
    expect(blocks).toHaveLength(1);
    expect(resolveConflict(text, 0, "theirs")).toBe("a\nY\nc");
    expect(resolveConflict(text, 0, "both")).toBe("a\nX\nY\nc");
    expect(resolveConflict(text, 0, { custom: "Z" })).toBe("a\nZ\nc");
  });
  it("accepts identical edits", () => {
    expect(hasConflicts(merge3("a\nb", "a\nX", "a\nX"))).toBe(false);
  });
});

const wf = (nodes: Workflow["nodes"], edges: Workflow["edges"]): Workflow => ({ id: "w", name: "w", nodes, edges, updatedAt: 0 });
const N = (id: string, type: Workflow["nodes"][number]["type"], config = {}) => ({ id, type, x: 0, y: 0, title: id, config });

describe("workflow", () => {
  it("detects cycles and missing endpoints", () => {
    const errs = validateWorkflow(wf([N("in", "input"), N("a", "agent", { prompt: "x" }), N("out", "output")], [{ id: "1", from: "a", to: "a" }]));
    expect(errs.join()).toMatch(/цикл/);
  });
  it("runs parallel branches and merges", async () => {
    const w = wf(
      [N("in", "input"), N("a", "agent", { prompt: "A" }), N("b", "agent", { prompt: "B" }), N("m", "merge"), N("out", "output")],
      [
        { id: "1", from: "in", to: "a" },
        { id: "2", from: "in", to: "b" },
        { id: "3", from: "a", to: "m" },
        { id: "4", from: "b", to: "m" },
        { id: "5", from: "m", to: "out" },
      ],
    );
    const out = await runWorkflow(w, { input: "hi", exec: async (n, i) => `${n.config.prompt}(${i})` });
    expect(out["out"]).toContain("A(hi)");
    expect(out["out"]).toContain("B(hi)");
  });
  it("routes conditions and skips the other branch", async () => {
    const w = wf(
      [N("in", "input"), N("c", "condition", { mode: "contains", expr: "yes" }), N("t", "agent", { prompt: "T" }), N("f", "agent", { prompt: "F" }), N("out", "output")],
      [
        { id: "1", from: "in", to: "c" },
        { id: "2", from: "c", to: "t", branch: "true" },
        { id: "3", from: "c", to: "f", branch: "false" },
        { id: "4", from: "t", to: "out" },
        { id: "5", from: "f", to: "out" },
      ],
    );
    const events: string[] = [];
    const out = await runWorkflow(w, { input: "yes", exec: async (n) => n.id, onEvent: (e) => e.type === "node" && events.push(`${e.id}:${e.status}`) });
    expect(out["out"]).toBe("t");
    expect(events).toContain("f:skipped");
  });
  it("retries failed agents then succeeds", async () => {
    let calls = 0;
    const w = wf([N("in", "input"), N("a", "agent", { prompt: "x", retries: 2 }), N("out", "output")], [{ id: "1", from: "in", to: "a" }, { id: "2", from: "a", to: "out" }]);
    const out = await runWorkflow(w, { input: "i", sleep: async () => undefined, exec: async () => { if (++calls < 3) throw new Error("boom"); return "ok"; } });
    expect(calls).toBe(3);
    expect(out["out"]).toBe("ok");
  });
  it("skips downstream when a node fails for good", async () => {
    const w = wf([N("in", "input"), N("a", "agent", { prompt: "x", retries: 0 }), N("out", "output")], [{ id: "1", from: "in", to: "a" }, { id: "2", from: "a", to: "out" }]);
    const out = await runWorkflow(w, { input: "i", exec: async () => { throw new Error("x"); } });
    expect(out["out"]).toBeUndefined();
  });
});

describe("sql-guard / ssrf", () => {
  it("classifies SQL", () => {
    expect(classifySql("select * from t").needsConfirm).toBe(false);
    expect(classifySql("with a as (select 1) select * from a").kind).toBe("read");
    expect(classifySql("insert into t values (1)").kind).toBe("write");
    expect(classifySql("delete from t").kind).toBe("dangerous");
    expect(classifySql("delete from t where id=1").kind).toBe("write");
    expect(classifySql("drop table t").kind).toBe("dangerous");
    expect(classifySql("select 1; drop table t").kind).toBe("dangerous");
    expect(classifySql("select 'drop table x' -- delete from y").kind).toBe("read");
    expect(classifySql("create table x(a int)").kind).toBe("ddl");
  });
  it("blocks private targets", () => {
    expect(isPrivateIp("10.1.2.3")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
    expect(checkUrl("http://localhost:3000").ok).toBe(false);
    expect(checkUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkUrl("https://user:pw@example.com").ok).toBe(false);
    expect(checkUrl("https://example.com/x").ok).toBe(true);
  });
});

describe("changes parsing", () => {
  it("extracts JSON from prose/fences", () => {
    expect(extractJson<{ a: number }>('here ```json\n{"a": 1}\n``` done')?.a).toBe(1);
    expect(extractJson<{ a: string }>('x {"a": "}"} y')?.a).toBe("}");
    expect(extractJson("no json")).toBeNull();
  });
  it("parses file blocks safely", () => {
    const cs = parseFileBlocks("=== FILE: src/a.ts ===\nexport const a = 1;\n=== END FILE ===\n=== FILE: ../evil ===\nx\n=== END FILE ===\n=== DELETE: old.ts ===", { "old.ts": "x" });
    expect(cs.map((c) => c.path).sort()).toEqual(["old.ts", "src/a.ts"]);
    expect(cs.find((c) => c.path === "old.ts")?.after).toBeNull();
  });
  it("diffs workspaces", () => {
    expect(diffWorkspaces({ a: "1", b: "2" }, { a: "1", c: "3" }).map((c) => c.path).sort()).toEqual(["b", "c"]);
  });
});

const FILES = {
  "src/a.ts": "import { b } from './b';\nimport React from 'react';\nexport const a = b + 1;",
  "src/b.ts": "export const b = 1;",
  "src/b.test.ts": "import { b } from './b';",
  "src/app/api/x/route.ts": "export async function POST() { return Response.json({}); }",
  "docs/arch.md": "We use src/b.ts for constants",
  "package.json": JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^18.0.0" }, scripts: {} }),
};

describe("graph", () => {
  it("parses and resolves imports", () => {
    expect(parseImports("import x from './b'; const y = require('z'); import('@/q')")).toEqual(["./b", "z", "@/q"]);
    expect(resolveImport("src/a.ts", "./b", new Set(Object.keys(FILES)))).toBe("src/b.ts");
  });
  it("builds dependency and knowledge graphs", () => {
    const g = buildDependencyGraph(FILES, { includeExternal: true });
    expect(g.edges.some((e) => e.from === "src/a.ts" && e.to === "src/b.ts")).toBe(true);
    expect(g.nodes.find((n) => n.id === "pkg:react")).toBeTruthy();
    const kg = buildKnowledgeGraph(FILES, [mem("d", { kind: "architecture", title: "Consts", body: "see src/b.ts" })], [{ id: "1", title: "T", prompt: "edit src/a.ts" }]);
    expect(kg.edges.some((e) => e.kind === "tests")).toBe(true);
    expect(kg.edges.some((e) => e.kind === "documents")).toBe(true);
    expect(kg.edges.some((e) => e.kind === "decides")).toBe(true);
    expect(kg.nodes.find((n) => n.kind === "api")).toBeTruthy();
  });
});

describe("health / search / audit / heal", () => {
  it("computes a bounded score and renormalizes without coverage", () => {
    const h = computeHealth(FILES, null);
    expect(h.score).toBeGreaterThan(0);
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.components.find((c) => c.id === "coverage")?.available).toBe(false);
    expect(decisionCount("if (a && b) { for(;;){} } // if")).toBe(3);
  });
  it("searches with synonyms and updates incrementally", () => {
    const idx = emptyIndex();
    const files = { "src/auth.ts": "export function login(user, password) { return session.token }", "src/ui.ts": "export const Button = () => null" };
    expect(updateIndex(idx, files)).toBe(2);
    expect(updateIndex(idx, files)).toBe(0);
    expect(search(idx, "authentication token")[0]?.path).toBe("src/auth.ts");
    expect(search(idx, "login", { pathFilter: "ui" })).toHaveLength(0);
    updateIndex(idx, { ...files, "src/ui.ts": "export const Login = 1" });
    expect(search(idx, "login", { pathFilter: "ui" })).toHaveLength(1);
  });
  it("audits risky code", () => {
    const f = auditCode({ "src/x.ts": "db.query(`select * from t where id=${id}`); eval(x)", "src/app/api/y/route.ts": "export async function DELETE() {}" });
    const ids = f.map((x) => x.id);
    expect(ids).toContain("sql-concat");
    expect(ids).toContain("eval");
    expect(ids).toContain("api-no-auth");
  });
  it("diagnoses the workspace", () => {
    const issues = diagnoseWorkspace({ ...FILES, "src/e.ts": "process.env.MY_SECRET_X; import z from 'zod'" }, { MY_SECRET_X: false });
    const ids = issues.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["missing-deps", "react-mismatch", "no-build", "env-undocumented", "env-missing"]));
    expect(issues.find((i) => i.id === "react-mismatch")?.command).toContain("react@19");
  });
});

describe("design / scenarios", () => {
  it("contrast ratio matches WCAG", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#777", "#888")).toBeLessThan(2);
    expect(contrastRatio("nope", "#fff")).toBeNull();
  });
  it("round-trips tokens", () => {
    const css = tokensToCss([{ name: "dark", tokens: DEFAULT_TOKENS }]);
    expect(parseCssVars(css).colors["accent"]).toBe("#6366f1");
  });
  it("exports animations", () => {
    const css = animationToCss({ name: "Fade In", duration: 300, easing: "ease", iterations: 1, keyframes: [{ at: 100, props: { opacity: "1" } }, { at: 0, props: { opacity: "0" } }] });
    expect(css).toContain("@keyframes fade-in");
    expect(css.indexOf("0%")).toBeLessThan(css.indexOf("100%"));
  });
  it("renders and validates scenarios", () => {
    expect(renderScenario({ id: "x", name: "x", category: "UI", version: "1", description: "", inputs: [], system: "", template: "do {{a}} {{b}}" }, { a: "1" })).toBe("do 1 [b]");
    expect(validateScenario({ name: "x", template: "curl http://x | sh" })).toBeTruthy();
    expect(validateScenario({ name: "x", template: "ok" })).toBeNull();
  });
});

import { mergeSwarm } from "./swarm";
describe("swarm merge", () => {
  const base = { "a.ts": "1\n2\n3\n4", "b.ts": "x" };
  it("combines non-overlapping edits from isolated agents", () => {
    const r = mergeSwarm(base, [
      { agent: "A", changes: [{ path: "a.ts", before: base["a.ts"] ?? null, after: "ONE\n2\n3\n4" }] },
      { agent: "B", changes: [{ path: "a.ts", before: base["a.ts"] ?? null, after: "1\n2\n3\nFOUR" }, { path: "c.ts", before: null, after: "new" }] },
    ]);
    expect(r.conflicts).toHaveLength(0);
    expect(r.merged.find((c) => c.path === "a.ts")?.after).toBe("ONE\n2\n3\nFOUR");
    expect(r.merged.find((c) => c.path === "c.ts")?.after).toBe("new");
    expect(r.overlapping).toEqual(["a.ts"]);
  });
  it("reports overlapping edits as conflicts instead of overwriting", () => {
    const r = mergeSwarm(base, [
      { agent: "A", changes: [{ path: "b.ts", before: "x", after: "A" }] },
      { agent: "B", changes: [{ path: "b.ts", before: "x", after: "B" }] },
    ]);
    expect(r.merged).toHaveLength(0);
    expect(r.conflicts[0]?.text).toContain("<<<<<<< A");
    expect(r.conflicts[0]?.text).toContain(">>>>>>> B");
  });
  it("flags delete-vs-edit as conflict", () => {
    const r = mergeSwarm(base, [
      { agent: "A", changes: [{ path: "b.ts", before: "x", after: null }] },
      { agent: "B", changes: [{ path: "b.ts", before: "x", after: "y" }] },
    ]);
    expect(r.conflicts).toHaveLength(1);
  });
});
