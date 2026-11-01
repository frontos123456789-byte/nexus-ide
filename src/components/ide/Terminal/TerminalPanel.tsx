"use client";

import { ScrollText, SquareTerminal, Trash2, X } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useIdeStore, type BottomTab } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";
import { LogsView } from "./LogsView";
import { ShellView } from "./ShellView";

const TABS: { id: BottomTab; label: string; icon: React.ReactNode }[] = [
  { id: "logs", label: "Логи", icon: <ScrollText className="size-3.5" /> },
  { id: "terminal", label: "Терминал", icon: <SquareTerminal className="size-3.5" /> },
];

export function TerminalPanel() {
  const tab = useIdeStore((s) => s.bottomTab);
  const errorCount = useIdeStore((s) => s.logs.filter((l) => l.level === "error").length);
  const set = useIdeStore.getState();

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Терминал и логи">
      <div className="flex h-8 shrink-0 items-center border-b border-border pr-2">
        <div role="tablist" className="flex h-full items-stretch">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => set.setBottomTab(t.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-wide transition-colors",
                tab === t.id ? "text-foreground" : "text-muted hover:text-subtle",
              )}
            >
              {t.icon}
              {t.label}
              {t.id === "logs" && errorCount > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-300">{errorCount}</span>
              )}
              {tab === t.id && <span className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <Tip label="Очистить логи">
            <button
              onClick={() => set.clearLogs()}
              aria-label="Очистить логи"
              className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
            </button>
          </Tip>
          <Tip label="Закрыть панель">
            <button
              onClick={() => set.setBottomVisible(false)}
              aria-label="Закрыть панель"
              className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </Tip>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <div className={cn("h-full", tab !== "logs" && "hidden")}>
          <LogsView />
        </div>
        <div className={cn("h-full", tab !== "terminal" && "hidden")}>
          <ShellView active={tab === "terminal"} />
        </div>
      </div>
    </section>
  );
}
