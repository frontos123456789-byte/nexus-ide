import { z } from "zod";
import { CONTEXT_LIMITS, trimContext, type ProjectContext } from "./context";

const contextSchema = z.object({
  tree: z.array(z.string().max(300)).max(2000).default([]),
  files: z
    .array(z.object({ path: z.string().max(300), content: z.string().max(200_000) }))
    .max(40)
    .default([]),
  activePath: z.string().max(300).optional(),
});

export const chatRequestSchema = z.object({
  mode: z.enum(["chat", "work", "work-step"]).default("chat"),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(60_000) }))
    .min(1)
    .max(60),
  preferredModel: z.string().max(120).optional(),
  context: contextSchema.optional(),
});

export const agentsRequestSchema = z.object({
  task: z.string().trim().min(1).max(6000),
  preferredModel: z.string().max(120).optional(),
  context: contextSchema.optional(),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type AgentsRequest = z.infer<typeof agentsRequestSchema>;

export function sanitizeContext(raw: z.infer<typeof contextSchema> | undefined): ProjectContext {
  return trimContext(
    raw ? { tree: raw.tree, files: raw.files, activePath: raw.activePath } : { tree: [], files: [] },
    CONTEXT_LIMITS,
  );
}
