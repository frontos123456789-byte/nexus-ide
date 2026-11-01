import {
  Braces,
  File,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Palette,
  Settings2,
  Terminal as TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import { basename, extname } from "@/lib/utils/path";
import { cn } from "@/lib/utils/cn";

interface IconSpec {
  icon: LucideIcon;
  color: string;
}

const BY_EXT: Record<string, IconSpec> = {
  ".ts": { icon: FileCode2, color: "text-sky-400" },
  ".tsx": { icon: FileCode2, color: "text-cyan-400" },
  ".js": { icon: FileCode2, color: "text-yellow-400" },
  ".jsx": { icon: FileCode2, color: "text-yellow-300" },
  ".mjs": { icon: FileCode2, color: "text-yellow-400" },
  ".json": { icon: Braces, color: "text-amber-400" },
  ".md": { icon: FileText, color: "text-slate-300" },
  ".mdx": { icon: FileText, color: "text-slate-300" },
  ".css": { icon: Palette, color: "text-indigo-400" },
  ".scss": { icon: Palette, color: "text-pink-400" },
  ".html": { icon: FileCode2, color: "text-orange-400" },
  ".py": { icon: FileCode2, color: "text-emerald-400" },
  ".sh": { icon: TerminalIcon, color: "text-green-400" },
  ".yml": { icon: Settings2, color: "text-rose-300" },
  ".yaml": { icon: Settings2, color: "text-rose-300" },
  ".svg": { icon: ImageIcon, color: "text-fuchsia-400" },
  ".png": { icon: ImageIcon, color: "text-fuchsia-400" },
  ".sql": { icon: Hash, color: "text-blue-300" },
  ".txt": { icon: FileText, color: "text-zinc-400" },
};

export function FileIcon({
  path,
  type = "file",
  open = false,
  className,
}: {
  path: string;
  type?: "file" | "folder";
  open?: boolean;
  className?: string;
}) {
  if (type === "folder") {
    const Icon = open ? FolderOpen : Folder;
    return <Icon className={cn("size-4 shrink-0 text-indigo-300/80", className)} />;
  }
  const name = basename(path).toLowerCase();
  const spec =
    name === "package.json"
      ? { icon: Braces, color: "text-emerald-400" }
      : name.startsWith(".env")
        ? { icon: Settings2, color: "text-yellow-300" }
        : (BY_EXT[extname(path)] ?? { icon: File, color: "text-zinc-400" });
  const Icon = spec.icon;
  return <Icon className={cn("size-4 shrink-0", spec.color, className)} />;
}
