"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCheck,
  Eye,
  Info,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAgentStore, type AgentView, type CodeRun, type ProposalView } from "@/lib/store/agent";
import { applyAllProposals, applyProposal, rejectProposal, startCodeRun } from "@/lib/store/agent-actions";
import { useIdeStore } from "@/lib/store/ide";
import { diffStats } from "@/lib/utils/diff";
import { formatDuration } from "@/lib/utils/format";
import { useNow } from "@/lib/utils/use-now";
import { cn } from "@/lib/utils/cn";
import { FileIcon } from "../FileTree/FileIcon";
import { Markdown } from "./Markdown";
import { SubAgentCard } from "./SubAgentCard";
import { ExamplePrompts, TypingDots } from "./small";

/** Groups sub-agents into dependency "waves"; agents in one wave run in parallel. */
export function computeWaves(agents: AgentView[]): AgentView[][] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const level = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    const cached = level.get(id);
    if (cached !== undefined) return cached;
    const a = byId.get(id);
    if (!a || seen.has(id)) return 0;
    seen.add(id);
    const deps = a.dependsOn.filter((d) => byId.has(d));
    const l = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((d) => visit(d, seen)));
    level.set(id, l);
    return l;
  };
  for (const a of agents) visit(a.id, new Set());
  const waves: AgentView[][] = [];
  for (const a of agents) {
    const l = level.get(a.id) ?? 0;
    (waves[l] ??= []).push(a);
  }
  return waves.filter(Boolean);
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex justify-center py-0.5" aria-hidden="true">
      <div className={cn("h-3 w-px transition-colors", active ? "bg-accent" : "bg-border-strong")} />
    </div>
  );
}

function RunStatusBadge({ run }: { run: CodeRun }) {
  const map = {
    running: { label: "Выполняется", cls: "bg-accent/15 text-accent-soft" },
    done: { label: "Завершён", cls: "bg-emerald-500/10 text-emerald-300" },
    error: { label: "Ошибка", cls: "bg-red-500/10 text-red-300" },
    cancelled: { label: "Остановлен", cls: "bg-zinc-500/10 text-zinc-400" },
  } as const;
  const s = map[run.status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", s.cls)}>{s.label}</span>;
}

function ProposalRow({ runId, p }: { runId: string; p: ProposalView }) {
  const stats = useMemo(() => diffStats(p.original, p.content), [p.original, p.content]);
  const isNew = p.original === null;
  return (
    <li className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-2 animate-slide-up">
      <FileIcon path={p.path} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-foreground" title={p.path}>
          {p.path}
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className={isNew ? "text-emerald-300" : "text-amber-300"}>{isNew ? "новый" : "изменён"}</span>
          <span className="text-emerald-400">+{stats.added}</span>
          <span className="text-red-400">−{stats.removed}</span>
          {p.status !== "pending" && (
            <span className={p.status === "applied" ? "text-emerald-400" : "text-muted"}>
              {p.status === "applied" ? "применено" : "отклонено"}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => useIdeStore.getState().setDiffView({ runId, path: p.path })}
        aria-label={`Показать diff ${p.path}`}
        title="Открыть diff"
        className="grid size-6 mobile:size-9 place-items-center rounded-md text-muted transition-colors hover:bg-hover hover:text-foreground"
      >
        <Eye className="size-3.5" />
      </button>
      {p.status === "pending" && (
        <>
          <button
            onClick={() => rejectProposal(runId, p.path)}
            aria-label={`Отклонить ${p.path}`}
            title="Отклонить"
            className="grid size-6 mobile:size-9 place-items-center rounded-md text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
          >
            <X className="size-3.5" />
          </button>
          <button
            onClick={() => void applyProposal(runId, p.path)}
            aria-label={`Применить ${p.path}`}
            title="Применить"
            className="grid size-6 mobile:size-9 place-items-center rounded-md text-emerald-400 transition-colors hover:bg-emerald-500/15"
          >
            <Check className="size-3.5" />
          </button>
        </>
      )}
    </li>
  );
}

function ReviewCard({ run }: { run: CodeRun }) {
  if (run.reviews.length === 0) return null;
  return (
    <div className="space-y-2">
      {run.reviews.map(({ agentId, review }) => (
        <div key={agentId} className="rounded-xl border border-role-reviewer/25 bg-role-reviewer/[0.04] p-3 animate-slide-up">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-role-reviewer" />
            <span className="text-xs font-semibold text-role-reviewer">Ревью</span>
            <span
              className={cn(
                "ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium",
                review.verdict === "approve" && "bg-emerald-500/15 text-emerald-300",
                review.verdict === "changes" && "bg-amber-500/15 text-amber-300",
                review.verdict === "unknown" && "bg-zinc-500/15 text-zinc-400",
              )}
            >
              {review.verdict === "approve" ? "Одобрено" : review.verdict === "changes" ? "Нужны правки" : "Без вердикта"}
            </span>
          </div>
          {review.summary && <p className="mt-1.5 text-xs leading-relaxed text-subtle">{review.summary}</p>}
          {review.issues.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {review.issues.map((issue, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-subtle">
                  {issue.severity === "error" ? (
                    <AlertCircle className="mt-0.5 size-3 shrink-0 text-red-400" />
                  ) : issue.severity === "warning" ? (
                    <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-400" />
                  ) : (
                    <Info className="mt-0.5 size-3 shrink-0 text-sky-400" />
                  )}
                  <span>
                    {issue.file && <code className="mr-1 rounded bg-hover px-1 font-mono text-[10px] text-muted">{issue.file}</code>}
                    {issue.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function RunView({ run }: { run: CodeRun }) {
  const running = run.status === "running";
  const now = useNow(running, 500);
  const director = run.agents["director"];
  const workers = run.order.filter((id) => id !== "director").map((id) => run.agents[id]);
  const waves = useMemo(() => computeWaves(workers), [workers]);
  const pending = run.proposals.filter((p) => p.status === "pending").length;
  const elapsed = run.durationMs ?? now - run.createdAt;

  return (
    <div className="space-y-2 p-3">
      <div className="rounded-xl border border-border bg-background p-3">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{run.task}</p>
          <RunStatusBadge run={run} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-muted">
          <span>{formatDuration(elapsed)}</span>
          <span>агентов: {run.order.length}</span>
          {run.planFallback && <span className="text-amber-400">резервный план</span>}
        </div>
        {run.planSummary && <p className="mt-2 text-xs leading-relaxed text-subtle">{run.planSummary}</p>}
      </div>

      {director && <SubAgentCard agent={director} />}

      {workers.length === 0 && running && (
        <>
          <Connector active />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
          <div className="flex items-center justify-center gap-2 py-1 text-[11px] text-muted">
            <TypingDots /> Director составляет план…
          </div>
        </>
      )}

      {waves.map((wave, wi) => (
        <div key={wi}>
          <Connector active={wave.some((a) => a.status === "running")} />
          <div className="grid gap-2 max-[520px]:grid-cols-1!" style={{ gridTemplateColumns: `repeat(${Math.min(wave.length, 2)}, minmax(0, 1fr))` }}>
            {wave.map((a) => (
              <SubAgentCard key={a.id} agent={a} className={wave.length % 2 === 1 && wave.length > 2 && a === wave[wave.length - 1] ? "col-span-2 max-[520px]:col-span-1" : undefined} />
            ))}
          </div>
          {wave.length > 1 && wave.some((a) => a.status === "running") && (
            <div className="mt-1 text-center text-[10px] uppercase tracking-wider text-accent-soft/80">параллельно</div>
          )}
        </div>
      ))}

      {run.error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 p-3 text-xs text-red-300">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <div className="break-words">{run.error}</div>
            <button
              onClick={() => void startCodeRun(run.task)}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-red-400/30 px-2 py-1 text-[11px] text-red-200 hover:bg-red-500/15"
            >
              Повторить запуск
            </button>
          </div>
        </div>
      )}

      <ReviewCard run={run} />

      {run.proposals.length > 0 && (
        <section aria-label="Предложенные изменения" className="pt-1">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Предложенные изменения · {run.proposals.length}
            </h4>
            {pending > 1 && (
              <button
                onClick={() => void applyAllProposals(run.id)}
                className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 mobile:py-1.5 text-[11px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25"
              >
                <CheckCheck className="size-3" /> Применить все ({pending})
              </button>
            )}
          </div>
          <ul className="space-y-1.5">
            {run.proposals.map((p) => (
              <ProposalRow key={p.id} runId={run.id} p={p} />
            ))}
          </ul>
        </section>
      )}

      {(run.summary || run.summaryStreaming) && (
        <section aria-label="Итоговая сводка" className="rounded-xl border border-role-director/25 bg-role-director/[0.04] p-3 animate-slide-up">
          <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-role-director">Сводка Director</h4>
          <Markdown content={run.summary} />
          {run.summaryStreaming && <span className="inline-block h-3.5 w-1.5 animate-blink bg-role-director" aria-hidden="true" />}
          {run.stats && (
            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2 font-mono text-[10px] text-muted">
              <span className="rounded bg-hover px-1.5 py-0.5">{formatDuration(run.durationMs ?? 0)}</span>
              <span className="rounded bg-hover px-1.5 py-0.5">агентов {run.stats.agents}</span>
              <span className="rounded bg-hover px-1.5 py-0.5">файлов {run.stats.files}</span>
              {run.stats.failed > 0 && <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-300">сбоев {run.stats.failed}</span>}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export function CodeView() {
  const runs = useAgentStore((s) => s.runs);
  const [selected, setSelected] = useState<string | null>(null);
  const [seenLatest, setSeenLatest] = useState<string | null>(null);
  const latest = runs[runs.length - 1];

  // Follow the newest run automatically (derived-state pattern, no effect needed).
  if (latest && latest.id !== seenLatest) {
    setSeenLatest(latest.id);
    setSelected(latest.id);
  }

  const run = runs.find((r) => r.id === selected) ?? latest;

  if (!run) return <ExamplePrompts mode="code" />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {runs.length > 1 && (
        <div className="flex h-8 mobile:h-12 shrink-0 items-center gap-2 border-b border-border px-3">
          <select
            aria-label="История запусков"
            value={run.id}
            onChange={(e) => setSelected(e.target.value)}
            className="h-6 mobile:h-9 min-w-0 flex-1 rounded border border-border-strong bg-background px-1.5 text-[11px] text-subtle outline-none focus:border-accent"
          >
            {[...runs].reverse().map((r) => (
              <option key={r.id} value={r.id}>
                {r.task.slice(0, 60)}
              </option>
            ))}
          </select>
          <button
            onClick={() => useAgentStore.getState().clearRuns()}
            aria-label="Очистить историю запусков"
            title="Очистить историю"
            className="grid size-6 mobile:size-9 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-red-400"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RunView run={run} />
      </div>
    </div>
  );
}
