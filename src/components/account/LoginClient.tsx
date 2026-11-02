"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/ide/Layout/Logo";
import { Notice } from "@/components/code/ui";
import { authErrorMessage, fetchAccount, type AccountView } from "@/lib/auth/client";
import { LoginButtons } from "./AccountSection";

export function LoginClient({ error, provider, next }: { error?: string; provider?: string; next: string }) {
  const [acc, setAcc] = useState<AccountView | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchAccount().then((a) => {
      setAcc(a);
      setLoaded(true);
      // Already signed in → no second login screen.
      if (a?.user) window.location.replace(next);
    });
  }, [next]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-[max(24px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))] text-foreground">
      <section className="w-full max-w-sm space-y-5 rounded-2xl border border-border bg-panel p-5 shadow-2xl sm:p-7">
        <div className="flex flex-col items-center gap-2 text-center">
          <Logo className="size-10" />
          <h1 className="text-xl font-semibold tracking-tight">Войти в Nexus</h1>
          <p className="text-sm text-muted">Авторизация проходит на официальном сайте провайдера. Пароли и токены вручную вводить не нужно.</p>
        </div>

        {error && <Notice tone={error === "cancelled" ? "info" : "err"}>{authErrorMessage(error, provider)}</Notice>}

        {!loaded && <div className="grid place-items-center py-4"><Loader2 className="size-5 animate-spin text-muted" aria-label="Загрузка" /></div>}
        {loaded && acc && <LoginButtons acc={acc} href={(p) => `/api/auth/login/${p}?next=${encodeURIComponent(next)}`} />}
        {loaded && !acc && <Notice tone="err">Сервер аккаунтов недоступен. Попробуйте позже.</Notice>}
        {loaded && acc && !acc.configured.database && <Notice tone="warn">На сервере не настроена база данных (DATABASE_URL) — вход пока недоступен.</Notice>}

        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted">
          <li>• При входе Nexus получает только имя, аватар и идентификатор. Доступ к репозиториям даётся отдельно и по вашему выбору.</li>
          <li>• Вход через Vercel подтверждает личность. Доступ к проектам Vercel подключается отдельно через Vercel Integration (ограничение Vercel: права на REST API для «Sign in with Vercel» пока в private beta).</li>
          <li>• Аккаунты не объединяются по e-mail — только через вход в уже существующий аккаунт.</li>
        </ul>

        <Link href={next} className="flex min-h-11 items-center justify-center rounded-xl text-sm text-subtle hover:bg-hover">Продолжить без аккаунта</Link>
      </section>
    </main>
  );
}
