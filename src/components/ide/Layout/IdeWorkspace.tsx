"use client";

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import { useAgentStore } from "@/lib/store/agent";
import { useIdeStore } from "@/lib/store/ide";
import { setKv } from "@/lib/db/fs";
import { AgentPanel } from "../Agent/AgentPanel";
import { EditorArea } from "../Editor/EditorArea";
import { Sidebar } from "../FileTree/Sidebar";
import { TerminalPanel } from "../Terminal/TerminalPanel";
import { ActivityBar } from "./ActivityBar";
import { BootScreen } from "./BootScreen";
import { CommandPalette } from "./CommandPalette";
import { DialogHost } from "./DialogHost";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { useIdeHotkeys } from "./useIdeHotkeys";
import { useIsMobile } from "@/lib/utils/use-mobile";
import { MobileShell } from "../Mobile/MobileShell";
import { NexusRoot } from "@/components/nexus/NexusRoot";

function HandleH() {
  return <PanelResizeHandle className="resize-handle" />;
}

export function IdeWorkspace() {
  const ready = useIdeStore((s) => s.ready);
  const firstRun = useIdeStore((s) => s.firstRun);
  const sidebar = useIdeStore((s) => s.sidebarVisible);
  const bottom = useIdeStore((s) => s.bottomVisible);
  const agent = useIdeStore((s) => s.agentVisible);
  const isMobile = useIsMobile();

  useIdeHotkeys();

  // Monaco rejects in-flight promises with "Canceled" when models/widgets are disposed — harmless noise.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: unknown = e.reason;
      const name = reason instanceof Error ? reason.name : "";
      const message = reason instanceof Error ? reason.message : String(reason);
      if (name === "Canceled" || message === "Canceled") e.preventDefault();
    };
    const onError = (e: ErrorEvent) => {
      if (e.message === "Canceled" || e.message === "Uncaught Canceled") e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  useEffect(() => {
    void useIdeStore.getState().init();
    void useAgentStore.getState().hydrate();
    const ac = new AbortController();
    fetch("/api/chat", { signal: ac.signal })
      .then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((j) => {
        useIdeStore.getState().setAi({ configured: Boolean(j.configured) });
        useIdeStore
          .getState()
          .log(
            j.configured ? "success" : "warn",
            "ai",
            j.configured
              ? "OpenRouter: ключ найден, цепочка из 7 бесплатных моделей готова"
              : "OpenRouter: OPENROUTER_API_KEY не задан — ИИ-функции недоступны",
          );
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!ready || !firstRun) return;
    const t = setTimeout(() => {
      const touch = window.matchMedia("(max-width: 860px), (pointer: coarse) and (max-height: 520px)").matches;
      toast("Добро пожаловать в Nexus IDE", {
        description: touch
          ? "Разделы — на панели внизу, поиск команд — лупа сверху."
          : "Нажмите ⌘/Ctrl+K для палитры команд и ⌘/Ctrl+L, чтобы сфокусироваться на агенте.",
        duration: touch ? 3500 : 7000,
      });
      void setKv("onboarded", true);
    }, 600);
    return () => clearTimeout(t);
  }, [ready, firstRun]);

  if (!ready) return <BootScreen />;
  if (isMobile) {
    return (
      <>
        <MobileShell />
        <NexusRoot />
      </>
    );
  }

  return (
    <div className="flex h-dvh w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <ActivityBar />
        <PanelGroup direction="horizontal" autoSaveId="nexus-layout-h" className="min-w-0 flex-1">
          {sidebar && (
            <>
              <Panel id="sidebar" order={1} defaultSize={19} minSize={12} maxSize={38} className="min-w-0">
                <Sidebar />
              </Panel>
              <HandleH />
            </>
          )}
          <Panel id="center" order={2} minSize={28} className="min-w-0">
            <PanelGroup direction="vertical" autoSaveId="nexus-layout-v">
              <Panel id="editor" order={1} minSize={20}>
                <EditorArea />
              </Panel>
              {bottom && (
                <>
                  <PanelResizeHandle className="resize-handle" />
                  <Panel id="bottom" order={2} defaultSize={28} minSize={9} maxSize={75}>
                    <TerminalPanel />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>
          {agent && (
            <>
              <HandleH />
              <Panel id="agent" order={3} defaultSize={31} minSize={22} maxSize={55} className="min-w-0">
                <AgentPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <StatusBar />
      <CommandPalette />
      <DialogHost />
      <NexusRoot />
    </div>
  );
}
