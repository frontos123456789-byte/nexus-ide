"use client";

import { AlertTriangle, Bot, Eraser } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { FREE_MODEL_CHAIN } from "@/lib/openrouter/models";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore, type AiState } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";
import { ChatView } from "./ChatView";
import { CodeView } from "./CodeView";
import { Composer } from "./Composer";
import { ModeSwitcher } from "./ModeSwitcher";
import { WorkView } from "./WorkView";

const DOT: Record<AiState, string> = {
  idle: "bg-emerald-400",
  connecting: "bg-amber-400 animate-pulse",
  streaming: "bg-sky-400 animate-pulse",
  switching: "bg-orange-400 animate-pulse",
  error: "bg-red-400",
};

function ModelBadge() {
  const ai = useIdeStore((s) => s.ai);
  return (
    <Tip
      side="bottom"
      label={
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">Цепочка fallback (:free)</div>
          {FREE_MODEL_CHAIN.map((m, i) => (
            <div key={m.id} className={cn("font-mono text-[10px]", ai.model === m.id ? "text-accent-soft" : "text-muted")}>
              {i + 1}. {m.label}
            </div>
          ))}
        </div>
      }
    >
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5 mobile:py-1.5 text-[10px] mobile:text-[11px] text-subtle" aria-live="polite">
        <span className={cn("size-1.5 shrink-0 rounded-full", DOT[ai.state])} />
        <span className="max-w-[130px] mobile:max-w-[44vw] truncate">
          {ai.state === "switching" ? "Переключение…" : (ai.modelLabel ?? "Авто-выбор модели")}
        </span>
      </div>
    </Tip>
  );
}

export function AgentPanel() {
  const mode = useIdeStore((s) => s.agentMode);
  const configured = useIdeStore((s) => s.ai.configured);

  const clear = () => {
    const a = useAgentStore.getState();
    if (mode === "chat") a.clearChat();
    else if (mode === "work") a.sessions.forEach((s) => a.deleteSession(s.id));
    else a.clearRuns();
  };

  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel" aria-label="ИИ-агент">
      <div className="flex shrink-0 flex-col gap-2 mobile:gap-2.5 border-b border-border p-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Bot className="size-4 text-accent-soft" />
            <span className="text-xs mobile:text-sm font-semibold text-foreground">Агент</span>
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <ModelBadge />
            <Tip label="Очистить историю режима">
              <button
                onClick={clear}
                aria-label="Очистить историю режима"
                className="grid size-6 mobile:size-9 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground"
              >
                <Eraser className="size-3.5" />
              </button>
            </Tip>
          </div>
        </div>
        <ModeSwitcher />
      </div>

      {configured === false && (
        <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-200">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Не задан <code className="rounded bg-black/30 px-1 font-mono">OPENROUTER_API_KEY</code>. Добавьте ключ в переменные окружения
            и перезапустите приложение.
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1">
        {mode === "chat" && <ChatView />}
        {mode === "work" && <WorkView />}
        {mode === "code" && <CodeView />}
      </div>

      <Composer />
    </aside>
  );
}
