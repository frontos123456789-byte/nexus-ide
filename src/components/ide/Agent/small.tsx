"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { EXAMPLE_PROMPTS, MODE_META } from "@/lib/agents/examples";
import { runPrompt } from "@/lib/store/agent-actions";
import type { AgentMode } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";

export function TypingDots({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} role="status" aria-label="Агент печатает">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-dot rounded-full bg-accent-soft"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}

export function Collapsible({
  title,
  icon,
  defaultOpen = false,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-border bg-background/60", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 mobile:py-3 text-left text-[11px] mobile:text-xs text-muted transition-colors hover:text-subtle"
      >
        <ChevronRight className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-90")} />
        {icon}
        <span className="truncate">{title}</span>
        {right && <span className="ml-auto shrink-0">{right}</span>}
      </button>
      {open && <div className="border-t border-border px-2.5 py-2 animate-fade-in">{children}</div>}
    </div>
  );
}

const MODE_TIPS: Record<AgentMode, string> = {
  chat: "Задайте вопрос — ассистент видит открытые файлы и отвечает потоково.",
  work: "Опишите цель. Агент разложит её на шаги, покажет ход рассуждений и поможет выполнить план.",
  code: "Опишите изменение. Director создаст план и запустит Architect, Coder и Reviewer параллельно.",
};

export function ExamplePrompts({ mode }: { mode: AgentMode }) {
  return (
    <div className="flex h-full flex-col justify-center mobile:justify-start overflow-y-auto px-4 py-6 animate-slide-up">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent-soft">
          <Sparkles className="size-4" />
        </span>
        <div>
          <h3 className="text-sm font-semibold text-foreground">{MODE_META[mode].label}</h3>
          <p className="text-[11px] text-muted">{MODE_META[mode].tagline}</p>
        </div>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-subtle">{MODE_TIPS[mode]}</p>
      <div className="flex flex-col gap-1.5">
        {EXAMPLE_PROMPTS[mode].map((ex) => (
          <button
            key={ex.title}
            onClick={() => runPrompt(mode, ex.prompt)}
            className="group rounded-lg border border-border bg-background px-3 py-2 mobile:py-3 text-left transition-all hover:-translate-y-px hover:border-accent/50 hover:bg-accent/5"
          >
            <span className="block text-xs mobile:text-sm font-medium text-foreground">{ex.title}</span>
            <span className="mt-0.5 line-clamp-2 block text-[11px] mobile:text-xs leading-snug text-muted group-hover:text-subtle">
              {ex.prompt}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
