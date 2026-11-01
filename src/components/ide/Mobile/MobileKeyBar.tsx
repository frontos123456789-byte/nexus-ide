"use client";

import { ChevronDown, Redo2, Undo2 } from "lucide-react";
import { editorBridge } from "@/lib/store/editor-bridge";

type Key = { label: string; run: () => void; wide?: boolean; aria?: string };

const editor = () => editorBridge.editor;
const type = (text: string) => () => editor()?.trigger("mobile-keys", "type", { text });

const SYMBOLS = ["{", "}", "(", ")", "[", "]", "<", ">", ";", ":", "=", '"', "'", "`", "/", "\\", "|", "&", "!", "?", "$", "#", "_", "-", "+", "*"];

const KEYS: Key[] = [
  { label: "Tab", wide: true, run: () => editor()?.trigger("mobile-keys", "tab", null) },
  ...SYMBOLS.map((s) => ({ label: s, run: type(s) })),
];

/**
 * Row of programming symbols that phone keyboards bury under extra layers.
 * Buttons never take focus (mousedown/pointerdown are cancelled), so the keyboard stays open.
 */
export function MobileKeyBar() {
  const keep = (e: React.SyntheticEvent) => e.preventDefault();
  const btn =
    "grid h-9 shrink-0 place-items-center rounded-md border border-border-strong bg-background font-mono text-sm text-foreground active:bg-accent/30";

  return (
    <div
      role="toolbar"
      aria-label="Быстрые символы"
      className="flex shrink-0 items-center gap-1 border-t border-border bg-panel-2 px-1.5 py-1"
      onMouseDown={keep}
      onPointerDown={keep}
    >
      <button aria-label="Отменить" className={`${btn} w-9`} onClick={() => editor()?.trigger("mobile-keys", "undo", null)}>
        <Undo2 className="size-4" />
      </button>
      <button aria-label="Повторить" className={`${btn} w-9`} onClick={() => editor()?.trigger("mobile-keys", "redo", null)}>
        <Redo2 className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {KEYS.map((k) => (
          <button key={k.label} onClick={k.run} className={`${btn} ${k.wide ? "px-3 text-xs" : "w-9"}`}>
            {k.label}
          </button>
        ))}
      </div>
      <button
        aria-label="Скрыть клавиатуру"
        className={`${btn} w-9 text-muted`}
        onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
      >
        <ChevronDown className="size-4" />
      </button>
    </div>
  );
}
