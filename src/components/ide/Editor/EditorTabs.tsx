"use client";

import { useEffect, useRef } from "react";
import { GitCompare, X } from "lucide-react";
import { useIdeStore } from "@/lib/store/ide";
import { basename, dirname } from "@/lib/utils/path";
import { cn } from "@/lib/utils/cn";
import { FileIcon } from "../FileTree/FileIcon";

export function EditorTabs() {
  const openTabs = useIdeStore((s) => s.openTabs);
  const activePath = useIdeStore((s) => s.activePath);
  const diffView = useIdeStore((s) => s.diffView);
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [activePath, diffView]);

  if (openTabs.length === 0 && !diffView) {
    return <div className="h-9 mobile:h-11 shrink-0 border-b border-border bg-panel" />;
  }

  const names = openTabs.map(basename);

  return (
    <div
      role="tablist"
      aria-label="Открытые файлы"
      className="flex h-9 mobile:h-11 shrink-0 items-stretch overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border bg-panel [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {openTabs.map((path, i) => {
        const active = !diffView && activePath === path;
        const duplicate = names.filter((n) => n === names[i]).length > 1;
        return (
          <div
            key={path}
            ref={active ? activeRef : undefined}
            role="tab"
            aria-selected={active}
            tabIndex={0}
            onClick={() => useIdeStore.getState().setActive(path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") useIdeStore.getState().setActive(path);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                useIdeStore.getState().closeTab(path);
              }
            }}
            title={path}
            className={cn(
              "group relative flex min-w-0 max-w-[220px] mobile:max-w-[60vw] shrink-0 cursor-pointer items-center gap-2 border-r border-border px-3 text-xs mobile:text-[13px] outline-none transition-colors",
              active
                ? "bg-background text-foreground"
                : "text-muted hover:bg-hover/60 hover:text-subtle focus-visible:bg-hover/60",
            )}
          >
            {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
            <FileIcon path={path} className="size-3.5" />
            <span className="truncate">{names[i]}</span>
            {duplicate && <span className="truncate text-[10px] text-muted">{dirname(path)}</span>}
            <button
              aria-label={`Закрыть ${names[i]}`}
              onClick={(e) => {
                e.stopPropagation();
                useIdeStore.getState().closeTab(path);
              }}
              className={cn(
                "ml-1 grid size-4 mobile:size-8 mobile:-mr-2 shrink-0 place-items-center rounded transition-all hover:bg-border-strong",
                active ? "opacity-70" : "opacity-0 mobile:opacity-60 group-hover:opacity-70 focus-visible:opacity-100",
              )}
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
      {diffView && (
        <div
          ref={activeRef}
          role="tab"
          aria-selected
          className="relative flex shrink-0 items-center gap-2 border-r border-border bg-background px-3 text-xs text-foreground animate-fade-in"
        >
          <span className="absolute inset-x-0 top-0 h-px bg-role-reviewer" />
          <GitCompare className="size-3.5 text-role-reviewer" />
          <span className="max-w-[160px] truncate">Diff: {basename(diffView.path)}</span>
          <button
            aria-label="Закрыть diff"
            onClick={() => useIdeStore.getState().setDiffView(null)}
            className="ml-1 grid size-4 mobile:size-8 place-items-center rounded opacity-70 hover:bg-border-strong"
          >
            <X className="size-3" />
          </button>
        </div>
      )}
    </div>
  );
}
