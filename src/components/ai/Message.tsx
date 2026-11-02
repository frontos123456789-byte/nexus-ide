"use client";

import { memo, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Circle, Copy, ExternalLink, Globe, Loader2, Pencil, RefreshCw, Search, XCircle } from "lucide-react";
import type { StoredMessage, WorkRecord } from "@/lib/db/schema";
import { useChats } from "@/lib/ai/chat-store";
import { cn } from "@/lib/utils/cn";
import { AiMarkdown } from "./AiMarkdown";

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function IconBtn({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40">
      {children}
    </button>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <IconBtn
      label="Копировать"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1300);
        } catch {
          /* ignore */
        }
      }}
    >
      {ok ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
    </IconBtn>
  );
}

function ToolLog({ tools }: { tools: NonNullable<StoredMessage["tools"]> }) {
  return (
    <div className="mb-3 space-y-1 rounded-xl border border-border bg-panel-2 p-2 text-xs" aria-label="Журнал инструментов">
      {tools.map((t) => (
        <div key={t.id} className="flex min-w-0 items-start gap-2 py-0.5">
          <span className="mt-0.5 shrink-0">
            {t.status === "running" ? <Loader2 className="size-3.5 animate-spin text-accent-soft" /> : t.status === "done" ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <XCircle className="size-3.5 text-red-400" />}
          </span>
          <span className="shrink-0 text-muted">{t.name === "search" ? <Search className="inline size-3" /> : <Globe className="inline size-3" />}</span>
          <span className="min-w-0 break-words text-subtle">
            <span className="text-foreground">{t.name === "search" ? "Поиск" : "Чтение"}:</span> {t.input.length > 90 ? `${t.input.slice(0, 90)}…` : t.input}
            {t.summary && <span className={cn("block", t.status === "error" ? "text-red-300" : "text-muted")}>{t.summary}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function WorkLog({ work }: { work: WorkRecord }) {
  const done = work.steps.filter((s) => s.status === "done").length;
  const label = { planning: "Составляю план…", running: "Выполняю шаги…", writing: "Пишу отчёт…", done: "Готово", error: "Ошибка" }[work.phase];
  return (
    <div className="mb-3 rounded-xl border border-border bg-panel-2 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 font-medium">{work.summary || "План задачи"}</div>
        <div className="shrink-0 text-[11px] text-muted">{done}/{work.steps.length}</div>
      </div>
      <div className="mt-1 text-[11px] text-accent-soft">{label}</div>
      {work.steps.length > 0 && (
        <div className="mt-2 h-1 overflow-hidden rounded bg-border"><div className="h-full bg-accent transition-all" style={{ width: `${work.steps.length ? (done / work.steps.length) * 100 : 0}%` }} /></div>
      )}
      <ol className="mt-2 space-y-2">
        {work.steps.map((s) => (
          <li key={s.id} className="flex gap-2">
            <span className="mt-0.5 shrink-0">
              {s.status === "running" ? <Loader2 className="size-4 animate-spin text-accent-soft" /> : s.status === "done" ? <CheckCircle2 className="size-4 text-emerald-400" /> : s.status === "error" ? <XCircle className="size-4 text-red-400" /> : <Circle className="size-4 text-muted" />}
            </span>
            <div className="min-w-0 text-[13px]">
              <div className="break-words"><span className="rounded bg-hover px-1.5 py-0.5 text-[10px] uppercase text-muted">{s.tool}</span> {s.title}</div>
              {s.input && s.tool !== "analyze" && s.tool !== "write" && <div className="break-all text-[11px] text-muted">{s.input.slice(0, 120)}</div>}
              {s.output && <div className="mt-0.5 line-clamp-3 break-words text-[12px] text-subtle">{s.output}</div>}
              {s.error && <div className="mt-0.5 break-words text-[12px] text-red-300">{s.error}</div>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Sources({ sources }: { sources: NonNullable<StoredMessage["sources"]> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3 rounded-xl border border-border bg-panel-2">
      <button onClick={() => setOpen(!open)} className="flex min-h-10 w-full items-center justify-between px-3 text-xs font-medium text-subtle" aria-expanded={open}>
        Источники ({sources.length})
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ol className="space-y-1 px-3 pb-3">
          {sources.map((s) => (
            <li key={s.n} className="flex gap-2 text-[12px]">
              <span className="shrink-0 text-muted">[{s.n}]</span>
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0 break-words text-accent-soft hover:underline">
                {s.title.slice(0, 110)} <span className="text-muted">· {host(s.url)}{s.date ? ` · ${s.date}` : ""}</span>
                <ExternalLink className="ml-1 inline size-3" />
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export const Message = memo(function Message({ m, isLast, busy }: { m: StoredMessage; isLast: boolean; busy: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);

  if (m.role === "user") {
    return (
      <div className="group flex flex-col items-end gap-1">
        {editing ? (
          <div className="w-full max-w-[92%] rounded-2xl border border-accent/50 bg-panel-2 p-2 sm:max-w-[80%]">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(8, draft.split("\n").length + 1)} autoFocus className="w-full resize-none bg-transparent p-2 text-[15px] outline-none" aria-label="Редактирование сообщения" />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setEditing(false); setDraft(m.content); }} className="min-h-10 rounded-lg px-4 text-sm text-subtle hover:bg-hover">Отмена</button>
              <button onClick={() => { setEditing(false); void useChats.getState().editAndResend(m.id, draft); }} disabled={!draft.trim()} className="min-h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-40">Отправить</button>
            </div>
          </div>
        ) : (
          <div className="max-w-[92%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent/20 px-4 py-2.5 text-[15px] leading-relaxed sm:max-w-[80%]">
            {m.attachments && m.attachments.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {m.attachments.map((a) => <span key={a.name} className="rounded-md bg-background/60 px-2 py-0.5 text-[11px] text-subtle">📎 {a.name}</span>)}
              </div>
            )}
            {m.content}
          </div>
        )}
        {!editing && (
          <div className="flex opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
            <CopyBtn text={m.content} />
            <IconBtn label="Редактировать" onClick={() => { setDraft(m.content); setEditing(true); }} disabled={busy}><Pencil className="size-4" /></IconBtn>
          </div>
        )}
      </div>
    );
  }

  const streaming = m.status === "streaming";
  return (
    <div className="flex min-w-0 gap-3">
      <div className="mt-1 grid size-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-role-director text-[11px] font-bold text-white">N</div>
      <div className="min-w-0 flex-1">
        {m.work && <WorkLog work={m.work} />}
        {m.tools && m.tools.length > 0 && <ToolLog tools={m.tools} />}
        {m.notices?.map((n, i) => (
          <div key={i} className="mb-2 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{n}</div>
        ))}
        {m.content ? <AiMarkdown content={m.content} /> : streaming && <div className="flex items-center gap-1.5 py-2 text-muted" aria-label="Генерация"><span className="size-1.5 animate-dot rounded-full bg-muted" /><span className="size-1.5 animate-dot rounded-full bg-muted [animation-delay:0.15s]" /><span className="size-1.5 animate-dot rounded-full bg-muted [animation-delay:0.3s]" /></div>}
        {streaming && m.content && <span className="inline-block h-4 w-1.5 animate-blink bg-accent-soft align-middle" />}
        {m.sources && m.sources.length > 0 && <Sources sources={m.sources} />}
        {m.status === "error" && <div className="mt-2 break-words rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{m.error ?? "Ошибка генерации"}</div>}
        {m.status === "stopped" && <div className="mt-1 text-xs text-muted">Генерация остановлена</div>}
        {!streaming && (
          <div className="mt-1 flex items-center gap-0.5">
            <CopyBtn text={m.content} />
            {isLast && <IconBtn label="Повторить генерацию" onClick={() => void useChats.getState().regenerate()} disabled={busy}><RefreshCw className="size-4" /></IconBtn>}
            {m.modelLabel && <span className="ml-1 truncate text-[11px] text-muted">{m.modelLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
});
