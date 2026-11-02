"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellRing, ExternalLink, X } from "lucide-react";
import type { MonitorDeployment } from "@/lib/monitor/types";
import { cn } from "@/lib/utils/cn";
import { ago } from "./StatusBadge";

export function NotificationBell({ failures, unread, onOpen, tick }: { failures: MonitorDeployment[]; unread: number; onOpen: () => void; tick: number }) {
  const [open, setOpen] = useState(false);
  const [requested, setRequested] = useState<NotificationPermission | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // read lazily (only once the panel is open, i.e. on the client) to stay hydration-safe
  const perm: NotificationPermission | "unsupported" = !open ? "default" : (requested ?? (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const toggle = () => {
    setOpen((v) => !v);
    if (!open) onOpen();
  };
  return (
    <div ref={ref} className="relative">
      <button onClick={toggle} aria-label={`Уведомления о неудачных деплоях${unread ? `: ${unread} новых` : ""}`} aria-expanded={open} className="relative grid size-11 place-items-center rounded-xl border border-border-strong text-subtle hover:bg-hover">
        {unread ? <BellRing className="size-5 text-red-300" /> : <Bell className="size-5" />}
        {unread > 0 && <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Неудачные деплои" className="fixed inset-x-3 top-20 z-50 max-h-[70dvh] overflow-y-auto rounded-2xl border border-border-strong bg-panel p-3 shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-full md:mt-2 md:w-96">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Неудачные деплои · 24 ч</div>
            <button onClick={() => setOpen(false)} aria-label="Закрыть" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-hover"><X className="size-4" /></button>
          </div>
          {failures.length === 0 && <p className="py-4 text-center text-xs text-muted">За последние 24 часа неудачных деплоев нет.</p>}
          <ul className="space-y-1.5">
            {failures.map((d) => (
              <li key={d.id} className="rounded-xl border border-red-500/25 bg-red-500/5 p-2.5">
                <div className="flex items-center gap-2 text-sm font-medium"><span className="min-w-0 flex-1 truncate">{d.projectName}</span><span className="shrink-0 text-[11px] font-normal text-muted">{ago(d.createdAt, tick)}</span></div>
                <div className="mt-0.5 line-clamp-2 text-[11px] text-subtle">{d.env === "production" ? "Production" : "Preview"}{d.branch ? ` · ${d.branch}` : ""}{d.commitMessage ? ` · ${d.commitMessage}` : ""}</div>
                {d.inspectorUrl && <a href={d.inspectorUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-9 items-center gap-1 text-xs text-accent-soft hover:underline">Открыть логи<ExternalLink className="size-3" /></a>}
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
            Уведомления приходят, пока Nexus открыт (в том числе в фоновой вкладке).
            {perm === "default" && <button className={cn("mt-2 flex min-h-11 w-full items-center justify-center rounded-xl border border-border-strong text-xs text-foreground hover:bg-hover")} onClick={async () => setRequested(await Notification.requestPermission())}>Включить системные уведомления браузера</button>}
            {perm === "granted" && <span className="block text-emerald-300">Системные уведомления браузера включены.</span>}
            {perm === "denied" && <span className="block text-amber-300">Системные уведомления заблокированы в настройках браузера — остаются уведомления внутри Nexus.</span>}
            {perm === "unsupported" && <span className="block">Браузер не поддерживает системные уведомления — остаются уведомления внутри Nexus.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
