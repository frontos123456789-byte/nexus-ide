import type { ChatMessage, LlmEvent } from "@/lib/openrouter/types";
import { renderContext, type ProjectContext } from "./context";
import { defaultPlan, parseFileBlocks, parsePlan, parseReview, toProposals } from "./parse";
import {
  ARCHITECT_SYSTEM,
  CODER_SYSTEM,
  DIRECTOR_PLAN_SYSTEM,
  REVIEWER_SYSTEM,
  SUMMARY_SYSTEM,
} from "./prompts";
import type {
  AgentEvent,
  AgentRole,
  AgentStatus,
  DirectorPlan,
  FileProposal,
  ReviewResult,
  SubTask,
} from "./types";

export type LlmStream = (messages: ChatMessage[], signal: AbortSignal) => AsyncGenerator<LlmEvent>;

export interface OrchestratorInput {
  task: string;
  context: ProjectContext;
  stream: LlmStream;
  emit: (event: AgentEvent) => void;
  signal: AbortSignal;
  /** How many sub-agents may run at the same time. */
  maxParallel?: number;
  now?: () => number;
}

interface CallOutcome {
  ok: boolean;
  text: string;
  model?: string;
  label?: string;
  error?: string;
  fatal?: boolean;
}

interface TaskResult {
  task: SubTask;
  outcome: CallOutcome;
  proposals: FileProposal[];
  review?: ReviewResult;
}

const MAX_OUTPUT_FOR_PROMPT = 6_000;

function clip(text: string, max = MAX_OUTPUT_FOR_PROMPT): string {
  return text.length > max ? `${text.slice(0, max)}\n… [обрезано]` : text;
}

/** Runs one LLM call on behalf of an agent, translating events into AgentEvents. */
async function callAgent(
  id: string,
  role: AgentRole,
  title: string,
  messages: ChatMessage[],
  input: OrchestratorInput,
  finalStatus: AgentStatus | null = null,
): Promise<CallOutcome> {
  const { emit, signal, stream } = input;
  emit({ type: "agent", id, role, title, status: "running" });
  let text = "";
  let model: string | undefined;
  let label: string | undefined;
  let error: string | undefined;
  let fatal = false;

  try {
    for await (const e of stream(messages, signal)) {
      switch (e.type) {
        case "attempt":
          model = e.model;
          label = e.label;
          emit({ type: "agent", id, role, title, status: "running", model: e.model, modelLabel: e.label });
          break;
        case "switch":
          emit({ type: "agent_switch", id, message: e.message });
          break;
        case "retry":
          emit({ type: "agent_switch", id, message: e.message });
          break;
        case "reset":
          text = "";
          emit({ type: "agent_reset", id });
          break;
        case "delta":
          text += e.content;
          emit({ type: "agent_delta", id, content: e.content });
          break;
        case "done":
          model = e.model;
          label = e.label;
          break;
        case "error":
          error = e.message;
          fatal = e.kind === "daily_limit" || e.kind === "auth" || e.kind === "aborted";
          break;
        case "reasoning":
          break;
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : "Неизвестная ошибка агента";
  }

  const ok = !error && text.trim().length > 0;
  if (!ok && !error) error = "Пустой ответ модели";
  if (finalStatus || !ok) {
    emit({
      type: "agent",
      id,
      role,
      title,
      status: ok ? (finalStatus ?? "done") : "error",
      model,
      modelLabel: label,
      error: ok ? undefined : error,
    });
  }
  return { ok, text, model, label, error, fatal };
}

function baseUser(task: string, ctx: ProjectContext): string {
  return `# Задача пользователя\n${task}\n\n${renderContext(ctx)}`;
}

function architectMessages(t: SubTask, input: OrchestratorInput): ChatMessage[] {
  return [
    { role: "system", content: ARCHITECT_SYSTEM },
    { role: "user", content: `${baseUser(input.task, input.context)}\n\n# Твоя подзадача\n${t.instruction}` },
  ];
}

function coderMessages(t: SubTask, input: OrchestratorInput, done: Map<string, TaskResult>): ChatMessage[] {
  const designs = t.dependsOn
    .map((d) => done.get(d))
    .filter((r): r is TaskResult => !!r && r.outcome.ok && r.task.agent === "architect")
    .map((r) => `## Дизайн от Architect\n${clip(r.outcome.text)}`);
  const files = t.files.length ? `\n\nТвои файлы: ${t.files.join(", ")}` : "";
  return [
    { role: "system", content: CODER_SYSTEM },
    {
      role: "user",
      content: `${baseUser(input.task, input.context)}\n\n${designs.join("\n\n")}\n\n# Твоя подзадача\n${t.instruction}${files}`,
    },
  ];
}

function reviewerMessages(t: SubTask, input: OrchestratorInput, proposals: FileProposal[]): ChatMessage[] {
  const body = proposals.length
    ? proposals.map((p) => `### ${p.path} (${p.action})\n\`\`\`\n${clip(p.content, 5_000)}\n\`\`\``).join("\n\n")
    : "(кодеры не предложили файлов)";
  return [
    { role: "system", content: REVIEWER_SYSTEM },
    { role: "user", content: `# Задача пользователя\n${input.task}\n\n# Инструкция ревьюеру\n${t.instruction}\n\n# Предложенные изменения\n${body}` },
  ];
}

export function buildFallbackSummary(
  plan: DirectorPlan,
  results: TaskResult[],
  proposals: FileProposal[],
  review?: ReviewResult,
): string {
  const failed = results.filter((r) => !r.outcome.ok);
  const lines = [`**Итог:** ${plan.summary || "задача обработана командой агентов"}`];
  lines.push(
    proposals.length
      ? `**Файлы (${proposals.length}):** ${proposals.map((p) => `\`${p.path}\``).join(", ")}`
      : "**Файлы:** изменений не предложено.",
  );
  if (review) {
    const verdict = review.verdict === "approve" ? "одобрено" : review.verdict === "changes" ? "нужны правки" : "не определён";
    lines.push(`**Ревью:** ${verdict}${review.summary ? ` — ${review.summary}` : ""}`);
  }
  if (failed.length) lines.push(`**Сбои:** ${failed.map((f) => f.task.title).join(", ")}`);
  return lines.join("\n\n");
}

/**
 * Director pipeline:
 *   1. Director plans (JSON, with a deterministic fallback plan).
 *   2. Sub-agents run as a dependency graph — independent ones in PARALLEL.
 *   3. Director summarizes.
 */
export async function runOrchestration(input: OrchestratorInput): Promise<void> {
  const { emit, signal } = input;
  const now = input.now ?? Date.now;
  const started = now();
  const maxParallel = Math.max(1, input.maxParallel ?? 3);

  emit({ type: "agent", id: "director", role: "director", title: "Планирование", status: "running" });

  /* ---- 1. plan ---- */
  const planOutcome = await callAgent(
    "director",
    "director",
    "Планирование",
    [
      { role: "system", content: DIRECTOR_PLAN_SYSTEM },
      { role: "user", content: baseUser(input.task, input.context) },
    ],
    input,
    "done",
  );

  if (!planOutcome.ok && planOutcome.fatal) {
    emit({ type: "error", message: planOutcome.error ?? "Director недоступен" });
    return;
  }
  if (!planOutcome.ok) {
    emit({ type: "error", message: planOutcome.error ?? "Не удалось получить план от Director" });
    return;
  }

  const parsed = parsePlan(planOutcome.text);
  const plan = parsed ?? defaultPlan(input.task);
  emit({ type: "plan", plan, fallback: !parsed });
  for (const t of plan.tasks) {
    emit({ type: "agent", id: t.id, role: t.agent, title: t.title, status: "queued", dependsOn: t.dependsOn });
  }

  /* ---- 2. execute DAG ---- */
  const existing = new Set(input.context.tree);
  const results = new Map<string, TaskResult>();
  const pending = new Map(plan.tasks.map((t) => [t.id, t]));
  const running = new Map<string, Promise<void>>();
  const allProposals = new Map<string, FileProposal>();
  let lastReview: ReviewResult | undefined;
  let aborted = false;

  const runTask = async (t: SubTask): Promise<void> => {
    let messages: ChatMessage[];
    if (t.agent === "architect") messages = architectMessages(t, input);
    else if (t.agent === "coder") messages = coderMessages(t, input, results);
    else {
      const depProposals = t.dependsOn.flatMap((d) => results.get(d)?.proposals ?? []);
      const pool = depProposals.length ? depProposals : Array.from(allProposals.values());
      messages = reviewerMessages(t, input, pool);
    }

    const outcome = await callAgent(t.id, t.agent, t.title, messages, input);
    const result: TaskResult = { task: t, outcome, proposals: [] };

    if (outcome.ok && t.agent === "coder") {
      result.proposals = toProposals(parseFileBlocks(outcome.text), existing);
      if (result.proposals.length === 0) {
        outcome.ok = false;
        outcome.error = "Coder не вернул ни одного блока <file>";
      } else {
        for (const p of result.proposals) allProposals.set(p.path, p);
        emit({ type: "proposal", id: t.id, files: result.proposals });
      }
    }
    if (outcome.ok && t.agent === "reviewer") {
      result.review = parseReview(outcome.text);
      lastReview = result.review;
      emit({ type: "review", id: t.id, review: result.review });
    }
    if (outcome.fatal) aborted = true;

    emit({
      type: "agent",
      id: t.id,
      role: t.agent,
      title: t.title,
      status: outcome.ok ? "done" : "error",
      model: outcome.model,
      modelLabel: outcome.label,
      error: outcome.ok ? undefined : outcome.error,
    });
    results.set(t.id, result);
  };

  const shouldSkip = (t: SubTask): boolean => {
    const blocking = t.dependsOn.map((d) => results.get(d)).filter((r): r is TaskResult => !!r && r.task.agent !== "architect");
    return blocking.length > 0 && blocking.every((r) => !r.outcome.ok);
  };

  while ((pending.size > 0 || running.size > 0) && !signal.aborted && !aborted) {
    for (const t of Array.from(pending.values())) {
      if (running.size >= maxParallel) break;
      if (!t.dependsOn.every((d) => results.has(d))) continue;
      pending.delete(t.id);
      if (shouldSkip(t)) {
        emit({
          type: "agent",
          id: t.id,
          role: t.agent,
          title: t.title,
          status: "skipped",
          error: "Пропущено: зависимости не выполнены",
        });
        results.set(t.id, { task: t, outcome: { ok: false, text: "", error: "skipped" }, proposals: [] });
        continue;
      }
      const p = runTask(t)
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Сбой агента";
          emit({ type: "agent", id: t.id, role: t.agent, title: t.title, status: "error", error: message });
          results.set(t.id, { task: t, outcome: { ok: false, text: "", error: message }, proposals: [] });
        })
        .finally(() => {
          running.delete(t.id);
        });
      running.set(t.id, p);
    }
    if (running.size === 0) {
      if (pending.size > 0 && !Array.from(pending.values()).some((t) => t.dependsOn.every((d) => results.has(d)))) {
        for (const t of pending.values()) {
          emit({ type: "agent", id: t.id, role: t.agent, title: t.title, status: "skipped", error: "Пропущено: цикл зависимостей" });
        }
        pending.clear();
      }
      continue;
    }
    await Promise.race(running.values());
  }
  await Promise.allSettled(running.values());

  if (signal.aborted) {
    emit({ type: "error", message: "Выполнение прервано." });
    return;
  }

  /* ---- 3. summary ---- */
  const resultList = Array.from(results.values());
  const finalProposals = Array.from(allProposals.values());
  const failedCount = resultList.filter((r) => !r.outcome.ok && r.outcome.error !== "skipped").length;

  const summaryData = [
    `Задача: ${input.task}`,
    `План: ${plan.summary}`,
    "Агенты:",
    ...resultList.map((r) => `- ${r.task.agent} «${r.task.title}»: ${r.outcome.ok ? "успешно" : `сбой (${r.outcome.error})`}`),
    `Предложенные файлы: ${finalProposals.map((p) => `${p.path} (${p.action})`).join(", ") || "нет"}`,
    lastReview ? `Ревью: ${lastReview.verdict}. ${lastReview.summary}. Замечаний: ${lastReview.issues.length}` : "Ревью: не проводилось",
  ].join("\n");

  let summary = "";
  if (!aborted) {
    emit({ type: "agent", id: "director", role: "director", title: "Итоговая сводка", status: "running" });
    let streamed = "";
    try {
      for await (const e of input.stream(
        [
          { role: "system", content: SUMMARY_SYSTEM },
          { role: "user", content: summaryData },
        ],
        signal,
      )) {
        if (e.type === "delta") {
          streamed += e.content;
          emit({ type: "summary_delta", content: e.content });
        } else if (e.type === "reset") {
          streamed = "";
          emit({ type: "summary_delta", content: "", reset: true });
        }
      }
    } catch {
      streamed = "";
    }
    summary = streamed.trim();
  }
  if (!summary) summary = buildFallbackSummary(plan, resultList, finalProposals, lastReview);
  emit({ type: "summary", content: summary });
  emit({ type: "agent", id: "director", role: "director", title: "Итоговая сводка", status: "done" });

  emit({
    type: "done",
    durationMs: now() - started,
    stats: { agents: plan.tasks.length + 1, failed: failedCount, files: finalProposals.length },
  });
}
