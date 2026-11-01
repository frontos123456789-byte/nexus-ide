import { chatRequestSchema, sanitizeContext } from "@/lib/agents/request";
import { CHAT_SYSTEM, WORK_STEP_SYSTEM, WORK_SYSTEM } from "@/lib/agents/prompts";
import { renderContext } from "@/lib/agents/context";
import { getApiKey, streamWithFallback } from "@/lib/openrouter/client";
import { FREE_MODEL_CHAIN } from "@/lib/openrouter/models";
import { sseResponse } from "@/lib/openrouter/sse";
import type { ChatMessage, LlmEvent } from "@/lib/openrouter/types";

// Vercel: Edge runtime streams responses with no cold-start penalty.
export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SYSTEM_BY_MODE = {
  chat: CHAT_SYSTEM,
  work: WORK_SYSTEM,
  "work-step": WORK_STEP_SYSTEM,
} as const;

function errorEvent(message: string): LlmEvent {
  return { type: "error", kind: "server", message, failures: [] };
}

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Некорректный запрос", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const body = parsed.data;

  const ctx = sanitizeContext(body.context);
  const hasContext = ctx.tree.length > 0 || ctx.files.length > 0;
  const system = hasContext
    ? `${SYSTEM_BY_MODE[body.mode]}\n\n# Контекст проекта\n${renderContext(ctx)}`
    : SYSTEM_BY_MODE[body.mode];
  const messages: ChatMessage[] = [{ role: "system", content: system }, ...body.messages];

  return sseResponse<LlmEvent>(
    async (emit, signal) => {
      for await (const event of streamWithFallback({
        messages,
        preferredModel: body.preferredModel,
        signal,
        temperature: body.mode === "chat" ? 0.5 : 0.3,
      })) {
        emit(event);
      }
    },
    { requestSignal: req.signal, deadlineMs: 285_000, makeError: errorEvent },
  );
}

/** Lightweight status probe used by the status bar (never exposes the key). */
export async function GET(): Promise<Response> {
  return Response.json({
    configured: Boolean(getApiKey()),
    chain: FREE_MODEL_CHAIN.map((m) => ({ id: m.id, label: m.label, vendor: m.vendor })),
  });
}
