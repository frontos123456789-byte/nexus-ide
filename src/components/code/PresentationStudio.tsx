"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, FileDown, ImagePlus, Maximize2, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { extractJson } from "@/lib/agents/parse";
import { getDb } from "@/lib/db/schema";
import { useSettings } from "@/lib/settings/store";
import { DECK_TEMPLATES, THEMES, deckFromAi, deckFromTemplate, exportPdf, exportPptx, newSlide, themeOf, type Deck, type Slide, type SlideLayout } from "@/lib/studio/deck";
import { Btn, Card, Field, generateText, inputCls, Notice } from "./ui";

function SlideView({ slide, deck, className }: { slide: Slide; deck: Deck; className?: string }) {
  const t = themeOf(deck.theme);
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1280));
    ro.observe(el);
    setScale(el.clientWidth / 1280);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className={`relative aspect-video w-full overflow-hidden rounded-lg ${className ?? ""}`} style={{ background: t.bg }}>
      <div style={{ width: 1280, height: 720, transform: `scale(${scale})`, transformOrigin: "top left", color: t.fg, fontFamily: "Segoe UI, Roboto, sans-serif" }} className="absolute left-0 top-0">
        {slide.layout === "title" ? (
          <div className="flex h-full items-center px-24"><div style={{ width: 12, height: 190, background: t.accent, marginRight: 40 }} /><div><div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1.1 }}>{slide.title}</div>{slide.subtitle && <div style={{ fontSize: 32, color: t.muted, marginTop: 20 }}>{slide.subtitle}</div>}</div></div>
        ) : slide.layout === "quote" ? (
          <div className="flex h-full flex-col justify-center px-32"><div style={{ fontSize: 54, fontStyle: "italic", lineHeight: 1.3 }}>«{slide.bullets[0] ?? slide.title}»</div><div style={{ fontSize: 26, color: t.accent, marginTop: 36 }}>{slide.title}</div></div>
        ) : (
          <div className="flex h-full flex-col px-20 pt-16">
            <div className="flex items-center gap-5"><div style={{ width: 10, height: 70, background: t.accent }} /><div style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.1 }}>{slide.title}</div></div>
            <div className="mt-12 flex min-h-0 flex-1 gap-12">
              <ul style={{ fontSize: 34, lineHeight: 1.35, flex: 1 }}>{slide.bullets.map((b, i) => <li key={i} style={{ marginBottom: 18, display: "flex", gap: 18 }}><span style={{ color: t.accent }}>•</span><span>{b}</span></li>)}</ul>
              {slide.image && /* eslint-disable-next-line @next/next/no-img-element */ <img src={slide.image} alt="" style={{ maxWidth: 480, maxHeight: 430, objectFit: "contain", alignSelf: "flex-start" }} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Presenter({ deck, start, onClose }: { deck: Deck; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (["ArrowRight", "PageDown", " "].includes(e.key)) setI((x) => Math.min(deck.slides.length - 1, x + 1));
      if (["ArrowLeft", "PageUp"].includes(e.key)) setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); };
  }, [deck.slides.length, onClose]);
  const s = deck.slides[i] as Slide;
  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-black">
      <div className="flex min-h-0 flex-1 items-center justify-center p-2"><div className="w-full" style={{ maxWidth: "min(100%, calc((100dvh - 64px) * 16 / 9))" }}><SlideView slide={s} deck={deck} /></div></div>
      <div className="flex shrink-0 items-center gap-2 bg-black/80 px-3 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 text-white">
        <button onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} aria-label="Назад" className="min-h-11 flex-1 rounded-xl bg-white/10 disabled:opacity-30">←</button>
        <span className="w-16 text-center text-xs">{i + 1} / {deck.slides.length}</span>
        <button onClick={() => setI(Math.min(deck.slides.length - 1, i + 1))} disabled={i === deck.slides.length - 1} aria-label="Вперёд" className="min-h-11 flex-1 rounded-xl bg-white/10 disabled:opacity-30">→</button>
        <button onClick={onClose} aria-label="Закрыть показ" className="grid size-11 place-items-center rounded-xl bg-white/10"><X className="size-5" /></button>
      </div>
      {s.notes && <div className="hidden max-h-20 overflow-auto bg-black px-4 py-2 text-xs text-zinc-400 sm:block">Заметки: {s.notes}</div>}
    </div>
  );
}

export function PresentationStudio() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [sel, setSel] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState(8);
  const [theme, setTheme] = useState("midnight");
  const [busy, setBusy] = useState<string | null>(null);
  const [present, setPresent] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const model = useSettings((s) => s.preferredModel);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setSaved((await getDb().decks.toArray()).sort((a, b) => b.updatedAt - a.updatedAt).map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt }))), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const patchSlide = (p: Partial<Slide>) => setDeck((d) => (d ? { ...d, slides: d.slides.map((s, i) => (i === sel ? { ...s, ...p } : s)) } : d));
  const move = (from: number, to: number) => setDeck((d) => { if (!d || to < 0 || to >= d.slides.length) return d; const s = [...d.slides]; const [m] = s.splice(from, 1); s.splice(to, 0, m as Slide); setSel(to); return { ...d, slides: s }; });

  const generate = async () => {
    if (prompt.trim().length < 10) return toast.error("Опишите тему подробнее (минимум 10 символов)");
    setBusy("gen");
    try {
      const text = await generateText(
        `Ты — автор презентаций. Верни ТОЛЬКО JSON: {"title":"...","slides":[{"layout":"title|bullets|quote","title":"...","subtitle":"только для title","bullets":["до 5 коротких тезисов, до 12 слов"],"notes":"заметки докладчика"}]}. Ровно ${count} слайдов: первый — layout "title", затем содержательные слайды с логичной структурой, последний — выводы/следующие шаги. Тексты на языке пользователя, без выдуманных статистик и ссылок.`,
        prompt,
        model,
        5000,
      );
      const d = deckFromAi((extractJson(text) as Parameters<typeof deckFromAi>[0]) ?? {}, theme, count);
      if (!d) throw new Error("ИИ вернул неразборчивую структуру — повторите попытку");
      setDeck(d); setSel(0);
      toast.success(`Создано слайдов: ${d.slides.length}`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка ИИ"); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!deck) return;
    const now = Date.now();
    const prev = await getDb().decks.get(deck.id);
    await getDb().decks.put({ id: deck.id, title: deck.title, data: deck, createdAt: prev?.createdAt ?? now, updatedAt: now });
    await refresh();
    toast.success("Презентация сохранена");
  };
  const load = async (id: string) => { const r = await getDb().decks.get(id); if (r) { setDeck(r.data as Deck); setSel(0); } };
  const exportAs = async (kind: "pptx" | "pdf") => {
    if (!deck) return;
    setBusy(kind);
    try {
      const { warnings } = await (kind === "pptx" ? exportPptx(deck) : exportPdf(deck));
      toast.success(`Файл ${kind.toUpperCase()} создан и скачан`);
      warnings.forEach((w) => toast.warning(w));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка экспорта"); } finally { setBusy(null); }
  };
  const onImage = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/") || f.size > 3_000_000) return toast.error("Нужно изображение до 3 МБ");
    const r = new FileReader();
    r.onload = () => patchSlide({ image: String(r.result) });
    r.readAsDataURL(f);
  };

  if (!deck) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <Field label="О чём презентация"><textarea className={`${inputCls} min-h-28 py-2`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Презентация о запуске мобильного приложения для фитнеса: проблема, решение, рынок, план на год" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Слайдов"><input type="number" min={3} max={20} className={inputCls} value={count} onChange={(e) => setCount(Math.max(3, Math.min(20, Number(e.target.value) || 8)))} /></Field>
            <Field label="Стиль"><select className={inputCls} value={theme} onChange={(e) => setTheme(e.target.value)}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          </div>
          <Btn onClick={generate} disabled={busy === "gen"} className="w-full"><Sparkles className="size-4" />{busy === "gen" ? "Генерирую структуру…" : "Создать презентацию (ИИ)"}</Btn>
          {saved.length > 0 && <div className="space-y-1"><div className="text-sm font-semibold">Сохранённые</div>{saved.map((d) => <button key={d.id} onClick={() => void load(d.id)} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-border px-3 text-left text-sm hover:bg-hover"><span className="truncate">{d.title}</span><span className="text-[11px] text-muted">{new Date(d.updatedAt).toLocaleDateString()}</span></button>)}</div>}
        </Card>
        <Card className="space-y-2">
          <div className="text-sm font-semibold">Шаблоны</div>
          <div className="grid gap-2 sm:grid-cols-2">{DECK_TEMPLATES.map((t) => <button key={t.id} onClick={() => { setDeck(deckFromTemplate(t.id, prompt.trim().slice(0, 80) || undefined)); setSel(0); }} className="min-h-16 rounded-xl border border-border p-3 text-left hover:border-accent/60"><div className="text-sm font-medium">{t.title}</div><div className="text-[11px] text-muted">{t.slides.length} слайдов · {themeOf(t.theme).name}</div></button>)}</div>
        </Card>
      </div>
    );
  }

  const s = deck.slides[sel] as Slide;
  return (
    <div className="space-y-3">
      {present && <Presenter deck={deck} start={sel} onClose={() => setPresent(false)} />}
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Название презентации" className={`${inputCls} max-w-xs`} value={deck.title} onChange={(e) => setDeck({ ...deck, title: e.target.value })} />
        <select aria-label="Тема" className={`${inputCls} w-auto`} value={deck.theme} onChange={(e) => setDeck({ ...deck, theme: e.target.value })}>{THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <Btn variant="ghost" onClick={() => setPresent(true)}><Maximize2 className="size-4" />Показ</Btn>
        <Btn variant="ghost" onClick={save}><Save className="size-4" />Сохранить</Btn>
        <Btn onClick={() => void exportAs("pptx")} disabled={busy !== null}><FileDown className="size-4" />{busy === "pptx" ? "…" : "PPTX"}</Btn>
        <Btn onClick={() => void exportAs("pdf")} disabled={busy !== null}><FileDown className="size-4" />{busy === "pdf" ? "…" : "PDF"}</Btn>
        <Btn variant="ghost" onClick={() => setDeck(null)}>Закрыть</Btn>
      </div>
      <div className="grid gap-3 lg:grid-cols-[200px_1fr_320px]">
        <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[34rem] lg:flex-col lg:overflow-y-auto" aria-label="Слайды">
          {deck.slides.map((sl, i) => (
            <div key={sl.id} draggable onDragStart={() => setDragId(sl.id)} onDragOver={(e) => e.preventDefault()} onDrop={() => { const from = deck.slides.findIndex((x) => x.id === dragId); if (from >= 0) move(from, i); setDragId(null); }} className={`w-36 shrink-0 cursor-grab rounded-xl border p-1.5 lg:w-full ${i === sel ? "border-accent" : "border-border"}`}>
              <button onClick={() => setSel(i)} className="block w-full" aria-label={`Слайд ${i + 1}: ${sl.title}`}><SlideView slide={sl} deck={deck} /></button>
              <div className="mt-1 flex items-center justify-between text-[11px] text-muted"><span>{i + 1}</span><span className="flex"><button aria-label="Вверх" onClick={() => move(i, i - 1)} className="grid size-8 place-items-center"><ArrowUp className="size-3.5" /></button><button aria-label="Вниз" onClick={() => move(i, i + 1)} className="grid size-8 place-items-center"><ArrowDown className="size-3.5" /></button></span></div>
            </div>
          ))}
          <button onClick={() => { setDeck({ ...deck, slides: [...deck.slides, newSlide()] }); setSel(deck.slides.length); }} className="flex min-h-11 w-36 shrink-0 items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong text-sm text-subtle lg:w-full"><Plus className="size-4" />Слайд</button>
        </div>
        <Card className="p-2"><SlideView slide={s} deck={deck} /><p className="mt-2 text-center text-[11px] text-muted">Порядок слайдов меняется перетаскиванием (мышь) или стрелками (touch).</p></Card>
        <Card className="space-y-3">
          <Field label="Макет"><select className={inputCls} value={s.layout} onChange={(e) => patchSlide({ layout: e.target.value as SlideLayout })}><option value="title">Титульный</option><option value="bullets">Список</option><option value="image">Текст + изображение</option><option value="quote">Цитата</option></select></Field>
          <Field label="Заголовок"><input className={inputCls} value={s.title} onChange={(e) => patchSlide({ title: e.target.value })} /></Field>
          {s.layout === "title" && <Field label="Подзаголовок"><input className={inputCls} value={s.subtitle ?? ""} onChange={(e) => patchSlide({ subtitle: e.target.value })} /></Field>}
          {s.layout !== "title" && <Field label={s.layout === "quote" ? "Цитата" : "Пункты (по одному в строке)"}><textarea className={`${inputCls} min-h-28 py-2`} value={s.bullets.join("\n")} onChange={(e) => patchSlide({ bullets: e.target.value.split("\n") })} onBlur={(e) => patchSlide({ bullets: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })} /></Field>}
          {s.layout !== "title" && s.layout !== "quote" && (
            <div className="space-y-2">
              <Field label="Изображение (URL)"><input className={inputCls} value={s.image?.startsWith("data:") ? "" : (s.image ?? "")} placeholder={s.image?.startsWith("data:") ? "загружено с устройства" : "https://…"} onChange={(e) => patchSlide({ image: e.target.value || undefined })} /></Field>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onImage(e.target.files?.[0])} />
              <div className="flex gap-2"><Btn variant="ghost" onClick={() => fileRef.current?.click()}><ImagePlus className="size-4" />Загрузить</Btn>{s.image && <Btn variant="ghost" onClick={() => patchSlide({ image: undefined })}>Убрать</Btn>}</div>
            </div>
          )}
          <Field label="Заметки докладчика"><textarea className={`${inputCls} min-h-16 py-2`} value={s.notes ?? ""} onChange={(e) => patchSlide({ notes: e.target.value })} /></Field>
          <div className="flex gap-2"><Btn variant="ghost" onClick={() => { const c = { ...s, id: newSlide().id }; setDeck({ ...deck, slides: [...deck.slides.slice(0, sel + 1), c, ...deck.slides.slice(sel + 1)] }); setSel(sel + 1); }}><Copy className="size-4" />Дубль</Btn>
            <Btn variant="danger" disabled={deck.slides.length <= 1} onClick={() => { setDeck({ ...deck, slides: deck.slides.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)); }}><Trash2 className="size-4" />Удалить</Btn></div>
        </Card>
      </div>
      <Notice tone="info">Экспорт создаёт настоящие файлы: PPTX (PptxGenJS, редактируемый текст) и PDF (слайды отрисовываются в изображения 1600×900). Картинки с чужих сайтов добавятся, только если сайт разрешает CORS.</Notice>
    </div>
  );
}
