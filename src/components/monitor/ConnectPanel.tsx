"use client";

import { useState } from "react";
import { Check, Copy, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { connectUrl } from "@/lib/monitor/client";
import type { MonitorStatus } from "@/lib/monitor/types";
import { VercelMark } from "@/components/account/AccountSection";
import { Card, Notice } from "@/components/code/ui";
import { LegalLinks } from "@/components/legal/LegalLinks";

const DOC_URL = "https://github.com/frontos123456789-byte/nexus-ide/blob/main/docs/VERCEL_MONITOR_SETUP.md";
const btn = "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold transition-colors sm:w-auto";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-medium text-subtle">{label}</div>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background px-3">
        <code className="min-w-0 flex-1 break-all py-2 text-[12px]">{value}</code>
        <button
          aria-label={`Копировать: ${label}`}
          className="grid size-10 shrink-0 place-items-center rounded-lg text-muted hover:bg-hover"
          onClick={() => navigator.clipboard.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }, () => toast.error("Не удалось скопировать"))}
        >
          {done ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function SetupInstructions({ s }: { s: MonitorStatus }) {
  return (
    <div className="space-y-3">
      <Notice tone="warn">
        Интеграция <b>Vercel Monitor</b> ещё не зарегистрирована владельцем Nexus. Vercel не позволяет создавать Integration через API — это делается один раз вручную в Vercel Dashboard.
      </Notice>
      <Card className="space-y-3">
        <div className="text-sm font-semibold">Что ввести в Vercel → Integrations Console → Create</div>
        <ol className="list-decimal space-y-1 pl-5 text-xs leading-relaxed text-subtle">
          <li>Тип: <b>External</b> (connectable). Название, <b>Slug</b> (например <code>nexus-vercel-monitor</code>), иконка, описание, URL сайта.</li>
          <li><b>Redirect URL</b> — значение ниже.</li>
          <li><b>API Scopes</b>: <b>Projects → Read</b>, <b>Deployments → Read</b>. По желанию Team → Read и User → Read (только для отображения имени). Всё остальное — <b>None</b>. Никакого Read/Write.</li>
          <li><b>Webhook URL</b> (по желанию, событие <code>integration-configuration.removed</code>) — значение ниже.</li>
          <li>После создания скопируйте <b>Client ID</b> и <b>Client Secret</b> и добавьте переменные окружения Nexus (ниже), затем передеплойте.</li>
        </ol>
        <CopyRow label="Redirect URL" value={s.setup.redirectUrl} />
        <CopyRow label="Webhook URL (необязательно)" value={s.setup.webhookUrl} />
        <CopyRow label="Переменные окружения Nexus" value={`${s.setup.envVars[0]}=<Client ID>\n${s.setup.envVars[1]}=<Client Secret>\n${s.setup.envVars[2]}=<slug интеграции>`} />
        <a href={DOC_URL} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-accent-soft underline">Полная инструкция: docs/VERCEL_MONITOR_SETUP.md</a>
      </Card>
    </div>
  );
}

/** Everything shown BEFORE the monitor is connected. No demo data: only the real next step. */
export function ConnectPanel({ s }: { s: MonitorStatus }) {
  const missing = !s.configured.database ? "На сервере не настроена база данных (DATABASE_URL) — аккаунты Nexus недоступны." : !s.configured.encryption ? "На сервере не задан NEXUS_ENCRYPTION_KEY — токены Vercel нельзя хранить безопасно." : null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="space-y-2 text-center">
        <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent/15"><VercelMark className="size-7" /></div>
        <h2 className="text-xl font-semibold">Vercel Monitor</h2>
        <p className="text-sm text-muted">Проекты, Production и Preview деплои, статусы, ветки, коммиты и логи вашего аккаунта Vercel — в реальном времени.</p>
      </div>
      {missing && <Notice tone="err">{missing}</Notice>}
      {!missing && !s.signedIn && (
        <Card className="space-y-3 text-center">
          <p className="text-sm text-subtle">Сначала войдите в Nexus — подключение Vercel привязывается к вашему аккаунту.</p>
          <a href={`/login?next=${encodeURIComponent("/code?view=vercel")}`} className={`${btn} mx-auto bg-accent text-white hover:bg-accent-soft`}><LogIn className="size-4" />Войти в Nexus</a>
        </Card>
      )}
      {!missing && s.signedIn && s.configured.integration && (
        <Card className="space-y-3 text-center">
          <a href={connectUrl()} className={`${btn} mx-auto bg-accent text-white hover:bg-accent-soft`}><VercelMark className="size-5" />Подключить Vercel</a>
          <div className="mx-auto flex max-w-md items-start gap-2 text-left text-[11px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            <span>Откроется официальная страница установки интеграции Vercel. Доступ <b>только на чтение</b> (проекты и деплои). Токен вводить не нужно; он хранится зашифрованным и никогда не попадает в браузер. Монитор не умеет создавать, менять или удалять проекты и деплои.</span>
          </div>
        </Card>
      )}
      <p className="text-center text-[11px] leading-relaxed text-muted">
        Подключая Vercel, вы принимаете условия <LegalLinks prefix="(English):" />. Что именно читается, как хранится токен и как всё удалить — в Privacy Policy.
      </p>
      {!missing && s.signedIn && !s.configured.integration && <SetupInstructions s={s} />}
      {!missing && !s.signedIn && !s.configured.integration && <SetupInstructions s={s} />}
    </div>
  );
}
