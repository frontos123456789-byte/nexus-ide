"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, Menu, MessageSquare, Paperclip, Pencil, Pin, PinOff, Plus, Search, Settings, Square, Trash2, X, Globe, Workflow } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/ide/Layout/Logo";
import { searchConversations, useChats, type Attachment } from "@/lib/ai/chat-store";
import { getDb } from "@/lib/db/schema";
import { useSettings, type SearchMode } from "@/lib/settings/store";
import { useIsMobile, useVisualViewportVars } from "@/lib/utils/use-mobile";
import { cn } from "@/lib/utils/cn";
import { Message } from "./Message";
import { SettingsDialog } from "./SettingsDialog";

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|jsx|ts|tsx|py|java|c|cpp|h|cs|go|rs|rb|php|sh|sql|yml|yaml|toml|ini|log|tex|srt)$/i;
const MAX_FILE = 400_000;

const SUGGEST: Record<"chat" | "work", string[]> = {
  chat: ["Объясни простыми словами, как работает блокчейн", "Помоги составить вежливое письмо с отказом", "Реши: 3x² − 12x + 9 = 0, покажи шаги", "Составь план изучения английского на 3 месяца"],
  work: ["Сравни топ-3 бесплатных инструмента для заметок и подготовь таблицу", "Подготовь исследование: тренды ИИ-ассистентов в этом году", "Составь план запуска небольшого онлайн-курса на 6 недель", "Собери актуальные данные о курсе евро и коротко проанализируй"],
};

const SEARCH_LABEL: Record<SearchMode, string> = { auto: "Поиск: сам решает", on: "Поиск: всегда", off: "Поиск: выключен" };
const NEXT_SEARCH: Record<SearchMode, SearchMode> = { auto: "on", on: "off", off: "auto" };

function ConversationList({ onPick }: { onPick: () => void }) {
  const { conversations, activeId, busy } = useChats();
  const [q, setQ] = useState("");
  const [contentHits, setContentHits] = useState<Set<string> | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return setContentHits(null);
    let cancelled = false;
    const t = setTimeout(async () => {
      const hits = await getDb().messages.filter((m) => m.content.toLowerCase().includes(s)).toArray().catch(() => []);
      if (!cancelled) setContentHits(new Set(hits.map((m) => m.conversationId)));
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  const list = useMemo(() => {
    const byTitle = searchConversations(conversations, q);
    if (!contentHits) return byTitle;
    const ids = new Set(byTitle.map((c) => c.id));
    return [...byTitle, ...conversations.filter((c) => contentHits.has(c.id) && !ids.has(c.id))];
  }, [conversations, q, contentHits]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute left-6 top-3 size-4 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по истории" aria-label="Поиск по истории" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-accent" />
      </div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {list.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">{q ? "Ничего не найдено" : "История пуста. Начните новый чат."}</p>}
        {list.map((c) => (
          <div key={c.id} className={cn("group flex items-center gap-1 rounded-xl pr-1", c.id === activeId ? "bg-hover" : "hover:bg-hover/60")}>
            {renaming === c.id ? (
              <form className="flex min-w-0 flex-1 items-center gap-1 p-1" onSubmit={(e) => { e.preventDefault(); void useChats.getState().rename(c.id, title); setRenaming(null); }}>
                <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Новое название" className="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-background px-2 text-sm outline-none" />
                <button type="submit" aria-label="Сохранить" className="grid size-9 place-items-center rounded-lg text-emerald-400"><Check className="size-4" /></button>
              </form>
            ) : confirmDel === c.id ? (
              <div className="flex min-w-0 flex-1 items-center gap-1 p-1 text-xs">
                <span className="min-w-0 flex-1 truncate px-2 text-red-300">Удалить чат?</span>
                <button onClick={() => { void useChats.getState().remove(c.id); setConfirmDel(null); }} className="min-h-9 rounded-lg bg-red-500/80 px-3 text-white">Да</button>
                <button onClick={() => setConfirmDel(null)} className="min-h-9 rounded-lg px-3 text-subtle hover:bg-border">Нет</button>
              </div>
            ) : (
              <>
                <button onClick={() => { void useChats.getState().select(c.id); onPick(); }} disabled={busy && c.id !== activeId} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl px-3 text-left text-sm">
                  {c.pinned ? <Pin className="size-3.5 shrink-0 text-accent-soft" /> : <MessageSquare className="size-3.5 shrink-0 text-muted" />}
                  <span className="truncate">{c.title}</span>
                </button>
                <div className="flex shrink-0 sm:hidden sm:group-hover:flex [@media(hover:hover)]:hidden [@media(hover:hover)]:group-hover:flex">
                  <button onClick={() => void useChats.getState().togglePin(c.id)} aria-label={c.pinned ? "Открепить" : "Закрепить"} className="grid size-9 place-items-center rounded-lg text-muted hover:text-foreground">{c.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}</button>
                  <button onClick={() => { setRenaming(c.id); setTitle(c.title); }} aria-label="Переименовать" className="grid size-9 place-items-center rounded-lg text-muted hover:text-foreground"><Pencil className="size-4" /></button>
                  <button onClick={() => setConfirmDel(c.id)} aria-label="Удалить" className="grid size-9 place-items-center rounded-lg text-muted hover:text-red-300"><Trash2 className="size-4" /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Composer() {
  const { busy, mode } = useChats();
  const settings = useSettings();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, isMobile ? 140 : 220)}px`;
  }, [text, isMobile]);

  const submit = () => {
    if (busy || (!text.trim() && files.length === 0)) return;
    const t = text;
    const f = files;
    setText("");
    setFiles([]);
    void useChats.getState().send(t, f);
  };

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const added: Attachment[] = [];
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { toast.error(`«${f.name}» больше 400 КБ`); continue; }
      if (!(f.type.startsWith("text/") || TEXT_EXT.test(f.name) || f.type === "application/json")) {
        toast.error(`«${f.name}»: поддерживаются только текстовые файлы (txt, md, csv, json, код…). Изображения и PDF бесплатные модели не читают.`);
        continue;
      }
      added.push({ name: f.name, size: f.size, text: await f.text() });
    }
    setFiles((p) => [...p, ...added].slice(0, 5));
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="shrink-0 border-t border-border bg-background/95 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
      <div className="mx-auto w-full max-w-3xl">
        {files.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {files.map((f) => (
              <span key={f.name} className="flex items-center gap-1 rounded-lg border border-border bg-panel-2 py-1 pl-2.5 pr-1 text-xs">
                <Paperclip className="size-3" />{f.name}
                <button onClick={() => setFiles((p) => p.filter((x) => x !== f))} aria-label={`Убрать ${f.name}`} className="grid size-7 place-items-center rounded text-muted hover:text-foreground"><X className="size-3.5" /></button>
              </span>
            ))}
          </div>
        )}
        <div className="rounded-2xl border border-border-strong bg-panel-2 p-2 focus-within:border-accent/70">
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
            }}
            rows={1}
            enterKeyHint={isMobile ? "enter" : "send"}
            placeholder={mode === "work" ? "Опишите задачу — я составлю план и выполню его…" : "Напишите, о чём хотите спросить…"}
            aria-label="Сообщение"
            className="block max-h-56 w-full resize-none bg-transparent px-2 py-1.5 text-[16px] leading-relaxed outline-none placeholder:text-muted"
          />
          <div className="flex items-center gap-1 pt-1">
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => void onFiles(e.target.files)} accept="text/*,.md,.csv,.json,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.go,.rs,.php,.sh,.sql,.yml,.yaml,.xml,.html,.css,.log" />
            <button onClick={() => fileRef.current?.click()} aria-label="Прикрепить файл" className="grid size-11 place-items-center rounded-xl text-subtle hover:bg-hover sm:size-10"><Paperclip className="size-5" /></button>
            <button onClick={() => settings.set({ searchMode: NEXT_SEARCH[settings.searchMode] })} aria-label={`Интернет-поиск: ${SEARCH_LABEL[settings.searchMode]}. Нажмите, чтобы переключить`} className={cn("flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-medium hover:bg-hover sm:h-10", settings.searchMode === "off" ? "text-muted" : "text-accent-soft")}>
              <Globe className="size-4" />{SEARCH_LABEL[settings.searchMode]}
            </button>
            <div className="flex-1" />
            {busy ? (
              <button onClick={() => useChats.getState().stop()} aria-label="Остановить генерацию" className="flex min-h-12 items-center gap-2 rounded-xl bg-red-600 px-4 text-base font-semibold text-white"><Square className="size-4 fill-current" aria-hidden />Остановить</button>
            ) : (
              <button onClick={submit} disabled={!text.trim() && files.length === 0} className="flex min-h-12 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-base font-semibold text-white transition-opacity hover:bg-indigo-400 disabled:opacity-40"><ArrowUp className="size-5" aria-hidden />Отправить</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Thread() {
  const { messages, busy, mode } = useChats();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
        <Logo className="size-14" />
        <h1 className="mt-4 text-center text-2xl font-semibold tracking-tight">Чем могу помочь?</h1>
        <p className="mt-1 max-w-md text-center text-sm text-muted">{mode === "work" ? "Режим «Задача»: опишите цель — ИИ составит план, найдёт информацию в интернете и подготовит результат." : "Я помогу с вопросами: вопросы, тексты, учёба, расчёты, переводы, идеи и код."}</p>
        <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
          {SUGGEST[mode].map((s) => (
            <button key={s} onClick={() => void useChats.getState().send(s)} className="min-h-14 rounded-xl border border-border bg-panel-2 p-3 text-left text-sm text-subtle transition-colors hover:border-accent/60 hover:text-foreground">{s}</button>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4"
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {messages.map((m, i) => <Message key={m.id} m={m} isLast={i === messages.length - 1} busy={busy} />)}
      </div>
    </div>
  );
}

export function NexusAI() {
  const isMobile = useIsMobile();
  useVisualViewportVars(isMobile);
  const { ready, mode } = useChats();
  const devMode = useSettings((s) => s.devMode);
  const [drawer, setDrawer] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();
  const started = useRef(false);

  useEffect(() => {
    useSettings.getState().hydrate();
    void useChats.getState().init().then(() => {
      // A question typed on the home screen starts a fresh conversation right away (once).
      const q = new URLSearchParams(window.location.search).get("q")?.trim();
      if (q && !started.current) {
        started.current = true;
        window.history.replaceState(null, "", "/chat");
        useChats.getState().newChat();
        void useChats.getState().send(q);
      }
    });
    // Returning from an OAuth / installation round-trip: open "Аккаунт и подключения" so the result is visible.
    if (new URLSearchParams(window.location.search).get("settings") === "account") setSettingsOpen(true);
  }, []);

  const sidebar = (
    <>
      <div className="flex items-center gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <Logo className="size-6" />
        <span className="text-[1.0625rem] font-semibold tracking-tight">Прошлые разговоры</span>
        <button onClick={() => setDrawer(false)} aria-label="Закрыть меню" className="ml-auto grid size-10 place-items-center rounded-lg text-muted hover:bg-hover md:hidden"><X className="size-5" /></button>
      </div>
      <div className="px-3 pb-3">
        <button onClick={() => { useChats.getState().newChat(); setDrawer(false); }} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border-strong text-sm font-medium hover:bg-hover"><Plus className="size-4" />Новый чат</button>
      </div>
      <ConversationList onPick={() => setDrawer(false)} />
      <div className="border-t border-border p-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <button onClick={() => { router.push("/settings"); setDrawer(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-sm text-subtle hover:bg-hover"><Settings className="size-4" />Настройки</button>
      </div>
    </>
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-panel md:flex" aria-label="История разговоров">{sidebar}</aside>
      {drawer && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,320px)] flex-col bg-panel shadow-2xl" aria-label="История разговоров">{sidebar}</aside>
        </div>
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 pb-2 pt-[max(8px,env(safe-area-inset-top))]">
          <button onClick={() => setDrawer(true)} aria-label="Открыть прошлые разговоры" className="grid size-11 place-items-center rounded-xl text-subtle hover:bg-hover md:hidden"><Menu className="size-5" /></button>
          <div role="tablist" aria-label="Что сделать: поговорить или поручить задачу" className="mx-auto flex rounded-xl border border-border bg-panel-2 p-1 md:mx-0">
            {([["chat", "Разговор", MessageSquare], ["work", "Задача", Workflow]] as const).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => useChats.getState().setMode(id)} className={cn("flex min-h-10 min-w-24 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors", mode === id ? "bg-accent text-white" : "text-subtle hover:text-foreground")}>
                <Icon className="size-4" />{label}
              </button>
            ))}
          </div>
          <div className="hidden flex-1 md:block" />
          <button onClick={() => router.push("/settings")} aria-label="Настройки" className="relative grid size-11 place-items-center rounded-xl text-subtle hover:bg-hover">
            <Settings className="size-5" />
            {devMode && <span className="absolute right-2 top-2 size-2 rounded-full bg-emerald-400" title="Режим разработчика включён" />}
          </button>
        </header>
        {ready ? <Thread /> : <div className="flex-1" />}
        <Composer />
      </main>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
