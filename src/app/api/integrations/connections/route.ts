import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { csrfCheck } from "@/lib/integrations/server";
import { json } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { buildAccountState } from "@/lib/auth/state";
import { connectInstallation } from "@/lib/auth/github-connect";
import * as github from "@/lib/auth/providers/github";
import * as vercel from "@/lib/auth/providers/vercel";
import { connectionToken, getConnection, patchMetadata, replacePermissions, revokeConnection, writeAudit } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const repoName = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const actions = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setRepoSelection"), mode: z.enum(["all", "selected"]), repos: z.array(repoName).max(300).default([]) }),
  z.object({ action: z.literal("setEnvAllowlist"), patterns: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,127}\*?$/)).max(50) }),
  z.object({ action: z.literal("resyncGithub") }),
]);

/** Manage what Nexus may do inside a connection. Session + CSRF required; the connection looked up is always the caller's own. */
export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "connections", 40);
  if (limited) return limited;
  const ctx = await getSession(req);
  if (!ctx) return json({ error: "Требуется вход в Nexus", code: "unauthenticated" }, { status: 401 });
  const parsed = actions.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Некорректный запрос" }, { status: 400 });
  const a = parsed.data;
  const actor = ctx.user.displayName;

  try {
    if (a.action === "setRepoSelection") {
      const conn = await getConnection(ctx.user.id, "github");
      if (!conn) return json({ error: "GitHub не подключён", code: "not_connected" }, { status: 409 });
      if (a.mode === "selected") {
        if (a.repos.length === 0) return json({ error: "Выберите хотя бы один репозиторий", code: "empty_selection" }, { status: 400 });
        // Only repositories the GitHub App installation can actually see may be allowed (unrestricted token for validation).
        const visible = await github.listInstallationRepos(await github.installationToken(conn.externalId));
        const byName = new Map(visible.map((r) => [r.full_name.toLowerCase(), r]));
        const bad = a.repos.filter((r) => !byName.has(r.toLowerCase()));
        if (bad.length) return json({ error: `Недоступны установке GitHub App: ${bad.join(", ")}. Добавьте их через «Управление доступом» на GitHub.`, code: "repo_not_in_installation" }, { status: 400 });
        await replacePermissions(conn.id, "repo", a.repos.map((r) => ({ resource: (byName.get(r.toLowerCase())?.full_name ?? r), access: byName.get(r.toLowerCase())?.permissions?.push === false ? "read" : "write" })));
      } else {
        await replacePermissions(conn.id, "repo", []);
      }
      await patchMetadata(conn, { repoMode: a.mode });
      github.forgetInstallationTokens(conn.externalId);
      await writeAudit({ userId: ctx.user.id, provider: "github", actor, action: "github:set_repos", detail: a.mode === "all" ? "all installation repos" : `${a.repos.length} repos` });
    } else if (a.action === "setEnvAllowlist") {
      const conn = await getConnection(ctx.user.id, "vercel");
      if (!conn) return json({ error: "Vercel не подключён", code: "not_connected" }, { status: 409 });
      await replacePermissions(conn.id, "env_key", a.patterns.map((p) => ({ resource: p, access: "write" })));
      await writeAudit({ userId: ctx.user.id, provider: "vercel", actor, action: "vercel:set_env_allowlist", detail: a.patterns.join(", ") || "(no extra restriction)" });
    } else {
      const gh = ctx.accounts.find((x) => x.provider === "github");
      const conn = await getConnection(ctx.user.id, "github");
      if (!gh) return json({ error: "Сначала привяжите GitHub-аккаунт", code: "identity_required" }, { status: 409 });
      if (conn) {
        const r = await connectInstallation(ctx.user.id, conn.externalId, { actor: gh.login });
        if (!r.ok) return json({ error: r.message, code: r.code }, { status: 409 });
      }
    }
    return json(await buildAccountState(ctx));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Внутренняя ошибка" }, { status: e instanceof github.GithubError ? e.status : 500 });
  }
}

const delSchema = z.object({ provider: z.enum(["github", "vercel"]), uninstall: z.enum(["0", "1"]).default("0"), confirm: z.literal("1") });

/**
 * DELETE /api/integrations/connections?provider=github|vercel&confirm=1[&uninstall=1]
 *  github: forget the installation in Nexus (+ optionally uninstall the GitHub App on GitHub).
 *  vercel: uninstall the integration configuration on Vercel (the only way to revoke the API token) and forget it.
 */
export async function DELETE(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "connections", 40);
  if (limited) return limited;
  const ctx = await getSession(req);
  if (!ctx) return json({ error: "Требуется вход в Nexus", code: "unauthenticated" }, { status: 401 });
  const q = delSchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return json({ error: "Требуется подтверждение отключения (confirm=1)", code: "confirm_required" }, { status: 409 });
  const { provider, uninstall } = q.data;
  const conn = await getConnection(ctx.user.id, provider);
  if (!conn) return json({ ok: true, note: "Подключение уже отсутствует" });
  const warnings: string[] = [];
  try {
    if (provider === "github") {
      if (uninstall === "1") {
        try {
          await github.deleteInstallation(conn.externalId);
        } catch (e) {
          warnings.push(`GitHub: ${e instanceof Error ? e.message : "не удалось удалить установку"}`);
        }
      }
      github.forgetInstallationTokens(conn.externalId);
    } else {
      const token = connectionToken(conn);
      if (token) {
        try {
          await vercel.uninstallConfiguration(token, conn.teamId, conn.externalId);
        } catch (e) {
          warnings.push(`Vercel: ${e instanceof Error ? e.message : "не удалось удалить интеграцию"} — удалите её вручную в настройках Vercel`);
        }
      }
    }
    await revokeConnection(ctx.user.id, provider);
    await writeAudit({ userId: ctx.user.id, provider, actor: ctx.user.displayName, action: `${provider}:disconnect`, target: conn.externalId, detail: warnings.join("; ") || (uninstall === "1" ? "uninstalled" : undefined) });
    return json({ ok: true, warnings });
  } catch {
    return json({ error: "Не удалось отключить интеграцию" }, { status: 500 });
  }
}
