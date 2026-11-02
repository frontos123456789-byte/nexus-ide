import type { ChatSource } from "@/lib/db/schema";
import type { LlmEvent } from "@/lib/openrouter/types";

/** Events streamed by /api/ai/chat and /api/ai/work (superset of the OpenRouter fallback events). */
export type AiEvent =
  | LlmEvent
  | { type: "tool"; id: string; name: "search" | "browse"; status: "running" | "done" | "error"; input: string; summary?: string }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "notice"; message: string }
  | { type: "plan"; summary: string; steps: { id: string; title: string; tool: string; input: string }[] }
  | { type: "phase"; phase: "planning" | "running" | "writing" }
  | { type: "step"; id: string; status: "running" | "done" | "error"; output?: string; error?: string };
