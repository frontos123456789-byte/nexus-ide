"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, LogOut, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { authErrorMessage, consumeAuthParams } from "@/lib/auth/client";
import { disconnectMonitor, fetchMonitorStatus } from "@/lib/monitor/client";
import { matchesFilters } from "@/lib/monitor/normalize";
import { STATUSES, type DeployEnv, type DeployStatus, type MonitorProject, type MonitorStatus } from "@/lib/monitor/types";
import { cn } from "@/lib/utils/cn";
import { Btn, Card, Notice, Pill } from "@/components/code/ui";
import { ConnectPanel } from "./ConnectPanel";
import { DeploymentCard } from "./DeploymentCard";
import { NotificationBell } from "./NotificationBell";
import { ago, STATUS_META, StatusBadge } from "./StatusBadge";
import { defaultFilters, FAST_MS, SLOW_MS, useMonitor } from "./useMonitor";

const selectCls = "min-h-11 w-full rounded-xl border border-border-strong bg-background px-3 text-[16px] text-foreground outline-none focus:border-accent sm:text-sm";

function ProjectList({ projects, active, onPick }: { projects: MonitorProject[]; active: string; onPick: (id: string) => void }) {
  return (
    <div className="space-y-1.5" role="group" aria-label="Проекты Vercel">
      <button onClick={() => onPick("")} aria-pressed={active === ""} className={cn("flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm", active === "" ? "border-accent/60 bg-accent/10" : "border-border bg-panel-2 hover:bg-hover")}>
        <span>Все проекты</span><Pill>{projects.length}</Pill>
      </button>
      {projects.map((p) => {
        const st = p.productionStatus ?? p.latestStatus;
        return (
          <button key={p.id} onClick={() => onPick(active === p.id ? "" : p.id)} aria-pressed={active === p.id} className={cn("flex min-h-14 w-full min-w-0 flex-col justify-center gap-0.5 rounded-xl border px-3 py-2 text-left", active === p.id ? "border-accent/60 bg-accent/10" : "border-border bg-panel-2 hover:bg-hover")}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
              {st && <span className={cn("size-2.5 shrink-0 rounded-full", STATUS_META[st].dot)} title={STATUS_META[st].label} />}
            </span>
            <span className="truncate text-[11px] text-muted">{p.domain ?? p.repo ?? p.framework ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

function Dashboard({ status, onDisconnected }: { status: MonitorStatus; onDisconnected: () => void }) {
  const scope = `${status.teamId ?? "personal"}:${status.label ?? ""}`;
  const m = useMonitor({ enabled: true, scope });
  const [disconnecting, setDisconnecting] = useState(false);

  const list = useMemo(() => m.deployments.filter((d) => matchesFilters(d, m.filters)), [m.deployments, m.filters]);
  const counts = useMemo(() => {
    const c: Record<DeployStatus, number> = { queued: 0, building: 0, ready: 0, error: 0, canceled: 0 };
    for (const d of list) c[d.status]++;
    return c;
  }, [list]);
  const activeProject = m.projects.find((p) => p.id === m.filters.projectId);
  const filtered = m.filters.projectId || m.filters.status !== "all" || m.filters.env !== "all";
  const set = (patch: Partial<typeof m.filters>) => m.setFilters({ ...m.filters, ...patch });

  const disconnect = async () => {
    if (!confirm("Отключить Vercel Monitor? Токен будет удалён из Nexus. Интеграцию на стороне Vercel можно удалить на vercel.com/dashboard/integrations.")) return;
    setDisconnecting(true);
    try {
      const r = await disconnectMonitor();
      toast.success("Vercel отключён", { description: r.note, duration: 9000 });
      onDisconnected();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отключить");
      setDisconnecting(false);
    }
  };

  const needsReconnect = m.error?.code === "unauthorized" || m.error?.code === "integration_revoked";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-3 p-3 sm:p-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
          <h1 className="flex items-center gap-2 whitespace-nowrap text-xl font-semibold">Vercel Monitor {m.hasActive && <Loader2 className="size-4 animate-spin text-amber-300" aria-label="Есть активные деплои" />}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            <Pill tone="ok">{status.label ?? "Vercel"}</Pill>
            <Pill>только чтение</Pill>
            <span aria-live="polite">{m.updatedAt ? `обновлено ${ago(m.updatedAt, m.tick)}` : "загрузка…"}</span>
          </div>
        </div>
        <div className="ml-auto sm:ml-0"><NotificationBell failures={m.failures} unread={m.unread} onOpen={m.acknowledgeAll} tick={m.tick} /></div>
        <button
          onClick={() => m.setAutoRefresh(!m.autoRefresh)}
          aria-pressed={m.autoRefresh}
          title={m.autoRefresh ? `Автообновление: каждые ${(m.hasActive ? FAST_MS : SLOW_MS) / 1000} с` : "Автообновление выключено"}
          className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-xs", m.autoRefresh ? "border-emerald-500/40 text-emerald-300" : "border-border-strong text-muted")}
        >
          {m.autoRefresh ? <Pause className="size-4" /> : <Play className="size-4" />}
          <span className="hidden sm:inline">{m.autoRefresh ? `Авто · ${(m.hasActive ? FAST_MS : SLOW_MS) / 1000} с` : "Авто выкл"}</span>
        </button>
        <Btn variant="ghost" onClick={() => void m.refresh()} disabled={m.refreshing} aria-label="Обновить сейчас">
          <RefreshCw className={cn("size-4", m.refreshing && "animate-spin")} /><span className="hidden sm:inline">Обновить</span>
        </Btn>
        <Btn variant="ghost" onClick={disconnect} disabled={disconnecting} aria-label="Отключить Vercel"><LogOut className="size-4" /></Btn>
      </div>

      {m.error && (
        <Notice tone="err">
          <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><div className="min-w-0 flex-1">{m.error.message}{m.error.resetAt ? ` (сброс в ${new Date(m.error.resetAt).toLocaleTimeString("ru-RU")})` : ""}{needsReconnect && <a href="/api/integrations/vercel-monitor/start?next=%2Fcode%3Fview%3Dvercel" className="ml-2 font-semibold underline">Подключить заново</a>}{m.deployments.length > 0 && !needsReconnect && <div className="mt-0.5 text-red-300/80">Показаны последние полученные данные, автообновление продолжается.</div>}</div></div>
        </Notice>
      )}

      {/* status summary */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Сводка по статусам">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => set({ status: m.filters.status === s ? "all" : s })} aria-pressed={m.filters.status === s} className={cn("flex min-h-14 flex-col items-start justify-center rounded-xl border px-3 text-left", m.filters.status === s ? STATUS_META[s].ring + " bg-hover" : "border-border bg-panel-2 hover:bg-hover")}>
            <span className="text-xl font-semibold leading-none">{counts[s]}</span>
            <StatusBadge status={s} className="mt-1 !bg-transparent !p-0" />
          </button>
        ))}
      </div>

      {/* filters */}
      <Card className="grid gap-2 p-3 sm:grid-cols-3">
        <label className="block min-w-0"><span className="mb-1 block text-[11px] font-medium text-subtle">Проект</span>
          <select className={selectCls} value={m.filters.projectId} onChange={(e) => set({ projectId: e.target.value })} aria-label="Фильтр по проекту">
            <option value="">Все проекты ({m.projects.length})</option>
            {m.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block min-w-0"><span className="mb-1 block text-[11px] font-medium text-subtle">Статус</span>
          <select className={selectCls} value={m.filters.status} onChange={(e) => set({ status: e.target.value as DeployStatus | "all" })} aria-label="Фильтр по статусу">
            <option value="all">Все статусы</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
        </label>
        <label className="block min-w-0"><span className="mb-1 block text-[11px] font-medium text-subtle">Окружение</span>
          <select className={selectCls} value={m.filters.env} onChange={(e) => set({ env: e.target.value as DeployEnv | "all" })} aria-label="Фильтр по окружению">
            <option value="all">Production и Preview</option>
            <option value="production">Production</option>
            <option value="preview">Preview</option>
          </select>
        </label>
        {filtered && <button className="min-h-9 text-left text-xs text-accent-soft underline sm:col-span-3" onClick={() => m.setFilters(defaultFilters)}>Сбросить фильтры</button>}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="hidden max-h-[calc(100dvh-16rem)] overflow-y-auto pr-1 lg:block"><ProjectList projects={m.projects} active={m.filters.projectId} onPick={(id) => set({ projectId: id })} /></aside>
        <section className="min-w-0 space-y-2" aria-label="История деплоев">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {activeProject ? `История: ${activeProject.name}` : "История деплоев"}
            <span className="text-[11px] font-normal text-muted">{list.length} показано</span>
          </div>
          {activeProject && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
              {activeProject.domain && <a href={`https://${activeProject.domain}`} target="_blank" rel="noopener noreferrer" className="text-accent-soft hover:underline">{activeProject.domain}</a>}
              {activeProject.repo && <span>{activeProject.repo}</span>}
              {activeProject.framework && <span>{activeProject.framework}</span>}
            </div>
          )}
          {m.loading && list.length === 0 && <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-border bg-panel-2" />)}</div>}
          {!m.loading && list.length === 0 && !m.error && (
            <Card className="py-8 text-center text-sm text-muted">{filtered ? "По выбранным фильтрам деплоев нет." : m.projects.length === 0 ? "В подключённом аккаунте Vercel пока нет проектов." : "У проектов пока нет деплоев."}</Card>
          )}
          {list.map((d) => <DeploymentCard key={d.id} d={d} tick={m.tick} showProject={!m.filters.projectId} />)}
          {m.cursor && list.length > 0 && (
            <Btn variant="ghost" className="w-full" onClick={() => void m.loadMore()} disabled={m.loadingMore}>{m.loadingMore ? <Loader2 className="size-4 animate-spin" /> : null}Загрузить более старые деплои</Btn>
          )}
          {!m.cursor && list.length > 0 && <p className="py-2 text-center text-[11px] text-muted">Это вся история по выбранным фильтрам.</p>}
        </section>
      </div>
    </div>
  );
}

export function VercelMonitor() {
  const [status, setStatus] = useState<MonitorStatus | null>(null);
  const [err, setErr] = useState("");
  const load = () => fetchMonitorStatus().then((s) => { setStatus(s); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : "Не удалось получить состояние"));

  useEffect(() => {
    const r = consumeAuthParams();
    if (r.error && (r.provider === "vercel_monitor" || r.provider === "vercel")) toast.error(authErrorMessage(r.error, "vercel"), { duration: 10_000 });
    if (r.connected === "vercel_monitor") toast.success("Vercel подключён (только чтение)");
    void load();
  }, []);

  if (err) return <div className="mx-auto max-w-2xl p-4"><Notice tone="err">{err}</Notice><Btn className="mt-3" variant="ghost" onClick={() => void load()}>Повторить</Btn></div>;
  if (!status) return <div className="grid min-h-60 place-items-center"><Loader2 className="size-6 animate-spin text-muted" aria-label="Загрузка" /></div>;
  if (!status.connected) return <ConnectPanel s={status} />;
  return <Dashboard status={status} onDisconnected={() => void load()} />;
}
