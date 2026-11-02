"use client";

/** Browser-side helpers for the account system. No tokens ever pass through here: auth is an HttpOnly cookie. */

export interface AccountView {
  configured: {
    database: boolean;
    encryption: boolean;
    githubLogin: boolean;
    githubApp: boolean;
    vercelLogin: boolean;
    vercelIntegration: boolean;
    githubAppSlug: string | null;
  };
  user: null | { id: string; name: string; avatar: string | null; identities: { provider: "github" | "vercel"; login: string; avatar: string | null }[] };
  github: null | { connected: boolean; login: string | null; avatar: string | null; installationId: string | null; accountType: string | null; repoMode: "all" | "selected"; selectedRepos: string[]; manageUrl: string | null; permissions: Record<string, string> };
  vercel: null | { connected: boolean; login: string | null; teamId: string | null; configurationId: string | null; envAllow: string[] };
}

export async function fetchAccount(): Promise<AccountView | null> {
  try {
    const r = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    return r.ok ? ((await r.json()) as AccountView) : null;
  } catch {
    return null;
  }
}

const H = { "content-type": "application/json", "x-nexus-csrf": "1" };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { ...H, ...(init.headers ?? {}) }, credentials: "same-origin" });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j;
}

export const logout = (all = false) => call<{ ok: true }>(`/api/auth/logout${all ? "?all=1" : ""}`, { method: "POST" });
export const unlinkIdentity = (provider: "github" | "vercel") => call<{ ok: true }>("/api/auth/unlink", { method: "POST", body: JSON.stringify({ provider, confirm: true }) });
export const disconnect = (provider: "github" | "vercel", uninstall = false) => call<{ ok: true; warnings?: string[] }>(`/api/integrations/connections?provider=${provider}&confirm=1&uninstall=${uninstall ? 1 : 0}`, { method: "DELETE" });
export const manage = (body: Record<string, unknown>) => call<AccountView>("/api/integrations/connections", { method: "POST", body: JSON.stringify(body) });

const PROVIDER_NAME: Record<string, string> = { github: "GitHub", vercel: "Vercel", vercel_monitor: "Vercel" };

const MESSAGES: Record<string, (p: string) => string> = {
  cancelled: (p) => `Вы отменили авторизацию в ${p} — ничего не изменилось.`,
  state_mismatch: () => "Проверка безопасности (state) не пройдена: запрос устарел или был подменён. Начните заново.",
  not_configured: (p) => `Вход через ${p} ещё не настроен владельцем Nexus (см. docs/OAUTH_SETUP.md).`,
  app_not_configured: () => "GitHub App ещё не настроена владельцем Nexus (см. docs/OAUTH_SETUP.md).",
  integration_not_configured: () => "Vercel Integration ещё не настроена владельцем Nexus (см. docs/OAUTH_SETUP.md).",
  monitor_not_configured: () => "Интеграция Vercel Monitor ещё не зарегистрирована владельцем Nexus (см. docs/VERCEL_MONITOR_SETUP.md).",
  database_not_configured: () => "На сервере не настроена база данных — аккаунты недоступны.",
  encryption_not_configured: () => "На сервере не задан NEXUS_ENCRYPTION_KEY — токены нельзя хранить безопасно.",
  session_required: () => "Сначала войдите в Nexus.",
  session_changed: () => "Сессия изменилась во время авторизации — повторите.",
  already_linked_elsewhere: (p) => `Этот аккаунт ${p} уже привязан к другому пользователю Nexus. Автоматическое объединение запрещено.`,
  provider_already_linked: (p) => `К вашему аккаунту уже привязан другой аккаунт ${p}. Сначала отвяжите его.`,
  provider_error: (p) => `${p} вернул ошибку при авторизации. Попробуйте ещё раз.`,
  invalid_id_token: () => "Vercel вернул недействительный ID-токен — вход отклонён.",
  missing_code: () => "Провайдер не вернул код авторизации.",
  installation_not_owned: () => "Эта установка GitHub App недоступна вашему аккаунту GitHub — подключение отклонено.",
  reauth_required: () => "Сессия GitHub истекла — войдите через GitHub заново.",
  install_requested: () => "Запрос на установку отправлен владельцу организации — подключение появится после одобрения.",
  suspended: () => "Установка GitHub App приостановлена на GitHub.",
  bad_installation: () => "Некорректный идентификатор установки.",
  bad_configuration: () => "Некорректный идентификатор конфигурации Vercel.",
  verify_failed: () => "Не удалось проверить установку на GitHub. Повторите позже.",
  internal_error: () => "Внутренняя ошибка. Повторите позже.",
};

export function authErrorMessage(code: string, provider?: string | null): string {
  const p = PROVIDER_NAME[provider ?? ""] ?? "провайдер";
  return (MESSAGES[code] ?? (() => `Ошибка авторизации (${code}).`))(p);
}

export const AUTH_PARAMS = ["auth_error", "provider", "connected", "linked", "error", "settings"] as const;

/** Reads and removes the one-shot result params added by the OAuth callbacks. */
export function consumeAuthParams(): { error?: string; provider?: string; connected?: string; linked?: string; settings?: boolean } {
  const u = new URL(window.location.href);
  const r = {
    error: u.searchParams.get("auth_error") ?? undefined,
    provider: u.searchParams.get("provider") ?? undefined,
    connected: u.searchParams.get("connected") ?? undefined,
    linked: u.searchParams.get("linked") ?? undefined,
    settings: u.searchParams.get("settings") === "account",
  };
  if (r.error || r.connected || r.linked) {
    for (const k of ["auth_error", "provider", "connected", "linked"]) u.searchParams.delete(k);
    window.history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
  }
  return r;
}
