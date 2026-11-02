import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { json } from "@/lib/auth/http";
import { loadLogs, monitorCredentials } from "@/lib/monitor/service";
import { MonitorApiError } from "@/lib/monitor/vercel-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const query = z.object({ deploymentId: z.string().regex(/^[\w.-]{1,128}$/) });

/** Last build-log lines of one deployment (Vercel events API, GET). */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "monitor-logs", 40);
  if (limited) return limited;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return json({ error: "Некорректный deploymentId", code: "bad_request" }, { status: 400 });
  try {
    const cred = await monitorCredentials(req);
    if (!cred) return json({ error: "Vercel не подключён", code: "not_connected" }, { status: 409 });
    return json(await loadLogs(cred, q.data.deploymentId));
  } catch (e) {
    if (e instanceof MonitorApiError) return json({ error: e.message, code: e.code, resetAt: e.resetAt }, { status: e.status });
    return json({ error: "Не удалось получить логи", code: "internal_error" }, { status: 500 });
  }
}
