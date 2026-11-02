"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import { useSettings } from "@/lib/settings/store";
import { clearDraft, friendlyError, loadDraft, saveDraft, setMeta } from "@/lib/simple/projects";
import { generateBot, type BotCommand, type BotConfig, type BotTemplateId } from "@/lib/studio/telegram-templates";
import { createProject, logActivity } from "@/lib/studio/projects";
import { Button, Chip, ErrorBox, Loading, NexusSays, PageTitle, StepDots, TextArea, TextInput } from "../ui";

export interface BotMeta {
  config: BotConfig;
  features: string[];
  texts: Record<string, string>;
}

interface Goal {
  id: string;
  label: string;
  template: BotTemplateId;
  name: string;
}

export const BOT_GOALS: Goal[] = [
  { id: "answer", label: "Отвечать на вопросы клиентов", template: "commands", name: "Помощник" },
  { id: "orders", label: "Показывать каталог и принимать заказы", template: "shop", name: "Магазин" },
  { id: "requests", label: "Принимать заявки и обращения", template: "support", name: "Приём заявок" },
  { id: "ai", label: "Помогать клиентам с помощью ИИ", template: "ai", name: "Умный помощник" },
  { id: "news", label: "Рассылать новости подписчикам", template: "notifier", name: "Новости" },
  { id: "custom", label: "Свой вариант", template: "commands", name: "Мой бот" },
];

export const BOT_FEATURES: { id: string; label: string; command?: string; title?: string; ask?: string }[] = [
  { id: "about", label: "Рассказать о нас", command: "about", title: "О нас", ask: "Что бот ответит на «О нас»?" },
  { id: "contacts", label: "Показать контакты", command: "contacts", title: "Контакты", ask: "Какие контакты показать? (телефон, адрес)" },
  { id: "prices", label: "Показать цены", command: "prices", title: "Цены", ask: "Какие цены показать?" },
  { id: "hours", label: "Сказать часы работы", command: "hours", title: "Часы работы", ask: "Когда вы работаете?" },
  { id: "ai", label: "Отвечать на любые вопросы с помощью ИИ" },
];

export const PLACEHOLDER_PREFIX = "[Напишите здесь";

export function buildBotConfig(name: string, description: string, goal: Goal, features: string[], texts: Record<string, string>): BotConfig {
  const commands: BotCommand[] = BOT_FEATURES.filter((f) => f.command && features.includes(f.id)).map((f) => ({
    command: f.command as string,
    description: f.title as string,
    reply: texts[f.id]?.trim() || `${PLACEHOLDER_PREFIX}: ${f.title?.toLowerCase()}]`,
  }));
  return {
    name,
    description: description || BOT_GOALS.find((g) => g.id === goal.id)?.label || "Telegram-бот",
    lang: "node",
    template: goal.template,
    commands,
    buttons: BOT_FEATURES.filter((f) => f.title && features.includes(f.id)).map((f) => f.title as string),
    useAI: features.includes("ai") || goal.template === "ai",
    db: "none",
    mode: "polling",
  };
}

/** A sample conversation so the user can see what the bot will do. Built from the real choices, not invented. */
export function sampleDialog(name: string, goal: Goal, features: string[], texts: Record<string, string>): { from: "user" | "bot"; text: string }[] {
  const out: { from: "user" | "bot"; text: string }[] = [
    { from: "user", text: "/start" },
    { from: "bot", text: `Здравствуйте! Это бот «${name}». Выберите, что вас интересует.` },
  ];
  for (const f of BOT_FEATURES.filter((x) => x.command && features.includes(x.id)).slice(0, 2)) {
    out.push({ from: "user", text: f.title as string }, { from: "bot", text: texts[f.id]?.trim() || "(здесь будет ваш текст)" });
  }
  if (goal.template === "shop") out.push({ from: "user", text: "/catalog" }, { from: "bot", text: "Каталог товаров с кнопкой «В корзину»" });
  if (goal.template === "support") out.push({ from: "user", text: "/ticket Не работает доставка" }, { from: "bot", text: "Спасибо, обращение принято и передано администратору." });
  if (goal.template === "notifier") out.push({ from: "user", text: "/subscribe" }, { from: "bot", text: "Вы подписались на новости." });
  if (features.includes("ai") || goal.template === "ai") out.push({ from: "user", text: "Как к вам добраться?" }, { from: "bot", text: "(Ответ придумает ИИ — его смысл зависит от вопроса.)" });
  return out;
}

export function DialogPreview({ items }: { items: { from: "user" | "bot"; text: string }[] }) {
  return (
    <div className="space-y-2 rounded-3xl border-2 border-border-strong bg-background p-4" role="img" aria-label="Пример диалога с ботом">
      {items.map((m, i) => (
        <div key={i} className={m.from === "user" ? "flex justify-end" : "flex justify-start"}>
          <span className={`max-w-[85%] break-words rounded-2xl px-4 py-2.5 text-[1.0625rem] leading-snug ${m.from === "user" ? "bg-indigo-500 text-white" : "bg-panel-2 text-foreground"}`}>
            <span className="sr-only">{m.from === "user" ? "Клиент: " : "Бот: "}</span>{m.text}
          </span>
        </div>
      ))}
    </div>
  );
}

interface Draft {
  goal: string;
  text: string;
  name: string;
  features: string[];
  texts: Record<string, string>;
}

export function BotWizard() {
  const router = useRouter();
  const q = useSearchParams().get("q") ?? "";
  const model = useSettings((s) => s.preferredModel);
  void model;
  const [step, setStep] = useState(1);
  const [d, setD] = useState<Draft>({ goal: "", text: "", name: "", features: [], texts: {} });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (q.trim().length >= 3) return setD((p) => ({ ...p, goal: "custom", text: q.trim() }));
    const saved = loadDraft("bot");
    if (saved) {
      setD(saved.data as unknown as Draft);
      setStep(Math.min(Math.max(saved.step, 1), 3));
    }
  }, [q]);
  useEffect(() => {
    if (restored.current && !busy) saveDraft("bot", step, { ...d });
  }, [step, d, busy]);

  const goal = BOT_GOALS.find((g) => g.id === d.goal);
  const canContinue = (d.goal !== "" && d.goal !== "custom") || d.text.trim().length >= 5;
  const toggle = (id: string) => setD((p) => ({ ...p, features: p.features.includes(id) ? p.features.filter((x) => x !== id) : [...p.features, id] }));

  const create = async () => {
    const g = goal ?? (BOT_GOALS[5] as Goal);
    setBusy(true);
    setError(null);
    try {
      const config = buildBotConfig(d.name.trim(), d.text.trim(), g, d.features, d.texts);
      const p = await createProject({ name: d.name.trim(), kind: "telegram", stack: "Node.js (grammY)", description: config.description.slice(0, 500), files: generateBot(config) });
      const meta: BotMeta = { config, features: d.features, texts: d.texts };
      await setMeta(p.id, meta);
      await logActivity({ agent: "Nexus", project: p.id, kind: "task", title: "Создан Telegram-бот" });
      clearDraft("bot");
      router.push(`/projects/${p.id}?new=1`);
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  };

  return (
    <div>
      <PageTitle title="Создание Telegram-бота" back={{ href: "/create", label: "Назад" }} />
      {busy ? (
        <div className="space-y-4"><NexusSays>Собираю вашего бота…</NexusSays><Loading text="Готовлю бота. Пожалуйста, подождите." /></div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 1 && canContinue) {
              setD((p) => ({ ...p, goal: p.goal || "custom", name: p.name || (goal && goal.id !== "custom" ? goal.name : "Мой бот") }));
              setStep(2);
            } else if (step === 2 && d.name.trim()) setStep(3);
            else if (step === 3) void create();
          }}
        >
          <StepDots step={step} total={3} />
          {step === 1 && (
            <>
              <NexusSays>Что должен делать ваш бот?</NexusSays>
              <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-label="Что должен делать бот">
                {BOT_GOALS.map((g) => <Chip key={g.id} selected={d.goal === g.id} onClick={() => setD({ ...d, goal: g.id })}>{g.label}</Chip>)}
              </div>
              <TextArea label={d.goal === "custom" ? "Опишите, что должен делать бот" : "Или опишите своими словами (необязательно)"} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} placeholder="Например: бот для записи клиентов в салон красоты" />
              <Button type="submit" disabled={!canContinue} className="w-full sm:w-auto sm:min-w-56">Продолжить<ArrowRight className="size-5" aria-hidden /></Button>
            </>
          )}
          {step === 2 && (
            <>
              <NexusSays>Отлично. Как назовём бота?</NexusSays>
              <TextInput label="Название бота" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} maxLength={50} hint="Это название увидите вы. Имя в Telegram вы придумаете на следующем этапе у специального помощника Telegram." />
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Button variant="secondary" onClick={() => setStep(1)}><ArrowLeft className="size-5" aria-hidden />Назад</Button>
                <Button type="submit" disabled={!d.name.trim()} className="sm:min-w-56">Продолжить<ArrowRight className="size-5" aria-hidden /></Button>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <NexusSays>Какие функции нужны боту? Отметьте всё подходящее — или оставьте как есть.</NexusSays>
              <div className="grid gap-2.5" role="group" aria-label="Функции бота">
                {BOT_FEATURES.map((f) => (
                  <div key={f.id} className="space-y-2">
                    <Chip selected={d.features.includes(f.id)} onClick={() => toggle(f.id)} className="w-full">{f.label}</Chip>
                    {f.ask && d.features.includes(f.id) && (
                      <TextArea label={f.ask} value={d.texts[f.id] ?? ""} onChange={(e) => setD({ ...d, texts: { ...d.texts, [f.id]: e.target.value.slice(0, 600) } })} className="min-h-24" hint="Можно оставить пустым и заполнить позже." />
                    )}
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-base font-semibold">Пример разговора с вашим ботом:</p>
                <DialogPreview items={sampleDialog(d.name, goal ?? (BOT_GOALS[5] as Goal), d.features, d.texts)} />
              </div>
              {error && <ErrorBox message={error} onRetry={() => void create()} />}
              <div className="flex flex-col-reverse gap-3 sm:flex-row">
                <Button variant="secondary" onClick={() => setStep(2)}><ArrowLeft className="size-5" aria-hidden />Назад</Button>
                <Button type="submit" className="sm:min-w-56"><Sparkles className="size-5" aria-hidden />Создать бота</Button>
              </div>
            </>
          )}
        </form>
      )}
    </div>
  );
}
