"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Bot, FolderGit2, Globe2, Home, Layers, Presentation, Rocket, SquareTerminal, Trash2, Wrench, ExternalLink, FileCode2 } from "lucide-react";

import { NexusRoot } from "@/components/nexus/NexusRoot";
import { TOOLS, WORKSPACES } from "@/components/nexus/registry";
import { Logo } from "@/components/ide/Layout/Logo";
import { useNexus } from "@/lib/nexus/store";
import type { ProjectRecord } from "@/lib/db/schema";
import { deleteProject, ideUrl, listProjects } from "@/lib/studio/projects";
import { useIsMobile, useVisualViewportVars } from "@/lib/utils/use-mobile";
import { cn } from "@/lib/utils/cn";
import { ActivityMonitor, ControlCenter, ProjectDashboard } from "./ControlCenter";
import { DevGate } from "./DevGate";
import { VercelMonitor } from "@/components/monitor/VercelMonitor";
import { PresentationStudio } from "./PresentationStudio";
import { TelegramStudio } from "./TelegramStudio";
import { WebsiteStudio } from "./WebsiteStudio";
import { Btn, Card, Pill } from "./ui";

type View = "home" | "projects" | "agents" | "tools" | "control" | "vercel";
type StudioId = "telegram" | "website" | "presentation";

const NAV: { id: View; label: string; short?: string; icon: typeof Home; hidden?: boolean }[] = [
  { id: "home", label: "Главная", icon: Home },
  { id: "projects", label: "Проекты", icon: FolderGit2 },
  { id: "agents", label: "Агенты", icon: Bot },
  { id: "tools", label: "Инструменты", short: "Тулзы", icon: Wrench },
  { id: "control", label: "Управление", short: "Контроль", icon: Rocket },
  { id: "vercel", label: "Монитор Vercel", icon: Activity, hidden: true },
];

const STUDIOS: { id: StudioId; title: string; desc: string; icon: typeof Bot; color: string }[] = [
  { id: "telegram", title: "Telegram-боты", desc: "Генерация бота на Python или Node.js, шаблоны, webhook/polling, GitHub", icon: Bot, color: "from-sky-500/25" },
  { id: "website", title: "Сайты", desc: "Сайт по описанию, шаблоны, live preview, визуальное редактирование, деплой", icon: Globe2, color: "from-emerald-500/25" },
  { id: "presentation", title: "Презентации", desc: "Слайды по тексту, темы, режим показа, экспорт в PPTX и PDF", icon: Presentation, color: "from-fuchsia-500/25" },
];

function HomeView({ projects, onOpen, onReload }: { projects: ProjectRecord[]; onOpen: (s: StudioId) => void; onReload: () => void }) {
  void onReload;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Центр разработчика</h1>
        <p className="text-sm text-muted">Три направления и полноценная IDE. Проекты хранятся локально и открываются в редакторе Monaco.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {STUDIOS.map((s) => (
          <button key={s.id} onClick={() => onOpen(s.id)} className={cn("flex min-h-36 flex-col rounded-2xl border border-border bg-gradient-to-br to-panel-2 p-4 text-left transition-colors hover:border-accent/60", s.color)}>
            <s.icon className="size-7 text-foreground" />
            <div className="mt-3 text-lg font-semibold">{s.title}</div>
            <div className="mt-1 text-xs leading-relaxed text-subtle">{s.desc}</div>
          </button>
        ))}
      </div>
      <Card className="flex flex-wrap items-center gap-3">
        <SquareTerminal className="size-6 text-accent-soft" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">IDE: редактор, файлы, терминал, агенты</div>
          <div className="text-xs text-muted">Monaco, файловый менеджер, терминал, Director/Coder/Reviewer, diff и история изменений.</div>
        </div>
        <Link href="/code/ide" className="inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-white hover:bg-accent-soft">Открыть IDE</Link>
      </Card>
      {projects.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-subtle">Недавние проекты</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 4).map((p) => (
              <Link key={p.id} href={ideUrl(`${p.folder}/README.md`)} className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-panel-2 px-3 hover:border-accent/50">
                <FileCode2 className="size-5 shrink-0 text-accent-soft" />
                <div className="min-w-0"><div className="truncate text-sm font-medium">{p.name}</div><div className="truncate text-[11px] text-muted">{p.kind} · {p.stack}</div></div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectsView({ projects, onReload }: { projects: ProjectRecord[]; onReload: () => void }) {
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Проекты</h1>
      {projects.length === 0 && <Card className="text-sm text-muted">Проектов пока нет. Создайте бота, сайт или презентацию на вкладке «Главная».</Card>}
      {projects.map((p) => (
        <Card key={p.id} className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{p.name}</div>
              <div className="flex flex-wrap gap-1.5 pt-1"><Pill tone="accent">{p.kind}</Pill><Pill>{p.stack}</Pill><span className="text-[11px] text-muted">{p.folder}</span></div>
            </div>
            <Link href={ideUrl(`${p.folder}/${p.kind === "telegram" ? "README.md" : "README.md"}`)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border-strong px-4 text-sm text-subtle hover:bg-hover"><ExternalLink className="size-4" />Открыть</Link>
            {confirmDel === p.id ? (
              <div className="flex items-center gap-2"><span className="text-xs text-red-300">Удалить проект и файлы?</span><Btn variant="danger" onClick={async () => { await deleteProject(p); setConfirmDel(null); onReload(); }}>Да</Btn><Btn variant="ghost" onClick={() => setConfirmDel(null)}>Нет</Btn></div>
            ) : (
              <Btn variant="ghost" aria-label={`Удалить проект ${p.name}`} onClick={() => setConfirmDel(p.id)}><Trash2 className="size-4" /></Btn>
            )}
          </div>
          <ProjectDashboard project={p} onChange={onReload} />
        </Card>
      ))}
    </div>
  );
}

function ToolsView() {
  const [q, setQ] = useState("");
  const openTool = useNexus((s) => s.openTool);
  const setOpen = useNexus((s) => s.setOpen);
  const list = TOOLS.filter((t) => `${t.title} ${t.desc}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Инструменты</h1><Pill tone="accent">{TOOLS.length} инструментов</Pill>
        <Link href="/code?view=vercel" className="ml-auto inline-flex min-h-11 items-center rounded-xl border border-border-strong px-4 text-sm text-subtle hover:bg-hover">Монитор Vercel</Link><Btn onClick={() => setOpen(true)}><Layers className="size-4" />Открыть хаб</Btn>
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти инструмент…" aria-label="Поиск инструмента" className="min-h-11 w-full rounded-xl border border-border-strong bg-background px-3 text-[16px] outline-none focus:border-accent sm:text-sm" />
      {WORKSPACES.map((w) => {
        const items = list.filter((t) => t.workspace === w.id);
        if (items.length === 0) return null;
        return (
          <section key={w.id}>
            <h2 className="mb-2 text-sm font-semibold text-subtle">{w.title} <span className="font-normal text-muted">· {w.desc}</span></h2>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => (
                <button key={t.id} onClick={() => { openTool(t.workspace, t.id); setOpen(true); }} className="min-h-16 rounded-xl border border-border bg-panel-2 p-3 text-left transition-colors hover:border-accent/60">
                  <div className="text-sm font-semibold"><span className="text-muted">#{t.n}</span> {t.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-subtle">{t.desc}</div>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StudioHost({ id, onBack, onChanged }: { id: StudioId; onBack: () => void; onChanged: () => void }) {
  const meta = STUDIOS.find((s) => s.id === id);
  return (
    <div className="mx-auto w-full max-w-6xl p-3 sm:p-6">
      <button onClick={onBack} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-subtle hover:bg-hover"><ArrowLeft className="size-4" />Code Studio</button>
      <h1 className="mb-4 text-xl font-semibold">{meta?.title}</h1>
      {id === "telegram" && <TelegramStudio onChanged={onChanged} />}
      {id === "website" && <WebsiteStudio onChanged={onChanged} />}
      {id === "presentation" && <PresentationStudio />}
    </div>
  );
}

function Shell() {
  const isMobile = useIsMobile();
  useVisualViewportVars(isMobile);
  const [view, setView] = useState<View>("home");
  const [studio, setStudio] = useState<StudioId | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const reload = useCallback(() => void listProjects().then(setProjects).catch(() => undefined), []);
  useEffect(() => {
    // `?view=vercel` is used by the Vercel connect redirects (they cannot carry a #hash).
    const q = new URLSearchParams(window.location.search).get("view") as View | null;
    const h = (q ?? window.location.hash.slice(1)) as View;
    if (NAV.some((n) => n.id === h)) setView(h);
    reload();
  }, [reload]);
  const go = (v: View) => { setView(v); setStudio(null); history.replaceState(null, "", `${window.location.pathname}#${v}`); };

  const content = studio && view === "home"
    ? <StudioHost id={studio} onBack={() => setStudio(null)} onChanged={reload} />
    : view === "home" ? <HomeView projects={projects} onOpen={setStudio} onReload={reload} />
    : view === "projects" ? <ProjectsView projects={projects} onReload={reload} />
    : view === "agents" ? <div className="mx-auto w-full max-w-5xl p-4 sm:p-6"><ActivityMonitor projects={projects} /></div>
    : view === "tools" ? <ToolsView />
    : view === "vercel" ? <VercelMonitor />
    : <div className="mx-auto w-full max-w-5xl p-4 sm:p-6"><ControlCenter projects={projects} onChange={reload} /></div>;

  return (
    <div className="fixed left-0 flex w-full overflow-hidden bg-background text-foreground" style={{ top: "var(--app-top, 0px)", height: "var(--app-h, 100dvh)" }}>
      <nav className="hidden w-56 shrink-0 flex-col border-r border-border bg-panel p-3 md:flex" aria-label="Code Studio">
        <div className="mb-4 flex items-center gap-2 px-2 pt-1"><Logo className="size-6" /><span className="font-semibold">Code Studio</span></div>
        {NAV.filter((n) => !n.hidden).map((n) => (
          <button key={n.id} onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm", view === n.id ? "bg-accent/15 text-foreground" : "text-subtle hover:bg-hover")}><n.icon className="size-4" />{n.label}</button>
        ))}
        <Link href="/code/ide" className="mt-1 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm text-subtle hover:bg-hover"><SquareTerminal className="size-4" />IDE</Link>
        <Link href="/" className="mt-auto flex min-h-11 items-center gap-3 rounded-xl border border-border-strong px-3 text-sm text-subtle hover:bg-hover"><ArrowLeft className="size-4" />На главную Nexus</Link>
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 pb-2 pt-[max(8px,env(safe-area-inset-top))] md:hidden">
          <Link href="/" aria-label="Вернуться на главную Nexus" className="grid size-11 place-items-center rounded-xl text-subtle hover:bg-hover"><ArrowLeft className="size-5" /></Link>
          <Logo className="size-5" /><span className="font-semibold">Code Studio</span>
          <Link href="/code/ide" className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border-strong px-3 text-xs text-subtle"><SquareTerminal className="size-4" />IDE</Link>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">{content}</main>
        <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-panel pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Разделы Code Studio">
          {NAV.filter((n) => !n.hidden).map((n) => (
            <button key={n.id} onClick={() => go(n.id)} aria-current={view === n.id ? "page" : undefined} className={cn("flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[9.5px] font-medium", view === n.id ? "text-foreground" : "text-muted")}>
              <n.icon className={cn("size-5", view === n.id && "text-accent-soft")} />{n.short ?? n.label}
            </button>
          ))}
        </nav>
      </div>
      <NexusRoot />
    </div>
  );
}

export function CodeStudio() {
  return (
    <DevGate>
      <Shell />
    </DevGate>
  );
}
