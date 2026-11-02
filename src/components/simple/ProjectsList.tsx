"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Trash2, Check, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { SlideView } from "@/components/code/PresentationStudio";
import type { Deck } from "@/lib/studio/deck";
import { previewHtml } from "@/lib/studio/site-templates";
import { projectFiles } from "@/lib/studio/projects";
import { deleteUnified, duplicateUnified, friendlyError, KIND_LABEL, listUnified, renameUnified, type SimpleKind, type UnifiedProject } from "@/lib/simple/projects";
import { Button, Chip, ConfirmDialog, EmptyState, ErrorBox, Loading, LinkButton, PageTitle, Panel, TextInput } from "./ui";
import { formatDate, KIND_ICON, KIND_TINT } from "./kinds";
import { cn } from "@/lib/utils/cn";

const FILTERS: { id: SimpleKind | "all"; label: string }[] = [
  { id: "all", label: "Все" },
  { id: "site", label: "Сайты" },
  { id: "bot", label: "Боты" },
  { id: "presentation", label: "Презентации" },
  { id: "app", label: "Приложения" },
];

/** Small live preview of a site/app, or the first slide of a presentation. Never blocks the list. */
export function Thumb({ p }: { p: UnifiedProject }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    if (!p.project || (p.kind !== "site" && p.kind !== "app")) return;
    let off = false;
    void projectFiles(p.project.folder).then((f) => { if (!off) setHtml(previewHtml(f)); }).catch(() => undefined);
    return () => { off = true; };
  }, [p.project, p.kind]);

  if (p.deck) {
    const deck = p.deck.data as Deck;
    const first = deck.slides?.[0];
    if (first) return <div className="pointer-events-none" aria-hidden><SlideView slide={first} deck={deck} /></div>;
  }
  if (html) {
    return (
      <div className="pointer-events-none relative aspect-video w-full overflow-hidden rounded-lg bg-white" aria-hidden>
        <iframe title="" tabIndex={-1} sandbox="" srcDoc={html} loading="lazy" className="absolute left-0 top-0 h-[400%] w-[400%] origin-top-left scale-[0.25] border-0" />
      </div>
    );
  }
  const Icon = KIND_ICON[p.kind];
  return <div className={cn("grid aspect-video w-full place-items-center rounded-lg", KIND_TINT[p.kind])} aria-hidden><Icon className="size-12" /></div>;
}

function Card({ p, onChanged }: { p: UnifiedProject; onChanged: () => void }) {
  const [more, setMore] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(p.name);
  const [confirm, setConfirm] = useState(false);
  const Icon = KIND_ICON[p.kind];
  const href = `/projects/${p.key}`;

  const rename = async () => {
    await renameUnified(p, name);
    setRenaming(false);
    toast.success("Название изменено");
    onChanged();
  };

  return (
    <Panel className="flex flex-col gap-4 p-4">
      <Thumb p={p} />
      <div className="flex items-start gap-3">
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", KIND_TINT[p.kind])} aria-hidden><Icon className="size-6" /></span>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
              <TextInput label="Новое название" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
              <div className="flex gap-2"><Button type="submit" disabled={!name.trim()}><Check className="size-5" aria-hidden />Сохранить</Button><Button variant="secondary" onClick={() => { setRenaming(false); setName(p.name); }}>Отмена</Button></div>
            </form>
          ) : (
            <>
              <h2 className="break-words text-[1.1875rem] font-bold leading-snug">{p.name}</h2>
              <p className="text-base text-subtle">{KIND_LABEL[p.kind]}</p>
              <p className="text-[0.9375rem] text-muted">Изменено: {formatDate(p.updatedAt)}</p>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <LinkButton href={href} className="flex-1">Открыть</LinkButton>
        <Button variant="secondary" aria-expanded={more} onClick={() => setMore(!more)}>Ещё<ChevronDown className={cn("size-5 transition-transform", more && "rotate-180")} aria-hidden /></Button>
      </div>
      {more && (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" onClick={() => { setRenaming(true); setMore(false); }}><Pencil className="size-5" aria-hidden />Переименовать</Button>
          <Button variant="secondary" onClick={async () => { try { await duplicateUnified(p); toast.success("Копия создана"); onChanged(); } catch (e) { toast.error(friendlyError(e)); } }}><Copy className="size-5" aria-hidden />Сделать копию</Button>
          <Button variant="secondary" className="border-red-500/60 text-red-200 hover:bg-red-500/15" onClick={() => setConfirm(true)}><Trash2 className="size-5" aria-hidden />Удалить</Button>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Удалить «${p.name}»?`}
        text="Проект будет удалён с этого устройства. Вернуть его не получится."
        confirmLabel="Да, удалить"
        danger
        onConfirm={async () => { await deleteUnified(p); toast.success("Проект удалён"); onChanged(); }}
      />
    </Panel>
  );
}

export function ProjectsList() {
  const [items, setItems] = useState<UnifiedProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<SimpleKind | "all">("all");
  const load = useCallback(() => {
    setError(null);
    listUnified().then(setItems).catch((e) => setError(friendlyError(e)));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => (items ?? []).filter((p) => filter === "all" || p.kind === filter || (filter === "app" && p.kind === "other")), [items, filter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <PageTitle title="Мои проекты" subtitle="Всё, что вы создали, лежит здесь. Изменения сохраняются сами." />
      {error && <ErrorBox message={error} onRetry={load} />}
      {!items && !error && <Loading text="Загружаю ваши проекты…" />}
      {items && items.length === 0 && (
        <EmptyState title="Пока здесь пусто" text="Создайте сайт, Telegram-бота, презентацию или дизайн приложения — они появятся в этом списке." action={<LinkButton href="/create">Создать первый проект</LinkButton>} />
      )}
      {items && items.length > 0 && (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Показать">
            {FILTERS.map((f) => <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</Chip>)}
          </div>
          {shown.length === 0 ? (
            <EmptyState title="В этом разделе пока ничего нет" text="Выберите «Все» или создайте новый проект." action={<LinkButton href="/create">Создать</LinkButton>} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{shown.map((p) => <Card key={p.key} p={p} onChanged={load} />)}</div>
          )}
        </>
      )}
    </div>
  );
}
