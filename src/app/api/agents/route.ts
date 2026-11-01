import { agentsRequestSchema, sanitizeContext } from "@/lib/agents/request";
import { runOrchestration, type LlmStream } from "@/lib/agents/orchestrator";
import type { AgentEvent } from "@/lib/agents/types";
import { getApiKey, streamWithFallback } from "@/lib/openrouter/client";
import { sseResponse } from "@/lib/openrouter/sse";

export const runtime = "edge";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request): Promise<Response> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }
  const parsed = agentsRequestSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Некорректный запрос", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const body = parsed.data;
  const context = sanitizeContext(body.context);

  return sseResponse<AgentEvent>(
    async (emit, signal) => {
      if (!getApiKey()) {
        emit({
          type: "error",
          kind: "auth",
          message: "OPENROUTER_API_KEY не задан. Добавьте ключ в переменные окружения (см. README).",
        });
        return;
      }
      const stream: LlmStream = (messages, s) =>
        streamWithFallback({ messages, signal: s, preferredModel: body.preferredModel, temperature: 0.3 });
      await runOrchestration({ task: body.task, context, stream, emit, signal, maxParallel: 3 });
    },
    {
      requestSignal: req.signal,
      deadlineMs: 285_000,
      makeError: (message): AgentEvent => ({ type: "error", message }),
    },
  );
}
