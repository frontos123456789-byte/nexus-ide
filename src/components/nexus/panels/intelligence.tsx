"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askAi, workspaceFiles } from "@/lib/nexus/actions";
import { buildContext, FILE_FORMAT_HINT, parseFileBlocks } from "@/lib/nexus/changes";
import { buildDependencyGraph, parseImports, resolveImport } from "@/lib/nexus/graph";
import { computeHealth, type HealthReport } from "@/lib/nexus/health";
import { emptyIndex, search, updateIndex, type SearchHit, type SearchIndex } from "@/lib/nexus/search";
import { useNexus } from "@/lib/nexus/store";
import type { Change } from "@/lib/nexus/types";
import { cn } from "@/lib/utils/cn";
import { ALL_KINDS, AiTool, Badge, Card, ChangeSet, Empty, Field, GraphView, Note, getEditorSelection, getTypeErrors, inputCls, openFileInIde, useBusy, useFiles } from "../ui";
import type { NodeKind } from "@/lib/nexus/graph";

/* ---------------------------- 12. Semantic search --------------------------- */

export function SearchPanel() {
  const files = useFiles();
  const idx = useRef<SearchIndex>(emptyIndex());
  const [indexed, setIndexed] = useState(0);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [last, setLast] = useState<number | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const changed = updateIndex(idx.current, files);
      setIndexed(idx.current.hashes.size);
      if (changed) setLast(changed);
    }, 300);
    return () => clearTimeout(t);
  }, [files]);
  useEffect(() => {
    const t = setTimeout(() => setHits(q.trim() ? search(idx.current, q, { pathFilter: filter }) : []), 150);
    return () => clearTimeout(t);
  }, [q, filter, indexed, files]);
  return (
    <div className="space-y-3">
      <Note>Поиск по смыслу без внешних сервисов: токенизация идентификаторов (camelCase, snake_case), расширение запроса синонимами (auth → login, session, token…) и ранжирование BM25. Индекс обновляется инкрементально при изменении файлов. Векторные эмбеддинги не используются.</Note>
      <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
        <Field label="Запрос"><div className="relative"><Search className="absolute left-2 top-2 size-3.5 text-muted" /><input autoFocus className={cn(inputCls, "pl-7")} placeholder="где проверяется авторизация пользователя?" value={q} onChange={(e) => setQ(e.target.value)} /></div></Field>
        <Field label="Фильтр по пути" hint="* — любая подстрока"><input className={inputCls} placeholder="src/*.tsx" value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
      </div>
      <p className="text-[10px] text-muted">В индексе файлов: {indexed}{last ? ` · последнее обновление: ${last} файл(ов)` : ""}</p>
      {q.trim() && hits.length === 0 && <Empty>Ничего не найдено</Empty>}
      <ul className="space-y-1.5">{hits.map((h) => (
        <li key={h.path}><button onClick={() => openFileInIde(h.path, h.start)} className="w-full rounded-md border border-border bg-panel-2 p-2 text-left hover:border-accent/50">
          <div className="flex items-center gap-2 text-xs"><span className="font-mono text-foreground">{h.path}</span><span className="text-[10px] text-muted">строки {h.start}–{h.end}</span><Badge tone="accent">{h.score.toFixed(1)}</Badge></div>
          <pre className="mt-1 max-h-20 overflow-hidden font-mono text-[10px] text-subtle">{h.snippet}</pre></button></li>))}</ul>
    </div>
  );
}

/* ------------------------------ 13. Refactoring ----------------------------- */

function renameAcross(files: Record<string, string>, from: string, to: string, scope: string): Change[] {
  const re = new RegExp(`(?<![\\w$.])${from.replace(/[$]/g, "\\$")}(?![\\w$])|(?<=\\.)${from.replace(/[$]/g, "\\$")}(?![\\w$])`, "g");
  const out: Change[] = [];
  for (const [path, src] of Object.entries(files)) {
    if (!/\.[mc]?[jt]sx?$/.test(path) || (scope && !path.startsWith(scope))) continue;
    const next = src.replace(re, to);
    if (next !== src) out.push({ path, before: src, after: next });
  }
  return out;
}

export function RefactorPanel() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [scope, setScope] = useState("");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [mode, setMode] = useState("extract");
  const valid = /^[A-Za-z_$][\w$]*$/.test(from) && /^[A-Za-z_$][\w$]*$/.test(to) && from !== to;
  const MODES: Record<string, string> = {
    extract: "Извлеки повторяющийся/длинный фрагмент в отдельную функцию с понятным именем. Поведение не менять.",
    dedupe: "Найди дублирующийся код и сведи его к общей функции/модулю. Обнови все места использования.",
    restructure: "Предложи и выполни улучшение структуры модулей (разнеси по файлам, обнови импорты). Публичный API сохрани.",
  };
  return (
    <div className="space-y-3">
      <Card title="Переименование символа (по всему проекту, без AI)">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Текущее имя"><input className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Новое имя"><input className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Папка (необязательно)"><input className={inputCls} placeholder="src/" value={scope} onChange={(e) => setScope(e.target.value)} /></Field>
        </div>
        <div className="mt-2 flex items-center gap-2"><Button size="sm" disabled={!valid} onClick={() => setChanges(renameAcross(workspaceFiles(), from, to, scope))}>Предпросмотр</Button>
          <span className="text-[10px] text-muted">Заменяются целые слова вне точечной нотации (кроме обращений к свойству). Проверьте diff: строки и комментарии тоже затрагиваются.</span></div>
        {changes && (changes.length === 0 ? <div className="mt-2"><Empty>Совпадений не найдено</Empty></div> : <div className="mt-2"><ChangeSet changes={changes} source={`Rename ${from}→${to}`} /></div>)}
      </Card>
      <Card title="Другие рефакторинги (AI)">
        <AiTool feature="refactor" title="Предложить рефакторинг" withFile expectChanges task="code" inputLabel="Уточнение" placeholder="Что именно улучшить (необязательно)" system="Ты опытный инженер-рефакторер. Сохраняй поведение, типы и публичные API. Не добавляй зависимости."
          extra={<Field label="Вид рефакторинга"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)}><option value="extract">Извлечение функции</option><option value="dedupe">Удаление дублирования</option><option value="restructure">Структура модулей</option></select></Field>}
          build={(i, f) => `${MODES[mode]}\nФайл: ${f || "(весь проект)"}\n${i}\nПосле изменений перечисли, что нужно проверить (tsc, тесты).`} />
        <p className="mt-2 text-[10px] text-muted">Перед применением автоматически создаётся контрольная точка (Time Machine); откат — кнопкой «Откатить применённое» или из снапшота. Проверка типов: вкладка «Здоровье кода» показывает ошибки Monaco до и после.</p>
      </Card>
    </div>
  );
}

/* ------------------------------ 14. Explanation ----------------------------- */

export function ExplainPanel() {
  return (
    <AiTool feature="explain" title="Объяснить" withFile inputLabel="Код для объяснения" placeholder="Выделите код в редакторе и нажмите «Взять выделение»" task="reasoning"
      system="Ты ментор-разработчик. Объясни код: назначение, как работает по шагам, зависимости и где он используется в проекте, подводные камни. Опирайся только на предоставленный контекст."
      prefill={{ label: "Взять выделение из редактора", get: () => { const s = getEditorSelection(); return s ? { input: s.text, file: s.path } : null; } }}
      build={(i, f, files) => {
        const deps = f ? parseImports(files[f] ?? "").map((s) => resolveImport(f, s, new Set(Object.keys(files)))).filter((x): x is string => Boolean(x)) : [];
        const users = f ? Object.keys(files).filter((p) => p !== f && parseImports(files[p] ?? "").some((s) => resolveImport(p, s, new Set(Object.keys(files))) === f)) : [];
        return `Объясни следующий код${f ? ` из ${f}` : ""}:\n\n${i || files[f]?.slice(0, 6000) || ""}\n\nЗависимости файла: ${deps.join(", ") || "нет"}\nКто импортирует файл: ${users.join(", ") || "никто"}`;
      }} />
  );
}

/* ------------------------------ 15. Smart error fix ------------------------- */

export function ErrorFixPanel() {
  const [errs, setErrs] = useState<ReturnType<typeof getTypeErrors>>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [expl, setExpl] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [after, setAfter] = useState<number | null>(null);
  const { busy, error, run } = useBusy();
  const refresh = () => setErrs(getTypeErrors());
  useEffect(() => { const t = setTimeout(refresh, 0); return () => clearTimeout(t); }, []);
  const fix = (i: number) => void run(async () => {
    const e = errs[i]; if (!e) return;
    setSel(i); setExpl(""); setChanges([]); setAfter(null);
    const files = workspaceFiles();
    const r = await askAi({ feature: "error-fix", task: "code", runId: `fix-${Date.now()}`, system: `Ты исправляешь ошибки TypeScript. Сначала 1–3 предложения: причина ошибки. Затем исправленный файл целиком.\n${FILE_FORMAT_HINT}`, prompt: `Ошибка в ${e.path}:${e.line}: ${e.message}\n\n${buildContext(files, [e.path], 16_000)}` });
    setExpl(r.text.replace(/===\s*FILE:[\s\S]*?===\s*END FILE\s*===/g, "").trim());
    setChanges(parseFileBlocks(r.text, files));
  });
  return (
    <div className="space-y-3">
      <Note>Список берётся из диагностики Monaco (TypeScript) открытых файлов. Откройте файл с ошибкой, чтобы он появился здесь.</Note>
      <div className="flex items-center gap-2"><Button size="sm" variant="secondary" onClick={refresh}><RefreshCw />Обновить</Button><Badge tone={errs.length ? "error" : "ok"}>{errs.length} ошибок</Badge>{after !== null && <Badge tone={after < errs.length ? "ok" : "warn"}>после проверки: {after}</Badge>}</div>
      {errs.length === 0 ? <Empty>Ошибок диагностики нет</Empty> : <ul className="space-y-1">{errs.slice(0, 40).map((e, i) => (
        <li key={i} className={cn("flex items-center gap-2 rounded border border-border px-2 py-1.5 text-xs", sel === i && "border-accent/60")}><button className="min-w-0 flex-1 text-left" onClick={() => openFileInIde(e.path, e.line)}><span className="font-mono text-[11px]">{e.path}:{e.line}</span><div className="truncate text-red-300">{e.message}</div></button>
          <Button size="xs" onClick={() => fix(i)} disabled={busy}>{busy && sel === i ? <Loader2 className="animate-spin" /> : null}Исправить</Button></li>))}</ul>}
      {error && <Note tone="error">{error}</Note>}
      {expl && <Card title="Причина"><p className="whitespace-pre-wrap text-xs">{expl}</p></Card>}
      {changes.length > 0 && <Card title="Предлагаемый diff" actions={<Button size="xs" variant="secondary" onClick={() => setTimeout(() => { setAfter(getTypeErrors().length); refresh(); }, 1500)}>Проверить результат</Button>}><ChangeSet changes={changes} source="Smart Error Fix" /></Card>}
    </div>
  );
}

/* -------------------------------- 18. Tests -------------------------------- */

export function TestGenPanel() {
  const files = useFiles();
  const fw = useMemo(() => { try { const p = JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }; const d = { ...p.devDependencies, ...p.dependencies }; return d["vitest"] ? "vitest" : d["jest"] ? "jest" : d["@playwright/test"] ? "playwright" : d["mocha"] ? "mocha" : null; } catch { return null; } }, [files]);
  return (
    <AiTool feature="test-gen" title="Сгенерировать тесты" withFile fileFilter={/\.[mc]?[jt]sx?$/} expectChanges task="code" inputLabel="Что покрыть (необязательно)" placeholder="граничные случаи, ошибки"
      hint={`Обнаружен фреймворк: ${fw ?? "не найден — будет использован vitest"}. Тесты создаются файлом рядом с кодом; исполнять их нужно в вашем окружении (в браузере запуск невозможен): npx ${fw ?? "vitest"} run.`}
      system={`Ты QA-инженер. Пиши осмысленные тесты на ${fw ?? "vitest"}: happy path, граничные случаи, ошибки. Импортируй только реально существующие экспорты из файла. Не выдумывай API.`}
      build={(i, f, fl) => `Напиши тесты для ${f}. ${i}\n\nКод файла:\n${fl[f] ?? ""}`} />
  );
}

/* --------------------------------- 20. Health ------------------------------- */

export function HealthPanel() {
  const files = useFiles();
  const [rep, setRep] = useState<HealthReport | null>(null);
  const [te, setTe] = useState<number | null>(null);
  const calc = () => { const n = getTypeErrors().length; const hasModels = (window as unknown as { monaco?: { editor: { getModels(): unknown[] } } }).monaco?.editor.getModels().length; const t = hasModels ? n : null; setTe(t); setRep(computeHealth(files, t)); };
  useEffect(() => { const t = setTimeout(calc, 0); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);
  const tone = (n: number) => (n >= 75 ? "bg-emerald-500" : n >= 50 ? "bg-amber-500" : "bg-red-500");
  if (!rep) return <Empty>Считаем…</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4"><div className={cn("grid size-20 place-items-center rounded-full border-4 text-2xl font-bold", rep.score >= 75 ? "border-emerald-500" : rep.score >= 50 ? "border-amber-500" : "border-red-500")}>{rep.score}</div>
        <div><div className="text-sm font-semibold">Оценка {rep.grade}</div><div className="text-[11px] text-muted">Файлов: {Object.keys(files).length} · ошибки типов: {te ?? "н/д"}</div><Button size="xs" variant="secondary" className="mt-1" onClick={calc}><RefreshCw />Пересчитать</Button></div></div>
      <Card title="Компоненты оценки">{rep.components.map((c) => (
        <div key={c.id} className="mb-2"><div className="flex justify-between text-[11px]"><span>{c.name} <span className="text-muted">· вес {c.weight}%</span></span><span>{c.available ? Math.round(c.value) : "н/д"}</span></div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-hover"><div className={cn("h-full", c.available ? tone(c.value) : "bg-border-strong")} style={{ width: `${c.available ? c.value : 0}%` }} /></div><div className="text-[10px] text-muted">{c.detail}</div></div>))}</Card>
      <Card title="Горячие точки (сложность)">{rep.hotspots.length === 0 ? <Empty>Нет кода для анализа</Empty> : <ul className="space-y-1 text-xs">{rep.hotspots.map((h) => <li key={h.path}><button className="flex w-full justify-between hover:underline" onClick={() => openFileInIde(h.path)}><span className="font-mono">{h.path}</span><span className="text-muted">{h.density.toFixed(0)} ветвл./100 стр · {h.lines} стр</span></button></li>)}</ul>}</Card>
      <Card title="Формула оценки"><p className="text-[11px] leading-relaxed text-subtle">{rep.formula}</p></Card>
    </div>
  );
}

/* --------------------------- 17. Dependency map ----------------------------- */

export function DepMapPanel() {
  const files = useFiles();
  const [q, setQ] = useState("");
  const [ext, setExt] = useState(false);
  const [kinds, setKinds] = useState<Set<NodeKind>>(() => new Set(ALL_KINDS.filter((k) => k !== "task" && k !== "decision")));
  const graph = useMemo(() => buildDependencyGraph(files, { includeExternal: ext }), [files, ext]);
  const k2 = useMemo(() => { const s = new Set(kinds); if (!ext) s.delete("package"); else s.add("package"); return s; }, [kinds, ext]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><input className={cn(inputCls, "w-52")} aria-label="Поиск" placeholder="Поиск модуля…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={ext} onChange={(e) => setExt(e.target.checked)} />внешние пакеты</label>
        {(["component", "api", "test", "module", "config"] as NodeKind[]).map((k) => <label key={k} className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={kinds.has(k)} onChange={() => setKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />{k}</label>)}</div>
      <GraphView graph={graph} query={q} kinds={k2} />
      <p className="text-[10px] text-muted">Клик по узлу открывает файл. Граф строится по import/require/dynamic import; алиас @/ → src/.</p>
    </div>
  );
}

/* ------------------------------ 19. NL commands ------------------------------ */

const NL_EXAMPLES = ["Найди все обращения к API", "Создай страницу /about", "Исправь ошибки типов", "Добавь тесты для utils"];
export function NLCommandPanel() {
  return (
    <AiTool feature="nl-command" title="Составить план и diff" expectChanges task="code" initialInput="" inputLabel="Команда на естественном языке" placeholder={NL_EXAMPLES[0]}
      hint={`Примеры: ${NL_EXAMPLES.join(" · ")}. Сначала вы увидите план, затем diff по каждому файлу — ничего не применяется без подтверждения.`}
      system={`Ты исполнитель команд IDE. Сначала напиши «ПЛАН:» — нумерованный список шагов. Если команда — поиск/вопрос, ответь списком мест (файл:строка) без файловых блоков. Если нужны изменения — добавь файлы.\n${FILE_FORMAT_HINT}`}
      build={(i, _f, files) => {
        const idx = emptyIndex(); updateIndex(idx, files);
        const hits = search(idx, i, { limit: 8 }).map((h) => `${h.path}:${h.start}`).join("\n");
        const errs = getTypeErrors().slice(0, 15).map((e) => `${e.path}:${e.line} ${e.message}`).join("\n");
        return `Команда: ${i}\n\nЛокальный поиск по проекту (релевантные места):\n${hits || "—"}\n\nОшибки типов в редакторе:\n${errs || "—"}`;
      }} />
  );
}

/* -------------------------------- 11. Predictive ---------------------------- */

export function PredictivePanel() {
  const predictive = useNexus((s) => s.data.predictive);
  const patch = useNexus((s) => s.patch);
  return (
    <div className="space-y-3">
      <Note>Многострочные подсказки появляются серым текстом после паузы в наборе (≈0.7 с, не чаще раза в 3.5 с). <b>Tab</b> — принять, <b>Esc</b> — отклонить, <b>Ctrl/Cmd+Z</b> — отменить принятую подсказку. Каждый запрос идёт через роутер моделей и учитывается в бюджете.</Note>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={predictive} onChange={(e) => { patch({ predictive: e.target.checked }); toast(e.target.checked ? "Predictive Editing включён" : "Predictive Editing выключен"); }} />Включить предиктивное редактирование</label>
      <p className="text-[11px] text-muted">Подсказки строятся по ближайшему контексту курсора. Связанные правки в других файлах — через «Рефакторинг» и «Команды».</p>
    </div>
  );
}
