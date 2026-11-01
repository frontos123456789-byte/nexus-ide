"use client";

import { useState } from "react";
import { DiffEditor, type BeforeMount } from "@monaco-editor/react";
import { Check, Columns2, Rows2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { applyProposal, rejectProposal } from "@/lib/store/agent-actions";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore } from "@/lib/store/ide";
import { diffStats } from "@/lib/utils/diff";
import { languageFromPath } from "@/lib/utils/path";
import { cn } from "@/lib/utils/cn";
import { useIsMobile } from "@/lib/utils/use-mobile";
import { FileIcon } from "../FileTree/FileIcon";
import { EditorSkeleton } from "./EditorSkeleton";
import { configureLanguages, configureMonacoLoader, defineNexusTheme, NEXUS_THEME } from "./monaco-setup";

configureMonacoLoader();

export function DiffViewer({ runId, path }: { runId: string; path: string }) {
  const proposal = useAgentStore((s) => s.runs.find((r) => r.id === runId)?.proposals.find((p) => p.path === path));
  const [split, setSplit] = useState(true);
  const isMobile = useIsMobile();

  const beforeMount: BeforeMount = (monaco) => {
    defineNexusTheme(monaco);
    configureLanguages(monaco);
  };

  if (!proposal) {
    return (
      <div className="grid h-full place-items-center text-xs text-muted">
        Предложение не найдено. Возможно, история Code-запусков была очищена.
      </div>
    );
  }

  const stats = diffStats(proposal.original, proposal.content);
  const isNew = proposal.original === null;

  return (
    <div className="flex h-full flex-col animate-fade-in">
      <div className="flex h-10 mobile:h-auto mobile:flex-wrap mobile:gap-x-2 mobile:gap-y-2 mobile:py-2 shrink-0 items-center gap-3 border-b border-border bg-panel px-3">
        <FileIcon path={proposal.path} />
        <span className="truncate text-xs font-medium text-foreground mobile:min-w-0 mobile:flex-1">{proposal.path}</span>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            isNew ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300",
          )}
        >
          {isNew ? "Новый" : "Изменён"}
        </span>
        <span className="font-mono text-[11px]">
          <span className="text-emerald-400">+{stats.added}</span> <span className="text-red-400">−{stats.removed}</span>
        </span>
        {proposal.status !== "pending" && (
          <span className="text-[11px] text-muted">{proposal.status === "applied" ? "· применено" : "· отклонено"}</span>
        )}
        <div className="ml-auto flex items-center gap-1.5 mobile:w-full mobile:justify-end">
          <Button variant="ghost" size="icon" className="mobile:hidden" onClick={() => setSplit((v) => !v)} aria-label="Переключить вид diff" title="Переключить вид">
            {split ? <Rows2 className="size-3.5" /> : <Columns2 className="size-3.5" />}
          </Button>
          {proposal.status === "pending" && (
            <>
              <Button variant="outline" size="sm" onClick={() => rejectProposal(runId, path)}>
                <X className="size-3.5" /> Отклонить
              </Button>
              <Button size="sm" onClick={() => void applyProposal(runId, path)}>
                <Check className="size-3.5" /> Применить
              </Button>
            </>
          )}
          <Button variant="ghost" size="icon" onClick={() => useIdeStore.getState().setDiffView(null)} aria-label="Закрыть diff">
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <DiffEditor
          height="100%"
          original={proposal.original ?? ""}
          modified={proposal.content}
          language={languageFromPath(proposal.path)}
          originalModelPath={`inmemory://diff/original/${runId}/${proposal.path}`}
          modifiedModelPath={`inmemory://diff/modified/${runId}/${proposal.path}`}
          theme={NEXUS_THEME}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          loading={<EditorSkeleton />}
          beforeMount={beforeMount}
          options={{
            readOnly: true,
            originalEditable: false,
            renderSideBySide: split && !isMobile,
            automaticLayout: true,
            fontSize: isMobile ? 14 : 13,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 10 },
            renderOverviewRuler: false,
            smoothScrolling: true,
            enableSplitViewResizing: true,
          }}
        />
      </div>
    </div>
  );
}
