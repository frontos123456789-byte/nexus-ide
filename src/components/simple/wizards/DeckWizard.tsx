"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles } from "lucide-react";
import { generateText } from "@/components/code/ui";
import { extractJson } from "@/lib/agents/parse";
import { useSettings } from "@/lib/settings/store";
import { clearDraft, friendlyError, loadDraft, saveDeck, saveDraft } from "@/lib/simple/projects";
import { deckFromAi, deckFromTemplate } from "@/lib/studio/deck";
import { Button, Chip, ErrorBox, Loading, NexusSays, PageTitle, TextArea } from "../ui";

const EXAMPLES = ["Космос: планеты, звёзды и полёты", "Как открыть небольшую кофейню", "Здоровое питание для всей семьи"];
const COUNTS = [5, 8, 10, 15];

/** Picks a colour theme from the topic, so nobody has to choose "Midnight" or "Corporate". */
export function themeFor(topic: string): string {
  const t = topic.toLowerCase();
  if (/(космос|звезд|планет|ночь|технолог|ии\b|компьютер)/.test(t)) return "midnight";
  if (/(природ|эколог|здоров|питани|сад|растен|лес|путешеств)/.test(t)) return "forest";
  if (/(бизнес|компани|продаж|финанс|отчёт|отчет|клиент)/.test(t)) return "corporate";
  if (/(детск|праздник|творч|искусств|музык)/.test(t)) return "vivid";
  if (/(кофе|еда|кухн|рецепт|тепл|дом)/.test(t)) return "warm";
  return "paper";
}

export function slideCountFrom(text: string, fallback: number): number {
  const m = /(\d{1,2})\s*слайд/i.exec(text);
  const n = m ? Number(m[1]) : fallback;
  return Math.max(3, Math.min(20, n));
}

export function DeckWizard() {
  const router = useRouter();
  const q = useSearchParams().get("q") ?? "";
  const model = useSettings((s) => s.preferredModel);
  const [text, setText] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (q.trim()) return setText(q.trim());
    const saved = loadDraft("presentation");
    if (saved) {
      setText(String(saved.data.text ?? ""));
      setCount(typeof saved.data.count === "number" ? saved.data.count : null);
    }
  }, [q]);
  useEffect(() => {
    if (restored.current && !busy) saveDraft("presentation", 1, { text, count });
  }, [text, count, busy]);

  const generate = async () => {
    const n = count ?? slideCountFrom(text, 8);
    const theme = themeFor(text);
    setBusy(true);
    setError(null);
    try {
      const out = await generateText(
        `Ты — автор презентаций. Верни ТОЛЬКО JSON: {"title":"...","slides":[{"layout":"title|bullets|quote","title":"...","subtitle":"только для title","bullets":["до 5 коротких тезисов, до 12 слов"],"notes":"заметки докладчика"}]}. Ровно ${n} слайдов: первый — layout "title", затем содержательные слайды с логичной структурой, последний — выводы/следующие шаги. Тексты на языке пользователя, простыми словами, без выдуманных статистик, цитат и ссылок.`,
        text,
        model,
        5000,
      );
      const deck = deckFromAi((extractJson(out) as Parameters<typeof deckFromAi>[0]) ?? {}, theme, n);
      if (!deck) throw new Error("ИИ вернул неразборчивую структуру");
      await saveDeck(deck);
      clearDraft("presentation");
      router.push(`/projects/deck_${deck.id}?new=1`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const fromTemplate = async () => {
    setBusy(true);
    try {
      const deck = { ...deckFromTemplate("business", text.trim().slice(0, 80) || undefined), theme: themeFor(text) };
      await saveDeck(deck);
      clearDraft("presentation");
      router.push(`/projects/deck_${deck.id}?new=1`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle title="Создание презентации" back={{ href: "/create", label: "Назад" }} />
      {busy ? (
        <div className="space-y-4"><NexusSays>Составляю план и пишу слайды. Это займёт около полминуты.</NexusSays><Loading text="Создаю презентацию… Пожалуйста, подождите." /></div>
      ) : (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); if (text.trim().length >= 5) void generate(); }}>
          <NexusSays>О чём будет презентация? Напишите тему — остальное я подберу сама: структуру, текст и оформление.</NexusSays>
          <TextArea label="Тема презентации" value={text} onChange={(e) => setText(e.target.value)} placeholder="Например: сделай презентацию про космос на 10 слайдов" />
          <div>
            <p className="mb-2 text-base font-semibold">Нужна идея? Нажмите на подходящую:</p>
            <div className="grid gap-2.5 sm:grid-cols-3">{EXAMPLES.map((e) => <Chip key={e} onClick={() => setText(e)}>{e}</Chip>)}</div>
          </div>
          <div>
            <p className="mb-2 text-base font-semibold">Сколько слайдов? <span className="font-normal text-muted">Если не выбрать, я решу сама.</span></p>
            <div className="flex flex-wrap gap-2.5" role="group" aria-label="Количество слайдов">
              {COUNTS.map((c) => <Chip key={c} selected={count === c} onClick={() => setCount(count === c ? null : c)} className="min-w-20 text-center">{c}</Chip>)}
            </div>
          </div>
          {error && <ErrorBox message={error} onRetry={() => void generate()} extra={<Button variant="secondary" onClick={() => void fromTemplate()}>Взять готовый шаблон</Button>} />}
          <Button type="submit" disabled={text.trim().length < 5} className="w-full sm:w-auto sm:min-w-64"><Sparkles className="size-5" aria-hidden />Создать презентацию</Button>
        </form>
      )}
    </div>
  );
}
