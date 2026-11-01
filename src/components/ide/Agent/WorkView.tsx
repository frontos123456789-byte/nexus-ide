"use client";

import { useMemo } from "react";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Circle,
  ListPlus,
  Loader2,
  Play,
  PlayCircle,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { parseWork } from "@/lib/agents/work";
import { useAgentStore, type WorkSession, type WorkStep } from "@/lib/store/agent";
import { executeStep, runAllSteps, startWork, stopAgent, toggleStepDone } from "@/lib/store/agent-actions";
import { useIdeStore } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";
import { useStickToBottom } from "@/lib/utils/use-stick-bottom";
import { Markdown } from "./Markdown";
import { Collapsible, ExamplePrompts, TypingDots } from "./small";

const SIZE_STYLE: Record<string, string> = {
  XS: "bg-emerald-500/10 text-emerald-300",
  S: "bg-emerald-500/10 text-emerald-300",
  M: "bg-amber-500/10 text-amber-300",
  L: "bg-orange-500/10 text-orange-300",
  XL: "bg-red-500/10 text-red-300",
};

function ThoughtsPanel({ text, live }: { text: string; live: boolean }) {
  if (!text) return null;
  return (
    <Collapsible
      icon={<Brain className="size-3 text-violet-400" />}
      title={live ? "Ход мыслей · идёт рассуждение…" : "Ход мыслей"}
      defaultOpen={live}
      className="border-violet-500/20 bg-violet-500/[0.04]"
    >
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-subtle">
        {text}
        {live && <span className="ml-0.5 inline-block h-3 w-1 animate-blink bg-violet-400 align-middle" />}
      </div>
    </Collapsible>
  );
}

function StepIcon({ status }: { status: WorkStep["status"] }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-accent-soft" />;
  if (status === "done") return <CheckCircle2 className="size-4 text-emerald-400" />;
  if (status === "error") return <AlertCircle className="size-4 text-red-400" />;
  return <Circle className="size-4 text-muted" />;
}

function StepCard({ session, step, index, busy }: { session: WorkSession; step: WorkStep; index: number; busy: boolean }) {
  return (
    <li
      className={cn(
        "rounded-xl border bg-background p-2.5 transition-colors animate-slide-up",
        step.status === "running" ? "border-accent/50 shadow-[0_0_0_1px_rgba(99,102,241,0.15)]" : "border-border",
        step.status === "done" && "border-emerald-500/20",
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => toggleStepDone(session.id, step.id)}
          disabled={step.status === "running"}
          aria-label={step.status === "done" ? "Отметить невыполненным" : "Отметить выполненным"}
          className="mt-0.5 shrink-0 rounded-full transition-transform hover:scale-110 disabled:hover:scale-100"
        >
          <StepIcon status={step.status} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] text-muted">{String(index + 1).padStart(2, "0")}</span>
            <span className={cn("text-[13px] font-medium", step.status === "done" ? "text-subtle line-through decoration-border-strong" : "text-foreground")}>
              {step.title}
            </span>
            <span className={cn("ml-auto shrink-0 rounded px-1.5 py-px text-[10px] font-semibold", SIZE_STYLE[step.size])}>{step.size}</span>
          </div>
          {step.detail && <p className="mt-0.5 text-xs leading-relaxed text-muted">{step.detail}</p>}
          {step.error && <p className="mt-1 text-[11px] text-red-400">{step.error}</p>}
        </div>
        <button
          onClick={() => void executeStep(session.id, step.id)}
          disabled={busy}
          aria-label={`Выполнить шаг ${index + 1}`}
          title="Выполнить шаг с помощью агента"
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-accent-soft disabled:opacity-30"
        >
          <Play className="size-3.5" />
        </button>
      </div>
      {(step.result || step.status === "running") && (
        <div className="mt-2 border-t border-border pt-2">
          {step.result ? (
            <Collapsible title={step.status === "running" ? "Результат · генерация…" : "Результат шага"} defaultOpen={step.status === "running"}>
              <Markdown content={step.result} />
              {step.status === "running" && <TypingDots className="mt-2" />}
            </Collapsible>
          ) : (
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <TypingDots /> Агент выполняет шаг…
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function PlanningPreview({ session }: { session: WorkSession }) {
  const showThoughts = useIdeStore((s) => s.showThoughts);
  const parsed = useMemo(() => parseWork(session.raw), [session.raw]);
  const thoughts = [session.reasoning, parsed.thinking].filter(Boolean).join("\n\n");
  const waiting = !session.raw && !session.reasoning;

  return (
    <div className="space-y-3">
      {session.notices.map((n, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <RefreshCw className="size-3 shrink-0 animate-spin" /> {n}
        </div>
      ))}
      {showThoughts && <ThoughtsPanel text={thoughts} live={!parsed.thinkingClosed} />}
      {waiting && (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      )}
      <ul className="space-y-2">
        {parsed.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5 rounded-xl border border-border bg-background p-2.5 animate-slide-up">
            <Circle className="mt-0.5 size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] font-medium text-foreground">{s.title}</span>
              </div>
              {s.detail && <p className="mt-0.5 text-xs text-muted">{s.detail}</p>}
            </div>
          </li>
        ))}
      </ul>
      {!waiting && (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <TypingDots /> {session.modelLabel ? `${session.modelLabel} строит план…` : "Строится план…"}
        </div>
      )}
    </div>
  );
}

function SessionView({ session }: { session: WorkSession }) {
  const showThoughts = useIdeStore((s) => s.showThoughts);
  const busy = useAgentStore((s) => s.busy.work);
  const parsed = useMemo(() => parseWork(session.raw), [session.raw]);
  const thoughts = [session.reasoning, parsed.thinking].filter(Boolean).join("\n\n");

  if (session.phase === "planning") return <PlanningPreview session={session} />;

  if (session.phase === "error") {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Не удалось построить план</div>
            <div className="mt-0.5 break-words text-red-300/90">{session.error}</div>
            <button
              onClick={() => void startWork(session.goal)}
              disabled={busy}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-400/30 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/15 disabled:opacity-40"
            >
              <RefreshCw className="size-3" /> Повторить
            </button>
          </div>
        </div>
        {showThoughts && <ThoughtsPanel text={thoughts} live={false} />}
      </div>
    );
  }

  const done = session.steps.filter((s) => s.status === "done").length;
  const total = session.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Цель</div>
            <p className="mt-0.5 text-[13px] font-medium leading-snug text-foreground">{session.planGoal || session.goal}</p>
          </div>
          {session.modelLabel && (
            <span className="shrink-0 rounded bg-hover px-1.5 py-px font-mono text-[10px] text-muted">{session.modelLabel}</span>
          )}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Прогресс плана">
            <div
              className={cn("h-full rounded-full transition-all duration-500", pct === 100 ? "bg-emerald-400" : "bg-accent")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-subtle">
            {done}/{total} · {pct}%
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2">
          {busy ? (
            <button
              onClick={() => stopAgent("work")}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-red-500/90 px-2.5 text-xs font-medium text-white transition-colors hover:bg-red-500"
            >
              <Square className="size-3 fill-current" /> Остановить
            </button>
          ) : (
            <button
              onClick={() => void runAllSteps(session.id)}
              disabled={done === total}
              className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-xs font-medium text-white transition-colors hover:bg-accent-soft disabled:bg-border-strong disabled:text-muted"
            >
              <PlayCircle className="size-3.5" /> Выполнить все
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted">Клик по кружку — отметить вручную</span>
        </div>
      </div>

      {showThoughts && thoughts && <ThoughtsPanel text={thoughts} live={false} />}

      <ol className="space-y-2">
        {session.steps.map((step, i) => (
          <StepCard key={step.id} session={session} step={step} index={i} busy={busy} />
        ))}
      </ol>
    </div>
  );
}

export function WorkView() {
  const sessions = useAgentStore((s) => s.sessions);
  const activeId = useAgentStore((s) => s.activeSessionId);
  const showThoughts = useIdeStore((s) => s.showThoughts);
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(active?.raw.length ?? 0);
  const store = useAgentStore.getState();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-subtle">
          <Switch checked={showThoughts} onCheckedChange={(v) => useIdeStore.getState().setShowThoughts(v)} aria-label="Показать ход мыслей" />
          <Brain className="size-3.5 text-violet-400" />
          Показать ход мыслей
        </label>
        <div className="ml-auto flex items-center gap-1">
          {sessions.length > 0 && (
            <select
              aria-label="История планов"
              value={activeId ?? ""}
              onChange={(e) => store.setActiveSession(e.target.value || null)}
              className="h-6 max-w-[120px] rounded border border-border-strong bg-background px-1 text-[11px] text-subtle outline-none focus:border-accent"
            >
              <option value="">Новый план</option>
              {[...sessions].reverse().map((s) => (
                <option key={s.id} value={s.id}>
                  {s.goal.slice(0, 40)}
                </option>
              ))}
            </select>
          )}
          {active && (
            <>
              <button
                onClick={() => store.setActiveSession(null)}
                aria-label="Новый план"
                title="Новый план"
                className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground"
              >
                <ListPlus className="size-3.5" />
              </button>
              <button
                onClick={() => store.deleteSession(active.id)}
                aria-label="Удалить план"
                title="Удалить план"
                className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-red-400"
              >
                <Trash2 className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        {active ? (
          <div className="p-3">
            <SessionView session={active} />
          </div>
        ) : (
          <ExamplePrompts mode="work" />
        )}
      </div>
    </div>
  );
}
