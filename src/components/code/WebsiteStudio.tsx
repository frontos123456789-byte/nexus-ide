"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Monitor, Pencil, Save, Smartphone, Sparkles, Tablet } from "lucide-react";
import { toast } from "sonner";
import { parseFileBlocks } from "@/lib/agents/parse";
import type { ProjectRecord } from "@/lib/db/schema";
import { useSettings } from "@/lib/settings/store";
import { createProject, ideUrl, listProjects, logActivity, projectFiles, safeRelPath, saveProjectFile } from "@/lib/studio/projects";
import { buildSite, previewFromConfig, previewHtml, SITE_TEMPLATES, type SiteConfig, type SiteStack, type SiteTemplateId } from "@/lib/studio/site-templates";
import { Btn, Card, Field, generateText, inputCls, Notice, Pill } from "./ui";

const DEVICES = [{ id: 320, label: "320", icon: Smartphone }, { id: 390, label: "390", icon: Smartphone }, { id: 768, label: "768", icon: Tablet }, { id: 1024, label: "1024", icon: Monitor }, { id: 0, label: "Авто", icon: Monitor }] as const;

const VE_SCRIPT = `<script data-nexus-ve>(function(){
addEventListener('message',function(e){var d=e.data||{};
if(d.type==='ve')document.designMode=d.on?'on':'off';
if(d.type==='collect'){var c=document.body.cloneNode(true);c.querySelectorAll('script').forEach(function(s){s.remove()});parent.postMessage({type:'collected',html:c.innerHTML},'*')}});
document.addEventListener('click',function(e){var a=e.target.closest&&e.target.closest('a[data-page]');if(a){e.preventDefault();parent.postMessage({type:'nav',page:a.getAttribute('data-page')},'*')}},true);
})();</script>`;

const GEN_SYSTEM = (stack: SiteStack) => `Ты — senior frontend-разработчик. Создай сайт по описанию пользователя.
Сначала выведи краткий план работ (5–8 пунктов) между тегами <plan></plan>.
Затем выведи ВСЕ файлы проекта, каждый в формате:
<file path="относительный/путь">ПОЛНОЕ содержимое файла</file>
${stack === "static" ? "Стек: статический HTML/CSS/JS без сборки. Обязательны index.html, style.css, script.js; если нужна авторизация/кабинет — login.html и dashboard.html (демо-авторизация через localStorage, честно пометь это в интерфейсе). Подключай стили и скрипты относительными путями: <link rel=\"stylesheet\" href=\"style.css\">, <script src=\"script.js\"></script>. Ссылки между страницами — относительные (login.html)." : "Стек: Next.js 15 App Router + TypeScript: package.json, tsconfig.json, next.config.mjs, app/layout.tsx, app/page.tsx, app/globals.css и нужные страницы (app/login/page.tsx, app/dashboard/page.tsx). Без внешних UI-библиотек."}
Требования: современный адаптивный дизайн (mobile-first, работает от 320px), тёмная тема, семантическая вёрстка, доступность (aria, контраст), реальные тексты на языке пользователя (не lorem ipsum). Не используй внешние CDN и изображения-заглушки с внешних сайтов. Никакого текста после последнего </file>.`;

export function WebsiteStudio({ onChanged }: { onChanged: () => void }) {
  const [sites, setSites] = useState<ProjectRecord[]>([]);
  const [active, setActive] = useState<ProjectRecord | null>(null);
  const [mode, setMode] = useState<"new" | "edit">("new");
  const [cfg, setCfg] = useState<SiteConfig & { description: string }>({ name: "Мой проект", tagline: "Современный сайт, созданный в Nexus", template: "landing", accent: "#6366f1", stack: "static", auth: false, description: "" });
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState("");
  const model = useSettings((s) => s.preferredModel);
  const reload = useCallback(async () => { const p = (await listProjects()).filter((x) => x.kind === "website"); setSites(p); return p; }, []);
  useEffect(() => { void reload().then((p) => { if (p[0]) { setActive(p[0]); setMode("edit"); } }); }, [reload]);

  const finish = async (p: ProjectRecord) => { await reload(); setActive(p); setMode("edit"); onChanged(); };

  const fromTemplate = async () => {
    setBusy(true);
    try {
      const files = buildSite(cfg);
      const p = await createProject({ name: cfg.name, kind: "website", stack: cfg.stack === "static" ? "HTML/CSS/JS" : "Next.js", description: cfg.description || cfg.tagline, files });
      await logActivity({ agent: "Website Studio", project: p.id, kind: "task", title: `Сайт создан из шаблона «${SITE_TEMPLATES.find((t) => t.id === cfg.template)?.title}»` });
      toast.success("Сайт создан");
      await finish(p);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка"); } finally { setBusy(false); }
  };

  const fromAi = async () => {
    if (cfg.description.trim().length < 15) return toast.error("Опишите сайт подробнее (минимум 15 символов)");
    setBusy(true);
    setPlan("");
    try {
      const text = await generateText(GEN_SYSTEM(cfg.stack), `Название: ${cfg.name}\nШаблон-ориентир: ${SITE_TEMPLATES.find((t) => t.id === cfg.template)?.title}\nАвторизация и личный кабинет: ${cfg.auth ? "нужны" : "не нужны"}\nОписание: ${cfg.description}`, model, 8000);
      setPlan(/<plan>([\s\S]*?)<\/plan>/.exec(text)?.[1]?.trim() ?? "");
      const blocks = parseFileBlocks(text).filter((b) => safeRelPath(b.path));
      if (blocks.length === 0) throw new Error("ИИ не вернул файлы. Попробуйте ещё раз или выберите шаблон.");
      const p = await createProject({ name: cfg.name, kind: "website", stack: cfg.stack === "static" ? "HTML/CSS/JS" : "Next.js", description: cfg.description, files: blocks.map((b) => ({ path: b.path, content: b.content })) });
      await logActivity({ agent: "Website Studio", project: p.id, kind: "task", title: `ИИ создал сайт (${blocks.length} файлов)`, detail: cfg.description.slice(0, 120) });
      toast.success(`Создано файлов: ${blocks.length}. Проверьте предпросмотр, затем деплой.`);
      await finish(p);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Ошибка генерации"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-border bg-panel-2 p-1">
        {([["new", "Новый сайт"], ["edit", `Редактор (${sites.length})`]] as const).map(([id, l]) => <button key={id} onClick={() => setMode(id)} className={`min-h-10 flex-1 rounded-lg text-sm font-medium ${mode === id ? "bg-accent text-white" : "text-subtle"}`}>{l}</button>)}
      </div>
      {mode === "new" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <Field label="Опишите сайт"><textarea className={`${inputCls} min-h-32 py-2`} value={cfg.description} onChange={(e) => setCfg({ ...cfg, description: e.target.value })} placeholder="Создай современный сайт для моего проекта с авторизацией и личным кабинетом" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Название"><input className={inputCls} value={cfg.name} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} /></Field>
              <Field label="Акцентный цвет"><input type="color" className={`${inputCls} p-1`} value={cfg.accent} onChange={(e) => setCfg({ ...cfg, accent: e.target.value })} /></Field>
              <Field label="Стек"><select className={inputCls} value={cfg.stack} onChange={(e) => setCfg({ ...cfg, stack: e.target.value as SiteStack })}><option value="static">HTML/CSS/JS</option><option value="next">Next.js (App Router)</option></select></Field>
              <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={cfg.auth} onChange={(e) => setCfg({ ...cfg, auth: e.target.checked })} />Вход и кабинет</label>
            </div>
            <Field label="Подзаголовок"><input className={inputCls} value={cfg.tagline} onChange={(e) => setCfg({ ...cfg, tagline: e.target.value })} /></Field>
            {cfg.auth && <Notice tone="warn">Авторизация в шаблонах — демо (localStorage). Для боевого сайта подключите NextAuth/Clerk/Supabase Auth.</Notice>}
            <Btn onClick={fromAi} disabled={busy} className="w-full"><Sparkles className="size-4" />{busy ? "ИИ создаёт сайт…" : "Создать по описанию (ИИ)"}</Btn>
            {plan && <pre className="whitespace-pre-wrap rounded-xl border border-border bg-background p-3 text-xs text-subtle">План ИИ:{"\n"}{plan}</pre>}
          </Card>
          <Card className="space-y-3">
            <div className="text-sm font-semibold">Шаблон (без ИИ)</div>
            <div className="grid gap-2 sm:grid-cols-2">{SITE_TEMPLATES.map((t) => <button key={t.id} onClick={() => setCfg({ ...cfg, template: t.id as SiteTemplateId })} aria-pressed={cfg.template === t.id} className={`min-h-16 rounded-xl border p-3 text-left ${cfg.template === t.id ? "border-accent bg-accent/15" : "border-border hover:bg-hover"}`}><div className="text-sm font-medium">{t.title}</div><div className="text-[11px] text-muted">{t.desc}</div></button>)}</div>
            <Btn variant="ghost" onClick={fromTemplate} disabled={busy} className="w-full">Создать из шаблона</Btn>
            <div className="overflow-hidden rounded-xl border border-border"><iframe title="Предпросмотр шаблона" sandbox="allow-scripts" className="h-72 w-full bg-white" srcDoc={previewFromConfig(cfg)} /></div>
          </Card>
        </div>
      ) : active ? (
        <Editor key={active.id} project={active} sites={sites} onSelect={setActive} />
      ) : <Card className="text-sm text-muted">Сайтов пока нет — создайте первый на вкладке «Новый сайт».</Card>}
    </div>
  );
}

function Editor({ project, sites, onSelect }: { project: ProjectRecord; sites: ProjectRecord[]; onSelect: (p: ProjectRecord) => void }) {
  const [files, setFiles] = useState<{ path: string; rel: string; content: string }[]>([]);
  const [sel, setSel] = useState("index.html");
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState("index.html");
  const [width, setWidth] = useState<number>(390);
  const [ve, setVe] = useState(false);
  const [view, setView] = useState<"preview" | "code">("preview");
  const frame = useRef<HTMLIFrameElement>(null);
  const isStatic = files.some((f) => f.rel === "index.html");

  const load = useCallback(async () => { const f = await projectFiles(project.folder); setFiles(f); return f; }, [project.folder]);
  useEffect(() => { void load().then((f) => { const first = f.find((x) => x.rel === "index.html") ?? f[0]; if (first) { setSel(first.rel); setDraft(first.content); } }); }, [load]);

  const srcDoc = useMemo(() => {
    const html = previewHtml(files, page).replace(/<script>/g, "<script data-inl>");
    return html.includes("</body>") ? html.replace("</body>", `${VE_SCRIPT}</body>`) : html + VE_SCRIPT;
  }, [files, page]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const d = e.data as { type?: string; page?: string; html?: string };
      if (d.type === "nav" && d.page) setPage(d.page);
      if (d.type === "collected" && typeof d.html === "string") {
        const src = files.find((f) => f.rel === page)?.content ?? "";
        const m = /<body[^>]*>([\s\S]*)<\/body>/.exec(src);
        if (!m) return toast.error("Не найден <body> в файле");
        const keep = [...(m[1] as string).matchAll(/<script[\s\S]*?<\/script>/g)].map((x) => x[0]).join("\n");
        const next = src.replace(m[1] as string, `\n${d.html.trim()}\n${keep}\n`);
        void saveProjectFile(project, page, next).then(load).then(() => { toast.success(`Визуальные правки сохранены в ${page}`); setVe(false); });
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [files, page, project, load]);

  useEffect(() => { frame.current?.contentWindow?.postMessage({ type: "ve", on: ve }, "*"); }, [ve, srcDoc]);

  const pick = (rel: string) => { setSel(rel); setDraft(files.find((f) => f.rel === rel)?.content ?? ""); if (rel.endsWith(".html") && isStatic) setPage(rel); };
  const save = async () => { await saveProjectFile(project, sel, draft); await load(); toast.success(`Сохранено: ${sel}`); };

  const addIntegration = async (kind: "api" | "db") => {
    const next = files.some((f) => f.rel === "package.json");
    if (kind === "api") await saveProjectFile(project, next ? "lib/api.ts" : "api.js", next ? 'const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";\n\nexport async function api<T>(path: string, init?: RequestInit): Promise<T> {\n  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });\n  if (!res.ok) throw new Error(`API ${res.status}`);\n  return res.json() as Promise<T>;\n}\n' : '// Minimal API client. Set API_BASE to your backend URL.\nconst API_BASE = "";\nexport async function api(path, init) {\n  const res = await fetch(API_BASE + path, Object.assign({ headers: { "content-type": "application/json" } }, init));\n  if (!res.ok) throw new Error("API " + res.status);\n  return res.json();\n}\n');
    else if (next) { await saveProjectFile(project, "lib/db.ts", 'import { Pool } from "pg";\n\n// Server-side only (route handlers / server components). Add "pg" to dependencies.\nexport const pool = new Pool({ connectionString: process.env.DATABASE_URL });\n'); }
    else return toast.error("База данных требует серверной части — выберите стек Next.js");
    const env = files.find((f) => f.rel === ".env.example")?.content ?? "";
    const line = kind === "api" ? "NEXT_PUBLIC_API_URL=" : "DATABASE_URL=";
    if (!env.includes(line)) await saveProjectFile(project, ".env.example", `${env.trimEnd()}\n${line}\n`);
    await load();
    toast.success(kind === "api" ? "Добавлен API-клиент" : "Добавлено подключение к БД (проверьте зависимость pg)");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Проект" className={`${inputCls} max-w-xs`} value={project.id} onChange={(e) => { const p = sites.find((s) => s.id === e.target.value); if (p) onSelect(p); }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <Pill>{project.stack}</Pill>
        <Link href={ideUrl(`${project.folder}/${sel}`)} className="ml-auto inline-flex min-h-11 items-center rounded-xl border border-border-strong px-4 text-sm text-subtle hover:bg-hover">Открыть в Monaco</Link>
      </div>
      <div className="flex gap-1 rounded-xl border border-border bg-panel-2 p-1 lg:hidden">{(["preview", "code"] as const).map((v) => <button key={v} onClick={() => setView(v)} className={`min-h-10 flex-1 rounded-lg text-sm ${view === v ? "bg-accent text-white" : "text-subtle"}`}>{v === "preview" ? "Предпросмотр" : "Код"}</button>)}</div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className={`space-y-2 ${view === "preview" ? "hidden lg:block" : ""}`}>
          <div className="flex gap-1 overflow-x-auto pb-1">{files.map((f) => <button key={f.rel} onClick={() => pick(f.rel)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs ${sel === f.rel ? "bg-accent/20 text-foreground" : "text-subtle hover:bg-hover"}`}>{f.rel}</button>)}</div>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} spellCheck={false} aria-label={`Код ${sel}`} className="h-80 w-full resize-y rounded-xl border border-border bg-background p-3 font-mono text-[12px] leading-relaxed outline-none focus:border-accent" />
          <div className="flex flex-wrap gap-2"><Btn onClick={save} disabled={draft === files.find((f) => f.rel === sel)?.content}><Save className="size-4" />Сохранить</Btn><Btn variant="ghost" onClick={() => void addIntegration("api")}>+ API-клиент</Btn><Btn variant="ghost" onClick={() => void addIntegration("db")}>+ База данных</Btn></div>
        </Card>
        <Card className={`space-y-2 ${view === "code" ? "hidden lg:block" : ""}`}>
          <div className="flex flex-wrap items-center gap-1">
            {DEVICES.map((d) => <button key={d.id} onClick={() => setWidth(d.id)} aria-pressed={width === d.id} className={`flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs ${width === d.id ? "bg-accent/20 text-foreground" : "text-subtle hover:bg-hover"}`}><d.icon className="size-3.5" />{d.label}</button>)}
            <div className="flex-1" />
            {isStatic && <button onClick={() => { if (ve) frame.current?.contentWindow?.postMessage({ type: "collect" }, "*"); else setVe(true); }} className={`flex min-h-9 items-center gap-1 rounded-lg px-3 text-xs ${ve ? "bg-emerald-500/20 text-emerald-300" : "text-subtle hover:bg-hover"}`}>{ve ? <><Save className="size-3.5" />Сохранить правки</> : <><Pencil className="size-3.5" />Визуальное редактирование</>}</button>}
            {ve && <button onClick={() => setVe(false)} className="min-h-9 rounded-lg px-3 text-xs text-subtle hover:bg-hover">Отмена</button>}
          </div>
          {ve && <Notice tone="info">Кликайте по тексту на странице и редактируйте прямо в предпросмотре, затем нажмите «Сохранить правки».</Notice>}
          <div className="overflow-auto rounded-xl border border-border bg-[#1a1a1f]">
            <iframe ref={frame} title="Live Preview" sandbox="allow-scripts" srcDoc={srcDoc} style={{ width: width || "100%", maxWidth: "100%" }} className="mx-auto block h-[28rem] bg-white" />
          </div>
          {!isStatic && <Notice tone="warn"><Eye className="mr-1 inline size-3" />Предпросмотр кода Next.js недоступен в браузере (нет сборки). Проверьте сайт через preview-деплой на Vercel (раздел «Проекты»).</Notice>}
        </Card>
      </div>
    </div>
  );
}
