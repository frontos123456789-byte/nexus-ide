import { rateLimit } from "@/lib/nexus/server/guard";
import { databaseConfigured, githubConfig, urls } from "@/lib/auth/config";
import { clearFlowCookie, flowCookie, newFlow } from "@/lib/auth/oauth-state";
import { redirectExternal, redirectTo, withQuery } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends a signed-in user to the official GitHub App installation page, where THEY choose the repositories.
 * The `state` is bound to this browser + this Nexus session and comes back on the Setup URL.
 */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "gh-install", 20);
  if (limited) return limited;
  const next = safeNext(new URL(req.url).searchParams.get("next"), "/?settings=account");
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: "github" }), [clearFlowCookie()]);
  const c = githubConfig();
  if (!c.app) return back("app_not_configured");
  if (!databaseConfigured()) return back("database_not_configured");
  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }));
  const flow = newFlow({ kind: "github-install", provider: "github", sid: session.sessionId, next });
  return redirectExternal(`${urls.githubWeb()}/apps/${encodeURIComponent(c.appSlug ?? "")}/installations/new?state=${encodeURIComponent(flow.state)}`, [flowCookie(flow)]);
}
