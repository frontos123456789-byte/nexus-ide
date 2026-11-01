"use client";

import dynamic from "next/dynamic";
import { useIdeStore } from "@/lib/store/ide";
import { Breadcrumbs } from "./Breadcrumbs";
import { EditorSkeleton } from "./EditorSkeleton";
import { EditorTabs } from "./EditorTabs";
import { WelcomeScreen } from "./WelcomeScreen";

// Monaco is lazy-loaded and never rendered on the server.
const MonacoEditor = dynamic(() => import("./MonacoEditor").then((m) => m.MonacoEditor), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
const DiffViewer = dynamic(() => import("./DiffViewer").then((m) => m.DiffViewer), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

export function EditorArea() {
  const activePath = useIdeStore((s) => s.activePath);
  const diffView = useIdeStore((s) => s.diffView);
  const exists = useIdeStore((s) => (s.activePath ? s.nodes[s.activePath]?.type === "file" : false));

  return (
    <section className="flex h-full min-w-0 flex-col bg-background" aria-label="Редактор">
      <EditorTabs />
      {diffView ? (
        <div className="min-h-0 flex-1">
          <DiffViewer runId={diffView.runId} path={diffView.path} />
        </div>
      ) : activePath && exists ? (
        <>
          <Breadcrumbs path={activePath} />
          <div className="relative min-h-0 flex-1">
            <MonacoEditor path={activePath} />
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1">
          <WelcomeScreen />
        </div>
      )}
    </section>
  );
}
