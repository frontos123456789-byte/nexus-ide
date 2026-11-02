import { z } from "zod";
import { rateLimit } from "@/lib/nexus/server/guard";
import { searchWeb } from "@/lib/web/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const schema = z.object({ query: z.string().trim().min(1).max(300), max: z.number().int().min(1).max(10).optional() });

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "web-search", 30);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  const out = await searchWeb(parsed.data.query, parsed.data.max ?? 6, req.signal);
  return Response.json(out);
}
