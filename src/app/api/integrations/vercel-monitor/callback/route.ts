import { rateLimit } from "@/lib/nexus/server/guard";
import { baseUrl } from "@/lib/auth/config";
import { safeNext } from "@/lib/auth/crypto";
import { redirectTo, withQuery } from "@/lib/auth/http";
import { clearFlowCookie, readFlow, verifyState } from "@/lib/auth/oauth-state";
import * as vercel from "@/lib/auth/providers/vercel";
import { saveConnection, writeAudit } from "@/lib/auth/service";
import { getSession } from "@/lib/auth/session";
import { MONITOR_PROVIDER } from "@/lib/monitor/service";
import { vercelGet } from "@/lib/monitor/vercel-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Redirect URL of the read-only Vercel Monitor integration. Exchanges the one-time `code` for an API token (server side only),
 * stores it AES-256-GCM encrypted for THIS user under provider `vercel_monitor` and returns the user to the monitor.
 */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "vcm-callback", 30);
  if (limited) return limited;
  const url = new URL(req.url);
  const next = safeNext(readFlow(req)?.next, "/code?view=vercel");
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: MONITOR_PROVIDER }), [clearFlowCookie()]);

  const flow = verifyState(req, url.searchParams.get("state"), { provider: "vercel", kinds: ["vercel-monitor-install"] });
  if (typeof flow === "string") return back("state_mismatch");
  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }), [clearFlowCookie()]);
  if (session.sessionId !== flow.sid) return back("session_changed");

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return back("cancelled");
  if (!code || code.length > 2048) return back("missing_code");

  try {
    const t = await vercel.exchangeIntegrationCode(code, `${baseUrl(req)}/api/integrations/vercel-monitor/callback`, "monitor");
    const configurationId = url.searchParams.get("configurationId") ?? t.installationId ?? "";
    if (!/^[\w-]{3,100}$/.test(configurationId)) return back("bad_configuration");
    const teamId = t.teamId ?? url.searchParams.get("teamId");

    // Display name (best effort — needs the optional Team/User read scopes).
    let label = teamId ? `team ${teamId}` : "Личный аккаунт Vercel";
    try {
      if (teamId) {
        const team = await vercelGet<{ name?: string; slug?: string }>(t.accessToken, null, `/v2/teams/${encodeURIComponent(teamId)}`);
        label = team.name ?? team.slug ?? label;
      } else {
        const u = await vercelGet<{ user?: { username?: string; name?: string } }>(t.accessToken, null, "/v2/user");
        label = u.user?.username ?? u.user?.name ?? label;
      }
    } catch {
      /* scope not granted – keep the generic label */
    }

    await saveConnection({ userId: session.user.id, provider: MONITOR_PROVIDER, externalId: configurationId, login: label, teamId: teamId ?? null, accessToken: t.accessToken, metadata: { vercelUserId: t.userId, readOnly: true } });
    await writeAudit({ userId: session.user.id, provider: MONITOR_PROVIDER, actor: session.user.displayName, action: "vercel_monitor:connect", target: configurationId, detail: teamId ? `team ${teamId}` : "personal" });
    return redirectTo(req, withQuery(next, { connected: MONITOR_PROVIDER }), [clearFlowCookie()]);
  } catch (e) {
    await writeAudit({ userId: session.user.id, provider: MONITOR_PROVIDER, actor: session.user.displayName, action: "vercel_monitor:connect", ok: false, detail: e instanceof Error ? e.message : "exchange failed" });
    return back("provider_error");
  }
}
