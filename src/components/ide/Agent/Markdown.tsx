"use client";

import { isValidElement, memo, useState, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { Check, Copy, FilePlus2, TextCursorInput } from "lucide-react";
import { toast } from "sonner";
import { insertAtCursor } from "@/lib/store/editor-bridge";
import { useIdeStore } from "@/lib/store/ide";
import { cn } from "@/lib/utils/cn";

const EXT_BY_LANG: Record<string, string> = {
  typescript: "ts",
  ts: "ts",
  tsx: "tsx",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  json: "json",
  css: "css",
  html: "html",
  python: "py",
  py: "py",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  markdown: "md",
  md: "md",
  yaml: "yml",
  yml: "yml",
  sql: "sql",
  rust: "rs",
  go: "go",
};

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Array.isArray(children) ? children[0] : children;
  const className = isValidElement<{ className?: string }>(child) ? (child.props.className ?? "") : "";
  const lang = /language-([\w+#-]+)/.exec(className)?.[1] ?? "text";
  const code = textOf(children).replace(/\n$/, "");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const insert = () => {
    if (!insertAtCursor(code)) toast.info("Откройте файл в редакторе, чтобы вставить код");
    else toast.success("Код вставлен в редактор", { duration: 1400 });
  };

  const createFile = async () => {
    const ext = EXT_BY_LANG[lang.toLowerCase()] ?? "txt";
    const nodes = useIdeStore.getState().nodes;
    let n = 1;
    while (nodes[`snippet-${n}.${ext}`]) n++;
    const path = `snippet-${n}.${ext}`;
    try {
      await useIdeStore.getState().createFile(path, code + "\n");
      toast.success(`Создан ${path}`, { duration: 1600 });
    } catch (err) {
      toast.error("Не удалось создать файл", { description: String(err) });
    }
  };

  const btn =
    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-border-strong hover:text-foreground";

  return (
    <div className="group/code my-2.5 overflow-hidden rounded-lg border border-border-strong bg-[#0b0b0d]">
      <div className="flex h-7 items-center justify-between border-b border-border bg-panel px-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">{lang}</span>
        <div className="flex items-center gap-0.5">
          <button onClick={insert} className={btn} aria-label="Вставить в редактор">
            <TextCursorInput className="size-3" /> Вставить
          </button>
          <button onClick={() => void createFile()} className={btn} aria-label="Создать файл из кода">
            <FilePlus2 className="size-3" /> Файл
          </button>
          <button onClick={() => void copy()} className={cn(btn, copied && "text-emerald-400")} aria-label="Копировать код">
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? "Скопировано" : "Копировать"}
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-3">{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
};

const rehypePlugins = [[rehypeHighlight, { detect: false, ignoreMissing: true }]] as NonNullable<
  React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"]
>;
const remarkPlugins = [remarkGfm];

export const Markdown = memo(function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("md", className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
