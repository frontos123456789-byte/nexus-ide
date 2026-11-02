"use client";

import { askAi, logReplay, requestPermission, workspaceFiles } from "./actions";
import { buildContext, FILE_FORMAT_HINT, parseFileBlocks } from "./changes";
import { memoryContext } from "./memory";
import { useNexus } from "./store";
import { uid, type AgentDef, type AgentTask, type Change } from "./types";

export const MAX_PARALLEL = 3;
export const MAX_AI_CALLS_PER_TASK = 3;

const controllers = new Map<string, AbortController>();
/** In-memory isolated workspaces for swarm tasks (agents never touch the live workspace). */
const swarmBases = new Map<string, Record<string, string>>();

export function getSwarmBase(swarmId: string): Record<string, string> | undefined {
  return swarmBases.get(swarmId);
}

function patchTask(id: string, fn: (t: AgentTask) => AgentTask) {
  useNexus.getState().update("tasks", (ts) => ts.map((t) => (t.id === id ? fn(t) : t)));
}

function taskLog(id: string, text: string, level: "info" | "error" | "success" = "info") {
  patchTask(id, (t) => ({ ...t, logs: [...t.logs, { ts: Date.now(), level, text }].slice(-200) }));
}

export function createAgent(def: Pick<AgentDef, "name" | "role" | "instructions" | "model" | "policy">): AgentDef {
  const agent: AgentDef = { id: uid("agent"), createdAt: Date.now(), ...def };
  useNexus.getState().update("agents", (a) => [...a, agent]);
  return agent;
}

export function deleteAgent(id: string) {
  useNexus.getState().update("agents", (a) => a.filter((x) => x.id !== id));
  for (const t of useNexus.getState().data.tasks) if (t.agentId === id && (t.status === "running" || t.status === "queued")) cancelTask(t.id);
}

export function enqueueTask(agentId: string, title: string, prompt: string, swarmId?: string): string {
  const task: AgentTask = { id: uid("task"), agentId, title, prompt, status: "queued", progress: 0, logs: [], createdAt: Date.now(), swarmId };
  useNexus.getState().update("tasks", (ts) => [task, ...ts].slice(0, 100));
  pump();
  return task.id;
}

export function cancelTask(id: string) {
  controllers.get(id)?.abort();
  patchTask(id, (t) => (t.status === "queued" || t.status === "running" ? { ...t, status: "cancelled", finishedAt: Date.now(), error: "Отменено пользователем" } : t));
}

export function retryTask(id: string) {
  const t = useNexus.getState().data.tasks.find((x) => x.id === id);
  if (t) enqueueTask(t.agentId, t.title, t.prompt, t.swarmId);
}

function pump() {
  const tasks = useNexus.getState().data.tasks;
  const running = tasks.filter((t) => t.status === "running").length;
  const queued = tasks.filter((t) => t.status === "queued").sort((a, b) => a.createdAt - b.createdAt);
  for (const t of queued.slice(0, Math.max(0, MAX_PARALLEL - running))) {
    patchTask(t.id, (x) => ({ ...x, status: "running", startedAt: Date.now(), progress: 5 }));
    void execute(t.id);
  }
}

async function execute(id: string) {
  const task = useNexus.getState().data.tasks.find((t) => t.id === id);
  const agent = useNexus.getState().data.agents.find((a) => a.id === task?.agentId);
  if (!task) return;
  const ctl = new AbortController();
  controllers.set(id, ctl);
  const runId = `task-${id}`;
  try {
    if (!agent) throw new Error("Агент удалён");
    logReplay(runId, "start", `Задача: ${task.title}`, task.prompt, agent.name);
    const canRead = await requestPermission("read", `${agent.name} читает файлы проекта`, { agentId: agent.id, runId });
    const base = task.swarmId ? (swarmBases.get(task.swarmId) ?? workspaceFiles()) : workspaceFiles();
    const files = canRead ? base : {};
    taskLog(id, canRead ? `Контекст: ${Object.keys(files).length} файлов${task.swarmId ? " (изолированная копия)" : ""}` : "Чтение файлов запрещено — работа без контекста");
    patchTask(id, (t) => ({ ...t, progress: 20 }));
    const mem = memoryContext(useNexus.getState().data.memory, task.prompt, 2500);
    const system = `Ты ИИ-агент «${agent.name}» (${agent.role}). ${agent.instructions}\nПроект: ${useNexus.getState().data.project}.${mem ? `\nПамять проекта:\n${mem}` : ""}\nЕсли задача требует изменения кода — верни файлы. ${FILE_FORMAT_HINT}\nОтвечай по-русски.`;
    const guard = { calls: 0, max: MAX_AI_CALLS_PER_TASK };
    taskLog(id, "Запрос к модели…");
    const r = await askAi({
      feature: "agent-code",
      system,
      prompt: `${task.prompt}\n\n${buildContext(files, [], 22_000)}`,
      agent: agent.name,
      runId,
      signal: ctl.signal,
      runBudget: guard,
      task: "code",
    });
    if (ctl.signal.aborted) throw new DOMException("aborted", "AbortError");
    patchTask(id, (t) => ({ ...t, progress: 80, model: r.label }));
    const writeAllowed = useNexus.getState().data.policy.write !== "deny" && agent.policy.write !== "deny";
    let changes: Change[] = parseFileBlocks(r.text, files);
    if (!writeAllowed && changes.length) {
      taskLog(id, `Права на изменение файлов запрещены — предложения (${changes.length}) отброшены`, "error");
      changes = [];
    }
    const clean = r.text.replace(/===\s*FILE:[\s\S]*?===\s*END FILE\s*===/g, "[файл]").trim();
    taskLog(id, `Готово: ${changes.length} файл(ов) в предложении · ${r.label}`, "success");
    logReplay(runId, "end", "Задача выполнена", `${changes.length} изменений`, agent.name);
    patchTask(id, (t) => (t.status === "cancelled" ? t : { ...t, status: "done", progress: 100, result: clean, changes, finishedAt: Date.now() }));
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === "AbortError";
    const msg = err instanceof Error ? err.message : String(err);
    if (!aborted) {
      taskLog(id, msg, "error");
      logReplay(runId, "error", "Задача завершилась ошибкой", msg, agent?.name);
    }
    patchTask(id, (t) => (t.status === "cancelled" ? t : { ...t, status: aborted ? "cancelled" : "error", error: aborted ? "Отменено" : msg, finishedAt: Date.now() }));
  } finally {
    controllers.delete(id);
    pump();
  }
}

/** Starts several agents on isolated copies of the same base workspace. */
export function startSwarm(items: { agentId: string; title: string; prompt: string }[]): { swarmId: string; base: Record<string, string> } {
  const swarmId = uid("swarm");
  const base = { ...workspaceFiles() };
  swarmBases.set(swarmId, base);
  for (const it of items) enqueueTask(it.agentId, it.title, it.prompt, swarmId);
  return { swarmId, base };
}
