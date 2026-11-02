"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { callIntegration, connectProvider, disconnectProvider, fetchConnections, IntegrationError } from "@/lib/integrations/client";
import { useSettings } from "@/lib/settings/store";
import { createProject, ideUrl, listProjects, projectFiles, logActivity } from "@/lib/studio/projects";
import { BOT_TEMPLATES, botCommands, generateBot, type BotCommand, type BotConfig, type BotDb, type BotLang, type BotMode, type BotTemplateId } from "@/lib/studio/telegram-templates";
import type { ProjectRecord } from "@/lib/db/schema";
import { extractJson } from "@/lib/agents/parse";
import { Btn, Card, Field, generateText, inputCls, Notice, Pill } from "./ui";

export function TelegramStudio({ onChanged }: { onChanged: () => void }) {
  const [tab, setTab] = useState<"create" | "connect">("create");
  const [cfg, setCfg] = useState<BotConfig>({ name: "My Bot", description: "", lang: "python", template: "ai", commands: [], buttons: [], useAI: false, db: "none", mode: "polling" });
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<ProjectRecord | null>(null);
  const [preview, setPreview] = useState<{ rel: string; content: string }[]>([]);
  const [sel, setSel] = useState("");
  const model = useSettings((s) => s.preferredModel);
  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const tpl = BOT_TEMPLATES.find((t) => t.id === cfg.template);

  const fillFromDescription = async () => {
    if (cfg.description.trim().length < 10) return toast.error("Опишите бота подробнее (минимум 10 символов)");
    setBusy(true);
    try {
      const text = await generateText(
        "Ты проектируешь Telegram-бота. По описанию верни ТОЛЬКО JSON: {\"commands\":[{\"command\":\"латиница_цифры_подчёркивание\",\"description\":\"до 60 символов\",\"reply\":\"текст ответа\"}],\"buttons\":[\"текст кнопки\"]}. 2–6 команд, до 4 кнопок. Тексты на языке пользователя.",
        cfg.description,
        model,
        1500,
      );
      const j = extractJson(text) as { commands?: BotCommand[]; buttons?: string[] } | null;
      if (!j?.commands?.length) throw new Error("ИИ вернул неразборчивый ответ — попробуйте ещё раз");
      setCfg((c) => ({ ...c, commands: j.commands!.slice(0, 8).map((x) => ({ command: String(x.command), description: String(x.description ?? ""), reply: String(x.reply ?? "") })), buttons: (j.buttons ?? []).slice(0, 4).map(String) }));
      toast.success("Команды и кнопки сформированы по описанию");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка ИИ");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!cfg.name.trim()) return toast.error("Укажите название");
    setBusy(true);
    try {
      const files = generateBot(cfg);
      const p = await createProject({ name: cfg.name.trim(), kind: "telegram", stack: `${cfg.lang === "python" ? "Python" : "Node.js"} · ${cfg.mode}`, description: cfg.description, files });
      await logActivity({ agent: "Telegram Bot Studio", project: p.id, kind: "task", title: `Сгенерирован бот (${tpl?.title})`, detail: `${files.length} файлов` });
      setCreated(p);
      const pf = await projectFiles(p.folder);
      setPreview(pf);
      setSel(pf.find((f) => f.rel === "bot.py" || f.rel === "bot.js")?.rel ?? pf[0]?.rel ?? "");
      onChanged();
      toast.success(`Проект «${p.name}» создан`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать проект");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl border border-border bg-panel-2 p-1">
        {([["create", "Создание"], ["connect", "Подключение и тест"]] as const).map(([id, l]) => (
          <button key={id} onClick={() => setTab(id)} className={`min-h-10 flex-1 rounded-lg text-sm font-medium ${tab === id ? "bg-accent text-white" : "text-subtle"}`}>{l}</button>
        ))}
      </div>
      {tab === "connect" ? <ConnectPanel /> : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="space-y-3">
            <Field label="Название бота"><input className={inputCls} value={cfg.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Описание — что должен делать бот">
              <textarea className={`${inputCls} min-h-24 py-2`} value={cfg.description} onChange={(e) => set("description", e.target.value)} placeholder="Бот для записи клиентов в барбершоп: показывает услуги, принимает заявки и напоминает о визите" />
            </Field>
            <Btn variant="ghost" onClick={fillFromDescription} disabled={busy} className="w-full"><Sparkles className="size-4" />{busy ? "Генерирую…" : "Сформировать команды по описанию (ИИ)"}</Btn>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Язык"><select className={inputCls} value={cfg.lang} onChange={(e) => set("lang", e.target.value as BotLang)}><option value="python">Python</option><option value="node">Node.js</option></select></Field>
              <Field label="Режим"><select className={inputCls} value={cfg.mode} onChange={(e) => set("mode", e.target.value as BotMode)}><option value="polling">Polling</option><option value="webhook">Webhook</option></select></Field>
              <Field label="База данных"><select className={inputCls} value={cfg.db} onChange={(e) => set("db", e.target.value as BotDb)}><option value="none">Нет</option><option value="sqlite">SQLite</option><option value="postgres">PostgreSQL</option></select></Field>
              <label className="flex min-h-11 items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-5" checked={cfg.useAI} onChange={(e) => set("useAI", e.target.checked)} />Подключить ИИ</label>
            </div>
            {cfg.mode === "polling" ? <Notice tone="warn">Polling требует постоянно работающего процесса. Обычный Vercel (serverless) для этого не подходит — используйте VPS, Railway, Fly.io, Render или Docker.</Notice> : <Notice tone="info">Webhook на Node.js можно развернуть на Vercel (api/webhook.js). Python-вариант запускает собственный сервер и требует постоянного хостинга.</Notice>}
          </Card>
          <Card className="space-y-3">
            <div className="text-sm font-semibold">Шаблон</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {BOT_TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => set("template", t.id as BotTemplateId)} aria-pressed={cfg.template === t.id} className={`min-h-16 rounded-xl border p-3 text-left ${cfg.template === t.id ? "border-accent bg-accent/15" : "border-border hover:bg-hover"}`}>
                  <div className="text-sm font-medium">{t.title}</div><div className="text-[11px] text-muted">{t.desc}</div>
                </button>
              ))}
            </div>
            <div className="text-sm font-semibold">Команды</div>
            <div className="space-y-2">
              {botCommands(cfg).filter((c) => !tpl?.commands.some((b) => b.command === c.command)).length === 0 && cfg.commands.length === 0 && <p className="text-xs text-muted">Базовые команды шаблона: {tpl?.commands.map((c) => `/${c.command}`).join(", ")}. Добавьте свои:</p>}
              {cfg.commands.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl border border-border p-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input aria-label="Команда" className={inputCls} placeholder="команда" value={c.command} onChange={(e) => set("commands", cfg.commands.map((x, j) => (j === i ? { ...x, command: e.target.value } : x)))} />
                    <input aria-label="Описание" className={inputCls} placeholder="описание" value={c.description} onChange={(e) => set("commands", cfg.commands.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                    <input aria-label="Ответ" className={`${inputCls} sm:col-span-2`} placeholder="текст ответа" value={c.reply} onChange={(e) => set("commands", cfg.commands.map((x, j) => (j === i ? { ...x, reply: e.target.value } : x)))} />
                  </div>
                  <button aria-label="Удалить команду" onClick={() => set("commands", cfg.commands.filter((_, j) => j !== i))} className="grid size-11 place-items-center rounded-xl text-muted hover:text-red-300"><Trash2 className="size-4" /></button>
                </div>
              ))}
              <Btn variant="ghost" onClick={() => set("commands", [...cfg.commands, { command: "", description: "", reply: "" }])} className="w-full"><Plus className="size-4" />Добавить команду</Btn>
            </div>
            <Field label="Кнопки меню (через запятую)"><input className={inputCls} value={cfg.buttons.join(", ")} onChange={(e) => set("buttons", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="Услуги, Записаться, Контакты" /></Field>
            <Btn onClick={create} disabled={busy} className="w-full">{busy ? "Создаю…" : "Создать проект бота"}</Btn>
          </Card>
          {created && (
            <Card className="space-y-3 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-2"><Pill tone="ok">Проект создан</Pill><span className="text-sm font-medium">{created.name}</span><span className="text-xs text-muted">{created.folder}</span>
                <Link href={ideUrl(`${created.folder}/${cfg.lang === "python" ? "bot.py" : "bot.js"}`)} className="ml-auto inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-white">Открыть в IDE</Link></div>
              <div className="flex gap-1 overflow-x-auto">{preview.map((f) => <button key={f.rel} onClick={() => setSel(f.rel)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs ${sel === f.rel ? "bg-accent/20 text-foreground" : "text-subtle hover:bg-hover"}`}>{f.rel}</button>)}</div>
              <pre className="max-h-96 max-w-full overflow-auto rounded-xl border border-border bg-background p-3 text-[12px] leading-relaxed">{preview.find((f) => f.rel === sel)?.content}</pre>
              <Notice tone="info">Дальше: вкладка «Подключение и тест» — проверить токен и зарегистрировать команды/webhook; раздел «Проекты» — создать репозиторий GitHub и подготовить деплой.</Notice>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ConnectPanel() {
  const [conn, setConn] = useState<{ connected: boolean; login?: string } | null>(null);
  const [token, setToken] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [chat, setChat] = useState("");
  const [text, setText] = useState("Тестовое сообщение от Nexus");
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [pid, setPid] = useState("");
  const push = (s: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${s}`, ...l].slice(0, 40));
  const refresh = () => void fetchConnections().then((c) => setConn(c?.telegram ?? { connected: false }));
  useEffect(() => { refresh(); void listProjects().then((p) => { const t = p.filter((x) => x.kind === "telegram"); setProjects(t); setPid(t[0]?.id ?? ""); }); }, []);

  const call = async (body: Record<string, unknown>, label: string) => {
    try {
      const d = await callIntegration<unknown>("telegram", body);
      push(`✅ ${label}: ${JSON.stringify(d).slice(0, 300)}`);
      return d;
    } catch (e) {
      push(`❌ ${label}: ${e instanceof IntegrationError ? e.message : "ошибка"}`);
      return null;
    }
  };
  const setCommandsFromProject = async () => {
    const p = projects.find((x) => x.id === pid);
    if (!p) return push("❌ Выберите проект бота");
    const files = await projectFiles(p.folder);
    const src = files.find((f) => f.rel === "bot.py" || f.rel === "bot.js")?.content ?? "";
    const cmds = [...src.matchAll(/(?:BotCommand\(|\{ command: )"([a-z0-9_]+)"(?:, "|, description: ")([^"]*)"/g)].map((m) => ({ command: m[1] as string, description: (m[2] as string) || m[1] as string }));
    if (!cmds.length) return push("❌ Не удалось найти список команд в коде");
    await call({ action: "setCommands", commands: cmds }, `setMyCommands (${cmds.length})`);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="space-y-3">
        <div className="flex items-center gap-2"><span className="text-sm font-semibold">Токен бота</span>{conn?.connected ? <Pill tone="ok">подключён {conn.login}</Pill> : <Pill tone="warn">не подключён</Pill>}</div>
        <Notice tone="info">Токен отправляется на сервер один раз, шифруется и хранится в httpOnly-cookie. Браузерный JavaScript его больше не видит; в код проекта токен не попадает — только в .env на вашем хостинге.</Notice>
        {conn?.connected ? (
          <Btn variant="ghost" onClick={async () => { await disconnectProvider("telegram"); setToken(""); refresh(); push("Токен отключён"); }}>Отключить токен</Btn>
        ) : (
          <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); try { const r = await connectProvider("telegram", token); setToken(""); push(`✅ Подключён ${r.login}`); refresh(); } catch (er) { toast.error(er instanceof Error ? er.message : "Ошибка"); } }}>
            <input type="password" autoComplete="off" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456:ABC… (от @BotFather)" aria-label="Токен бота" />
            <Btn className="w-full" disabled={token.length < 20}>Проверить и подключить</Btn>
          </form>
        )}
        <div className="grid grid-cols-2 gap-2"><Btn variant="ghost" disabled={!conn?.connected} onClick={() => void call({ action: "me" }, "getMe")}>getMe</Btn><Btn variant="ghost" disabled={!conn?.connected} onClick={() => void call({ action: "webhookInfo" }, "webhookInfo")}>Статус webhook</Btn><Btn variant="ghost" disabled={!conn?.connected} onClick={() => void call({ action: "updates" }, "getUpdates")}>Последние апдейты</Btn></div>
        <Field label="Команды из проекта → BotFather меню">
          <select className={inputCls} value={pid} onChange={(e) => setPid(e.target.value)}>{projects.length === 0 && <option value="">Нет проектов-ботов</option>}{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </Field>
        <Btn variant="ghost" disabled={!conn?.connected || !pid} onClick={() => void setCommandsFromProject()}>Зарегистрировать команды</Btn>
      </Card>
      <Card className="space-y-3">
        <div className="text-sm font-semibold">Webhook и тестовое сообщение</div>
        <Field label="Публичный HTTPS URL" hint="Например https://my-bot.vercel.app/api/webhook"><input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></Field>
        <Field label="Secret token (необязательно)"><input className={inputCls} value={secret} onChange={(e) => setSecret(e.target.value.replace(/[^A-Za-z0-9_-]/g, ""))} /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Btn disabled={!conn?.connected || !url} onClick={() => { if (confirm(`Установить webhook на ${url}? Polling перестанет работать.`)) void call({ action: "setWebhook", url, secret: secret || undefined, confirm: true }, "setWebhook"); }}>Установить</Btn>
          <Btn variant="danger" disabled={!conn?.connected} onClick={() => { if (confirm("Удалить webhook?")) void call({ action: "deleteWebhook", confirm: true }, "deleteWebhook"); }}>Удалить</Btn>
        </div>
        <Field label="Chat ID для теста"><input className={inputCls} value={chat} onChange={(e) => setChat(e.target.value)} inputMode="numeric" placeholder="ваш chat id" /></Field>
        <input className={inputCls} value={text} onChange={(e) => setText(e.target.value)} aria-label="Текст сообщения" />
        <Btn variant="success" disabled={!conn?.connected || !chat} onClick={() => void call({ action: "send", chatId: chat, text }, "sendMessage")}>Отправить тест</Btn>
        <div className="text-sm font-semibold">Журнал</div>
        <pre className="max-h-64 min-h-24 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-border bg-background p-3 text-[11px]">{log.join("\n") || "Пока пусто"}</pre>
        <p className="text-[11px] text-muted">Логи работающего бота находятся на хостинге (stdout контейнера/процесса). Здесь отображаются ответы Bot API на ваши действия.</p>
      </Card>
    </div>
  );
}
