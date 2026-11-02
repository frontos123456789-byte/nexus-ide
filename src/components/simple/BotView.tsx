"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Download, ExternalLink, KeyRound, RefreshCw, Rocket, Code2 } from "lucide-react";
import { toast } from "sonner";
import { ProjectDashboard } from "@/components/code/ControlCenter";
import type { ProjectRecord } from "@/lib/db/schema";
import { callIntegration, connectProvider, disconnectProvider, fetchConnections, type ConnState } from "@/lib/integrations/client";
import { useSettings } from "@/lib/settings/store";
import { friendlyError, getMeta, setMeta } from "@/lib/simple/projects";
import { ideUrl, projectFiles, saveProjectFile } from "@/lib/studio/projects";
import { generateBot } from "@/lib/studio/telegram-templates";
import { Button, ConfirmDialog, ErrorBox, Help, Loading, LinkButton, Notice, Panel, TextArea, TextInput } from "./ui";
import { BOT_FEATURES, buildBotConfig, BOT_GOALS, DialogPreview, PLACEHOLDER_PREFIX, sampleDialog, type BotMeta } from "./wizards/BotWizard";
import { downloadZip } from "./SiteView";

interface Me { username?: string; first_name?: string }
interface Hook { url?: string; pending_update_count?: number; last_error_message?: string }

type Status = "checking" | "need-telegram" | "need-launch" | "running" | "problem";

const STATUS_TEXT: Record<Status, { title: string; text: string; tone: "info" | "success" | "warn" | "error" }> = {
  checking: { title: "Проверяю состояние…", text: "Это займёт несколько секунд.", tone: "info" },
  "need-telegram": { title: "Бот создан. Осталось подключить Telegram", text: "Бот готов, но Telegram о нём ещё ничего не знает. Выполните шаги ниже — это займёт около пяти минут.", tone: "warn" },
  "need-launch": { title: "Telegram подключён. Бот создан, но ещё не запущен", text: "Чтобы бот начал отвечать людям, его нужно запустить на компьютере или сервере (шаг 3). Пока он не запущен, в Telegram он молчит.", tone: "warn" },
  running: { title: "Бот запущен", text: "Telegram отправляет сообщения вашему боту, он должен отвечать. Проверьте: напишите ему /start.", tone: "success" },
  problem: { title: "Есть проблема с запуском", text: "Telegram не смог доставить сообщения боту. Подробности ниже.", tone: "error" },
};

export function BotView({ project, onChanged }: { project: ProjectRecord; onChanged: () => void }) {
  const devMode = useSettings((s) => s.devMode);
  const [conn, setConn] = useState<ConnState | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [hook, setHook] = useState<Hook | null>(null);
  const [status, setStatus] = useState<Status>("checking");
  const [meta, setMetaState] = useState<BotMeta | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [confirmOff, setConfirmOff] = useState(false);

  const check = useCallback(async () => {
    setStatus("checking");
    setError(null);
    const c = await fetchConnections();
    setConn(c);
    if (!c) return setStatus("need-telegram");
    if (!c.telegram.connected) {
      setMe(null);
      setHook(null);
      return setStatus("need-telegram");
    }
    try {
      const m = await callIntegration<Me>("telegram", { action: "me" });
      setMe(m);
      const h = await callIntegration<Hook>("telegram", { action: "webhookInfo" });
      setHook(h);
      setStatus(h.last_error_message ? "problem" : h.url ? "running" : "need-launch");
    } catch (e) {
      setError(friendlyError(e));
      setStatus("problem");
    }
  }, []);

  useEffect(() => {
    void check();
    void getMeta<BotMeta>(project.id).then((m) => {
      if (m?.config) {
        setMetaState(m);
        setTexts(m.texts ?? {});
      }
    });
  }, [check, project.id]);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await connectProvider("telegram", token.trim());
      setToken("");
      toast.success("Telegram подключён");
      await check();
    } catch (e) {
      setError(`Не удалось подключить. Проверьте, что вы скопировали ключ целиком, без пробелов. ${friendlyError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const saveReplies = async () => {
    if (!meta) return;
    setBusy(true);
    try {
      const goal = BOT_GOALS.find((g) => g.template === meta.config.template) ?? (BOT_GOALS[5] as (typeof BOT_GOALS)[number]);
      const config = buildBotConfig(meta.config.name, meta.config.description, goal, meta.features, texts);
      for (const f of generateBot(config)) await saveProjectFile(project, f.path, f.content);
      const next: BotMeta = { config, features: meta.features, texts };
      await setMeta(project.id, next);
      setMetaState(next);
      toast.success("Ответы бота сохранены");
      onChanged();
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const files = async () => (await projectFiles(project.folder)).map((f) => ({ path: f.rel, content: f.content }));
  const goal = BOT_GOALS.find((g) => g.template === meta?.config.template) ?? (BOT_GOALS[5] as (typeof BOT_GOALS)[number]);
  const connected = conn?.telegram.connected;
  const st = STATUS_TEXT[status];
  const hasPlaceholders = meta ? meta.config.commands.some((c) => c.reply.startsWith(PLACEHOLDER_PREFIX)) : false;
  const features = BOT_FEATURES.filter((f) => f.ask && meta?.features.includes(f.id));

  return (
    <div className="space-y-5">
      <Notice tone={st.tone} title={st.title}>{st.text}</Notice>
      {me?.username && <p className="text-[1.0625rem]">Ваш бот в Telegram: <a className="font-semibold text-indigo-200 underline underline-offset-4" href={`https://t.me/${me.username}`} target="_blank" rel="noopener noreferrer">@{me.username}</a></p>}
      {status !== "checking" && <Button variant="secondary" onClick={() => void check()}><RefreshCw className="size-5" aria-hidden />Проверить ещё раз</Button>}
      {hook?.last_error_message && <Notice tone="error" title="Сообщение от Telegram">{hook.last_error_message}</Notice>}
      {error && <ErrorBox message={error} onRetry={() => void check()} />}
      {hasPlaceholders && <Notice tone="warn" title="Не все ответы заполнены">В некоторых ответах бота стоят пустые места в квадратных скобках. Впишите свои тексты ниже, в разделе «Ответы бота».</Notice>}

      {meta && (
        <Panel className="space-y-3">
          <h2 className="text-xl font-bold">Так бот будет отвечать</h2>
          <DialogPreview items={sampleDialog(meta.config.name, goal, meta.features, texts)} />
        </Panel>
      )}

      <Panel className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-bold">{connected ? <CheckCircle2 className="size-6 text-emerald-300" aria-hidden /> : <CircleDashed className="size-6 text-amber-300" aria-hidden />}Шаг 1–2. Подключите Telegram {connected && <span className="text-base font-semibold text-emerald-300">— готово</span>}</h2>
        {!connected && (
          <>
            <Help title="Как получить ключ доступа — пошагово">
              <ol className="list-decimal space-y-2 pl-5">
                <li>Откройте Telegram и найдите помощника по имени <a className="font-semibold text-indigo-200 underline underline-offset-4" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">@BotFather<ExternalLink className="ml-1 inline size-4" aria-hidden /></a> (у него синяя галочка).</li>
                <li>Отправьте ему слово <b>/newbot</b>.</li>
                <li>Он спросит имя бота — напишите любое, например «{meta?.config.name ?? "Мой бот"}».</li>
                <li>Потом он попросит короткий адрес бота латинскими буквами, который заканчивается на <b>bot</b>, например <b>moya_kofeynya_bot</b>.</li>
                <li>В ответ BotFather пришлёт длинный ключ доступа — строку из цифр и букв. Нажмите на неё, чтобы скопировать.</li>
                <li>Вставьте ключ в поле ниже и нажмите «Подключить».</li>
              </ol>
              <p><b>Зачем нужен ключ?</b> Это как пропуск: он позволяет программе писать от имени вашего бота. Никому его не показывайте. Мы храним его в зашифрованном виде и не показываем на экране.</p>
            </Help>
            <form onSubmit={(e) => { e.preventDefault(); if (token.trim()) void connect(); }} className="space-y-3">
              <TextInput label="Ключ доступа от BotFather" type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)} placeholder="Вставьте сюда длинный ключ" hint="Он будет скрыт точками — это нормально." />
              {busy ? <Loading text="Проверяю ключ…" /> : <Button type="submit" disabled={token.trim().length < 20}><KeyRound className="size-5" aria-hidden />Подключить</Button>}
            </form>
          </>
        )}
        {connected && (
          <>
            <p className="text-[1.0625rem] text-subtle">Telegram подключён{conn?.telegram.login ? ` как @${conn.telegram.login}` : ""}. Ключ хранится в зашифрованном виде.</p>
            <Button variant="secondary" onClick={() => setConfirmOff(true)}>Отключить Telegram</Button>
          </>
        )}
      </Panel>

      <Panel className="space-y-4">
        <h2 className="flex items-center gap-2 text-xl font-bold"><Rocket className="size-6" aria-hidden />Шаг 3. Запустите бота</h2>
        <p className="text-[1.0625rem] leading-relaxed text-subtle">Сейчас бот — это готовая программа. Чтобы он отвечал людям, её нужно запустить и держать включённой. Nexus пока не умеет запускать ботов за вас, поэтому честно показываю, как это сделать:</p>
        <Help title="Запуск на своём компьютере (проще всего)">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Установите <a className="font-semibold text-indigo-200 underline underline-offset-4" href="https://nodejs.org/ru" target="_blank" rel="noopener noreferrer">Node.js</a> (кнопка «Скачать LTS»).</li>
            <li>Нажмите ниже «Скачать файлы бота» и распакуйте архив.</li>
            <li>В папке бота создайте файл <b>.env</b> и напишите в нём: <code className="rounded bg-black/40 px-1.5 py-0.5">BOT_TOKEN=ваш_ключ_от_BotFather</code></li>
            <li>Откройте в этой папке командную строку и выполните: <code className="rounded bg-black/40 px-1.5 py-0.5">npm install</code>, затем <code className="rounded bg-black/40 px-1.5 py-0.5">npm start</code>.</li>
            <li>Пока окно открыто и компьютер включён — бот отвечает.</li>
          </ol>
          <p>Чтобы бот работал круглые сутки, его размещают на сервере (Railway, Render, VPS). Подробности есть в файле README внутри архива.</p>
        </Help>
        <Button variant="secondary" onClick={async () => { try { await downloadZip(project.name, await files()); toast.success("Файлы бота скачаны"); } catch (e) { toast.error(friendlyError(e)); } }}><Download className="size-5" aria-hidden />Скачать файлы бота</Button>
      </Panel>

      {meta && features.length > 0 && (
        <Panel className="space-y-4">
          <h2 className="text-xl font-bold">Ответы бота</h2>
          {features.map((f) => (
            <TextArea key={f.id} label={f.ask as string} value={texts[f.id] ?? ""} onChange={(e) => setTexts({ ...texts, [f.id]: e.target.value.slice(0, 600) })} className="min-h-24" />
          ))}
          <Button onClick={() => void saveReplies()} disabled={busy}>Сохранить ответы</Button>
          <p className="text-base text-muted">После сохранения скачайте файлы бота заново и запустите их.</p>
        </Panel>
      )}

      {devMode ? (
        <Panel className="space-y-3">
          <h2 className="flex items-center gap-2 text-xl font-bold"><Code2 className="size-6" aria-hidden />Для разработчиков</h2>
          <LinkButton href={ideUrl(`${project.folder}/README.md`)} variant="secondary">Открыть в редакторе кода</LinkButton>
          <ProjectDashboard project={project} onChange={onChanged} />
          <p className="text-base text-muted">Расширенная работа с webhook и Telegram — в <Link href="/code" className="underline">Code Studio</Link>.</p>
        </Panel>
      ) : (
        <Help title="Для опытных: код бота и расширенные настройки">
          <p>Включите «Режим разработчика» в <Link href="/settings" className="font-semibold text-indigo-200 underline underline-offset-4">настройках</Link> — появятся редактор кода, GitHub и webhook. Проект не изменится.</p>
        </Help>
      )}

      <ConfirmDialog open={confirmOff} onOpenChange={setConfirmOff} title="Отключить Telegram?" text="Nexus забудет ключ доступа. Сам бот в Telegram останется, его можно подключить снова." confirmLabel="Да, отключить" danger onConfirm={async () => { await disconnectProvider("telegram"); toast.success("Telegram отключён"); await check(); }} />
    </div>
  );
}
