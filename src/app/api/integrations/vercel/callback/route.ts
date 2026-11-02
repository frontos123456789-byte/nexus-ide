import { rateLimit } from "@/lib/nexus/server/guard";
import { baseUrl } from "@/lib/auth/config";
import { redirectExternal, redirectTo, withQuery } from "@/lib/auth/http";
import { clearFlowCookie, verifyState } from "@/lib/auth/oauth-state";
import * as vercel from "@/lib/auth/providers/vercel";
import { saveConnection, writeAudit } from "@/lib/auth/service";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/crypto";
import { readFlow } from "@/lib/auth/oauth-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Vercel only gets to send the user back to *.vercel.com — never to an arbitrary `next` value. */
function isVercelUrl(u: string): boolean {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "vercel.com" || x.hostname.endsWith(".vercel.com"));
  } catch {
    return false;
  }
}

/**
 * Redirect URL of the Vercel Integration. Exchanges the one-time `code` for an API token (server-side only),
 * stores it AES-256-GCM encrypted for THIS user, and returns the user to Nexus (or to Vercel's `next` in popup mode).
 */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "vc-callback", 30);
  if (limited) return limited;
  const url = new URL(req.url);
  const stored = readFlow(req);
  const next = safeNext(stored?.next, "/?settings=account");
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: "vercel" }), [clearFlowCookie()]);

  const flow = verifyState(req, url.searchParams.get("state"), { provider: "vercel", kinds: ["vercel-install"] });
  if (typeof flow === "string") return back("state_mismatch");
  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }), [clearFlowCookie()]);
  if (session.sessionId !== flow.sid) return back("session_changed");

  const code = url.searchParams.get("code");
  if (url.searchParams.get("error")) return back("cancelled");
  if (!code || code.length > 2048) return back("missing_code");

  try {
    const t = await vercel.exchangeIntegrationCode(code, `${baseUrl(req)}/api/integrations/vercel/callback`);
    const configurationId = url.searchParams.get("configurationId") ?? t.installationId ?? "";
    if (!/^[\w-]{3,100}$/.test(configurationId)) return back("bad_configuration");
    const teamId = t.teamId ?? url.searchParams.get("teamId");

    // Display name: team name or the user's name (best effort — depends on the scopes granted to the integration).
    let label = teamId ? `team ${teamId}` : "Личный аккаунт Vercel";
    try {
      if (teamId) {
        const team = await vercel.vercelFetch<{ name?: string; slug?: string }>(t.accessToken, null, `/v2/teams/${encodeURIComponent(teamId)}`);
        label = team.name ?? team.slug ?? label;
      } else {
        const u = await vercel.vercelFetch<{ user?: { username?: string; name?: string } }>(t.accessToken, null, "/v2/user");
        label = u.user?.username ?? u.user?.name ?? label;
      }
    } catch {
      /* scope not granted – keep the generic label */
    }

    await saveConnection({ userId: session.user.id, provider: "vercel", externalId: configurationId, login: label, teamId: teamId ?? null, accessToken: t.accessToken, metadata: { vercelUserId: t.userId } });
    await writeAudit({ userId: session.user.id, provider: "vercel", actor: session.user.displayName, action: "vercel:connect", target: configurationId, detail: teamId ? `team ${teamId}` : "personal" });

    const nextUrl = url.searchParams.get("next");
    if (flow.popup && nextUrl && isVercelUrl(nextUrl)) return redirectExternal(nextUrl, [clearFlowCookie()]);
    return redirectTo(req, withQuery(next, { connected: "vercel" }), [clearFlowCookie()]);
  } catch (e) {
    await writeAudit({ userId: session.user.id, provider: "vercel", actor: session.user.displayName, action: "vercel:connect", ok: false, detail: e instanceof Error ? e.message : "exchange failed" });
    return back("provider_error");
  }
}
