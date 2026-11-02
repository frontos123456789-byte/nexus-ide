"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, LogOut, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { authErrorMessage, consumeAuthParams, disconnect, fetchAccount, logout, manage, unlinkIdentity, type AccountView } from "@/lib/auth/client";
import { callIntegration } from "@/lib/integrations/client";
import { Btn, Card, inputCls, Notice, Pill } from "@/components/code/ui";

export function GithubMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

export function VercelMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2 23 21H1L12 2Z" />
    </svg>
  );
}

interface Repo { full_name: string; private: boolean; default_branch: string }
interface VProject { id: string; name: string; framework?: string | null; latest?: { state?: string } | null }
interface VTeam { id: string | null; name: string; slug: string | null; current: boolean }

const here = () => `${window.location.pathname}?settings=account`;
const linkHref = (p: "github" | "vercel") => `/api/auth/login/${p}?intent=link&next=${encodeURIComponent(here())}`;
const loginHref = (p: "github" | "vercel") => `/api/auth/login/${p}?next=${encodeURIComponent(here())}`;

function StatusPill({ on }: { on: boolean }) {
  return on ? <Pill tone="ok">Подключён</Pill> : <Pill tone="muted">Не подключён</Pill>;
}

function Avatar({ src, name }: { src?: string | null; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" referrerPolicy="no-referrer" className="size-10 shrink-0 rounded-full border border-border bg-panel" /> : <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold">{name.slice(0, 1).toUpperCase()}</span>;
}

function LinkBtn({ href, children, variant = "primary" }: { href: string; children: React.ReactNode; variant?: "primary" | "ghost" }) {
  return (
    <a href={href} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-colors ${variant === "primary" ? "bg-accent text-white hover:bg-accent-soft" : "border border-border-strong text-subtle hover:bg-hover hover:text-foreground"}`}>
      {children}
    </a>
  );
}

export function AccountSection() {
  const [acc, setAcc] = useState<AccountView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    setAcc(await fetchAccount());
    setLoading(false);
  }, []);

  useEffect(() => {
    const r = consumeAuthParams();
    if (r.error) toast.error(authErrorMessage(r.error, r.provider));
    if (r.connected) toast.success(`${r.connected === "github" ? "GitHub" : "Vercel"} подключён`);
    if (r.linked) toast.success(`${r.linked === "github" ? "GitHub" : "Vercel"} привязан к аккаунту`);
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy("");
    }
  };

  if (loading) return <Loader2 className="size-5 animate-spin text-muted" aria-label="Загрузка" />;
  if (!acc) return <Notice tone="err">Не удалось получить состояние аккаунта. Проверьте соединение.</Notice>;

  if (!acc.user) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-subtle">Войдите, чтобы подключить GitHub и Vercel через официальную авторизацию — без ручного ввода токенов.</p>
        <LoginButtons acc={acc} href={loginHref} />
        {!acc.configured.database && <Notice tone="warn">На сервере не настроена база данных (DATABASE_URL) — вход недоступен.</Notice>}
      </div>
    );
  }

  const u = acc.user;
  const ghIdentity = u.identities.find((i) => i.provider === "github");
  const vcIdentity = u.identities.find((i) => i.provider === "vercel");

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-3">
        <Avatar src={u.avatar} name={u.name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{u.name}</div>
          <div className="flex flex-wrap gap-1 pt-1">{u.identities.map((i) => <Pill key={i.provider} tone="accent">{i.provider === "github" ? "GitHub" : "Vercel"}: {i.login}</Pill>)}</div>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Btn variant="ghost" className="flex-1 sm:flex-none" disabled={busy === "logout"} onClick={() => run("logout", async () => { await logout(); window.location.href = "/login"; })}><LogOut className="size-4" />Выйти</Btn>
          <Btn variant="ghost" className="flex-1 sm:flex-none" disabled={busy === "logoutAll"} onClick={() => { if (confirm("Выйти на всех устройствах?")) void run("logoutAll", async () => { await logout(true); window.location.href = "/login"; }); }}>На всех устройствах</Btn>
        </div>
      </Card>

      {/* ------------------------------ GitHub ------------------------------ */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><GithubMark /><span className="text-sm font-semibold">GitHub</span><StatusPill on={Boolean(acc.github?.connected)} /></div>
        {!ghIdentity && (
          <>
            <p className="text-xs text-muted">Привяжите GitHub-аккаунт к этому профилю (требуется ваша активная сессия — по e-mail аккаунты не объединяются).</p>
            {acc.configured.githubLogin ? <LinkBtn href={linkHref("github")}><GithubMark className="size-4" />Привязать GitHub</LinkBtn> : <Notice tone="warn">Вход через GitHub не настроен владельцем Nexus.</Notice>}
          </>
        )}
        {ghIdentity && !acc.github?.connected && (
          <>
            <p className="text-xs text-muted">Вы вошли как <b>{ghIdentity.login}</b>. Чтобы Nexus мог работать с репозиториями, установите GitHub App и выберите репозитории — это делается на официальной странице GitHub.</p>
            {acc.configured.githubApp ? <LinkBtn href={`/api/integrations/github/install?next=${encodeURIComponent(here())}`}><GithubMark className="size-4" />Установить GitHub App</LinkBtn> : <Notice tone="warn">GitHub App ещё не создана владельцем Nexus (docs/OAUTH_SETUP.md, шаг 2).</Notice>}
          </>
        )}
        {acc.github?.connected && <GithubConnected acc={acc} busy={busy} run={run} />}
        {ghIdentity && <button className="min-h-9 text-[11px] text-muted underline decoration-dotted" onClick={() => { if (confirm("Отвязать вход через GitHub? Авторизация Nexus в GitHub будет отозвана.")) void run("unlink-gh", () => unlinkIdentity("github"), "GitHub отвязан"); }}>Отвязать вход через GitHub</button>}
      </Card>

      {/* ------------------------------ Vercel ------------------------------ */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2"><VercelMark /><span className="text-sm font-semibold">Vercel</span><StatusPill on={Boolean(acc.vercel?.connected)} /></div>
        {!vcIdentity && (
          <>
            <p className="text-xs text-muted">Вход через Vercel подтверждает вашу личность. Доступ к проектам подключается отдельно (ниже).</p>
            {acc.configured.vercelLogin ? <LinkBtn href={linkHref("vercel")} variant="ghost"><VercelMark className="size-4" />Привязать вход через Vercel</LinkBtn> : <Notice tone="info">Sign in with Vercel не настроен владельцем Nexus.</Notice>}
          </>
        )}
        {acc.vercel?.connected ? (
          <VercelConnected acc={acc} busy={busy} run={run} />
        ) : acc.configured.vercelIntegration ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">«Подключить Vercel» откроет официальную установку Vercel Integration: вы выберете аккаунт или команду и подтвердите права.</p>
            <Btn onClick={() => connectVercelPopup(load)}><VercelMark className="size-4" />Подключить Vercel</Btn>
          </div>
        ) : (
          <Notice tone="warn">Vercel Integration ещё не создана владельцем Nexus (docs/OAUTH_SETUP.md, шаг 3). Известное ограничение Vercel: «Sign in with Vercel» даёт только идентификацию, а доступ к REST API (проекты, деплои, переменные) выдаётся через Integration.</Notice>
        )}
        {vcIdentity && <button className="min-h-9 text-[11px] text-muted underline decoration-dotted" onClick={() => { if (confirm("Отвязать вход через Vercel?")) void run("unlink-vc", () => unlinkIdentity("vercel"), "Vercel отвязан"); }}>Отвязать вход через Vercel</button>}
      </Card>
    </div>
  );
}

function connectVercelPopup(onDone: () => void) {
  const w = window.open(`/api/integrations/vercel/start?popup=1&next=${encodeURIComponent(here())}`, "nexus-vercel", "popup,width=560,height=760");
  if (!w) {
    window.location.href = `/api/integrations/vercel/start?next=${encodeURIComponent(here())}`;
    return;
  }
  const t = setInterval(() => {
    if (w.closed) {
      clearInterval(t);
      onDone();
    }
  }, 700);
}

export function LoginButtons({ acc, href }: { acc: AccountView; href: (p: "github" | "vercel") => string }) {
  const btn = "flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl px-4 text-[15px] font-medium transition-colors";
  return (
    <div className="space-y-2.5">
      {acc.configured.githubLogin && acc.configured.database ? (
        <a href={href("github")} className={`${btn} bg-white text-black hover:bg-white/90`}><GithubMark />Продолжить через GitHub</a>
      ) : (
        <div className="space-y-1"><button disabled className={`${btn} cursor-not-allowed bg-white/10 text-muted`}><GithubMark />Продолжить через GitHub</button><p className="text-center text-[11px] text-amber-300">Не настроено владельцем (GITHUB_OAUTH_CLIENT_ID / SECRET)</p></div>
      )}
      {acc.configured.vercelLogin && acc.configured.database ? (
        <a href={href("vercel")} className={`${btn} border border-border-strong bg-panel-2 hover:bg-hover`}><VercelMark />Продолжить через Vercel</a>
      ) : (
        <div className="space-y-1"><button disabled className={`${btn} cursor-not-allowed border border-border bg-white/5 text-muted`}><VercelMark />Продолжить через Vercel</button><p className="text-center text-[11px] text-amber-300">Не настроено владельцем (VERCEL_APP_CLIENT_ID / SECRET)</p></div>
      )}
    </div>
  );
}

type Run = (key: string, fn: () => Promise<unknown>, ok?: string) => Promise<void>;

function GithubConnected({ acc, busy, run }: { acc: AccountView; busy: string; run: Run }) {
  const g = acc.github!;
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [err, setErr] = useState("");
  const [mode, setMode] = useState<"all" | "selected">(g.repoMode);
  const [sel, setSel] = useState<Set<string>>(new Set(g.selectedRepos));

  useEffect(() => {
    callIntegration<Repo[]>("github", { action: "repos", all: true }).then(setRepos).catch((e) => setErr(e instanceof Error ? e.message : "Ошибка"));
  }, [g.installationId]);

  const toggle = (name: string) => setSel((s) => { const n = new Set(s); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  const perms = Object.entries(g.permissions);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3"><Avatar src={g.avatar} name={g.login ?? "G"} /><div className="min-w-0"><div className="truncate text-sm font-medium">{g.login}</div><div className="text-[11px] text-muted">{g.accountType === "Organization" ? "Организация" : "Личный аккаунт"} · установка #{g.installationId}</div></div></div>
      {perms.length > 0 && <div className="flex flex-wrap gap-1">{perms.map(([k, v]) => <Pill key={k} tone={v === "write" ? "warn" : "muted"}>{k}: {v}</Pill>)}</div>}

      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="text-xs font-semibold">Репозитории, доступные Nexus</div>
        <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="repomode" checked={mode === "all"} onChange={() => setMode("all")} className="size-4" />Все из установки</label>
          <label className="flex min-h-10 items-center gap-2 text-sm"><input type="radio" name="repomode" checked={mode === "selected"} onChange={() => setMode("selected")} className="size-4" />Только выбранные</label>
        </div>
        {err && <Notice tone="err">{err}</Notice>}
        {!repos && !err && <Loader2 className="size-4 animate-spin text-muted" />}
        {repos && repos.length === 0 && <p className="text-xs text-muted">В установке пока нет репозиториев — добавьте их через «Управление доступом».</p>}
        {repos && repos.length > 0 && (
          <div className="max-h-48 overflow-auto rounded-lg border border-border">
            {repos.map((r) => (
              <label key={r.full_name} className={`flex min-h-11 items-center gap-2 border-b border-border px-3 text-sm last:border-b-0 ${mode === "all" ? "opacity-60" : ""}`}>
                <input type="checkbox" className="size-4" disabled={mode === "all"} checked={mode === "all" || sel.has(r.full_name)} onChange={() => toggle(r.full_name)} />
                <span className="min-w-0 flex-1 truncate">{r.full_name}</span>
                {r.private && <Pill tone="warn">private</Pill>}
              </label>
            ))}
          </div>
        )}
        <Btn className="w-full sm:w-auto" disabled={busy === "repos" || (mode === "selected" && sel.size === 0)} onClick={() => run("repos", () => manage({ action: "setRepoSelection", mode, repos: [...sel] }), "Доступ к репозиториям сохранён")}>Сохранить выбор</Btn>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {g.manageUrl && <a href={g.manageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border-strong px-4 text-sm text-subtle hover:bg-hover">Управление доступом на GitHub<ExternalLink className="size-3.5" /></a>}
        <Btn variant="ghost" disabled={busy === "resync"} onClick={() => run("resync", () => manage({ action: "resyncGithub" }), "Данные обновлены")}><RefreshCw className="size-4" />Обновить</Btn>
        <Btn variant="danger" disabled={busy === "disc-gh"} onClick={() => {
          if (!confirm("Отключить GitHub? Nexus потеряет доступ к репозиториям.")) return;
          const uninstall = confirm("Также удалить установку GitHub App на стороне GitHub?\n\nОК — удалить установку полностью, Отмена — только отключить Nexus.");
          void run("disc-gh", () => disconnect("github", uninstall), "GitHub отключён");
        }}>Отключить</Btn>
      </div>
    </div>
  );
}

function VercelConnected({ acc, busy, run }: { acc: AccountView; busy: string; run: Run }) {
  const v = acc.vercel!;
  const [projects, setProjects] = useState<VProject[] | null>(null);
  const [teams, setTeams] = useState<VTeam[] | null>(null);
  const [err, setErr] = useState("");
  const [allow, setAllow] = useState(v.envAllow.join(", "));

  useEffect(() => {
    callIntegration<VProject[]>("vercel", { action: "projects" }).then(setProjects).catch((e) => setErr(e instanceof Error ? e.message : "Ошибка"));
    callIntegration<VTeam[]>("vercel", { action: "teams" }).then(setTeams).catch(() => setTeams([]));
  }, [v.configurationId]);

  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{v.login ?? "Vercel"}<span className="ml-2 text-[11px] text-muted">{v.teamId ? `команда ${v.teamId}` : "личный аккаунт"}</span></div>
      {teams && teams.length > 0 && <div className="flex flex-wrap gap-1">{teams.map((t) => <Pill key={t.id ?? "personal"} tone={t.current ? "ok" : "muted"}>{t.name}</Pill>)}</div>}
      {err && <Notice tone="err">{err}</Notice>}
      <div className="space-y-1">
        <div className="text-xs font-semibold">Проекты{projects ? ` (${projects.length})` : ""}</div>
        {!projects && !err && <Loader2 className="size-4 animate-spin text-muted" />}
        {projects && projects.length === 0 && <p className="text-xs text-muted">Проектов нет — создайте их в Control Center.</p>}
        {projects && projects.length > 0 && <div className="max-h-40 overflow-auto rounded-lg border border-border">{projects.map((p) => <div key={p.id} className="flex min-h-10 items-center gap-2 border-b border-border px-3 text-sm last:border-b-0"><span className="min-w-0 flex-1 truncate">{p.name}</span>{p.framework && <span className="text-[11px] text-muted">{p.framework}</span>}{p.latest?.state && <Pill tone={p.latest.state === "READY" ? "ok" : p.latest.state === "ERROR" ? "err" : "warn"}>{p.latest.state}</Pill>}</div>)}</div>}
      </div>
      <div className="space-y-2 rounded-xl border border-border p-3">
        <div className="text-xs font-semibold">Разрешённые переменные окружения</div>
        <input className={inputCls} value={allow} onChange={(e) => setAllow(e.target.value)} placeholder="Например: NEXT_PUBLIC_*, API_URL (пусто — любые, кроме зарезервированных)" aria-label="Разрешённые ключи переменных окружения" />
        <p className="text-[11px] text-muted">Nexus сможет добавлять и удалять только эти ключи. Значения никогда не возвращаются в браузер. Ключи VERCEL_* всегда заблокированы.</p>
        <Btn className="w-full sm:w-auto" disabled={busy === "env"} onClick={() => run("env", () => manage({ action: "setEnvAllowlist", patterns: allow.split(/[\s,]+/).filter(Boolean) }), "Список сохранён")}>Сохранить список</Btn>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <a href="https://vercel.com/dashboard/integrations" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border-strong px-4 text-sm text-subtle hover:bg-hover">Управление доступом на Vercel<ExternalLink className="size-3.5" /></a>
        <Btn variant="danger" disabled={busy === "disc-vc"} onClick={() => { if (confirm("Отключить Vercel? Интеграция будет удалена на стороне Vercel, токен станет недействительным.")) void run("disc-vc", async () => { const r = await disconnect("vercel"); r.warnings?.forEach((w) => toast.warning(w)); }, "Vercel отключён"); }}>Отключить</Btn>
      </div>
    </div>
  );
}
