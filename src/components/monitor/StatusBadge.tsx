import { cn } from "@/lib/utils/cn";
import type { DeployStatus } from "@/lib/monitor/types";

export const STATUS_META: Record<DeployStatus, { label: string; dot: string; chip: string; ring: string }> = {
  queued: { label: "Queued", dot: "bg-slate-400", chip: "bg-slate-500/15 text-slate-300", ring: "border-slate-500/40" },
  building: { label: "Building", dot: "bg-amber-400 animate-pulse", chip: "bg-amber-500/15 text-amber-300", ring: "border-amber-500/40" },
  ready: { label: "Ready", dot: "bg-emerald-400", chip: "bg-emerald-500/15 text-emerald-300", ring: "border-emerald-500/40" },
  error: { label: "Error", dot: "bg-red-400", chip: "bg-red-500/15 text-red-300", ring: "border-red-500/50" },
  canceled: { label: "Canceled", dot: "bg-zinc-500", chip: "bg-zinc-500/15 text-zinc-300", ring: "border-zinc-500/40" },
};

export function StatusBadge({ status, className }: { status: DeployStatus; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", m.chip, className)} data-status={status}>
      <span className={cn("size-2 rounded-full", m.dot)} aria-hidden />
      {m.label}
    </span>
  );
}

export const ago = (t: number, _tick = 0): string => {
  void _tick;
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 10) return "только что";
  if (s < 60) return `${Math.floor(s)} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} дн назад`;
  return new Date(t).toLocaleDateString("ru-RU");
};

export const fullTime = (t: number) => new Date(t).toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
