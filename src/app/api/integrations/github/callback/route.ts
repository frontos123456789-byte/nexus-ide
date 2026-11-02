import { rateLimit } from "@/lib/nexus/server/guard";
import { safeNext } from "@/lib/auth/crypto";
import { connectInstallation } from "@/lib/auth/github-connect";
import { redirectTo, withQuery } from "@/lib/auth/http";
import { clearFlowCookie, readFlow, verifyState } from "@/lib/auth/oauth-state";
import { getConnection, writeAudit } from "@/lib/auth/service";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Setup URL" of the GitHub App. Called by GitHub after the user installed / updated the app.
 *  - requires the Nexus session that started the flow (state is cookie-bound, constant-time compared);
 *  - the installation id from the URL is NOT trusted: ownership is verified with the user's own GitHub token.
 *  - `setup_action=update` redirects carry no state – they are accepted only for the installation already connected.
 */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "gh-callback", 30);
  if (limited) return limited;
  const url = new URL(req.url);
  const installationId = url.searchParams.get("installation_id") ?? "";
  const state = url.searchParams.get("state");
  const stored = readFlow(req);
  const next = safeNext(stored?.next, "/?settings=account");
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: "github" }), [clearFlowCookie()]);

  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }), [clearFlowCookie()]);
  if (!/^\d{1,15}$/.test(installationId)) return back("bad_installation");

  if (state) {
    const f = verifyState(req, state, { provider: "github", kinds: ["github-install"] });
    if (typeof f === "string") return back("state_mismatch");
    if (f.sid !== session.sessionId) return back("session_changed");
  } else {
    const existing = await getConnection(session.user.id, "github");
    if (existing?.externalId !== installationId) return back("state_mismatch");
  }

  if (url.searchParams.get("setup_action") === "request") return back("install_requested"); // org owner approval pending

  const gh = session.accounts.find((a) => a.provider === "github");
  const r = await connectInstallation(session.user.id, installationId, { actor: gh?.login ?? session.user.displayName });
  if (!r.ok) {
    await writeAudit({ userId: session.user.id, provider: "github", actor: gh?.login ?? session.user.displayName, action: "github:connect", ok: false, detail: r.code });
    return back(r.code);
  }
  return redirectTo(req, withQuery(next, { connected: "github" }), [clearFlowCookie()]);
}
