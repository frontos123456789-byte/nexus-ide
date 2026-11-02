import { z } from "zod";
import { collectText } from "@/lib/ai/llm";
import { rateLimit } from "@/lib/nexus/server/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  system: z.string().min(1).max(12_000),
  prompt: z.string().min(1).max(40_000),
  preferredModel: z.string().max(120).optional(),
  maxTokens: z.number().int().min(200).max(8000).optional(),
});

/** One-shot generation for Code Studio (site/bot/deck generators). Uses the same free-model fallback chain. */
export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "ai-generate", 20);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const { text, modelLabel } = await collectText({
      messages: [
        { role: "system", content: parsed.data.system },
        { role: "user", content: parsed.data.prompt },
      ],
      preferredModel: parsed.data.preferredModel,
      signal: req.signal,
      temperature: 0.4,
      maxTokens: parsed.data.maxTokens ?? 6000,
    });
    return Response.json({ text, modelLabel });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Ошибка генерации" }, { status: 502 });
  }
}
