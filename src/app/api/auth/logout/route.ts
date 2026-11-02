import { rateLimit } from "@/lib/nexus/server/guard";
import { csrfCheck } from "@/lib/integrations/server";
import { clearCookie, destroySession, getSession, sessionCookieName } from "@/lib/auth/session";
import { json } from "@/lib/auth/http";
import { writeAudit } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout[?all=1] – revokes the server-side session (this device, or every device). CSRF-protected. */
export async function POST(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "auth-logout", 30);
  if (limited) return limited;
  const all = new URL(req.url).searchParams.get("all") === "1";
  const ctx = await getSession(req);
  if (ctx) {
    await destroySession(req, all);
    await writeAudit({ userId: ctx.user.id, provider: "nexus", actor: ctx.user.displayName, action: all ? "auth:logout_all" : "auth:logout" });
  }
  return json({ ok: true }, { cookies: [clearCookie(sessionCookieName())] });
}
