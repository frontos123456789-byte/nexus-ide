"use client";

import { useEffect } from "react";
import { IdeClient } from "@/components/ide/Layout/IdeClient";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore } from "@/lib/store/ide";
import { logActivity } from "@/lib/studio/projects";
import { DevGate } from "./DevGate";

/** Journals REAL events of the Nexus IDE agents (runs, status changes, applied proposals) for the Activity Monitor. */
function useAgentJournal() {
  useEffect(() => {
    const unsub = useAgentStore.subscribe((s, prev) => {
      if (!prev.hydrated) return;
      for (const r of s.runs) {
        const p = prev.runs.find((x) => x.id === r.id);
        if (!p) void logActivity({ agent: "Director (Code)", kind: "task", title: `Задача запущена: ${r.task.slice(0, 80)}` });
        else if (p.status !== r.status && r.status !== "running") void logActivity({ agent: "Director (Code)", kind: r.status === "error" ? "error" : "task", title: `Задача ${r.status === "done" ? "завершена" : r.status === "error" ? "завершилась ошибкой" : "отменена"}: ${r.task.slice(0, 60)}`, detail: r.error });
        if (p) for (const pr of r.proposals) if (pr.status === "applied" && p.proposals.find((q) => q.path === pr.path)?.status === "pending") void logActivity({ agent: "Coder", kind: "file", title: `Применены изменения: ${pr.path}` });
      }
      for (const ss of s.sessions) {
        const p = prev.sessions.find((x) => x.id === ss.id);
        if (!p) void logActivity({ agent: "Work (IDE)", kind: "task", title: `План: ${ss.goal.slice(0, 80)}` });
      }
    });
    return unsub;
  }, []);
}

function Inner() {
  useAgentJournal();
  const ready = useIdeStore((s) => s.ready);
  useEffect(() => {
    if (!ready) return;
    const open = new URLSearchParams(window.location.search).get("open");
    if (open) useIdeStore.getState().openFile(open);
  }, [ready]);
  return <IdeClient />;
}

export function IdeGate() {
  return (
    <DevGate>
      <Inner />
    </DevGate>
  );
}
