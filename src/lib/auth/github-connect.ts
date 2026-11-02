import { githubConfig } from "./config";
import * as github from "./providers/github";
import { getConnection, getPermissions, replacePermissions, saveConnection, userAccessToken, writeAudit } from "./service";

/**
 * Binds a GitHub App installation to a Nexus user. Ownership is ALWAYS verified with the user's own
 * user-to-server token (GET /user/installations): the `installation_id` that arrives in a URL is attacker-controllable.
 */
export async function connectInstallation(userId: string, installationId: string, opts: { actor: string; userToken?: string | null }): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (!githubConfig().app) return { ok: false, code: "not_configured", message: "GitHub App не настроена владельцем Nexus" };
  const token = opts.userToken ?? (await userAccessToken(userId, "github"));
  if (!token) return { ok: false, code: "reauth_required", message: "Сессия GitHub истекла — войдите через GitHub заново" };
  let owned;
  try {
    owned = await github.listUserInstallations(token);
  } catch (e) {
    return { ok: false, code: "verify_failed", message: e instanceof Error ? e.message : "Не удалось проверить установку" };
  }
  const inst = owned.find((i) => String(i.id) === installationId);
  if (!inst) return { ok: false, code: "installation_not_owned", message: "Эта установка GitHub App недоступна вашему аккаунту GitHub" };
  if (inst.suspended_at) return { ok: false, code: "suspended", message: "Установка GitHub App приостановлена" };

  const prev = await getConnection(userId, "github");
  const sameInstall = prev?.externalId === String(inst.id);
  const conn = await saveConnection({
    userId,
    provider: "github",
    externalId: String(inst.id),
    login: inst.account?.login ?? null,
    avatar: inst.account?.avatar_url ?? null,
    metadata: {
      accountType: inst.account?.type ?? "User",
      repositorySelection: inst.repository_selection,
      // keep the user's Nexus-level repo narrowing when re-syncing the same installation
      repoMode: sameInstall ? (prev?.metadata.repoMode ?? "all") : "all",
      manageUrl: github.manageInstallationUrl({ id: String(inst.id), login: inst.account?.login, type: inst.account?.type }),
    },
  });
  await replacePermissions(conn.id, "scope", Object.entries(inst.permissions ?? {}).map(([resource, access]) => ({ resource, access })));
  if (!sameInstall) await replacePermissions(conn.id, "repo", []);
  await writeAudit({ userId, provider: "github", actor: opts.actor, action: sameInstall ? "github:resync" : "github:connect", target: inst.account?.login ?? String(inst.id), detail: `installation ${inst.id}; repos: ${inst.repository_selection}` });
  return { ok: true };
}

/** After sign-in: if the user already installed our GitHub App and has no connection yet, connect it automatically (verified). */
export async function autoConnectInstallation(userId: string, login: string, userToken: string): Promise<void> {
  if (!githubConfig().app) return;
  try {
    if (await getConnection(userId, "github")) return;
    const list = await github.listUserInstallations(userToken);
    const pick = list.find((i) => i.account?.login.toLowerCase() === login.toLowerCase() && !i.suspended_at) ?? list.find((i) => !i.suspended_at);
    if (pick) await connectInstallation(userId, String(pick.id), { actor: login, userToken });
  } catch {
    /* best effort */
  }
}

export const repoPermissions = (connectionId: string) => getPermissions(connectionId, "repo");
