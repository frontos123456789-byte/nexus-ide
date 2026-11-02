"use client";

import Link from "next/link";
import { ArrowLeft, PanelBottom, PanelLeft, PanelRight, Search } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { Kbd } from "@/components/ui/kbd";
import { useIdeStore } from "@/lib/store/ide";
import { detectMac, formatShortcut } from "@/lib/utils/hotkeys";
import { cn } from "@/lib/utils/cn";
import { Logo } from "./Logo";
import { SHORTCUTS } from "./useIdeHotkeys";

function ToggleButton({
  active,
  label,
  shortcut,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  shortcut: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "grid size-6 place-items-center rounded transition-colors hover:bg-hover",
          active ? "text-foreground" : "text-muted",
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export function TitleBar() {
  const sidebar = useIdeStore((s) => s.sidebarVisible);
  const bottom = useIdeStore((s) => s.bottomVisible);
  const agent = useIdeStore((s) => s.agentVisible);
  const set = useIdeStore.getState();
  const mac = detectMac();

  return (
    <header className="relative flex h-9 shrink-0 items-center border-b border-border bg-panel px-3 select-none">
      <div className="flex items-center gap-2">
        <Link href="/code" aria-label="Вернуться в Code Studio" title="Code Studio" className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <Logo className="size-[18px]" />
        <span className="text-xs font-semibold tracking-tight text-foreground">Nexus IDE</span>
        <span className="hidden text-xs text-muted sm:inline">/ nexus-demo</span>
      </div>

      <button
        onClick={() => set.openPalette("all")}
        className="absolute left-1/2 hidden h-6 w-[min(36vw,420px)] -translate-x-1/2 items-center gap-2 rounded-md border border-border-strong bg-background px-2.5 text-[11px] text-muted transition-colors hover:border-accent/50 hover:text-subtle md:flex"
        aria-label="Открыть командную палитру"
      >
        <Search className="size-3" />
        <span>Поиск команд и файлов</span>
        <span className="ml-auto">
          <Kbd>{formatShortcut(SHORTCUTS.palette, mac)}</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-0.5">
        <ToggleButton
          active={sidebar}
          label="Сайдбар"
          shortcut={formatShortcut(SHORTCUTS.sidebar, mac)}
          onClick={() => set.setSidebarVisible(!sidebar)}
        >
          <PanelLeft className="size-4" />
        </ToggleButton>
        <ToggleButton
          active={bottom}
          label="Терминал"
          shortcut={formatShortcut(SHORTCUTS.terminal, mac)}
          onClick={() => set.setBottomVisible(!bottom)}
        >
          <PanelBottom className="size-4" />
        </ToggleButton>
        <ToggleButton
          active={agent}
          label="Панель агента"
          shortcut={formatShortcut(SHORTCUTS.toggleAgent, mac)}
          onClick={() => set.setAgentVisible(!agent)}
        >
          <PanelRight className="size-4" />
        </ToggleButton>
      </div>
    </header>
  );
}
