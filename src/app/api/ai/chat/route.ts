import { z } from "zod";
import { collectText, extractJson, streamAnswer } from "@/lib/ai/llm";
import { GENERAL_CHAT_SYSTEM, SEARCH_DECIDER_SYSTEM, SEARCH_FORCED_SYSTEM } from "@/lib/ai/prompts";
import type { AiEvent } from "@/lib/ai/events";
import { rateLimit } from "@/lib/nexus/server/guard";
import { sseResponse } from "@/lib/openrouter/sse";
import type { ChatMessage } from "@/lib/openrouter/types";
import { renderSources, SOURCES_RULES } from "@/lib/web/inject";
import { doRead, doSearch, newResearch, toSources } from "@/lib/web/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(160_000) }))
    .min(1)
    .max(40),
  searchMode: z.enum(["auto", "on", "off"]).default("auto"),
  preferredModel: z.string().max(120).optional(),
});

/** Cheap pre-filter for Auto mode when the decider model is unavailable. */
const FRESHNESS = /(сегодня|сейчас|последн|новост|курс|погод|цена|стоимост|202\d|актуальн|latest|news|today|current|price|weather|release|version|кто такой|who is)/i;

function lastUserText(messages: { role: string; content: string }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "user") return messages[i]?.content ?? "";
  return "";
}

export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "ai-chat", 40);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  const { messages, searchMode, preferredModel } = parsed.data;

  return sseResponse<AiEvent>(
    async (emit, signal) => {
      const question = lastUserText(messages).replace(/<attachment[\s\S]*?<\/attachment>/g, "").slice(0, 2000);
      let system = GENERAL_CHAT_SYSTEM;

      if (searchMode !== "off") {
        // 1) Decide whether (and what) to search.
        let queries: string[] = [];
        try {
          const decider = searchMode === "on" ? SEARCH_FORCED_SYSTEM : SEARCH_DECIDER_SYSTEM;
          const hist = messages.slice(-4).map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content.replace(/<attachment[\s\S]*?<\/attachment>/g, "[файл]").slice(0, 600)}`);
          const { text } = await collectText({
            messages: [{ role: "system", content: decider }, { role: "user", content: hist.join("\n") }],
            preferredModel,
            signal,
            maxTokens: 300,
          });
          const j = extractJson<{ search?: boolean; queries?: unknown }>(text);
          const qs = Array.isArray(j?.queries) ? j.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 1).slice(0, 3) : [];
          if (searchMode === "on" || j?.search) queries = qs;
        } catch {
          emit({ type: "notice", message: "Не удалось автоматически определить необходимость поиска — использую эвристику." });
        }
        if (queries.length === 0 && (searchMode === "on" || FRESHNESS.test(question)) && question.trim()) queries = [question.slice(0, 200)];

        // 2) Run the searches and read the best pages.
        if (queries.length > 0) {
          const state = newResearch();
          for (const [i, q] of queries.entries()) {
            const id = `s${i}`;
            emit({ type: "tool", id, name: "search", status: "running", input: q });
            const r = await doSearch(state, q, signal);
            emit({ type: "tool", id, name: "search", status: r.error ? "error" : "done", input: q, summary: r.error ?? `${r.count} результатов (${r.provider})` });
          }
          const toRead = state.unread.slice(0, 3);
          await Promise.all(
            toRead.map(async (r, i) => {
              const id = `b${i}`;
              emit({ type: "tool", id, name: "browse", status: "running", input: r.url });
              const res = await doRead(state, r.url, signal);
              emit({ type: "tool", id, name: "browse", status: res.ok ? "done" : "error", input: r.url, summary: res.ok ? `${res.title.slice(0, 80)} · ${res.chars} симв.` : res.error });
            }),
          );
          if (state.docs.length > 0) {
            const { block, flagged } = renderSources(state.docs);
            emit({ type: "sources", sources: toSources(state) });
            if (flagged.length) emit({ type: "notice", message: `В источниках ${flagged.join(", ")} обнаружены инструкции, похожие на prompt injection — они проигнорированы.` });
            system = `${GENERAL_CHAT_SYSTEM}\n\n${SOURCES_RULES}\n\nТекущая дата: ${new Date().toISOString().slice(0, 10)}.\n\n${block}`;
          } else {
            emit({ type: "notice", message: "Интернет-поиск не вернул результатов — отвечаю без источников и не утверждаю свежих фактов." });
            system = `${GENERAL_CHAT_SYSTEM}\n\nПоиск в интернете был выполнен, но результатов нет. Не выдумывай актуальные факты; прямо скажи пользователю, что проверить их не удалось.`;
          }
        }
      }

      const chat: ChatMessage[] = [{ role: "system", content: system }, ...messages];
      await streamAnswer({ messages: chat, preferredModel, signal, temperature: 0.5 }, emit);
    },
    { requestSignal: req.signal, deadlineMs: 285_000, makeError: (message) => ({ type: "error", kind: "server", message, failures: [] }) },
  );
}
