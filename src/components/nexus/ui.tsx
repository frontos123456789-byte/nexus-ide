"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Loader2, Play, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getKv, setKv } from "@/lib/db/fs";
import { useIdeStore } from "@/lib/store/ide";
import { applyChanges, askAi, workspaceFiles, type ApplyResult } from "@/lib/nexus/actions";
import { buildContext, changeStats, FILE_FORMAT_HINT, parseFileBlocks, unifiedDiff } from "@/lib/nexus/changes";
import { memoryContext } from "@/lib/nexus/memory";
import { layoutGraph, type Graph, type NodeKind } from "@/lib/nexus/graph";
import { useNexus } from "@/lib/nexus/store";
import type { Change, TaskType } from "@/lib/nexus/types";
import { cn } from "@/lib/utils/cn";

export const inputCls =
  "w-full rounded-md border border-border-strong bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent/70 focus-visible:ring-1 focus-visible:ring-accent/50";

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-border bg-panel-2 p-3", className)}>
      {(title || actions) && (
        <header className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">{title}</h3>
          <div className="flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-[11px] text-subtle">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[10px] text-muted">{hint}</span>}
    </label>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const map = { info: "border-accent/30 bg-accent/10 text-accent-soft", warn: "border-amber-500/30 bg-amber-500/10 text-amber-300", error: "border-red-500/30 bg-red-500/10 text-red-300", ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2 text-[11px] leading-relaxed", map[tone])}>
      {tone !== "info" && tone !== "ok" && <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid place-items-center rounded-md border border-dashed border-border-strong px-4 py-8 text-center text-xs text-muted">{children}</div>;
}

export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "error" | "accent" }) {
  const map = { muted: "bg-hover text-subtle", ok: "bg-emerald-500/15 text-emerald-300", warn: "bg-amber-500/15 text-amber-300", error: "bg-red-500/15 text-red-300", accent: "bg-accent/20 text-accent-soft" };
  return <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", map[tone])}>{children}</span>;
}

export function Spin({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted" role="status">
      <Loader2 className="size-3.5 animate-spin" />
      {label}
    </span>
  );
}

/** Runs an async action with loading + error state. */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

/** State persisted in the existing Dexie `kv` table. */
export function usePersisted<T>(key: string, init: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [val, setVal] = useState<T>(init);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    void getKv<T>(`nexus:${key}`).then((v) => {
      if (!alive) return;
      if (v !== undefined) setVal(v);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setVal((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        void setKv(`nexus:${key}`, next);
        return next;
      });
    },
    [key],
  );
  return [val, set, ready];
}

export function useFiles(): Record<string, string> {
  const nodes = useIdeStore((s) => s.nodes);
  const contents = useIdeStore((s) => s.contents);
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const [p, n] of Object.entries(nodes)) if (n.type === "file" && contents[p] !== undefined) out[p] = contents[p] ?? "";
    return out;
  }, [nodes, contents]);
}

export function FileSelect({ value, onChange, label = "Файл", filter }: { value: string; onChange: (v: string) => void; label?: string; filter?: RegExp }) {
  const files = useFiles();
  const paths = Object.keys(files).filter((p) => !filter || filter.test(p)).sort();
  return (
    <Field label={label}>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— выберите —</option>
        {paths.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function openFileInIde(path: string, line?: number) {
  const ide = useIdeStore.getState();
  ide.openFile(path);
  useNexus.getState().setOpen(false);
  if (line) setTimeout(() => window.dispatchEvent(new CustomEvent("nexus:goto", { detail: { path, line } })), 250);
}

/* ------------------------------ monaco helpers ----------------------------- */

type MonacoNs = typeof import("monaco-editor");
export function getMonaco(): MonacoNs | undefined {
  return (window as unknown as { monaco?: MonacoNs }).monaco;
}

export function getEditorSelection(): { path: string; text: string } | null {
  const m = getMonaco();
  const ed = m?.editor.getEditors().find((e) => e.hasTextFocus()) ?? m?.editor.getEditors()[0];
  const model = ed?.getModel();
  const sel = ed?.getSelection();
  if (!ed || !model || !sel || sel.isEmpty()) return null;
  const path = useIdeStore.getState().activePath ?? model.uri.path.replace(/^\//, "");
  return { path, text: model.getValueInRange(sel) };
}

export function getTypeErrors(): { path: string; line: number; message: string }[] {
  const m = getMonaco();
  if (!m) return [];
  return m.editor
    .getModelMarkers({})
    .filter((x) => x.severity === m.MarkerSeverity.Error)
    .map((x) => ({ path: x.resource.path.replace(/^\//, ""), line: x.startLineNumber, message: x.message }));
}

/* ------------------------------- change set -------------------------------- */

export async function rollbackApplied(changes: Change[], applied: string[]): Promise<void> {
  const ide = useIdeStore.getState();
  for (const c of changes) {
    if (!applied.includes(c.path)) continue;
    if (c.before === null) await useIdeStore.getState().deleteEntry(c.path);
    else await ide.upsertFile(c.path, c.before, false);
  }
}

function DiffText({ change }: { change: Change }) {
  const lines = unifiedDiff(change).split("\n").slice(4);
  return (
    <pre className="max-h-64 overflow-auto rounded bg-background p-2 font-mono text-[11px] leading-snug" tabIndex={0} aria-label={`Diff ${change.path}`}>
      {lines.map((l, i) => (
        <div key={i} className={cn(l.startsWith("+") && "bg-emerald-500/10 text-emerald-300", l.startsWith("-") && "bg-red-500/10 text-red-300", l.startsWith("@@") && "text-accent-soft")}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

/** Multi-file preview: accept or reject each file, view diffs, apply through the guarded path, roll back. */
export function ChangeSet({ changes, source, agentId, onDone }: { changes: Change[]; source: string; agentId?: string; onDone?: (r: ApplyResult) => void }) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(changes.map((c) => c.path)));
  const [open, setOpen] = useState<string | null>(changes[0]?.path ?? null);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const { busy, run } = useBusy();
  const current = useFiles();
  if (changes.length === 0) return <Empty>Изменений нет</Empty>;
  const toggle = (p: string) => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const apply = () =>
    void run(async () => {
      const r = await applyChanges(changes.filter((c) => selected.has(c.path)), { source, agentId });
      setResult(r);
      onDone?.(r);
      if (r.applied.length) toast.success(`Применено файлов: ${r.applied.length}`);
      if (r.skipped.length) toast.warning(`Пропущено: ${r.skipped.map((s) => `${s.path} (${s.reason})`).join("; ")}`);
    });
  const undo = () =>
    void run(async () => {
      if (!result) return;
      await rollbackApplied(changes, result.applied);
      toast.success("Изменения откачены");
      setResult(null);
    });
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border rounded-md border border-border">
        {changes.map((c) => {
          const st = changeStats(c);
          const stale = (current[c.path] ?? null) !== c.before && !result?.applied.includes(c.path);
          return (
            <li key={c.path}>
              <div className="flex items-center gap-2 px-2 py-1.5">
                <input type="checkbox" aria-label={`Принять ${c.path}`} checked={selected.has(c.path)} onChange={() => toggle(c.path)} disabled={Boolean(result)} />
                <button className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-foreground hover:underline" onClick={() => setOpen(open === c.path ? null : c.path)}>
                  {c.path}
                </button>
                <Badge tone={c.after === null ? "error" : c.before === null ? "ok" : "accent"}>{c.after === null ? "удаление" : c.before === null ? "новый" : "изменён"}</Badge>
                <span className="font-mono text-[10px] text-emerald-400">+{st.added}</span>
                <span className="font-mono text-[10px] text-red-400">−{st.removed}</span>
                {stale && <Badge tone="warn">устарел</Badge>}
                {result?.applied.includes(c.path) && <Check className="size-3.5 text-emerald-400" />}
              </div>
              {open === c.path && (
                <div className="px-2 pb-2">
                  <DiffText change={c} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        {!result ? (
          <>
            <Button size="sm" onClick={apply} disabled={busy || selected.size === 0}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Применить ({selected.size})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> Отклонить все
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={undo} disabled={busy || result.applied.length === 0}>
              <Undo2 /> Откатить применённое
            </Button>
            <span className="text-[11px] text-muted">
              Применено: {result.applied.length}, пропущено: {result.skipped.length}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- AI tool --------------------------------- */

export interface AiToolProps {
  feature: string;
  title: string;
  hint?: string;
  inputLabel?: string;
  placeholder?: string;
  withFile?: boolean;
  fileFilter?: RegExp;
  system: string;
  build: (input: string, file: string, files: Record<string, string>) => string;
  expectChanges?: boolean;
  task?: TaskType;
  initialInput?: string;
  actions?: ReactNode;
  extra?: ReactNode;
  prefill?: { label: string; get: () => { input?: string; file?: string } | null };
  onResult?: (text: string, changes: Change[]) => void;
}

export function AiTool(p: AiToolProps) {
  const [input, setInput] = useState(p.initialInput ?? "");
  const [file, setFile] = useState("");
  const [text, setText] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [meta, setMeta] = useState("");
  const { busy, error, run } = useBusy();
  const memory = useNexus((s) => s.data.memory);
  const go = () =>
    void run(async () => {
      const files = workspaceFiles();
      const focus = file ? [file] : [];
      const ctx = buildContext(files, focus);
      const mem = memoryContext(memory, input, 2000);
      const system = `${p.system}${mem ? `\n\nПамять проекта:\n${mem}` : ""}\n\nОтвечай по-русски, кратко и по делу.${p.expectChanges ? `\n${FILE_FORMAT_HINT}` : ""}`;
      const r = await askAi({ feature: p.feature, system, prompt: `${p.build(input, file, files)}\n\n${ctx}`, task: p.task, runId: `${p.feature}-${Date.now()}` });
      const cs = p.expectChanges ? parseFileBlocks(r.text, files) : [];
      const clean = r.text.replace(/===\s*FILE:[\s\S]*?===\s*END FILE\s*===/g, "[файл — см. изменения ниже]").trim();
      setText(clean);
      setChanges(cs);
      setMeta(`${r.label} · ${r.promptTokens + r.completionTokens} токенов${r.estimated ? " (оценка)" : ""}`);
      p.onResult?.(clean, cs);
    });
  return (
    <div className="space-y-3">
      {p.hint && <p className="text-[11px] text-muted">{p.hint}</p>}
      {p.withFile && <FileSelect value={file} onChange={setFile} filter={p.fileFilter} />}
      <Field label={p.inputLabel ?? "Запрос"}>
        <textarea className={cn(inputCls, "min-h-20 resize-y font-mono")} value={input} placeholder={p.placeholder} onChange={(e) => setInput(e.target.value)} />
      </Field>
      {p.extra}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={go} disabled={busy || (!input.trim() && !file)}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />} {p.title}
        </Button>
        {p.prefill && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const v = p.prefill?.get();
              if (!v) return toast.info("Нечего подставить: выделите код в редакторе");
              if (v.input !== undefined) setInput(v.input);
              if (v.file) setFile(v.file);
            }}
          >
            {p.prefill.label}
          </Button>
        )}
        {p.actions}
        {busy && <Spin label="Модель думает…" />}
      </div>
      {error && <Note tone="error">{error}</Note>}
      {text && (
        <Card title="Ответ" actions={<span className="text-[10px] text-muted">{meta}</span>}>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground" tabIndex={0}>
            {text}
          </pre>
        </Card>
      )}
      {changes.length > 0 && (
        <Card title={`Предлагаемые изменения (${changes.length})`}>
          <ChangeSet changes={changes} source={p.feature} />
        </Card>
      )}
    </div>
  );
}

/* ---------------------------------- graph ---------------------------------- */

const KIND_COLOR: Record<NodeKind, string> = {
  component: "#34d399",
  api: "#f472b6",
  test: "#fbbf24",
  doc: "#38bdf8",
  config: "#a1a1aa",
  module: "#818cf8",
  package: "#71717a",
  task: "#fb923c",
  decision: "#a78bfa",
};

export function GraphView({ graph, query, kinds }: { graph: Graph; query: string; kinds: Set<NodeKind> }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 920;
  const H = 520;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let nodes = graph.nodes.filter((n) => kinds.has(n.kind) && (!q || n.label.toLowerCase().includes(q) || (n.path ?? "").toLowerCase().includes(q)));
    if (nodes.length > 160) nodes = nodes.slice(0, 160);
    const ids = new Set(nodes.map((n) => n.id));
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
  }, [graph, query, kinds]);
  const pos = useMemo(() => layoutGraph(filtered, W, H), [filtered]);
  const at = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);
  if (pos.length === 0) return <Empty>Нет узлов под выбранные фильтры</Empty>;
  return (
    <div className="overflow-auto rounded-md border border-border bg-background">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[420px] min-w-[640px] w-full" role="img" aria-label="Граф">
        {filtered.edges.map((e, i) => {
          const a = at.get(e.from);
          const b = at.get(e.to);
          if (!a || !b) return null;
          const hot = hover === e.from || hover === e.to;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={hot ? "#818cf8" : "#2b2b31"} strokeWidth={hot ? 1.6 : 1} strokeDasharray={e.kind === "import" ? undefined : "4 3"} />;
        })}
        {pos.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            tabIndex={0}
            role="button"
            aria-label={`${n.label} (${n.kind})`}
            className="cursor-pointer outline-none"
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover(null)}
            onClick={() => n.path && openFileInIde(n.path)}
            onKeyDown={(e) => e.key === "Enter" && n.path && openFileInIde(n.path)}
          >
            <circle r={hover === n.id ? 8 : 6} fill={KIND_COLOR[n.kind]} stroke="#0a0a0a" strokeWidth={2} />
            <text y={-11} textAnchor="middle" fontSize={10} fill={hover === n.id ? "#fff" : "#a1a1aa"}>
              {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
            </text>
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-3 border-t border-border px-3 py-1.5 text-[10px] text-muted">
        {Object.entries(KIND_COLOR).map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1">
            <i className="inline-block size-2 rounded-full" style={{ background: c }} />
            {k}
          </span>
        ))}
        <span>{filtered.nodes.length} узлов · {filtered.edges.length} связей · пунктир — не-import связи</span>
      </div>
    </div>
  );
}

export const ALL_KINDS: NodeKind[] = ["component", "api", "test", "doc", "config", "module", "package", "task", "decision"];
