import { z } from "zod";
import { scanFiles } from "@/lib/nexus/secrets";
import { bad, envToken, rateLimit, readJson, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,50}$/),
  files: z.array(z.object({ path: z.string().max(240), content: z.string().max(1_500_000) })).min(1).max(200),
  allowSecrets: z.boolean().optional(),
});

/** Preview deploy of the IDE workspace as a static site through the Vercel Deployments API. Tokens stay on the server. */
export async function POST(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const limited = rateLimit(req, "nexus-deploy", 5, 10 * 60_000);
  if (limited) return limited;
  const token = envToken("vercel");
  if (!token) return bad("VERCEL_TOKEN не задан на сервере — деплой недоступен", 503);
  const parsed = schema.safeParse(await readJson<unknown>(req, 6_000_000));
  if (!parsed.success) return bad("Некорректный запрос деплоя");
  const { name, files, allowSecrets } = parsed.data;
  const map = Object.fromEntries(files.map((f) => [f.path, f.content]));
  const secrets = scanFiles(map);
  if (secrets.length && !allowSecrets) {
    return Response.json({ error: `В файлах найдены секреты (${secrets.length}) — деплой остановлен`, code: "secrets_found", findings: secrets.slice(0, 20) }, { status: 409 });
  }
  const safe = files.filter((f) => !/(^|\/)(\.env|node_modules|\.git)(\/|$)/.test(f.path) && !f.path.includes(".."));
  if (safe.length === 0) return bad("Нет файлов для деплоя");
  const res = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      files: safe.map((f) => ({ file: f.path, data: f.content })),
      projectSettings: { framework: null },
      target: "preview",
    }),
    signal: AbortSignal.timeout(50_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; url?: string; readyState?: string; error?: { message?: string } };
  if (!res.ok) return bad(`Vercel: ${j.error?.message ?? res.status}`, 502);
  return Response.json({ id: j.id, url: j.url ? `https://${j.url}` : null, state: j.readyState });
}

export async function GET(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const token = envToken("vercel");
  if (!token) return bad("VERCEL_TOKEN не задан на сервере", 503);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^dpl_[A-Za-z0-9]+$/.test(id)) return bad("Некорректный id деплоя");
  const res = await fetch(`https://api.vercel.com/v13/deployments/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const j = (await res.json().catch(() => ({}))) as { readyState?: string; url?: string; errorMessage?: string };
  if (!res.ok) return bad(`Vercel: ${res.status}`, 502);
  return Response.json({ state: j.readyState, url: j.url ? `https://${j.url}` : null, error: j.errorMessage });
}
