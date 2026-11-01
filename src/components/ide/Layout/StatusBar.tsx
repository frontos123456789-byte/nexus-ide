"use client";

import { useAtom, useAtomValue } from "jotai";
import { AlertTriangle, Check, CircleDot, Loader2, Sparkles, Volume2, VolumeX, WrapText } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { cursorAtom, editorSettingsAtom } from "@/lib/store/editor-atoms";
import { useIdeStore, type AiState } from "@/lib/store/ide";
import { languageFromPath, languageLabel } from "@/lib/utils/path";
import { playSound } from "@/lib/utils/sound";
import { cn } from "@/lib/utils/cn";

const AI_DOT: Record<AiState, string> = {
  idle: "bg-emerald-400",
  connecting: "bg-amber-400 animate-pulse",
  streaming: "bg-sky-400 animate-pulse",
  switching: "bg-orange-400 animate-pulse",
  error: "bg-red-400",
};

function Cell({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      className={cn(
        "flex h-full items-center gap-1.5 px-2 text-[11px] text-white/80 transition-colors hover:bg-white/10 hover:text-white",
        className,
      )}
      {...props}
    />
  );
}

function CursorCell() {
  const cursor = useAtomValue(cursorAtom);
  return (
    <Cell tabIndex={-1} aria-label="Позиция курсора">
      Стр {cursor.line}, Стлб {cursor.column}
      {cursor.selected > 0 && <span className="text-white/60">({cursor.selected} выбр.)</span>}
    </Cell>
  );
}

export function StatusBar() {
  const activePath = useIdeStore((s) => s.activePath);
  const saveState = useIdeStore((s) => s.saveState);
  const ai = useIdeStore((s) => s.ai);
  const sound = useIdeStore((s) => s.soundEnabled);
  const [settings, setSettings] = useAtom(editorSettingsAtom);
  const set = useIdeStore.getState();

  const language = activePath ? languageLabel(languageFromPath(activePath)) : null;

  let aiText: string;
  if (ai.configured === false) aiText = "ИИ не настроен: нет OPENROUTER_API_KEY";
  else if (ai.message) aiText = ai.message;
  else if (ai.modelLabel) aiText = `Модель: ${ai.modelLabel}`;
  else aiText = "ИИ готов · цепочка из 7 бесплатных моделей";

  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between border-t border-black/30 bg-[#4338ca] text-white select-none">
      <div className="flex items-stretch">
        <Cell onClick={() => set.setBottomTab("logs")} aria-label="Показать логи">
          <CircleDot className="size-3" />
          <span className="font-medium">nexus-demo</span>
        </Cell>
        <Cell onClick={() => set.setBottomTab("logs")} aria-label="Состояние сохранения">
          {saveState === "saving" ? (
            <>
              <Loader2 className="size-3 animate-spin" /> Сохранение…
            </>
          ) : (
            <>
              <Check className="size-3" /> Сохранено
            </>
          )}
        </Cell>
        <Tip label="Статус ИИ-шлюза (клик — логи)" side="top">
          <Cell onClick={() => set.setBottomTab("logs")} aria-live="polite" className="max-w-[46vw]">
            {ai.configured === false ? (
              <AlertTriangle className="size-3 text-amber-300" />
            ) : (
              <span className={cn("size-1.5 shrink-0 rounded-full", AI_DOT[ai.state])} />
            )}
            <Sparkles className="size-3 shrink-0" />
            <span className="truncate">{aiText}</span>
          </Cell>
        </Tip>
      </div>

      <div className="flex items-stretch">
        {activePath && <CursorCell />}
        {activePath && (
          <Cell tabIndex={-1} className="hidden sm:flex">
            Пробелы: 2
          </Cell>
        )}
        <Cell tabIndex={-1} className="hidden sm:flex">
          UTF-8
        </Cell>
        {language && (
          <Cell tabIndex={-1} aria-label="Язык файла">
            {language}
          </Cell>
        )}
        <Tip label={settings.wordWrap ? "Перенос строк: вкл" : "Перенос строк: выкл"} side="top">
          <Cell
            onClick={() => setSettings({ ...settings, wordWrap: !settings.wordWrap })}
            aria-pressed={settings.wordWrap}
            className={cn(settings.wordWrap && "bg-white/15")}
          >
            <WrapText className="size-3" />
          </Cell>
        </Tip>
        <Tip label={sound ? "Звуки включены" : "Звуки выключены"} side="top">
          <Cell
            onClick={() => {
              set.setSoundEnabled(!sound);
              if (!sound) playSound("toggle", true);
            }}
            aria-pressed={sound}
          >
            {sound ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
          </Cell>
        </Tip>
      </div>
    </footer>
  );
}
