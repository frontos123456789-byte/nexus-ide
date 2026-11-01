"use client";

import { useEffect, useRef, useState } from "react";
import { FREE_MODEL_CHAIN } from "@/lib/openrouter/models";
import { runPrompt } from "@/lib/store/agent-actions";
import { useIdeStore } from "@/lib/store/ide";
import { basename, dirname } from "@/lib/utils/path";
import { resolveTerminalPath, runCommand, tokenize, type OutLevel, type TerminalContext } from "@/lib/utils/terminal-commands";
import { useStickToBottom } from "@/lib/utils/use-stick-bottom";
import { cn } from "@/lib/utils/cn";

interface Line {
  id: number;
  kind: "cmd" | OutLevel;
  text: string;
  cwd?: string;
}

const LEVEL_CLASS: Record<OutLevel, string> = {
  out: "text-foreground/90",
  err: "text-red-400",
  info: "text-sky-300",
  dim: "text-muted",
  ok: "text-emerald-400",
};

let seq = 0;
const WELCOME: Line[] = [
  { id: ++seq, kind: "info", text: "Nexus Terminal — виртуальная оболочка над вашим рабочим пространством." },
  { id: ++seq, kind: "dim", text: 'Введите "help" для списка команд. Tab — автодополнение, ↑/↓ — история.' },
];

function buildContext(cwd: string, history: string[]): TerminalContext {
  const s = useIdeStore.getState();
  return {
    cwd,
    nodes: s.nodes,
    read: (p) => s.contents[p],
    createFile: (p) => useIdeStore.getState().createFile(p),
    createFolder: (p) => useIdeStore.getState().createFolder(p),
    remove: (p) => useIdeStore.getState().deleteEntry(p),
    move: (a, b) => useIdeStore.getState().renameEntry(a, b),
    open: (p) => useIdeStore.getState().openFile(p),
    ask: (prompt) => runPrompt("chat", prompt),
    models: FREE_MODEL_CHAIN.map((m) => ({ id: m.id, label: m.label })),
    aiStatus: { state: s.ai.state, modelLabel: s.ai.modelLabel, configured: s.ai.configured },
    history,
  };
}

function complete(input: string, cwd: string): string {
  const tokens = tokenize(input);
  const endsWithSpace = /\s$/.test(input);
  if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) return input;
  const partial = endsWithSpace ? "" : tokens[tokens.length - 1];
  const head = endsWithSpace ? input : input.slice(0, input.length - partial.length);
  const slash = partial.lastIndexOf("/");
  const dirPart = slash === -1 ? "" : partial.slice(0, slash + 1);
  const namePart = slash === -1 ? partial : partial.slice(slash + 1);
  const dirPath = resolveTerminalPath(cwd, dirPart || undefined);
  const nodes = useIdeStore.getState().nodes;
  const candidates = Object.values(nodes)
    .filter((n) => dirname(n.path) === dirPath && basename(n.path).toLowerCase().startsWith(namePart.toLowerCase()))
    .map((n) => basename(n.path) + (n.type === "folder" ? "/" : ""));
  if (candidates.length === 0) return input;
  let common = candidates[0];
  for (const c of candidates) while (!c.toLowerCase().startsWith(common.toLowerCase())) common = common.slice(0, -1);
  return head + dirPart + common;
}

export function ShellView({ active }: { active: boolean }) {
  const [lines, setLines] = useState<Line[]>(WELCOME);
  const [input, setInput] = useState("");
  const [cwd, setCwd] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, onScroll } = useStickToBottom<HTMLDivElement>(lines.length);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const submit = async () => {
    const command = input.trim();
    setInput("");
    setCursor(null);
    if (!command) {
      setLines((l) => [...l, { id: ++seq, kind: "cmd", text: "", cwd }]);
      return;
    }
    const nextHistory = [...history, command].slice(-100);
    setHistory(nextHistory);
    const echo: Line = { id: ++seq, kind: "cmd", text: command, cwd };
    const result = await runCommand(command, buildContext(cwd, nextHistory));
    if (result.clear) {
      setLines([]);
      return;
    }
    if (result.cwd !== undefined) setCwd(result.cwd);
    setLines((l) => [...l, echo, ...result.lines.map((r) => ({ id: ++seq, kind: r.level, text: r.text }))].slice(-600));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const next = cursor === null ? history.length - 1 : Math.max(0, cursor - 1);
      setCursor(next);
      setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cursor === null) return;
      const next = cursor + 1;
      if (next >= history.length) {
        setCursor(null);
        setInput("");
      } else {
        setCursor(next);
        setInput(history[next]);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      setInput((v) => complete(v, cwd));
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      onClick={() => inputRef.current?.focus()}
      className="h-full overflow-y-auto overscroll-contain px-3 py-2 font-mono text-[12px] mobile:text-[13px] leading-[1.65]"
    >
      {lines.map((l) =>
        l.kind === "cmd" ? (
          <div key={l.id} className="whitespace-pre-wrap break-words">
            <span className="text-emerald-400">nexus</span>
            <span className="text-muted">:</span>
            <span className="text-sky-400">/{l.cwd}</span>
            <span className="text-muted"> $ </span>
            <span className="text-foreground">{l.text}</span>
          </div>
        ) : (
          <div key={l.id} className={cn("whitespace-pre-wrap break-words", LEVEL_CLASS[l.kind])}>
            {l.text || "\u00a0"}
          </div>
        ),
      )}
      <div className="flex items-center">
        <span className="text-emerald-400">nexus</span>
        <span className="text-muted">:</span>
        <span className="text-sky-400">/{cwd}</span>
        <span className="mr-2 text-muted"> $</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          enterKeyHint="send"
          aria-label="Ввод команды терминала"
          className="min-w-0 flex-1 bg-transparent text-foreground caret-accent-soft outline-none"
        />
      </div>
    </div>
  );
}
