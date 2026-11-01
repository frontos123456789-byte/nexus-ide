"use client";

import { ListChecks, MessageSquare, Workflow, type LucideIcon } from "lucide-react";
import { MODE_META } from "@/lib/agents/examples";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore, type AgentMode } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";

const MODES: { id: AgentMode; icon: LucideIcon; accent: string }[] = [
  { id: "chat", icon: MessageSquare, accent: "text-sky-400" },
  { id: "work", icon: ListChecks, accent: "text-amber-400" },
  { id: "code", icon: Workflow, accent: "text-emerald-400" },
];

/** Always-visible segmented control with a sliding indicator. */
export function ModeSwitcher() {
  const mode = useIdeStore((s) => s.agentMode);
  const busy = useAgentStore((s) => s.busy);
  const index = MODES.findIndex((m) => m.id === mode);

  return (
    <div role="tablist" aria-label="Режим агента" className="relative grid grid-cols-3 rounded-lg border border-border bg-background p-0.5">
      <span
        aria-hidden="true"
        className="absolute inset-y-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md bg-hover shadow-sm shadow-black/40 ring-1 ring-border-strong transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {MODES.map((m, i) => {
        const Icon = m.icon;
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            title={`${MODE_META[m.id].tagline} (Alt+${i + 1})`}
            onClick={() => useIdeStore.getState().setAgentMode(m.id)}
            className={cn(
              "relative z-10 flex h-7 mobile:h-10 items-center justify-center gap-1.5 rounded-md text-xs mobile:text-sm font-medium transition-colors",
              active ? "text-foreground" : "text-muted hover:text-subtle",
            )}
          >
            <Icon className={cn("size-3.5 mobile:size-4 transition-colors", active && m.accent)} />
            {MODE_META[m.id].label}
            {busy[m.id] && <span className="size-1.5 animate-pulse rounded-full bg-accent-soft" aria-label="выполняется" />}
          </button>
        );
      })}
    </div>
  );
}
