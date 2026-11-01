import { toast } from "sonner";
import { pickContextFiles, type ProjectContext } from "@/lib/agents/context";
import { parseWork } from "@/lib/agents/work";
import type { AgentEvent } from "@/lib/agents/types";
import type { LlmEvent } from "@/lib/openrouter/types";
import { createBatcher, HttpError, postEventStream } from "@/lib/utils/sse-client";
import { playSound } from "@/lib/utils/sound";
import { formatDuration, uid } from "@/lib/utils/format";
import { useAgentStore, type AgentView, type CodeRun, type ProposalView, type UiMessage, type WorkSession } from "./agent";
import { useIdeStore, type AgentMode } from "./ide";

const controllers: Partial<Record<AgentMode, AbortController>> = {};
const MAX_AGENT_OUTPUT = 60_000;

const ide = () => useIdeStore.getState();
const agent = () => useAgentStore.getState();

export function buildContext(): ProjectContext | undefined {
  if (!agent().includeContext) return undefined;
  const s = ide();
  return pickContextFiles(s.contents, s.activePath ?? undefined, s.openTabs);
}

export function isAborted(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function describeError(err: unknown): string {
  if (err instanceof HttpError) return err.message;
  if (err instanceof TypeError) return "Нет соединения с сервером. Проверьте сеть и повторите.";
  return err instanceof Error ? err.message : "Неизвестная ошибка";
}

export function stopAgent(mode: AgentMode): void {
  controllers[mode]?.abort();
}

function startController(mode: AgentMode): AbortController {
  controllers[mode]?.abort();
  const c = new AbortController();
  controllers[mode] = c;
  agent().setBusy(mode, true);
  return c;
}

function endController(mode: AgentMode, c: AbortController): void {
  if (controllers[mode] === c) {
    delete controllers[mode];
    agent().setBusy(mode, false);
  }
}

/* --------------------------- shared LLM streaming --------------------------- */

interface LlmStreamHandlers {
  onText: (text: string) => void;
  onReasoning: (text: string) => void;
  onReset: () => void;
  onModel: (id: string, label: string) => void;
  onNotice: (message: string) => void;
}

interface LlmStreamResult {
  ok: boolean;
  aborted: boolean;
  error?: string;
  model?: string;
  label?: string;
}

async function consumeLlmStream(
  url: string,
  body: unknown,
  signal: AbortSignal,
  h: LlmStreamHandlers,
  source: string,
): Promise<LlmStreamResult> {
  const text = createBatcher(h.onText);
  const reasoning = createBatcher(h.onReasoning);
  let model: string | undefined;
  let label: string | undefined;
  let started = false;
  const t0 = Date.now();
  ide().setAi({ state: "connecting", message: "Подключение к OpenRouter…" });

  try {
    for await (const e of postEventStream<LlmEvent>(url, body, signal)) {
      switch (e.type) {
        case "attempt":
          model = e.model;
          label = e.label;
          h.onModel(e.model, e.label);
          ide().setAi({
            state: e.index === 0 && !started ? "connecting" : "switching",
            model: e.model,
            modelLabel: e.label,
            message: `Подключение к ${e.label}…`,
          });
          ide().log("ai", source, `→ ${e.label} (${e.model}) [${e.index + 1}/${e.total}]`);
          break;
        case "switch":
          h.onNotice(e.message);
          ide().setAi({ state: "switching", message: e.message });
          ide().log("warn", source, `${e.message} — ${e.detail}`);
          playSound("switch");
          break;
        case "retry":
          h.onNotice(e.message);
          ide().setAi({ state: "switching", message: e.message });
          ide().log("warn", source, e.message);
          break;
        case "reset":
          text.discard();
          reasoning.discard();
          h.onReset();
          ide().log("warn", source, `Частичный ответ от ${e.model} отброшен (${e.reason})`);
          break;
        case "reasoning":
          if (!started) ide().setAi({ state: "streaming", message: "Модель размышляет…" });
          reasoning.push(e.content);
          break;
        case "delta":
          if (!started) {
            started = true;
            ide().setAi({ state: "streaming", message: `Ответ от ${label ?? "модели"}` });
          }
          text.push(e.content);
          break;
        case "done":
          text.flush();
          reasoning.flush();
          ide().setAi({ state: "idle", model: e.model, modelLabel: e.label, message: null });
          ide().log(
            "success",
            source,
            `Ответ получен от ${e.label} за ${formatDuration(Date.now() - t0)}${e.attempts > 1 ? ` (попыток: ${e.attempts})` : ""}`,
          );
          return { ok: true, aborted: false, model: e.model, label: e.label };
        case "error":
          text.flush();
          reasoning.flush();
          ide().setAi({ state: "error", message: e.message });
          ide().log("error", source, e.message);
          return { ok: false, aborted: e.kind === "aborted", error: e.message, model, label };
      }
    }
    text.flush();
    reasoning.flush();
    ide().setAi({ state: "idle", message: null });
    return { ok: !!model, aborted: false, model, label, error: model ? undefined : "Поток завершился без ответа" };
  } catch (err) {
    text.flush();
    reasoning.flush();
    if (isAborted(err)) {
      ide().setAi({ state: "idle", message: null });
      ide().log("warn", source, "Запрос остановлен пользователем");
      return { ok: false, aborted: true, model, label };
    }
    const message = describeError(err);
    ide().setAi({ state: "error", message });
    ide().log("error", source, message);
    return { ok: false, aborted: false, error: message, model, label };
  }
}

/* ----------------------------------- chat ----------------------------------- */

export async function sendChat(prompt: string): Promise<void> {
  const text = prompt.trim();
  if (!text || agent().busy.chat) return;

  const store = agent();
  const history = store.messages
    .filter((m) => m.status === "done" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));

  const userMsg: UiMessage = {
    id: uid("m"),
    role: "user",
    content: text,
    reasoning: "",
    status: "done",
    notices: [],
    createdAt: Date.now(),
  };
  const botId = uid("m");
  const botMsg: UiMessage = {
    id: botId,
    role: "assistant",
    content: "",
    reasoning: "",
    status: "streaming",
    notices: [],
    createdAt: Date.now(),
  };
  store.addMessage(userMsg);
  store.addMessage(botMsg);
  playSound("send");

  const controller = startController("chat");
  const result = await consumeLlmStream(
    "/api/chat",
    { mode: "chat", messages: [...history, { role: "user", content: text }], context: buildContext() },
    controller.signal,
    {
      onText: (t) => agent().patchMessage(botId, (m) => ({ ...m, content: m.content + t })),
      onReasoning: (t) => agent().patchMessage(botId, (m) => ({ ...m, reasoning: m.reasoning + t })),
      onReset: () => agent().patchMessage(botId, (m) => ({ ...m, content: "", reasoning: "" })),
      onModel: (id, label) => agent().patchMessage(botId, (m) => ({ ...m, model: id, modelLabel: label })),
      onNotice: (n) => agent().patchMessage(botId, (m) => ({ ...m, notices: [...m.notices, n] })),
    },
    "chat",
  );
  endController("chat", controller);

  agent().patchMessage(botId, (m) => ({
    ...m,
    model: result.model ?? m.model,
    modelLabel: result.label ?? m.modelLabel,
    status: result.ok || (result.aborted && m.content) ? "done" : "error",
    error: result.ok ? undefined : result.aborted ? (m.content ? undefined : "Остановлено") : result.error,
    notices: result.aborted ? [...m.notices, "Генерация остановлена"] : m.notices,
  }));
  if (result.ok) playSound("done");
  else if (!result.aborted) {
    playSound("error");
    toast.error("Не удалось получить ответ", { description: result.error });
  }
}

/** Removes the last assistant message and re-asks the last user prompt. */
export async function regenerateChat(): Promise<void> {
  const msgs = agent().messages;
  let lastUser = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  if (lastUser === -1) return;
  const prompt = msgs[lastUser].content;
  useAgentStore.setState({ messages: msgs.slice(0, lastUser) });
  await sendChat(prompt);
}

/* ----------------------------------- work ----------------------------------- */

export async function startWork(goal: string): Promise<void> {
  const text = goal.trim();
  if (!text || agent().busy.work) return;

  const session: WorkSession = {
    id: uid("w"),
    goal: text,
    createdAt: Date.now(),
    raw: "",
    reasoning: "",
    planGoal: "",
    steps: [],
    phase: "planning",
    notices: [],
  };
  agent().addSession(session);
  playSound("send");

  const controller = startController("work");
  const result = await consumeLlmStream(
    "/api/chat",
    { mode: "work", messages: [{ role: "user", content: text }], context: buildContext() },
    controller.signal,
    {
      onText: (t) => agent().patchSession(session.id, (s) => ({ ...s, raw: s.raw + t })),
      onReasoning: (t) => agent().patchSession(session.id, (s) => ({ ...s, reasoning: s.reasoning + t })),
      onReset: () => agent().patchSession(session.id, (s) => ({ ...s, raw: "", reasoning: "" })),
      onModel: (id, label) => agent().patchSession(session.id, (s) => ({ ...s, model: id, modelLabel: label })),
      onNotice: (n) => agent().patchSession(session.id, (s) => ({ ...s, notices: [...s.notices, n] })),
    },
    "work",
  );
  endController("work", controller);

  agent().patchSession(session.id, (s) => {
    if (!result.ok && !s.raw) {
      return { ...s, phase: "error", error: result.aborted ? "Остановлено" : result.error };
    }
    const parsed = parseWork(s.raw);
    if (parsed.steps.length === 0) {
      return { ...s, phase: "error", error: "Модель не вернула план в ожидаемом формате. Попробуйте переформулировать цель." };
    }
    return {
      ...s,
      phase: "ready",
      planGoal: parsed.goal || s.goal,
      steps: parsed.steps.map((st) => ({
        id: uid("s"),
        title: st.title,
        detail: st.detail,
        size: st.size,
        status: "todo" as const,
        result: "",
      })),
    };
  });
  if (result.ok) {
    playSound("done");
  } else if (!result.aborted) {
    playSound("error");
    toast.error("Не удалось построить план", { description: result.error });
  }
}

function stepPrompt(session: WorkSession, stepIndex: number): string {
  const plan = session.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? ` — ${s.detail}` : ""}`).join("\n");
  const done = session.steps
    .slice(0, stepIndex)
    .filter((s) => s.status === "done" && s.result)
    .map((s, i) => `Шаг ${i + 1} (${s.title}) — результат:\n${s.result.slice(0, 1200)}`)
    .join("\n\n");
  const step = session.steps[stepIndex];
  return [
    `Цель: ${session.planGoal || session.goal}`,
    `План:\n${plan}`,
    done ? `Уже выполнено:\n${done}` : "",
    `Выполни шаг ${stepIndex + 1}: ${step.title}${step.detail ? ` — ${step.detail}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function executeStep(sessionId: string, stepId: string): Promise<boolean> {
  if (agent().busy.work) return false;
  const session = agent().sessions.find((s) => s.id === sessionId);
  const idx = session?.steps.findIndex((s) => s.id === stepId) ?? -1;
  if (!session || idx === -1) return false;

  const patchStep = (fn: (s: WorkSession["steps"][number]) => WorkSession["steps"][number]) =>
    agent().patchSession(sessionId, (s) => ({ ...s, steps: s.steps.map((st) => (st.id === stepId ? fn(st) : st)) }));

  patchStep((st) => ({ ...st, status: "running", result: "", error: undefined }));
  const controller = startController("work");
  const result = await consumeLlmStream(
    "/api/chat",
    { mode: "work-step", messages: [{ role: "user", content: stepPrompt(session, idx) }], context: buildContext() },
    controller.signal,
    {
      onText: (t) => patchStep((st) => ({ ...st, result: st.result + t })),
      onReasoning: () => undefined,
      onReset: () => patchStep((st) => ({ ...st, result: "" })),
      onModel: () => undefined,
      onNotice: () => undefined,
    },
    "work",
  );
  endController("work", controller);

  patchStep((st) => ({
    ...st,
    status: result.ok ? "done" : "error",
    error: result.ok ? undefined : result.aborted ? "Остановлено" : result.error,
  }));
  if (result.ok) playSound("done");
  else if (!result.aborted) playSound("error");
  return result.ok;
}

export async function runAllSteps(sessionId: string): Promise<void> {
  for (;;) {
    const session = useAgentStore.getState().sessions.find((s) => s.id === sessionId);
    const next = session?.steps.find((s) => s.status === "todo" || s.status === "error");
    if (!session || !next) break;
    const ok = await executeStep(sessionId, next.id);
    if (!ok) break;
  }
  const finished = useAgentStore.getState().sessions.find((s) => s.id === sessionId);
  if (finished && finished.steps.length && finished.steps.every((s) => s.status === "done")) {
    toast.success("План выполнен", { description: `${finished.steps.length} шагов завершено` });
  }
}

export function toggleStepDone(sessionId: string, stepId: string): void {
  agent().patchSession(sessionId, (s) => ({
    ...s,
    steps: s.steps.map((st) =>
      st.id === stepId && st.status !== "running" ? { ...st, status: st.status === "done" ? "todo" : "done" } : st,
    ),
  }));
}

/* ----------------------------------- code ----------------------------------- */

export async function startCodeRun(task: string): Promise<void> {
  const text = task.trim();
  if (!text || agent().busy.code) return;

  const runId = uid("r");
  const run: CodeRun = {
    id: runId,
    task: text,
    createdAt: Date.now(),
    status: "running",
    planSummary: "",
    planFallback: false,
    agents: {},
    order: [],
    proposals: [],
    reviews: [],
    summary: "",
    summaryStreaming: false,
  };
  agent().addRun(run);
  playSound("send");
  ide().log("ai", "code", `Запуск оркестрации: «${text.slice(0, 80)}»`);

  const controller = startController("code");
  const patchRun = (fn: (r: CodeRun) => CodeRun) => agent().patchRun(runId, fn);
  const upsertAgent = (id: string, fn: (a: AgentView | undefined) => AgentView) =>
    patchRun((r) => ({
      ...r,
      agents: { ...r.agents, [id]: fn(r.agents[id]) },
      order: r.order.includes(id) ? r.order : [...r.order, id],
    }));

  const patchAgent = (id: string, fn: (a: AgentView) => AgentView) =>
    patchRun((r) => (r.agents[id] ? { ...r, agents: { ...r.agents, [id]: fn(r.agents[id]) } } : r));

  // Deltas from several parallel agents are merged and flushed together.
  let pending: Record<string, string> = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flushDeltas = () => {
    timer = null;
    const batch = pending;
    pending = {};
    if (Object.keys(batch).length === 0) return;
    patchRun((r) => {
      const agents = { ...r.agents };
      for (const [id, chunk] of Object.entries(batch)) {
        const a = agents[id];
        if (!a) continue;
        const output = (a.output + chunk).slice(-MAX_AGENT_OUTPUT);
        agents[id] = { ...a, output };
      }
      return { ...r, agents };
    });
  };
  const queueDelta = (id: string, content: string) => {
    pending[id] = (pending[id] ?? "") + content;
    if (!timer) timer = setTimeout(flushDeltas, 60);
  };

  let summaryBuf = "";
  let summaryTimer: ReturnType<typeof setTimeout> | null = null;
  const flushSummary = () => {
    summaryTimer = null;
    const chunk = summaryBuf;
    summaryBuf = "";
    if (chunk) patchRun((r) => ({ ...r, summary: r.summary + chunk, summaryStreaming: true }));
  };

  let finished = false;
  let failed: string | null = null;

  const handle = (e: AgentEvent) => {
    switch (e.type) {
      case "plan":
        patchRun((r) => ({ ...r, planSummary: e.plan.summary, planFallback: e.fallback }));
        ide().log(
          "ai",
          "code",
          `План Director: ${e.plan.tasks.map((t) => `${t.agent}:${t.title}`).join(" → ")}${e.fallback ? " (резервный план)" : ""}`,
        );
        break;
      case "agent":
        upsertAgent(e.id, (prev) => {
          const now = Date.now();
          const startedAt = prev?.startedAt ?? (e.status === "running" ? now : undefined);
          const finishedAt = e.status === "done" || e.status === "error" || e.status === "skipped" ? now : undefined;
          return {
            id: e.id,
            role: e.role,
            title: e.title,
            status: e.status,
            dependsOn: e.dependsOn ?? prev?.dependsOn ?? [],
            model: e.model ?? prev?.model,
            modelLabel: e.modelLabel ?? prev?.modelLabel,
            output: e.id === "director" && e.status === "running" && prev?.status === "done" ? "" : (prev?.output ?? ""),
            notices: prev?.notices ?? [],
            startedAt: e.status === "running" && prev?.status === "done" ? now : startedAt,
            finishedAt,
            error: e.error ?? (e.status === "done" ? undefined : prev?.error),
          };
        });
        if (e.status === "running" && e.model) {
          ide().setAi({ state: "streaming", model: e.model, modelLabel: e.modelLabel ?? null, message: `${e.title}: ${e.modelLabel ?? e.model}` });
        }
        if (e.status === "done" || e.status === "error") {
          ide().log(e.status === "done" ? "success" : "error", "code", `${e.role}/${e.title}: ${e.status === "done" ? "готово" : (e.error ?? "ошибка")}${e.modelLabel ? ` [${e.modelLabel}]` : ""}`);
        }
        break;
      case "agent_delta":
        queueDelta(e.id, e.content);
        break;
      case "agent_reset":
        pending[e.id] = "";
        patchAgent(e.id, (a) => ({ ...a, output: "" }));
        break;
      case "agent_switch":
        patchAgent(e.id, (a) => ({ ...a, notices: [...a.notices, e.message] }));
        ide().setAi({ state: "switching", message: e.message });
        ide().log("warn", "code", `[${e.id}] ${e.message}`);
        playSound("switch");
        break;
      case "proposal": {
        const contents = ide().contents;
        const views: ProposalView[] = e.files.map((f) => ({
          ...f,
          id: `${runId}:${f.path}`,
          agentId: e.id,
          original: contents[f.path] ?? null,
          action: f.path in contents ? "modify" : "create",
          status: "pending",
        }));
        patchRun((r) => ({
          ...r,
          proposals: [...r.proposals.filter((p) => !views.some((v) => v.path === p.path)), ...views],
        }));
        ide().log("ai", "code", `Предложено файлов: ${views.map((v) => v.path).join(", ")}`);
        break;
      }
      case "review":
        patchRun((r) => ({ ...r, reviews: [...r.reviews, { agentId: e.id, review: e.review }] }));
        break;
      case "summary_delta":
        if (e.reset) {
          summaryBuf = "";
          patchRun((r) => ({ ...r, summary: "" }));
        } else {
          summaryBuf += e.content;
          if (!summaryTimer) summaryTimer = setTimeout(flushSummary, 60);
        }
        break;
      case "summary":
        if (summaryTimer) clearTimeout(summaryTimer);
        summaryBuf = "";
        patchRun((r) => ({ ...r, summary: e.content, summaryStreaming: false }));
        break;
      case "done":
        finished = true;
        patchRun((r) => ({ ...r, status: "done", durationMs: e.durationMs, stats: e.stats, summaryStreaming: false }));
        ide().log("success", "code", `Оркестрация завершена за ${formatDuration(e.durationMs)} · файлов: ${e.stats.files} · сбоев: ${e.stats.failed}`);
        break;
      case "error":
        failed = e.message;
        break;
    }
  };

  try {
    for await (const e of postEventStream<AgentEvent>("/api/agents", { task: text, context: buildContext() }, controller.signal)) {
      handle(e);
    }
  } catch (err) {
    if (!isAborted(err)) failed = describeError(err);
    else failed = failed ?? "__aborted__";
  }

  if (timer) clearTimeout(timer);
  flushDeltas();
  if (summaryTimer) clearTimeout(summaryTimer);
  flushSummary();
  endController("code", controller);

  if (failed === "__aborted__") {
    patchRun((r) => ({ ...r, status: "cancelled", summaryStreaming: false, agents: settleAgents(r.agents, "Остановлено") }));
    ide().log("warn", "code", "Оркестрация остановлена пользователем");
    ide().setAi({ state: "idle", message: null });
  } else if (failed && !finished) {
    const message = failed;
    patchRun((r) => ({ ...r, status: "error", error: message, summaryStreaming: false, agents: settleAgents(r.agents, message) }));
    ide().log("error", "code", message);
    ide().setAi({ state: "error", message });
    playSound("error");
    toast.error("Code-режим завершился с ошибкой", { description: message });
  } else if (finished) {
    ide().setAi({ state: "idle", message: null });
    const r = useAgentStore.getState().runs.find((x) => x.id === runId);
    playSound("done");
    toast.success("Оркестрация завершена", {
      description: r?.stats ? `Предложено файлов: ${r.stats.files}` : undefined,
    });
  } else {
    patchRun((r) => ({ ...r, status: "error", error: "Поток завершился неожиданно", agents: settleAgents(r.agents, "Поток оборван") }));
  }
}

function settleAgents(agents: Record<string, AgentView>, reason: string): Record<string, AgentView> {
  return Object.fromEntries(
    Object.entries(agents).map(([id, a]) => [
      id,
      a.status === "running" || a.status === "queued"
        ? { ...a, status: "error" as const, error: reason, finishedAt: Date.now() }
        : a,
    ]),
  );
}

export async function applyProposal(runId: string, path: string): Promise<boolean> {
  const run = agent().runs.find((r) => r.id === runId);
  const p = run?.proposals.find((x) => x.path === path);
  if (!run || !p) return false;
  try {
    await ide().upsertFile(p.path, p.content, true);
    agent().patchRun(runId, (r) => ({
      ...r,
      proposals: r.proposals.map((x) => (x.path === path ? { ...x, status: "applied" } : x)),
    }));
    ide().log("success", "code", `Применено: ${p.path}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ide().log("error", "code", `Не удалось применить ${p.path}: ${message}`);
    toast.error(`Не удалось применить ${p.path}`, { description: message });
    return false;
  }
}

export function rejectProposal(runId: string, path: string): void {
  agent().patchRun(runId, (r) => ({
    ...r,
    proposals: r.proposals.map((x) => (x.path === path ? { ...x, status: "rejected" } : x)),
  }));
  ide().log("info", "code", `Отклонено: ${path}`);
}

export async function applyAllProposals(runId: string): Promise<void> {
  const run = agent().runs.find((r) => r.id === runId);
  if (!run) return;
  let count = 0;
  for (const p of run.proposals.filter((x) => x.status === "pending")) {
    if (await applyProposal(runId, p.path)) count++;
  }
  if (count > 0) toast.success(`Применено файлов: ${count}`);
}

/** Dispatches a prompt to whichever mode is requested (used by examples & palette). */
export function runPrompt(mode: AgentMode, prompt: string): void {
  ide().setAgentMode(mode);
  ide().setAgentVisible(true);
  if (mode === "chat") void sendChat(prompt);
  else if (mode === "work") void startWork(prompt);
  else void startCodeRun(prompt);
}
