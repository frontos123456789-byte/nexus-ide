"use client";

import { Bot, Files, RotateCcw, Search, SquareTerminal, Volume2, VolumeX } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { useIdeStore } from "@/lib/store/ide";
import { confirmResetWorkspace } from "@/lib/store/file-actions";
import { detectMac, formatShortcut } from "@/lib/utils/hotkeys";
import { playSound } from "@/lib/utils/sound";
import { cn } from "@/lib/utils/cn";
import { SHORTCUTS } from "./useIdeHotkeys";

function Item({
  label,
  shortcut,
  active,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip label={label} shortcut={shortcut} side="right">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "relative grid size-10 place-items-center text-muted transition-colors hover:text-foreground",
          active && "text-foreground",
        )}
      >
        {active && <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-accent" />}
        {children}
      </button>
    </Tip>
  );
}

export function ActivityBar() {
  const sidebar = useIdeStore((s) => s.sidebarVisible);
  const bottom = useIdeStore((s) => s.bottomVisible);
  const agent = useIdeStore((s) => s.agentVisible);
  const sound = useIdeStore((s) => s.soundEnabled);
  const set = useIdeStore.getState();
  const mac = detectMac();

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center border-r border-border bg-panel py-1" aria-label="Панель действий">
      <Item label="Проводник" shortcut={formatShortcut(SHORTCUTS.sidebar, mac)} active={sidebar} onClick={() => set.setSidebarVisible(!sidebar)}>
        <Files className="size-[18px]" />
      </Item>
      <Item label="Быстрый поиск файла" shortcut={formatShortcut(SHORTCUTS.quickOpen, mac)} onClick={() => set.openPalette("files")}>
        <Search className="size-[18px]" />
      </Item>
      <Item label="Терминал" shortcut={formatShortcut(SHORTCUTS.terminal, mac)} active={bottom} onClick={() => set.setBottomVisible(!bottom)}>
        <SquareTerminal className="size-[18px]" />
      </Item>
      <Item label="ИИ-агент" shortcut={formatShortcut(SHORTCUTS.agent, mac)} active={agent} onClick={() => (agent ? set.setAgentVisible(false) : set.focusAgent())}>
        <Bot className="size-[18px]" />
      </Item>

      <div className="mt-auto flex flex-col items-center">
        <Item
          label={sound ? "Звук включён" : "Звук выключен"}
          onClick={() => {
            set.setSoundEnabled(!sound);
            if (!sound) playSound("toggle", true);
          }}
        >
          {sound ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
        </Item>
        <Item label="Сбросить рабочее пространство" onClick={() => void confirmResetWorkspace()}>
          <RotateCcw className="size-4" />
        </Item>
      </div>
    </nav>
  );
}
