"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { generateText } from "@/components/code/ui";
import { parseFileBlocks } from "@/lib/agents/parse";
import { useSettings } from "@/lib/settings/store";
import { suggestName } from "@/lib/simple/intent";
import { APP_STACK, clearDraft, friendlyError, loadDraft, saveDraft } from "@/lib/simple/projects";
import { buildSite, type SiteTemplateId } from "@/lib/studio/site-templates";
import { createProject, logActivity, safeRelPath } from "@/lib/studio/projects";
import { Button, Chip, ErrorBox, Loading, NexusSays, PageTitle, StepDots, TextArea, TextInput } from "../ui";

type Kind = "site" | "app";

interface Option {
  id: string;
  label: string;
  template: SiteTemplateId;
  brief: string;
}

const COPY: Record<Kind, { title: string; ask: string; noun: string; create: string; options: Option[]; placeholder: string }> = {
  site: {
    title: "Создание сайта",
    ask: "Конечно. Какой сайт вы хотите?",
    noun: "сайт",
    create: "Создать сайт",
    placeholder: "Например: хочу красивый сайт для продажи домашних тортов",
    options: [
      { id: "business", label: "Сайт для моего бизнеса", template: "landing", brief: "сайт небольшого бизнеса: чем занимаемся, услуги, преимущества, как связаться" },
      { id: "shop", label: "Интернет-магазин", template: "shop", brief: "интернет-магазин: каталог товаров карточками с ценами, корзина, оформление заказа" },
      { id: "personal", label: "Личный сайт", template: "portfolio", brief: "личный сайт: обо мне, чем занимаюсь, контакты" },
      { id: "portfolio", label: "Сайт-портфолио", template: "portfolio", brief: "портфолио: работы карточками, обо мне, контакты" },
      { id: "event", label: "Сайт для мероприятия", template: "landing", brief: "сайт мероприятия: дата, место, программа, как записаться" },
      { id: "custom", label: "Свой вариант", template: "landing", brief: "" },
    ],
  },
  app: {
    title: "Дизайн приложения",
    ask: "Конечно. Какое приложение вы хотите?",
    noun: "приложение",
    create: "Создать дизайн",
    placeholder: "Например: приложение для записи клиентов в парикмахерскую",
    options: [
      { id: "booking", label: "Запись клиентов (салон, мастер, врач)", template: "landing", brief: "приложение для записи клиентов: выбор услуги, даты и времени, список записей" },
      { id: "todo", label: "Список дел и напоминания", template: "landing", brief: "приложение со списком дел: добавить, отметить выполненным, удалить" },
      { id: "shop", label: "Магазин в телефоне", template: "shop", brief: "мобильный магазин: каталог, корзина, оформление" },
      { id: "money", label: "Учёт расходов", template: "landing", brief: "учёт расходов: добавить трату, категории, итог за месяц" },
      { id: "food", label: "Заказ еды", template: "landing", brief: "заказ еды: меню по разделам, корзина, подтверждение заказа" },
      { id: "custom", label: "Свой вариант", template: "landing", brief: "" },
    ],
  },
};

const RULES = `Общие правила: язык интерфейса — русский. Дизайн современный и спокойный, крупный читаемый текст (не меньше 16px), высокий контраст, большие кнопки (не меньше 48px по высоте), работает от ширины 320px без горизонтальной прокрутки. Никаких внешних библиотек, CDN, шрифтов и картинок из интернета: для иллюстраций используй CSS-градиенты и эмодзи. Не выдумывай реальные адреса, телефоны и цены компаний: там, где нужны личные данные, ставь понятные заглушки в квадратных скобках, например [ваш телефон]. Любая форма не должна притворяться, что отправляет данные на сервер: после отправки показывай «Спасибо! Это демонстрационная форма — заявка пока никуда не отправляется». Подключай стили и скрипт относительными путями.`;

const SITE_SYSTEM = `Ты — опытный веб-дизайнер. Создай готовый сайт по описанию пользователя. Выведи ВСЕ файлы, каждый строго в формате:
<file path="index.html">ПОЛНОЕ содержимое</file>
Файлы: index.html, style.css, script.js (<link rel="stylesheet" href="style.css">, <script src="script.js"></script>). ${RULES} Никакого текста до первого и после последнего </file>.`;

const APP_SYSTEM = `Ты — дизайнер мобильных приложений. Создай кликабельный прототип приложения по описанию. Это один экран-«телефон» (ширина контента до 430px по центру), внутри 3–4 экрана, между которыми можно переключаться нижней панелью вкладок с подписями. Действия должны реально работать (добавление, отметка, удаление), данные сохраняй в localStorage. Выведи ВСЕ файлы, каждый строго в формате:
<file path="index.html">ПОЛНОЕ содержимое</file>
Файлы: index.html, style.css, script.js. ${RULES} Никакого текста до первого и после последнего </file>.`;

interface Draft {
  option: string;
  text: string;
  name: string;
  extra: string;
}

export function BuildWizard({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const model = useSettings((s) => s.preferredModel);

  const [step, setStep] = useState(1);
  const [d, setD] = useState<Draft>({ option: "", text: "", name: "", extra: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const restored = useRef(false);

  // Restore unfinished work, or start from what was typed on the home screen.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (q.trim().length >= 3) {
      const text = q.trim();
      setD({ option: "custom", text, name: suggestName(text, "custom"), extra: "" });
      setStep(2);
      return;
    }
    const saved = loadDraft(kind);
    if (saved) {
      setD(saved.data as unknown as Draft);
      setStep(Math.min(Math.max(saved.step, 1), 2));
    }
  }, [kind, q]);

  useEffect(() => {
    if (!restored.current || busy) return;
    saveDraft(kind, step, { ...d });
  }, [kind, step, d, busy]);

  const opt = copy.options.find((o) => o.id === d.option);
  const canContinue = (d.option !== "" && d.option !== "custom") || d.text.trim().length >= 5;

  const pick = (o: Option) => {
    setD((p) => ({ ...p, option: o.id }));
    if (o.id === "custom") setTimeout(() => textRef.current?.focus(), 50);
  };

  const toStep2 = () => {
    setD((p) => ({ ...p, option: p.option || "custom", name: p.name || suggestName(p.text, p.option || "custom", opt && opt.id !== "custom" ? opt.label.replace(/^Сайт для /, "") : undefined) }));
    setStep(2);
  };

  const description = () => [opt?.brief ? `Тип: ${opt.brief}.` : "", d.text.trim() ? `Пожелания пользователя: ${d.text.trim()}.` : "", d.extra.trim() ? `Дополнительно: ${d.extra.trim()}.` : ""].filter(Boolean).join("\n");

  const finish = async (files: { path: string; content: string }[], how: string) => {
    const p = await createProject({
      name: d.name.trim() || "Мой проект",
      kind: kind === "site" ? "website" : "other",
      stack: kind === "site" ? "HTML/CSS/JS" : APP_STACK,
      description: description().slice(0, 500),
      files,
    });
    await logActivity({ agent: "Nexus", project: p.id, kind: "task", title: how, detail: d.text.slice(0, 120) });
    clearDraft(kind);
    router.push(`/projects/${p.id}?new=1`);
  };

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const text = await generateText(kind === "site" ? SITE_SYSTEM : APP_SYSTEM, `Название: ${d.name.trim()}\n${description()}`, model, 8000);
      const blocks = parseFileBlocks(text).filter((b) => safeRelPath(b.path));
      if (!blocks.some((b) => b.path === "index.html")) throw new Error("ИИ не вернул готовую страницу");
      await finish(blocks.map((b) => ({ path: b.path, content: b.content })), `Nexus создал ${copy.noun} (${blocks.length} файлов)`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  const fromTemplate = async () => {
    setBusy(true);
    setError(null);
    try {
      const files = buildSite({ name: d.name.trim() || "Мой сайт", tagline: d.text.trim().slice(0, 90) || "Добро пожаловать", template: opt?.template ?? "landing", accent: "#6366f1", stack: "static", auth: false });
      await finish(files, "Сайт создан по готовому шаблону");
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle title={copy.title} back={{ href: "/create", label: "Назад" }} />
      {busy ? (
        <div className="space-y-4">
          <NexusSays>Начинаю работу над «{d.name}». Обычно это занимает 20–60 секунд. Страницу можно не закрывать.</NexusSays>
          <Loading text={`Создаю ${copy.noun}… Пожалуйста, подождите.`} />
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 1) {
              if (canContinue) toStep2();
            } else if (d.name.trim()) void generate();
          }}
        >
          <StepDots step={step} total={2} />
          {step === 1 ? (
            <>
              <NexusSays>{copy.ask}</NexusSays>
              <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Варианты">
                {copy.options.map((o) => <Chip key={o.id} selected={d.option === o.id} onClick={() => pick(o)}>{o.label}</Chip>)}
              </div>
              <TextArea ref={textRef} label={d.option === "custom" ? "Опишите, что вы хотите" : "Или опишите своими словами (необязательно)"} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} placeholder={copy.placeholder} />
              <Button type="submit" disabled={!canContinue} className="w-full sm:w-auto sm:min-w-56">Продолжить<ArrowRight className="size-5" aria-hidden /></Button>
            </>
          ) : (
            <>
              <NexusSays>Понял. Подготовлю {copy.noun}{d.text.trim() ? ` по вашему описанию` : opt && opt.id !== "custom" ? ` — «${opt.label.toLowerCase()}»` : ""}. Как назвать?</NexusSays>
              <TextInput label="Название" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} hint="Не знаете? Оставьте как есть — название можно поменять в любой момент." maxLength={60} />
              <TextArea label="Что ещё важно? (можно пропустить)" value={d.extra} onChange={(e) => setD({ ...d, extra: e.target.value })} placeholder="Например: нежные цвета, показать цены, указать, что работаем по выходным" className="min-h-24" />
              {error && <ErrorBox message={error} onRetry={() => void generate()} extra={kind === "site" ? <Button variant="secondary" onClick={() => void fromTemplate()}>Сделать по готовому шаблону</Button> : undefined} />}
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft className="size-5" aria-hidden />Назад</Button>
                <Button type="submit" disabled={!d.name.trim()} className="sm:min-w-56"><Sparkles className="size-5" aria-hidden />{copy.create}</Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
