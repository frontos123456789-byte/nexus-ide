"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { askAi, nexusJson, workspaceFiles } from "@/lib/nexus/actions";
import { auditDocument, auditSource, type A11yIssue } from "@/lib/nexus/a11y";
import { FILE_FORMAT_HINT, parseFileBlocks } from "@/lib/nexus/changes";
import { DEFAULT_TOKENS, EASINGS, animationToCss, animationToJs, parseCssVars, tokensToCss, tokensToTailwind, type Animation, type ThemeDef, type TokenSet } from "@/lib/nexus/design";
import { useIdeStore } from "@/lib/store/ide";
import type { Change } from "@/lib/nexus/types";
import { cn } from "@/lib/utils/cn";
import { Badge, Card, ChangeSet, Empty, Field, Note, inputCls, useBusy, useFiles, usePersisted } from "../ui";

const SANDBOX = "allow-same-origin";

function HtmlPick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const files = useFiles();
  const htmls = Object.keys(files).filter((p) => /\.html?$/i.test(p)).sort();
  const eff = value && htmls.includes(value) ? value : (htmls[0] ?? "");
  useEffect(() => { if (eff !== value) onChange(eff); }, [eff, value, onChange]);
  if (htmls.length === 0) {
    return (
      <Empty>
        <div className="space-y-2"><p>В проекте нет HTML-файлов для предпросмотра.</p>
          <Button size="sm" onClick={() => void useIdeStore.getState().upsertFile("preview.html", DEMO_HTML, false).then(() => toast.success("Создан preview.html"))}><Plus />Создать preview.html</Button></div>
      </Empty>
    );
  }
  return <Field label="HTML-файл"><select className={inputCls} value={eff} onChange={(e) => onChange(e.target.value)}>{htmls.map((p) => <option key={p}>{p}</option>)}</select></Field>;
}

const DEMO_HTML = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Демо</title>
<style>body{font-family:system-ui;margin:0;background:#fff;color:#111}header{padding:24px;background:#4f46e5;color:#fff}main{padding:24px}.card{border:1px solid #ddd;border-radius:12px;padding:16px;max-width:420px}button{padding:10px 16px;border:0;border-radius:8px;background:#4f46e5;color:#fff}</style></head>
<body><header><h1>Nexus Demo</h1></header><main><div class="card"><h2>Карточка</h2><p>Пример страницы для визуального редактора и проверок.</p><button type="button">Действие</button></div></main></body></html>
`;

/* --------------------- 22. Responsive matrix + 21. Visual editor ------------ */

interface Size { name: string; w: number; h: number }
const DEFAULT_SIZES: Size[] = [{ name: "Mobile", w: 375, h: 667 }, { name: "Tablet", w: 768, h: 1024 }, { name: "Laptop", w: 1280, h: 720 }];

export function ResponsivePanel() {
  const files = useFiles();
  const [path, setPath] = useState("");
  const [sizes, setSizes, ready] = usePersisted<Size[]>("sizes", DEFAULT_SIZES);
  const [w, setW] = useState(480); const [h, setH] = useState(800);
  const src = files[path];
  return (
    <div className="space-y-3">
      <HtmlPick value={path} onChange={setPath} />
      <div className="flex flex-wrap items-end gap-2"><Field label="Ширина"><input type="number" className={cn(inputCls, "w-20")} value={w} onChange={(e) => setW(Number(e.target.value))} /></Field>
        <Field label="Высота"><input type="number" className={cn(inputCls, "w-20")} value={h} onChange={(e) => setH(Number(e.target.value))} /></Field>
        <Button size="sm" variant="secondary" disabled={w < 200 || w > 3000 || h < 200 || h > 3000} onClick={() => setSizes((s) => [...s, { name: `${w}×${h}`, w, h }])}><Plus />Свой размер</Button></div>
      {src === undefined ? null : !ready ? <Empty>Загрузка…</Empty> : (
        <div className="flex flex-wrap gap-4">{sizes.map((s, i) => { const scale = Math.min(1, 360 / s.w); return (
          <div key={`${s.name}${i}`}><div className="mb-1 flex items-center gap-2 text-[11px] text-subtle">{s.name} · {s.w}×{s.h}<button aria-label={`Удалить ${s.name}`} className="text-muted hover:text-red-400" onClick={() => setSizes((a) => a.filter((_, k) => k !== i))}><Trash2 className="size-3" /></button></div>
            <div style={{ width: s.w * scale, height: s.h * scale }} className="overflow-hidden rounded border border-border-strong bg-white"><iframe title={`${s.name} preview`} sandbox={SANDBOX} srcDoc={src} style={{ width: s.w, height: s.h, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0 }} /></div></div>); })}</div>)}
      <p className="text-[10px] text-muted">Предпросмотр обновляется сразу при изменении файла в редакторе. Скрипты в preview отключены (sandbox).</p>
    </div>
  );
}

function chainOf(el: Element, body: Element): number[] { const out: number[] = []; let cur: Element | null = el; while (cur && cur !== body && cur.parentElement) { out.unshift(Array.from(cur.parentElement.children).indexOf(cur)); cur = cur.parentElement; } return out; }

export function VisualEditorPanel() {
  const files = useFiles();
  const [path, setPath] = useState("");
  const frame = useRef<HTMLIFrameElement>(null);
  const sel = useRef<{ el: Element; chain: number[] } | null>(null);
  const [info, setInfo] = useState<{ tag: string; text: string; cls: string; style: string; id: string; chain: number[] } | null>(null);
  const [form, setForm] = useState({ text: "", cls: "", style: "", id: "" });
  const [changes, setChanges] = useState<Change[]>([]);
  const src = files[path];
  const onLoad = () => {
    const doc = frame.current?.contentDocument; if (!doc?.body) return;
    doc.addEventListener("click", (e) => {
      e.preventDefault(); const el = e.target as Element; if (!el || el === doc.body || el === doc.documentElement) return;
      if (sel.current) (sel.current.el as HTMLElement).style.outline = "";
      (el as HTMLElement).style.outline = "2px solid #6366f1";
      const chain = chainOf(el, doc.body); sel.current = { el, chain };
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
      const style = (el.getAttribute("style") ?? "").replace(/outline:\s*2px solid #6366f1;?/, "").trim();
      setInfo({ tag: el.tagName.toLowerCase(), text: own, cls: el.getAttribute("class") ?? "", style, id: el.id, chain });
      setForm({ text: own, cls: el.getAttribute("class") ?? "", style, id: el.id });
    }, true);
  };
  const apply = () => {
    if (!info || src === undefined) return;
    const d = new DOMParser().parseFromString(src, "text/html"); let t: Element | undefined = d.body;
    for (const i of info.chain) t = t?.children[i];
    if (!t) return toast.error("Не удалось сопоставить элемент с исходником");
    if (t.tagName.toLowerCase() !== info.tag) return toast.error("Структура исходника не совпала с DOM — элемент не найден");
    const textNode = Array.from(t.childNodes).find((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
    if (textNode && form.text !== info.text) textNode.textContent = form.text;
    for (const [k, v] of [["class", form.cls], ["style", form.style], ["id", form.id]] as const) { if (v) t.setAttribute(k, v); else t.removeAttribute(k); }
    const after = `<!DOCTYPE html>\n${d.documentElement.outerHTML}\n`;
    setChanges([{ path, before: src, after }]);
  };
  return (
    <div className="space-y-3">
      <Note>Кликните элемент в preview, измените свойства и примените к исходнику. Соответствие DOM → HTML определяется по пути из индексов дочерних элементов в <b>HTML-файлах</b>. Исходник переписывается через парсер, поэтому форматирование файла может нормализоваться — проверьте diff. JSX/React-компоненты не поддерживаются.</Note>
      <HtmlPick value={path} onChange={(p) => { setPath(p); setInfo(null); sel.current = null; }} />
      {src !== undefined && <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <div className="overflow-hidden rounded border border-border-strong bg-white"><iframe ref={frame} key={path + (info ? "" : "")} title="Visual editor preview" sandbox={SANDBOX} srcDoc={src} onLoad={onLoad} className="h-[420px] w-full border-0" /></div>
        <Card title={info ? `<${info.tag}> · путь ${info.chain.join(">") || "body"}` : "Свойства элемента"}>
          {!info ? <Empty>Выберите элемент в preview</Empty> : <div className="space-y-2">
            <Field label="Текст"><input className={inputCls} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
            <Field label="class"><input className={inputCls} value={form.cls} onChange={(e) => setForm({ ...form, cls: e.target.value })} /></Field>
            <Field label="style"><input className={inputCls} value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="color: red; padding: 8px" /></Field>
            <Field label="id"><input className={inputCls} value={form.id} onChange={(e) => setForm({ ...form, id: e.target.value })} /></Field>
            <Button size="sm" onClick={apply}>Показать изменение в коде</Button></div>}
        </Card></div>}
      {changes.length > 0 && <ChangeSet changes={changes} source="Visual Editor" />}
    </div>
  );
}

/* ------------------------ 25. UI Critic + 30. A11y -------------------------- */

function useAudit(path: string) {
  const files = useFiles();
  const src = files[path];
  const [issues, setIssues] = useState<A11yIssue[]>([]);
  const [done, setDone] = useState(false);
  const isHtml = /\.html?$/i.test(path);
  const [key, setKey] = useState(0);
  const textual = useMemo(() => (src !== undefined && !isHtml ? auditSource(path, src) : null), [src, path, isHtml]);
  const frame = isHtml && src !== undefined ? (
    <iframe key={key} title="audit" sandbox={SANDBOX} srcDoc={src} className="pointer-events-none absolute -left-[9999px] h-[800px] w-[1024px]" aria-hidden tabIndex={-1}
      onLoad={(e) => { const w = e.currentTarget.contentWindow; const d = e.currentTarget.contentDocument; if (w && d) { setIssues(auditDocument(d, w)); setDone(true); } }} />) : null;
  return { issues: textual ?? issues, done: textual ? true : done, frame, rerun: () => { setDone(false); setKey((k) => k + 1); }, isHtml };
}

function IssueList({ issues }: { issues: A11yIssue[] }) {
  if (issues.length === 0) return <Note tone="ok">Нарушений не найдено</Note>;
  return <ul className="space-y-1">{issues.map((i, n) => (
    <li key={n} className="rounded border border-border p-2 text-xs"><div className="flex flex-wrap items-center gap-1.5"><Badge tone={i.severity === "error" ? "error" : i.severity === "warn" ? "warn" : "muted"}>{i.severity}</Badge><Badge>{i.category}</Badge>{i.wcag && <Badge tone="accent">WCAG {i.wcag}</Badge>}<span>{i.message}</span></div><div className="mt-0.5 font-mono text-[10px] text-muted">{i.selector}</div></li>))}</ul>;
}

export function A11yPanel() {
  const files = useFiles();
  const [path, setPath] = useState("");
  const all = Object.keys(files).filter((p) => /\.(html?|[jt]sx)$/.test(p)).sort();
  const eff = path || all[0] || "";
  const a = useAudit(eff);
  const objective = a.issues.filter((i) => i.kind === "objective");
  return (
    <div className="space-y-3">
      <Field label="Файл (HTML — полная проверка с рендером; JSX/TSX — статический анализ исходника)"><select className={inputCls} value={eff} onChange={(e) => setPath(e.target.value)}>{all.map((p) => <option key={p}>{p}</option>)}</select></Field>
      {all.length === 0 && <Empty>Нет HTML/JSX файлов для проверки</Empty>}
      <div className="relative">{a.frame}</div>
      {eff && !a.done && <p className="text-xs text-muted"><Loader2 className="mr-1 inline size-3 animate-spin" />Рендерим и проверяем…</p>}
      {a.done && <><div className="flex gap-2 text-[11px]"><Badge tone="error">ошибок: {objective.filter((i) => i.severity === "error").length}</Badge><Badge tone="warn">предупреждений: {objective.filter((i) => i.severity === "warn").length}</Badge><Button size="xs" variant="secondary" onClick={a.rerun}>Перепроверить</Button></div>
        <p className="text-[10px] text-muted">Проверяются: контраст (WCAG 1.4.3), семантика, ARIA, фокус и клавиатурная навигация, размер целей. Автоматика покрывает лишь часть WCAG — ручная проверка скринридером остаётся необходимой.</p>
        <IssueList issues={objective} /></>}
    </div>
  );
}

export function CriticPanel() {
  const files = useFiles();
  const [path, setPath] = useState("");
  const all = Object.keys(files).filter((p) => /\.(html?|[jt]sx|css)$/.test(p)).sort();
  const eff = path || all[0] || "";
  const a = useAudit(eff);
  const [review, setReview] = useState("");
  const { busy, error, run } = useBusy();
  const obj = a.issues.filter((i) => i.kind === "objective");
  const sug = a.issues.filter((i) => i.kind === "suggestion");
  return (
    <div className="space-y-3">
      <Field label="Файл"><select className={inputCls} value={eff} onChange={(e) => setPath(e.target.value)}>{all.map((p) => <option key={p}>{p}</option>)}</select></Field>
      <div className="relative">{a.frame}</div>
      <Card title={`Объективные ошибки (${obj.length}) — измеримые нарушения`}>{a.done ? <IssueList issues={obj} /> : <p className="text-xs text-muted">Анализ…</p>}</Card>
      <Card title={`Рекомендации (${sug.length}) — вкусовые, можно игнорировать`}>{a.done ? <IssueList issues={sug} /> : null}
        <div className="mt-2"><Button size="sm" variant="secondary" disabled={busy || !eff} onClick={() => void run(async () => { const r = await askAi({ feature: "ui-critic", task: "reasoning", system: "Ты UI/UX-критик. Дай субъективную оценку дизайна: иерархия, отступы, типографика, согласованность. Чётко помечай, что это мнение. По-русски, 5–8 пунктов.", prompt: `Файл ${eff}:\n${(files[eff] ?? "").slice(0, 12_000)}\n\nУже найденные объективные проблемы:\n${obj.slice(0, 15).map((i) => i.message).join("\n")}` }); setReview(r.text); })}>{busy ? <Loader2 className="animate-spin" /> : <Play />}AI-оценка (субъективно)</Button></div>
        {error && <div className="mt-2"><Note tone="error">{error}</Note></div>}{review && <pre className="mt-2 whitespace-pre-wrap font-sans text-xs">{review}</pre>}</Card>
    </div>
  );
}

/* ---------------------------- 23. Screenshot → component -------------------- */

async function toDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file); const scale = Math.min(1, 1280 / bmp.width);
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height); return c.toDataURL("image/jpeg", 0.85);
}

export function ScreenshotPanel() {
  const [img, setImg] = useState<string | null>(null);
  const [path, setPath] = useState("src/components/FromScreenshot.tsx");
  const [notes, setNotes] = useState("");
  const [changes, setChanges] = useState<Change[]>([]);
  const [raw, setRaw] = useState("");
  const { busy, error, run } = useBusy();
  return (
    <div className="space-y-3">
      <Field label="Скриншот (PNG/JPEG/WebP, до 8 МБ)"><input type="file" accept="image/png,image/jpeg,image/webp" className={inputCls} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 8_000_000) return toast.error("Файл больше 8 МБ"); void toDataUrl(f).then(setImg).catch(() => toast.error("Не удалось прочитать изображение")); }} /></Field>
      {img && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="Загруженный скриншот" className="max-h-56 rounded border border-border" />
      )}
      <div className="grid gap-2 sm:grid-cols-2"><Field label="Путь компонента"><input className={inputCls} value={path} onChange={(e) => setPath(e.target.value)} /></Field><Field label="Пожелания"><input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="тёмная тема, Tailwind" /></Field></div>
      <Button size="sm" disabled={!img || busy} onClick={() => void run(async () => {
        const files = workspaceFiles();
        const r = await askAi({ feature: "screenshot-component", task: "vision", images: img ? [img] : undefined, system: `Ты фронтенд-разработчик. Воспроизведи интерфейс со скриншота как React-компонент на TypeScript + Tailwind CSS. Только реальные элементы со скриншота, тексты оставь как есть.\n${FILE_FORMAT_HINT}`, prompt: `Создай компонент в файле ${path}. ${notes}` });
        const cs = parseFileBlocks(r.text, files); setChanges(cs); setRaw(r.text);
      })}>{busy ? <Loader2 className="animate-spin" /> : <Play />}Сгенерировать</Button>
      {error && <Note tone="error">{error}</Note>}
      {changes.length > 0 ? <Card title="Код (можно редактировать до применения)"><textarea className={cn(inputCls, "min-h-64 font-mono")} aria-label="Код компонента" value={changes[0]?.after ?? ""} onChange={(e) => setChanges((c) => c.map((x, i) => (i === 0 ? { ...x, after: e.target.value } : x)))} />
        <div className="mt-2"><ChangeSet key={changes[0]?.path} changes={changes} source="Screenshot→Component" /></div></Card> : raw ? <Note tone="warn">Модель не вернула файл в ожидаемом формате:<pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{raw.slice(0, 1500)}</pre></Note> : null}
    </div>
  );
}

/* --------------------------------- 24. Visual diff -------------------------- */

export function VisualDiffPanel() {
  const [a, setA] = useState<string | null>(null); const [b, setB] = useState<string | null>(null);
  const [th, setTh] = useState(12); const [mode, setMode] = useState<"diff" | "overlay">("diff"); const [op, setOp] = useState(50);
  const canvas = useRef<HTMLCanvasElement>(null); const [pct, setPct] = useState<number | null>(null);
  const load = (set: (s: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) void toDataUrl(f).then(set); };
  useEffect(() => {
    if (!a || !b || !canvas.current) return;
    let alive = true;
    const ld = (s: string) => new Promise<HTMLImageElement>((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    void Promise.all([ld(a), ld(b)]).then(([ia, ib]) => {
      if (!alive || !canvas.current) return;
      const W = Math.max(ia.width, ib.width), H = Math.max(ia.height, ib.height); const c = canvas.current; c.width = W; c.height = H;
      const ctx = c.getContext("2d", { willReadFrequently: true }); if (!ctx) return;
      const get = (im: HTMLImageElement) => { ctx.clearRect(0, 0, W, H); ctx.drawImage(im, 0, 0); return ctx.getImageData(0, 0, W, H); };
      const da = get(ia), db = get(ib);
      if (mode === "overlay") { ctx.clearRect(0, 0, W, H); ctx.globalAlpha = 1; ctx.drawImage(ia, 0, 0); ctx.globalAlpha = op / 100; ctx.drawImage(ib, 0, 0); ctx.globalAlpha = 1; }
      const out = ctx.createImageData(W, H); let diff = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const d = Math.max(Math.abs((da.data[i] ?? 0) - (db.data[i] ?? 0)), Math.abs((da.data[i + 1] ?? 0) - (db.data[i + 1] ?? 0)), Math.abs((da.data[i + 2] ?? 0) - (db.data[i + 2] ?? 0)));
        if (d > th * 2.55) { diff++; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 80; out.data[i + 3] = 255; } else { out.data[i] = (da.data[i] ?? 0); out.data[i + 1] = (da.data[i + 1] ?? 0); out.data[i + 2] = (da.data[i + 2] ?? 0); out.data[i + 3] = 70; }
      }
      if (mode === "diff") ctx.putImageData(out, 0, 0);
      setPct((diff / (W * H)) * 100);
    });
    return () => { alive = false; };
  }, [a, b, th, mode, op]);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2"><Field label="До"><input type="file" accept="image/*" className={inputCls} onChange={load(setA)} /></Field><Field label="После"><input type="file" accept="image/*" className={inputCls} onChange={load(setB)} /></Field></div>
      <div className="flex flex-wrap items-end gap-3"><Field label={`Порог различия: ${th}%`}><input type="range" min={0} max={50} value={th} onChange={(e) => setTh(Number(e.target.value))} /></Field>
        <Field label="Режим"><select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as "diff" | "overlay")}><option value="diff">Подсветка различий</option><option value="overlay">Наложение</option></select></Field>
        {mode === "overlay" && <Field label={`Прозрачность «после»: ${op}%`}><input type="range" min={0} max={100} value={op} onChange={(e) => setOp(Number(e.target.value))} /></Field>}
        {pct !== null && <Badge tone={pct > 1 ? "error" : "ok"}>различается {pct.toFixed(2)}% пикселей</Badge>}</div>
      {!a || !b ? <Empty>Загрузите два изображения для сравнения</Empty> : <div className="overflow-auto rounded border border-border bg-background"><canvas ref={canvas} className="max-w-full" aria-label="Результат сравнения" /></div>}
    </div>
  );
}

/* ------------------------- 26. Tokens + 28. Figma sync ---------------------- */

const DEFAULT_THEMES: ThemeDef[] = [{ name: "dark", tokens: DEFAULT_TOKENS }];
type Cat = keyof TokenSet;
const CATS: { id: Cat; label: string }[] = [{ id: "colors", label: "Цвета" }, { id: "fonts", label: "Шрифты" }, { id: "spacing", label: "Интервалы" }, { id: "radius", label: "Радиусы" }];

export function TokensPanel() {
  const files = useFiles();
  const [themes, setThemes] = usePersisted<ThemeDef[]>("tokens", DEFAULT_THEMES);
  const [cur, setCur] = useState(0); const [cat, setCat] = useState<Cat>("colors");
  const [k, setK] = useState(""); const [v, setV] = useState(""); const [target, setTarget] = useState("src/design-tokens.css"); const [fmt, setFmt] = useState<"css" | "tailwind">("css");
  const [changes, setChanges] = useState<Change[]>([]); const [syncFile, setSyncFile] = useState("");
  const th = themes[cur] ?? themes[0]; if (!th) return null;
  const upd = (fn: (t: ThemeDef) => ThemeDef) => setThemes((all) => all.map((t, i) => (i === cur ? fn(t) : t)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2"><select aria-label="Тема" className={cn(inputCls, "w-40")} value={cur} onChange={(e) => setCur(Number(e.target.value))}>{themes.map((t, i) => <option key={i} value={i}>{t.name}</option>)}</select>
        <Button size="sm" variant="secondary" onClick={() => { const name = `theme-${themes.length + 1}`; setThemes((a) => [...a, { name, tokens: JSON.parse(JSON.stringify(th.tokens)) as TokenSet }]); setCur(themes.length); }}><Plus />Тема</Button>
        {themes.length > 1 && <Button size="sm" variant="ghost" onClick={() => { setThemes((a) => a.filter((_, i) => i !== cur)); setCur(0); }}><Trash2 />Удалить</Button>}
        <input aria-label="Имя темы" className={cn(inputCls, "w-36")} value={th.name} onChange={(e) => upd((t) => ({ ...t, name: e.target.value }))} /></div>
      <div className="flex gap-1">{CATS.map((c) => <Button key={c.id} size="xs" variant={cat === c.id ? "default" : "secondary"} onClick={() => setCat(c.id)}>{c.label}</Button>)}</div>
      <Card title={CATS.find((c) => c.id === cat)?.label}><ul className="space-y-1">{Object.entries(th.tokens[cat]).map(([name, val]) => (
        <li key={name} className="flex items-center gap-2 text-xs"><span className="w-28 truncate font-mono">{name}</span>{cat === "colors" && /^#[0-9a-f]{6}$/i.test(val) && <input type="color" aria-label={`Цвет ${name}`} value={val} onChange={(e) => upd((t) => ({ ...t, tokens: { ...t.tokens, colors: { ...t.tokens.colors, [name]: e.target.value } } }))} />}
          <input className={inputCls} aria-label={name} value={val} onChange={(e) => upd((t) => ({ ...t, tokens: { ...t.tokens, [cat]: { ...t.tokens[cat], [name]: e.target.value } } }))} />
          <button aria-label={`Удалить ${name}`} className="text-muted hover:text-red-400" onClick={() => upd((t) => { const c = { ...t.tokens[cat] }; delete c[name]; return { ...t, tokens: { ...t.tokens, [cat]: c } }; })}><Trash2 className="size-3.5" /></button></li>))}</ul>
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (k.trim() && v.trim()) { upd((t) => ({ ...t, tokens: { ...t.tokens, [cat]: { ...t.tokens[cat], [k.trim()]: v.trim() } } })); setK(""); setV(""); } }}><input className={inputCls} placeholder="имя" value={k} onChange={(e) => setK(e.target.value)} /><input className={inputCls} placeholder="значение" value={v} onChange={(e) => setV(e.target.value)} /><Button size="sm" type="submit"><Plus />Добавить</Button></form></Card>
      <Card title="Синхронизация с проектом">
        <div className="grid gap-2 sm:grid-cols-3"><Field label="Файл экспорта"><input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
          <Field label="Формат"><select className={inputCls} value={fmt} onChange={(e) => setFmt(e.target.value as "css" | "tailwind")}><option value="css">CSS custom properties</option><option value="tailwind">Tailwind v4 @theme</option></select></Field>
          <div className="flex items-end"><Button size="sm" onClick={() => { const after = fmt === "css" ? tokensToCss(themes) : tokensToTailwind(th.tokens); setChanges([{ path: target, before: files[target] ?? null, after }]); }}>Экспорт в проект</Button></div></div>
        <div className="mt-2 flex items-end gap-2"><div className="flex-1"><Field label="Импорт переменных из CSS"><select className={inputCls} value={syncFile} onChange={(e) => setSyncFile(e.target.value)}><option value="">— CSS файл —</option>{Object.keys(files).filter((p) => p.endsWith(".css")).map((p) => <option key={p}>{p}</option>)}</select></Field></div>
          <Button size="sm" variant="secondary" disabled={!syncFile} onClick={() => { const t = parseCssVars(files[syncFile] ?? ""); upd((x) => ({ ...x, tokens: { colors: { ...x.tokens.colors, ...t.colors }, spacing: { ...x.tokens.spacing, ...t.spacing }, radius: { ...x.tokens.radius, ...t.radius }, fonts: { ...x.tokens.fonts, ...t.fonts } } })); toast.success(`Импортировано токенов: ${Object.values(t).reduce((n, o) => n + Object.keys(o).length, 0)}`); }}>Импортировать</Button></div>
        {changes.length > 0 && <div className="mt-2"><ChangeSet changes={changes} source="Design Tokens" /></div>}</Card>
    </div>
  );
}

interface FigmaData { name?: string; lastModified?: string; components: { key: string; name: string; description?: string; frame?: string }[]; colors: { name: string; value: string | null }[] }

export function FigmaPanel() {
  const files = useFiles();
  const [key, setKey] = useState("");
  const [data, setData] = useState<FigmaData | null>(null);
  const [themes, setThemes] = usePersisted<ThemeDef[]>("tokens", DEFAULT_THEMES);
  const [choice, setChoice] = useState<Record<string, "figma" | "local">>({});
  const { busy, error, run } = useBusy();
  const locals = useMemo(() => Object.keys(files).filter((p) => /\.[jt]sx$/.test(p)).map((p) => ({ path: p, name: (p.split("/").pop() ?? "").replace(/\.[jt]sx$/, "").toLowerCase() })), [files]);
  const norm = (s: string) => s.split("/").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() ?? "";
  const localColors = themes[0]?.tokens.colors ?? {};
  const conflicts = (data?.colors ?? []).filter((c) => c.value).map((c) => ({ name: c.name.split("/").pop()?.trim().toLowerCase().replace(/\s+/g, "-") ?? c.name, figma: c.value ?? "" })).filter((c) => localColors[c.name] && localColors[c.name]?.toLowerCase() !== c.figma.toLowerCase());
  return (
    <div className="space-y-3">
      <Note>Нужен серверный токен FIGMA_TOKEN (Personal Access Token с правом чтения файлов) и ключ доступа Nexus. Токен остаётся на сервере и никогда не попадает в браузер. Импортируются компоненты и цветовые стили файла.</Note>
      <div className="flex items-end gap-2"><div className="flex-1"><Field label="File key (из URL figma.com/design/<KEY>/…)"><input className={inputCls} value={key} onChange={(e) => setKey(e.target.value.trim())} /></Field></div>
        <Button size="sm" disabled={busy || !key} onClick={() => void run(async () => setData(await nexusJson<FigmaData>(`/api/nexus/figma?file=${encodeURIComponent(key)}`)))}>{busy ? <Loader2 className="animate-spin" /> : null}Импортировать</Button></div>
      {error && <Note tone="error">{error}</Note>}
      {data && <>
        <Card title={`Компоненты Figma → локальные (${data.components.length})`}>{data.components.length === 0 ? <Empty>В файле нет опубликованных компонентов</Empty> : <ul className="space-y-1 text-xs">{data.components.map((c) => { const m = locals.find((l) => l.name === norm(c.name)); return <li key={c.key} className="flex items-center gap-2"><span className="flex-1">{c.name}{c.frame ? <span className="text-muted"> · {c.frame}</span> : null}</span>{m ? <Badge tone="ok">{m.path}</Badge> : <Badge tone="warn">нет локального</Badge>}</li>; })}</ul>}</Card>
        <Card title={`Цвета (${data.colors.length}), конфликтов с токенами: ${conflicts.length}`}>
          {conflicts.map((c) => <div key={c.name} className="mb-1 flex items-center gap-2 text-xs"><span className="w-28 font-mono">{c.name}</span><span>локально {localColors[c.name]}</span><span>Figma {c.figma}</span>
            <select aria-label={`Решение для ${c.name}`} className={cn(inputCls, "w-28")} value={choice[c.name] ?? "local"} onChange={(e) => setChoice((s) => ({ ...s, [c.name]: e.target.value as "figma" | "local" }))}><option value="local">оставить</option><option value="figma">взять из Figma</option></select></div>)}
          <Button size="sm" className="mt-2" onClick={() => { setThemes((all) => all.map((t, i) => { if (i !== 0) return t; const colors = { ...t.tokens.colors }; for (const c of data.colors) { if (!c.value) continue; const name = c.name.split("/").pop()?.trim().toLowerCase().replace(/\s+/g, "-") ?? c.name; if (!(name in colors) || choice[name] === "figma") colors[name] = c.value; } return { ...t, tokens: { ...t.tokens, colors } }; })); toast.success("Цвета синхронизированы с токенами"); }}>Применить к дизайн-токенам</Button></Card></>}
    </div>
  );
}

/* ----------------------------- 27. Playground ------------------------------- */

interface Example { name: string; props: Record<string, string> }
const PG_TEMPLATE = `<button style="padding:10px 18px;border:0;border-radius:{{radius}}px;background:{{color}};color:#fff;opacity:{{opacity}}" {{disabled}}>{{label}}</button>`;

export function PlaygroundPanel() {
  const [tpl, setTpl] = usePersisted("pg-template", PG_TEMPLATE);
  const [props, setProps] = useState<Record<string, string>>({ radius: "8", color: "#6366f1", opacity: "1", disabled: "", label: "Нажми меня" });
  const [examples, setExamples] = usePersisted<Example[]>("pg-examples", []);
  const [name, setName] = useState("");
  const keys = useMemo(() => [...new Set([...tpl.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1] ?? ""))], [tpl]);
  const html = tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (props[k] ?? "").replace(/</g, "&lt;"));
  const states: Record<string, Record<string, string>> = { default: { opacity: "1", disabled: "" }, disabled: { opacity: "0.5", disabled: "disabled" }, "hover (имитация)": { opacity: "0.85", disabled: "" } };
  return (
    <div className="space-y-3">
      <Note>Изолированная песочница для HTML-шаблонов с {"{{props}}"}: меняйте свойства, переключайте состояния, смотрите код и сохраняйте примеры. React-компоненты проекта здесь не исполняются (в браузере нет сборки проекта).</Note>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Шаблон"><textarea className={cn(inputCls, "min-h-24 font-mono")} aria-label="Шаблон" value={tpl} onChange={(e) => setTpl(e.target.value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">{keys.map((k) => <Field key={k} label={k}><input className={inputCls} value={props[k] ?? ""} onChange={(e) => setProps((p) => ({ ...p, [k]: e.target.value }))} /></Field>)}</div>
          <div className="mt-2 flex flex-wrap gap-1">{Object.entries(states).map(([n, s]) => <Button key={n} size="xs" variant="secondary" onClick={() => setProps((p) => ({ ...p, ...s }))}>{n}</Button>)}</div></Card>
        <Card title="Preview"><iframe title="Playground" sandbox={SANDBOX} srcDoc={`<body style="margin:16px;font-family:system-ui">${html}</body>`} className="h-40 w-full rounded border border-border bg-white" /><pre className="mt-2 max-h-24 overflow-auto rounded bg-background p-2 font-mono text-[10px]">{html}</pre></Card></div>
      <Card title="Сохранённые примеры"><div className="mb-2 flex gap-2"><input className={inputCls} placeholder="название" value={name} onChange={(e) => setName(e.target.value)} /><Button size="sm" disabled={!name.trim()} onClick={() => { setExamples((a) => [...a, { name: name.trim(), props }]); setName(""); }}>Сохранить</Button></div>
        {examples.length === 0 ? <Empty>Примеров нет</Empty> : <ul className="space-y-1">{examples.map((e, i) => <li key={i} className="flex items-center gap-2 text-xs"><button className="flex-1 text-left hover:underline" onClick={() => setProps(e.props)}>{e.name}</button><button aria-label="Удалить" onClick={() => setExamples((a) => a.filter((_, k) => k !== i))}><Trash2 className="size-3.5 text-muted" /></button></li>)}</ul>}</Card>
    </div>
  );
}

/* ---------------------------- 29. Animation studio -------------------------- */

const DEFAULT_ANIM: Animation = { name: "fade-up", duration: 600, easing: "ease-out", iterations: 1, keyframes: [{ at: 0, props: { opacity: "0", transform: "translateY(16px)" } }, { at: 100, props: { opacity: "1", transform: "translateY(0)" } }] };
const parseProps = (s: string) => Object.fromEntries(s.split(";").map((x) => x.split(":")).filter((p) => p.length >= 2 && p[0]?.trim()).map((p) => [p[0]?.trim() ?? "", p.slice(1).join(":").trim()]));

export function AnimationPanel() {
  const files = useFiles();
  const [anim, setAnim] = usePersisted<Animation>("animation", DEFAULT_ANIM);
  const [t, setT] = useState<number | null>(null); const [run, setRun] = useState(0);
  const [fmt, setFmt] = useState<"css" | "js">("css"); const [changes, setChanges] = useState<Change[]>([]);
  const name = anim.name.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "anim";
  const css = animationToCss(anim);
  const style = t === null ? `.box{animation:${name} ${anim.duration}ms ${anim.easing} ${anim.iterations}}` : `.box{animation:${name} ${anim.duration}ms ${anim.easing} 1;animation-play-state:paused;animation-delay:-${(t / 100) * anim.duration}ms}`;
  const doc = `<style>body{margin:0;display:grid;place-items:center;height:140px;background:#0a0a0a}.box{width:56px;height:56px;border-radius:12px;background:#6366f1}${css.split(`.${name} {`)[0]}${style}</style><div class="box" data-r="${run}"></div>`;
  const setKf = (i: number, fn: (k: Animation["keyframes"][number]) => Animation["keyframes"][number]) => setAnim((a) => ({ ...a, keyframes: a.keyframes.map((k, n) => (n === i ? fn(k) : k)) }));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Параметры"><div className="grid grid-cols-2 gap-2"><Field label="Имя"><input className={inputCls} value={anim.name} onChange={(e) => setAnim({ ...anim, name: e.target.value })} /></Field>
          <Field label="Длительность, мс"><input type="number" min={50} max={20000} className={inputCls} value={anim.duration} onChange={(e) => setAnim({ ...anim, duration: Math.min(20000, Math.max(50, Number(e.target.value) || 50)) })} /></Field>
          <Field label="Easing"><select className={inputCls} value={anim.easing} onChange={(e) => setAnim({ ...anim, easing: e.target.value })}>{EASINGS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Повторы"><select className={inputCls} value={String(anim.iterations)} onChange={(e) => setAnim({ ...anim, iterations: e.target.value === "infinite" ? "infinite" : Number(e.target.value) })}><option value="1">1</option><option value="3">3</option><option value="infinite">∞</option></select></Field></div></Card>
        <Card title="Preview" actions={<Button size="xs" onClick={() => { setT(null); setRun((r) => r + 1); }}><Play />Играть</Button>}><iframe key={`${run}-${t === null}-${css}`} title="Animation preview" sandbox={SANDBOX} srcDoc={doc} className="h-36 w-full rounded border border-border" />
          <label className="mt-2 block text-[11px] text-subtle">Таймлайн: {t === null ? "воспроизведение" : `${Math.round(t)}%`}<input type="range" min={0} max={100} value={t ?? 0} className="w-full" aria-label="Позиция на таймлайне" onChange={(e) => setT(Number(e.target.value))} /></label></Card></div>
      <Card title="Keyframes" actions={<Button size="xs" variant="secondary" onClick={() => setAnim((a) => ({ ...a, keyframes: [...a.keyframes, { at: 50, props: { opacity: "1" } }] }))}><Plus />Кадр</Button>}>
        <div className="relative mb-3 h-6 rounded bg-hover">{anim.keyframes.map((k, i) => <span key={i} title={`${k.at}%`} className="absolute top-1 size-4 -translate-x-1/2 rounded-full bg-accent" style={{ left: `${k.at}%` }} />)}</div>
        <ul className="space-y-1.5">{anim.keyframes.map((k, i) => <li key={i} className="flex items-center gap-2"><input type="number" min={0} max={100} aria-label="Позиция кадра, %" className={cn(inputCls, "w-16")} value={k.at} onChange={(e) => setKf(i, (x) => ({ ...x, at: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))} />%
          <input aria-label="CSS-свойства кадра" className={cn(inputCls, "font-mono")} defaultValue={Object.entries(k.props).map(([p, v]) => `${p}: ${v}`).join("; ")} onBlur={(e) => setKf(i, (x) => ({ ...x, props: parseProps(e.target.value) }))} />
          {anim.keyframes.length > 2 && <button aria-label="Удалить кадр" onClick={() => setAnim((a) => ({ ...a, keyframes: a.keyframes.filter((_, n) => n !== i) }))}><Trash2 className="size-3.5 text-muted" /></button>}</li>)}</ul></Card>
      <Card title="Экспорт"><div className="flex flex-wrap items-center gap-2"><select aria-label="Формат" className={cn(inputCls, "w-40")} value={fmt} onChange={(e) => setFmt(e.target.value as "css" | "js")}><option value="css">CSS @keyframes</option><option value="js">JS (framer-motion)</option></select>
        <Button size="sm" onClick={() => { const path = `src/animations/${name}.${fmt}`; setChanges([{ path, before: files[path] ?? null, after: fmt === "css" ? css : animationToJs(anim) }]); }}>Подготовить файл</Button></div>
        {changes.length > 0 && <div className="mt-2"><ChangeSet changes={changes} source="Animation Studio" /></div>}</Card>
    </div>
  );
}
