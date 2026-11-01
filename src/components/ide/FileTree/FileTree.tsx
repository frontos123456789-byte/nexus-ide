"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight, Copy, FilePlus2, FolderPlus, Pencil, Trash2, CopyPlus } from "lucide-react";
import { toast } from "sonner";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { confirmDelete, promptNewFile, promptNewFolder, renameTo } from "@/lib/store/file-actions";
import { useIdeStore } from "@/lib/store/ide";
import { basename, dirname, isDescendant, joinPath, validateName } from "@/lib/utils/path";
import { buildRows, type TreeRow } from "@/lib/utils/tree-model";
import { cn } from "@/lib/utils/cn";
import { FileIcon } from "./FileIcon";

const ROW_HEIGHT = 24;
const DND_TYPE = "text/nexus-path";

function RenameInput({ row, onDone }: { row: TreeRow; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(row.name);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = row.type === "file" ? row.name.lastIndexOf(".") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : row.name.length);
  }, [row]);

  const commit = async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const name = value.trim();
    if (name === row.name) return onDone();
    const problem = validateName(name);
    if (problem) {
      toast.error(problem);
      return onDone();
    }
    await renameTo(row.path, joinPath(dirname(row.path), name));
    onDone();
  };

  return (
    <input
      ref={ref}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void commit();
        if (e.key === "Escape") {
          doneRef.current = true;
          onDone();
        }
      }}
      className="h-5 min-w-0 flex-1 rounded-sm border border-accent bg-background px-1 text-xs text-foreground outline-none"
    />
  );
}

export function FileTree() {
  const nodes = useIdeStore((s) => s.nodes);
  const expanded = useIdeStore((s) => s.expanded);
  const selectedPath = useIdeStore((s) => s.selectedPath);
  const activePath = useIdeStore((s) => s.activePath);
  const rows = useMemo(() => buildRows(nodes, expanded), [nodes, expanded]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is safe here
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  // Keep the selected row visible (e.g. after Cmd+P).
  useEffect(() => {
    if (!selectedPath) return;
    const idx = rows.findIndex((r) => r.path === selectedPath);
    if (idx !== -1) virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [selectedPath, rows, virtualizer]);

  const store = useIdeStore.getState;

  const activate = (row: TreeRow) => {
    store().select(row.path);
    if (row.type === "folder") store().toggleFolder(row.path);
    else store().openFile(row.path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (renaming) return;
    const idx = rows.findIndex((r) => r.path === selectedPath);
    const row = idx >= 0 ? rows[idx] : undefined;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (rows[idx + 1]) store().select(rows[idx + 1].path);
        else if (idx === -1 && rows[0]) store().select(rows[0].path);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (idx > 0) store().select(rows[idx - 1].path);
        break;
      case "ArrowRight":
        if (row?.type === "folder") {
          e.preventDefault();
          if (!row.expanded) store().setExpanded(row.path, true);
          else if (rows[idx + 1]) store().select(rows[idx + 1].path);
        }
        break;
      case "ArrowLeft":
        if (row) {
          e.preventDefault();
          if (row.type === "folder" && row.expanded) store().setExpanded(row.path, false);
          else if (dirname(row.path)) store().select(dirname(row.path));
        }
        break;
      case "Enter":
        if (row) {
          e.preventDefault();
          activate(row);
        }
        break;
      case "F2":
        if (row) {
          e.preventDefault();
          setRenaming(row.path);
        }
        break;
      case "Delete":
      case "Backspace":
        if (row && (e.key === "Delete" || e.metaKey)) {
          e.preventDefault();
          void confirmDelete(row.path);
        }
        break;
    }
  };

  const handleDrop = async (e: React.DragEvent, destDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const from = e.dataTransfer.getData(DND_TYPE);
    if (!from) return;
    const to = joinPath(destDir, basename(from));
    if (to === from || isDescendant(from, to) || to === from) return;
    if (nodes[to]) {
      toast.error(`«${basename(to)}» уже существует в целевой папке`);
      return;
    }
    await renameTo(from, to);
    if (destDir) store().setExpanded(destDir, true);
  };

  const dirFor = (row: TreeRow) => (row.type === "folder" ? row.path : dirname(row.path));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollRef}
          role="tree"
          aria-label="Файлы проекта"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DND_TYPE)) {
              e.preventDefault();
              setDropTarget("");
            }
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setDropTarget(null);
          }}
          onDrop={(e) => void handleDrop(e, "")}
          className={cn(
            "h-full overflow-y-auto overflow-x-hidden outline-none transition-colors",
            dropTarget === "" && "bg-accent/5",
          )}
        >
          {rows.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted">
              Проект пуст.
              <br />
              Правый клик → «Новый файл».
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {virtualizer.getVirtualItems().map((v) => {
                const row = rows[v.index];
                const selected = selectedPath === row.path;
                const active = activePath === row.path;
                return (
                  <ContextMenu key={row.path}>
                    <ContextMenuTrigger asChild>
                      <div
                        role="treeitem"
                        aria-selected={selected}
                        aria-expanded={row.type === "folder" ? row.expanded : undefined}
                        draggable={renaming !== row.path}
                        onContextMenu={(e) => {
                          e.stopPropagation();
                          store().select(row.path);
                        }}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DND_TYPE, row.path);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes(DND_TYPE)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTarget(dirFor(row));
                        }}
                        onDrop={(e) => void handleDrop(e, dirFor(row))}
                        onClick={() => activate(row)}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: ROW_HEIGHT,
                          transform: `translateY(${v.start}px)`,
                          paddingLeft: 8 + row.depth * 12,
                        }}
                        className={cn(
                          "group flex cursor-pointer items-center gap-1 pr-2 text-xs text-subtle transition-colors hover:bg-hover hover:text-foreground",
                          active && "text-foreground",
                          selected && "bg-accent/15 text-foreground hover:bg-accent/20",
                          dropTarget === dirFor(row) && dropTarget !== "" && row.type === "folder" && "bg-accent/20 outline outline-1 -outline-offset-1 outline-accent/60",
                        )}
                      >
                        <ChevronRight
                          className={cn(
                            "size-3.5 shrink-0 text-muted transition-transform duration-150",
                            row.expanded && "rotate-90",
                            row.type === "file" && "invisible",
                          )}
                        />
                        <FileIcon path={row.path} type={row.type} open={row.expanded} />
                        {renaming === row.path ? (
                          <RenameInput row={row} onDone={() => setRenaming(null)} />
                        ) : (
                          <span className="truncate">{row.name}</span>
                        )}
                      </div>
                    </ContextMenuTrigger>
                    <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
                      <ContextMenuItem onSelect={() => void promptNewFile(dirFor(row))}>
                        <FilePlus2 /> Новый файл
                      </ContextMenuItem>
                      <ContextMenuItem onSelect={() => void promptNewFolder(dirFor(row))}>
                        <FolderPlus /> Новая папка
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem shortcut="F2" onSelect={() => setTimeout(() => setRenaming(row.path), 50)}>
                        <Pencil /> Переименовать
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          void store()
                            .duplicateEntry(row.path)
                            .catch((err: unknown) => toast.error("Не удалось дублировать", { description: String(err) }));
                        }}
                      >
                        <CopyPlus /> Дублировать
                      </ContextMenuItem>
                      <ContextMenuItem
                        onSelect={() => {
                          void navigator.clipboard?.writeText(row.path).then(() => toast.success("Путь скопирован", { duration: 1200 }));
                        }}
                      >
                        <Copy /> Копировать путь
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem danger shortcut="Del" onSelect={() => void confirmDelete(row.path)}>
                        <Trash2 /> Удалить
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => void promptNewFile("")}>
          <FilePlus2 /> Новый файл
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void promptNewFolder("")}>
          <FolderPlus /> Новая папка
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
