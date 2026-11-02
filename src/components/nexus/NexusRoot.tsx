"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import * as Dialog from "@radix-ui/react-dialog";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshServerStatus, takeSnapshot, workspaceFiles } from "@/lib/nexus/actions";
import { CAPABILITIES } from "@/lib/nexus/permissions";
import { registerPredictive } from "@/lib/nexus/predictive";
import { useNexus } from "@/lib/nexus/store";
import { useIdeStore } from "@/lib/store/ide";
import { getMonaco } from "./ui";

const NexusHub = dynamic(() => import("./NexusHub").then((m) => m.NexusHub), { ssr: false });

function PermissionHost() {
  const pending = useNexus((s) => s.pending);
  const resolve = useNexus((s) => s.resolvePermission);
  const p = pending[0];
  const cap = CAPABILITIES.find((c) => c.id === p?.capability);
  return (
    <Dialog.Root open={Boolean(p)} onOpenChange={(o) => !o && p && resolve(p.id, false)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/70" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[60] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-strong bg-panel p-4 shadow-2xl outline-none">
          <Dialog.Title className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="size-4 text-amber-300" />Требуется подтверждение</Dialog.Title>
          <Dialog.Description className="mt-2 text-xs text-subtle">
            {p?.agent ? `Агент «${p.agent}»` : "Nexus"} запрашивает: <b className="text-foreground">{cap?.label ?? p?.capability}</b>{cap?.dangerous && <span className="ml-1 text-amber-300">(опасная операция)</span>}
          </Dialog.Description>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-background p-2 font-mono text-[11px]">{p?.detail}</pre>
          {pending.length > 1 && <p className="mt-1 text-[10px] text-muted">Ещё в очереди: {pending.length - 1}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => p && resolve(p.id, false)}>Отклонить</Button>
            <Button size="sm" autoFocus onClick={() => p && resolve(p.id, true)}>Разрешить</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted once inside the IDE: hydrates state, hotkey, auto-snapshots, predictive provider, goto-line. */
export function NexusRoot() {
  const open = useNexus((s) => s.open);
  const hydrated = useNexus((s) => s.hydrated);
  const predictive = useNexus((s) => s.data.predictive);
  const auto = useNexus((s) => s.data.autoSnapshot);
  const ready = useIdeStore((s) => s.ready);
  const lastSig = useRef("");

  useEffect(() => {
    void useNexus.getState().hydrate();
    void refreshServerStatus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        useNexus.getState().setOpen(!useNexus.getState().open);
      }
    };
    const onGoto = (e: Event) => {
      const { line } = (e as CustomEvent<{ path: string; line: number }>).detail;
      const ed = getMonaco()?.editor.getEditors()[0];
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("nexus:goto", onGoto);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("nexus:goto", onGoto);
    };
  }, []);

  useEffect(() => {
    if (!hydrated || !ready || !auto) return;
    const sig = () => { const f = workspaceFiles(); return `${Object.keys(f).length}:${Object.values(f).reduce((n, c) => n + c.length, 0)}`; };
    lastSig.current = sig();
    const t = setInterval(() => {
      const s = sig();
      if (s !== lastSig.current) { lastSig.current = s; void takeSnapshot("Автоматический снапшот", "auto"); }
    }, 5 * 60_000);
    return () => clearInterval(t);
  }, [hydrated, ready, auto]);

  useEffect(() => {
    if (!predictive) return;
    let disposable: ReturnType<typeof registerPredictive> = null;
    const poll = setInterval(() => {
      if (disposable) return;
      disposable = registerPredictive();
      if (disposable) clearInterval(poll);
    }, 1500);
    return () => { clearInterval(poll); disposable?.dispose(); };
  }, [predictive]);

  return (
    <>
      {open && <NexusHub />}
      <PermissionHost />
    </>
  );
}
