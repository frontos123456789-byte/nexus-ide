"use client";

import { ChevronsDownUp, FilePlus2, FolderPlus } from "lucide-react";
import { Tip } from "@/components/ui/tooltip";
import { promptNewFile, promptNewFolder } from "@/lib/store/file-actions";
import { useIdeStore } from "@/lib/store/ide";
import { dirname } from "@/lib/utils/path";
import { FileTree } from "./FileTree";

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tip label={label}>
      <button
        onClick={onClick}
        aria-label={label}
        className="grid size-6 place-items-center rounded text-muted transition-colors hover:bg-hover hover:text-foreground"
      >
        {children}
      </button>
    </Tip>
  );
}

function targetDir(): string {
  const s = useIdeStore.getState();
  const sel = s.selectedPath;
  if (!sel) return "";
  return s.nodes[sel]?.type === "folder" ? sel : dirname(sel);
}

export function Sidebar() {
  const count = useIdeStore((s) => Object.keys(s.nodes).length);
  return (
    <aside className="flex h-full min-w-0 flex-col bg-panel" aria-label="Проводник">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Проводник</span>
        <div className="flex items-center">
          <IconButton label="Новый файл" onClick={() => void promptNewFile(targetDir())}>
            <FilePlus2 className="size-3.5" />
          </IconButton>
          <IconButton label="Новая папка" onClick={() => void promptNewFolder(targetDir())}>
            <FolderPlus className="size-3.5" />
          </IconButton>
          <IconButton label="Свернуть всё" onClick={() => useIdeStore.getState().collapseAll()}>
            <ChevronsDownUp className="size-3.5" />
          </IconButton>
        </div>
      </div>
      <div className="flex h-6 shrink-0 items-center px-3 text-[11px] font-semibold uppercase tracking-wide text-subtle">
        <span className="truncate">nexus-demo</span>
        <span className="ml-auto font-normal normal-case text-muted">{count}</span>
      </div>
      <div className="min-h-0 flex-1">
        <FileTree />
      </div>
    </aside>
  );
}
