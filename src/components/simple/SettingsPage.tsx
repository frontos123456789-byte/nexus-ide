"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Code2, Globe, Type, UserRound } from "lucide-react";
import { AccountSection } from "@/components/account/AccountSection";
import { useSettings, type SearchMode, type TextScale } from "@/lib/settings/store";
import { cn } from "@/lib/utils/cn";
import { Chip, Help, LinkButton, PageTitle, Panel } from "./ui";

const SIZES: { id: TextScale; label: string }[] = [
  { id: 100, label: "Обычный" },
  { id: 115, label: "Крупный" },
  { id: 130, label: "Очень крупный" },
  { id: 150, label: "Огромный" },
];

const SEARCH: { id: SearchMode; label: string; hint: string }[] = [
  { id: "auto", label: "Сам решает", hint: "ИИ сам выбирает, нужен ли интернет" },
  { id: "on", label: "Всегда искать", hint: "Перед ответом искать в интернете" },
  { id: "off", label: "Не искать", hint: "Отвечать только по своим знаниям" },
];

interface Status {
  ai: boolean;
  models: { id: string; label: string; vendor: string }[];
}

export function SettingsPage() {
  const s = useSettings();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    fetch("/api/ai/status").then((r) => r.json() as Promise<Status>).then(setStatus).catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (window.location.hash === "#accounts") document.getElementById("accounts")?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <PageTitle title="Настройки" subtitle="Здесь всё самое нужное. Сложные настройки спрятаны ниже — они вам не понадобятся, пока вы сами не захотите." />

      <Panel className="space-y-4" aria-labelledby="s-size">
        <h2 id="s-size" className="flex items-center gap-2 text-xl font-bold"><Type className="size-6 text-indigo-300" aria-hidden />Размер текста</h2>
        <div className="grid gap-2.5 sm:grid-cols-2" role="group" aria-labelledby="s-size">
          {SIZES.map((z) => <Chip key={z.id} selected={s.textScale === z.id} onClick={() => s.set({ textScale: z.id })}>{z.label}</Chip>)}
        </div>
        <p className="text-subtle">Так выглядит текст при выбранном размере. Настройка действует на всём сайте и запоминается.</p>
      </Panel>

      <section id="accounts" aria-labelledby="s-acc" className="scroll-mt-4">
        <Panel className="space-y-4">
          <h2 id="s-acc" className="flex items-center gap-2 text-xl font-bold"><UserRound className="size-6 text-indigo-300" aria-hidden />Аккаунт и подключения</h2>
          <p className="text-[1.0625rem] leading-relaxed text-subtle">Подключайте их только когда нужно. Например, чтобы выложить сайт в интернет, понадобятся GitHub и Vercel — об этом Nexus скажет в нужный момент.</p>
          <AccountSection />
        </Panel>
      </section>

      <Panel className="space-y-4" aria-labelledby="s-dev">
        <h2 id="s-dev" className="flex items-center gap-2 text-xl font-bold"><Code2 className="size-6 text-indigo-300" aria-hidden />Режим разработчика</h2>
        <p className="text-[1.0625rem] leading-relaxed text-subtle">Для тех, кто умеет программировать: редактор кода, файлы, терминал, GitHub и Vercel. Если включить его, ничего не потеряется — ваши проекты останутся на месте.</p>
        <button
          role="switch"
          aria-checked={s.devMode}
          onClick={() => s.set({ devMode: !s.devMode })}
          className={cn("flex min-h-[3.5rem] w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left text-[1.0625rem] font-semibold", s.devMode ? "border-emerald-500/70 bg-emerald-500/15" : "border-border-strong bg-panel")}
        >
          <span>{s.devMode ? "Включён" : "Выключен"}</span>
          <span className={cn("rounded-full px-4 py-1.5 text-base", s.devMode ? "bg-emerald-600 text-white" : "bg-border-strong text-foreground")}>{s.devMode ? "Выключить" : "Включить"}</span>
        </button>
        {s.devMode && (
          <div className="flex flex-wrap gap-3">
            <LinkButton href="/code">Центр разработчика</LinkButton>
            <LinkButton href="/code/ide" variant="secondary">Редактор кода</LinkButton>
          </div>
        )}
      </Panel>

      <Help title="Расширенные настройки ИИ">
        <div className="space-y-5 text-foreground">
          <div>
            <h3 className="mb-2 flex items-center gap-2 text-lg font-bold"><Globe className="size-5" aria-hidden />Поиск в интернете (для AI-чата)</h3>
            <div className="grid gap-2.5 sm:grid-cols-3" role="group" aria-label="Поиск в интернете">
              {SEARCH.map((m) => (
                <Chip key={m.id} selected={s.searchMode === m.id} onClick={() => s.set({ searchMode: m.id })} className="flex flex-col items-start">
                  <span>{m.label}</span>
                  <span className="text-[0.9375rem] font-normal text-muted">{m.hint}</span>
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="model" className="mb-2 block text-lg font-bold">Какой ИИ использовать</label>
            <select id="model" value={s.preferredModel} onChange={(e) => s.set({ preferredModel: e.target.value })} className="min-h-[3.25rem] w-full rounded-2xl border-2 border-border-strong bg-background px-4 text-[1.0625rem]">
              <option value="">Подбирать автоматически (рекомендуется)</option>
              {status?.models.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.vendor}</option>)}
            </select>
            <p className="mt-2 text-base text-muted">Если выбранный ИИ занят, Nexus сама переключится на другой бесплатный.</p>
            {status && !status.ai && <p className="mt-2 text-base font-semibold text-amber-200">ИИ сейчас недоступен: на сервере не добавлен ключ OpenRouter. Обратитесь к администратору.</p>}
            {status?.ai && <p className="mt-2 text-base text-emerald-200">ИИ подключён и готов к работе.</p>}
          </div>
        </div>
      </Help>

      <p className="text-base text-muted">
        <Link href="/legal/privacy" className="underline underline-offset-4">Политика конфиденциальности</Link> · <Link href="/legal/eula" className="underline underline-offset-4">Условия использования</Link>
      </p>
    </div>
  );
}
