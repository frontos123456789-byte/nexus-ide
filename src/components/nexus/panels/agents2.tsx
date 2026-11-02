"use client";

import { useMemo, useRef, useState } from "react";
import { GitBranch, Loader2, Play, Plus, Save, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askAi, workspaceFiles } from "@/lib/nexus/actions";
import { buildContext, extractJson, FILE_FORMAT_HINT, parseFileBlocks } from "@/lib/nexus/changes";
import { diagnoseWorkspace } from "@/lib/nexus/audit";
import { emptyIndex, search, updateIndex } from "@/lib/nexus/search";
import { scanFiles } from "@/lib/nexus/secrets";
import { emptyWorkflow, runWorkflow, validateWorkflow, type WfEvent, type WfNode, type WfNodeType, type Workflow } from "@/lib/nexus/workflow";
import { memoryContext } from "@/lib/nexus/memory";
import { useNexus } from "@/lib/nexus/store";
import { uid, type Change } from "@/lib/nexus/types";
import { cn } from "@/lib/utils/cn";
import { Badge, Card, ChangeSet, Empty, Field, Note, AiTool, getTypeErrors, inputCls, useBusy } from "../ui";

/* ------------------------------ 2. Workflow -------------------------------- */

const NODE_W = 150;
const NODE_H = 54;
const TYPE_COLOR: Record<WfNodeType, string> = { input: "#38bdf8", agent: "#818cf8", condition: "#fbbf24", merge: "#34d399", output: "#f472b6" };
const TYPE_RU: Record<WfNodeType, string> = { input: "Вход", agent: "Агент", condition: "Условие", merge: "Слияние", output: "Выход" };

export function WorkflowPanel() {
  const { workflows, agents } = useNexus((s) => s.data);
  const update = useNexus((s) => s.update);
  const [curId, setCurId] = useState<string | null>(null);
  const [selNode, setSelNode] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [branch, setBranch] = useState<"true" | "false">("true");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const ctl = useRef<AbortController | null>(null);
  const wf = workflows.find((w) => w.id === (curId ?? workflows[0]?.id));
  const mut = (fn: (w: Workflow) => Workflow) => wf && update("workflows", (all) => all.map((w) => (w.id === wf.id ? { ...fn(w), updatedAt: Date.now() } : w)));
  const node = wf?.nodes.find((n) => n.id === selNode);
  const toSvg = (e: React.PointerEvent) => {
    const pt = svg.current?.createSVGPoint();
    const ctm = svg.current?.getScreenCTM();
    if (!pt || !ctm) return { x: 0, y: 0 };
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const addNode = (type: WfNodeType) => mut((w) => ({ ...w, nodes: [...w.nodes, { id: uid("nd"), type, x: 200 + (w.nodes.length % 3) * 40, y: 40 + (w.nodes.length % 5) * 60, title: TYPE_RU[type], config: type === "agent" ? { prompt: "Обработай входные данные", retries: 1, agentId: agents[0]?.id } : type === "condition" ? { mode: "notEmpty" } : {} }] }));
  const connect = (to: string) => {
    if (!from || from === to || !wf) return setFrom(null);
    const src = wf.nodes.find((n) => n.id === from);
    if (wf.edges.some((e) => e.from === from && e.to === to)) return setFrom(null);
    mut((w) => ({ ...w, edges: [...w.edges, { id: uid("ed"), from, to, branch: src?.type === "condition" ? branch : undefined }] }));
    setFrom(null);
  };
  const run = async () => {
    if (!wf) return;
    const errs = validateWorkflow(wf);
    if (errs.length) return setErr(errs.join("; "));
    setErr(null); setStatus({}); setOutputs({}); setRunning(true);
    const c = new AbortController(); ctl.current = c;
    const guard = { calls: 0, max: 30 };
    try {
      await runWorkflow(wf, {
        input, signal: c.signal,
        onEvent: (e: WfEvent) => { if (e.type === "node") { setStatus((s) => ({ ...s, [e.id]: e.status + (e.error ? `: ${e.error}` : "") })); if (e.output !== undefined) setOutputs((o) => ({ ...o, [e.id]: e.output ?? "" })); } },
        exec: async (n, inp, signal) => {
          const agent = agents.find((a) => a.id === n.config.agentId);
          const r = await askAi({ feature: "workflow", system: agent ? `${agent.instructions} Роль: ${agent.role}.` : "Ты полезный ассистент разработчика. Отвечай по-русски.", prompt: `${n.config.prompt}\n\nВходные данные:\n${inp}`, agent: agent?.name, runBudget: guard, signal, runId: `wf-${wf.id}` });
          return r.text;
        },
      });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setRunning(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Workflow" className={cn(inputCls, "w-48")} value={wf?.id ?? ""} onChange={(e) => { setCurId(e.target.value); setSelNode(null); }}>
          {workflows.length === 0 && <option value="">— нет workflow —</option>}
          {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <Button size="sm" variant="secondary" onClick={() => { const w = emptyWorkflow(); update("workflows", (a) => [...a, w]); setCurId(w.id); }}><Plus /> Новый</Button>
        {wf && <><input aria-label="Название" className={cn(inputCls, "w-44")} value={wf.name} onChange={(e) => mut((w) => ({ ...w, name: e.target.value }))} />
          <Button size="sm" variant="ghost" aria-label="Удалить workflow" onClick={() => { update("workflows", (a) => a.filter((w) => w.id !== wf.id)); setCurId(null); }}><Trash2 /></Button>
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300"><Save className="size-3" />сохраняется автоматически</span></>}
      </div>
      {!wf ? <Empty>Создайте workflow: добавьте узлы «Агент», соедините их и запустите</Empty> : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["agent", "condition", "merge"] as WfNodeType[]).map((t) => <Button key={t} size="xs" variant="secondary" onClick={() => addNode(t)}><Plus />{TYPE_RU[t]}</Button>)}
            <span className="mx-1 text-[10px] text-muted">Соединение: клик по выходу ● затем по входу ○ нужного узла</span>
            {from && <Badge tone="warn">выберите вход целевого узла</Badge>}
            <select aria-label="Ветка условия" className={cn(inputCls, "w-28")} value={branch} onChange={(e) => setBranch(e.target.value as "true" | "false")}><option value="true">ветка «да»</option><option value="false">ветка «нет»</option></select>
          </div>
          <div className="overflow-auto rounded-md border border-border bg-background">
            <svg ref={svg} viewBox="0 0 900 380" className="h-[340px] min-w-[700px] w-full touch-none select-none"
              onPointerMove={(e) => { const d = drag.current; if (!d) return; const p = toSvg(e); mut((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === d.id ? { ...n, x: Math.max(0, Math.min(900 - NODE_W, p.x - d.dx)), y: Math.max(0, Math.min(380 - NODE_H, p.y - d.dy)) } : n)) })); }}
              onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
              {wf.edges.map((e) => { const a = wf.nodes.find((n) => n.id === e.from); const b = wf.nodes.find((n) => n.id === e.to); if (!a || !b) return null;
                const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2;
                return <g key={e.id} className="cursor-pointer" onClick={() => mut((w) => ({ ...w, edges: w.edges.filter((x) => x.id !== e.id) }))}><title>Клик — удалить связь</title>
                  <path d={`M${x1},${y1} C${x1 + 60},${y1} ${x2 - 60},${y2} ${x2},${y2}`} fill="none" stroke={e.branch === "false" ? "#f87171" : e.branch === "true" ? "#34d399" : "#52525b"} strokeWidth={2} />
                  {e.branch && <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 4} fontSize={9} fill="#a1a1aa" textAnchor="middle">{e.branch === "true" ? "да" : "нет"}</text>}</g>; })}
              {wf.nodes.map((n) => (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                  <rect width={NODE_W} height={NODE_H} rx={8} fill="#121215" stroke={selNode === n.id ? "#818cf8" : TYPE_COLOR[n.type]} strokeWidth={selNode === n.id ? 2 : 1} className="cursor-grab"
                    tabIndex={0} role="button" aria-label={`Узел ${n.title}`} onKeyDown={(e) => e.key === "Enter" && setSelNode(n.id)}
                    onPointerDown={(e) => { const p = toSvg(e); drag.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }; setSelNode(n.id); }} />
                  <text x={10} y={21} fontSize={11} fill="#e4e4e7" pointerEvents="none">{n.title.slice(0, 18)}</text>
                  <text x={10} y={38} fontSize={9} fill={status[n.id]?.startsWith("error") ? "#f87171" : status[n.id] === "done" ? "#34d399" : "#71717a"} pointerEvents="none">{(status[n.id] ?? TYPE_RU[n.type]).slice(0, 26)}</text>
                  {n.type !== "input" && <circle cx={0} cy={NODE_H / 2} r={6} fill={from ? "#818cf8" : "#27272a"} stroke="#52525b" className="cursor-pointer" onClick={() => connect(n.id)} role="button" aria-label="Вход" />}
                  {n.type !== "output" && <circle cx={NODE_W} cy={NODE_H / 2} r={6} fill={from === n.id ? "#fbbf24" : TYPE_COLOR[n.type]} className="cursor-pointer" onClick={() => setFrom(n.id)} role="button" aria-label="Выход" />}
                </g>))}
            </svg>
          </div>
          {node && (
            <Card title={`Узел: ${TYPE_RU[node.type]}`} actions={node.type !== "input" && node.type !== "output" ? <Button size="xs" variant="ghost" onClick={() => { mut((w) => ({ ...w, nodes: w.nodes.filter((n) => n.id !== node.id), edges: w.edges.filter((e) => e.from !== node.id && e.to !== node.id) })); setSelNode(null); }}><Trash2 />Удалить</Button> : null}>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Название"><input className={inputCls} value={node.title} onChange={(e) => mut((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === node.id ? { ...n, title: e.target.value } : n)) }))} /></Field>
                {node.type === "agent" && <>
                  <Field label="Агент"><select className={inputCls} value={node.config.agentId ?? ""} onChange={(e) => setCfg(mut, node, { agentId: e.target.value || undefined })}><option value="">без роли</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
                  <div className="sm:col-span-2"><Field label="Промпт (вход — данные предыдущих узлов)"><textarea className={cn(inputCls, "min-h-16")} value={node.config.prompt ?? ""} onChange={(e) => setCfg(mut, node, { prompt: e.target.value })} /></Field></div>
                  <Field label="Повторы при ошибке (0–5)"><input type="number" min={0} max={5} className={inputCls} value={node.config.retries ?? 1} onChange={(e) => setCfg(mut, node, { retries: Math.min(5, Math.max(0, Number(e.target.value) || 0)) })} /></Field>
                  <Field label="Таймаут, сек"><input type="number" min={5} max={300} className={inputCls} value={(node.config.timeoutMs ?? 120000) / 1000} onChange={(e) => setCfg(mut, node, { timeoutMs: Math.min(300, Math.max(5, Number(e.target.value) || 5)) * 1000 })} /></Field></>}
                {node.type === "condition" && <>
                  <Field label="Тип условия"><select className={inputCls} value={node.config.mode ?? "notEmpty"} onChange={(e) => setCfg(mut, node, { mode: e.target.value as WfNode["config"]["mode"] })}><option value="notEmpty">вход не пуст</option><option value="contains">содержит текст</option><option value="regex">regex</option></select></Field>
                  <Field label="Значение"><input className={inputCls} value={node.config.expr ?? ""} onChange={(e) => setCfg(mut, node, { expr: e.target.value })} /></Field></>}
              </div>
              {outputs[node.id] && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-[11px]">{outputs[node.id]}</pre>}
            </Card>)}
          <Card title="Запуск">
            <Field label="Входные данные"><textarea className={cn(inputCls, "min-h-14")} value={input} onChange={(e) => setInput(e.target.value)} /></Field>
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" onClick={() => void run()} disabled={running}>{running ? <Loader2 className="animate-spin" /> : <Play />} Запустить</Button>
              {running && <Button size="sm" variant="destructive" onClick={() => ctl.current?.abort()}><Square />Остановить</Button>}
              <span className="text-[10px] text-muted">Узлы без зависимостей выполняются параллельно · лимит 30 AI-вызовов · циклы запрещены</span>
            </div>
            {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
            {wf.nodes.filter((n) => n.type === "output").map((n) => outputs[n.id] && <pre key={n.id} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs">{outputs[n.id]}</pre>)}
          </Card>
        </>)}
    </div>
  );
}

function setCfg(mut: (fn: (w: Workflow) => Workflow) => unknown, node: WfNode, patch: Partial<WfNode["config"]>) {
  mut((w) => ({ ...w, nodes: w.nodes.map((n) => (n.id === node.id ? { ...n, config: { ...n.config, ...patch } } : n)) }));
}

/* -------------------------------- 5. Debate -------------------------------- */

interface Round { role: string; text: string }

export function DebatePanel() {
  const [topic, setTopic] = useState("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const { busy, error, run } = useBusy();
  const update = useNexus((s) => s.update);
  const go = () => void run(async () => {
    setRounds([]);
    const files = workspaceFiles();
    const ctx = buildContext(files, [], 8000);
    const guard = { calls: 0, max: 3 };
    const ask = (role: string, system: string, prompt: string) => askAi({ feature: "debate", system, prompt, agent: role, runBudget: guard, runId: `debate-${Date.now()}`, task: "reasoning" });
    const a = await ask("Архитектор", "Ты архитектор ПО. Предложи решение: 2–3 варианта архитектуры с плюсами, минусами и рекомендацией. По-русски, структурно.", `Задача: ${topic}\n\n${ctx}`);
    setRounds([{ role: "Архитектор (предложение)", text: a.text }]);
    const b = await ask("Критик", "Ты строгий критик. Найди слабые места, риски, скрытые ограничения предложения. Не хвали. Конкретно, по пунктам.", `Задача: ${topic}\n\nПредложение архитектора:\n${a.text}`);
    setRounds((r) => [...r, { role: "Критик (недостатки)", text: b.text }]);
    const c = await ask("Судья", "Ты технический лид. Сравни варианты и критику. Выдай: таблицу сравнения, ограничения, ИТОГОВОЕ РЕШЕНИЕ и обоснование.", `Задача: ${topic}\n\nПредложение:\n${a.text}\n\nКритика:\n${b.text}`);
    setRounds((r) => [...r, { role: "Судья (итог)", text: c.text }]);
  });
  const final = rounds[2];
  return (
    <div className="space-y-3">
      <Field label="Вопрос для обсуждения"><textarea className={cn(inputCls, "min-h-16")} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Как организовать хранение состояния: Zustand или Redux?" /></Field>
      <Button size="sm" onClick={go} disabled={busy || !topic.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Play />} Начать дебаты (3 агента)</Button>
      {error && <Note tone="error">{error}</Note>}
      {rounds.length === 0 && !busy && <Empty>Агенты поочерёдно: предложат решение, найдут недостатки и вынесут итог</Empty>}
      <div className="grid gap-2 lg:grid-cols-3">{rounds.map((r) => <Card key={r.role} title={r.role}><pre className="max-h-96 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed">{r.text}</pre></Card>)}</div>
      {final && <Button size="sm" variant="secondary" onClick={() => { update("memory", (m) => [...m, { id: uid("mem"), kind: "architecture", title: `Дебаты: ${topic.slice(0, 60)}`, body: final.text.slice(0, 1500), tags: ["debate"], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]); toast.success("Решение сохранено в память проекта"); }}>Сохранить решение в память</Button>}
    </div>
  );
}

/* ------------------------------ 8. Bug Hunter ------------------------------ */

export function BugHunterPanel() {
  const [err, setErr] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [related, setRelated] = useState<string[]>([]);
  const [cause, setCause] = useState<{ cause?: string; explanation?: string } | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [verify, setVerify] = useState<string | null>(null);
  const { busy, error, run } = useBusy();
  const memory = useNexus((s) => s.data.memory);
  const log = (s: string) => setSteps((x) => [...x, s]);
  const hunt = () => void run(async () => {
    setSteps([]); setCause(null); setChanges([]); setVerify(null);
    const files = workspaceFiles();
    log("1. Ошибка получена");
    const named = [...err.matchAll(/([\w@./-]+\.(?:tsx?|jsx?|mjs|css|html|json))(?::\d+)?/g)].map((m) => m[1] ?? "").map((p) => Object.keys(files).find((f) => f === p || f.endsWith(`/${p.split("/").pop()}`))).filter((x): x is string => Boolean(x));
    const idx = emptyIndex(); updateIndex(idx, files);
    const hits = search(idx, err.replace(/[^\w\s]/g, " ").slice(0, 300), { limit: 4 }).map((h) => h.path);
    const rel = [...new Set([...named, ...hits])].slice(0, 6);
    setRelated(rel);
    log(`2. Связанные файлы: ${rel.join(", ") || "не найдены"}`);
    log("3–5. Анализ причины, воспроизводящий тест и исправление…");
    const system = `Ты инженер-отладчик. Алгоритм: определи вероятную причину, напиши воспроизводящий тест (vitest, файл *.test.ts рядом с кодом) и минимальное исправление.\nСначала выведи JSON в блоке \`\`\`json {"cause":"...","explanation":"..."} \`\`\`, затем файлы.\n${FILE_FORMAT_HINT}`;
    const r = await askAi({ feature: "bug-hunter", system, prompt: `Ошибка:\n${err}\n\n${memoryContext(memory, err, 1000)}\n${buildContext(files, rel)}`, task: "code", runId: `bug-${Date.now()}` });
    const j = extractJson<{ cause?: string; explanation?: string }>(r.text);
    setCause(j ?? { explanation: r.text.slice(0, 800) });
    const cs = parseFileBlocks(r.text, files);
    setChanges(cs);
    log(`6. Предложено файлов: ${cs.length} — применение только после вашего подтверждения`);
  });
  const check = () => {
    const files = workspaceFiles();
    const issues = diagnoseWorkspace(files, null).filter((i) => i.severity === "error");
    const te = getTypeErrors();
    const sec = scanFiles(files);
    const tests = changes.filter((c) => /\.(test|spec)\./.test(c.path)).map((c) => c.path);
    setVerify(`Ошибок типов (Monaco): ${te.length}. Критичных проблем окружения: ${issues.length}. Найдено секретов: ${sec.length}.\nИсполнить тесты в браузере нельзя — запустите локально: npx vitest run ${tests.join(" ") || "<файл теста>"}`);
  };
  return (
    <div className="space-y-3">
      <Field label="Текст ошибки / stack trace"><textarea className={cn(inputCls, "min-h-24 font-mono")} value={err} onChange={(e) => setErr(e.target.value)} placeholder={"TypeError: Cannot read properties of undefined (reading 'map')\n    at List (src/components/List.tsx:12:20)"} /></Field>
      <div className="flex gap-2"><Button size="sm" onClick={hunt} disabled={busy || !err.trim()}>{busy ? <Loader2 className="animate-spin" /> : <Play />} Найти и предложить исправление</Button>
        {changes.length > 0 && <Button size="sm" variant="secondary" onClick={check}>Проверить после применения</Button>}</div>
      {error && <Note tone="error">{error}</Note>}
      {steps.length > 0 && <Card title="Ход расследования"><ol className="space-y-1 text-xs text-subtle">{steps.map((s, i) => <li key={i}>{s}</li>)}</ol></Card>}
      {cause && <Card title="Вероятная причина"><p className="text-xs font-medium">{cause.cause}</p><p className="mt-1 whitespace-pre-wrap text-xs text-subtle">{cause.explanation}</p>{related.length > 0 && <p className="mt-2 text-[10px] text-muted">Файлы: {related.join(", ")}</p>}</Card>}
      {changes.length > 0 && <Card title="Исправление и воспроизводящий тест"><ChangeSet changes={changes} source="Bug Hunter" /></Card>}
      {verify && <Note tone="info"><pre className="whitespace-pre-wrap font-sans">{verify}</pre></Note>}
    </div>
  );
}

/* ------------------------- 9 / 48. Architect & Blueprint ------------------- */

const ARCH_SYSTEM = "Ты ведущий архитектор ПО. Анализируй требования, предлагай структуру проекта, API-контракты и поясняй каждое решение (почему так, какие альтернативы). Создавай документацию и каркас модулей файлами.";
export function ArchitectPanel() {
  return (
    <AiTool feature="architect" title="Спроектировать" hint="Опишите требования. Архитектор вернёт анализ, структуру, API-контракты и создаст docs/ARCHITECTURE.md, docs/API.md и каркас модулей (применяются после подтверждения)." inputLabel="Требования" placeholder="Сервис заметок с авторизацией, тегами и поиском" system={ARCH_SYSTEM} expectChanges task="code"
      build={(i) => `Требования:\n${i}\n\nСделай: 1) анализ требований; 2) структура проекта; 3) docs/ARCHITECTURE.md с обоснованием решений; 4) docs/API.md с контрактами (метод, путь, вход, выход, ошибки); 5) каркасы ключевых модулей (src/...).`} />
  );
}

export function BlueprintPanel() {
  return (
    <AiTool feature="blueprint" title="Сгенерировать blueprint" hint="Из технического задания: архитектурный план, структура файлов, задачи, компоненты, API-контракты, тестовая стратегия и критерии готовности — в docs/blueprint/." inputLabel="Техническое задание" placeholder="Вставьте ТЗ…" system={`${ARCH_SYSTEM} Не выдумывай требований, которых нет в ТЗ; пробелы отмечай как «Вопрос».`} expectChanges task="code"
      build={(i) => `ТЗ:\n${i}\n\nСоздай файлы: docs/blueprint/PLAN.md (архитектура), STRUCTURE.md (дерево файлов), TASKS.md (список задач с чекбоксами), COMPONENTS.md, API.md (контракты), TESTING.md (тестовая стратегия), ACCEPTANCE.md (критерии готовности).`} />
  );
}

export { GitBranch };
