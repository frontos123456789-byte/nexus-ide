"use client";

import { ChevronRight } from "lucide-react";
import { useIdeStore } from "@/lib/store/ide";
import { FileIcon } from "../FileTree/FileIcon";

export function Breadcrumbs({ path }: { path: string }) {
  const parts = path.split("/");
  return (
    <nav
      aria-label="Путь к файлу"
      className="flex h-6 mobile:h-7 shrink-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border bg-background px-3 text-[11px] text-muted"
    >
      {parts.map((part, i) => {
        const full = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={full} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3 shrink-0 opacity-50" />}
            <button
              onClick={() => {
                const s = useIdeStore.getState();
                s.select(full);
                if (!last) {
                  s.setExpanded(full, true);
                  s.setSidebarVisible(true);
                }
              }}
              className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-hover hover:text-foreground data-[last=true]:text-subtle"
              data-last={last}
            >
              {last && <FileIcon path={path} className="size-3" />}
              <span className="truncate">{part}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}
