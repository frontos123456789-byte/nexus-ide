import { rateLimit } from "@/lib/nexus/server/guard";
import { databaseConfigured, vercelMonitorConfig } from "@/lib/auth/config";
import { encryptionAvailable, safeNext } from "@/lib/auth/crypto";
import { clearFlowCookie, flowCookie, newFlow } from "@/lib/auth/oauth-state";
import { redirectExternal, redirectTo, withQuery } from "@/lib/auth/http";
import { monitorInstallUrl } from "@/lib/auth/providers/vercel";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** «Подключить Vercel»: sends a signed-in user to the official install flow of the read-only Vercel Monitor integration. */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "vcm-start", 20);
  if (limited) return limited;
  const url = new URL(req.url);
  const next = safeNext(url.searchParams.get("next"), "/code?view=vercel");
  const back = (code: string) => redirectTo(req, withQuery(next, { auth_error: code, provider: "vercel_monitor" }), [clearFlowCookie()]);
  if (!vercelMonitorConfig().configured) return back("monitor_not_configured");
  if (!databaseConfigured()) return back("database_not_configured");
  if (!encryptionAvailable()) return back("encryption_not_configured");
  const session = await getSession(req);
  if (!session) return redirectTo(req, withQuery("/login", { error: "session_required", next }));
  const flow = newFlow({ kind: "vercel-monitor-install", provider: "vercel", sid: session.sessionId, next });
  return redirectExternal(monitorInstallUrl(flow.state), [flowCookie(flow)]);
}
