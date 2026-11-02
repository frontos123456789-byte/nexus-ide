export type WfNodeType = "input" | "agent" | "condition" | "merge" | "output";

export interface WfNode {
  id: string;
  type: WfNodeType;
  x: number;
  y: number;
  title: string;
  config: {
    prompt?: string;
    agentId?: string;
    retries?: number;
    timeoutMs?: number;
    /** condition */
    mode?: "contains" | "regex" | "notEmpty";
    expr?: string;
  };
}

export interface WfEdge {
  id: string;
  from: string;
  to: string;
  /** For condition nodes: which branch this edge belongs to. */
  branch?: "true" | "false";
}

export interface Workflow {
  id: string;
  name: string;
  nodes: WfNode[];
  edges: WfEdge[];
  updatedAt: number;
}

export type WfEvent =
  | { type: "node"; id: string; status: "running" | "done" | "error" | "skipped" | "retry"; output?: string; error?: string; attempt?: number }
  | { type: "finish"; outputs: Record<string, string> };

export function validateWorkflow(wf: Workflow): string[] {
  const errs: string[] = [];
  const ids = new Set(wf.nodes.map((n) => n.id));
  if (!wf.nodes.some((n) => n.type === "input")) errs.push("Нужен узел «Вход»");
  if (!wf.nodes.some((n) => n.type === "output")) errs.push("Нужен узел «Выход»");
  for (const e of wf.edges) if (!ids.has(e.from) || !ids.has(e.to)) errs.push("Связь указывает на несуществующий узел");
  // cycle detection (Kahn)
  const indeg = new Map<string, number>(wf.nodes.map((n) => [n.id, 0]));
  for (const e of wf.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  const q = [...indeg.entries()].filter(([, d]) => d === 0).map(([id]) => id);
  let seen = 0;
  while (q.length) {
    const id = q.shift() as string;
    seen++;
    for (const e of wf.edges) {
      if (e.from !== id) continue;
      const d = (indeg.get(e.to) ?? 1) - 1;
      indeg.set(e.to, d);
      if (d === 0) q.push(e.to);
    }
  }
  if (seen !== wf.nodes.length) errs.push("В графе есть цикл — бесконечные циклы запрещены");
  for (const n of wf.nodes) {
    if (n.type === "agent" && !(n.config.prompt ?? "").trim()) errs.push(`Узел «${n.title}»: пустой промпт`);
    if (n.type === "condition" && n.config.mode !== "notEmpty" && !(n.config.expr ?? "").trim()) errs.push(`Узел «${n.title}»: пустое условие`);
  }
  return errs;
}

export function evalCondition(n: WfNode, input: string): boolean {
  const mode = n.config.mode ?? "notEmpty";
  if (mode === "notEmpty") return input.trim().length > 0;
  const expr = n.config.expr ?? "";
  if (mode === "contains") return input.toLowerCase().includes(expr.toLowerCase());
  try {
    return new RegExp(expr, "i").test(input);
  } catch {
    return false;
  }
}

export type NodeExecutor = (node: WfNode, input: string, signal: AbortSignal) => Promise<string>;

export interface RunOptions {
  input: string;
  exec: NodeExecutor;
  signal?: AbortSignal;
  onEvent?: (e: WfEvent) => void;
  maxNodes?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Runs the DAG: independent branches run in parallel, conditions route, failed nodes retry. */
export async function runWorkflow(wf: Workflow, opts: RunOptions): Promise<Record<string, string>> {
  const errs = validateWorkflow(wf);
  if (errs.length) throw new Error(errs.join("; "));
  if (wf.nodes.length > (opts.maxNodes ?? 40)) throw new Error("Слишком много узлов");
  const signal = opts.signal ?? new AbortController().signal;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const outputs: Record<string, string> = {};
  const state = new Map<string, "pending" | "running" | "done" | "skipped" | "error">(wf.nodes.map((n) => [n.id, "pending"]));
  // edges that are live (condition not rejecting them)
  const dead = new Set<string>();
  const incoming = (id: string) => wf.edges.filter((e) => e.to === id);
  const emit = (e: WfEvent) => opts.onEvent?.(e);

  const settled = (id: string) => ["done", "skipped", "error"].includes(state.get(id) ?? "");

  const runNode = async (n: WfNode): Promise<void> => {
    const live = incoming(n.id).filter((e) => !dead.has(e.id));
    const inputs = live.map((e) => outputs[e.from] ?? "").filter((s) => s !== "");
    const input = n.type === "input" ? opts.input : inputs.join("\n\n---\n\n");
    state.set(n.id, "running");
    emit({ type: "node", id: n.id, status: "running" });
    try {
      let out = input;
      if (n.type === "agent") {
        const retries = Math.min(n.config.retries ?? 1, 5);
        let attempt = 0;
        for (;;) {
          if (signal.aborted) throw new Error("Отменено");
          try {
            const ctl = new AbortController();
            const onAbort = () => ctl.abort();
            signal.addEventListener("abort", onAbort, { once: true });
            const timer = setTimeout(() => ctl.abort(), n.config.timeoutMs ?? 120_000);
            try {
              out = await opts.exec(n, input, ctl.signal);
            } finally {
              clearTimeout(timer);
              signal.removeEventListener("abort", onAbort);
            }
            break;
          } catch (err) {
            attempt++;
            if (attempt > retries || signal.aborted) throw err;
            emit({ type: "node", id: n.id, status: "retry", attempt, error: err instanceof Error ? err.message : String(err) });
            await sleep(500 * 2 ** attempt);
          }
        }
      } else if (n.type === "condition") {
        const ok = evalCondition(n, input);
        for (const e of wf.edges.filter((x) => x.from === n.id)) {
          if ((e.branch ?? "true") !== (ok ? "true" : "false")) dead.add(e.id);
        }
        out = input;
      }
      outputs[n.id] = out;
      state.set(n.id, "done");
      emit({ type: "node", id: n.id, status: "done", output: out });
    } catch (err) {
      state.set(n.id, "error");
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: "node", id: n.id, status: "error", error: msg });
      // downstream nodes are skipped
      for (const e of wf.edges.filter((x) => x.from === n.id)) dead.add(e.id);
    }
  };

  while (![...state.keys()].every(settled)) {
    if (signal.aborted) throw new Error("Отменено");
    const ready: WfNode[] = [];
    for (const n of wf.nodes) {
      if (state.get(n.id) !== "pending") continue;
      const inc = incoming(n.id);
      if (!inc.every((e) => settled(e.from))) continue;
      const live = inc.filter((e) => !dead.has(e.id) && state.get(e.from) === "done");
      if (n.type !== "input" && live.length === 0) {
        state.set(n.id, "skipped");
        emit({ type: "node", id: n.id, status: "skipped" });
        for (const e of wf.edges.filter((x) => x.from === n.id)) dead.add(e.id);
        continue;
      }
      ready.push(n);
    }
    if (ready.length === 0) {
      if ([...state.values()].some((s) => s === "pending")) {
        // nothing runnable but still pending => unreachable nodes
        for (const n of wf.nodes) if (state.get(n.id) === "pending") state.set(n.id, "skipped");
      }
      continue;
    }
    await Promise.all(ready.map(runNode));
  }
  emit({ type: "finish", outputs });
  return outputs;
}

export function emptyWorkflow(): Workflow {
  return {
    id: `wf_${Date.now().toString(36)}`,
    name: "Новый workflow",
    updatedAt: Date.now(),
    nodes: [
      { id: "in", type: "input", x: 40, y: 120, title: "Вход", config: {} },
      { id: "out", type: "output", x: 620, y: 120, title: "Выход", config: {} },
    ],
    edges: [],
  };
}
