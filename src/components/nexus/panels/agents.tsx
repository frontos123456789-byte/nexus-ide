"use client";

import { useMemo, useState } from "react";
import { Ban, Bot, Check, Pencil, Pin, Play, Plus, RotateCcw, Square, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { workspaceFiles } from "@/lib/nexus/actions";
import { changeStats } from "@/lib/nexus/changes";
import { MEMORY_LIMITS, enforceLimit, memorySize, searchMemory } from "@/lib/nexus/memory";
import { mergeSwarm, type SwarmMerge } from "@/lib/nexus/swarm";
import { parseConflicts, resolveConflict } from "@/lib/nexus/merge";
import { CAPABILITIES, isDangerous, resolvePolicy } from "@/lib/nexus/permissions";
import { baseCatalog, rankModels } from "@/lib/nexus/router";
import { MAX_PARALLEL, cancelTask, createAgent, deleteAgent, enqueueTask, getSwarmBase, retryTask, startSwarm } from "@/lib/nexus/runner";
import { useNexus } from "@/lib/nexus/store";
import { uid, type Change, type MemoryItem, type Policy, type TaskStatus, type TaskType } from "@/lib/nexus/types";
import { cn } from "@/lib/utils/cn";
import { Badge, Card, ChangeSet, Empty, Field, Note, inputCls } from "../ui";

const STATUS_TONE: Record<TaskStatus, "muted" | "ok" | "warn" | "error" | "accent"> = { queued: "muted", running: "accent", done: "ok", error: "error", cancelled: "warn" };
const STATUS_RU: Record<TaskStatus, string> = { queued: "в очереди", running: "выполняется", done: "готово", error: "ошибка", cancelled: "отменено" };

function useData() {
  return useNexus((s) => s.data);
}

/* ------------------------------ 1. Commander ------------------------------ */

export function CommanderPanel() {
  const { agents, tasks } = useData();
  const [name, setName] = useState("");
  const [role, setRole] = useState("Full-stack разработчик");
  const [instr, setInstr] = useState("Пиши аккуратный TypeScript, не ломай существующую архитектуру, меняй минимум файлов.");
  const [agentId, setAgentId] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const running = tasks.filter((t) => t.status === "running").length;
  const queued = tasks.filter((t) => t.status === "queued").length;
  const selected = agentId || agents[0]?.id || "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Badge tone="accent">выполняется: {running}/{MAX_PARALLEL}</Badge>
        <Badge>в очереди: {queued}</Badge>
        <Badge tone="ok">готово: {tasks.filter((t) => t.status === "done").length}</Badge>
        <Badge tone="error">ошибок: {tasks.filter((t) => t.status === "error").length}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Агенты">
          {agents.length === 0 && <Empty>Агентов пока нет — создайте первого ниже</Empty>}
          <ul className="mb-3 space-y-1.5">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs">
                <Bot className="size-3.5 text-accent-soft" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{a.name}</div>
                  <div className="truncate text-[10px] text-muted">{a.role}</div>
                </div>
                <Button size="icon-sm" variant="ghost" aria-label={`Удалить агента ${a.name}`} onClick={() => deleteAgent(a.id)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              createAgent({ name: name.trim(), role, instructions: instr, model: "auto", policy: {} });
              setName("");
              toast.success("Агент создан");
            }}
          >
            <Field label="Имя"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend-агент" /></Field>
            <Field label="Роль"><input className={inputCls} value={role} onChange={(e) => setRole(e.target.value)} /></Field>
            <Field label="Инструкции"><textarea className={cn(inputCls, "min-h-16")} value={instr} onChange={(e) => setInstr(e.target.value)} /></Field>
            <Button size="sm" type="submit" disabled={!name.trim()}><Plus /> Создать агента</Button>
          </form>
        </Card>
        <Card title="Назначить задачу">
          {agents.length === 0 ? (
            <Empty>Сначала создайте агента</Empty>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!prompt.trim()) return;
                enqueueTask(selected, title.trim() || prompt.trim().slice(0, 40), prompt.trim());
                setPrompt("");
                setTitle("");
              }}
            >
              <Field label="Агент">
                <select className={inputCls} value={selected} onChange={(e) => setAgentId(e.target.value)}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Заголовок"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Задача"><textarea className={cn(inputCls, "min-h-24")} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Добавь страницу /about с описанием проекта" /></Field>
              <Button size="sm" type="submit" disabled={!prompt.trim()}><Play /> Запустить</Button>
              <p className="text-[10px] text-muted">Параллельно выполняется не более {MAX_PARALLEL} задач, остальные ждут в очереди. Результат — предложение изменений: применяется только после вашего подтверждения.</p>
            </form>
          )}
        </Card>
      </div>
      <Card title="Задачи и история">
        {tasks.length === 0 ? <Empty>Задач пока нет</Empty> : (
          <ul className="space-y-2">
            {tasks.map((t) => {
              const agent = agents.find((a) => a.id === t.agentId);
              return (
                <li key={t.id} className="rounded border border-border p-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[t.status]}>{STATUS_RU[t.status]}</Badge>
                    <button className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => setOpenTask(openTask === t.id ? null : t.id)} aria-expanded={openTask === t.id}>{t.title}</button>
                    <span className="text-[10px] text-muted">{agent?.name ?? "удалён"}{t.model ? ` · ${t.model}` : ""}</span>
                    {(t.status === "running" || t.status === "queued") && <Button size="icon-sm" variant="ghost" aria-label="Остановить" onClick={() => cancelTask(t.id)}><Square /></Button>}
                    {(t.status === "error" || t.status === "cancelled") && <Button size="icon-sm" variant="ghost" aria-label="Повторить" onClick={() => retryTask(t.id)}><RotateCcw /></Button>}
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded bg-hover" role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className={cn("h-full transition-all", t.status === "error" ? "bg-red-500" : "bg-accent")} style={{ width: `${t.progress}%` }} />
                  </div>
                  {t.error && <p className="mt-1 text-[11px] text-red-300">{t.error}</p>}
                  {openTask === t.id && (
                    <div className="mt-2 space-y-2">
                      <div className="max-h-32 overflow-auto rounded bg-background p-2 font-mono text-[10px] text-subtle">
                        {t.logs.map((l, i) => <div key={i} className={l.level === "error" ? "text-red-300" : l.level === "success" ? "text-emerald-300" : ""}>{new Date(l.ts).toLocaleTimeString()} {l.text}</div>)}
                      </div>
                      {t.result && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">{t.result}</pre>}
                      {t.changes && t.changes.length > 0 && <ChangeSet changes={t.changes} source={`Агент ${agent?.name ?? ""}`} agentId={t.agentId} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* --------------------------------- 3. Swarm -------------------------------- */

export function SwarmPanel() {
  const { agents, tasks } = useData();
  const [picked, setPicked] = useState<string[]>([]);
  const [goal, setGoal] = useState("");
  const [swarmId, setSwarmId] = useState<string | null>(null);
  const [merge, setMerge] = useState<SwarmMerge | null>(null);
  const [resolved, setResolved] = useState<Record<string, string>>({});
  const swarmTasks = tasks.filter((t) => swarmId && t.swarmId === swarmId);
  const allDone = swarmTasks.length > 0 && swarmTasks.every((t) => t.status === "done" || t.status === "error" || t.status === "cancelled");
  const finalChanges = useMemo<Change[]>(() => {
    if (!merge || !swarmId) return [];
    const base = getSwarmBase(swarmId) ?? {};
    const out = [...merge.merged];
    for (const c of merge.conflicts) {
      const text = resolved[c.path] ?? c.text;
      if (parseConflicts(text).length === 0) out.push({ path: c.path, before: base[c.path] ?? null, after: text });
    }
    return out;
  }, [merge, resolved, swarmId]);
  return (
    <div className="space-y-3">
      <Note>Каждый агент работает с изолированной копией проекта и не видит чужих правок. Результаты объединяются трёхсторонним слиянием; пересекающиеся правки становятся конфликтами, а не перезаписью.</Note>
      <Card title="Запуск роя">
        {agents.length < 2 ? <Empty>Нужно минимум 2 агента (создайте их в «Командном центре»)</Empty> : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs">
                  <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))} />
                  {a.name}
                </label>
              ))}
            </div>
            <Field label="Общая цель (каждый агент получит свою часть по роли)"><textarea className={cn(inputCls, "min-h-16")} value={goal} onChange={(e) => setGoal(e.target.value)} /></Field>
            <Button size="sm" disabled={picked.length < 2 || !goal.trim()} onClick={() => {
              const items = picked.map((id) => {
                const a = agents.find((x) => x.id === id);
                return { agentId: id, title: `Рой: ${a?.name}`, prompt: `Общая цель: ${goal}\nТвоя роль: ${a?.role}. Выполни ТОЛЬКО свою часть работы, не трогай чужие области.` };
              });
              const r = startSwarm(items);
              setSwarmId(r.swarmId);
              setMerge(null);
              setResolved({});
            }}><Users /> Запустить рой</Button>
          </div>
        )}
      </Card>
      {swarmTasks.length > 0 && (
        <Card title="Агенты роя" actions={allDone && <Button size="sm" onClick={() => {
          const base = swarmId ? getSwarmBase(swarmId) ?? workspaceFiles() : workspaceFiles();
          setMerge(mergeSwarm(base, swarmTasks.filter((t) => t.status === "done").map((t) => ({ agent: agents.find((a) => a.id === t.agentId)?.name ?? t.agentId, changes: t.changes ?? [] }))));
        }}>Объединить результаты</Button>}>
          <ul className="space-y-1.5">
            {swarmTasks.map((t) => (
              <li key={t.id} className="rounded border border-border p-2 text-xs">
                <div className="flex items-center gap-2"><Badge tone={STATUS_TONE[t.status]}>{STATUS_RU[t.status]}</Badge><span className="flex-1">{agents.find((a) => a.id === t.agentId)?.name}</span><span className="text-[10px] text-muted">{t.progress}%</span></div>
                {t.error && <p className="text-[11px] text-red-300">{t.error}</p>}
                {t.changes?.map((c) => { const s = changeStats(c); return <div key={c.path} className="font-mono text-[10px] text-subtle">{c.path} <span className="text-emerald-400">+{s.added}</span> <span className="text-red-400">−{s.removed}</span></div>; })}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {merge && (
        <Card title={`Результат слияния · конфликтов: ${merge.conflicts.length} · пересечений: ${merge.overlapping.length}`}>
          {merge.conflicts.map((c) => {
            const text = resolved[c.path] ?? c.text;
            const blocks = parseConflicts(text);
            return (
              <div key={c.path} className="mb-3 rounded border border-amber-500/30 p-2">
                <div className="mb-1 text-xs font-medium">Конфликт: <span className="font-mono">{c.path}</span> ({c.agents.join(" vs ")})</div>
                {blocks.length === 0 ? <Badge tone="ok">разрешён</Badge> : (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <pre className="max-h-32 overflow-auto rounded bg-emerald-500/10 p-1.5 font-mono text-[10px]">{blocks[0]?.ours.join("\n")}</pre>
                      <pre className="max-h-32 overflow-auto rounded bg-sky-500/10 p-1.5 font-mono text-[10px]">{blocks[0]?.theirs.join("\n")}</pre>
                    </div>
                    <div className="flex gap-1.5">
                      {(["ours", "theirs", "both"] as const).map((k) => <Button key={k} size="xs" variant="secondary" onClick={() => setResolved((r) => ({ ...r, [c.path]: resolveConflict(text, 0, k) }))}>{k === "ours" ? "Левая" : k === "theirs" ? "Правая" : "Обе"}</Button>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <ChangeSet key={finalChanges.map((c) => c.path).join("|")} changes={finalChanges} source="Swarm" />
        </Card>
      )}
    </div>
  );
}

/* -------------------------------- 4. Memory -------------------------------- */

export function MemoryPanel() {
  const { memory } = useData();
  const update = useNexus((s) => s.update);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<MemoryItem["kind"]>("architecture");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const shown = useMemo(() => searchMemory(memory, q), [memory, q]);
  const size = memorySize(memory);
  const save = () => {
    if (!title.trim() || !body.trim()) return;
    const now = Date.now();
    update("memory", (m) => {
      const next = editId
        ? m.map((x) => (x.id === editId ? { ...x, kind, title: title.trim(), body: body.trim(), tags: tags.split(",").map((t) => t.trim()).filter(Boolean), updatedAt: now } : x))
        : [...m, { id: uid("mem"), kind, title: title.trim(), body: body.trim(), tags: tags.split(",").map((t) => t.trim()).filter(Boolean), pinned: false, createdAt: now, updatedAt: now }];
      const { kept, evicted } = enforceLimit(next);
      if (evicted.length) toast.warning(`Лимит памяти: удалено старых записей — ${evicted.length}`);
      return kept;
    });
    setEditId(null); setTitle(""); setBody(""); setTags("");
  };
  return (
    <div className="space-y-3">
      <Note>Память подмешивается в промпты всех агентов (по релевантности, в пределах бюджета). Занято {size.toLocaleString()} из {MEMORY_LIMITS.maxChars.toLocaleString()} символов, записей {memory.length}/{MEMORY_LIMITS.maxItems}. При переполнении вытесняются самые старые незакреплённые записи.</Note>
      <div className="grid gap-3 lg:grid-cols-[1fr_1.4fr]">
        <Card title={editId ? "Редактирование" : "Новая запись"}>
          <div className="space-y-2">
            <Field label="Тип"><select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as MemoryItem["kind"])}>
              <option value="architecture">Архитектурное решение</option><option value="convention">Соглашение по коду</option><option value="preference">Предпочтение</option><option value="task">История задачи</option><option value="doc">Документация / контекст</option>
            </select></Field>
            <Field label="Заголовок"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Содержание"><textarea className={cn(inputCls, "min-h-24")} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <Field label="Теги (через запятую)"><input className={inputCls} value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
            <div className="flex gap-2"><Button size="sm" onClick={save} disabled={!title.trim() || !body.trim()}><Check /> Сохранить</Button>{editId && <Button size="sm" variant="ghost" onClick={() => { setEditId(null); setTitle(""); setBody(""); setTags(""); }}>Отмена</Button>}</div>
          </div>
        </Card>
        <Card title="Записи" actions={<input className={cn(inputCls, "w-40")} placeholder="Поиск…" aria-label="Поиск по памяти" value={q} onChange={(e) => setQ(e.target.value)} />}>
          {shown.length === 0 ? <Empty>{memory.length ? "Ничего не найдено" : "Память пуста — сохраните первое архитектурное решение"}</Empty> : (
            <ul className="space-y-1.5">
              {shown.map((m) => (
                <li key={m.id} className="rounded border border-border p-2 text-xs">
                  <div className="flex items-center gap-1.5"><Badge tone="accent">{m.kind}</Badge><b className="min-w-0 flex-1 truncate">{m.title}</b>
                    <Button size="icon-sm" variant="ghost" aria-label="Закрепить" onClick={() => update("memory", (all) => all.map((x) => (x.id === m.id ? { ...x, pinned: !x.pinned } : x)))}><Pin className={m.pinned ? "text-amber-300" : ""} /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Редактировать" onClick={() => { setEditId(m.id); setKind(m.kind); setTitle(m.title); setBody(m.body); setTags(m.tags.join(", ")); }}><Pencil /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label="Удалить" onClick={() => update("memory", (all) => all.filter((x) => x.id !== m.id))}><Trash2 /></Button></div>
                  <p className="mt-1 whitespace-pre-wrap text-subtle">{m.body}</p>
                  {m.tags.length > 0 && <div className="mt-1 text-[10px] text-muted">#{m.tags.join(" #")}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- 10. Permissions ----------------------------- */

export function PermissionsPanel() {
  const { policy, agents } = useData();
  const patch = useNexus((s) => s.patch);
  const update = useNexus((s) => s.update);
  const sel = (v: Policy | undefined, on: (p: Policy | undefined) => void, withInherit = false) => (
    <select className={cn(inputCls, "w-24")} value={v ?? ""} onChange={(e) => on((e.target.value || undefined) as Policy | undefined)}>
      {withInherit && <option value="">наследовать</option>}
      <option value="allow">разрешить</option><option value="ask">спрашивать</option><option value="deny">запретить</option>
    </select>
  );
  return (
    <div className="space-y-3">
      <Note>Итоговое правило агента — самое строгое из глобального и персонального. Опасные операции (удаление, терминал, установка пакетов, секреты, деплой) никогда не выполняются без подтверждения, даже при «разрешить».</Note>
      <Card title="Глобальные разрешения">
        <table className="w-full text-xs"><thead className="text-left text-[10px] uppercase text-muted"><tr><th className="py-1">Возможность</th><th>Политика</th><th>Эффективно</th></tr></thead>
          <tbody>{CAPABILITIES.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-1.5"><div className="font-medium">{c.label} {c.dangerous && <Badge tone="warn">опасно</Badge>}</div><div className="text-[10px] text-muted">{c.hint}</div></td>
              <td>{sel(policy[c.id], (p) => p && patch({ policy: { ...policy, [c.id]: p } }))}</td>
              <td><Badge tone={resolvePolicy(c.id, policy) === "deny" ? "error" : resolvePolicy(c.id, policy) === "ask" ? "warn" : "ok"}>{resolvePolicy(c.id, policy) === "ask" && isDangerous(c.id) && policy[c.id] === "allow" ? "ask (принудительно)" : resolvePolicy(c.id, policy)}</Badge></td>
            </tr>))}</tbody></table>
      </Card>
      <Card title="Персональные ограничения агентов">
        {agents.length === 0 ? <Empty>Нет агентов</Empty> : agents.map((a) => (
          <div key={a.id} className="mb-3">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium"><Ban className="size-3.5 text-muted" />{a.name}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{CAPABILITIES.map((c) => (
              <label key={c.id} className="flex items-center justify-between gap-1 text-[11px] text-subtle">{c.label}
                {sel(a.policy[c.id], (p) => update("agents", (all) => all.map((x) => (x.id === a.id ? { ...x, policy: { ...x.policy, [c.id]: p } } : x))), true)}</label>))}</div>
          </div>))}
      </Card>
      <Note tone="warn">Разрешения применяются на клиенте ко всем AI-изменениям файлов и серверные роуты дополнительно защищены ключом NEXUS_ADMIN_KEY и подтверждением опасных SQL. Агенты в этой IDE не получают терминала и сетевого доступа сами по себе.</Note>
    </div>
  );
}

/* ------------------------------- 6. Router --------------------------------- */

const TASKS: TaskType[] = ["code", "reasoning", "chat", "summarize", "json", "vision"];

export function RouterPanel() {
  const { router } = useData();
  const server = useNexus((s) => s.server);
  const patch = useNexus((s) => s.patch);
  const catalog = server?.models ?? baseCatalog();
  const [need, setNeed] = useState(8000);
  return (
    <div className="space-y-3">
      <Note>Роутер ранжирует только бесплатные модели OpenRouter по типу задачи, контекстному окну и цене{server?.providerMetadata ? " (метаданные получены от провайдера)" : " (метаданные провайдера недоступны — используется порядок цепочки)"}. Ручной выбор пробуется первым, остальные работают как fallback при ошибке/лимите.</Note>
      <Card title="Настройки">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Ручной выбор модели"><select className={inputCls} value={router.manualModel ?? ""} onChange={(e) => patch({ router: { ...router, manualModel: e.target.value || undefined } })}>
            <option value="">Авто (умный выбор)</option>{catalog.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></Field>
          <Field label="Нужный контекст, токенов"><input type="number" className={inputCls} value={need} min={500} step={500} onChange={(e) => setNeed(Number(e.target.value) || 500)} /></Field>
          <Field label="Макс. цена, $/1M токенов" hint="Платные модели не используются независимо от лимита"><input type="number" className={inputCls} value={router.maxPrice ?? ""} min={0} step={0.1} onChange={(e) => patch({ router: { ...router, maxPrice: e.target.value === "" ? undefined : Number(e.target.value) } })} /></Field>
        </div>
      </Card>
      <Card title="Модели">
        <table className="w-full text-xs"><thead className="text-left text-[10px] uppercase text-muted"><tr><th className="py-1">Модель</th><th>Контекст</th><th>Цена вх/исх</th><th>Включена</th></tr></thead><tbody>
          {catalog.map((m) => (<tr key={m.id} className="border-t border-border"><td className="py-1.5"><div>{m.label}</div><div className="font-mono text-[10px] text-muted">{m.id}</div></td>
            <td>{m.contextWindow ? m.contextWindow.toLocaleString() : "—"}</td><td>{m.promptPrice !== undefined ? `$${m.promptPrice} / $${m.completionPrice}` : "—"}</td>
            <td><input type="checkbox" aria-label={`Включить ${m.label}`} checked={!router.disabled.includes(m.id)} onChange={(e) => patch({ router: { ...router, disabled: e.target.checked ? router.disabled.filter((x) => x !== m.id) : [...router.disabled, m.id] } })} /></td></tr>))}
        </tbody></table>
      </Card>
      <Card title="Как маршрутизируются задачи">
        <div className="grid gap-2 sm:grid-cols-2">{TASKS.map((t) => { const r = rankModels(t, need, router, catalog); return (
          <div key={t} className="rounded border border-border p-2 text-[11px]"><b className="text-foreground">{t}</b>
            {r.length === 0 ? <p className="text-red-300">Нет доступных моделей</p> : <ol className="mt-1 list-decimal pl-4 text-subtle">{r.slice(0, 3).map((x) => <li key={x.model.id}>{x.model.label} <span className="text-muted">({Math.round(x.score)}{x.reasons.length ? `; ${x.reasons.join(", ")}` : ""})</span></li>)}</ol>}</div>); })}</div>
      </Card>
    </div>
  );
}

/* -------------------------------- 7. Replay -------------------------------- */

export function ReplayPanel() {
  const { replay } = useData();
  const update = useNexus((s) => s.update);
  const runs = useMemo(() => {
    const m = new Map<string, typeof replay>();
    for (const e of replay) m.set(e.runId, [...(m.get(e.runId) ?? []), e]);
    return [...m.entries()].reverse();
  }, [replay]);
  const [sel, setSel] = useState<string | null>(null);
  const events = (sel ? runs.find(([id]) => id === sel)?.[1] : runs[0]?.[1]) ?? [];
  const ICON: Record<string, string> = { start: "▶", tool: "🔧", ai: "🤖", file: "📄", command: "⌨", error: "⚠", checkpoint: "📍", end: "■", permission: "🔒" };
  return (
    <div className="space-y-3">
      <Note>Все записи проходят через маскирование секретов (токены, ключи, пароли в URL заменяются на [REDACTED]). Журнал хранится локально в IndexedDB, последние 1500 событий.</Note>
      {runs.length === 0 ? <Empty>Запусков пока нет — выполните задачу агента или примените изменения</Empty> : (
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <Card title="Запуски" actions={<Button size="xs" variant="ghost" onClick={() => { update("replay", () => []); setSel(null); }}>Очистить</Button>}>
            <ul className="max-h-96 space-y-1 overflow-auto">{runs.map(([id, evs]) => (
              <li key={id}><button onClick={() => setSel(id)} className={cn("w-full rounded px-2 py-1 text-left text-[11px] hover:bg-hover", (sel ?? runs[0]?.[0]) === id && "bg-hover")}>
                <div className="truncate font-medium">{evs[0]?.title}</div><div className="text-[10px] text-muted">{new Date(evs[0]?.ts ?? 0).toLocaleString()} · {evs.length} соб.</div></button></li>))}</ul>
          </Card>
          <Card title="Последовательность действий" actions={<Button size="xs" variant="secondary" onClick={() => { const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "replay.json"; a.click(); }}>Экспорт JSON</Button>}>
            <ol className="relative space-y-2 border-l border-border pl-4">{events.map((e) => (
              <li key={e.id} className="text-xs"><span className="absolute -left-[7px] mt-0.5 grid size-3.5 place-items-center rounded-full bg-panel text-[9px]">{ICON[e.type]}</span>
                <div className="flex items-center gap-2"><b className={e.type === "error" ? "text-red-300" : ""}>{e.title}</b><span className="text-[10px] text-muted">{new Date(e.ts).toLocaleTimeString()}{e.agent ? ` · ${e.agent}` : ""}</span></div>
                {e.detail && <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-background p-1.5 font-mono text-[10px] text-subtle">{e.detail}</pre>}</li>))}</ol>
          </Card>
        </div>
      )}
    </div>
  );
}
