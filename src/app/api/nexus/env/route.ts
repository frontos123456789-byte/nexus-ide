import { z } from "zod";
import { bad, readJson, requireAccess } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ names: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)).min(1).max(100) });

/**
 * Reports ONLY whether server variables are set. Values are never returned,
 * so server secrets cannot reach the browser through this route.
 */
export async function POST(req: Request): Promise<Response> {
  const denied = requireAccess(req);
  if (denied) return denied;
  const parsed = schema.safeParse(await readJson<unknown>(req, 50_000));
  if (!parsed.success) return bad("Ожидается { names: string[] } с именами в формате UPPER_SNAKE");
  const present: Record<string, boolean> = {};
  for (const n of parsed.data.names) present[n] = Boolean(process.env[n]?.trim());
  return Response.json({ present, environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown" });
}
