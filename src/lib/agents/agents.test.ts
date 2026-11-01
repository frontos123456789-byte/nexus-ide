import { describe, expect, it } from "vitest";
import { renderContext, trimContext } from "./context";
import { buildFallbackSummary, runOrchestration, type LlmStream } from "./orchestrator";
import { defaultPlan, extractJson, parseFileBlocks, parsePlan, parseReview } from "./parse";
import { ARCHITECT_SYSTEM, CODER_SYSTEM, DIRECTOR_PLAN_SYSTEM, REVIEWER_SYSTEM, SUMMARY_SYSTEM } from "./prompts";
import type { AgentEvent } from "./types";
import { parseWork } from "./work";
import type { LlmEvent } from "@/lib/openrouter/types";

describe("extractJson", () => {
  it("parses raw, fenced, prose-wrapped and trailing-comma JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Here:\n```json\n{"a":2}\n```\nbye')).toEqual({ a: 2 });
    expect(extractJson('Sure! {"a":{"b":"}"}} thanks')).toEqual({ a: { b: "}" } });
    expect(extractJson('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
    expect(extractJson("no json at all")).toBeUndefined();
  });
});

describe("parsePlan", () => {
  const valid = JSON.stringify({
    summary: "Do it",
    tasks: [
      { id: "t1", agent: "architect", title: "Design", instruction: "design", dependsOn: [] },
      { id: "t2", agent: "coder", title: "A", instruction: "a", dependsOn: ["t1"], files: ["./src/a.ts"] },
      { id: "t3", agent: "coder", title: "B", instruction: "b", dependsOn: ["t1"], files: ["src/b.ts"] },
      { id: "t4", agent: "reviewer", title: "Review", instruction: "r", dependsOn: ["t2", "t3"] },
    ],
  });

  it("accepts a valid plan and normalizes file paths", () => {
    const plan = parsePlan(valid);
    expect(plan?.tasks).toHaveLength(4);
    expect(plan?.tasks[1].files).toEqual(["src/a.ts"]);
  });

  it("repairs missing dependencies (design first, review last)", () => {
    const plan = parsePlan(
      JSON.stringify({
        tasks: [
          { id: "a", agent: "coder", title: "c" },
          { id: "b", agent: "architect", title: "arch" },
          { id: "c", agent: "reviewer", title: "rev" },
        ],
      }),
    );
    expect(plan?.tasks.find((t) => t.id === "a")?.dependsOn).toEqual(["b"]);
    expect(plan?.tasks.find((t) => t.id === "c")?.dependsOn).toEqual(["a"]);
  });

  it("rejects cycles, plans without coders, unknown roles and garbage", () => {
    expect(
      parsePlan(
        JSON.stringify({
          tasks: [
            { id: "a", agent: "coder", title: "a", dependsOn: ["b"] },
            { id: "b", agent: "coder", title: "b", dependsOn: ["a"] },
          ],
        }),
      ),
    ).toBeNull();
    expect(parsePlan(JSON.stringify({ tasks: [{ id: "a", agent: "architect", title: "x" }] }))).toBeNull();
    expect(parsePlan(JSON.stringify({ tasks: [{ id: "a", agent: "wizard", title: "x" }] }))).toBeNull();
    expect(parsePlan("lol")).toBeNull();
  });

  it("caps the number of tasks", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, agent: "coder", title: `c${i}` }));
    expect(parsePlan(JSON.stringify({ tasks }))?.tasks.length).toBe(6);
  });

  it("builds a valid default plan", () => {
    const plan = defaultPlan("make it");
    expect(plan.tasks.map((t) => t.agent)).toEqual(["architect", "coder", "reviewer"]);
  });
});

describe("parseFileBlocks", () => {
  it("parses tags and strips code fences", () => {
    const text = `Intro\n<file path="src/a.ts">\nexport const a = 1;\n</file>\n<file path='b.md'>\n\`\`\`md\n# hi\n\`\`\`\n</file>`;
    expect(parseFileBlocks(text)).toEqual([
      { path: "src/a.ts", content: "export const a = 1;\n" },
      { path: "b.md", content: "# hi\n" },
    ]);
  });

  it("rejects path traversal and ignores unclosed blocks", () => {
    const text = `<file path="../secret.ts">x</file><file path="ok.ts">y</file><file path="cut.ts">partial`;
    expect(parseFileBlocks(text).map((b) => b.path)).toEqual(["ok.ts"]);
  });

  it("dedupes by path (last wins) and supports the fenced fallback", () => {
    expect(parseFileBlocks(`<file path="a.ts">1</file><file path="a.ts">2</file>`)).toEqual([
      { path: "a.ts", content: "2\n" },
    ]);
    const fenced = "```ts src/util.ts\nexport const x = 1;\n```";
    expect(parseFileBlocks(fenced)).toEqual([{ path: "src/util.ts", content: "export const x = 1;\n" }]);
  });
});

describe("parseReview", () => {
  it("parses a structured review", () => {
    const r = parseReview(
      '{"verdict":"changes","summary":"s","issues":[{"severity":"error","file":"a.ts","message":"bug"},{"message":"nit"},{"severity":"x"}]}',
    );
    expect(r.verdict).toBe("changes");
    expect(r.issues).toEqual([
      { severity: "error", file: "a.ts", message: "bug" },
      { severity: "info", file: undefined, message: "nit" },
    ]);
  });
  it("falls back to raw text", () => {
    expect(parseReview("looks fine to me")).toMatchObject({ verdict: "unknown", summary: "looks fine to me" });
  });
});

describe("parseWork", () => {
  it("parses a complete response", () => {
    const w = parseWork(
      "<thinking>\nStep A\nStep B\n</thinking>\n<plan>\ngoal: Ship it\n1. Design API | Define routes | S\n2. **Implement** | Write code | L\n3. Test\n</plan>",
    );
    expect(w.thinking).toBe("Step A\nStep B");
    expect(w.thinkingClosed).toBe(true);
    expect(w.planClosed).toBe(true);
    expect(w.goal).toBe("Ship it");
    expect(w.steps).toEqual([
      { title: "Design API", detail: "Define routes", size: "S" },
      { title: "Implement", detail: "Write code", size: "L" },
      { title: "Test", detail: "", size: "M" },
    ]);
  });

  it("tolerates partially streamed output", () => {
    const w = parseWork("<thinking>Thinking about it");
    expect(w.thinkingClosed).toBe(false);
    expect(w.thinking).toBe("Thinking about it");
    expect(w.steps).toEqual([]);
    const w2 = parseWork("<thinking>x</thinking><plan>\n1. First | do | S\n2. Seco");
    expect(w2.planClosed).toBe(false);
    expect(w2.steps.map((s) => s.title)).toEqual(["First", "Seco"]);
  });

  it("falls back to plain numbered lists", () => {
    const w = parseWork("Here you go:\n1. Alpha\n2. Beta\nbye");
    expect(w.steps.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
  });
});

describe("context", () => {
  it("puts the active file first and enforces the budget", () => {
    const ctx = trimContext(
      {
        tree: ["a", "b"],
        files: [
          { path: "b", content: "x".repeat(30_000) },
          { path: "a", content: "y".repeat(100) },
        ],
        activePath: "a",
      },
      { maxTotalChars: 5000, maxFileChars: 4000, maxTreeEntries: 1 },
    );
    expect(ctx.tree).toEqual(["a"]);
    expect(ctx.files[0].path).toBe("a");
    expect(ctx.files.reduce((n, f) => n + f.content.length, 0)).toBeLessThan(5100);
    expect(renderContext(ctx)).toContain("(активный файл)");
  });
});

/* ------------------------------ orchestrator ------------------------------ */

function fakeStream(handler: (system: string, user: string) => Promise<string> | string): LlmStream {
  return async function* (messages) {
    const system = messages[0].content;
    const user = messages[messages.length - 1].content;
    yield { type: "attempt", model: "test/model:free", label: "Test", index: 0, total: 1 } satisfies LlmEvent;
    const text = await handler(system, user);
    for (let i = 0; i < text.length; i += 40) yield { type: "delta", content: text.slice(i, i + 40) };
    yield { type: "done", model: "test/model:free", label: "Test", attempts: 1 };
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PLAN_JSON = JSON.stringify({
  summary: "Add math helpers",
  tasks: [
    { id: "t1", agent: "architect", title: "Design", instruction: "design", dependsOn: [] },
    { id: "t2", agent: "coder", title: "Coder A", instruction: "a", dependsOn: ["t1"], files: ["src/a.ts"] },
    { id: "t3", agent: "coder", title: "Coder B", instruction: "b", dependsOn: ["t1"], files: ["src/b.ts"] },
    { id: "t4", agent: "reviewer", title: "Review", instruction: "r", dependsOn: ["t2", "t3"] },
  ],
});

async function run(stream: LlmStream, extra: { signal?: AbortSignal } = {}) {
  const events: AgentEvent[] = [];
  await runOrchestration({
    task: "Add helpers",
    context: { tree: ["src/index.ts"], files: [] },
    stream,
    emit: (e) => events.push(e),
    signal: extra.signal ?? new AbortController().signal,
  });
  return events;
}

describe("runOrchestration", () => {
  it("runs the full pipeline with PARALLEL coders and respects dependencies", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const stream = fakeStream(async (system, user) => {
      if (system === DIRECTOR_PLAN_SYSTEM) return PLAN_JSON;
      if (system === ARCHITECT_SYSTEM) {
        order.push("architect");
        return "## Design";
      }
      if (system === CODER_SYSTEM) {
        order.push("coder-start");
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(60);
        active--;
        order.push("coder-end");
        const file = user.includes("src/a.ts") ? "src/a.ts" : "src/b.ts";
        return `<file path="${file}">\nexport const v = 1;\n</file>`;
      }
      if (system === REVIEWER_SYSTEM) {
        order.push("reviewer");
        return '{"verdict":"approve","summary":"good","issues":[]}';
      }
      if (system === SUMMARY_SYSTEM) return "All done.";
      return "";
    });

    const events = await run(stream);
    expect(maxActive).toBe(2);
    expect(order[0]).toBe("architect");
    expect(order.indexOf("reviewer")).toBeGreaterThan(order.lastIndexOf("coder-end"));

    const proposals = events.filter((e) => e.type === "proposal");
    expect(proposals).toHaveLength(2);
    expect(events.find((e) => e.type === "review")).toMatchObject({ review: { verdict: "approve" } });
    expect(events.find((e) => e.type === "plan")).toMatchObject({ fallback: false });
    expect(events.find((e) => e.type === "summary")).toMatchObject({ content: "All done." });
    expect(events.at(-1)).toMatchObject({ type: "done", stats: { agents: 5, failed: 0, files: 2 } });

    const statusOf = (id: string) =>
      events.filter((e): e is Extract<AgentEvent, { type: "agent" }> => e.type === "agent" && e.id === id).map((e) => e.status);
    expect(statusOf("t2")).toContain("queued");
    expect(statusOf("t2").at(-1)).toBe("done");
    expect(statusOf("director").at(-1)).toBe("done");
  });

  it("uses a fallback plan when Director returns garbage", async () => {
    const stream = fakeStream((system) => {
      if (system === DIRECTOR_PLAN_SYSTEM) return "I refuse to output JSON";
      if (system === ARCHITECT_SYSTEM) return "design";
      if (system === CODER_SYSTEM) return '<file path="x.ts">1</file>';
      if (system === REVIEWER_SYSTEM) return "not json";
      return "summary text";
    });
    const events = await run(stream);
    expect(events.find((e) => e.type === "plan")).toMatchObject({ fallback: true });
    expect(events.at(-1)).toMatchObject({ type: "done", stats: { failed: 0, files: 1 } });
  });

  it("marks a coder without <file> blocks as failed, skips the reviewer when all coders fail and builds a fallback summary", async () => {
    const stream: LlmStream = async function* (messages) {
      const system = messages[0].content;
      if (system === SUMMARY_SYSTEM) {
        yield { type: "error", kind: "exhausted", message: "down", failures: [] };
        return;
      }
      yield { type: "attempt", model: "m", label: "M", index: 0, total: 1 };
      const text =
        system === DIRECTOR_PLAN_SYSTEM
          ? JSON.stringify({
              tasks: [
                { id: "c1", agent: "coder", title: "Coder", instruction: "x" },
                { id: "r1", agent: "reviewer", title: "Rev", instruction: "y", dependsOn: ["c1"] },
              ],
            })
          : "I only talk, no files";
      yield { type: "delta", content: text };
      yield { type: "done", model: "m", label: "M", attempts: 1 };
    };
    const events = await run(stream);
    const last = (id: string) =>
      events.filter((e): e is Extract<AgentEvent, { type: "agent" }> => e.type === "agent" && e.id === id).at(-1);
    expect(last("c1")?.status).toBe("error");
    expect(last("r1")?.status).toBe("skipped");
    const summary = events.find((e): e is Extract<AgentEvent, { type: "summary" }> => e.type === "summary");
    expect(summary?.content).toContain("Сбои");
    expect(events.at(-1)).toMatchObject({ type: "done" });
  });

  it("emits a terminal error when the Director cannot reach any model", async () => {
    const stream: LlmStream = async function* () {
      yield { type: "error", kind: "daily_limit", message: "limit", failures: [] };
    };
    const events = await run(stream);
    expect(events.at(-1)).toMatchObject({ type: "error", message: "limit" });
    expect(events.some((e) => e.type === "done")).toBe(false);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    const stream = fakeStream(async (system) => {
      if (system === DIRECTOR_PLAN_SYSTEM) return PLAN_JSON;
      ac.abort();
      return "x";
    });
    const events = await run(stream, { signal: ac.signal });
    expect(events.at(-1)).toMatchObject({ type: "error" });
  });

  it("forwards switch/reset events to the agent card", async () => {
    const stream: LlmStream = async function* (messages) {
      const system = messages[0].content;
      yield { type: "attempt", model: "a", label: "A", index: 0, total: 2 };
      if (system === DIRECTOR_PLAN_SYSTEM) {
        yield { type: "delta", content: "partial" };
        yield { type: "reset", model: "a", reason: "midstream" };
        yield {
          type: "switch",
          from: "a",
          fromLabel: "A",
          to: "b",
          toLabel: "B",
          reason: "midstream",
          detail: "",
          message: "Переключение на B…",
        };
        yield { type: "attempt", model: "b", label: "B", index: 1, total: 2 };
        yield { type: "delta", content: "{}" };
      } else yield { type: "delta", content: '<file path="a.ts">1</file>' };
      yield { type: "done", model: "b", label: "B", attempts: 2 };
    };
    const events = await run(stream);
    expect(events.some((e) => e.type === "agent_reset" && e.id === "director")).toBe(true);
    expect(events.some((e) => e.type === "agent_switch" && e.message.includes("B"))).toBe(true);
  });
});

describe("buildFallbackSummary", () => {
  it("lists files and verdict", () => {
    const text = buildFallbackSummary(
      { summary: "S", tasks: [] },
      [],
      [{ path: "a.ts", content: "", action: "create" }],
      { verdict: "approve", summary: "ok", issues: [] },
    );
    expect(text).toContain("`a.ts`");
    expect(text).toContain("одобрено");
  });
});
