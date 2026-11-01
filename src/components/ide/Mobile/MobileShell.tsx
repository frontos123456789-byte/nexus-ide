"use client";

import { Bot, FileCode2, Files, Search, SquareTerminal, Volume2, VolumeX, type LucideIcon } from "lucide-react";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore, type MobileTab } from "@/lib/store/ide";
import { useSoftKeyboard, useVisualViewportVars } from "@/lib/utils/use-mobile";
import { playSound } from "@/lib/utils/sound";
import { cn } from "@/lib/utils/cn";
import { AgentPanel } from "../Agent/AgentPanel";
import { EditorArea } from "../Editor/EditorArea";
import { Sidebar } from "../FileTree/Sidebar";
import { CommandPalette } from "../Layout/CommandPalette";
import { DialogHost } from "../Layout/DialogHost";
import { Logo } from "../Layout/Logo";
import { StatusBar } from "../Layout/StatusBar";
import { TerminalPanel } from "../Terminal/TerminalPanel";
import { MobileKeyBar } from "./MobileKeyBar";

const TABS: { id: MobileTab; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "Файлы", icon: Files },
  { id: "editor", label: "Редактор", icon: FileCode2 },
  { id: "agent", label: "Агент", icon: Bot },
  { id: "terminal", label: "Терминал", icon: SquareTerminal },
];

function MobileHeader() {
  const sound = useIdeStore((s) => s.soundEnabled);
  const tab = useIdeStore((s) => s.mobileTab);
  const label = TABS.find((t) => t.id === tab)?.label ?? "";
  const set = useIdeStore.getState();

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-panel px-3 pt-[env(safe-area-inset-top)] box-content select-none">
      <Logo className="size-5 shrink-0" />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-[13px] font-semibold tracking-tight text-foreground">Nexus IDE</span>
        <span className="truncate text-[10px] text-muted">{label}</span>
      </div>
      <div className="ml-auto flex items-center gap-0.5">
        <button
          onClick={() => {
            set.setSoundEnabled(!sound);
            if (!sound) playSound("toggle", true);
          }}
          aria-label={sound ? "Выключить звук" : "Включить звук"}
          aria-pressed={sound}
          className="grid size-10 place-items-center rounded-lg text-muted active:bg-hover"
        >
          {sound ? <Volume2 className="size-[18px]" /> : <VolumeX className="size-[18px]" />}
        </button>
        <button
          onClick={() => set.openPalette("all")}
          aria-label="Открыть командную палитру"
          className="grid size-10 place-items-center rounded-lg text-subtle active:bg-hover"
        >
          <Search className="size-[18px]" />
        </button>
      </div>
    </header>
  );
}

function MobileNav() {
  const tab = useIdeStore((s) => s.mobileTab);
  const errors = useIdeStore((s) => s.logs.filter((l) => l.level === "error").length);
  const agentBusy = useAgentStore((s) => s.busy.chat || s.busy.work || s.busy.code);

  return (
    <nav
      aria-label="Разделы IDE"
      className="grid shrink-0 grid-cols-4 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)]"
    >
      {TABS.map(({ id, label, icon: Icon }) => {
        const active = tab === id;
        return (
          <button
            key={id}
            onClick={() => useIdeStore.getState().setMobileTab(id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors active:bg-hover",
              active ? "text-foreground" : "text-muted",
            )}
          >
            {active && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b bg-accent" />}
            <span className="relative">
              <Icon className={cn("size-5 transition-colors", active && "text-accent-soft")} />
              {id === "agent" && agentBusy && (
                <span className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-accent-soft ring-2 ring-panel" />
              )}
              {id === "terminal" && errors > 0 && (
                <span className="absolute -right-1.5 -top-1 grid min-w-3.5 place-items-center rounded-full bg-red-500 px-1 text-[8px] leading-3.5 text-white">
                  {errors > 9 ? "9+" : errors}
                </span>
              )}
            </span>
            {label}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Phone layout: one full-screen view at a time + bottom tab bar.
 * All views stay mounted (just hidden) so Monaco, chat scroll and drafts survive tab switches.
 */
export function MobileShell() {
  const tab = useIdeStore((s) => s.mobileTab);
  const keyboard = useSoftKeyboard(true);
  useVisualViewportVars(true);

  const views: Record<MobileTab, React.ReactNode> = {
    files: <Sidebar />,
    editor: <EditorArea />,
    agent: <AgentPanel />,
    terminal: <TerminalPanel />,
  };

  return (
    <div
      className="fixed left-0 flex w-full flex-col overflow-hidden bg-background text-foreground"
      style={{ top: "var(--app-top, 0px)", height: "var(--app-h, 100dvh)" }}
    >
      <MobileHeader />
      <main className="relative min-h-0 flex-1">
        {(Object.keys(views) as MobileTab[]).map((id) => (
          <div key={id} className={cn("absolute inset-0", tab !== id && "hidden")} aria-hidden={tab !== id}>
            {views[id]}
          </div>
        ))}
      </main>
      {keyboard.editorFocused && tab === "editor" && <MobileKeyBar />}
      {!keyboard.open && <StatusBar />}
      {!keyboard.open && <MobileNav />}
      <CommandPalette />
      <DialogHost />
    </div>
  );
}
