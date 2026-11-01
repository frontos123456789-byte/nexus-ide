"use client";

import { FilePlus2, ListChecks, MessageSquare, Search, Workflow, type LucideIcon } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { EXAMPLE_PROMPTS, MODE_META } from "@/lib/agents/examples";
import { runPrompt } from "@/lib/store/agent-actions";
import { promptNewFile } from "@/lib/store/file-actions";
import { useIdeStore, type AgentMode } from "@/lib/store/ide";
import { detectMac, formatShortcut } from "@/lib/utils/hotkeys";
import { FileIcon } from "../FileTree/FileIcon";
import { Logo } from "../Layout/Logo";
import { SHORTCUTS } from "../Layout/useIdeHotkeys";

const MODE_ICONS: Record<AgentMode, LucideIcon> = { chat: MessageSquare, work: ListChecks, code: Workflow };
const MODE_COLORS: Record<AgentMode, string> = {
  chat: "text-sky-400 bg-sky-400/10",
  work: "text-amber-400 bg-amber-400/10",
  code: "text-emerald-400 bg-emerald-400/10",
};
const MODE_DESC: Record<AgentMode, string> = {
  chat: "Диалоговый ассистент с контекстом открытых файлов.",
  work: "Декомпозиция цели на шаги с трекингом прогресса и ходом мыслей.",
  code: "Director оркестрирует Architect, Coder и Reviewer параллельно.",
};

export function WelcomeScreen() {
  const nodes = useIdeStore((s) => s.nodes);
  const mac = detectMac();
  const files = Object.values(nodes)
    .filter((n) => n.type === "file")
    .slice(0, 6);

  const shortcuts: [string, string][] = [
    ["Командная палитра", formatShortcut(SHORTCUTS.palette, mac)],
    ["Быстрый поиск файла", formatShortcut(SHORTCUTS.quickOpen, mac)],
    ["Фокус на агенте", formatShortcut(SHORTCUTS.agent, mac)],
    ["Сайдбар", formatShortcut(SHORTCUTS.sidebar, mac)],
    ["Терминал", formatShortcut(SHORTCUTS.terminal, mac)],
    ["Сохранить", formatShortcut(SHORTCUTS.save, mac)],
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-8 mobile:px-4 py-10 mobile:py-6 animate-slide-up">
        <div className="mb-8 mobile:mb-5 flex items-center gap-4">
          <Logo className="size-12" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nexus IDE</h1>
            <p className="text-sm text-muted">Среда разработки, где ИИ-агенты работают командой</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {(["chat", "work", "code"] as const).map((mode) => {
            const Icon = MODE_ICONS[mode];
            return (
              <div key={mode} className="flex flex-col rounded-xl border border-border bg-panel p-3.5 transition-colors hover:border-border-strong">
                <div className="flex items-center gap-2">
                  <span className={`grid size-7 place-items-center rounded-md ${MODE_COLORS[mode]}`}>
                    <Icon className="size-4" />
                  </span>
                  <span className="text-sm font-medium text-foreground">{MODE_META[mode].label}</span>
                </div>
                <p className="mt-2 min-h-[34px] text-xs leading-relaxed text-muted">{MODE_DESC[mode]}</p>
                <div className="mt-3 flex flex-col gap-1.5">
                  {EXAMPLE_PROMPTS[mode].slice(0, 2).map((ex) => (
                    <button
                      key={ex.title}
                      onClick={() => runPrompt(mode, ex.prompt)}
                      className="rounded-md border border-border bg-background px-2.5 py-1.5 mobile:py-3 text-left text-[11px] mobile:text-xs text-subtle transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-foreground"
                    >
                      {ex.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Начать</h2>
            <div className="flex flex-col gap-0.5">
              <button
                onClick={() => void promptNewFile("")}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 mobile:py-2.5 text-left text-xs mobile:text-sm text-subtle transition-colors hover:bg-hover hover:text-foreground"
              >
                <FilePlus2 className="size-4 text-muted" /> Новый файл
              </button>
              <button
                onClick={() => useIdeStore.getState().openPalette("files")}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 mobile:py-2.5 text-left text-xs mobile:text-sm text-subtle transition-colors hover:bg-hover hover:text-foreground"
              >
                <Search className="size-4 text-muted" /> Открыть файл…
              </button>
            </div>
            <h2 className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Файлы проекта</h2>
            <div className="flex flex-col gap-0.5">
              {files.length === 0 && <span className="px-2 text-xs text-muted">Файлов пока нет</span>}
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => useIdeStore.getState().openFile(f.path)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 mobile:py-2.5 text-left text-xs mobile:text-sm text-subtle transition-colors hover:bg-hover hover:text-foreground"
                >
                  <FileIcon path={f.path} /> <span className="truncate">{f.path}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="mobile:hidden">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Горячие клавиши</h2>
            <div className="flex flex-col gap-1.5">
              {shortcuts.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between text-xs text-subtle">
                  {label}
                  <Kbd>{keys}</Kbd>
                </div>
              ))}
              <div className="flex items-center justify-between text-xs text-subtle">
                Режимы агента
                <Kbd>Alt+1/2/3</Kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
