"use client";

import { useMemo, useState } from "react";
import { useIdeStore, type LogLevel } from "@/lib/store/ide";
import { clock } from "@/lib/utils/format";
import { useStickToBottom } from "@/lib/utils/use-stick-bottom";
import { cn } from "@/lib/utils/cn";

const LEVEL_STYLE: Record<LogLevel, { tag: string; text: string; label: string }> = {
  info: { tag: "text-sky-400", text: "text-subtle", label: "INFO" },
  success: { tag: "text-emerald-400", text: "text-subtle", label: " OK " },
  warn: { tag: "text-amber-400", text: "text-amber-200/90", label: "WARN" },
  error: { tag: "text-red-400", text: "text-red-300", label: "ERR " },
  ai: { tag: "text-violet-400", text: "text-violet-200/90", label: " AI " },
};

type Filter = "all" | "ai" | "warn" | "error";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "ai", label: "ИИ" },
  { id: "warn", label: "Предупр." },
  { id: "error", label: "Ошибки" },
];

export function LogsView() {
  const logs = useIdeStore((s) => s.logs);
  const [filter, setFilter] = useState<Filter>("all");

  const visible = useMemo(() => {
    if (filter === "all") return logs;
    if (filter === "ai") return logs.filter((l) => l.level === "ai" || l.source === "ai" || l.source === "chat" || l.source === "work" || l.source === "code");
    return logs.filter((l) => l.level === filter);
  }, [logs, filter]);

  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(visible.length);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] transition-colors",
              filter === f.id ? "bg-hover text-foreground" : "text-muted hover:text-subtle",
            )}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[10px] text-muted">{visible.length} записей</span>
      </div>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-1.5 font-mono text-[11.5px] leading-[1.7]" role="log" aria-live="off">
        {visible.length === 0 && <div className="py-4 text-center text-muted">Журнал пуст</div>}
        {visible.map((l) => {
          const st = LEVEL_STYLE[l.level];
          return (
            <div key={l.id} className="flex gap-2.5 whitespace-pre-wrap break-words">
              <span className="shrink-0 text-muted/70">{clock(l.ts)}</span>
              <span className={cn("shrink-0 font-semibold", st.tag)}>{st.label}</span>
              <span className="w-12 shrink-0 text-muted">{l.source}</span>
              <span className={st.text}>{l.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
