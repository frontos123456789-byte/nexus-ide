import { databaseConfigured, githubConfig, vercelConfig } from "./config";
import { encryptionAvailable } from "./crypto";
import type { SessionContext } from "./session";
import { getConnection, getPermissions } from "./service";

/** Everything the UI may know about the account. NEVER contains a token, secret or encrypted blob. */
export interface AccountState {
  configured: {
    database: boolean;
    encryption: boolean;
    githubLogin: boolean;
    githubApp: boolean;
    vercelLogin: boolean;
    vercelIntegration: boolean;
    githubAppSlug: string | null;
  };
  user: null | {
    id: string;
    name: string;
    avatar: string | null;
    identities: { provider: "github" | "vercel"; login: string; avatar: string | null }[];
  };
  github: null | {
    connected: boolean;
    login: string | null;
    avatar: string | null;
    installationId: string | null;
    accountType: string | null;
    repoMode: "all" | "selected";
    selectedRepos: string[];
    manageUrl: string | null;
    permissions: Record<string, string>;
  };
  vercel: null | {
    connected: boolean;
    login: string | null;
    teamId: string | null;
    configurationId: string | null;
    envAllow: string[];
  };
}

export function configuredFlags(): AccountState["configured"] {
  const g = githubConfig();
  const v = vercelConfig();
  return {
    database: databaseConfigured(),
    encryption: encryptionAvailable(),
    githubLogin: g.oauth,
    githubApp: g.app,
    vercelLogin: v.signIn,
    vercelIntegration: v.integration,
    githubAppSlug: g.appSlug ?? null,
  };
}

export async function buildAccountState(ctx: SessionContext | null): Promise<AccountState> {
  const configured = configuredFlags();
  if (!ctx) return { configured, user: null, github: null, vercel: null };
  const [gh, vc] = await Promise.all([getConnection(ctx.user.id, "github"), getConnection(ctx.user.id, "vercel")]);
  const ghPerms = gh ? await getPermissions(gh.id) : [];
  const vcPerms = vc ? await getPermissions(vc.id, "env_key") : [];
  return {
    configured,
    user: {
      id: ctx.user.id,
      name: ctx.user.displayName,
      avatar: ctx.user.avatarUrl,
      identities: ctx.accounts.map((a) => ({ provider: a.provider as "github" | "vercel", login: a.login, avatar: a.avatarUrl })),
    },
    github: {
      connected: Boolean(gh),
      login: gh?.externalLogin ?? null,
      avatar: gh?.externalAvatarUrl ?? null,
      installationId: gh?.externalId ?? null,
      accountType: typeof gh?.metadata.accountType === "string" ? gh.metadata.accountType : null,
      repoMode: gh?.metadata.repoMode === "selected" ? "selected" : "all",
      selectedRepos: ghPerms.filter((p) => p.kind === "repo").map((p) => p.resource),
      manageUrl: typeof gh?.metadata.manageUrl === "string" ? gh.metadata.manageUrl : null,
      permissions: Object.fromEntries(ghPerms.filter((p) => p.kind === "scope").map((p) => [p.resource, p.access])),
    },
    vercel: {
      connected: Boolean(vc),
      login: vc?.externalLogin ?? null,
      teamId: vc?.teamId ?? null,
      configurationId: vc?.externalId ?? null,
      envAllow: vcPerms.map((p) => p.resource),
    },
  };
}
