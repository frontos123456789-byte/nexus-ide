"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, ExternalLink, Pencil, Rocket, Smartphone, Monitor, Undo2, Sparkles, Code2 } from "lucide-react";
import { toast } from "sonner";
import { generateText } from "@/components/code/ui";
import { ProjectDashboard } from "@/components/code/ControlCenter";
import { parseFileBlocks } from "@/lib/agents/parse";
import type { ProjectRecord } from "@/lib/db/schema";
import { callIntegration, fetchConnections, IntegrationError, type ConnState } from "@/lib/integrations/client";
import { useSettings } from "@/lib/settings/store";
import { friendlyError, getMeta, setMeta } from "@/lib/simple/projects";
import { ideUrl, logActivity, projectFiles, safeRelPath, saveProjectFile, slugify, updateProject } from "@/lib/studio/projects";
import { previewHtml } from "@/lib/studio/site-templates";
import { Button, Chip, ConfirmDialog, ErrorBox, Help, Loading, LinkButton, Notice, Panel, TextArea } from "./ui";

type F = { path: string; rel: string; content: string };

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadZip(name: string, files: { path: string; content: string }[]) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.content);
  download(`${slugify(name)}.zip`, await zip.generateAsync({ type: "blob" }));
}

const EDIT_SYSTEM = `Ты — веб-дизайнер. Тебе дают текущие файлы сайта и просьбу пользователя. Внеси ровно то, что просят, остальное не меняй. Язык интерфейса — русский, крупный читаемый текст, высокий контраст, без внешних библиотек и картинок из интернета. Верни ВСЕ файлы целиком, каждый строго в формате:
<file path="index.html">ПОЛНОЕ содержимое</file>
Никакого текста до первого и после последнего </file>.`;

const IDEAS = ["Сделай текст крупнее", "Поменяй цвета на более тёплые", "Добавь раздел с отзывами клиентов", "Добавь блок с вопросами и ответами"];

interface PublishMeta {
  liveUrl?: string;
  repo?: string;
  vercelProject?: string;
  publishedAt?: number;
}

/* ------------------------------ publishing ------------------------------ */

function PublishPanel({ project, files, onChanged }: { project: ProjectRecord; files: F[]; onChanged: () => void }) {
  const [conn, setConn] = useState<ConnState | null | undefined>(undefined);
  const [meta, setMetaState] = useState<PublishMeta>({});
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setConn(await fetchConnections());
    setMetaState((await getMeta<PublishMeta>(`publish:${project.id}`)) ?? {});
  }, [project.id]);
  useEffect(() => { void refresh(); }, [refresh]);

  const explain = (e: unknown) => {
    if (e instanceof IntegrationError && (e.status === 401 || e.status === 403)) return "Доступ к вашему аккаунту закончился или не разрешён. Откройте «Настройки», подключите GitHub и Vercel заново и повторите.";
    return friendlyError(e);
  };

  const publish = async () => {
    setError(null);
    try {
      const payload = files.map((f) => ({ path: f.rel, content: f.content }));
      if (meta.repo) {
        setBusy("Обновляю сайт…");
        await callIntegration("github", { action: "commitFiles", repo: meta.repo, branch: "main", message: "Обновление сайта из Nexus", files: payload, confirm: true });
      } else {
        const base = slugify(project.name).slice(0, 30);
        const repoName = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        setBusy("Шаг 1 из 3: сохраняю файлы сайта…");
        const repo = await callIntegration<{ full_name: string }>("github", { action: "createRepo", name: repoName, description: project.description.slice(0, 200), private: true, confirm: true });
        await callIntegration("github", { action: "commitFiles", repo: repo.full_name, branch: "main", message: "Первая версия сайта из Nexus", files: payload, confirm: true });
        setBusy("Шаг 2 из 3: готовлю публикацию…");
        const vp = await callIntegration<{ id: string }>("vercel", { action: "createProject", name: repoName, repo: repo.full_name, framework: null, confirm: true });
        setBusy("Шаг 3 из 3: выкладываю сайт в интернет…");
        const dep = await callIntegration<{ url?: string }>("vercel", { action: "deploy", projectId: vp.id, target: "production", confirm: true });
        const next: PublishMeta = { repo: repo.full_name, vercelProject: vp.id, liveUrl: dep.url ? `https://${dep.url}` : undefined, publishedAt: Date.now() };
        await setMeta(`publish:${project.id}`, next);
        await updateProject(project.id, { githubRepo: repo.full_name, vercelProject: vp.id });
        await logActivity({ agent: "Nexus", project: project.id, kind: "deploy", title: "Сайт опубликован" });
      }
      toast.success(meta.repo ? "Сайт обновляется. Изменения появятся через минуту." : "Сайт опубликован!");
      await refresh();
      onChanged();
    } catch (e) {
      const base = explain(e);
      const raw = e instanceof Error ? e.message : "";
      setError(raw && !base.includes(raw) ? `${base} (Подробности: ${raw.slice(0, 160)})` : base);
    } finally {
      setBusy(null);
    }
  };

  const ready = conn?.github.connected && conn?.vercel.connected;

  return (
    <Panel className="space-y-4">
      <h2 className="text-xl font-bold">Опубликовать сайт</h2>
      {conn === undefined && <Loading text="Проверяю подключения…" />}
      {conn === null && <ErrorBox message="Не удалось проверить подключённые аккаунты. Проверьте интернет." onRetry={() => void refresh()} />}
      {meta.liveUrl && (
        <Notice tone="success" title="Сайт опубликован">
          Ссылка: <a className="break-all font-semibold underline underline-offset-4" href={meta.liveUrl} target="_blank" rel="noopener noreferrer">{meta.liveUrl}</a>
          <span className="mt-1 block text-base">Если ссылка пока не открывается — подождите 1–2 минуты, сайт ещё собирается.</span>
        </Notice>
      )}
      {conn && !ready && (
        <>
          <p className="text-[1.0625rem] leading-relaxed text-subtle">
            Чтобы сайт увидели другие люди, его нужно выложить в интернет. Для этого нужны два бесплатных аккаунта:
            <strong className="text-foreground"> GitHub</strong> (хранит файлы вашего сайта) и <strong className="text-foreground">Vercel</strong> (показывает сайт людям). Подключение займёт пару минут, пароли мы не видим.
          </p>
          <p className="text-base">Сейчас подключено: GitHub — <b>{conn.github.connected ? "да" : "нет"}</b>, Vercel — <b>{conn.vercel.connected ? "да" : "нет"}</b>.</p>
          <LinkButton href="/settings#accounts"><ExternalLink className="size-5" aria-hidden />Подключить аккаунты</LinkButton>
          <p className="text-base text-muted">Не хотите регистрироваться? Нажмите «Сохранить» — вы получите файл сайта, который можно открыть на компьютере или отправить знакомым.</p>
        </>
      )}
      {conn && ready && (
        <>
          <p className="text-[1.0625rem] text-subtle">Аккаунты подключены. {meta.repo ? "Нажмите, чтобы отправить в интернет последние изменения." : "Нажмите — и сайт станет доступен всем по ссылке."}</p>
          {busy ? <Loading text={busy} /> : <Button onClick={() => setAsk(true)}><Rocket className="size-5" aria-hidden />{meta.repo ? "Обновить опубликованный сайт" : "Опубликовать сейчас"}</Button>}
        </>
      )}
      {error && <ErrorBox message={error} onRetry={() => void publish()} extra={<LinkButton href="/settings#accounts" variant="secondary">Проверить подключения</LinkButton>} />}
      <ConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        title={meta.repo ? "Обновить сайт в интернете?" : "Опубликовать сайт?"}
        text={meta.repo ? "Новая версия заменит старую по той же ссылке." : "Сайт станет доступен всем, у кого есть ссылка. Файлы будут сохранены в вашем аккаунте GitHub (в закрытом хранилище)."}
        confirmLabel="Да, опубликовать"
        cancelLabel="Пока нет"
        onConfirm={publish}
      />
    </Panel>
  );
}

/* ------------------------------ the page ------------------------------ */

export function SiteView({ project, isApp, onChanged }: { project: ProjectRecord; isApp: boolean; onChanged: () => void }) {
  const devMode = useSettings((s) => s.devMode);
  const model = useSettings((s) => s.preferredModel);
  const [files, setFiles] = useState<F[] | null>(null);
  const [panel, setPanel] = useState<"none" | "edit" | "publish">("none");
  const [device, setDevice] = useState<"desktop" | "phone">(isApp ? "phone" : "desktop");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<F[] | null>(null);

  const load = useCallback(() => void projectFiles(project.folder).then(setFiles), [project.folder]);
  useEffect(load, [load]);

  const html = useMemo(() => (files ? previewHtml(files) : ""), [files]);

  const applyChange = async () => {
    if (!files || ask.trim().length < 3) return;
    const total = files.reduce((n, f) => n + f.content.length, 0);
    if (total > 34_000) {
      setError("Сайт получился слишком большим для быстрых правок через помощника. Включите режим разработчика в «Настройках» и измените файлы вручную — всё сохранится.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = files.filter((f) => /\.(html|css|js)$/.test(f.rel)).map((f) => `<file path="${f.rel}">${f.content}</file>`).join("\n");
      const out = await generateText(EDIT_SYSTEM, `Текущие файлы:\n${body}\n\nПросьба пользователя: ${ask.trim()}`, model, 8000);
      const blocks = parseFileBlocks(out).filter((b) => safeRelPath(b.path));
      if (!blocks.some((b) => b.path.endsWith(".html"))) throw new Error("ИИ не вернул готовую страницу");
      setUndo(files);
      for (const b of blocks) await saveProjectFile(project, b.path, b.content);
      await logActivity({ agent: "Nexus", project: project.id, kind: "task", title: "Сайт изменён по просьбе", detail: ask.slice(0, 120) });
      setAsk("");
      setPanel("none");
      load();
      onChanged();
      toast.success("Готово! Посмотрите, что получилось. Если не нравится — нажмите «Вернуть как было».");
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const revert = async () => {
    if (!undo) return;
    for (const f of undo) await saveProjectFile(project, f.rel, f.content);
    setUndo(null);
    load();
    onChanged();
    toast.success("Вернула как было");
  };

  const save = async () => {
    if (!files) return;
    try {
      if (files.length === 1 || (files.some((f) => f.rel === "index.html") && files.length <= 3)) download(`${slugify(project.name)}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));
      else await downloadZip(project.name, files.map((f) => ({ path: f.rel, content: f.content })));
      toast.success("Файл сохранён на ваше устройство");
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Как показать">
        {!isApp && (
          <>
            <Chip selected={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor className="mr-1.5 inline size-5" aria-hidden />Как на компьютере</Chip>
            <Chip selected={device === "phone"} onClick={() => setDevice("phone")}><Smartphone className="mr-1.5 inline size-5" aria-hidden />Как на телефоне</Chip>
          </>
        )}
      </div>

      <div className={device === "phone" ? "mx-auto w-full max-w-[390px] rounded-[2rem] border-4 border-border-strong bg-black p-2" : "w-full overflow-hidden rounded-2xl border-2 border-border-strong"}>
        {files ? (
          <iframe title={`Предпросмотр: ${project.name}`} sandbox="allow-scripts allow-forms" srcDoc={html} className={`block w-full rounded-2xl bg-white ${device === "phone" ? "h-[min(70dvh,640px)]" : "h-[min(68dvh,640px)]"}`} />
        ) : (
          <div className="p-4"><Loading text="Открываю предпросмотр…" /></div>
        )}
      </div>

      <p className="text-base text-muted">Изменения сохраняются автоматически в этом браузере.</p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Button onClick={() => setPanel(panel === "edit" ? "none" : "edit")} aria-expanded={panel === "edit"}><Pencil className="size-5" aria-hidden />Изменить</Button>
        <Button variant="success" onClick={() => setPanel(panel === "publish" ? "none" : "publish")} aria-expanded={panel === "publish"}><Rocket className="size-5" aria-hidden />Опубликовать</Button>
        <Button variant="secondary" onClick={() => void save()} disabled={!files}><Download className="size-5" aria-hidden />Сохранить</Button>
      </div>
      {undo && <Button variant="secondary" onClick={() => void revert()}><Undo2 className="size-5" aria-hidden />Вернуть как было</Button>}

      {panel === "edit" && (
        <Panel className="space-y-4">
          <h2 className="text-xl font-bold">Что изменить?</h2>
          <TextArea label="Опишите своими словами" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Например: поменяй главный заголовок и сделай кнопки зелёными" />
          <div className="grid gap-2 sm:grid-cols-2">{IDEAS.map((i) => <Chip key={i} onClick={() => setAsk(i)}>{i}</Chip>)}</div>
          {error && <ErrorBox message={error} onRetry={() => void applyChange()} />}
          {busy ? <Loading text="Вношу изменения…" /> : <Button onClick={() => void applyChange()} disabled={ask.trim().length < 3}><Sparkles className="size-5" aria-hidden />Внести изменения</Button>}
        </Panel>
      )}
      {panel === "publish" && files && <PublishPanel project={project} files={files} onChanged={onChanged} />}

      {devMode ? (
        <Panel className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Code2 className="size-6" aria-hidden />Для разработчиков</h2>
          <p className="text-base text-subtle">Файлов в проекте: {files?.length ?? "…"}. Папка: {project.folder}</p>
          <LinkButton href={ideUrl(`${project.folder}/index.html`)} variant="secondary">Открыть в редакторе кода</LinkButton>
          <ProjectDashboard project={project} onChange={onChanged} />
        </Panel>
      ) : (
        <Help title="Хотите править код самостоятельно?">
          <p>Включите «Режим разработчика» в <Link href="/settings" className="font-semibold text-indigo-200 underline underline-offset-4">настройках</Link>. Здесь появятся редактор кода, файлы и подключение GitHub. Ваш проект при этом не изменится.</p>
        </Help>
      )}
    </div>
  );
}
