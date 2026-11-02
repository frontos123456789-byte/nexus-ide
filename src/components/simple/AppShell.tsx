"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Home, MessageCircle, PlusCircle, Settings, Code2 } from "lucide-react";
import { Logo } from "@/components/ide/Layout/Logo";
import { useSettings } from "@/lib/settings/store";
import { useVisualViewportVars } from "@/lib/utils/use-mobile";
import { cn } from "@/lib/utils/cn";

const NAV = [
  { href: "/", label: "Главная", icon: Home, match: (p: string) => p === "/" },
  { href: "/create", label: "Создать", icon: PlusCircle, match: (p: string) => p.startsWith("/create") },
  { href: "/projects", label: "Мои проекты", short: "Проекты", icon: FolderOpen, match: (p: string) => p.startsWith("/projects") },
  { href: "/chat", label: "AI-чат", icon: MessageCircle, match: (p: string) => p.startsWith("/chat") },
  { href: "/settings", label: "Настройки", icon: Settings, match: (p: string) => p.startsWith("/settings") },
] as const;

/** True while the on-screen keyboard is open — the bottom bar then gets out of the way of the input. */
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const check = () => setOpen(window.innerHeight - vv.height > 150);
    check();
    vv.addEventListener("resize", check);
    return () => vv.removeEventListener("resize", check);
  }, []);
  return open;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const devMode = useSettings((s) => s.devMode);
  const keyboard = useKeyboardOpen();
  useVisualViewportVars(true);
  const chat = pathname.startsWith("/chat");

  return (
    <div className="fixed left-0 flex w-full flex-col overflow-hidden bg-background text-foreground md:flex-row" style={{ top: "var(--app-top, 0px)", height: "var(--app-h, 100dvh)" }}>
      <a href="#main" className="sr-only z-[90] rounded-xl bg-white px-4 py-3 text-base font-bold text-black focus:not-sr-only focus:absolute focus:left-3 focus:top-3">Перейти к содержимому</a>

      <nav className="hidden w-64 shrink-0 flex-col border-r border-border-strong bg-panel p-4 md:flex" aria-label="Главное меню">
        <Link href="/" className="mb-6 flex items-center gap-3 rounded-xl px-2 py-1.5">
          <Logo className="size-9" />
          <span className="text-xl font-bold tracking-tight">Nexus</span>
        </Link>
        <ul className="space-y-1.5">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <li key={n.href}>
                <Link href={n.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-[3.25rem] items-center gap-3 rounded-2xl px-4 text-[1.0625rem] font-semibold", active ? "bg-indigo-500/20 text-white" : "text-subtle hover:bg-hover hover:text-foreground")}>
                  <n.icon className={cn("size-6", active && "text-indigo-300")} aria-hidden />
                  {n.label}
                </Link>
              </li>
            );
          })}
        </ul>
        {devMode && (
          <Link href="/code" className="mt-auto flex min-h-[3.25rem] items-center gap-3 rounded-2xl border-2 border-border-strong px-4 text-[1.0625rem] font-semibold text-subtle hover:bg-hover">
            <Code2 className="size-6" aria-hidden />Режим разработчика
          </Link>
        )}
      </nav>

      <main id="main" tabIndex={-1} className={cn("min-h-0 min-w-0 flex-1 outline-none", chat ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden overscroll-contain")}>
        {children}
      </main>

      <nav className={cn("shrink-0 border-t-2 border-border-strong bg-panel pb-[env(safe-area-inset-bottom)] md:hidden", keyboard && "hidden")} aria-label="Главное меню">
        <ul className="grid grid-cols-5">
          {NAV.map((n) => {
            const active = n.match(pathname);
            return (
              <li key={n.href} className="min-w-0">
                <Link href={n.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-[4rem] flex-col items-center justify-center gap-1 px-0.5 text-[0.8125rem] font-semibold leading-tight", active ? "text-white" : "text-muted")}>
                  <span className={cn("grid h-8 w-14 place-items-center rounded-full", active && "bg-indigo-500/30")}>
                    <n.icon className={cn("size-6", active && "text-indigo-200")} aria-hidden />
                  </span>
                  <span className="max-w-full truncate">{"short" in n ? n.short : n.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
