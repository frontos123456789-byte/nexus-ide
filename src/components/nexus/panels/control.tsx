"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Mic, MicOff, Play, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSnapshotFiles, nexusJson, deleteSnapshot, restoreSnapshot, takeSnapshot, workspaceFiles, requestPermission } from "@/lib/nexus/actions";
import { auditCode, osvQueries, type Risk } from "@/lib/nexus/audit";
import { breakdownBy, budgetStatus } from "@/lib/nexus/cost";
import { Room, type Role } from "@/lib/nexus/collab";
import { unifiedDiff } from "@/lib/nexus/changes";
import { buildKnowledgeGraph } from "@/lib/nexus/graph";
import { computeHealth } from "@/lib/nexus/health";
import { createAgent, enqueueTask } from "@/lib/nexus/runner";
import { BUILTIN_SCENARIOS, renderScenario, validateScenario, type Scenario } from "@/lib/nexus/scenarios";
import { scanFiles } from "@/lib/nexus/secrets";
import { useNexus, type WorkspaceId } from "@/lib/nexus/store";
import type { Change } from "@/lib/nexus/types";
import { uid } from "@/lib/nexus/types";
import { useIdeStore } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";
import { ALL_KINDS, Badge, Card, Empty, Field, GraphView, Note, getEditorSelection, getTypeErrors, inputCls, openFileInIde, useBusy, useFiles } from "../ui";

const fmtBytes = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} МБ` : `${Math.round(n / 1024)} КБ`);

/* ------------------------------ 41. Time machine ---------------------------- */

const CAP = 24_000_000;
export function TimeMachinePanel() {
  const { snapshots, autoSnapshot } = useNexus((s) => s.data);
  const patch = useNexus((s) => s.patch); const files = useFiles();
  const [label, setLabel] = useState(""); const [sel, setSel] = useState<string | null>(null); const [diff, setDiff] = useState<Change[]>([]); const [pick, setPick] = useState<Set<string>>(new Set()); const [open, setOpen] = useState<string | null>(null); const [confirm, setConfirm] = useState<null | "all" | "files">(null); const [removeExtra, setRemoveExtra] = useState(false);
  const { busy, error, run } = useBusy(); const used = snapshots.reduce((n, s) => n + s.bytes, 0);
  const compare = (id: string) => void run(async () => {
    const snap = await getSnapshotFiles(id); if (!snap) throw new Error("Данные снапшота не найдены");
    const out: Change[] = [];
    for (const p of new Set([...Object.keys(snap), ...Object.keys(files)])) if (snap[p] !== files[p]) out.push({ path: p, before: files[p] ?? null, after: snap[p] ?? null });
    setSel(id); setDiff(out); setPick(new Set(out.map((c) => c.path))); setConfirm(null);
  });
  return (
    <div className="space-y-3">
      <Card title="Контрольные точки" actions={<span className="text-[10px] text-muted">{fmtBytes(used)} из {fmtBytes(CAP)}</span>}>
        <div className="mb-2 h-1.5 overflow-hidden rounded bg-hover"><div className={cn("h-full", used / CAP > 0.8 ? "bg-amber-500" : "bg-accent")} style={{ width: `${Math.min(100, (used / CAP) * 100)}%` }} /></div>
        <div className="flex flex-wrap items-center gap-2"><input className={cn(inputCls, "w-56")} aria-label="Название снапшота" placeholder="Название (необязательно)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => void run(async () => { await takeSnapshot(label.trim() || "Ручной снапшот", "manual"); setLabel(""); toast.success("Снапшот создан"); })}><Plus />Создать</Button>
          <label className="flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={autoSnapshot} onChange={(e) => patch({ autoSnapshot: e.target.checked })} />авто-снапшоты (каждые 5 мин при изменениях и перед AI-правками)</label></div>
        <p className="mt-1 text-[10px] text-muted">Лимит: 30 автоматических и {fmtBytes(CAP)} всего. Ручные снапшоты автоматически не удаляются; при нехватке места вытесняются самые старые авто/страховочные.</p></Card>
      {error && <Note tone="error">{error}</Note>}
      {snapshots.length === 0 ? <Empty>Снапшотов нет — создайте первый</Empty> : <ul className="space-y-1.5">{[...snapshots].reverse().map((s) => (
        <li key={s.id} className={cn("flex items-center gap-2 rounded border border-border p-2 text-xs", sel === s.id && "border-accent/60")}><Badge tone={s.kind === "manual" ? "accent" : s.kind === "safety" ? "warn" : "muted"}>{s.kind}</Badge><div className="min-w-0 flex-1"><div className="truncate font-medium">{s.label}</div><div className="text-[10px] text-muted">{new Date(s.ts).toLocaleString()} · {s.files} файлов · {fmtBytes(s.bytes)}</div></div>
          <Button size="xs" variant="secondary" onClick={() => compare(s.id)}>Сравнить с текущим</Button>
          <Button size="icon-sm" variant="ghost" aria-label="Удалить снапшот" onClick={() => void run(async () => { if (s.kind === "manual" && !(await requestPermission("delete", `Удалить ручной снапшот «${s.label}»`, { force: true }))) return; await deleteSnapshot(s.id); if (sel === s.id) { setSel(null); setDiff([]); } })}><Trash2 /></Button></li>))}</ul>}
      {sel && <Card title={`Различия: снапшот → текущее состояние (${diff.length})`}>
        {diff.length === 0 ? <Empty>Проект совпадает со снапшотом</Empty> : <>
          <ul className="divide-y divide-border rounded border border-border">{diff.map((c) => <li key={c.path}><div className="flex items-center gap-2 px-2 py-1.5 text-xs"><input type="checkbox" aria-label={`Восстановить ${c.path}`} checked={pick.has(c.path)} onChange={() => setPick((s) => { const n = new Set(s); if (n.has(c.path)) n.delete(c.path); else n.add(c.path); return n; })} /><button className="flex-1 truncate text-left font-mono text-[11px]" onClick={() => setOpen(open === c.path ? null : c.path)}>{c.path}</button><Badge tone={c.after === null ? "error" : c.before === null ? "ok" : "accent"}>{c.after === null ? "нет в снапшоте" : c.before === null ? "удалён сейчас" : "изменён"}</Badge></div>
            {open === c.path && <pre className="max-h-48 overflow-auto bg-background p-2 font-mono text-[10px]">{unifiedDiff({ ...c, before: c.after, after: c.before })}</pre>}</li>)}</ul>
          <div className="mt-2 flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" disabled={pick.size === 0} onClick={() => setConfirm("files")}>Восстановить выбранные ({pick.size})</Button><Button size="sm" variant="destructive" onClick={() => setConfirm("all")}>Полный откат</Button></div>
          {confirm && <div className="mt-2"><Note tone="warn">{confirm === "all" ? "Все файлы будут возвращены к состоянию снапшота." : `Будут восстановлены файлы: ${pick.size}.`} Текущие изменения перезапишутся; перед этим автоматически создаётся страховочный снапшот.
            {confirm === "all" && <label className="mt-1 flex items-center gap-1.5"><input type="checkbox" checked={removeExtra} onChange={(e) => setRemoveExtra(e.target.checked)} />удалить файлы, которых нет в снапшоте</label>}
            <div className="mt-2 flex gap-2"><Button size="xs" variant="destructive" disabled={busy} onClick={() => void run(async () => { const r = await restoreSnapshot(sel, confirm === "all" ? { removeExtra } : { paths: [...pick] }); toast.success(`Восстановлено: ${r.restored}, удалено: ${r.removed}`); setConfirm(null); setDiff([]); setSel(null); })}>Подтвердить</Button><Button size="xs" variant="ghost" onClick={() => setConfirm(null)}>Отмена</Button></div></Note></div>}</>}</Card>}
    </div>
  );
}

/* ------------------------------ 42. Cost observatory ------------------------ */

function CostTable({ title, rows }: { title: string; rows: ReturnType<typeof breakdownBy> }) {
  return (
    <Card title={title}>{rows.length === 0 ? <Empty>Нет данных</Empty> : <table className="w-full text-[11px]"><thead className="text-left text-[10px] uppercase text-muted"><tr><th>Ключ</th><th>Запр.</th><th>Токены (факт/оценка)</th><th>Ref. $</th></tr></thead><tbody>{rows.slice(0, 8).map((r) => <tr key={r.key} className="border-t border-border"><td className="max-w-40 truncate py-1">{r.key}</td><td>{r.requests}</td><td>{r.actualTokens.toLocaleString()} / {r.estimatedTokens.toLocaleString()}</td><td>{r.usd.toFixed(4)}</td></tr>)}</tbody></table>}</Card>
  );
}

export function CostPanel() {
  const { usage, budget, rates } = useNexus((s) => s.data); const patch = useNexus((s) => s.patch);
  const st = budgetStatus(usage, budget, rates); const total = usage.reduce((n, e) => n + e.promptTokens + e.completionTokens, 0); const est = usage.filter((e) => e.estimated).reduce((n, e) => n + e.promptTokens + e.completionTokens, 0);
  const num = (k: "dailyTokens" | "dailyRequests" | "monthlyUsd", step = 1) => <input type="number" min={0} step={step} className={inputCls} value={budget[k]} onChange={(e) => patch({ budget: { ...budget, [k]: Math.max(0, Number(e.target.value) || 0) } })} />;
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (6 - i)); const t = usage.filter((e) => e.ts >= d.getTime() && e.ts < d.getTime() + 86_400_000).reduce((n, e) => n + e.promptTokens + e.completionTokens, 0); return { d, t }; }); const max = Math.max(1, ...days.map((x) => x.t));
  return (
    <div className="space-y-3">
      <Note>Используются только <b>бесплатные</b> модели OpenRouter — реальная стоимость $0. «Ref. $» — условная стоимость по вашим референсным тарифам (для сравнения и бюджета), это не счёт. Токены «факт» — данные провайдера, «оценка» — длина текста ÷ 4.</Note>
      {st.messages.map((m) => <Note key={m} tone={st.level === "blocked" ? "error" : "warn"}>{m}</Note>)}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Запросов всего", usage.length], ["Токенов всего", total.toLocaleString()], ["Из них оценка", est.toLocaleString()], ["Токенов сегодня", st.tokensToday.toLocaleString()]].map(([l, v]) => <div key={String(l)} className="rounded border border-border p-2"><div className="text-[10px] uppercase text-muted">{l}</div><div className="text-lg font-semibold">{v}</div></div>)}</div>
      <Card title="Токены за 7 дней"><div className="flex h-24 items-end gap-2">{days.map((x) => <div key={x.d.toISOString()} className="flex flex-1 flex-col items-center gap-1"><div className="w-full rounded-t bg-accent/70" style={{ height: `${(x.t / max) * 100}%`, minHeight: x.t ? 2 : 0 }} title={`${x.t} токенов`} /><span className="text-[9px] text-muted">{x.d.getDate()}.{x.d.getMonth() + 1}</span></div>)}</div></Card>
      <div className="grid gap-3 lg:grid-cols-2"><CostTable title="По моделям" rows={breakdownBy(usage, (e) => e.model, rates)} /><CostTable title="По агентам" rows={breakdownBy(usage, (e) => e.agent ?? "(без агента)", rates)} /><CostTable title="По функциям" rows={breakdownBy(usage, (e) => e.feature, rates)} /><CostTable title="По проектам" rows={breakdownBy(usage, (e) => e.project, rates)} /></div>
      <Card title="Лимиты бюджета (блокируют запросы при исчерпании, предупреждение с 80%)"><div className="grid gap-2 sm:grid-cols-3"><Field label="Токенов в сутки">{num("dailyTokens", 10000)}</Field><Field label="Запросов в сутки">{num("dailyRequests", 10)}</Field><Field label="Ref. $ за 30 дней">{num("monthlyUsd", 0.5)}</Field>
        <Field label="Ref. тариф вход, $/1M"><input type="number" min={0} step={0.1} className={inputCls} value={rates.input} onChange={(e) => patch({ rates: { ...rates, input: Number(e.target.value) || 0 } })} /></Field><Field label="Ref. тариф выход, $/1M"><input type="number" min={0} step={0.1} className={inputCls} value={rates.output} onChange={(e) => patch({ rates: { ...rates, output: Number(e.target.value) || 0 } })} /></Field>
        <div className="flex items-end"><Button size="sm" variant="ghost" onClick={() => patch({ usage: [] })}>Сбросить статистику</Button></div></div><p className="mt-2 text-[10px] text-muted">Сейчас: {st.requestsToday} запросов за сутки, ref. ${st.usdMonth.toFixed(4)} за 30 дней. Лимиты клиентские (локальная статистика) — серверно запросы дополнительно ограничены rate limit.</p></Card>
    </div>
  );
}

/* ---------------------------- 43. Knowledge graph --------------------------- */

export function KnowledgePanel() {
  const files = useFiles(); const memory = useNexus((s) => s.data.memory); const tasks = useNexus((s) => s.data.tasks); const [q, setQ] = useState(""); const [kinds, setKinds] = useState(new Set(ALL_KINDS.filter((k) => k !== "package")));
  const graph = useMemo(() => buildKnowledgeGraph(files, memory, tasks), [files, memory, tasks]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><input className={cn(inputCls, "w-52")} aria-label="Поиск" placeholder="Поиск по графу…" value={q} onChange={(e) => setQ(e.target.value)} />{ALL_KINDS.filter((k) => k !== "package").map((k) => <label key={k} className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={kinds.has(k)} onChange={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />{k}</label>)}</div>
      <GraphView graph={graph} query={q} kinds={kinds} />
      <p className="text-[10px] text-muted">Связи: import (сплошные), тест → тестируемый модуль, документ → упомянутый файл, архитектурное решение/задача → упомянутые файлы (пунктир). Решения берутся из Agent Memory, задачи — из Agent Commander. Клик по файловому узлу открывает его в редакторе.</p>
    </div>
  );
}

/* ------------------------------- 44. Marketplace ---------------------------- */

export function MarketplacePanel() {
  const { customScenarios, installedScenarios, agents } = useNexus((s) => s.data); const update = useNexus((s) => s.update);
  const [cat, setCat] = useState("all"); const [q, setQ] = useState(""); const [runFor, setRunFor] = useState<Scenario | null>(null); const [vals, setVals] = useState<Record<string, string>>({}); const [draft, setDraft] = useState({ id: "", name: "", description: "", template: "", category: "Качество" as Scenario["category"] }); const [err, setErr] = useState<string | null>(null);
  const all = [...BUILTIN_SCENARIOS, ...customScenarios]; const cats = ["all", ...new Set(all.map((s) => s.category))];
  const shown = all.filter((s) => (cat === "all" || s.category === cat) && `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));
  const run = (s: Scenario) => { let agent = agents[0]; agent ??= createAgent({ name: "Marketplace-агент", role: "Исполнитель сценариев", instructions: s.system, model: "auto", policy: {} }); enqueueTask(agent.id, s.name, `${s.system}\n\n${renderScenario(s, vals)}`); toast.success("Задача поставлена в «Командном центре»"); setRunFor(null); };
  const save = () => { const bad = validateScenario(draft); if (bad) return setErr(bad); const prev = customScenarios.find((c) => c.id === draft.id); const ver = prev ? prev.version.replace(/(\d+)$/, (m) => String(Number(m) + 1)) : "1.0.0"; const s: Scenario = { id: draft.id || uid("sc"), name: draft.name.trim(), description: draft.description, category: draft.category, template: draft.template, system: "Ты помощник разработчика. Меняй только то, что просят.", inputs: [...new Set([...draft.template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ""))].map((k) => ({ key: k, label: k })), version: ver }; update("customScenarios", (a) => [...a.filter((x) => x.id !== s.id), s]); setDraft({ id: "", name: "", description: "", template: "", category: "Качество" }); setErr(null); };
  return (
    <div className="space-y-3">
      <Note>Сценарий — это проверенный шаблон промпта. Он <b>не исполняет код сам</b>: запуск создаёт задачу агента, результат которой применяется только после вашего подтверждения. Шаблоны с опасными конструкциями (скрипты, curl | sh, rm -rf, блоки кода) отклоняются.</Note>
      <div className="flex flex-wrap gap-2"><input className={cn(inputCls, "w-48")} aria-label="Поиск сценариев" placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />{cats.map((c) => <Button key={c} size="xs" variant={cat === c ? "default" : "secondary"} onClick={() => setCat(c)}>{c === "all" ? "Все" : c}</Button>)}</div>
      <div className="grid gap-2 sm:grid-cols-2">{shown.map((s) => { const inst = installedScenarios.includes(s.id) || s.builtin === undefined && false; return (
        <Card key={s.id} title={<span className="flex items-center gap-1.5">{s.name}<Badge>v{s.version}</Badge>{!s.builtin && <Badge tone="accent">свой</Badge>}</span>}>
          <p className="text-[11px] text-subtle">{s.description}</p><div className="mt-2 flex flex-wrap gap-1.5">
            {installedScenarios.includes(s.id) ? <><Button size="xs" onClick={() => { setRunFor(s); setVals({}); }}><Play />Запустить</Button><Button size="xs" variant="ghost" onClick={() => update("installedScenarios", (a) => a.filter((x) => x !== s.id))}>Удалить</Button></> : <Button size="xs" variant="secondary" onClick={() => update("installedScenarios", (a) => [...a, s.id])}>Установить</Button>}
            {!s.builtin && <><Button size="xs" variant="ghost" onClick={() => setDraft({ id: s.id, name: s.name, description: s.description, template: s.template, category: s.category })}>Править</Button><Button size="xs" variant="ghost" aria-label="Удалить сценарий" onClick={() => update("customScenarios", (a) => a.filter((x) => x.id !== s.id))}><Trash2 /></Button></>}</div>{inst && null}</Card>); })}</div>
      {runFor && <Card title={`Настройки: ${runFor.name}`}><div className="grid gap-2 sm:grid-cols-2">{runFor.inputs.map((i) => <Field key={i.key} label={i.label}><input className={inputCls} placeholder={i.placeholder} value={vals[i.key] ?? ""} onChange={(e) => setVals((v) => ({ ...v, [i.key]: e.target.value }))} /></Field>)}</div><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => run(runFor)}><Play />Создать задачу</Button><Button size="sm" variant="ghost" onClick={() => setRunFor(null)}>Отмена</Button></div></Card>}
      <Card title={draft.id ? "Редактирование сценария (версия увеличится)" : "Создать свой сценарий"}><div className="grid gap-2 sm:grid-cols-2"><Field label="Название"><input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="Категория"><select className={inputCls} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as Scenario["category"] })}>{["Качество", "Тесты", "Документация", "Безопасность", "Архитектура", "UI"].map((c) => <option key={c}>{c}</option>)}</select></Field></div>
        <Field label="Описание"><input className={inputCls} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field><Field label="Шаблон промпта ({{переменные}} станут полями)"><textarea className={cn(inputCls, "min-h-20")} value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value })} /></Field>
        {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}<Button size="sm" className="mt-2" onClick={save}>Сохранить сценарий</Button></Card>
    </div>
  );
}

/* --------------------------------- 45. Voice -------------------------------- */

interface SR { start(): void; stop(): void; lang: string; interimResults: boolean; continuous: boolean; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null }
const TOOL_WORDS: Record<string, [WorkspaceId, string]> = { поиск: ["intelligence", "search"], расход: ["control", "cost"], снапшот: ["control", "timemachine"], агент: ["agents", "commander"], безопасност: ["control", "security"], секрет: ["devtools", "secrets"], здоровь: ["intelligence", "health"], команд: ["intelligence", "nl"] };

export function VoicePanel() {
  const [listening, setListening] = useState(false); const [interim, setInterim] = useState(""); const [text, setText] = useState(""); const [log, setLog] = useState<string[]>([]); const rec = useRef<SR | null>(null);
  const supported = typeof window !== "undefined" && Boolean((window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
  const files = useFiles();
  const plan = ((): { label: string; run: () => void } | null => {
    const t = text.toLowerCase().trim(); if (!t) return null;
    const open = /(?:открой|открыть|open)\s+(?:файл\s+)?(.+)/.exec(t);
    if (open?.[1]) { const name = open[1].replace(/\s+/g, "").replace(/точка/g, "."); const hit = Object.keys(files).find((p) => p.toLowerCase().includes(name)); if (hit) return { label: `Открыть файл ${hit}`, run: () => useIdeStore.getState().openFile(hit) }; }
    const mk = /(?:создай|создать|create)\s+файл\s+(\S+)/.exec(t); if (mk?.[1]) return { label: `Создать пустой файл ${mk[1]}`, run: () => void useIdeStore.getState().upsertFile(mk[1] ?? "", "", true) };
    if (/терминал/.test(t)) return { label: "Переключить панель терминала", run: () => useIdeStore.getState().setBottomVisible(!useIdeStore.getState().bottomVisible) };
    if (/(проводник|дерево файлов)/.test(t)) return { label: "Переключить проводник", run: () => useIdeStore.getState().setSidebarVisible(!useIdeStore.getState().sidebarVisible) };
    for (const [w, [ws, tool]] of Object.entries(TOOL_WORDS)) if (t.includes(w)) return { label: `Открыть инструмент Nexus: ${w}`, run: () => useNexus.getState().openTool(ws, tool) };
    return null;
  })();
  const start = () => { const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }; const C = W.SpeechRecognition ?? W.webkitSpeechRecognition; if (!C) return; const r = new C(); r.lang = "ru-RU"; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => { let fin = ""; let tmp = ""; for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; const tr = res?.[0]?.transcript ?? ""; if (res?.isFinal) fin += tr; else tmp += tr; } setInterim(tmp); if (fin) setText(fin); };
    r.onerror = (e) => { toast.error(`Распознавание: ${e.error}`); setListening(false); }; r.onend = () => { setListening(false); setInterim(""); }; rec.current = r; r.start(); setListening(true); };
  useEffect(() => () => rec.current?.stop(), []);
  return (
    <div className="space-y-3">
      <Note>Распознавание речи выполняет ваш браузер (Web Speech API; в Chrome/Edge аудио может обрабатываться облачным сервисом браузера). Команда никогда не исполняется без вашего подтверждения. Для сложных запросов используйте «Команды на естественном языке».</Note>
      {!supported && <Note tone="warn">Этот браузер не поддерживает SpeechRecognition (нужен Chrome/Edge/Safari). Можно ввести команду текстом ниже.</Note>}
      <div className="flex items-center gap-2"><Button size="sm" disabled={!supported} onClick={() => (listening ? rec.current?.stop() : start())}>{listening ? <><MicOff />Остановить</> : <><Mic />Говорить</>}</Button>{listening && <span className="text-xs text-accent-soft" role="status">слушаю… {interim}</span>}</div>
      <Field label="Расшифровка (можно править)"><input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="открой файл readme / создай файл notes.md / покажи расходы" /></Field>
      {text && (plan ? <Card title="Распознанное действие"><p className="text-xs">{plan.label}</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => { plan.run(); setLog((l) => [`${new Date().toLocaleTimeString()} — ${plan.label}`, ...l]); setText(""); }}>Подтвердить и выполнить</Button><Button size="sm" variant="ghost" onClick={() => setText("")}>Отклонить</Button></div></Card> : <Note tone="warn">Команда не распознана. Поддерживается: «открой файл …», «создай файл …», «терминал», «проводник», названия инструментов (поиск, расходы, снапшот, агент, секрет, здоровье…).</Note>)}
      {log.length > 0 && <Card title="Выполнено"><ul className="text-[11px] text-subtle">{log.map((l, i) => <li key={i}>{l}</li>)}</ul></Card>}
    </div>
  );
}

/* ------------------------------- 47. Collaboration -------------------------- */

export function CollabPanel() {
  const [room, setRoom] = useState<Room | null>(null); const [, force] = useState(0); const [code, setCode] = useState("team-1"); const [name, setName] = useState("Участник"); const [role, setRole] = useState<Role>("editor"); const [cm, setCm] = useState(""); const active = useIdeStore((s) => s.activePath);
  useEffect(() => () => room?.close(), [room]);
  const join = () => { const r = new Room(code.trim() || "room", name.trim() || "Участник", role); r.onChange = () => force((n) => n + 1); setRoom(r); };
  return (
    <div className="space-y-3">
      <Note tone="warn">Режим: вкладки/окна одного браузера (BroadcastChannel). Синхронизация — CRDT уровня файла (LWW-регистр, часы Лэмпорта): изменения сходятся без конфликтов, но при одновременной правке одного файла побеждает последняя. Удалённая работа между устройствами требует WebSocket/WebRTC-сервера, которого нет в serverless-развёртывании на Vercel.</Note>
      {!room ? <Card title="Присоединиться к комнате"><div className="grid gap-2 sm:grid-cols-3"><Field label="Код комнаты"><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} /></Field><Field label="Имя"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Доступ"><select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}><option value="host">владелец</option><option value="editor">редактор</option><option value="viewer">только чтение</option></select></Field></div><Button size="sm" className="mt-2" onClick={join}><Users />Войти</Button><p className="mt-2 text-[10px] text-muted">Откройте Nexus IDE во второй вкладке и войдите в ту же комнату.</p></Card> : <>
        <Card title={`Комната «${room.code}» · вы: ${room.me.name} (${room.me.role})`} actions={<Button size="xs" variant="ghost" onClick={() => { room.close(); setRoom(null); }}>Выйти</Button>}>
          {room.peers.size === 0 ? <Empty>Других участников нет. Если участник отключится, он исчезнет из списка через ~9 секунд.</Empty> : <ul className="space-y-1">{[...room.peers.values()].map((p) => <li key={p.id} className="flex items-center gap-2 text-xs"><i className="size-2.5 rounded-full" style={{ background: p.color }} /><b>{p.name}</b><Badge>{p.role}</Badge><span className="text-muted">{p.path ? `${p.path}${p.line ? `:${p.line}` : ""}` : "—"}</span></li>)}</ul>}
          {room.me.role === "viewer" && <p className="mt-1 text-[11px] text-amber-300">Вы в режиме чтения: ваши правки не рассылаются.</p>}</Card>
        <Card title="Комментарии к файлу"><div className="flex gap-2"><input className={inputCls} placeholder={active ? `Комментарий к ${active}` : "Откройте файл"} value={cm} onChange={(e) => setCm(e.target.value)} disabled={!active} /><Button size="sm" disabled={!cm.trim() || !active} onClick={() => { room.addComment(active ?? "", room.me.line ?? 1, cm.trim()); setCm(""); }}>Отправить</Button></div>
          <ul className="mt-2 space-y-1 text-xs">{room.comments.map((c) => <li key={c.id}><b>{c.author}</b> <button className="font-mono text-[10px] text-accent-soft hover:underline" onClick={() => openFileInIde(c.path, c.line)}>{c.path}</button> — {c.text}</li>)}</ul></Card></>}
    </div>
  );
}

/* ----------------------------- 49. Security auditor ------------------------- */

const RISK_TONE: Record<Risk, "error" | "warn" | "muted"> = { critical: "error", high: "error", medium: "warn", low: "muted" };
interface Vuln { package: string; version: string; id: string; summary: string; severity: string; fixedIn?: string }
export function SecurityPanel() {
  const files = useFiles(); const allow = useNexus((s) => s.data.secretAllow); const findings = useMemo(() => auditCode(files, allow), [files, allow]); const [vulns, setVulns] = useState<Vuln[] | null>(null); const [checked, setChecked] = useState(0); const { busy, error, run } = useBusy();
  const q = osvQueries(files); const byRisk = (r: Risk) => findings.filter((f) => f.risk === r).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">{(["critical", "high", "medium", "low"] as Risk[]).map((r) => <Badge key={r} tone={RISK_TONE[r]}>{r}: {byRisk(r)}</Badge>)}<Badge tone={vulns?.length ? "error" : "muted"}>уязвимых зависимостей: {vulns ? vulns.length : "не проверено"}</Badge></div>
      <Card title="Уязвимые зависимости (OSV.dev)" actions={<Button size="xs" disabled={busy || q.length === 0} onClick={() => void run(async () => { const r = await nexusJson<{ vulnerabilities: Vuln[]; checked: number }>("/api/nexus/osv", { method: "POST", body: JSON.stringify({ packages: q.slice(0, 150) }) }); setVulns(r.vulnerabilities); setChecked(r.checked); })}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Проверить {q.length} пакетов</Button>}>
        {error && <Note tone="error">{error}</Note>}{q.length === 0 && <Empty>В проекте нет package.json с версиями</Empty>}{vulns && (vulns.length === 0 ? <Note tone="ok">Известных уязвимостей не найдено (проверено пакетов: {checked}; версии берутся как минимальные из диапазона)</Note> : <ul className="space-y-1">{vulns.map((v) => <li key={v.id + v.package} className="rounded border border-border p-2 text-xs"><div className="flex items-center gap-2"><Badge tone="error">{v.severity}</Badge><b>{v.package}@{v.version}</b><a className="text-accent-soft underline" href={`https://osv.dev/${v.id}`} target="_blank" rel="noopener noreferrer">{v.id}</a></div><p className="text-subtle">{v.summary}</p>{v.fixedIn && <p className="text-emerald-300">Исправлено в {v.fixedIn}: npm install {v.package}@{v.fixedIn}</p>}</li>)}</ul>)}</Card>
      <Card title={`Анализ кода (${findings.length})`}>{findings.length === 0 ? <Note tone="ok">Рискованных конструкций, секретов и API без проверки доступа не найдено</Note> : <ul className="space-y-1.5">{findings.slice(0, 60).map((f, i) => <li key={i} className="rounded border border-border p-2 text-xs"><div className="flex flex-wrap items-center gap-2"><Badge tone={RISK_TONE[f.risk]}>{f.risk}</Badge><Badge>{f.category}</Badge><b>{f.title}</b><button className="font-mono text-[11px] text-accent-soft hover:underline" onClick={() => openFileInIde(f.path, f.line)}>{f.path}:{f.line}</button></div><pre className="mt-1 overflow-auto rounded bg-background p-1.5 font-mono text-[10px]">{f.evidence}</pre><p className="mt-1 text-[11px] text-emerald-300">Исправление: {f.fix}</p></li>)}</ul>}
        <p className="mt-2 text-[10px] text-muted">Это статический анализ по правилам: возможны ложные срабатывания и пропуски. Подавить строку — комментарий <code>nexus-ignore</code>.</p></Card>
    </div>
  );
}

/* ----------------------------- 50. Mission control -------------------------- */

function Stat({ l, v, sub, onClick, tone }: { l: string; v: string | number; sub?: string; onClick?: () => void; tone?: "error" | "ok" }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-border bg-panel-2 p-3 text-left hover:border-accent/50"><div className="text-[10px] uppercase text-muted">{l}</div><div className={cn("text-xl font-semibold", tone === "error" && "text-red-300", tone === "ok" && "text-emerald-300")}>{v}</div>{sub && <div className="text-[10px] text-muted">{sub}</div>}</button>
  );
}

export function MissionPanel() {
  const files = useFiles(); const d = useNexus((s) => s.data); const server = useNexus((s) => s.server); const openTool = useNexus((s) => s.openTool);
  const health = useMemo(() => computeHealth(files, null), [files]); const secrets = useMemo(() => scanFiles(files, d.secretAllow).length, [files, d.secretAllow]);
  const bs = budgetStatus(d.usage, d.budget, d.rates); const te = getTypeErrors().length;
  const running = d.tasks.filter((t) => t.status === "running" || t.status === "queued"); const failed = d.tasks.filter((t) => t.status === "error");
  const notes: { tone: "warn" | "error" | "info"; text: string; go?: [WorkspaceId, string] }[] = [
    ...bs.messages.map((m) => ({ tone: bs.level === "blocked" ? ("error" as const) : ("warn" as const), text: m, go: ["control", "cost"] as [WorkspaceId, string] })),
    ...(secrets ? [{ tone: "error" as const, text: `В проекте найдено секретов: ${secrets}`, go: ["devtools", "secrets"] as [WorkspaceId, string] }] : []),
    ...failed.slice(0, 3).map((t) => ({ tone: "error" as const, text: `Задача «${t.title}» завершилась ошибкой`, go: ["agents", "commander"] as [WorkspaceId, string] })),
    ...(server && !server.features.ai ? [{ tone: "error" as const, text: "На сервере не задан OPENROUTER_API_KEY — AI недоступен" }] : []),
    ...(d.snapshots.length === 0 ? [{ tone: "info" as const, text: "Снапшотов нет — создайте контрольную точку", go: ["control", "timemachine"] as [WorkspaceId, string] }] : []),
  ];
  const recent = [...d.replay].filter((e) => e.type === "file").slice(-6).reverse();
  return (
    <div className="space-y-3">
      <Card title={`Проект: ${d.project}`}><p className="text-[11px] text-muted">Nexus IDE хранит одно рабочее пространство в браузере, поэтому «список проектов» состоит из текущего проекта. Мульти-проектность потребует серверного хранилища.</p></Card>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat l="Файлов" v={Object.keys(files).length} sub={`здоровье кода: ${health.score} (${health.grade})`} onClick={() => openTool("intelligence", "health")} />
        <Stat l="Активные агенты" v={running.length} sub={`агентов: ${d.agents.length} · всего задач: ${d.tasks.length}`} onClick={() => openTool("agents", "commander")} />
        <Stat l="Ошибки" v={failed.length + te} sub={`задач: ${failed.length} · типы (Monaco): ${te}`} tone={failed.length + te ? "error" : "ok"} onClick={() => openTool("intelligence", "errorfix")} />
        <Stat l="Тесты" v="н/д" sub="тесты не исполняются в IDE — запускайте npx vitest run" />
        <Stat l="Деплой" v={server?.features.vercel ? "готов" : "не настроен"} sub={server?.features.vercel ? "VERCEL_TOKEN задан" : "нужен VERCEL_TOKEN на сервере"} onClick={() => openTool("devtools", "deploy")} />
        <Stat l="AI сегодня" v={bs.tokensToday.toLocaleString()} sub={`${bs.requestsToday} запросов · ref. $${bs.usdMonth.toFixed(3)}/30д`} tone={bs.level === "blocked" ? "error" : undefined} onClick={() => openTool("control", "cost")} />
        <Stat l="Снапшоты" v={d.snapshots.length} sub={d.snapshots.length ? `последний: ${new Date(d.snapshots[d.snapshots.length - 1]?.ts ?? 0).toLocaleTimeString()}` : "нет"} onClick={() => openTool("control", "timemachine")} />
        <Stat l="Секреты" v={secrets} tone={secrets ? "error" : "ok"} onClick={() => openTool("devtools", "secrets")} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Уведомления">{notes.length === 0 ? <Empty>Всё спокойно</Empty> : <ul className="space-y-1">{notes.map((n, i) => <li key={i}><Note tone={n.tone === "info" ? "info" : n.tone}><span>{n.text}</span>{n.go && <button className="ml-2 underline" onClick={() => openTool(n.go?.[0] ?? "control", n.go?.[1] ?? "")}>открыть</button>}</Note></li>)}</ul>}</Card>
        <Card title="Недавние изменения">{recent.length === 0 ? <Empty>Изменений от агентов ещё не было</Empty> : <ul className="space-y-1 text-xs">{recent.map((e) => <li key={e.id}><span className="text-[10px] text-muted">{new Date(e.ts).toLocaleTimeString()}</span> {e.title}</li>)}</ul>}</Card></div>
    </div>
  );
}

export { getEditorSelection, workspaceFiles };
