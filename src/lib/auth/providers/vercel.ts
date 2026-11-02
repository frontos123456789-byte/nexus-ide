import { urls, vercelConfig } from "../config";

/**
 * Vercel.
 *
 *  1. "Sign in with Vercel" (OIDC, authorization code + PKCE S256) – IDENTITY ONLY (openid/email/profile/offline_access).
 *     Vercel documents REST-API permissions for these tokens as "private beta", so they are not used for the API.
 *  2. Vercel Integration (external install flow: vercel.com/integrations/<slug>/new → Redirect URL → code exchange at
 *     /v2/oauth/access_token). This is the officially supported way to obtain a REST API token for projects,
 *     deployments, logs and environment variables on behalf of a user/team.
 */

export class VercelError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "vercel_error",
  ) {
    super(message);
  }
}

export function signInUrl(a: { redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const u = new URL(`${urls.vercelWeb()}/oauth/authorize`);
  u.searchParams.set("client_id", vercelConfig().signInId ?? "");
  u.searchParams.set("redirect_uri", a.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email profile offline_access");
  u.searchParams.set("state", a.state);
  u.searchParams.set("nonce", a.nonce);
  u.searchParams.set("code_challenge", a.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export interface VercelTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: Date;
  scope?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<VercelTokens> {
  const c = vercelConfig();
  const res = await fetch(`${urls.vercelApi()}/login/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: c.signInId ?? "", client_secret: c.signInSecret ?? "", ...params }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; id_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || j.error || !j.access_token) throw new VercelError(`Vercel не выдал токен: ${j.error_description ?? j.error ?? res.status}`, 401, "token_exchange_failed");
  return { accessToken: j.access_token, refreshToken: j.refresh_token, idToken: j.id_token, expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined, scope: j.scope };
}

export const exchangeSignInCode = (code: string, redirectUri: string, verifier: string) => tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });

export interface VercelProfile {
  id: string;
  login: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
}

/** ID-token claims are decoded (the token comes straight from Vercel's token endpoint over TLS) and checked: aud, exp, nonce. */
export function checkIdToken(idToken: string | undefined, nonce: string): boolean {
  if (!idToken) return false;
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { aud?: string | string[]; exp?: number; nonce?: string };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(vercelConfig().signInId)) return false;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return false;
    return claims.nonce === nonce;
  } catch {
    return false;
  }
}

export async function fetchSignInProfile(accessToken: string): Promise<VercelProfile> {
  const res = await fetch(`${urls.vercelApi()}/login/oauth/userinfo`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new VercelError(`Vercel userinfo: HTTP ${res.status}`, 401, "userinfo_failed");
  const u = (await res.json()) as { sub?: string; name?: string; preferred_username?: string; picture?: string; email?: string };
  if (!u.sub) throw new VercelError("Vercel не вернул идентификатор пользователя", 502, "userinfo_failed");
  return { id: u.sub, login: u.preferred_username ?? u.name ?? u.sub, name: u.name ?? null, avatar: u.picture ?? null, email: u.email ?? null };
}

export async function revokeSignInToken(token: string): Promise<void> {
  const c = vercelConfig();
  await fetch(`${urls.vercelApi()}/login/oauth/token/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token, client_id: c.signInId ?? "", client_secret: c.signInSecret ?? "" }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);
}

/* ------------------------------- Integration (REST API access) ------------------------------- */

export const integrationInstallUrl = (state: string): string => `${urls.vercelWeb()}/integrations/${encodeURIComponent(vercelConfig().integrationSlug ?? "")}/new?state=${encodeURIComponent(state)}`;

export interface IntegrationToken {
  accessToken: string;
  teamId: string | null;
  installationId: string | null;
  userId: string | null;
}

export async function exchangeIntegrationCode(code: string, redirectUri: string): Promise<IntegrationToken> {
  const c = vercelConfig();
  const res = await fetch(`${urls.vercelApi()}/v2/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.integrationId ?? "", client_secret: c.integrationSecret ?? "", code, redirect_uri: redirectUri }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; team_id?: string | null; installation_id?: string; user_id?: string; error?: { message?: string } | string };
  if (!res.ok || !j.access_token) throw new VercelError(`Vercel отклонил обмен кода: ${typeof j.error === "string" ? j.error : (j.error?.message ?? res.status)}`, 401, "token_exchange_failed");
  return { accessToken: j.access_token, teamId: j.team_id ?? null, installationId: j.installation_id ?? null, userId: j.user_id ?? null };
}

export async function vercelFetch<T>(token: string, teamId: string | null | undefined, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const url = new URL(`${urls.vercelApi()}${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const err = (json as { error?: { message?: string; code?: string } } | null)?.error;
    if (res.status === 401 || err?.code === "forbidden") throw new VercelError("Токен Vercel недействителен или доступ отозван", 401, "unauthorized");
    if (res.status === 403) throw new VercelError(`Недостаточно прав интеграции: ${err?.message ?? ""}`, 403, err?.code ?? "forbidden");
    throw new VercelError(err?.message ?? `Vercel HTTP ${res.status}`, res.status === 404 ? 404 : res.status === 429 ? 429 : 502, err?.code ?? "vercel_error");
  }
  return json as T;
}

/** Uninstalls the integration configuration on Vercel – this is what actually revokes the API token. */
export async function uninstallConfiguration(token: string, teamId: string | null, configurationId: string): Promise<void> {
  await vercelFetch(token, teamId, `/v1/integrations/configuration/${encodeURIComponent(configurationId)}`, { method: "DELETE" });
}
