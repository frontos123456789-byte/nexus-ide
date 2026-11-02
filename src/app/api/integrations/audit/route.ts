import { readSession, recentAudit, tokenFor } from "@/lib/integrations/server";
import { getSession } from "@/lib/auth/session";
import { listAudit } from "@/lib/auth/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Audit journal for the current user: their own actions + webhook events for repositories they can really access
 * (ownership is verified with the user's own GitHub token, max 6 repos).
 */
export async function GET(req: Request): Promise<Response> {
  const s = readSession(req);
  const logins = new Set(Object.values(s.logins ?? {}).filter(Boolean) as string[]);
  const repos = (new URL(req.url).searchParams.get("repos") ?? "").split(",").map((r) => r.trim()).filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r)).slice(0, 6);
  const gh = tokenFor(req, "github");
  const allowed = new Set<string>();
  if (gh) {
    await Promise.all(
      repos.map(async (r) => {
        const res = await fetch(`https://api.github.com/repos/${r}`, { headers: { authorization: `Bearer ${gh}`, "user-agent": "nexus-ai" }, cache: "no-store" }).catch(() => null);
        if (res?.ok) allowed.add(r);
      }),
    );
  }
  const ctx = await getSession(req).catch(() => null);
  const mine = ctx ? await listAudit(ctx.user.id, 60).catch(() => []) : [];
  const own = mine.map((m) => ({ id: m.id, ts: m.createdAt.getTime(), actor: m.actor, action: m.action, target: m.target, ok: m.ok, detail: m.detail ?? undefined, source: "nexus" as const }));
  const legacy = await recentAudit((e) => (e.source === "nexus" ? logins.has(e.actor) : allowed.has(e.target)));
  const seen = new Set(own.map((e) => `${e.ts}:${e.action}:${e.target}`));
  const events = [...own, ...legacy.filter((e) => !seen.has(`${e.ts}:${e.action}:${e.target}`))].sort((a, b) => b.ts - a.ts).slice(0, 60);
  return Response.json({ events, webhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET?.trim()), persistent: Boolean(process.env.DATABASE_URL) });
}
