"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Deck } from "@/lib/studio/deck";
import { friendlyError, getUnified, KIND_LABEL, type UnifiedProject } from "@/lib/simple/projects";
import { BotView } from "./BotView";
import { DeckView } from "./DeckView";
import { SiteView } from "./SiteView";
import { EmptyState, ErrorBox, Loading, LinkButton, Notice, PageTitle } from "./ui";

const DONE: Record<string, string> = {
  site: "Сайт готов и сохранён в разделе «Мои проекты». Посмотрите, что получилось. Если что-то не нравится — нажмите «Изменить».",
  app: "Дизайн готов и сохранён. Попробуйте понажимать — он кликабельный. Если что-то не нравится — нажмите «Изменить».",
  bot: "Бот создан и сохранён. Чтобы он заработал в Telegram, пройдите шаги ниже.",
  presentation: "Презентация готова и сохранена. Просмотрите слайды и измените всё, что нужно.",
};

export function ProjectView({ id }: { id: string }) {
  const isNew = useSearchParams().get("new") === "1";
  const [item, setItem] = useState<UnifiedProject | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getUnified(id).then(setItem).catch((e) => setError(friendlyError(e)));
  }, [id]);
  useEffect(load, [load]);

  const reload = useCallback(() => void getUnified(id).then((u) => u && setItem(u)), [id]);

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      {error && <ErrorBox message={error} onRetry={load} />}
      {item === undefined && !error && <Loading text="Открываю проект…" />}
      {item === null && (
        <EmptyState title="Проект не найден" text="Возможно, он был удалён или создан на другом устройстве. Проекты хранятся в том браузере, где вы их создали." action={<LinkButton href="/projects">К моим проектам</LinkButton>} />
      )}
      {item && (
        <>
          <PageTitle title={item.name} subtitle={KIND_LABEL[item.kind]} back={{ href: "/projects", label: "Мои проекты" }} />
          {isNew && <div className="mb-5"><Notice tone="success" title="Готово!">{DONE[item.kind] ?? "Проект сохранён."}</Notice></div>}
          {item.deck && <DeckView key={item.deck.id} initial={item.deck.data as Deck} />}
          {item.project && (item.kind === "site" || item.kind === "app") && <SiteView key={item.project.id} project={item.project} isApp={item.kind === "app"} onChanged={reload} />}
          {item.project && item.kind === "bot" && <BotView key={item.project.id} project={item.project} onChanged={reload} />}
          {item.project && item.kind === "other" && (
            <EmptyState title="Это обычный проект с файлами" text="Откройте его в редакторе кода — для этого нужен режим разработчика." action={<LinkButton href={`/code/ide?open=${encodeURIComponent(`${item.project.folder}/README.md`)}`}>Открыть в редакторе</LinkButton>} />
          )}
        </>
      )}
    </div>
  );
}
