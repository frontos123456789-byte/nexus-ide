"use client";

import { useState } from "react";
import { ExternalLink, GitBranch, GitCommitHorizontal, Globe, Loader2, ScrollText, Timer } from "lucide-react";
import { fetchLogs } from "@/lib/monitor/client";
import { formatDuration } from "@/lib/monitor/normalize";
import type { MonitorDeployment, MonitorLogs } from "@/lib/monitor/types";
import { cn } from "@/lib/utils/cn";
import { Notice, Pill } from "@/components/code/ui";
import { ago, fullTime, StatusBadge, STATUS_META } from "./StatusBadge";

const linkCls = "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border-strong px-3 text-xs text-subtle hover:bg-hover hover:text-foreground";

function Logs({ d }: { d: MonitorDeployment }) {
  const [data, setData] = useState<MonitorLogs | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    setErr("");
    try {
      setData(await fetchLogs(d.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не удалось загрузить логи");
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="space-y-2">
      <button onClick={load} disabled={loading} className={linkCls}>
        {loading ? <Loader2 className="size-4 animate-spin" /> : <ScrollText className="size-4" />}
        {data ? "Обновить логи" : "Показать логи сборки"}
      </button>
      {err && <Notice tone="err">{err}</Notice>}
      {data && (
        <div className="rounded-xl border border-border bg-background">
          <pre className="max-h-72 max-w-full overflow-auto p-3 text-[11px] leading-snug" aria-label="Логи сборки">
            {data.lines.length === 0 && <span className="text-muted">Vercel не вернул строк лога для этого деплоя.</span>}
            {data.lines.map((l, i) => (
              <div key={i} className={cn("whitespace-pre-wrap break-words", l.type === "stderr" || l.type === "fatal" ? "text-red-300" : l.type === "command" ? "text-sky-300" : "text-subtle")}>
                {l.text}
              </div>
            ))}
          </pre>
          {data.truncated && <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted">Показаны последние строки. Полный лог — на странице деплоя в Vercel.</div>}
        </div>
      )}
    </div>
  );
}

export function DeploymentCard({ d, tick, showProject = true }: { d: MonitorDeployment; tick: number; showProject?: boolean }) {
  const [open, setOpen] = useState(false);
  const m = STATUS_META[d.status];
  return (
    <article className={cn("min-w-0 rounded-2xl border bg-panel-2", d.status === "error" ? m.ring : "border-border")} data-testid="deployment" data-status={d.status}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full min-w-0 flex-col gap-2 p-3 text-left sm:p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge status={d.status} />
          <Pill tone={d.env === "production" ? "accent" : "muted"}>{d.env === "production" ? "Production" : "Preview"}</Pill>
          {showProject && <span className="min-w-0 truncate text-sm font-semibold">{d.projectName}</span>}
          <span className="ml-auto shrink-0 text-[11px] text-muted" title={fullTime(d.createdAt)}>{ago(d.createdAt, tick)}</span>
        </div>
        <div className="min-w-0 space-y-1">
          <div className="line-clamp-2 break-words text-sm text-foreground">{d.commitMessage ?? <span className="text-muted">Без сообщения коммита</span>}</div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-subtle">
            {d.branch && <span className="inline-flex min-w-0 items-center gap-1"><GitBranch className="size-3.5 shrink-0" /><span className="truncate">{d.branch}</span></span>}
            {d.commitSha && <span className="inline-flex items-center gap-1"><GitCommitHorizontal className="size-3.5" /><code>{d.commitSha.slice(0, 7)}</code></span>}
            <span className="inline-flex items-center gap-1"><Timer className="size-3.5" />{d.status === "building" || d.status === "queued" ? "в процессе" : formatDuration(d.durationMs)}</span>
          </div>
        </div>
        {d.status === "error" && (d.errorMessage || d.errorCode) && <div className="line-clamp-2 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-300">{d.errorMessage ?? d.errorCode}</div>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3 sm:p-4">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Запущен</dt><dd>{fullTime(d.createdAt)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Сборка</dt><dd>{d.buildingAt ? fullTime(d.buildingAt) : "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Завершён</dt><dd>{d.readyAt ? fullTime(d.readyAt) : "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Длительность</dt><dd>{formatDuration(d.durationMs)}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Репозиторий</dt><dd className="min-w-0 break-all">{d.repo ?? "—"}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-muted">Автор</dt><dd className="min-w-0 break-all">{d.commitAuthor ?? "—"}</dd></div>
            <div className="flex gap-2 sm:col-span-2"><dt className="w-24 shrink-0 text-muted">Коммит</dt><dd className="min-w-0 break-words">{d.commitMessage ?? "—"}</dd></div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {d.inspectorUrl && <a href={d.inspectorUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><ScrollText className="size-4" />Логи в Vercel<ExternalLink className="size-3" /></a>}
            {d.url && d.status === "ready" && <a href={d.url} target="_blank" rel="noopener noreferrer" className={linkCls}><Globe className="size-4" />Открыть деплой</a>}
            {d.commitUrl && <a href={d.commitUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><GitCommitHorizontal className="size-4" />Коммит на GitHub</a>}
            {d.branchUrl && <a href={d.branchUrl} target="_blank" rel="noopener noreferrer" className={linkCls}><GitBranch className="size-4" />Ветка</a>}
          </div>
          <Logs d={d} />
        </div>
      )}
    </article>
  );
}
