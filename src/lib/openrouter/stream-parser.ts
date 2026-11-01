import type { Usage } from "./types";

export interface ParsedChunk {
  content?: string;
  reasoning?: string;
  finishReason?: string | null;
  usage?: Usage;
  error?: { message: string; code?: number | string };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Parses one SSE `data:` payload from OpenRouter. */
export function parseSSEData(data: string): ParsedChunk | "done" | null {
  const trimmed = data.trim();
  if (trimmed === "[DONE]") return "done";
  if (!trimmed) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;

  const out: ParsedChunk = {};

  if (isRecord(json.error)) {
    const code = json.error.code;
    out.error = {
      message: str(json.error.message) ?? "Unknown upstream error",
      code: typeof code === "number" || typeof code === "string" ? code : undefined,
    };
  }

  if (isRecord(json.usage)) {
    const u = json.usage;
    out.usage = {
      promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : undefined,
      completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : undefined,
      totalTokens: typeof u.total_tokens === "number" ? u.total_tokens : undefined,
    };
  }

  const choices = json.choices;
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const choice = choices[0];
    const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : null;
    if (delta) {
      const content = str(delta.content);
      const reasoning = str(delta.reasoning) ?? str(delta.reasoning_content);
      if (content) out.content = content;
      if (reasoning) out.reasoning = reasoning;
    }
    if (typeof choice.finish_reason === "string") out.finishReason = choice.finish_reason;
    if (isRecord(choice.error)) {
      out.error = { message: str(choice.error.message) ?? "Upstream choice error" };
    }
  }

  return out;
}

/**
 * Reads an SSE byte stream and yields raw `data:` payloads.
 * Comment lines (": OPENROUTER PROCESSING") are ignored on purpose so they
 * do not count as tokens for timeout purposes.
 */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trimStart();
        nl = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const rest = buffer.replace(/\r$/, "");
    if (rest.startsWith("data:")) yield rest.slice(5).trimStart();
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* stream already closed */
    }
    reader.releaseLock();
  }
}

/** Yields parsed chunks until `[DONE]` or end of stream. */
export async function* readChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<ParsedChunk> {
  for await (const data of readSSE(body)) {
    const parsed = parseSSEData(data);
    if (parsed === "done") return;
    if (parsed) yield parsed;
  }
}
