/**
 * Pure POSIX-like path helpers for the virtual file system.
 * Paths are stored WITHOUT a leading slash ("src/index.ts"); the root is "".
 */

export function normalizePath(input: string): string {
  const parts = input.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i).toLowerCase();
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join("/"));
}

/** True when `child` lives strictly inside `parent`. */
export function isDescendant(parent: string, child: string): boolean {
  if (parent === "") return child !== "";
  return child.startsWith(parent + "/");
}

/** Returns every ancestor folder of a path: "a/b/c.ts" -> ["a", "a/b"]. */
export function ancestors(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/** Rejects names that would be invalid or escape the workspace. */
export function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Имя не может быть пустым";
  if (trimmed === "." || trimmed === "..") return "Недопустимое имя";
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'Имя содержит запрещённые символы \\ / : * ? " < > |';
  if (trimmed.length > 120) return "Слишком длинное имя";
  return null;
}

/** Produces a free sibling name: "a.ts" -> "a copy.ts" -> "a copy 2.ts". */
export function uniqueCopyPath(path: string, exists: (p: string) => boolean): string {
  const dir = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 1;
  for (;;) {
    const suffix = n === 1 ? " copy" : ` copy ${n}`;
    const candidate = joinPath(dir, `${stem}${suffix}${ext}`);
    if (!exists(candidate)) return candidate;
    n++;
  }
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".rb": "ruby",
  ".sh": "shell",
  ".bash": "shell",
  ".sql": "sql",
  ".toml": "ini",
  ".ini": "ini",
  ".env": "ini",
  ".txt": "plaintext",
};

export function languageFromPath(path: string): string {
  const name = basename(path).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name.startsWith(".env")) return "ini";
  return LANGUAGE_BY_EXT[extname(path)] ?? "plaintext";
}

const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  css: "CSS",
  scss: "SCSS",
  html: "HTML",
  python: "Python",
  rust: "Rust",
  go: "Go",
  yaml: "YAML",
  shell: "Shell",
  sql: "SQL",
  plaintext: "Plain Text",
};

export function languageLabel(language: string): string {
  return LANGUAGE_LABELS[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}
