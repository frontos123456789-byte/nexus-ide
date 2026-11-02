import { rateLimit } from "@/lib/nexus/server/guard";
import { databaseConfigured, vercelConfig } from "@/lib/auth/config";
import { encryptionAvailable, safeNext } from "@/lib/auth/crypto";
import { clearFlowCookie, flowCookie, newFlow } from "@/lib/auth/oauth-state";
import { redirectExternal, redirectTo, withQuery } from "@/lib/auth/http";
import { integrationInstallUrl } from "@/lib/auth/providers/vercel";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** "Connect Vercel": sends a signed-in user to the official Vercel Integration install flow (the supported way to get API access). */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "vc-start", 20);
  if (limited) return limited;
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"), "/?settings=account");
  const popup = url.searchParams.get("popup") === "1";
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: "vercel" }), [clearFlowCookie()]);
  if (!vercelConfig().integration) return back("integration_not_configured");
  if (!databaseConfigured()) return back("database_not_configured");
  if (!encryptionAvailable()) return back("encryption_not_configured");
  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }));
  const flow = newFlow({ kind: "vercel-install", provider: "vercel", sid: session.sessionId, next, popup });
  return redirectExternal(integrationInstallUrl(flow.state), [flowCookie(flow)]);
}
