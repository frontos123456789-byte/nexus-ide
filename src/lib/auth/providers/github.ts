import { createSign } from "node:crypto";
import { githubConfig, urls } from "../config";

/** Server-only GitHub helpers: OAuth web flow (+PKCE), GitHub App JWT and short-lived installation tokens. */

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = "github_error",
  ) {
    super(message);
  }
}

const UA = "nexus-ai";

export async function ghFetch<T>(path: string, o: { token?: string; method?: string; body?: unknown; basic?: string } = {}): Promise<T> {
  const res = await fetch(path.startsWith("http") ? path : `${urls.githubApi()}${path}`, {
    method: o.method ?? "GET",
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...(o.basic ? { authorization: `Basic ${o.basic}` } : {}),
      ...(o.body ? { "content-type": "application/json" } : {}),
    },
    body: o.body ? JSON.stringify(o.body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const msg = (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new GithubError("GitHub отклонил токен (отозван или истёк)", 401, "unauthorized");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new GithubError("Достигнут лимит GitHub API — повторите позже", 429, "rate_limited");
    if (res.status === 403) throw new GithubError(`Недостаточно прав: ${msg}`, 403, "forbidden");
    if (res.status === 404) throw new GithubError(msg, 404, "not_found");
    throw new GithubError(msg, res.status >= 500 ? 502 : res.status, "github_error");
  }
  return json as T;
}

/* ------------------------------- OAuth web flow ------------------------------- */

export function authorizeUrl(a: { redirectUri: string; state: string; challenge: string }): string {
  const c = githubConfig();
  const u = new URL(`${urls.githubWeb()}/login/oauth/authorize`);
  u.searchParams.set("client_id", c.clientId ?? "");
  u.searchParams.set("redirect_uri", a.redirectUri);
  u.searchParams.set("state", a.state);
  u.searchParams.set("code_challenge", a.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("allow_signup", "true");
  // Identity only. Repository access is granted separately and per-repository through the GitHub App installation.
  if (!c.oauthIsApp) u.searchParams.set("scope", "read:user user:email");
  return u.toString();
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
  const c = githubConfig();
  const res = await fetch(`${urls.githubWeb()}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
    body: new URLSearchParams({ client_id: c.clientId ?? "", client_secret: c.clientSecret ?? "", ...params }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || j.error || !j.access_token) throw new GithubError(`GitHub не выдал токен: ${j.error_description ?? j.error ?? res.status}`, 401, "token_exchange_failed");
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : undefined, scope: j.scope };
}

export const exchangeCode = (code: string, redirectUri: string, verifier: string) => tokenRequest({ code, redirect_uri: redirectUri, code_verifier: verifier });
export const refreshUserToken = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export interface GithubProfile {
  id: string;
  login: string;
  name: string | null;
  avatar: string | null;
  email: string | null;
}

export async function fetchProfile(token: string): Promise<GithubProfile> {
  const u = await ghFetch<{ id: number; login: string; name: string | null; avatar_url: string | null; email: string | null }>("/user", { token });
  return { id: String(u.id), login: u.login, name: u.name, avatar: u.avatar_url, email: u.email };
}

/** Revokes the user's OAuth authorization of our app on GitHub (the "Authorized apps" entry). */
export async function revokeGrant(accessToken: string): Promise<void> {
  const c = githubConfig();
  if (!c.clientId || !c.clientSecret) return;
  await ghFetch(`/applications/${c.clientId}/grant`, { method: "DELETE", basic: Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64"), body: { access_token: accessToken } }).catch(() => undefined);
}

/* ------------------------------- GitHub App ------------------------------- */

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function appJwt(now = Math.floor(Date.now() / 1000)): string {
  const c = githubConfig();
  if (!c.app || !c.privateKey || !c.appId) throw new GithubError("GitHub App не настроена", 503, "not_configured");
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64u(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: c.appId }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(c.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

export interface Installation {
  id: number;
  account: { login: string; id: number; type: string; avatar_url?: string } | null;
  repository_selection: "all" | "selected";
  permissions: Record<string, string>;
  html_url: string;
  suspended_at: string | null;
}

export const getInstallation = (id: string) => ghFetch<Installation>(`/app/installations/${encodeURIComponent(id)}`, { token: appJwt() });
export const deleteInstallation = (id: string) => ghFetch<void>(`/app/installations/${encodeURIComponent(id)}`, { method: "DELETE", token: appJwt() });

export async function listUserInstallations(userToken: string): Promise<Installation[]> {
  const r = await ghFetch<{ installations: (Installation & { app_id: number })[] }>("/user/installations?per_page=100", { token: userToken });
  const appId = githubConfig().appId;
  // The endpoint lists installations of EVERY app the token can see — keep only ours.
  return r.installations.filter((i) => !appId || String(i.app_id) === appId);
}

const tokenCache = new Map<string, { token: string; exp: number }>();

/**
 * Short-lived installation access token (1 h), minted on the server per request and cached only in memory
 * until 5 minutes before expiry. When `repositories` is given the token is down-scoped to exactly those repos.
 */
export async function installationToken(installationId: string, repositories?: string[]): Promise<string> {
  const key = `${installationId}:${(repositories ?? []).slice().sort().join(",")}`;
  const hit = tokenCache.get(key);
  if (hit && hit.exp - Date.now() > 5 * 60_000) return hit.token;
  const r = await ghFetch<{ token: string; expires_at: string }>(`/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
    method: "POST",
    token: appJwt(),
    body: repositories?.length ? { repositories: repositories.map((x) => x.split("/")[1] ?? x).slice(0, 500) } : undefined,
  });
  tokenCache.set(key, { token: r.token, exp: new Date(r.expires_at).getTime() });
  if (tokenCache.size > 200) tokenCache.clear();
  return r.token;
}

export function forgetInstallationTokens(installationId: string): void {
  for (const k of tokenCache.keys()) if (k.startsWith(`${installationId}:`)) tokenCache.delete(k);
}

export interface InstallationRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
  updated_at: string;
  html_url: string;
  description: string | null;
  id: number;
  permissions?: { push?: boolean };
}

export async function listInstallationRepos(token: string): Promise<InstallationRepo[]> {
  const out: InstallationRepo[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await ghFetch<{ repositories: InstallationRepo[] }>(`/installation/repositories?per_page=100&page=${page}`, { token });
    out.push(...r.repositories);
    if (r.repositories.length < 100) break;
  }
  return out;
}

export function manageInstallationUrl(inst: { id: string; login?: string | null; type?: string | null }): string {
  if (inst.type === "Organization" && inst.login) return `${urls.githubWeb()}/organizations/${inst.login}/settings/installations/${inst.id}`;
  return `${urls.githubWeb()}/settings/installations/${inst.id}`;
}
