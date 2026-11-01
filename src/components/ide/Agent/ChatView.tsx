"use client";

import { useState } from "react";
import { AlertCircle, Brain, Check, Copy, RefreshCw, RotateCw, Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentStore, type UiMessage } from "@/lib/store/agent";
import { regenerateChat } from "@/lib/store/agent-actions";
import { useIdeStore } from "@/lib/store/ide";
import { useStickToBottom } from "@/lib/utils/use-stick-bottom";
import { cn } from "@/lib/utils/cn";
import { Markdown } from "./Markdown";
import { Collapsible, ExamplePrompts, TypingDots } from "./small";

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1300);
        });
      }}
      aria-label="Копировать ответ"
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-foreground"
    >
      {done ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
      {done ? "Скопировано" : "Копировать"}
    </button>
  );
}

function AssistantMessage({ m, isLast, busy }: { m: UiMessage; isLast: boolean; busy: boolean }) {
  const showThoughts = useIdeStore((s) => s.showThoughts);
  const streaming = m.status === "streaming";
  const connecting = streaming && !m.content && !m.reasoning && !m.model;

  return (
    <div className="group/msg flex gap-2.5 animate-slide-up">
      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-accent/15 text-accent-soft">
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[11px]">
          <span className="font-medium text-foreground">Nexus</span>
          {m.modelLabel && (
            <span className="rounded bg-hover px-1.5 py-px font-mono text-[10px] text-muted" title={m.model}>
              {m.modelLabel}
            </span>
          )}
        </div>

        {m.notices.length > 0 && (
          <div className="mb-1.5 space-y-0.5">
            {m.notices.map((n, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
                <RefreshCw className={cn("size-3 shrink-0", streaming && i === m.notices.length - 1 && "animate-spin")} />
                <span>{n}</span>
              </div>
            ))}
          </div>
        )}

        {m.reasoning && showThoughts && (
          <Collapsible
            className="mb-2"
            icon={<Brain className="size-3 text-violet-400" />}
            title={streaming && !m.content ? "Модель размышляет…" : "Размышления модели"}
            defaultOpen={streaming && !m.content}
          >
            <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted">{m.reasoning}</div>
          </Collapsible>
        )}

        {connecting && (
          <div className="space-y-2 py-1" aria-label="Подключение к модели">
            <Skeleton className="h-3 w-[85%]" />
            <Skeleton className="h-3 w-[65%]" />
            <Skeleton className="h-3 w-[40%]" />
          </div>
        )}

        {streaming && !m.content && !connecting && (
          <div className="flex items-center gap-2 py-1 text-[11px] text-muted">
            <TypingDots /> {m.reasoning ? "Формулирует ответ…" : `Ответ от ${m.modelLabel ?? "модели"}…`}
          </div>
        )}

        {m.content && (
          <div className="relative">
            <Markdown content={m.content} />
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-blink bg-accent-soft" aria-hidden="true" />}
          </div>
        )}

        {m.status === "error" && (
          <div className="mt-1 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-2.5 text-xs text-red-300">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="break-words">{m.error ?? "Ошибка генерации"}</div>
              {isLast && !busy && (
                <button
                  onClick={() => void regenerateChat()}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-red-400/30 px-2 py-0.5 text-[11px] text-red-200 transition-colors hover:bg-red-500/15"
                >
                  <RotateCw className="size-3" /> Повторить
                </button>
              )}
            </div>
          </div>
        )}

        {m.status === "done" && m.content && (
          <div className="mt-1 flex items-center gap-1 opacity-0 mobile:opacity-100 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100">
            <CopyButton text={m.content} />
            {isLast && !busy && (
              <button
                onClick={() => void regenerateChat()}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-hover hover:text-foreground"
              >
                <RotateCw className="size-3" /> Заново
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatView() {
  const messages = useAgentStore((s) => s.messages);
  const hydrated = useAgentStore((s) => s.hydrated);
  const busy = useAgentStore((s) => s.busy.chat);
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(messages);

  if (!hydrated) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (messages.length === 0) return <ExamplePrompts mode="chat" />;

  return (
    <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-3" role="log" aria-live="polite" aria-label="История чата">
      <div className="space-y-4">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end animate-slide-up">
              <div className="max-w-[88%] mobile:max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md border border-border-strong bg-hover px-3 py-2 text-[13px] leading-relaxed text-foreground">
                {m.content}
              </div>
            </div>
          ) : (
            <AssistantMessage key={m.id} m={m} isLast={i === messages.length - 1} busy={busy} />
          ),
        )}
      </div>
    </div>
  );
}
