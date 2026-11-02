"use client";

import { getKv, setKv } from "@/lib/db/fs";
import { getDb } from "@/lib/db/schema";
import { useIdeStore } from "@/lib/store/ide";
import { budgetStatus, estimateTokens } from "./cost";
import { dedupeChanges } from "./changes";
import { resolvePolicy } from "./permissions";
import { baseCatalog, routeChain } from "./router";
import { redact, scanText } from "./secrets";
import { useNexus } from "./store";
import { uid, type Capability, type Change, type ReplayEvent, type SnapshotMeta, type TaskType } from "./types";
import { taskForFeature } from "./router";

/* ------------------------------ workspace I/O ----------------------------- */

export function workspaceFiles(): Record<string, string> {
  const { nodes, contents } = useIdeStore.getState();
  const out: Record<string, string> = {};
  for (const [p, n] of Object.entries(nodes)) if (n.type === "file" && contents[p] !== undefined) out[p] = contents[p] ?? "";
  return out;
}

/* ------------------------------ server access ----------------------------- */

export async function nexusFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const key = useNexus.getState().data.adminKey;
  const headers = new Headers(init.headers);
  if (key) headers.set("x-nexus-key", key);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}

export async function nexusJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await nexusFetch(path, init);
  const j = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) {
    const err = new Error(j.error ?? `HTTP ${res.status}`) as Error & { code?: string; payload?: unknown };
    err.code = j.code;
    err.payload = j;
    throw err;
  }
  return j;
}

export async function refreshServerStatus(): Promise<void> {
  try {
    const res = await fetch("/api/nexus/status");
    if (res.ok) useNexus.getState().setServer((await res.json()) as never);
  } catch {
    /* offline */
  }
}

/* -------------------------------- replay log ------------------------------ */

export function logReplay(runId: string, type: ReplayEvent["type"], title: string, detail?: string, agent?: string): void {
  const ev: ReplayEvent = { id: uid("ev"), runId, ts: Date.now(), type, title: redact(title).slice(0, 200), detail: detail ? redact(detail).slice(0, 4000) : undefined, agent };
  useNexus.getState().update("replay", (r) => [...r, ev].slice(-1500));
}

/* -------------------------------- permissions ----------------------------- */

/** Resolves true when the capability is allowed (asking the user when the policy requires it). */
export function requestPermission(cap: Capability, detail: string, opts: { agentId?: string; force?: boolean; runId?: string } = {}): Promise<boolean> {
  const st = useNexus.getState();
  const agent = st.data.agents.find((a) => a.id === opts.agentId);
  const policy = resolvePolicy(cap, st.data.policy, agent?.policy);
  if (policy === "deny") {
    if (opts.runId) logReplay(opts.runId, "permission", `Запрещено: ${cap}`, detail, agent?.name);
    return Promise.resolve(false);
  }
  if (policy === "allow" && !opts.force) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    st.enqueuePermission({
      id: uid("perm"),
      capability: cap,
      detail,
      agent: agent?.name,
      resolve: (ok) => {
        if (opts.runId) logReplay(opts.runId, "permission", `${ok ? "Разрешено" : "Отклонено"}: ${cap}`, detail, agent?.name);
        resolve(ok);
      },
    });
  });
}

/* ----------------------------------- AI ----------------------------------- */

export interface AskOptions {
  feature: string;
  prompt: string;
  system?: string;
  task?: TaskType;
  agent?: string;
  runId?: string;
  maxTokens?: number;
  images?: string[];
  signal?: AbortSignal;
  /** Guard against runaway agent loops: shared counter for one run. */
  runBudget?: { calls: number; max: number };
}

export interface AiResult {
  text: string;
  model: string;
  label: string;
  promptTokens: number;
  completionTokens: number;
  estimated: boolean;
}

export async function askAi(o: AskOptions): Promise<AiResult> {
  const st = useNexus.getState();
  const d = st.data;
  const bs = budgetStatus(d.usage, d.budget, d.rates);
  if (bs.level === "blocked") throw new Error(`${bs.messages.join("; ")}. Увеличьте лимит в разделе «Расходы AI».`);
  if (o.runBudget) {
    if (o.runBudget.calls >= o.runBudget.max) throw new Error("Достигнут лимит AI-вызовов для этого запуска (защита от бесконечного цикла)");
    o.runBudget.calls++;
  }
  const system = o.system ?? "";
  const need = estimateTokens(system + o.prompt) + (o.maxTokens ?? 3500);
  const chain = routeChain(o.task ?? taskForFeature(o.feature), need, d.router, st.server?.models ?? baseCatalog());
  if (chain.length === 0) throw new Error("Все модели отключены в настройках роутера");
  if (o.runId) logReplay(o.runId, "ai", `Запрос к модели (${o.feature})`, o.prompt.slice(0, 600), o.agent);
  const res = await fetch("/api/nexus/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system, prompt: o.prompt, feature: o.feature, chain, maxTokens: o.maxTokens, images: o.images }),
    signal: o.signal,
  });
  const j = (await res.json().catch(() => ({}))) as { text?: string; model?: string; label?: string; usage?: { promptTokens?: number; completionTokens?: number }; error?: string };
  if (!res.ok || !j.text) {
    if (o.runId) logReplay(o.runId, "error", "AI-запрос не удался", j.error ?? `HTTP ${res.status}`, o.agent);
    throw new Error(j.error ?? `AI-шлюз вернул ${res.status}`);
  }
  const estimated = j.usage?.promptTokens === undefined || j.usage?.completionTokens === undefined;
  const promptTokens = j.usage?.promptTokens ?? estimateTokens(system + o.prompt);
  const completionTokens = j.usage?.completionTokens ?? estimateTokens(j.text);
  useNexus.getState().update("usage", (u) =>
    [...u, { id: uid("u"), ts: Date.now(), feature: o.feature, agent: o.agent, project: d.project, model: j.model ?? "unknown", promptTokens, completionTokens, estimated }].slice(-3000),
  );
  if (o.runId) logReplay(o.runId, "ai", `Ответ получен: ${j.label ?? j.model}`, j.text.slice(0, 800), o.agent);
  return { text: j.text, model: j.model ?? "", label: j.label ?? j.model ?? "", promptTokens, completionTokens, estimated };
}

/* -------------------------------- snapshots ------------------------------- */

const SNAP_LIMITS = { maxBytes: 24_000_000, maxUnpinned: 30 };

export async function takeSnapshot(label: string, kind: SnapshotMeta["kind"] = "manual"): Promise<SnapshotMeta | null> {
  await useIdeStore.getState().flushWrites();
  const files = workspaceFiles();
  const bytes = Object.values(files).reduce((n, c) => n + c.length, 0);
  const meta: SnapshotMeta = { id: uid("snap"), ts: Date.now(), label, kind, files: Object.keys(files).length, bytes };
  await setKv(`nexus-snap:${meta.id}`, files);
  useNexus.getState().update("snapshots", (s) => [...s, meta]);
  await pruneSnapshots();
  return meta;
}

export async function getSnapshotFiles(id: string): Promise<Record<string, string> | undefined> {
  return getKv<Record<string, string>>(`nexus-snap:${id}`);
}

/** Enforces storage limits; manual snapshots are never evicted automatically. */
export async function pruneSnapshots(): Promise<void> {
  const st = useNexus.getState();
  let list = [...st.data.snapshots].sort((a, b) => a.ts - b.ts);
  const removable = () => list.filter((s) => s.kind !== "manual");
  const total = () => list.reduce((n, s) => n + s.bytes, 0);
  const drop: string[] = [];
  while ((removable().length > SNAP_LIMITS.maxUnpinned || total() > SNAP_LIMITS.maxBytes) && removable().length > 1) {
    const victim = removable()[0];
    if (!victim) break;
    drop.push(victim.id);
    list = list.filter((s) => s.id !== victim.id);
  }
  if (drop.length) {
    await Promise.all(drop.map((id) => getDb().kv.delete(`nexus-snap:${id}`)));
    st.update("snapshots", (s) => s.filter((x) => !drop.includes(x.id)));
  }
}

export async function deleteSnapshot(id: string): Promise<void> {
  await getDb().kv.delete(`nexus-snap:${id}`);
  useNexus.getState().update("snapshots", (s) => s.filter((x) => x.id !== id));
}

/** Restores files from a snapshot. A safety snapshot of the current state is always taken first. */
export async function restoreSnapshot(id: string, opts: { paths?: string[]; removeExtra?: boolean } = {}): Promise<{ restored: number; removed: number }> {
  const files = await getSnapshotFiles(id);
  if (!files) throw new Error("Данные снапшота не найдены");
  await takeSnapshot("Перед восстановлением", "safety");
  const ide = useIdeStore.getState();
  let restored = 0;
  let removed = 0;
  const targets = opts.paths ?? Object.keys(files);
  for (const p of targets) {
    const content = files[p];
    if (content === undefined) continue;
    await ide.upsertFile(p, content, false);
    restored++;
  }
  if (!opts.paths && opts.removeExtra) {
    for (const p of Object.keys(workspaceFiles())) {
      if (!(p in files)) {
        await useIdeStore.getState().deleteEntry(p);
        removed++;
      }
    }
  }
  return { restored, removed };
}

/* ------------------------------ applying changes -------------------------- */

export interface ApplyResult {
  applied: string[];
  skipped: { path: string; reason: string }[];
  snapshotId?: string;
}

/**
 * The single, guarded path through which every AI-originated change reaches the workspace:
 * permission check → secret scan → optimistic-concurrency check → safety snapshot → write → replay log.
 */
export async function applyChanges(input: Change[], o: { source: string; agentId?: string; runId?: string }): Promise<ApplyResult> {
  const changes = dedupeChanges(input);
  const result: ApplyResult = { applied: [], skipped: [] };
  if (changes.length === 0) return result;
  const runId = o.runId ?? uid("run");
  const writes = changes.filter((c) => c.after !== null);
  const deletes = changes.filter((c) => c.after === null);
  const st = useNexus.getState();

  const leaked = writes.flatMap((c) => scanText(c.path, c.after ?? "", st.data.secretAllow));
  const note = leaked.length ? ` ⚠ В новом коде найдены секреты (${leaked.length}): ${leaked.slice(0, 3).map((l) => `${l.path}:${l.line}`).join(", ")}` : "";
  const okWrite =
    writes.length === 0 ||
    (await requestPermission("write", `${o.source}: изменить/создать ${writes.length} файл(ов): ${writes.map((c) => c.path).slice(0, 6).join(", ")}${note}`, { agentId: o.agentId, runId, force: leaked.length > 0 }));
  const okDelete =
    deletes.length === 0 || (await requestPermission("delete", `${o.source}: удалить ${deletes.map((c) => c.path).join(", ")}`, { agentId: o.agentId, runId }));
  if (!okWrite && !okDelete) {
    changes.forEach((c) => result.skipped.push({ path: c.path, reason: "нет разрешения" }));
    return result;
  }

  const current = workspaceFiles();
  const approved = changes.filter((c) => (c.after === null ? okDelete : okWrite));
  changes.filter((c) => !approved.includes(c)).forEach((c) => result.skipped.push({ path: c.path, reason: "нет разрешения" }));
  const fresh: Change[] = [];
  for (const c of approved) {
    if ((current[c.path] ?? null) !== c.before) result.skipped.push({ path: c.path, reason: "файл изменился после создания предложения" });
    else fresh.push(c);
  }
  if (fresh.length === 0) return result;

  if (useNexus.getState().data.autoSnapshot) {
    const snap = await takeSnapshot(`До: ${o.source}`, "safety");
    result.snapshotId = snap?.id;
    if (snap) logReplay(runId, "checkpoint", `Контрольная точка: ${snap.label}`, snap.id, undefined);
  }
  const ide = useIdeStore.getState();
  for (const c of fresh) {
    try {
      if (c.after === null) await useIdeStore.getState().deleteEntry(c.path);
      else await ide.upsertFile(c.path, c.after, false);
      result.applied.push(c.path);
      logReplay(runId, "file", `${c.after === null ? "Удалён" : c.before === null ? "Создан" : "Изменён"}: ${c.path}`, undefined);
    } catch (err) {
      result.skipped.push({ path: c.path, reason: err instanceof Error ? err.message : "ошибка записи" });
    }
  }
  ide.log("success", "nexus", `${o.source}: применено файлов — ${result.applied.length}`);
  return result;
}
