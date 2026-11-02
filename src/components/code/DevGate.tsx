"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Code2 } from "lucide-react";
import { Logo } from "@/components/ide/Layout/Logo";
import { useSettings } from "@/lib/settings/store";

/** Renders children only while Developer Mode is enabled; otherwise offers to enable it. */
export function DevGate({ children }: { children: React.ReactNode }) {
  const hydrated = useSettings((s) => s.hydrated);
  const devMode = useSettings((s) => s.devMode);
  useEffect(() => useSettings.getState().hydrate(), []);

  if (!hydrated) return <div className="fixed inset-0 grid place-items-center bg-background"><Logo className="size-10 animate-pulse" /></div>;
  if (!devMode) {
    return (
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-background p-4 text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-border-strong bg-panel p-6 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent-soft"><Code2 className="size-6" /></div>
          <h1 className="mt-4 text-xl font-semibold">Режим разработчика выключен</h1>
          <p className="mt-2 text-sm text-muted">Это расширенный раздел для тех, кто работает с кодом: редактор, файлы, терминал, GitHub и Vercel. Если включить режим, ваши проекты и переписки останутся на месте. Выключить его можно в любой момент в «Настройках».</p>
          <button onClick={() => useSettings.getState().set({ devMode: true })} className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-accent text-sm font-medium text-white hover:bg-accent-soft">Включить режим разработчика</button>
          <Link href="/" className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm text-subtle hover:bg-hover"><ArrowLeft className="size-4" />Вернуться на главную</Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
