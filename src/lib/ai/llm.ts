import { streamWithFallback } from "@/lib/openrouter/client";
import type { ChatMessage, LlmEvent } from "@/lib/openrouter/types";

export interface CollectOptions {
  messages: ChatMessage[];
  preferredModel?: string;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

/** Runs the free-model fallback chain and returns the full text (used for planners / analysis steps). */
export async function collectText(o: CollectOptions): Promise<{ text: string; modelLabel?: string }> {
  let text = "";
  let modelLabel: string | undefined;
  for await (const ev of streamWithFallback({
    messages: o.messages,
    preferredModel: o.preferredModel,
    signal: o.signal,
    temperature: o.temperature ?? 0.2,
    maxTokens: o.maxTokens ?? 2500,
    firstTokenTimeoutMs: 20_000,
  })) {
    if (ev.type === "delta") text += ev.content;
    else if (ev.type === "reset") text = "";
    else if (ev.type === "done") modelLabel = ev.label;
    else if (ev.type === "error") throw new Error(ev.message);
  }
  return { text, modelLabel };
}

/** Forwards a streamed completion to `emit`, WITHOUT leaking hidden reasoning tokens. Returns the final text. */
export async function streamAnswer(
  o: CollectOptions,
  emit: (e: LlmEvent) => void,
): Promise<string> {
  let text = "";
  for await (const ev of streamWithFallback({
    messages: o.messages,
    preferredModel: o.preferredModel,
    signal: o.signal,
    temperature: o.temperature ?? 0.5,
    maxTokens: o.maxTokens ?? 6000,
  })) {
    if (ev.type === "reasoning") continue; // hidden chain-of-thought is never shown
    if (ev.type === "delta") text += ev.content;
    if (ev.type === "reset") text = "";
    emit(ev);
  }
  return text;
}

/** Extracts the first balanced JSON object from model output (models often wrap it in prose/fences). */
export function extractJson<T>(raw: string): T | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(raw.slice(start, i + 1)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
}
