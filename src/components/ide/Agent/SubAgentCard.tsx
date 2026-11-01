"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Code2,
  Crown,
  DraftingCompass,
  Loader2,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  type LucideIcon,
} from "lucide-react";
import type { AgentRole, AgentStatus } from "@/lib/agents/types";
import type { AgentView } from "@/lib/store/agent";
import { formatDuration } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { cn } from "@/lib/utils/cn";

const ROLE: Record<AgentRole, { label: string; icon: LucideIcon; text: string; ring: string; bg: string; bar: string }> = {
  director: { label: "Director", icon: Crown, text: "text-role-director", ring: "border-role-director/50", bg: "bg-role-director/10", bar: "bg-role-director" },
  architect: { label: "Architect", icon: DraftingCompass, text: "text-role-architect", ring: "border-role-architect/50", bg: "bg-role-architect/10", bar: "bg-role-architect" },
  coder: { label: "Coder", icon: Code2, text: "text-role-coder", ring: "border-role-coder/50", bg: "bg-role-coder/10", bar: "bg-role-coder" },
  reviewer: { label: "Reviewer", icon: ShieldCheck, text: "text-role-reviewer", ring: "border-role-reviewer/50", bg: "bg-role-reviewer/10", bar: "bg-role-reviewer" },
};

const STATUS: Record<AgentStatus, { label: string; cls: string }> = {
  queued: { label: "В очереди", cls: "bg-zinc-500/10 text-zinc-400" },
  running: { label: "Работает", cls: "bg-accent/15 text-accent-soft" },
  done: { label: "Готово", cls: "bg-emerald-500/10 text-emerald-300" },
  error: { label: "Ошибка", cls: "bg-red-500/10 text-red-300" },
  skipped: { label: "Пропущен", cls: "bg-zinc-500/10 text-zinc-500" },
};

function StatusIcon({ status }: { status: AgentStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3 animate-spin" />;
    case "done":
      return <Check className="size-3" />;
    case "error":
      return <AlertTriangle className="size-3" />;
    case "skipped":
      return <SkipForward className="size-3" />;
    default:
      return <Clock className="size-3" />;
  }
}

/** Derives a human-readable "what is it doing" line from raw streamed output. */
function liveActivity(agent: AgentView): string | null {
  if (agent.status !== "running") return null;
  if (agent.role === "coder") {
    const matches = [...agent.output.matchAll(/<file\s+path\s*=\s*["']([^"']+)["']/g)];
    const last = matches[matches.length - 1];
    if (last) return `Пишет ${last[1]}…`;
    return agent.output ? "Подготавливает изменения…" : "Анализирует задачу…";
  }
  if (agent.role === "director") return agent.output ? "Составляет план…" : "Анализирует задачу…";
  if (agent.role === "architect") return agent.output ? "Проектирует решение…" : "Изучает проект…";
  return agent.output ? "Проверяет код…" : "Читает изменения…";
}

export function SubAgentCard({ agent, className }: { agent: AgentView; className?: string }) {
  const [expanded, setExpanded] = useState(false);
  const role = ROLE[agent.role];
  const status = STATUS[agent.status];
  const Icon = role.icon;
  const running = agent.status === "running";
  const now = useNow(running);

  const elapsed = agent.startedAt ? (agent.finishedAt ?? now) - agent.startedAt : 0;
  const tail = useMemo(() => {
    const lines = agent.output.split("\n").filter((l) => l.trim());
    return lines.slice(-4).join("\n");
  }, [agent.output]);
  const activity = liveActivity(agent);

  return (
    <article
      aria-label={`${role.label}: ${agent.title}`}
      aria-busy={running}
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl border bg-background p-2.5 transition-all duration-300 animate-slide-up",
        running ? `${role.ring} shadow-[0_0_24px_-8px_currentColor] ${role.text}` : "border-border",
        agent.status === "queued" && "opacity-60",
        agent.status === "skipped" && "opacity-45",
        agent.status === "error" && "border-red-500/30",
        className,
      )}
    >
      {running && (
        <span className="absolute inset-x-0 top-0 h-px overflow-hidden">
          <span className={cn("block h-full w-full animate-shimmer bg-[linear-gradient(90deg,transparent,currentColor,transparent)] bg-[length:200%_100%]")} />
        </span>
      )}
      <div className="flex items-center gap-2 text-foreground">
        <span className={cn("grid size-6 shrink-0 place-items-center rounded-md", role.bg, role.text)}>
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cn("text-[11px] font-semibold", role.text)}>{role.label}</span>
            {agent.modelLabel && <span className="truncate font-mono text-[10px] text-muted">{agent.modelLabel}</span>}
          </div>
          <div className="truncate text-xs text-foreground" title={agent.title}>
            {agent.title}
          </div>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium", status.cls)}>
          <StatusIcon status={agent.status} /> {status.label}
        </span>
      </div>

      {(activity || agent.startedAt) && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-subtle">
          <span className="truncate">{activity ?? (agent.status === "done" ? "Завершено" : "")}</span>
          {agent.startedAt && <span className="shrink-0 font-mono text-[10px] text-muted">{formatDuration(elapsed)}</span>}
        </div>
      )}

      {agent.notices.length > 0 && (
        <div className="mt-1.5 space-y-0.5">
          {agent.notices.slice(-2).map((n, i) => (
            <div key={i} className="flex items-center gap-1 text-[10.5px] text-amber-300/90">
              <RefreshCw className={cn("size-2.5 shrink-0", running && i === Math.min(agent.notices.length, 2) - 1 && "animate-spin")} />
              <span className="truncate">{n}</span>
            </div>
          ))}
        </div>
      )}

      {agent.error && agent.status !== "done" && (
        <div className="mt-1.5 break-words text-[11px] text-red-300/90">{agent.error}</div>
      )}

      {running && tail && !expanded && (
        <pre className="mt-2 max-h-[70px] overflow-hidden whitespace-pre-wrap break-all rounded-md bg-black/40 p-2 font-mono text-[10px] leading-snug text-muted [mask-image:linear-gradient(to_bottom,transparent,black_35%)]">
          {tail}
        </pre>
      )}

      {agent.output && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-2 flex items-center gap-1 text-[10px] text-muted transition-colors hover:text-subtle"
          >
            <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
            {expanded ? "Скрыть вывод" : "Показать вывод"}
          </button>
          {expanded && (
            <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/40 p-2 font-mono text-[10.5px] leading-relaxed text-subtle animate-fade-in">
              {agent.output}
            </pre>
          )}
        </>
      )}
    </article>
  );
}
