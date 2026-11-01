import { basename, dirname, joinPath, normalizePath } from "@/lib/utils/path";

export type OutLevel = "out" | "err" | "info" | "dim" | "ok";

export interface OutLine {
  text: string;
  level: OutLevel;
}

export interface CommandResult {
  lines: OutLine[];
  clear?: boolean;
  cwd?: string;
}

/** Everything a command may touch — injected so commands are unit-testable. */
export interface TerminalContext {
  cwd: string;
  nodes: Record<string, { type: "file" | "folder" }>;
  read: (path: string) => string | undefined;
  createFile: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
  move: (from: string, to: string) => Promise<void>;
  open: (path: string) => void;
  ask: (prompt: string) => void;
  models: { id: string; label: string }[];
  aiStatus: { state: string; modelLabel: string | null; configured: boolean | null };
  history: string[];
}

const out = (text: string, level: OutLevel = "out"): OutLine => ({ text, level });

export const HELP_TEXT: [string, string][] = [
  ["help", "список команд"],
  ["ls [путь]", "содержимое папки"],
  ["cd <папка>", "сменить папку (cd / — в корень)"],
  ["pwd", "текущая папка"],
  ["tree [путь]", "дерево файлов"],
  ["cat <файл>", "вывести содержимое файла"],
  ["touch <файл>", "создать пустой файл"],
  ["mkdir <папка>", "создать папку"],
  ["rm <путь>", "удалить файл или папку"],
  ["mv <откуда> <куда>", "переместить/переименовать"],
  ["open <файл>", "открыть файл в редакторе"],
  ["echo <текст>", "вывести текст"],
  ["ai <запрос>", "отправить запрос ИИ-агенту (Chat)"],
  ["models", "цепочка бесплатных моделей"],
  ["status", "состояние ИИ-шлюза"],
  ["history", "история команд"],
  ["date", "текущее время"],
  ["clear", "очистить терминал"],
];

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) tokens.push(m[1] ?? m[2] ?? m[3]);
  return tokens;
}

export function resolveTerminalPath(cwd: string, arg: string | undefined): string {
  if (!arg || arg === "~") return arg === "~" ? "" : cwd;
  if (arg.startsWith("/") || arg.startsWith("~/")) return normalizePath(arg.replace(/^~/, ""));
  return joinPath(cwd, arg);
}

function children(ctx: TerminalContext, dir: string): string[] {
  return Object.keys(ctx.nodes).filter((p) => dirname(p) === dir);
}

function sortEntries(ctx: TerminalContext, paths: string[]): string[] {
  return [...paths].sort((a, b) => {
    const ta = ctx.nodes[a].type;
    const tb = ctx.nodes[b].type;
    if (ta !== tb) return ta === "folder" ? -1 : 1;
    return basename(a).localeCompare(basename(b));
  });
}

function renderTree(ctx: TerminalContext, dir: string, prefix: string, lines: OutLine[]): void {
  const items = sortEntries(ctx, children(ctx, dir));
  items.forEach((p, i) => {
    const last = i === items.length - 1;
    const isDir = ctx.nodes[p].type === "folder";
    lines.push(out(`${prefix}${last ? "└── " : "├── "}${basename(p)}${isDir ? "/" : ""}`, isDir ? "info" : "out"));
    if (isDir) renderTree(ctx, p, prefix + (last ? "    " : "│   "), lines);
  });
}

export async function runCommand(input: string, ctx: TerminalContext): Promise<CommandResult> {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { lines: [] };
  const [cmd, ...args] = tokens;
  const err = (text: string): CommandResult => ({ lines: [out(text, "err")] });
  const need = (n: number, usage: string): CommandResult | null => (args.length < n ? err(`Использование: ${usage}`) : null);

  try {
    switch (cmd) {
      case "help":
        return {
          lines: [
            out("Команды Nexus Terminal:", "info"),
            ...HELP_TEXT.map(([c, d]) => out(`  ${c.padEnd(22)} ${d}`, "out")),
          ],
        };
      case "clear":
        return { lines: [], clear: true };
      case "pwd":
        return { lines: [out("/" + ctx.cwd)] };
      case "date":
        return { lines: [out(new Date().toLocaleString("ru-RU"))] };
      case "echo":
        return { lines: [out(args.join(" "))] };
      case "history":
        return { lines: ctx.history.map((h, i) => out(`${String(i + 1).padStart(3)}  ${h}`, "dim")) };
      case "ls": {
        const target = resolveTerminalPath(ctx.cwd, args[0]);
        if (target !== "" && !ctx.nodes[target]) return err(`ls: ${args[0]}: нет такого файла или папки`);
        if (target !== "" && ctx.nodes[target].type === "file") return { lines: [out(basename(target))] };
        const items = sortEntries(ctx, children(ctx, target));
        if (items.length === 0) return { lines: [out("(пусто)", "dim")] };
        return {
          lines: items.map((p) =>
            ctx.nodes[p].type === "folder" ? out(basename(p) + "/", "info") : out(basename(p)),
          ),
        };
      }
      case "cd": {
        const target = resolveTerminalPath(ctx.cwd, args[0] ?? "~");
        if (target !== "" && ctx.nodes[target]?.type !== "folder") return err(`cd: ${args[0]}: не папка`);
        return { lines: [], cwd: target };
      }
      case "tree": {
        const target = resolveTerminalPath(ctx.cwd, args[0]);
        if (target !== "" && ctx.nodes[target]?.type !== "folder") return err(`tree: ${args[0] ?? ""}: не папка`);
        const lines: OutLine[] = [out("/" + target, "info")];
        renderTree(ctx, target, "", lines);
        return { lines };
      }
      case "cat": {
        const bad = need(1, "cat <файл>");
        if (bad) return bad;
        const path = resolveTerminalPath(ctx.cwd, args[0]);
        if (ctx.nodes[path]?.type !== "file") return err(`cat: ${args[0]}: нет такого файла`);
        const text = ctx.read(path) ?? "";
        return { lines: text === "" ? [out("(пустой файл)", "dim")] : text.replace(/\n$/, "").split("\n").map((l) => out(l)) };
      }
      case "touch": {
        const bad = need(1, "touch <файл>");
        if (bad) return bad;
        const path = resolveTerminalPath(ctx.cwd, args[0]);
        if (ctx.nodes[path]) return err(`touch: ${args[0]}: уже существует`);
        await ctx.createFile(path);
        return { lines: [out(`создан ${path}`, "ok")] };
      }
      case "mkdir": {
        const bad = need(1, "mkdir <папка>");
        if (bad) return bad;
        const path = resolveTerminalPath(ctx.cwd, args[0]);
        if (ctx.nodes[path]) return err(`mkdir: ${args[0]}: уже существует`);
        await ctx.createFolder(path);
        return { lines: [out(`создана папка ${path}/`, "ok")] };
      }
      case "rm": {
        const bad = need(1, "rm <путь>");
        if (bad) return bad;
        const path = resolveTerminalPath(ctx.cwd, args[0]);
        if (!path || !ctx.nodes[path]) return err(`rm: ${args[0]}: нет такого файла или папки`);
        await ctx.remove(path);
        return { lines: [out(`удалено ${path}`, "ok")], cwd: ctx.cwd === path || ctx.cwd.startsWith(path + "/") ? dirname(path) : undefined };
      }
      case "mv": {
        const bad = need(2, "mv <откуда> <куда>");
        if (bad) return bad;
        const from = resolveTerminalPath(ctx.cwd, args[0]);
        let to = resolveTerminalPath(ctx.cwd, args[1]);
        if (!ctx.nodes[from]) return err(`mv: ${args[0]}: нет такого файла или папки`);
        if (ctx.nodes[to]?.type === "folder") to = joinPath(to, basename(from));
        await ctx.move(from, to);
        return { lines: [out(`${from} → ${to}`, "ok")] };
      }
      case "open": {
        const bad = need(1, "open <файл>");
        if (bad) return bad;
        const path = resolveTerminalPath(ctx.cwd, args[0]);
        if (ctx.nodes[path]?.type !== "file") return err(`open: ${args[0]}: нет такого файла`);
        ctx.open(path);
        return { lines: [out(`открыт ${path}`, "ok")] };
      }
      case "ai": {
        const bad = need(1, "ai <запрос>");
        if (bad) return bad;
        ctx.ask(args.join(" "));
        return { lines: [out("Запрос отправлен в панель агента (Chat)…", "info")] };
      }
      case "models":
        return {
          lines: [
            out("Цепочка fallback (только :free модели):", "info"),
            ...ctx.models.map((m, i) => out(`  ${i + 1}. ${m.label.padEnd(24)} ${m.id}`)),
          ],
        };
      case "status": {
        const cfg = ctx.aiStatus.configured;
        return {
          lines: [
            out(`ИИ-шлюз:  ${cfg === null ? "проверка…" : cfg ? "ключ настроен" : "ключ НЕ настроен"}`, cfg === false ? "err" : "out"),
            out(`Состояние: ${ctx.aiStatus.state}`),
            out(`Модель:    ${ctx.aiStatus.modelLabel ?? "—"}`),
          ],
        };
      }
      default:
        return err(`${cmd}: команда не найдена. Введите "help".`);
    }
  } catch (e) {
    return err(`${cmd}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
