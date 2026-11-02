"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Maximize2, Palette, Pencil, Plus, Trash2, ArrowUp, ArrowDown, Check } from "lucide-react";
import { toast } from "sonner";
import { Presenter, SlideView } from "@/components/code/PresentationStudio";
import { exportPdf, exportPptx, newSlide, themeOf, THEMES, type Deck, type Slide } from "@/lib/studio/deck";
import { friendlyError, saveDeck } from "@/lib/simple/projects";
import { Button, Chip, ConfirmDialog, Loading, Panel, TextArea, TextInput } from "./ui";
import { cn } from "@/lib/utils/cn";

const THEME_RU: Record<string, string> = { midnight: "Тёмная ночь", paper: "Светлая бумага", corporate: "Деловая синяя", vivid: "Яркая", forest: "Зелёная", warm: "Тёплая" };

export function DeckView({ initial }: { initial: Deck }) {
  const [deck, setDeck] = useState<Deck>(initial);
  const [sel, setSel] = useState(0);
  const [panel, setPanel] = useState<"none" | "text" | "style" | "download">("none");
  const [present, setPresent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [saved, setSaved] = useState(true);
  const first = useRef(true);

  // Autosave 0.7 s after the last edit.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaved(false);
    const t = setTimeout(() => void saveDeck(deck).then(() => setSaved(true)).catch((e) => toast.error(friendlyError(e))), 700);
    return () => clearTimeout(t);
  }, [deck]);

  const s = deck.slides[Math.min(sel, deck.slides.length - 1)] as Slide;
  const patch = (p: Partial<Slide>) => setDeck((d) => ({ ...d, slides: d.slides.map((x, i) => (i === sel ? { ...x, ...p } : x)) }));
  const move = (to: number) => {
    if (to < 0 || to >= deck.slides.length) return;
    setDeck((d) => { const arr = [...d.slides]; const [m] = arr.splice(sel, 1); arr.splice(to, 0, m as Slide); return { ...d, slides: arr }; });
    setSel(to);
  };

  const exportAs = async (kind: "pptx" | "pdf") => {
    setBusy(kind);
    try {
      const { warnings } = await (kind === "pptx" ? exportPptx(deck) : exportPdf(deck));
      toast.success("Файл скачан. Поищите его в папке «Загрузки».");
      warnings.forEach((w) => toast.warning(w));
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      {present && <Presenter deck={deck} start={sel} onClose={() => setPresent(false)} />}

      <div className="overflow-hidden rounded-2xl border-2 border-border-strong bg-black p-2">
        <SlideView slide={s} deck={deck} />
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setSel(Math.max(0, sel - 1))} disabled={sel === 0} aria-label="Предыдущий слайд"><ArrowLeft className="size-5" aria-hidden />Назад</Button>
        <p className="min-w-0 flex-1 text-center text-[1.0625rem] font-semibold" aria-live="polite">Слайд {sel + 1} из {deck.slides.length}</p>
        <Button variant="secondary" onClick={() => setSel(Math.min(deck.slides.length - 1, sel + 1))} disabled={sel >= deck.slides.length - 1} aria-label="Следующий слайд">Дальше<ArrowRight className="size-5" aria-hidden /></Button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2" role="list" aria-label="Все слайды">
        {deck.slides.map((sl, i) => (
          <button key={sl.id} role="listitem" onClick={() => setSel(i)} aria-current={i === sel} aria-label={`Слайд ${i + 1}: ${sl.title}`} className={cn("w-32 shrink-0 rounded-xl border-2 p-1", i === sel ? "border-indigo-400" : "border-border-strong")}>
            <div className="pointer-events-none"><SlideView slide={sl} deck={deck} /></div>
            <span className="block py-1 text-sm font-semibold">{i + 1}</span>
          </button>
        ))}
      </div>

      <p className="text-base text-muted" aria-live="polite">{saved ? "Все изменения сохранены." : "Сохраняю…"}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button onClick={() => setPanel(panel === "text" ? "none" : "text")} aria-expanded={panel === "text"}><Pencil className="size-5" aria-hidden />Изменить текст</Button>
        <Button variant="secondary" onClick={() => setPanel(panel === "style" ? "none" : "style")} aria-expanded={panel === "style"}><Palette className="size-5" aria-hidden />Изменить оформление</Button>
        <Button variant="secondary" onClick={() => { setDeck((d) => { const arr = [...d.slides]; arr.splice(sel + 1, 0, newSlide({ title: "Новый слайд", bullets: ["Напишите здесь первую мысль"] })); return { ...d, slides: arr }; }); setSel(sel + 1); setPanel("text"); }}><Plus className="size-5" aria-hidden />Добавить слайд</Button>
        <Button variant="success" onClick={() => setPanel(panel === "download" ? "none" : "download")} aria-expanded={panel === "download"}><Download className="size-5" aria-hidden />Скачать презентацию</Button>
      </div>
      <Button variant="ghost" onClick={() => setPresent(true)}><Maximize2 className="size-5" aria-hidden />Показать на весь экран</Button>

      {panel === "text" && (
        <Panel className="space-y-4">
          <h2 className="text-xl font-bold">Текст слайда {sel + 1}</h2>
          <TextInput label="Заголовок" value={s.title} onChange={(e) => patch({ title: e.target.value })} maxLength={120} />
          {s.layout === "title" && <TextInput label="Подзаголовок" value={s.subtitle ?? ""} onChange={(e) => patch({ subtitle: e.target.value })} maxLength={160} />}
          {s.layout !== "title" && <TextArea label={s.layout === "quote" ? "Цитата или главная мысль" : "Пункты (каждый с новой строки)"} value={s.bullets.join("\n")} onChange={(e) => patch({ bullets: e.target.value.split("\n").slice(0, 8) })} className="min-h-40" />}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => move(sel - 1)} disabled={sel === 0}><ArrowUp className="size-5" aria-hidden />Передвинуть раньше</Button>
            <Button variant="secondary" onClick={() => move(sel + 1)} disabled={sel >= deck.slides.length - 1}><ArrowDown className="size-5" aria-hidden />Передвинуть позже</Button>
            <Button variant="secondary" className="border-red-500/60 text-red-200" onClick={() => setConfirmDel(true)} disabled={deck.slides.length <= 1}><Trash2 className="size-5" aria-hidden />Удалить слайд</Button>
          </div>
        </Panel>
      )}

      {panel === "style" && (
        <Panel className="space-y-4">
          <h2 className="text-xl font-bold">Оформление</h2>
          <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Цветовая схема">
            {THEMES.map((t) => {
              const th = themeOf(t.id);
              return (
                <Chip key={t.id} selected={deck.theme === t.id} onClick={() => setDeck({ ...deck, theme: t.id })} className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/30 text-sm font-bold" style={{ background: th.bg, color: th.accent }} aria-hidden>Аа</span>
                  {THEME_RU[t.id] ?? t.name}
                </Chip>
              );
            })}
          </div>
          <TextInput label="Название презентации" value={deck.title} onChange={(e) => setDeck({ ...deck, title: e.target.value })} maxLength={120} />
        </Panel>
      )}

      {panel === "download" && (
        <Panel className="space-y-3">
          <h2 className="text-xl font-bold">Скачать презентацию</h2>
          <p className="text-[1.0625rem] text-subtle">Выберите, как вам удобнее открывать файл.</p>
          {busy ? <Loading text="Готовлю файл…" /> : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button onClick={() => void exportAs("pptx")}><Check className="size-5" aria-hidden />Для PowerPoint (.pptx)</Button>
              <Button variant="secondary" onClick={() => void exportAs("pdf")}>Для печати и почты (.pdf)</Button>
            </div>
          )}
        </Panel>
      )}

      <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} title="Удалить этот слайд?" text="Слайд исчезнет из презентации." confirmLabel="Да, удалить" danger onConfirm={() => { setDeck((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== sel) })); setSel(Math.max(0, sel - 1)); }} />
    </div>
  );
}
