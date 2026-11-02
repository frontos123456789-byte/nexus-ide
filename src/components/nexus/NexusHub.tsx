"use client";

import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Bot, ChevronLeft, Code, Gauge, Palette, Search, Settings, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshServerStatus } from "@/lib/nexus/actions";
import { useNexus, type WorkspaceId } from "@/lib/nexus/store";
import { cn } from "@/lib/utils/cn";
import { TOOLS, WORKSPACES } from "./registry";
import { Badge, Card, Field, Note, inputCls } from "./ui";

const ICONS: Record<WorkspaceId, React.ReactNode> = {
  agents: <Bot className="size-4" />,
  intelligence: <Code className="size-4" />,
  visual: <Palette className="size-4" />,
  devtools: <Wrench className="size-4" />,
  control: <Gauge className="size-4" />,
};

function FeatureRow({ ok, label, need }: { ok?: boolean; label: string; need: string }) {
  return (
    <li className="flex items-center gap-2 text-xs"><Badge tone={ok ? "ok" : "warn"}>{ok ? "настроено" : "нет"}</Badge><b>{label}</b>{!ok && <code className="text-[10px] text-muted">{need}</code>}</li>
  );
}

function SettingsView() {
  const adminKey = useNexus((s) => s.data.adminKey);
  const project = useNexus((s) => s.data.project);
  const server = useNexus((s) => s.server);
  const patch = useNexus((s) => s.patch);
  return (
    <div className="space-y-3">
      <Card title="Доступ к серверным инструментам">
        <Field label="Ключ доступа Nexus (NEXUS_ADMIN_KEY)" hint="Нужен для БД, API-прокси, деплоя, Docker, Figma, Git и проверки окружения. Хранится только в IndexedDB этого браузера и отправляется в заголовке x-nexus-key.">
          <input type="password" autoComplete="off" className={inputCls} value={adminKey} onChange={(e) => patch({ adminKey: e.target.value })} />
        </Field>
        {server && !server.features.adminKeyConfigured && server.production && <div className="mt-2"><Note tone="warn">На сервере не задан NEXUS_ADMIN_KEY — серверные инструменты отключены (так и задумано для публичного развёртывания).</Note></div>}
      </Card>
      <Card title="Проект"><Field label="Название (для учёта расходов)"><input className={inputCls} value={project} onChange={(e) => patch({ project: e.target.value.slice(0, 60) })} /></Field></Card>
      <Card title="Состояние сервера" actions={<Button size="xs" variant="secondary" onClick={() => void refreshServerStatus()}>Обновить</Button>}>
        {!server ? <p className="text-xs text-muted">Загрузка…</p> : <ul className="space-y-1.5">
          <FeatureRow ok={server.features.ai} label="AI (OpenRouter)" need="OPENROUTER_API_KEY" /><FeatureRow ok={server.features.adminKeyConfigured} label="Ключ доступа" need="NEXUS_ADMIN_KEY" /><FeatureRow ok={server.features.database} label="База данных" need="DATABASE_URL" />
          <FeatureRow ok={server.features.github} label="GitHub API" need="GITHUB_TOKEN (необязательно для публичных репо)" /><FeatureRow ok={server.features.vercel} label="Vercel деплой" need="VERCEL_TOKEN" /><FeatureRow ok={server.features.figma} label="Figma" need="FIGMA_TOKEN" /><FeatureRow ok={server.features.docker} label="Docker" need="NEXUS_DOCKER=1 + сокет" /></ul>}
        <p className="mt-2 text-[10px] text-muted">Показываются только признаки «задано / не задано» — значения секретов с сервера не передаются.</p>
      </Card>
    </div>
  );
}

export function NexusHub() {
  const { open, workspace, tool } = useNexus();
  const openTool = useNexus((s) => s.openTool);
  const setOpen = useNexus((s) => s.setOpen);
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const [settings, setSettings] = useState(false);
  const ws = WORKSPACES.find((w) => w.id === workspace) ?? WORKSPACES[0];
  const current = TOOLS.find((t) => t.id === tool && t.workspace === workspace);
  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (query) return TOOLS.filter((t) => `${t.title} ${t.desc}`.toLowerCase().includes(query));
    const inWs = TOOLS.filter((t) => t.workspace === workspace);
    return all ? inWs : inWs.filter((t) => t.primary);
  }, [q, all, workspace]);
  const hidden = TOOLS.filter((t) => t.workspace === workspace && !t.primary).length;
  const Panel = current?.Panel;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border border-border-strong bg-panel text-foreground shadow-2xl outline-none sm:inset-4 lg:inset-x-[6%] lg:inset-y-6">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Dialog.Title className="text-sm font-semibold">Nexus Features</Dialog.Title>
            <Badge tone="accent">50 инструментов</Badge>
            <div className="relative ml-auto w-44 sm:w-64"><Search className="absolute left-2 top-2 size-3.5 text-muted" /><input className={cn(inputCls, "pl-7")} aria-label="Поиск инструмента" placeholder="Найти инструмент…" value={q} onChange={(e) => { setQ(e.target.value); setSettings(false); }} /></div>
            <Button size="icon" variant={settings ? "secondary" : "ghost"} aria-label="Настройки Nexus" onClick={() => { setSettings(!settings); openTool(workspace, null); }}><Settings /></Button>
            <Dialog.Close asChild><Button size="icon" variant="ghost" aria-label="Закрыть"><X /></Button></Dialog.Close>
          </header>
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav aria-label="Рабочие пространства" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border p-2 sm:w-52 sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
              {WORKSPACES.map((w) => (
                <button key={w.id} onClick={() => { openTool(w.id, null); setQ(""); setSettings(false); setAll(false); }} aria-current={workspace === w.id}
                  className={cn("flex shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs outline-none transition-colors hover:bg-hover focus-visible:ring-1 focus-visible:ring-accent/70", workspace === w.id && !settings && "bg-accent/15 text-white")}>
                  <span className="text-accent-soft">{ICONS[w.id]}</span><span><span className="block font-medium">{w.title}</span><span className="hidden text-[10px] text-muted sm:block">{w.desc}</span></span>
                </button>
              ))}
            </nav>
            <main className="min-w-0 flex-1 overflow-auto p-3 sm:p-4">
              {settings ? <SettingsView /> : current && Panel ? (
                <>
                  <div className="mb-3 flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => openTool(workspace, null)}><ChevronLeft />{ws?.title}</Button><h2 className="text-sm font-semibold">#{current.n} {current.title}</h2></div>
                  <Panel />
                </>
              ) : (
                <>
                  <div className="mb-3"><h2 className="text-sm font-semibold">{q ? `Результаты: «${q}»` : ws?.title}</h2><p className="text-[11px] text-muted">{q ? `${list.length} найдено` : ws?.desc}</p></div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {list.map((t) => (
                      <button key={t.id} onClick={() => { openTool(t.workspace, t.id); setQ(""); }} className="rounded-lg border border-border bg-panel-2 p-3 text-left outline-none transition-colors hover:border-accent/60 focus-visible:ring-1 focus-visible:ring-accent/70">
                        <div className="flex items-center gap-2 text-xs font-semibold"><span className="text-muted">#{t.n}</span>{t.title}</div>
                        <p className="mt-1 text-[11px] text-subtle">{t.desc}</p>
                      </button>
                    ))}
                  </div>
                  {list.length === 0 && <p className="text-xs text-muted">Ничего не найдено</p>}
                  {!q && hidden > 0 && <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAll(!all)}>{all ? "Свернуть дополнительные" : `Показать все инструменты (+${hidden})`}</Button>}
                </>
              )}
            </main>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
