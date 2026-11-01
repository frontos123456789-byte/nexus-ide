"use client";

import { useMemo, useState } from "react";
import { Command } from "cmdk";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Bot,
  Brain,
  Eraser,
  FilePlus2,
  FolderPlus,
  ListChecks,
  MessageSquare,
  PanelBottom,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Sparkles,
  Trash2,
  Volume2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { EXAMPLE_PROMPTS } from "@/lib/agents/examples";
import { useAgentStore } from "@/lib/store/agent";
import { runPrompt } from "@/lib/store/agent-actions";
import { confirmResetWorkspace, promptNewFile, promptNewFolder } from "@/lib/store/file-actions";
import { useIdeStore, type AgentMode } from "@/lib/store/ide";
import { detectMac, formatShortcut } from "@/lib/utils/hotkeys";
import { playSound } from "@/lib/utils/sound";
import { MOBILE_QUERY } from "@/lib/utils/use-mobile";
import { FileIcon } from "../FileTree/FileIcon";
import { SHORTCUTS } from "./useIdeHotkeys";

interface Action {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
}

const ITEM =
  "flex cursor-default items-center gap-2.5 rounded-md px-2.5 py-2 mobile:py-3 text-xs mobile:text-sm text-subtle outline-none data-[selected=true]:bg-accent/20 data-[selected=true]:text-white [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted data-[selected=true]:[&_svg]:text-accent-soft";
const GROUP = "px-1 py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted";

export function CommandPalette() {
  const open = useIdeStore((s) => s.paletteOpen);
  const mode = useIdeStore((s) => s.paletteMode);
  const nodes = useIdeStore((s) => s.nodes);
  const [query, setQuery] = useState("");
  const mac = detectMac();

  const close = () => {
    useIdeStore.getState().closePalette();
    setQuery("");
  };

  const files = useMemo(
    () =>
      Object.values(nodes)
        .filter((n) => n.type === "file")
        .map((n) => n.path)
        .sort(),
    [nodes],
  );

  const actions = useMemo<Action[]>(() => {
    const ide = () => useIdeStore.getState();
    const phone = window.matchMedia(MOBILE_QUERY).matches;
    const setMode = (m: AgentMode) => () => {
      ide().setAgentMode(m);
      ide().focusAgent();
    };
    return [
      { id: "mode-chat", label: "Режим агента: Chat", hint: "Alt+1", icon: <MessageSquare />, run: setMode("chat") },
      { id: "mode-work", label: "Режим агента: Work", hint: "Alt+2", icon: <ListChecks />, run: setMode("work") },
      { id: "mode-code", label: "Режим агента: Code", hint: "Alt+3", icon: <Workflow />, run: setMode("code") },
      { id: "focus-agent", label: "Фокус на агенте", hint: formatShortcut(SHORTCUTS.agent, mac), icon: <Bot />, run: () => ide().focusAgent() },
      { id: "new-file", label: "Новый файл…", icon: <FilePlus2 />, run: () => void promptNewFile("") },
      { id: "new-folder", label: "Новая папка…", icon: <FolderPlus />, run: () => void promptNewFolder("") },
      { id: "toggle-sidebar", label: phone ? "Открыть файлы" : "Показать/скрыть сайдбар", hint: formatShortcut(SHORTCUTS.sidebar, mac), icon: <PanelLeft />, run: () => (phone ? ide().setMobileTab("files") : ide().setSidebarVisible(!ide().sidebarVisible)) },
      { id: "toggle-terminal", label: phone ? "Открыть терминал" : "Показать/скрыть терминал", hint: formatShortcut(SHORTCUTS.terminal, mac), icon: <PanelBottom />, run: () => (phone ? ide().setMobileTab("terminal") : ide().setBottomVisible(!ide().bottomVisible)) },
      { id: "toggle-agent", label: phone ? "Открыть агента" : "Показать/скрыть панель агента", hint: formatShortcut(SHORTCUTS.toggleAgent, mac), icon: <PanelRight />, run: () => (phone ? ide().setMobileTab("agent") : ide().setAgentVisible(!ide().agentVisible)) },
      {
        id: "toggle-sound",
        label: ide().soundEnabled ? "Выключить звуки" : "Включить звуки",
        icon: <Volume2 />,
        run: () => {
          const next = !ide().soundEnabled;
          ide().setSoundEnabled(next);
          if (next) playSound("toggle", true);
          toast(next ? "Звуки включены" : "Звуки выключены", { duration: 1500 });
        },
      },
      {
        id: "toggle-thoughts",
        label: ide().showThoughts ? "Скрыть ход мыслей (Work)" : "Показать ход мыслей (Work)",
        icon: <Brain />,
        run: () => ide().setShowThoughts(!ide().showThoughts),
      },
      { id: "clear-chat", label: "Очистить историю Chat", icon: <Eraser />, run: () => useAgentStore.getState().clearChat() },
      { id: "clear-runs", label: "Очистить историю Code-запусков", icon: <Eraser />, run: () => useAgentStore.getState().clearRuns() },
      { id: "clear-logs", label: "Очистить логи терминала", icon: <Trash2 />, run: () => ide().clearLogs() },
      { id: "reset", label: "Сбросить рабочее пространство", icon: <RotateCcw />, run: () => void confirmResetWorkspace() },
    ];
  }, [mac, open]); // eslint-disable-line react-hooks/exhaustive-deps -- labels depend on live store state when opened

  const trimmed = query.trim();
  const filesOnly = mode === "files";

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[2px] animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[13vh] mobile:top-[calc(env(safe-area-inset-top)+8px)] z-[81] w-[min(94vw,620px)] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-panel-2 shadow-2xl shadow-black/70 outline-none animate-slide-up"
        >
          <DialogPrimitive.Title className="sr-only">Командная палитра</DialogPrimitive.Title>
          <Command loop label="Командная палитра">
            <Command.Input
              value={query}
              onValueChange={setQuery}
              autoFocus
              placeholder={filesOnly ? "Перейти к файлу…" : "Введите команду, имя файла или вопрос агенту…"}
              className="h-12 mobile:h-14 w-full border-b border-border bg-transparent px-4 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <Command.List className="max-h-[52vh] mobile:max-h-[calc(var(--app-h,100dvh)-96px)] overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-4 py-6 text-center text-xs text-muted">Ничего не найдено</Command.Empty>

              {files.length > 0 && (
                <Command.Group heading="Файлы" className={GROUP}>
                  {files.map((path) => (
                    <Command.Item
                      key={path}
                      value={`file ${path}`}
                      className={ITEM}
                      onSelect={() => {
                        useIdeStore.getState().openFile(path);
                        useIdeStore.getState().setMobileTab("editor");
                        close();
                      }}
                    >
                      <FileIcon path={path} className="!text-current" />
                      <span className="truncate">{path}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {!filesOnly && (
                <>
                  <Command.Group heading="Действия" className={GROUP}>
                    {actions.map((a) => (
                      <Command.Item
                        key={a.id}
                        value={`action ${a.label}`}
                        className={ITEM}
                        onSelect={() => {
                          close();
                          setTimeout(a.run, 0);
                        }}
                      >
                        {a.icon}
                        <span>{a.label}</span>
                        {a.hint && <span className="ml-auto font-mono text-[10px] text-muted mobile:hidden">{a.hint}</span>}
                      </Command.Item>
                    ))}
                  </Command.Group>

                  <Command.Group heading="Примеры промптов" className={GROUP}>
                    {(Object.keys(EXAMPLE_PROMPTS) as AgentMode[]).flatMap((m) =>
                      EXAMPLE_PROMPTS[m].map((ex) => (
                        <Command.Item
                          key={`${m}-${ex.title}`}
                          value={`prompt ${m} ${ex.title} ${ex.prompt}`}
                          className={ITEM}
                          onSelect={() => {
                            close();
                            setTimeout(() => runPrompt(m, ex.prompt), 0);
                          }}
                        >
                          <Sparkles />
                          <span className="truncate">{ex.title}</span>
                          <span className="ml-auto rounded bg-hover px-1.5 py-0.5 text-[10px] uppercase text-muted">{m}</span>
                        </Command.Item>
                      )),
                    )}
                  </Command.Group>
                </>
              )}

              {!filesOnly && trimmed.length > 2 && (
                <Command.Group heading="Агент" className={GROUP}>
                  {(["chat", "work", "code"] as const).map((m) => (
                    <Command.Item
                      key={`ask-${m}`}
                      forceMount
                      value={`ask ${m} ${trimmed}`}
                      className={ITEM}
                      onSelect={() => {
                        const text = trimmed;
                        close();
                        setTimeout(() => runPrompt(m, text), 0);
                      }}
                    >
                      <Sparkles />
                      <span className="truncate">
                        Отправить в {m[0].toUpperCase() + m.slice(1)}: «{trimmed}»
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
          <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-[10px] text-muted">
            <span>↑↓ навигация · ↵ выбрать · Esc закрыть</span>
            <span>Nexus IDE</span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
