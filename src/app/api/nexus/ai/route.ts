import { z } from "zod";
import { getApiKey, LlmError, OPENROUTER_BASE_URL, runLlm } from "@/lib/openrouter/client";
import { FREE_MODEL_CHAIN, isFreeModel, type ModelSpec } from "@/lib/openrouter/models";
import { bad, rateLimit, readJson } from "@/lib/nexus/server/guard";
import { redact } from "@/lib/nexus/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  system: z.string().max(30_000).default(""),
  prompt: z.string().min(1).max(120_000),
  feature: z.string().max(60).default("nexus"),
  chain: z.array(z.string().max(120)).max(10).optional(),
  maxTokens: z.number().int().min(64).max(8000).optional(),
  temperature: z.number().min(0).max(1.5).optional(),
  images: z.array(z.string().max(5_000_000).regex(/^data:image\/(png|jpeg|webp|gif);base64,/)).max(3).optional(),
});

function buildChain(ids: string[] | undefined): ModelSpec[] {
  if (!ids || ids.length === 0) return [...FREE_MODEL_CHAIN];
  const picked = ids.map((id) => FREE_MODEL_CHAIN.find((m) => m.id === id)).filter((m): m is ModelSpec => Boolean(m));
  return picked.length ? picked : [...FREE_MODEL_CHAIN];
}

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "nexus-ai", 40);
  if (limited) return limited;
  const raw = await readJson<unknown>(req, 8_000_000);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return bad("Некорректный запрос к AI-шлюзу");
  const body = parsed.data;
  if (!getApiKey()) return bad("OPENROUTER_API_KEY не задан на сервере — AI недоступен", 503);

  // Secrets must never be forwarded to a third-party model.
  const system = redact(body.system);
  const prompt = redact(body.prompt);
  const chain = buildChain(body.chain);
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(110_000)]);

  try {
    if (body.images?.length) {
      const model = chain.find((m) => /gemma/.test(m.id)) ?? chain[0];
      if (!model || !isFreeModel(model.id)) return bad("Нет доступной мультимодальной бесплатной модели", 503);
      const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        signal,
        headers: { Authorization: `Bearer ${getApiKey()}`, "Content-Type": "application/json", "X-Title": "Nexus IDE" },
        body: JSON.stringify({
          model: model.id,
          max_tokens: body.maxTokens ?? 4000,
          messages: [
            { role: "system", content: system },
            { role: "user", content: [{ type: "text", text: prompt }, ...body.images.map((url) => ({ type: "image_url", image_url: { url } }))] },
          ],
        }),
      });
      if (!res.ok) return bad(`Провайдер вернул ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const text = j.choices?.[0]?.message?.content ?? "";
      if (!text) return bad("Модель вернула пустой ответ", 502);
      return Response.json({ text, model: model.id, label: model.label, usage: j.usage ? { promptTokens: j.usage.prompt_tokens, completionTokens: j.usage.completion_tokens } : undefined });
    }
    const r = await runLlm({
      messages: [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content: prompt }],
      chain,
      signal,
      maxTokens: body.maxTokens ?? 3500,
      temperature: body.temperature ?? 0.3,
      passes: 1,
    });
    return Response.json({ text: r.text, model: r.model, label: r.label, usage: r.usage });
  } catch (err) {
    if (err instanceof LlmError) return Response.json({ error: err.message, kind: err.kind }, { status: 502 });
    if (signal.aborted) return bad("Запрос отменён или превысил таймаут", 408);
    return bad(err instanceof Error ? err.message : "Ошибка AI-шлюза", 500);
  }
}
