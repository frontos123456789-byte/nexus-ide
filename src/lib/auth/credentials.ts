import { ApiError, tokenFor, readSession } from "@/lib/integrations/server";
import { githubConfig, vercelConfig } from "./config";
import { getSession } from "./session";
import { connectionToken, getConnection, getPermissions, revokeConnection, userAccessToken, writeAudit } from "./service";
import * as github from "./providers/github";

/**
 * Resolves which credentials an API request may use. Order:
 *   1. the Nexus account of the session cookie → its OWN provider connection (GitHub App installation token /
 *      Vercel integration token). Users can never reach another user's connection: the lookup key is the session's user id;
 *   2. legacy fallback (manual token cookie / owner env + admin key) – kept until the new flow is verified on real accounts.
 */

export interface GithubCred {
  token: string;
  actor: string;
  userId?: string;
  via: "account" | "legacy";
  /** null = every repo of the installation; otherwise only these full names. */
  allowedRepos: string[] | null;
  installationId?: string;
  accountLogin?: string;
  accountType?: string;
  /** user-to-server token (creating repositories needs it); null when unavailable. */
  userToken: () => Promise<string | null>;
}

export interface VercelCred {
  token: string;
  teamId?: string;
  actor: string;
  userId?: string;
  via: "account" | "legacy";
  configurationId?: string;
  /** Key patterns the user allows Nexus to manage. Empty = no extra restriction (reserved keys are still blocked). */
  envAllow: string[];
}

export async function githubCredentials(req: Request): Promise<GithubCred | null> {
  const ctx = await getSession(req);
  if (ctx && githubConfig().app) {
    const conn = await getConnection(ctx.user.id, "github");
    if (conn) {
      const selected = conn.metadata.repoMode === "selected";
      const allowed = selected ? (await getPermissions(conn.id, "repo")).map((p) => p.resource) : null;
      let token: string;
      try {
        token = await github.installationToken(conn.externalId, allowed ?? undefined);
      } catch (e) {
        if (e instanceof github.GithubError && (e.status === 404 || e.status === 401)) {
          await revokeConnection(ctx.user.id, "github");
          await writeAudit({ userId: ctx.user.id, provider: "github", actor: conn.externalLogin ?? ctx.user.displayName, action: "installation_lost", ok: false, detail: "GitHub App удалена или отозвана на стороне GitHub" });
          throw new ApiError("Доступ GitHub отозван: приложение удалено на стороне GitHub. Подключите заново.", 401, "integration_revoked");
        }
        throw new ApiError(e instanceof Error ? e.message : "GitHub App недоступна", 502, "github_error");
      }
      return {
        token,
        actor: conn.externalLogin ?? ctx.user.displayName,
        userId: ctx.user.id,
        via: "account",
        allowedRepos: allowed,
        installationId: conn.externalId,
        accountLogin: conn.externalLogin ?? undefined,
        accountType: typeof conn.metadata.accountType === "string" ? conn.metadata.accountType : undefined,
        userToken: () => userAccessToken(ctx.user.id, "github"),
      };
    }
  }
  const legacy = tokenFor(req, "github");
  if (!legacy) return null;
  return { token: legacy, actor: readSession(req).logins?.github ?? "owner", via: "legacy", allowedRepos: null, userToken: async () => legacy };
}

export async function vercelCredentials(req: Request): Promise<VercelCred | null> {
  const ctx = await getSession(req);
  if (ctx) {
    const conn = await getConnection(ctx.user.id, "vercel");
    if (conn) {
      const token = connectionToken(conn);
      if (!token) {
        await revokeConnection(ctx.user.id, "vercel");
        throw new ApiError("Токен Vercel не удалось расшифровать — подключите Vercel заново.", 401, "integration_revoked");
      }
      const envAllow = (await getPermissions(conn.id, "env_key")).map((p) => p.resource);
      return { token, teamId: conn.teamId ?? undefined, actor: conn.externalLogin ?? ctx.user.displayName, userId: ctx.user.id, via: "account", configurationId: conn.externalId, envAllow };
    }
  }
  const legacy = tokenFor(req, "vercel");
  if (!legacy) return null;
  const s = readSession(req);
  return { token: legacy, teamId: s.teamId, actor: s.logins?.vercel ?? "owner", via: "legacy", envAllow: [] };
}

/** Throws unless `repo` ("owner/name") is inside the user's allow-list. */
export function assertRepoAllowed(cred: GithubCred, repo: string): void {
  if (!cred.allowedRepos) return;
  if (!cred.allowedRepos.some((r) => r.toLowerCase() === repo.toLowerCase())) {
    throw new ApiError(`Репозиторий ${repo} не разрешён для Nexus. Добавьте его в «Аккаунт и подключения → GitHub».`, 403, "repo_not_allowed");
  }
}

const RESERVED_ENV = /^(VERCEL|NEXT_RUNTIME|AWS_|__VERCEL)/i;

/** Env-var write policy: reserved platform keys are never writable; an optional allow-list (`FOO`, `NEXT_PUBLIC_*`) narrows it further. */
export function assertEnvKeyAllowed(cred: VercelCred, key: string): void {
  if (RESERVED_ENV.test(key)) throw new ApiError(`Переменная ${key} зарезервирована платформой и не может изменяться через Nexus`, 403, "env_reserved");
  if (cred.envAllow.length === 0) return;
  const ok = cred.envAllow.some((p) => (p.endsWith("*") ? key.startsWith(p.slice(0, -1)) : key === p));
  if (!ok) throw new ApiError(`Ключ ${key} не входит в список разрешённых переменных (${cred.envAllow.join(", ")})`, 403, "env_not_allowed");
}

export const integrationsConfigured = () => ({ github: githubConfig().app, vercel: vercelConfig().integration });
