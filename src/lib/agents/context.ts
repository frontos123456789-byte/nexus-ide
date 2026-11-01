import { basename } from "@/lib/utils/path";

export interface ContextFile {
  path: string;
  content: string;
}

export interface ProjectContext {
  /** Every file path in the workspace. */
  tree: string[];
  /** Files whose content is included (budget-limited). */
  files: ContextFile[];
  activePath?: string;
}

export interface ContextLimits {
  maxTotalChars: number;
  maxFileChars: number;
  maxTreeEntries: number;
}

export const CONTEXT_LIMITS: ContextLimits = {
  maxTotalChars: 24_000,
  maxFileChars: 8_000,
  maxTreeEntries: 200,
};

/** Enforces limits: active file first, then the rest while budget remains. */
export function trimContext(ctx: ProjectContext, limits: ContextLimits = CONTEXT_LIMITS): ProjectContext {
  const tree = ctx.tree.slice(0, limits.maxTreeEntries);
  const ordered = [...ctx.files].sort((a, b) => {
    if (a.path === ctx.activePath) return -1;
    if (b.path === ctx.activePath) return 1;
    return 0;
  });
  const files: ContextFile[] = [];
  let used = 0;
  for (const f of ordered) {
    const remaining = limits.maxTotalChars - used;
    if (remaining <= 200) break;
    const cap = Math.min(limits.maxFileChars, remaining);
    const content = f.content.length > cap ? `${f.content.slice(0, cap)}\n… [обрезано]` : f.content;
    files.push({ path: f.path, content });
    used += content.length;
  }
  return { tree, files, activePath: ctx.activePath };
}

/** Client-side: choose which files to ship (active + open tabs first). */
export function pickContextFiles(
  contents: Record<string, string>,
  activePath: string | undefined,
  openPaths: string[],
): ProjectContext {
  const tree = Object.keys(contents).sort();
  const priority = [activePath, ...openPaths].filter((p): p is string => !!p && p in contents);
  const unique = Array.from(new Set(priority));
  const files = unique.map((path) => ({ path, content: contents[path] }));
  return trimContext({ tree, files, activePath });
}

export function renderContext(ctx: ProjectContext): string {
  const lines: string[] = [];
  lines.push("## Файлы проекта");
  lines.push(ctx.tree.length ? ctx.tree.map((p) => `- ${p}`).join("\n") : "(проект пуст)");
  if (ctx.files.length) {
    lines.push("", "## Содержимое файлов");
    for (const f of ctx.files) {
      const marker = f.path === ctx.activePath ? " (активный файл)" : "";
      lines.push(`### ${f.path}${marker}`, "```" + extFence(f.path), f.content, "```");
    }
  }
  return lines.join("\n");
}

function extFence(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}
