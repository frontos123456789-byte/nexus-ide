"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Code2, Globe, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useSettings, type SearchMode } from "@/lib/settings/store";
import { cn } from "@/lib/utils/cn";

interface Status {
  ai: boolean;
  models: { id: string; label: string; vendor: string }[];
  search: { id: string; keyed: boolean; ready: boolean }[];
  jsRendering: boolean;
}

const SEARCH_MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "auto", label: "Auto", hint: "ИИ сам решает, нужен ли интернет" },
  { id: "on", label: "Search On", hint: "Всегда искать в интернете перед ответом" },
  { id: "off", label: "Search Off", hint: "Только знания модели, без интернета" },
];

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const s = useSettings();
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (!open) return;
    fetch("/api/ai/status").then((r) => r.json() as Promise<Status>).then(setStatus).catch(() => setStatus(null));
  }, [open]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-2 top-[max(8px,env(safe-area-inset-top))] z-50 mx-auto flex max-h-[calc(100dvh-16px)] w-auto max-w-lg flex-col overflow-hidden rounded-2xl border border-border-strong bg-panel text-foreground shadow-2xl outline-none sm:top-[8vh]"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Dialog.Title className="text-base font-semibold">Настройки</Dialog.Title>
            <Dialog.Close className="grid size-10 place-items-center rounded-lg text-muted hover:bg-hover" aria-label="Закрыть">
              <X className="size-5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Globe className="size-4 text-accent-soft" />Интернет-поиск</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {SEARCH_MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => s.set({ searchMode: m.id })}
                    aria-pressed={s.searchMode === m.id}
                    className={cn("min-h-14 rounded-xl border p-3 text-left transition-colors", s.searchMode === m.id ? "border-accent bg-accent/15" : "border-border hover:bg-hover")}
                  >
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="mt-0.5 text-[11px] leading-snug text-muted">{m.hint}</div>
                  </button>
                ))}
              </div>
              {status && (
                <p className="mt-2 text-[11px] leading-relaxed text-muted">
                  Провайдеры: {status.search.map((p) => `${p.id}${p.ready ? "" : " (нет ключа)"}`).join(" → ")}. Без ключей Tavily/Brave используются бесплатные
                  DuckDuckGo и Wikipedia (качество ниже). Чтение JS-сайтов: {status.jsRendering ? "доступно (браузерный сервис)" : "не настроено (BROWSERLESS_URL/TOKEN)"}.
                </p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold">Модель</h3>
              <select
                value={s.preferredModel}
                onChange={(e) => s.set({ preferredModel: e.target.value })}
                className="h-11 w-full rounded-xl border border-border-strong bg-background px-3 text-sm outline-none focus:border-accent"
                aria-label="Предпочтительная модель"
              >
                <option value="">Авто (цепочка бесплатных моделей)</option>
                {status?.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label} · {m.vendor}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-muted">При сбое или лимите Nexus автоматически переключается на следующую бесплатную модель.</p>
              {status && !status.ai && <p className="mt-1 text-[11px] text-amber-300">На сервере не задан ключ OpenRouter — ответы ИИ недоступны.</p>}
            </section>

            <section className="rounded-xl border border-border p-3">
              <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Code2 className="size-4 text-accent-soft" />Режим разработчика</h3>
              <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                <span className="text-sm">Включить Nexus Code Studio</span>
                <Switch checked={s.devMode} onCheckedChange={(v) => s.set({ devMode: v })} aria-label="Включить Nexus Code Studio" className="h-6 w-11 [&>span]:size-5 [&>span]:translate-x-0.5 [&>span[data-state=checked]]:translate-x-[22px]" />
              </label>
              <p className="text-[11px] leading-relaxed text-muted">
                Отдельное рабочее пространство на маршруте /code: проекты, редактор Monaco, терминал, студии ботов, сайтов и презентаций, GitHub и Vercel. По умолчанию выключено.
              </p>
              {s.devMode && (
                <Link href="/code" className="mt-3 flex min-h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-accent-soft">
                  Открыть Code Studio
                </Link>
              )}
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
