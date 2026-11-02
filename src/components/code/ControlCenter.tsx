"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Loader2, Play, RefreshCw, Rocket, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { callIntegration, connectProvider, disconnectProvider, fetchConnections, IntegrationError, type ConnState } from "@/lib/integrations/client";
import { useNexus } from "@/lib/nexus/store";
import { getDb, type ActivityRecord, type ProjectRecord } from "@/lib/db/schema";
import { logActivity, projectFiles, updateProject } from "@/lib/studio/projects";
import { AccountSection } from "@/components/account/AccountSection";
import { Btn, Card, Field, inputCls, Notice, Pill } from "./ui";

type Obj = Record<string, unknown>;
const gh = <T,>(body: Obj) => callIntegration<T>("github", body);
const vc = <T,>(body: Obj) => callIntegration<T>("vercel", body);
const errMsg = (e: unknown) => (e instanceof IntegrationError ? (e.code === "rate_limited" && e.resetAt ? `${e.message} (сброс в ${new Date(e.resetAt).toLocaleTimeString()})` : e.message) : e instanceof Error ? e.message : "Ошибка");
const ago = (t: number) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? "только что" : s < 3600 ? `${Math.floor(s / 60)} мин назад` : s < 86400 ? `${Math.floor(s / 3600)} ч назад` : new Date(t).toLocaleDateString(); };
const stateTone = (s?: string | null) => (s === "READY" || s === "success" ? "ok" : s === "ERROR" || s === "failure" || s === "CANCELED" ? "err" : s ? "warn" : "muted") as "ok" | "err" | "warn" | "muted";

function useConn() {
  const [c, setC] = useState<ConnState | null>(null);
  const refresh = useCallback(() => void fetchConnections().then(setC), []);
  useEffect(refresh, [refresh]);
  return { c, refresh };
}

function Connect({ provider, state, refresh }: { provider: "github" | "vercel"; state?: { connected: boolean; login?: string; via?: string | null }; refresh: () => void }) {
  const [token, setToken] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const name = provider === "github" ? "GitHub" : "Vercel";
  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2"><span className="text-sm font-semibold">{name}</span>{state?.connected ? <Pill tone="ok">{state.login ?? "подключён"}{state.via === "owner-env" ? " · owner" : ""}</Pill> : <Pill tone="warn">не подключён</Pill>}</div>
      {state?.connected ? (
        <Btn variant="ghost" onClick={async () => { await disconnectProvider(provider); refresh(); }}>Отключить</Btn>
      ) : (
        <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const r = await connectProvider(provider, token, team || undefined); toast.success(`${name}: ${r.login}`); setToken(""); refresh(); } catch (er) { toast.error(errMsg(er)); } finally { setBusy(false); } }}>
          <input type="password" autoComplete="off" className={inputCls} placeholder={provider === "github" ? "Personal access token (fine-grained)" : "Vercel access token"} value={token} onChange={(e) => setToken(e.target.value)} aria-label={`${name} токен`} />
          {provider === "vercel" && <input className={inputCls} placeholder="Team ID (необязательно)" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Vercel Team ID" />}
          <Btn className="w-full" disabled={busy || token.length < 8}>{busy ? "Проверяю…" : "Подключить"}</Btn>
        </form>
      )}
      <p className="text-[11px] leading-relaxed text-muted">{provider === "github" ? "Минимальные права fine-grained токена: Metadata (read), Contents (read/write), Pull requests (read/write), Actions (read). Для создания репозиториев нужен доступ на уровне аккаунта (Administration: write)." : "Токен создаётся в Vercel → Account Settings → Tokens. Для проектов в команде укажите Team ID."} Токен шифруется на сервере и хранится в httpOnly-cookie: браузерный JS его не видит. OAuth/GitHub App не настроены (нужны GITHUB_CLIENT_ID/SECRET) — используется персональный токен.</p>
    </Card>
  );
}

/* ----------------------------- GitHub ----------------------------- */

interface Repo { full_name: string; private: boolean; default_branch: string; updated_at: string; html_url: string; permissions?: { push?: boolean } }
interface CommitRow { sha: string; message: string; author: string; date: string; url: string }

function GitHubPanel() {
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(async () => { setErr(""); try { setRepos(await gh<Repo[]>({ action: "repos" })); } catch (e) { setErr(errMsg(e)); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (err) return <Notice tone="err">{err}</Notice>;
  if (!repos) return <Loader2 className="size-5 animate-spin text-muted" />;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><select aria-label="Репозиторий" className={inputCls} value={repo?.full_name ?? ""} onChange={(e) => setRepo(repos.find((r) => r.full_name === e.target.value) ?? null)}><option value="">Выберите репозиторий ({repos.length})</option>{repos.map((r) => <option key={r.full_name} value={r.full_name}>{r.full_name}{r.private ? " 🔒" : ""}</option>)}</select><Btn variant="ghost" aria-label="Обновить" onClick={() => void load()}><RefreshCw className="size-4" /></Btn></div>
      {repo ? <RepoView key={repo.full_name} repo={repo} /> : <p className="text-xs text-muted">Показаны репозитории, доступные вашему токену. Новый репозиторий создаётся из карточки проекта («Проекты»).</p>}
    </div>
  );
}

function RepoView({ repo }: { repo: Repo }) {
  const [tab, setTab] = useState<"files" | "branches" | "commits" | "pulls" | "actions" | "compare">("commits");
  const R = repo.full_name;
  const tabs = [["files", "Файлы"], ["branches", "Ветки"], ["commits", "Коммиты"], ["pulls", "PR"], ["actions", "Actions"], ["compare", "Сравнение"]] as const;
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><a href={repo.html_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold hover:underline">{R}<ExternalLink className="size-3" /></a><Pill>{repo.default_branch}</Pill>{repo.permissions?.push === false && <Pill tone="warn">только чтение</Pill>}</div>
      <div className="flex gap-1 overflow-x-auto">{tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`min-h-10 shrink-0 rounded-lg px-3 text-sm ${tab === id ? "bg-accent/20 text-foreground" : "text-subtle hover:bg-hover"}`}>{l}</button>)}</div>
      {tab === "files" && <Files R={R} def={repo.default_branch} />}
      {tab === "branches" && <Branches R={R} def={repo.default_branch} />}
      {tab === "commits" && <Commits R={R} def={repo.default_branch} />}
      {tab === "pulls" && <Pulls R={R} def={repo.default_branch} />}
      {tab === "actions" && <Actions R={R} />}
      {tab === "compare" && <Compare R={R} def={repo.default_branch} />}
    </Card>
  );
}

function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => { setLoading(true); setErr(""); fn().then(setData).catch((e) => setErr(errMsg(e))).finally(() => setLoading(false)); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, err, loading, reload };
}

function Files({ R, def }: { R: string; def: string }) {
  const [path, setPath] = useState("");
  const { data, err, loading } = useLoad(() => gh<{ type: string; entries?: { name: string; path: string; type: string; size: number }[]; text?: string | null; note?: string }>({ action: "contents", repo: R, path, ref: def }), [R, path]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1 text-xs"><button className="min-h-9 px-2 text-accent-soft" onClick={() => setPath("")}>/</button>{path && <button className="min-h-9 px-2 text-subtle" onClick={() => setPath(path.split("/").slice(0, -1).join("/"))}>← назад</button>}<span className="text-muted">{path}</span></div>
      {loading && <Loader2 className="size-4 animate-spin" />}{err && <Notice tone="err">{err}</Notice>}
      {data?.type === "dir" && <div className="max-h-80 overflow-auto rounded-xl border border-border">{data.entries?.map((e) => <button key={e.path} onClick={() => setPath(e.path)} className="flex min-h-11 w-full items-center justify-between border-b border-border px-3 text-left text-sm last:border-0 hover:bg-hover"><span className="truncate">{e.type === "dir" ? "📁" : "📄"} {e.name}</span><span className="text-[11px] text-muted">{e.type === "file" ? `${e.size} Б` : ""}</span></button>)}</div>}
      {data?.type === "file" && <pre className="max-h-96 max-w-full overflow-auto rounded-xl border border-border bg-background p-3 text-[12px]">{data.text ?? data.note}</pre>}
    </div>
  );
}

function Branches({ R, def }: { R: string; def: string }) {
  const { data, err, reload } = useLoad(() => gh<{ name: string; protected: boolean; sha: string }[]>({ action: "branches", repo: R }), [R]);
  const [name, setName] = useState("");
  return (
    <div className="space-y-2">
      {err && <Notice tone="err">{err}</Notice>}
      <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!confirm(`Создать ветку ${name} от ${def}?`)) return; try { await gh({ action: "createBranch", repo: R, name, from: def }); toast.success("Ветка создана"); setName(""); reload(); } catch (er) { toast.error(errMsg(er)); } }}>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/new-branch" aria-label="Имя ветки" /><Btn disabled={!name}><GitBranch className="size-4" />Создать</Btn>
      </form>
      {data?.map((b) => <div key={b.name} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><span className="min-w-0 flex-1 truncate">{b.name}</span>{b.protected && <Pill tone="warn">protected</Pill>}<code className="text-[11px] text-muted">{b.sha.slice(0, 7)}</code>
        {b.name !== def && <button aria-label={`Удалить ветку ${b.name}`} className="min-h-9 px-2 text-xs text-red-300" onClick={async () => { if (!confirm(`УДАЛИТЬ ветку ${b.name}? Это необратимо.`)) return; try { await gh({ action: "deleteBranch", repo: R, name: b.name, confirm: true }); reload(); } catch (e) { toast.error(errMsg(e)); } }}>удалить</button>}</div>)}
    </div>
  );
}

function Commits({ R, def }: { R: string; def: string }) {
  const { data, err, reload } = useLoad(() => gh<CommitRow[]>({ action: "commits", repo: R, sha: def, perPage: 20 }), [R]);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useLoad(() => (open ? gh<{ files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[]; stats?: { additions: number; deletions: number } }>({ action: "commit", repo: R, sha: open }) : Promise.resolve(null)), [open]);
  return (
    <div className="space-y-2">
      {err && <Notice tone="err">{err}</Notice>}
      {data?.map((c) => (
        <div key={c.sha} className="rounded-xl border border-border">
          <button onClick={() => setOpen(open === c.sha ? null : c.sha)} className="flex min-h-12 w-full items-center gap-2 px-3 text-left"><GitCommitHorizontal className="size-4 shrink-0 text-muted" /><span className="min-w-0 flex-1"><span className="block truncate text-sm">{c.message.split("\n")[0]}</span><span className="text-[11px] text-muted">{c.author} · {ago(new Date(c.date).getTime())}</span></span><code className="text-[11px] text-muted">{c.sha.slice(0, 7)}</code></button>
          {open === c.sha && (
            <div className="space-y-2 border-t border-border p-3">
              {detail.loading && <Loader2 className="size-4 animate-spin" />}
              {detail.data?.files.map((f) => <details key={f.filename} className="rounded-lg bg-background"><summary className="min-h-10 cursor-pointer px-2 py-2 text-xs"><span className="break-all">{f.filename}</span> <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span></summary><pre className="max-w-full overflow-x-auto px-2 pb-2 text-[11px] leading-snug">{(f.patch ?? "(нет diff)").split("\n").map((l, i) => <div key={i} className={l.startsWith("+") ? "bg-emerald-500/10 text-emerald-300" : l.startsWith("-") ? "bg-red-500/10 text-red-300" : "text-subtle"}>{l || " "}</div>)}</pre></details>)}
              <div className="flex flex-wrap gap-2"><a href={c.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center rounded-xl border border-border-strong px-3 text-xs text-subtle">Открыть на GitHub</a>
                <Btn variant="danger" className="min-h-10 text-xs" onClick={async () => { if (!confirm(`Откатить содержимое ${def} к ${c.sha.slice(0, 7)}? Будет создан новый коммит.`)) return; try { await gh({ action: "revertToCommit", repo: R, branch: def, sha: c.sha, confirm: true }); toast.success("Откат выполнен новым коммитом"); reload(); } catch (e) { toast.error(errMsg(e)); } }}><Undo2 className="size-3.5" />Откатить к этому</Btn></div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Pulls({ R, def }: { R: string; def: string }) {
  const { data, err, reload } = useLoad(() => gh<{ number: number; title: string; state: string; url: string; user: string; head: string; base: string }[]>({ action: "pulls", repo: R, state: "all" }), [R]);
  const [f, setF] = useState({ title: "", head: "", base: def });
  return (
    <div className="space-y-2">
      {err && <Notice tone="err">{err}</Notice>}
      <form className="grid gap-2 sm:grid-cols-4" onSubmit={async (e) => { e.preventDefault(); if (!confirm(`Создать PR ${f.head} → ${f.base}?`)) return; try { const r = await gh<{ url: string }>({ action: "createPull", repo: R, ...f, confirm: true }); toast.success("Pull request создан"); window.open(r.url, "_blank", "noopener"); reload(); } catch (er) { toast.error(errMsg(er)); } }}>
        <input className={`${inputCls} sm:col-span-2`} placeholder="Заголовок PR" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Заголовок PR" />
        <input className={inputCls} placeholder="head ветка" value={f.head} onChange={(e) => setF({ ...f, head: e.target.value })} aria-label="Head" />
        <Btn disabled={!f.title || !f.head}><GitPullRequest className="size-4" />Создать</Btn>
      </form>
      {data?.length === 0 && <p className="text-xs text-muted">Pull request’ов нет.</p>}
      {data?.map((p) => <a key={p.number} href={p.url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-2 rounded-xl border border-border px-3 hover:bg-hover"><Pill tone={p.state === "open" ? "ok" : p.state === "merged" ? "accent" : "muted"}>{p.state}</Pill><span className="min-w-0 flex-1 truncate text-sm">#{p.number} {p.title}</span><span className="hidden text-[11px] text-muted sm:inline">{p.head} → {p.base}</span></a>)}
    </div>
  );
}

function Actions({ R }: { R: string }) {
  const { data, err, reload } = useLoad(() => gh<{ id: number; name: string; status: string; conclusion: string | null; branch: string; url: string; created_at: string; number: number }[]>({ action: "runs", repo: R }), [R]);
  const [open, setOpen] = useState<number | null>(null);
  const det = useLoad(() => (open ? gh<{ jobs: { id: number; name: string; conclusion: string | null; failedSteps: string[]; annotations: { message: string; path: string; line: number }[] }[] }>({ action: "runDetail", repo: R, runId: open }) : Promise.resolve(null)), [open]);
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><Btn variant="ghost" className="min-h-9" onClick={reload}><RefreshCw className="size-3.5" />Обновить</Btn></div>
      {err && <Notice tone="err">{err}</Notice>}
      {data?.length === 0 && <p className="text-xs text-muted">Запусков GitHub Actions нет.</p>}
      {data?.map((r) => (
        <div key={r.id} className="rounded-xl border border-border">
          <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex min-h-12 w-full items-center gap-2 px-3 text-left"><Pill tone={stateTone(r.conclusion ?? r.status)}>{r.conclusion ?? r.status}</Pill><span className="min-w-0 flex-1 truncate text-sm">{r.name} #{r.number}</span><span className="text-[11px] text-muted">{r.branch}</span></button>
          {open === r.id && <div className="space-y-2 border-t border-border p-3 text-xs">{det.loading && <Loader2 className="size-4 animate-spin" />}{det.data?.jobs.map((j) => <div key={j.id}><div className="font-medium">{j.name} <Pill tone={stateTone(j.conclusion)}>{j.conclusion ?? "…"}</Pill></div>{j.failedSteps.map((s) => <div key={s} className="text-red-300">✗ {s}</div>)}{j.annotations.map((a, i) => <div key={i} className="break-words text-amber-200">{a.path}:{a.line} — {a.message}</div>)}</div>)}<a href={r.url} target="_blank" rel="noopener noreferrer" className="text-accent-soft underline">Полный лог на GitHub</a></div>}
        </div>
      ))}
    </div>
  );
}

function Compare({ R, def }: { R: string; def: string }) {
  const [base, setBase] = useState(def);
  const [head, setHead] = useState("");
  const [res, setRes] = useState<{ status: string; ahead_by: number; behind_by: number; commits: { sha: string; message: string }[]; files: { filename: string; additions: number; deletions: number; patch?: string }[] } | null>(null);
  return (
    <div className="space-y-2">
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); try { setRes(await gh({ action: "compare", repo: R, base, head })); } catch (er) { toast.error(errMsg(er)); } }}>
        <input className={inputCls} value={base} onChange={(e) => setBase(e.target.value)} aria-label="Base (ветка/коммит)" /><input className={inputCls} value={head} onChange={(e) => setHead(e.target.value)} placeholder="head (ветка/коммит)" aria-label="Head" /><Btn disabled={!head}>Сравнить</Btn>
      </form>
      {res && <div className="space-y-2 text-sm"><div><Pill>{res.status}</Pill> впереди: {res.ahead_by}, позади: {res.behind_by}</div>{res.commits.map((c) => <div key={c.sha} className="truncate text-xs text-subtle"><code>{c.sha.slice(0, 7)}</code> {c.message.split("\n")[0]}</div>)}{res.files.map((f) => <details key={f.filename} className="rounded-lg bg-background"><summary className="min-h-10 cursor-pointer px-2 py-2 text-xs break-all">{f.filename} <span className="text-emerald-400">+{f.additions}</span> <span className="text-red-400">−{f.deletions}</span></summary><pre className="max-w-full overflow-x-auto px-2 pb-2 text-[11px]">{f.patch ?? "(нет diff)"}</pre></details>)}</div>}
    </div>
  );
}

/* ----------------------------- Vercel ----------------------------- */

interface VProject { id: string; name: string; framework?: string; link: { repo?: string; org?: string; type?: string } | null; latest: { id: string; state: string; url: string; createdAt: number } | null }
interface VDeploy { id: string; state: string; target: string; url: string; created: number; creator?: string; meta?: { commit?: string; branch?: string }; error?: string }

function VercelPanel() {
  const { data, err, reload } = useLoad(() => vc<VProject[]>({ action: "projects" }), []);
  const [p, setP] = useState<VProject | null>(null);
  if (err) return <Notice tone="err">{err}</Notice>;
  if (!data) return <Loader2 className="size-5 animate-spin text-muted" />;
  return (
    <div className="space-y-3">
      <div className="flex gap-2"><select aria-label="Проект Vercel" className={inputCls} value={p?.id ?? ""} onChange={(e) => setP(data.find((x) => x.id === e.target.value) ?? null)}><option value="">Проект Vercel ({data.length})</option>{data.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><Btn variant="ghost" aria-label="Обновить" onClick={reload}><RefreshCw className="size-4" /></Btn></div>
      {p ? <VProjectView key={p.id} p={p} /> : <p className="text-xs text-muted">Доступные токену проекты. Создать проект из репозитория можно в карточке проекта.</p>}
    </div>
  );
}

function VProjectView({ p }: { p: VProject }) {
  const { data, err, reload } = useLoad(() => vc<VDeploy[]>({ action: "deployments", projectId: p.id, limit: 12 }), [p.id]);
  const [logs, setLogs] = useState<{ id: string; lines: string[] } | null>(null);
  const [tab, setTab] = useState<"deploys" | "env">("deploys");
  const showLogs = async (id: string) => { try { const l = await vc<{ text: string; type?: string }[]>({ action: "logs", deploymentId: id }); setLogs({ id, lines: l.map((x) => x.text) }); } catch (e) { toast.error(errMsg(e)); } };
  const act = async (body: Obj, ask: string) => { if (!confirm(ask)) return; try { await vc({ ...body, confirm: true }); toast.success("Операция выполнена"); reload(); } catch (e) { toast.error(errMsg(e)); } };
  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold">{p.name}</span>{p.framework && <Pill>{p.framework}</Pill>}{p.link?.repo ? <Pill tone="accent">{p.link.org}/{p.link.repo}</Pill> : <Pill tone="warn">без репозитория</Pill>}</div>
      <div className="flex flex-wrap gap-2"><Btn variant="ghost" className="min-h-10" onClick={() => void act({ action: "deploy", projectId: p.id, target: "preview" }, "Запустить preview-деплой из подключённого репозитория?")}><Play className="size-4" />Preview deploy</Btn><Btn variant="danger" className="min-h-10" onClick={() => void act({ action: "deploy", projectId: p.id, target: "production" }, "⚠ ДЕПЛОЙ В PRODUCTION. Продолжить?")}><Rocket className="size-4" />Production deploy</Btn></div>
      <div className="flex gap-1">{(["deploys", "env"] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`min-h-10 rounded-lg px-3 text-sm ${tab === t ? "bg-accent/20" : "text-subtle hover:bg-hover"}`}>{t === "deploys" ? "Деплои" : "Переменные окружения"}</button>)}</div>
      {tab === "env" ? <Env projectId={p.id} /> : (
        <div className="space-y-2">
          {err && <Notice tone="err">{err}</Notice>}
          {data?.map((d) => (
            <div key={d.id} className="space-y-1 rounded-xl border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Pill tone={stateTone(d.state)}>{d.state}</Pill><Pill tone={d.target === "production" ? "accent" : "muted"}>{d.target}</Pill><span className="text-[11px] text-muted">{ago(d.created)}</span></div>
              {d.meta?.commit && <div className="truncate text-xs text-subtle">{d.meta.branch}: {d.meta.commit.split("\n")[0]}</div>}
              {d.error && <div className="break-words text-xs text-red-300">{d.error}</div>}
              <div className="flex flex-wrap gap-2 pt-1">
                {d.url && d.state === "READY" && <a href={`https://${d.url}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-border-strong px-3 text-xs text-subtle"><ExternalLink className="size-3" />Открыть</a>}
                <Btn variant="ghost" className="min-h-10 text-xs" onClick={() => void showLogs(d.id)}>Логи</Btn>
                <Btn variant="ghost" className="min-h-10 text-xs" onClick={() => void act({ action: "redeploy", deploymentId: d.id, target: "preview" }, "Повторно развернуть как preview?")}>Redeploy</Btn>
                {d.target === "production" && d.state === "READY" && <Btn variant="danger" className="min-h-10 text-xs" onClick={() => void act({ action: "rollback", projectId: p.id, deploymentId: d.id }, "⚠ Сделать этот деплой текущим production (откат)?")}><Undo2 className="size-3.5" />Откат на этот</Btn>}
              </div>
            </div>
          ))}
          {logs && <div><div className="mb-1 flex items-center justify-between text-xs text-muted"><span>Логи сборки {logs.id.slice(0, 12)}</span><button onClick={() => setLogs(null)} className="min-h-9 px-2">закрыть</button></div><pre className="max-h-80 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background p-3 text-[11px]">{logs.lines.join("\n") || "Логи пусты"}</pre></div>}
        </div>
      )}
    </Card>
  );
}

function Env({ projectId }: { projectId: string }) {
  const { data, err, reload } = useLoad(() => vc<{ id: string; key: string; type: string; target: string[] | string }[]>({ action: "env", projectId }), [projectId]);
  const [f, setF] = useState({ key: "", value: "", prod: true, preview: true });
  return (
    <div className="space-y-2">
      <Notice tone="info">Значения не отображаются (Vercel хранит их зашифрованно). Изменение переменных production влияет на боевое окружение — каждое действие требует подтверждения.</Notice>
      {err && <Notice tone="err">{err}</Notice>}
      {data?.map((e) => <div key={e.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-sm"><code className="min-w-0 flex-1 truncate">{e.key}</code><Pill>{Array.isArray(e.target) ? e.target.join(",") : e.target}</Pill><button aria-label={`Удалить ${e.key}`} className="min-h-9 px-2 text-xs text-red-300" onClick={async () => { if (!confirm(`УДАЛИТЬ переменную ${e.key}?`)) return; try { await vc({ action: "envDelete", projectId, envId: e.id, confirm: true }); reload(); } catch (er) { toast.error(errMsg(er)); } }}>удалить</button></div>)}
      <form className="grid gap-2 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); const target = [f.prod && "production", f.preview && "preview"].filter(Boolean) as string[]; if (!target.length || !confirm(`Добавить ${f.key} в ${target.join(", ")}?`)) return; try { await vc({ action: "envAdd", projectId, key: f.key, value: f.value, target, confirm: true }); toast.success("Переменная сохранена"); setF({ ...f, key: "", value: "" }); reload(); } catch (er) { toast.error(errMsg(er)); } }}>
        <input className={inputCls} placeholder="KEY" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} aria-label="Имя переменной" /><input type="password" autoComplete="off" className={inputCls} placeholder="значение" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} aria-label="Значение" />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={f.prod} onChange={(e) => setF({ ...f, prod: e.target.checked })} />production</label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={f.preview} onChange={(e) => setF({ ...f, preview: e.target.checked })} />preview</label>
        <Btn className="sm:col-span-2" disabled={!f.key || !f.value}>Сохранить переменную</Btn>
      </form>
    </div>
  );
}

/* ----------------------------- Project dashboard ----------------------------- */

export function ProjectDashboard({ project, onChange }: { project: ProjectRecord; onChange: () => void }) {
  const { c, refresh } = useConn();
  const [repoName, setRepoName] = useState(project.folder.split("/").pop() ?? "project");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [live, setLive] = useState<{ commit?: CommitRow; run?: { name: string; status: string; conclusion: string | null }; dep?: VDeploy } | null>(null);
  const [vprojects, setVprojects] = useState<VProject[]>([]);
  const [logs, setLogs] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityRecord[]>([]);
  const [msg, setMsg] = useState("Update from Nexus");

  const loadLive = useCallback(async () => {
    const out: NonNullable<typeof live> = {};
    try {
      if (project.githubRepo && c?.github.connected) {
        out.commit = (await gh<CommitRow[]>({ action: "commits", repo: project.githubRepo, perPage: 1 }))[0];
        out.run = (await gh<{ name: string; status: string; conclusion: string | null }[]>({ action: "runs", repo: project.githubRepo }))[0];
      }
      if (project.vercelProject && c?.vercel.connected) out.dep = (await vc<VDeploy[]>({ action: "deployments", projectId: project.vercelProject, limit: 1 }))[0];
    } catch { /* partial data is fine */ }
    setLive(out);
    setEvents((await getDb().activity.where("project").equals(project.id).toArray()).sort((a, b) => b.ts - a.ts).slice(0, 5));
  }, [project.githubRepo, project.vercelProject, project.id, c]);
  useEffect(() => { if (c) void loadLive(); }, [c, loadLive]);
  useEffect(() => { if (c?.vercel.connected) vc<VProject[]>({ action: "projects" }).then(setVprojects).catch(() => undefined); }, [c?.vercel.connected]);

  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); } };
  const allFiles = async () => (await projectFiles(project.folder)).map((f) => ({ path: f.rel, content: f.content }));

  const createRepo = () => run("repo", async () => {
    if (!confirm(`Создать ${isPrivate ? "ПРИВАТНЫЙ" : "ПУБЛИЧНЫЙ"} репозиторий «${repoName}» и загрузить файлы проекта?`)) return;
    const r = await gh<{ full_name: string }>({ action: "createRepo", name: repoName, description: project.description.slice(0, 200), private: isPrivate, confirm: true });
    await gh({ action: "commitFiles", repo: r.full_name, branch: "main", message: "Initial commit from Nexus", files: await allFiles(), confirm: true });
    await updateProject(project.id, { githubRepo: r.full_name });
    await logActivity({ agent: "Control Center", project: project.id, kind: "commit", title: `Репозиторий ${r.full_name} создан, файлы загружены` });
    toast.success(`Репозиторий ${r.full_name} создан`); onChange();
  });
  const commit = (viaPr: boolean) => run(viaPr ? "pr" : "commit", async () => {
    const repo = project.githubRepo as string;
    const info = (await gh<Repo[]>({ action: "repos" })).find((r) => r.full_name === repo);
    const def = info?.default_branch ?? "main";
    if (!confirm(viaPr ? `Создать ветку, закоммитить ${msg} и открыть PR в ${def}?` : `Закоммитить изменения напрямую в ${def}?`)) return;
    let branch = def;
    if (viaPr) { branch = `nexus/${Date.now().toString(36)}`; await gh({ action: "createBranch", repo, name: branch, from: def }); }
    const r = await gh<{ sha: string }>({ action: "commitFiles", repo, branch, message: msg, files: await allFiles(), confirm: true });
    await logActivity({ agent: "Control Center", project: project.id, kind: "commit", title: `Коммит ${r.sha.slice(0, 7)} → ${branch}`, detail: msg });
    if (viaPr) { const pr = await gh<{ url: string }>({ action: "createPull", repo, title: msg, head: branch, base: def, body: "Создано из Nexus Code Studio", confirm: true }); window.open(pr.url, "_blank", "noopener"); }
    toast.success(viaPr ? "PR создан" : "Изменения сохранены"); void loadLive();
  });
  const linkVercel = (id: string) => run("link", async () => { await updateProject(project.id, { vercelProject: id || undefined }); onChange(); });
  const createVercel = () => run("vproj", async () => {
    const repo = project.githubRepo as string;
    const name = (repoName || "nexus-project").toLowerCase().replace(/[^a-z0-9._-]/g, "-");
    if (!confirm(`Создать проект Vercel «${name}» из ${repo}? Требуется установленное приложение Vercel для GitHub.`)) return;
    const r = await vc<{ id: string }>({ action: "createProject", name, repo, framework: project.stack.includes("Next") ? "nextjs" : null, confirm: true });
    await updateProject(project.id, { vercelProject: r.id });
    await logActivity({ agent: "Control Center", project: project.id, kind: "deploy", title: `Проект Vercel «${name}» создан` });
    onChange();
  });
  const deploy = (target: "preview" | "production", redeploy = false) => run("deploy", async () => {
    const pid = project.vercelProject as string;
    if (!confirm(target === "production" ? "⚠ ДЕПЛОЙ В PRODUCTION. Продолжить?" : "Запустить preview-деплой?")) return;
    const r = redeploy && live?.dep ? await vc<{ id: string }>({ action: "redeploy", deploymentId: live.dep.id, target, confirm: true }) : await vc<{ id: string }>({ action: "deploy", projectId: pid, target, confirm: true });
    await logActivity({ agent: "Control Center", project: project.id, kind: "deploy", title: `${redeploy ? "Redeploy" : "Deploy"} ${target} запущен`, detail: r.id });
    toast.success("Деплой запущен"); setTimeout(() => void loadLive(), 2500);
  });
  const showLogs = () => run("logs", async () => { if (!live?.dep) throw new Error("Деплоев нет"); const l = await vc<{ text: string }[]>({ action: "logs", deploymentId: live.dep.id }); setLogs(l.map((x) => x.text).join("\n") || "Логи пусты"); });
  const revert = () => run("revert", async () => {
    const repo = project.githubRepo as string;
    const info = (await gh<Repo[]>({ action: "repos" })).find((r) => r.full_name === repo);
    const def = info?.default_branch ?? "main";
    const list = await gh<CommitRow[]>({ action: "commits", repo, sha: def, perPage: 2 });
    const prev = list[1];
    if (!prev) throw new Error("Нет предыдущего коммита");
    if (!confirm(`Откатить ${def} к ${prev.sha.slice(0, 7)} («${prev.message.split("\n")[0]}»)? Будет создан новый коммит.`)) return;
    await gh({ action: "revertToCommit", repo, branch: def, sha: prev.sha, confirm: true });
    await logActivity({ agent: "Control Center", project: project.id, kind: "commit", title: `Откат к ${prev.sha.slice(0, 7)}` });
    toast.success("Откат выполнен"); void loadLive();
  });

  const ghOk = c?.github.connected;
  const vOk = c?.vercel.connected;
  const vp = vprojects.find((v) => v.id === project.vercelProject);
  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
      <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><div className="text-muted">GitHub</div>{project.githubRepo ? <a className="break-all text-accent-soft hover:underline" href={`https://github.com/${project.githubRepo}`} target="_blank" rel="noopener noreferrer">{project.githubRepo}</a> : <span className="text-subtle">не создан</span>}</div>
        <div><div className="text-muted">Последний коммит</div><span className="text-subtle">{live?.commit ? `${live.commit.sha.slice(0, 7)} · ${live.commit.message.split("\n")[0].slice(0, 40)}` : "—"}</span></div>
        <div><div className="text-muted">CI / сборка</div>{live?.run ? <Pill tone={stateTone(live.run.conclusion ?? live.run.status)}>{live.run.conclusion ?? live.run.status}</Pill> : <span className="text-subtle">—</span>}</div>
        <div><div className="text-muted">Vercel {vp ? `· ${vp.name}` : ""}</div>{live?.dep ? <span className="flex items-center gap-1"><Pill tone={stateTone(live.dep.state)}>{live.dep.state}</Pill><Pill>{live.dep.target}</Pill></span> : <span className="text-subtle">{project.vercelProject ? "—" : "не подключён"}</span>}</div>
      </div>
      {live?.dep?.error && <Notice tone="err">Ошибка деплоя: {live.dep.error}</Notice>}
      {events.length > 0 && <div className="text-[11px] text-muted">История: {events.map((e) => `${e.title} (${ago(e.ts)})`).join(" · ")}</div>}
      {!ghOk && <Notice tone="warn">Подключите GitHub в разделе «Управление», чтобы работать с репозиторием из Nexus.</Notice>}
      {ghOk && !project.githubRepo && (
        <div className="flex flex-wrap items-end gap-2"><Field label="Имя репозитория"><input className={inputCls} value={repoName} onChange={(e) => setRepoName(e.target.value.replace(/[^\w.-]/g, "-"))} /></Field><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="size-5" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />приватный</label><Btn disabled={busy !== null || !repoName} onClick={() => void createRepo()}>{busy === "repo" ? "…" : "Создать репозиторий"}</Btn></div>
      )}
      {ghOk && project.githubRepo && (
        <div className="space-y-2"><input className={inputCls} value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Сообщение коммита" /><div className="flex flex-wrap gap-2">
          <Btn variant="ghost" disabled={busy !== null} onClick={() => void commit(false)}><GitCommitHorizontal className="size-4" />Сохранить изменения</Btn>
          <Btn variant="ghost" disabled={busy !== null} onClick={() => void commit(true)}><GitPullRequest className="size-4" />Создать PR</Btn>
          <Btn variant="ghost" disabled={busy !== null} onClick={() => void revert()}><Undo2 className="size-4" />Откатить</Btn></div></div>
      )}
      {vOk && project.githubRepo && !project.vercelProject && (
        <div className="flex flex-wrap gap-2"><select aria-label="Подключить проект Vercel" className={`${inputCls} max-w-xs`} value="" onChange={(e) => void linkVercel(e.target.value)}><option value="">Выбрать существующий проект Vercel…</option>{vprojects.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select><Btn variant="ghost" disabled={busy !== null} onClick={() => void createVercel()}>Создать проект Vercel</Btn></div>
      )}
      {vOk && project.vercelProject && (
        <div className="flex flex-wrap gap-2"><Btn variant="ghost" disabled={busy !== null} onClick={() => void deploy("preview")}><Play className="size-4" />Deploy (preview)</Btn><Btn variant="danger" disabled={busy !== null} onClick={() => void deploy("production")}><Rocket className="size-4" />Production</Btn><Btn variant="ghost" disabled={busy !== null || !live?.dep} onClick={() => void deploy("preview", true)}>Redeploy</Btn><Btn variant="ghost" disabled={busy !== null || !live?.dep} onClick={() => void showLogs()}>Логи</Btn>{live?.dep?.url && live.dep.state === "READY" && <a href={`https://${live.dep.url}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border-strong px-4 text-sm text-subtle"><ExternalLink className="size-4" />Открыть сайт</a>}<Btn variant="ghost" onClick={() => { refresh(); void loadLive(); }}><RefreshCw className="size-4" /></Btn></div>
      )}
      {logs && <pre className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background p-3 text-[11px]">{logs}</pre>}
    </div>
  );
}

/* ----------------------------- Agent Activity Monitor ----------------------------- */

interface AuditRow { id: string; ts: number; actor: string; action: string; target: string; ok: boolean; detail?: string; source: string }

export function ActivityMonitor({ projects }: { projects: ProjectRecord[] }) {
  const { c } = useConn();
  const pending = useNexus((s) => s.pending);
  const resolve = useNexus((s) => s.resolvePermission);
  const [local, setLocal] = useState<ActivityRecord[]>([]);
  const [audit, setAudit] = useState<{ events: AuditRow[]; webhookConfigured: boolean; persistent: boolean } | null>(null);
  const [remote, setRemote] = useState<{ title: string; project: string; state: string; ts: number; url?: string; src: string }[]>([]);
  const [updated, setUpdated] = useState<number | null>(null);
  const repos = projects.filter((p) => p.githubRepo).map((p) => p.githubRepo as string);

  const poll = useCallback(async () => {
    setLocal((await getDb().activity.orderBy("ts").reverse().limit(40).toArray()));
    const items: typeof remote = [];
    for (const p of projects) {
      if (p.githubRepo && c?.github.connected) {
        const runs = await gh<{ name: string; status: string; conclusion: string | null; branch: string; created_at: string; url: string }[]>({ action: "runs", repo: p.githubRepo }).catch(() => []);
        runs.slice(0, 3).forEach((r) => items.push({ title: `Actions: ${r.name} (${r.branch})`, project: p.name, state: r.conclusion ?? r.status, ts: new Date(r.created_at).getTime(), url: r.url, src: "GitHub" }));
        const cm = await gh<CommitRow[]>({ action: "commits", repo: p.githubRepo, perPage: 3 }).catch(() => []);
        cm.forEach((x) => items.push({ title: `Коммит ${x.sha.slice(0, 7)}: ${x.message.split("\n")[0].slice(0, 60)}`, project: p.name, state: x.author, ts: new Date(x.date).getTime(), url: x.url, src: "GitHub" }));
      }
      if (p.vercelProject && c?.vercel.connected) {
        const d = await vc<VDeploy[]>({ action: "deployments", projectId: p.vercelProject, limit: 3 }).catch(() => []);
        d.forEach((x) => items.push({ title: `Деплой ${x.target}${x.error ? `: ${x.error.slice(0, 80)}` : ""}`, project: p.name, state: x.state, ts: x.created, url: x.state === "READY" ? `https://${x.url}` : undefined, src: "Vercel" }));
      }
    }
    setRemote(items.sort((a, b) => b.ts - a.ts).slice(0, 25));
    try { const r = await fetch(`/api/integrations/audit?repos=${encodeURIComponent(repos.join(","))}`, { credentials: "same-origin" }); if (r.ok) setAudit(await r.json()); } catch { /* ignore */ }
    setUpdated(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, c, repos.join(",")]);
  useEffect(() => { if (!c) return; void poll(); const t = setInterval(() => void poll(), 20_000); return () => clearInterval(t); }, [c, poll]);
  useEffect(() => { const t = setInterval(async () => setLocal(await getDb().activity.orderBy("ts").reverse().limit(40).toArray()), 3000); return () => clearInterval(t); }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">Агенты и активность</h1><span className="text-[11px] text-muted">обновление каждые 20 с{updated ? ` · ${new Date(updated).toLocaleTimeString()}` : ""}</span><Btn variant="ghost" className="ml-auto min-h-10" onClick={() => void poll()}><RefreshCw className="size-4" /></Btn></div>
      <Notice tone="info">Монитор показывает: (1) журнал агентов Nexus; (2) то, что GitHub и Vercel сообщают через API для связанных проектов; (3) аудит операций из Nexus{audit?.webhookConfigured ? " и вебхуки GitHub" : ""}. Внутренние действия сторонних агентов видны только если они коммитят/деплоят — это отражается в GitHub/Vercel.</Notice>
      <Card className="space-y-2"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-amber-300" />Ожидают подтверждения</div>
        {pending.length === 0 ? <p className="text-xs text-muted">Нет запросов на подтверждение.</p> : pending.map((p) => <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 p-3 text-sm"><div className="min-w-0 flex-1"><div className="font-medium">{p.agent ?? "Nexus"} · {p.capability}</div><div className="break-words text-xs text-muted">{p.detail.slice(0, 200)}</div></div><Btn variant="success" className="min-h-10" onClick={() => resolve(p.id, true)}>Разрешить</Btn><Btn variant="ghost" className="min-h-10" onClick={() => resolve(p.id, false)}>Отклонить</Btn></div>)}</Card>
      <Card className="space-y-2"><div className="text-sm font-semibold">Журнал агентов Nexus и студий</div>
        {local.length === 0 ? <p className="text-xs text-muted">Событий пока нет. Они появятся, когда агенты IDE выполнят задачи или вы создадите проекты.</p> : local.map((e) => <div key={e.id} className="flex items-start gap-2 text-sm"><Pill tone={e.kind === "error" ? "err" : e.kind === "deploy" ? "accent" : "muted"}>{e.kind}</Pill><div className="min-w-0 flex-1"><div className="break-words">{e.title}</div><div className="text-[11px] text-muted">{e.agent}{e.project ? ` · ${projects.find((p) => p.id === e.project)?.name ?? ""}` : ""} · {ago(e.ts)}{e.detail ? ` · ${e.detail.slice(0, 80)}` : ""}</div></div></div>)}</Card>
      <Card className="space-y-2"><div className="text-sm font-semibold">GitHub и Vercel (связанные проекты)</div>
        {!c?.github.connected && !c?.vercel.connected && <p className="text-xs text-muted">Подключите GitHub/Vercel в «Управлении».</p>}
        {remote.length === 0 && (c?.github.connected || c?.vercel.connected) && <p className="text-xs text-muted">Нет событий: свяжите проекты с репозиторием/Vercel в разделе «Проекты».</p>}
        {remote.map((e, i) => <div key={i} className="flex items-start gap-2 text-sm"><Pill tone={stateTone(e.state)}>{e.state}</Pill><div className="min-w-0 flex-1"><div className="break-words">{e.title}</div><div className="text-[11px] text-muted">{e.src} · {e.project} · {ago(e.ts)}{e.url && <> · <a className="text-accent-soft underline" href={e.url} target="_blank" rel="noopener noreferrer">открыть</a></>}</div></div></div>)}</Card>
      <Card className="space-y-2"><div className="text-sm font-semibold">Аудит операций</div>
        {audit && !audit.persistent && <p className="text-[11px] text-amber-200">База данных не настроена: аудит хранится в памяти сервера и может быть потерян при перезапуске.</p>}
        {!audit?.events.length ? <p className="text-xs text-muted">Записей нет (подключите GitHub/Vercel и выполните операцию).</p> : audit.events.map((e) => <div key={e.id} className="flex items-start gap-2 text-xs"><Pill tone={e.ok ? "ok" : "err"}>{e.ok ? "ok" : "fail"}</Pill><div className="min-w-0 flex-1 break-words"><b>{e.action}</b> · {e.target}{e.detail ? ` — ${e.detail}` : ""}<div className="text-[11px] text-muted">{e.actor} · {ago(e.ts)}{e.source === "github-webhook" ? " · webhook" : ""}</div></div></div>)}</Card>
    </div>
  );
}

/* ----------------------------- Control Center ----------------------------- */

export function ControlCenter({ projects, onChange }: { projects: ProjectRecord[]; onChange: () => void }) {
  const { c, refresh } = useConn();
  const [tab, setTab] = useState<"connect" | "github" | "vercel" | "monitor">("connect");
  // Connections may change on the "Подключение" tab (OAuth popup, disconnect) – re-read them when the user leaves it.
  useEffect(() => { refresh(); }, [tab, refresh]);
  void onChange;
  const tabs = [["connect", "Подключение"], ["github", "GitHub"], ["vercel", "Vercel"], ["monitor", "Монитор"]] as const;
  return (
    <div className="space-y-4">
      <div><h1 className="text-xl font-semibold">GitHub & Vercel Control Center</h1><p className="text-sm text-muted">Все операции выполняются через реальные API; опасные действия требуют подтверждения и записываются в аудит.</p></div>
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-panel-2 p-1">{tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`min-h-10 flex-1 shrink-0 rounded-lg px-3 text-sm font-medium ${tab === id ? "bg-accent text-white" : "text-subtle"}`}>{l}</button>)}</div>
      {tab === "connect" && (
        <div className="space-y-4">
          <AccountSection />
          {(
            <details className="rounded-2xl border border-border bg-panel-2/50 p-3">
              <summary className="min-h-10 cursor-pointer text-xs text-muted">Устаревший способ: токены вручную (будет удалён после проверки авторизации на реальных аккаунтах)</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2"><Connect provider="github" state={c?.github} refresh={refresh} /><Connect provider="vercel" state={c?.vercel} refresh={refresh} /></div>
            </details>
          )}
        </div>
      )}
      {tab === "github" && (c?.github.connected ? <GitHubPanel /> : <Notice tone="warn">Сначала подключите GitHub на вкладке «Подключение».</Notice>)}
      {tab === "vercel" && (c?.vercel.connected ? <VercelPanel /> : <Notice tone="warn">Сначала подключите Vercel на вкладке «Подключение».</Notice>)}
      {tab === "monitor" && <ActivityMonitor projects={projects} />}
    </div>
  );
}
