"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, FileCode2, Square } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { MODE_META } from "@/lib/agents/examples";
import { useAgentStore } from "@/lib/store/agent";
import { runPrompt, stopAgent } from "@/lib/store/agent-actions";
import { useIdeStore, type AgentMode } from "@/lib/store/ide";
import { basename } from "@/lib/utils/path";
import { cn } from "@/lib/utils/cn";

const MAX_HEIGHT = 168;

export function Composer() {
  const mode = useIdeStore((s) => s.agentMode);
  const activePath = useIdeStore((s) => s.activePath);
  const nonce = useIdeStore((s) => s.focusAgentNonce);
  const busy = useAgentStore((s) => s.busy[mode]);
  const includeContext = useAgentStore((s) => s.includeContext);
  const [drafts, setDrafts] = useState<Record<AgentMode, string>>({ chat: "", work: "", code: "" });
  const ref = useRef<HTMLTextAreaElement>(null);
  const text = drafts[mode];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text, mode]);

  useEffect(() => {
    if (nonce > 0) ref.current?.focus();
  }, [nonce]);

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    setDrafts((d) => ({ ...d, [mode]: "" }));
    runPrompt(mode, value);
  };

  return (
    <div className="shrink-0 border-t border-border bg-panel p-2.5">
      <div
        className={cn(
          "rounded-xl border bg-background transition-colors focus-within:border-accent/60",
          busy ? "border-accent/30" : "border-border-strong",
        )}
      >
        <textarea
          ref={ref}
          value={text}
          rows={1}
          enterKeyHint="enter"
          aria-label={`Сообщение агенту (${MODE_META[mode].label})`}
          placeholder={MODE_META[mode].placeholder}
          onChange={(e) => setDrafts((d) => ({ ...d, [mode]: e.target.value }))}
          onKeyDown={(e) => {
            // On touch devices Enter inserts a newline (soft keyboards have no Shift); the arrow button sends.
            const touch = window.matchMedia("(pointer: coarse)").matches;
            if (e.key === "Enter" && !e.shiftKey && !touch && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="block max-h-[168px] w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[13px] mobile:text-base leading-relaxed text-foreground outline-none placeholder:text-muted"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <Tip label={includeContext ? "Контекст проекта включён" : "Контекст проекта выключен"} side="top">
            <button
              onClick={() => useAgentStore.getState().setIncludeContext(!includeContext)}
              aria-pressed={includeContext}
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1 mobile:py-2 text-[10px] mobile:text-[11px] transition-colors",
                includeContext
                  ? "border-accent/30 bg-accent/10 text-accent-soft"
                  : "border-border text-muted hover:text-subtle",
              )}
            >
              <FileCode2 className="size-3 shrink-0" />
              <span className="truncate">
                {includeContext ? (activePath ? basename(activePath) : "Проект") : "Без контекста"}
              </span>
            </button>
          </Tip>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-muted sm:inline mobile:!hidden">↵ отправить · ⇧↵ перенос</span>
            {busy ? (
              <Tip label="Остановить" side="top">
                <button
                  onClick={() => stopAgent(mode)}
                  aria-label="Остановить генерацию"
                  className="grid size-7 mobile:size-10 place-items-center rounded-lg bg-red-500/90 text-white transition-all hover:bg-red-500 active:scale-95"
                >
                  <Square className="size-3 fill-current" />
                </button>
              </Tip>
            ) : (
              <button
                onClick={send}
                disabled={!text.trim()}
                aria-label="Отправить"
                className="grid size-7 mobile:size-10 place-items-center rounded-lg bg-accent text-white transition-all hover:bg-accent-soft active:scale-95 disabled:bg-border-strong disabled:text-muted"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
