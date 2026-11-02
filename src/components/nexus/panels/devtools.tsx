"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Play, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askAi, nexusJson, requestPermission, workspaceFiles } from "@/lib/nexus/actions";
import { diagnoseWorkspace, type HealIssue } from "@/lib/nexus/audit";
import { extractJson } from "@/lib/nexus/changes";
import { parseConflicts, resolveConflict } from "@/lib/nexus/merge";
import { scanFiles } from "@/lib/nexus/secrets";
import { classifySql } from "@/lib/nexus/sql-guard";
import { useNexus } from "@/lib/nexus/store";
import { uid, type Change } from "@/lib/nexus/types";
import { useIdeStore } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";
import { Badge, Card, ChangeSet, Empty, Field, Note, inputCls, openFileInIde, useBusy, useFiles, usePersisted } from "../ui";

const copy = (t: string) => void navigator.clipboard.writeText(t).then(() => toast.success("Скопировано"));

/* -------------------------- 31. Terminal assistant -------------------------- */

const DANGER: [RegExp, string][] = [
  [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b|\brm\s+-rf?\s+\//, "рекурсивное удаление"], [/\bsudo\b/, "повышение привилегий"], [/(curl|wget)[^|]*\|\s*(ba|z)?sh/, "исполнение скачанного скрипта"],
  [/\bchmod\s+(-R\s+)?777/, "открытые права доступа"], [/\b(mkfs|dd\s+if=|fdisk)\b/, "работа с диском"], [/git\s+push\s+.*(--force|-f\b)/, "force push"], [/git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f/, "потеря изменений"],
  [/npm\s+(i|install)\s+(-g|--global)|npm\s+publish/, "глобальная установка/публикация"], [/>\s*\/dev\/sd|:\(\)\{/, "разрушительная конструкция"], [/\bdrop\s+(table|database)\b/i, "удаление данных БД"],
];
export function classifyCommand(cmd: string): { risk: "low" | "medium" | "high"; reasons: string[] } {
  const reasons = DANGER.filter(([re]) => re.test(cmd)).map(([, r]) => r);
  if (reasons.length) return { risk: "high", reasons };
  if (/\b(npm|pnpm|yarn)\s+(i|install|add|remove|uninstall)\b|\bgit\s+(commit|push|merge|rebase|checkout)\b|\brm\b|\bmv\b/.test(cmd)) return { risk: "medium", reasons: ["изменяет файлы или зависимости"] };
  return { risk: "low", reasons: [] };
}

export function TerminalAssistantPanel() {
  const [q, setQ] = useState(""); const [items, setItems] = useState<{ cmd: string; explanation: string }[]>([]); const [ok, setOk] = useState<Record<number, boolean>>({});
  const { busy, error, run } = useBusy();
  return (
    <div className="space-y-3">
      <Note tone="warn">Ассистент только <b>предлагает</b> команды. Сервер приложения их не исполняет (нет изолированной среды) — копируйте и запускайте в своём терминале/контейнере. Для опасных команд копирование требует подтверждения.</Note>
      <Field label="Что нужно сделать?"><input className={inputCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="найти все TODO в проекте и посчитать" onKeyDown={(e) => e.key === "Enter" && q.trim() && !busy && document.getElementById("term-go")?.click()} /></Field>
      <Button id="term-go" size="sm" disabled={busy || !q.trim()} onClick={() => void run(async () => {
        const pkg = workspaceFiles()["package.json"]?.slice(0, 1500) ?? "нет package.json";
        const r = await askAi({ feature: "terminal", task: "json", system: 'Ты помощник по терминалу (bash). Верни ТОЛЬКО JSON: {"commands":[{"cmd":"...","explanation":"..."}]}. Не больше 4 команд, без sudo, без деструктивных действий если не просили. Объяснения по-русски.', prompt: `Запрос: ${q}\npackage.json:\n${pkg}` });
        setItems(extractJson<{ commands?: { cmd: string; explanation: string }[] }>(r.text)?.commands?.slice(0, 4) ?? []); setOk({});
      })}>{busy ? <Loader2 className="animate-spin" /> : <Play />}Предложить команды</Button>
      {error && <Note tone="error">{error}</Note>}
      {items.length === 0 ? <Empty>Опишите задачу обычными словами</Empty> : items.map((it, i) => { const c = classifyCommand(it.cmd); return (
        <Card key={i} title={<span className="flex items-center gap-2"><code className="font-mono">{it.cmd}</code><Badge tone={c.risk === "high" ? "error" : c.risk === "medium" ? "warn" : "ok"}>риск: {c.risk}</Badge></span>} actions={<Button size="xs" disabled={c.risk === "high" && !ok[i]} onClick={() => copy(it.cmd)}><Copy />Копировать</Button>}>
          <p className="text-xs text-subtle">{it.explanation}</p>{c.reasons.length > 0 && <p className="mt-1 text-[11px] text-amber-300">⚠ {c.reasons.join("; ")}</p>}
          {c.risk === "high" && <label className="mt-1 flex items-center gap-1.5 text-[11px]"><input type="checkbox" checked={Boolean(ok[i])} onChange={(e) => setOk((s) => ({ ...s, [i]: e.target.checked }))} />Я понимаю последствия и запущу команду в изолированной среде</label>}</Card>); })}
    </div>
  );
}

/* ------------------------------ 32. Git timeline ---------------------------- */

interface GitData { repo: string; authenticated: boolean; branches: { name: string; sha: string }[]; commits: { sha: string; message: string; author: string; date: string; parents: string[] }[] }

export function GitTimelinePanel() {
  const [repo, setRepo] = usePersisted("git-repo", ""); const [data, setData] = useState<GitData | null>(null); const [files, setFiles] = useState<{ sha: string; list: { filename: string; status: string; additions: number; deletions: number }[] } | null>(null);
  const replay = useNexus((s) => s.data.replay); const snaps = useNexus((s) => s.data.snapshots);
  const { busy, error, run } = useBusy();
  const load = () => void run(async () => setData(await nexusJson<GitData>(`/api/nexus/git${repo ? `?repo=${encodeURIComponent(repo)}` : ""}`)));
  const heads = useMemo(() => { const m = new Map<string, string[]>(); data?.branches.forEach((b) => m.set(b.sha, [...(m.get(b.sha) ?? []), b.name])); return m; }, [data]);
  const local = useMemo(() => [...snaps.map((s) => ({ ts: s.ts, text: `Снапшот: ${s.label}` })), ...replay.filter((e) => e.type === "start" || e.type === "checkpoint" || e.type === "file").map((e) => ({ ts: e.ts, text: `${e.agent ?? "агент"} · ${e.title}` }))].sort((a, b) => b.ts - a.ts).slice(0, 25), [snaps, replay]);
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2"><div className="flex-1"><Field label="Репозиторий GitHub (owner/name)"><input className={inputCls} value={repo} onChange={(e) => setRepo(e.target.value.trim())} placeholder="по умолчанию NEXUS_GITHUB_REPO" /></Field></div><Button size="sm" onClick={load} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Загрузить</Button></div>
      {error && <Note tone="error">{error}</Note>}
      {data && <Card title={`${data.repo} · ветки: ${data.branches.length}${data.authenticated ? "" : " · без токена (лимит GitHub API)"}`}>
        <ol className="relative ml-2 border-l-2 border-border-strong">{data.commits.map((c) => (
          <li key={c.sha} className="mb-2 ml-4"><span className={cn("absolute -left-[7px] mt-1 size-3 rounded-full border-2 border-background", c.parents.length > 1 ? "bg-amber-400" : "bg-accent")} />
            <button className="text-left text-xs" onClick={() => void run(async () => { const r = await nexusJson<{ files: NonNullable<typeof files>["list"] }>(`/api/nexus/git?repo=${encodeURIComponent(data.repo)}&sha=${c.sha}`); setFiles({ sha: c.sha, list: r.files }); })}>
              <span className="font-medium text-foreground">{c.message}</span> {heads.get(c.sha)?.map((b) => <Badge key={b} tone="accent">{b}</Badge>)}{c.parents.length > 1 && <Badge tone="warn">merge</Badge>}<div className="text-[10px] text-muted">{c.sha.slice(0, 7)} · {c.author} · {new Date(c.date).toLocaleString()}</div></button>
            {files?.sha === c.sha && <ul className="mt-1 font-mono text-[10px] text-subtle">{files.list.map((f) => <li key={f.filename}>{f.status[0]} {f.filename} <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span></li>)}</ul>}</li>))}</ol></Card>}
      <Card title="Локальная история и действия агентов">{local.length === 0 ? <Empty>Событий пока нет</Empty> : <ul className="space-y-1 text-xs">{local.map((e, i) => <li key={i}><span className="text-[10px] text-muted">{new Date(e.ts).toLocaleString()}</span> {e.text}</li>)}</ul>}</Card>
    </div>
  );
}

/* --------------------------- 33. Merge conflict resolver -------------------- */

export function MergePanel() {
  const files = useFiles(); const conflicted = Object.keys(files).filter((p) => parseConflicts(files[p] ?? "").length > 0);
  const [path, setPath] = useState(""); const [work, setWork] = useState<string | null>(null); const [custom, setCustom] = useState("");
  const eff = conflicted.includes(path) ? path : (conflicted[0] ?? "");
  const text = work ?? files[eff] ?? ""; const blocks = parseConflicts(text); const b = blocks[0];
  const { busy, error, run } = useBusy();
  const resolve = (c: "ours" | "theirs" | "both" | { custom: string }) => { setWork(resolveConflict(text, 0, c)); setCustom(""); };
  const changes: Change[] = eff && text !== files[eff] ? [{ path: eff, before: files[eff] ?? null, after: text }] : [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1"><Field label="Файл с конфликтами"><select className={inputCls} value={eff} onChange={(e) => { setPath(e.target.value); setWork(null); }}>{conflicted.length === 0 && <option value="">нет конфликтов</option>}{conflicted.map((p) => <option key={p}>{p}</option>)}</select></Field></div>
        <Button size="sm" variant="secondary" onClick={() => void useIdeStore.getState().upsertFile("conflict-demo.ts", "export const mode =\n<<<<<<< HEAD\n  'fast';\n=======\n  'safe';\n>>>>>>> feature\n", false)}>Создать пример конфликта</Button></div>
      {conflicted.length === 0 && <Empty>Маркеры &lt;&lt;&lt;&lt;&lt;&lt;&lt; / ======= / &gt;&gt;&gt;&gt;&gt;&gt;&gt; в проекте не найдены. Они появляются после git merge/rebase или вставки конфликтного кода.</Empty>}
      {eff && b && <Card title={`Конфликт 1 из ${blocks.length} · строки ${b.start + 1}–${b.end + 1}`}>
        <div className="grid gap-2 md:grid-cols-2"><div><div className="mb-1 text-[11px] text-emerald-300">Ваша версия ({b.oursLabel})</div><pre className="max-h-40 overflow-auto rounded bg-emerald-500/10 p-2 font-mono text-[11px]">{b.ours.join("\n") || "∅"}</pre></div>
          <div><div className="mb-1 text-[11px] text-sky-300">Входящая версия ({b.theirsLabel})</div><pre className="max-h-40 overflow-auto rounded bg-sky-500/10 p-2 font-mono text-[11px]">{b.theirs.join("\n") || "∅"}</pre></div></div>
        <div className="mt-2 flex flex-wrap gap-1.5"><Button size="xs" variant="secondary" onClick={() => resolve("ours")}>Взять вашу</Button><Button size="xs" variant="secondary" onClick={() => resolve("theirs")}>Взять входящую</Button><Button size="xs" variant="secondary" onClick={() => resolve("both")}>Обе</Button>
          <Button size="xs" disabled={busy} onClick={() => void run(async () => { const r = await askAi({ feature: "merge-resolver", task: "code", system: "Ты разрешаешь git-конфликт. Объедини обе версии, сохранив намерения обеих сторон. Верни ТОЛЬКО итоговый код блока без маркеров и без markdown.", prompt: `Файл ${eff}\n\nКонтекст:\n${text.slice(0, 6000)}\n\nНаша версия:\n${b.ours.join("\n")}\n\nВходящая версия:\n${b.theirs.join("\n")}` }); setCustom(r.text.replace(/^```[\w-]*\n?|```\s*$/g, "").trimEnd()); })}>{busy ? <Loader2 className="animate-spin" /> : null}AI-слияние</Button></div>
        {error && <div className="mt-2"><Note tone="error">{error}</Note></div>}
        <Field label="Итог (можно править вручную)"><textarea className={cn(inputCls, "mt-2 min-h-24 font-mono")} value={custom} onChange={(e) => setCustom(e.target.value)} /></Field><Button size="sm" className="mt-2" disabled={!custom} onClick={() => resolve({ custom })}>Применить итог к блоку</Button></Card>}
      {eff && blocks.length === 0 && work !== null && <Note tone="ok">Все конфликты в файле разрешены — проверьте diff ниже.</Note>}
      {changes.length > 0 && <ChangeSet key={text.length} changes={changes} source="Merge Resolver" />}
    </div>
  );
}

/* ------------------------------ 34. Preview deploy -------------------------- */

export function DeployPanel() {
  const server = useNexus((s) => s.server); const [dep, setDep] = useState<{ id: string; url: string | null; state?: string; error?: string } | null>(null); const [findings, setFindings] = useState<{ path: string; line: number; rule: string }[] | null>(null);
  const { busy, error, run } = useBusy();
  const start = (allowSecrets = false) => void run(async () => {
    if (!(await requestPermission("deploy", "Создать preview-деплой Vercel из файлов проекта", { force: true }))) return;
    const files = Object.entries(workspaceFiles()).map(([path, content]) => ({ path, content }));
    try {
      const r = await nexusJson<{ id: string; url: string | null; state?: string }>("/api/nexus/deploy", { method: "POST", body: JSON.stringify({ name: `nexus-preview-${Date.now().toString(36)}`, files, allowSecrets }) });
      setDep(r); setFindings(null);
    } catch (e) { const p = (e as { payload?: { findings?: typeof findings } }).payload; if (p?.findings) setFindings(p.findings); else throw e; }
  });
  useEffect(() => {
    if (!dep?.id || ["READY", "ERROR", "CANCELED"].includes(dep.state ?? "")) return;
    const t = setInterval(() => void nexusJson<{ state?: string; url?: string | null; error?: string }>(`/api/nexus/deploy?id=${dep.id}`).then((r) => setDep((d) => (d ? { ...d, state: r.state, url: r.url ?? d.url, error: r.error } : d))).catch(() => undefined), 4000);
    return () => clearInterval(t);
  }, [dep?.id, dep?.state]);
  return (
    <div className="space-y-3">
      <Note>Файлы проекта публикуются как статический preview-сайт через Vercel Deployments API. Токен хранится только на сервере (<code>VERCEL_TOKEN</code>), доступ — по ключу Nexus. Перед отправкой файлы сканируются на секреты, <code>.env</code> исключаются. Это деплой статики, а не сборка Next.js-проекта.</Note>
      {server && !server.features.vercel && <Note tone="warn">На сервере не задан VERCEL_TOKEN — деплой недоступен.</Note>}
      <Button size="sm" onClick={() => start()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Play />}Создать preview-деплой</Button>
      {error && <Note tone="error">{error}</Note>}
      {findings && <Note tone="error">Найдены секреты — деплой остановлен:<ul className="mt-1 font-mono text-[10px]">{findings.slice(0, 8).map((f, i) => <li key={i}>{f.path}:{f.line} — {f.rule}</li>)}</ul><Button size="xs" variant="destructive" className="mt-2" onClick={() => start(true)}>Всё равно опубликовать</Button></Note>}
      {dep && <Card title="Статус сборки"><div className="flex items-center gap-2 text-xs"><Badge tone={dep.state === "READY" ? "ok" : dep.state === "ERROR" ? "error" : "accent"}>{dep.state ?? "QUEUED"}</Badge>{!["READY", "ERROR", "CANCELED"].includes(dep.state ?? "") && <Loader2 className="size-3.5 animate-spin" />}{dep.url && <a className="text-accent-soft underline" href={dep.url} target="_blank" rel="noopener noreferrer">{dep.url}</a>}</div>{dep.error && <p className="mt-1 text-xs text-red-300">{dep.error}</p>}</Card>}
    </div>
  );
}

/* ----------------------------- 35. Environment manager ---------------------- */

interface EnvVar { name: string; required: boolean; secret: boolean; value: string }
type EnvName = "development" | "staging" | "production";
const ENVS: EnvName[] = ["development", "staging", "production"];

export function EnvPanel() {
  const files = useFiles(); const [all, setAll] = usePersisted<Record<EnvName, EnvVar[]>>("envs", { development: [], staging: [], production: [] });
  const [env, setEnv] = useState<EnvName>("development"); const [name, setName] = useState(""); const [presence, setPresence] = useState<Record<string, boolean> | null>(null); const [serverEnv, setServerEnv] = useState(""); const [changes, setChanges] = useState<Change[]>([]);
  const { busy, error, run } = useBusy(); const vars = all[env];
  const upd = (i: number, p: Partial<EnvVar>) => setAll((a) => ({ ...a, [env]: a[env].map((v, k) => (k === i ? { ...v, ...p, ...(p.secret ? { value: "" } : {}) } : v)) }));
  const missing = vars.filter((v) => v.required && (v.secret ? presence?.[v.name] === false : !v.value.trim()));
  const importExample = () => { const ex = files[".env.example"]; if (!ex) return toast.info("В проекте нет .env.example"); const names = [...ex.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] ?? ""); setAll((a) => ({ ...a, [env]: [...a[env], ...names.filter((n) => !a[env].some((v) => v.name === n)).map((n) => ({ name: n, required: !ex.includes(`# ${n}=`), secret: /KEY|SECRET|TOKEN|PASS|URL/.test(n), value: "" }))] })); };
  return (
    <div className="space-y-3">
      <Note>Секретные переменные <b>никогда не вводятся и не хранятся в браузере</b> — только имя и признак «обязательная». Наличие на сервере проверяется отдельным запросом, который возвращает лишь «задана / не задана». Значения несекретных переменных хранятся локально.</Note>
      <div className="flex flex-wrap items-center gap-1.5">{ENVS.map((e) => <Button key={e} size="sm" variant={env === e ? "default" : "secondary"} onClick={() => { setEnv(e); setPresence(null); }}>{e}</Button>)}
        <Button size="sm" variant="ghost" onClick={importExample}>Импорт из .env.example</Button></div>
      <Card title={`Переменные · ${env}`} actions={<Badge tone={missing.length ? "error" : "ok"}>{missing.length ? `не хватает: ${missing.map((m) => m.name).join(", ")}` : "обязательные заданы"}</Badge>}>
        {vars.length === 0 ? <Empty>Переменных нет</Empty> : <table className="w-full text-xs"><thead className="text-left text-[10px] uppercase text-muted"><tr><th>Имя</th><th>Обяз.</th><th>Секрет</th><th>Значение</th><th>Сервер</th><th /></tr></thead><tbody>{vars.map((v, i) => (
          <tr key={v.name} className="border-t border-border"><td className="py-1 font-mono">{v.name}</td><td><input type="checkbox" aria-label="Обязательная" checked={v.required} onChange={(e) => upd(i, { required: e.target.checked })} /></td><td><input type="checkbox" aria-label="Секрет" checked={v.secret} onChange={(e) => upd(i, { secret: e.target.checked })} /></td>
            <td>{v.secret ? <span className="text-muted">•••••• (задаётся на сервере)</span> : <input className={inputCls} aria-label={`Значение ${v.name}`} value={v.value} onChange={(e) => upd(i, { value: e.target.value })} />}</td><td>{presence ? <Badge tone={presence[v.name] ? "ok" : "warn"}>{presence[v.name] ? "задана" : "нет"}</Badge> : "—"}</td>
            <td><button aria-label={`Удалить ${v.name}`} onClick={() => setAll((a) => ({ ...a, [env]: a[env].filter((_, k) => k !== i) }))}><Trash2 className="size-3.5 text-muted" /></button></td></tr>))}</tbody></table>}
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = name.trim().toUpperCase(); if (/^[A-Z][A-Z0-9_]*$/.test(n) && !vars.some((v) => v.name === n)) { setAll((a) => ({ ...a, [env]: [...a[env], { name: n, required: true, secret: /KEY|SECRET|TOKEN|PASS/.test(n), value: "" }] })); setName(""); } else toast.error("Имя: A–Z, 0–9, _"); }}>
          <input className={inputCls} placeholder="NEW_VARIABLE" value={name} onChange={(e) => setName(e.target.value)} /><Button size="sm" type="submit"><Plus />Добавить</Button></form></Card>
      <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" disabled={busy || vars.length === 0} onClick={() => void run(async () => { const r = await nexusJson<{ present: Record<string, boolean>; environment: string }>("/api/nexus/env", { method: "POST", body: JSON.stringify({ names: vars.map((v) => v.name) }) }); setPresence(r.present); setServerEnv(r.environment); })}>{busy ? <Loader2 className="animate-spin" /> : null}Проверить на сервере</Button>
        {serverEnv && <span className="text-[11px] text-muted">сервер работает в окружении: {serverEnv} — сверяйте с соответствующей вкладкой</span>}
        <Button size="sm" variant="secondary" disabled={vars.length === 0} onClick={() => setChanges([{ path: ".env.example", before: files[".env.example"] ?? null, after: `${vars.map((v) => `${v.required ? "" : "# "}${v.name}=${v.secret ? "" : v.value}`).join("\n")}\n` }])}>Сформировать .env.example</Button></div>
      {error && <Note tone="error">{error}</Note>}{changes.length > 0 && <ChangeSet changes={changes} source="Environment Manager" />}
    </div>
  );
}

/* ------------------------------ 36. Database explorer ----------------------- */

interface Schema { driver: string; tables: { schema: string; name: string; columns: { name: string; type: string; nullable: boolean }[] }[]; relations: { from_table: string; from_column: string; to_table: string; to_column: string }[]; readOnly: boolean }
interface QueryRes { rowCount: number; fields: string[]; rows: Record<string, unknown>[]; truncated: boolean; ms: number; command?: string }
const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

export function DatabasePanel() {
  const [schema, setSchema] = useState<Schema | null>(null); const [sql, setSql] = useState("select now()"); const [res, setRes] = useState<QueryRes | null>(null); const [need, setNeed] = useState<{ need: string; reasons: string[] } | null>(null); const [typed, setTyped] = useState("");
  const { busy, error, run } = useBusy(); const cls = classifySql(sql);
  const load = () => void run(async () => setSchema(await nexusJson<Schema>("/api/nexus/db")));
  const exec = (confirm?: string) => void run(async () => {
    try { setRes(await nexusJson<QueryRes>("/api/nexus/db", { method: "POST", body: JSON.stringify({ sql, confirm }) })); setNeed(null); setTyped(""); }
    catch (e) { const p = (e as { payload?: { need?: string; class?: { reasons: string[] } } }).payload; if ((e as { code?: string }).code === "confirm_required" && p?.need) setNeed({ need: p.need, reasons: p.class?.reasons ?? [] }); else throw e; }
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Button size="sm" onClick={load} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Загрузить схему</Button><Badge>драйвер: PostgreSQL (pg)</Badge>{schema?.readOnly && <Badge tone="warn">read-only режим сервера</Badge>}</div>
      {error && <Note tone="error">{error}</Note>}
      {schema && <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        <Card title={`Таблицы (${schema.tables.length})`}><ul className="max-h-72 space-y-1 overflow-auto">{schema.tables.map((t) => <li key={`${t.schema}.${t.name}`}><button className="w-full rounded px-1.5 py-1 text-left text-xs hover:bg-hover" onClick={() => setSql(`select * from ${q(t.schema)}.${q(t.name)} limit 50`)} title={t.columns.map((c) => `${c.name}: ${c.type}`).join("\n")}>{t.schema}.{t.name} <span className="text-muted">({t.columns.length})</span></button></li>)}</ul>
          {schema.relations.length > 0 && <div className="mt-2 border-t border-border pt-2 text-[10px] text-muted">{schema.relations.map((r, i) => <div key={i}>{r.from_table}.{r.from_column} → {r.to_table}.{r.to_column}</div>)}</div>}</Card>
        <div className="space-y-2"><Field label="SQL"><textarea className={cn(inputCls, "min-h-24 font-mono")} value={sql} onChange={(e) => setSql(e.target.value)} /></Field>
          <div className="flex items-center gap-2"><Button size="sm" onClick={() => exec()} disabled={busy || !sql.trim()}><Play />Выполнить</Button><Badge tone={cls.kind === "read" ? "ok" : cls.kind === "dangerous" ? "error" : "warn"}>{cls.kind}</Badge>{cls.reasons.map((r) => <span key={r} className="text-[10px] text-amber-300">{r}</span>)}</div>
          {need && <Note tone="warn">Требуется подтверждение: {need.reasons.join("; ")}. Введите <b>{need.need}</b>:<div className="mt-1 flex gap-2"><input className={inputCls} value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Подтверждение" /><Button size="xs" variant="destructive" disabled={typed !== need.need} onClick={() => exec(need.need)}>Выполнить</Button></div></Note>}
          {res && <Card title={`${res.command ?? ""} · строк: ${res.rowCount} · ${res.ms} мс${res.truncated ? " · показаны первые 500" : ""}`}><div className="max-h-72 overflow-auto"><table className="w-full text-[11px]"><thead><tr>{res.fields.map((f) => <th key={f} className="whitespace-nowrap border-b border-border px-2 py-1 text-left">{f}</th>)}</tr></thead><tbody>{res.rows.map((r, i) => <tr key={i}>{res.fields.map((f) => <td key={f} className="max-w-48 truncate border-b border-border/50 px-2 py-0.5 font-mono">{r[f] === null ? <i className="text-muted">null</i> : typeof r[f] === "object" ? JSON.stringify(r[f]) : String(r[f])}</td>)}</tr>)}</tbody></table></div></Card>}</div></div>}
    </div>
  );
}

/* --------------------------------- 37. API studio --------------------------- */

interface ApiReq { id: string; name: string; method: string; url: string; headers: string; body: string; auth: "none" | "bearer" | "basic"; authValue: string; collection: string }
interface Hist { ts: number; method: string; url: string; status: number; ms: number }
interface ApiRes { status: number; statusText: string; headers: Record<string, string>; body: string; size: number; ms: number; truncated: boolean }
const subst = (s: string, vars: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? `{{${k}}}`);

export function ApiStudioPanel() {
  const [reqs, setReqs] = usePersisted<ApiReq[]>("api-reqs", []); const [hist, setHist] = usePersisted<Hist[]>("api-hist", []); const [envs, setEnvs] = usePersisted<Record<string, string>>("api-env", { baseUrl: "https://httpbin.org" });
  const [cur, setCur] = useState<ApiReq>({ id: uid("rq"), name: "Новый запрос", method: "GET", url: "{{baseUrl}}/get", headers: "Accept: application/json", body: "", auth: "none", authValue: "", collection: "Default" }); const [res, setRes] = useState<ApiRes | null>(null); const [envText, setEnvText] = useState("");
  const { busy, error, run } = useBusy(); const set = (p: Partial<ApiReq>) => setCur((c) => ({ ...c, ...p }));
  const send = () => void run(async () => {
    const headers: Record<string, string> = {};
    for (const l of subst(cur.headers, envs).split("\n")) { const i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
    const av = subst(cur.authValue, envs); if (cur.auth === "bearer" && av) headers["Authorization"] = `Bearer ${av}`; if (cur.auth === "basic" && av) headers["Authorization"] = `Basic ${btoa(av)}`;
    const url = subst(cur.url, envs); if (!(await requestPermission("network", `HTTP ${cur.method} ${url}`))) throw new Error("Сетевой запрос запрещён политикой");
    const r = await nexusJson<ApiRes>("/api/nexus/http", { method: "POST", body: JSON.stringify({ method: cur.method, url, headers, body: cur.body ? subst(cur.body, envs) : undefined }) });
    setRes(r); setHist((h) => [{ ts: Date.now(), method: cur.method, url, status: r.status, ms: r.ms }, ...h].slice(0, 50));
  });
  const pretty = useMemo(() => { if (!res) return ""; try { return JSON.stringify(JSON.parse(res.body), null, 2); } catch { return res.body; } }, [res]);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Card title="Коллекции" actions={<Button size="xs" variant="ghost" onClick={() => setCur({ ...cur, id: uid("rq"), name: "Новый запрос" })}><Plus /></Button>}>
          {reqs.length === 0 ? <p className="text-[11px] text-muted">Сохранённых запросов нет</p> : <ul className="space-y-1">{reqs.map((r) => <li key={r.id} className="flex items-center gap-1 text-xs"><button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setCur(r)}><Badge>{r.method}</Badge> {r.name}</button><button aria-label="Удалить" onClick={() => setReqs((a) => a.filter((x) => x.id !== r.id))}><Trash2 className="size-3 text-muted" /></button></li>)}</ul>}
          <div className="mt-3 border-t border-border pt-2"><div className="mb-1 text-[10px] font-medium uppercase text-muted">Окружение (переменные)</div><textarea className={cn(inputCls, "min-h-16 font-mono")} aria-label="Переменные окружения" value={envText || Object.entries(envs).map(([k, v]) => `${k}=${v}`).join("\n")} onChange={(e) => setEnvText(e.target.value)} onBlur={() => { if (envText) { setEnvs(Object.fromEntries(envText.split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]))); setEnvText(""); } }} /><p className="text-[10px] text-muted">{"{{имя}}"} подставляется в URL, заголовки, тело. Хранится локально — не кладите сюда production-секреты.</p></div></Card>
        <div className="space-y-2"><div className="flex gap-2"><select aria-label="Метод" className={cn(inputCls, "w-24")} value={cur.method} onChange={(e) => set({ method: e.target.value })}>{["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((m) => <option key={m}>{m}</option>)}</select><input aria-label="URL" className={inputCls} value={cur.url} onChange={(e) => set({ url: e.target.value })} /><Button size="sm" onClick={send} disabled={busy || !cur.url}>{busy ? <Loader2 className="animate-spin" /> : <Play />}Отправить</Button></div>
          <div className="grid gap-2 sm:grid-cols-2"><Field label="Заголовки (Имя: значение)"><textarea className={cn(inputCls, "min-h-16 font-mono")} value={cur.headers} onChange={(e) => set({ headers: e.target.value })} /></Field><Field label="Тело"><textarea className={cn(inputCls, "min-h-16 font-mono")} value={cur.body} onChange={(e) => set({ body: e.target.value })} /></Field></div>
          <div className="flex flex-wrap gap-2"><select aria-label="Авторизация" className={cn(inputCls, "w-32")} value={cur.auth} onChange={(e) => set({ auth: e.target.value as ApiReq["auth"] })}><option value="none">без авторизации</option><option value="bearer">Bearer</option><option value="basic">Basic (user:pass)</option></select>{cur.auth !== "none" && <input aria-label="Токен" className={cn(inputCls, "w-56")} placeholder="{{token}}" value={cur.authValue} onChange={(e) => set({ authValue: e.target.value })} />}
            <input aria-label="Название" className={cn(inputCls, "w-40")} value={cur.name} onChange={(e) => set({ name: e.target.value })} /><Button size="sm" variant="secondary" onClick={() => setReqs((a) => [...a.filter((x) => x.id !== cur.id), cur])}>Сохранить в коллекцию</Button></div>
          {error && <Note tone="error">{error}</Note>}
          {res && <Card title={<span className="flex items-center gap-2"><Badge tone={res.status < 300 ? "ok" : res.status < 400 ? "warn" : "error"}>{res.status} {res.statusText}</Badge><span className="text-[10px] text-muted">{res.ms} мс · {res.size} Б{res.truncated ? " · обрезано" : ""}</span></span>}><pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{pretty}</pre><details className="mt-1 text-[10px] text-muted"><summary>Заголовки ответа</summary>{Object.entries(res.headers).map(([k, v]) => <div key={k}>{k}: {v}</div>)}</details></Card>}</div></div>
      <Card title="История" actions={<Button size="xs" variant="ghost" onClick={() => setHist([])}>Очистить</Button>}>{hist.length === 0 ? <Empty>Запросов ещё не было</Empty> : <ul className="space-y-0.5 text-[11px]">{hist.map((h, i) => <li key={i} className="flex gap-2"><Badge>{h.method}</Badge><span className="flex-1 truncate font-mono">{h.url}</span><Badge tone={h.status < 400 ? "ok" : "error"}>{h.status}</Badge><span className="text-muted">{h.ms} мс</span></li>)}</ul>}</Card>
    </div>
  );
}

/* --------------------------------- 38. Docker ------------------------------- */

interface Ctr { id: string; name: string; image: string; state: string; status: string }
export function DockerPanel() {
  const [list, setList] = useState<Ctr[] | null>(null); const [det, setDet] = useState<{ id: string; logs: string; config: { image?: string; cmd?: string[]; env?: string[] } } | null>(null);
  const { busy, error, run } = useBusy(); const load = () => void run(async () => setList((await nexusJson<{ containers: Ctr[] }>("/api/nexus/docker")).containers));
  const act = (id: string, action: string) => void run(async () => { if (!(await requestPermission("terminal", `Docker: ${action} ${id}`, { force: true }))) return; await nexusJson("/api/nexus/docker", { method: "POST", body: JSON.stringify({ id, action }) }); await new Promise((r) => setTimeout(r, 600)); setList((await nexusJson<{ containers: Ctr[] }>("/api/nexus/docker")).containers); });
  return (
    <div className="space-y-3">
      <Note tone="warn">Docker-менеджер работает только там, где у сервера приложения есть доступ к сокету Docker (задайте <code>NEXUS_DOCKER=1</code>). На Vercel/serverless это недоступно — тогда вы увидите соответствующую ошибку, а не фиктивные данные.</Note>
      <Button size="sm" onClick={load} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Обновить</Button>{error && <Note tone="error">{error}</Note>}
      {list && (list.length === 0 ? <Empty>Контейнеров нет</Empty> : <ul className="space-y-1.5">{list.map((c) => <li key={c.id} className="flex items-center gap-2 rounded border border-border p-2 text-xs"><Badge tone={c.state === "running" ? "ok" : "muted"}>{c.state}</Badge><div className="min-w-0 flex-1"><div className="truncate font-medium">{c.name}</div><div className="truncate text-[10px] text-muted">{c.image} · {c.status}</div></div>
        <Button size="icon-sm" variant="ghost" aria-label="Запустить" onClick={() => act(c.id, "start")}><Play /></Button><Button size="icon-sm" variant="ghost" aria-label="Остановить" onClick={() => act(c.id, "stop")}><Square /></Button><Button size="icon-sm" variant="ghost" aria-label="Перезапустить" onClick={() => act(c.id, "restart")}><RefreshCw /></Button>
        <Button size="xs" variant="secondary" onClick={() => void run(async () => setDet({ id: c.id, ...(await nexusJson<{ logs: string; config: { image?: string; cmd?: string[]; env?: string[] } }>(`/api/nexus/docker?id=${c.id}`)) }))}>Логи</Button></li>)}</ul>)}
      {det && <Card title={`Логи ${det.id} · ${det.config.image ?? ""}`}><pre className="max-h-64 overflow-auto rounded bg-background p-2 font-mono text-[10px]">{det.logs || "—"}</pre><p className="mt-1 text-[10px] text-muted">Конфигурация: cmd={JSON.stringify(det.config.cmd)}; переменные (только имена): {det.config.env?.join(", ")}</p></Card>}
    </div>
  );
}

/* ------------------------------- 39. Profiler ------------------------------- */

interface Perf { ttfb?: number; dcl?: number; load?: number; fcp?: number; lcp?: number; cls: number; longTasks: number; memUsed?: number; memLimit?: number; fps?: number; health?: number; slow: { name: string; ms: number; size: number }[]; reqs: number }
export function ProfilerPanel() {
  const [p, setP] = useState<Perf>({ cls: 0, longTasks: 0, slow: [], reqs: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    setP((s) => ({ ...s, ttfb: nav?.responseStart, dcl: nav?.domContentLoadedEventEnd, load: nav?.loadEventEnd || undefined, fcp, memUsed: mem?.usedJSHeapSize, memLimit: mem?.jsHeapSizeLimit, reqs: res.length, slow: res.map((r) => ({ name: r.name.split("/").slice(-2).join("/").slice(0, 60), ms: r.duration, size: r.transferSize })).sort((a, b) => b.ms - a.ms).slice(0, 6) }));
    const obs: PerformanceObserver[] = [];
    const watch = (type: string, cb: (l: PerformanceEntryList) => void) => { try { const o = new PerformanceObserver((l) => cb(l.getEntries())); o.observe({ type, buffered: true }); obs.push(o); } catch { /* unsupported */ } };
    watch("largest-contentful-paint", (e) => setP((s) => ({ ...s, lcp: e[e.length - 1]?.startTime })));
    watch("layout-shift", (e) => setP((s) => ({ ...s, cls: s.cls + e.reduce((n, x) => n + ((x as unknown as { hadRecentInput: boolean; value: number }).hadRecentInput ? 0 : (x as unknown as { value: number }).value), 0) })));
    watch("longtask", (e) => setP((s) => ({ ...s, longTasks: s.longTasks + e.length })));
    const t0 = performance.now(); void fetch("/api/health", { cache: "no-store" }).then(() => setP((s) => ({ ...s, health: performance.now() - t0 }))).catch(() => undefined);
    let frames = 0; let raf = 0; const start = performance.now();
    const loop = () => { frames++; if (performance.now() - start < 2000) raf = requestAnimationFrame(loop); else setP((s) => ({ ...s, fps: Math.round((frames * 1000) / (performance.now() - start)) })); }; raf = requestAnimationFrame(loop);
    return () => { obs.forEach((o) => o.disconnect()); cancelAnimationFrame(raf); };
  }, [tick]);
  const M = ({ l, v, u, bad }: { l: string; v?: number; u: string; bad?: boolean }) => <div className="rounded border border-border p-2"><div className="text-[10px] uppercase text-muted">{l}</div><div className={cn("text-lg font-semibold", bad && "text-red-300")}>{v === undefined ? "н/д" : `${Math.round(v * 100) / 100}${u}`}</div></div>;
  return (
    <div className="space-y-3">
      <Note>Метрики измеряются в этом браузере через Performance API. Метрик сборки (webpack/Next) в браузере нет — смотрите вывод <code>next build</code>. Память доступна только в Chromium.</Note>
      <Button size="sm" variant="secondary" onClick={() => setTick((t) => t + 1)}><RefreshCw />Перемерить</Button>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><M l="TTFB" v={p.ttfb} u=" мс" /><M l="FCP" v={p.fcp} u=" мс" bad={(p.fcp ?? 0) > 1800} /><M l="LCP" v={p.lcp} u=" мс" bad={(p.lcp ?? 0) > 2500} /><M l="CLS" v={p.cls} u="" bad={p.cls > 0.1} /><M l="DOMContentLoaded" v={p.dcl} u=" мс" /><M l="Load" v={p.load} u=" мс" /><M l="Долгие задачи" v={p.longTasks} u="" bad={p.longTasks > 5} /><M l="FPS (2 с)" v={p.fps} u="" bad={(p.fps ?? 60) < 30} />
        <M l="JS-память" v={p.memUsed ? p.memUsed / 1048576 : undefined} u=" МБ" /><M l="Лимит памяти" v={p.memLimit ? p.memLimit / 1048576 : undefined} u=" МБ" /><M l="/api/health" v={p.health} u=" мс" /><M l="Сетевых запросов" v={p.reqs} u="" /></div>
      <Card title="Самые медленные запросы">{p.slow.length === 0 ? <Empty>Нет данных</Empty> : <ul className="space-y-0.5 font-mono text-[11px]">{p.slow.map((s, i) => <li key={i} className="flex justify-between"><span className="truncate">{s.name}</span><span className="text-muted">{Math.round(s.ms)} мс · {Math.round(s.size / 1024)} КБ</span></li>)}</ul>}</Card>
    </div>
  );
}

/* ------------------------------- 40. Secrets -------------------------------- */

export function SecretsPanel() {
  const files = useFiles(); const allow = useNexus((s) => s.data.secretAllow); const patch = useNexus((s) => s.patch);
  const found = useMemo(() => scanFiles(files, allow), [files, allow]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Badge tone={found.length ? "error" : "ok"}>{found.length ? `найдено: ${found.length}` : "секретов не найдено"}</Badge><span className="text-[10px] text-muted">Проверка идёт автоматически; те же правила применяются перед любым AI-изменением, деплоем и в журнале агентов. Исключено ложных срабатываний: {allow.length}.</span>{allow.length > 0 && <Button size="xs" variant="ghost" onClick={() => patch({ secretAllow: [] })}>Сбросить исключения</Button>}</div>
      {found.length === 0 ? <Empty>Чисто. Строки-плейсхолдеры, process.env и комментарий <code>nexus-ignore</code> игнорируются.</Empty> : <ul className="space-y-1.5">{found.map((f) => (
        <li key={f.fingerprint} className="rounded border border-border p-2 text-xs"><div className="flex items-center gap-2"><Badge tone={f.severity === "high" ? "error" : "warn"}>{f.severity}</Badge><b>{f.rule}</b><button className="font-mono text-[11px] hover:underline" onClick={() => openFileInIde(f.path, f.line)}>{f.path}:{f.line}</button><code className="text-muted">{f.preview}</code><Button size="xs" variant="ghost" className="ml-auto" onClick={() => patch({ secretAllow: [...allow, f.fingerprint] })}>Ложное срабатывание</Button></div><p className="mt-1 text-[11px] text-subtle">{f.advice}</p></li>))}</ul>}
    </div>
  );
}

/* ----------------------------- 46. Self-healing ----------------------------- */

export function HealPanel() {
  const files = useFiles(); const [issues, setIssues] = useState<HealIssue[] | null>(null); const [fix, setFix] = useState<Change[]>([]); const [server, setServer] = useState<"ok" | "skipped">("skipped");
  const { busy, run } = useBusy();
  const scan = () => void run(async () => {
    const used = new Set<string>(); for (const s of Object.values(files)) for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) if (m[1] && !/^(NODE_ENV|NEXT_RUNTIME|VERCEL\w*|CI)$/.test(m[1])) used.add(m[1]);
    let presence: Record<string, boolean> | null = null;
    if (used.size) { try { presence = (await nexusJson<{ present: Record<string, boolean> }>("/api/nexus/env", { method: "POST", body: JSON.stringify({ names: [...used] }) })).present; setServer("ok"); } catch { setServer("skipped"); } }
    setIssues(diagnoseWorkspace(files, presence)); setFix([]);
  });
  useEffect(() => { const t = setTimeout(scan, 0); return () => clearTimeout(t); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Button size="sm" onClick={scan} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Диагностика</Button>{server === "skipped" && <span className="text-[10px] text-muted">Серверные переменные не проверены (нужен ключ доступа Nexus)</span>}</div>
      {issues === null ? <Empty>Анализ…</Empty> : issues.length === 0 ? <Note tone="ok">Проблем не найдено</Note> : <ul className="space-y-1.5">{issues.map((i) => (
        <li key={i.id} className="rounded border border-border p-2 text-xs"><div className="flex items-center gap-2"><Badge tone={i.severity === "error" ? "error" : i.severity === "warn" ? "warn" : "muted"}>{i.severity}</Badge><b>{i.title}</b></div><pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-subtle">{i.detail}</pre>
          <div className="mt-1 flex flex-wrap gap-1.5">{i.command && <Button size="xs" variant="secondary" onClick={() => copy(i.command ?? "")}><Copy />{i.command}</Button>}{i.fix && <Button size="xs" onClick={() => setFix(i.fix ?? [])}>Предпросмотр исправления</Button>}</div></li>))}</ul>}
      {fix.length > 0 && <Card title="Исправление"><ChangeSet changes={fix} source="Self-Healing" onDone={() => setTimeout(scan, 400)} /></Card>}
    </div>
  );
}
