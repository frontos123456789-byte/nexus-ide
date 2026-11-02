import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { json } from "@/lib/auth/http";
import { monitorCredentials, loadOverview } from "@/lib/monitor/service";
import { MonitorApiError } from "@/lib/monitor/vercel-readonly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const query = z.object({
  projectId: z.string().regex(/^[\w.-]{1,128}$/).optional(),
  env: z.enum(["production", "preview"]).optional(),
  status: z.enum(["queued", "building", "ready", "error", "canceled"]).optional(),
  until: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  projects: z.enum(["0", "1"]).default("1"),
});

/** Projects + real deployments (Production/Preview) of the connected Vercel account. Read-only (GET) upstream. */
export async function GET(req: Request): Promise<Response> {
  const limited = rateLimit(req, "monitor-overview", 90);
  if (limited) return limited;
  const q = query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return json({ error: "Некорректные параметры", code: "bad_request" }, { status: 400 });
  try {
    const cred = await monitorCredentials(req);
    if (!cred) return json({ error: "Vercel не подключён", code: "not_connected" }, { status: 409 });
    const { projects, ...rest } = q.data;
    const data = await loadOverview(cred, { ...rest, withProjects: projects === "1" });
    return json(data);
  } catch (e) {
    if (e instanceof MonitorApiError) return json({ error: e.message, code: e.code, resetAt: e.resetAt }, { status: e.status });
    return json({ error: "Не удалось получить данные Vercel", code: "internal_error" }, { status: 500 });
  }
}
