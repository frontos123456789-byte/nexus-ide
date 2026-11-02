import { rateLimit } from "@/lib/nexus/server/guard";
import { csrfCheck } from "@/lib/integrations/server";
import { json } from "@/lib/auth/http";
import { getSession } from "@/lib/auth/session";
import { disconnectMonitor, monitorStatus } from "@/lib/monitor/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Connection state of the Vercel Monitor for the signed-in account (never contains tokens). */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "monitor-status", 60);
  if (limited) return limited;
  return json(await monitorStatus(req));
}

/** Disconnect = forget the token inside Nexus. The installation itself is removed on vercel.com (the monitor has no write scopes to do it). */
export async function DELETE(req: Request): Promise<Response> {
  const csrf = csrfCheck(req);
  if (csrf) return csrf;
  const limited = rateLimit(req, "monitor-status", 60);
  if (limited) return limited;
  const ctx = await getSession(req);
  if (!ctx) return json({ error: "Требуется вход в Nexus", code: "unauthenticated" }, { status: 401 });
  await disconnectMonitor(ctx);
  return json({ ok: true, note: "Токен удалён из Nexus. Чтобы полностью отозвать доступ, удалите интеграцию на vercel.com/dashboard/integrations." });
}
