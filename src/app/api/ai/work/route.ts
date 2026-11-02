import { z } from "zod";
import { collectText, extractJson, streamAnswer } from "@/lib/ai/llm";
import { WORK_ANALYZE_SYSTEM, WORK_PLANNER_SYSTEM, WORK_REPORT_SYSTEM } from "@/lib/ai/prompts";
import type { AiEvent } from "@/lib/ai/events";
import { rateLimit } from "@/lib/nexus/server/guard";
import { sseResponse } from "@/lib/openrouter/sse";
import { renderSources, SOURCES_RULES } from "@/lib/web/inject";
import { doRead, doSearch, newResearch, toSources } from "@/lib/web/research";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const schema = z.object({
  goal: z.string().trim().min(3).max(8000),
  attachments: z.string().max(120_000).optional(),
  searchMode: z.enum(["auto", "on", "off"]).default("auto"),
  preferredModel: z.string().max(120).optional(),
});

interface PlanJson {
  summary?: string;
  steps?: { title?: string; tool?: string; input?: string }[];
}

const TOOLS = new Set(["search", "browse", "analyze", "write"]);

/**
 * Work agent: plan → run tools step by step (errors are isolated per step) → streamed final report.
 * Only a public action journal is emitted; hidden model reasoning is never forwarded.
 */
export async function POST(req: Request): Promise<Response> {
  const limited = rateLimit(req, "ai-work", 12);
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  const { goal, attachments, searchMode, preferredModel } = parsed.data;
  const web = searchMode !== "off";

  return sseResponse<AiEvent>(
    async (emit, signal) => {
      emit({ type: "phase", phase: "planning" });
      const planReq = `Цель пользователя:\n${goal}\n\n${attachments ? "К задаче приложены файлы пользователя (их содержимое доступно на шаге analyze).\n" : ""}Интернет: ${web ? "доступен" : "ОТКЛЮЧЁН (не используй search и browse)"}.\nТекущая дата: ${new Date().toISOString().slice(0, 10)}.`;
      let plan: PlanJson | null = null;
      try {
        const { text } = await collectText({
          messages: [{ role: "system", content: WORK_PLANNER_SYSTEM }, { role: "user", content: planReq }],
          preferredModel,
          signal,
          maxTokens: 1800,
        });
        plan = extractJson<PlanJson>(text);
      } catch (e) {
        emit({ type: "notice", message: `Планировщик недоступен: ${e instanceof Error ? e.message : "ошибка"}. Использую базовый план.` });
      }
      let steps = (plan?.steps ?? [])
        .filter((s) => s.tool && TOOLS.has(s.tool) && typeof s.input === "string")
        .filter((s) => web || (s.tool !== "search" && s.tool !== "browse"))
        .slice(0, 7)
        .map((s, i) => ({ id: `w${i + 1}`, title: (s.title ?? `Шаг ${i + 1}`).slice(0, 120), tool: s.tool as string, input: (s.input ?? "").slice(0, 600) }));
      if (steps.length === 0) {
        steps = [
          ...(web ? [{ id: "w1", title: "Поиск информации", tool: "search", input: goal.slice(0, 200) }, { id: "w2", title: "Чтение лучших источников", tool: "browse", input: "top" }] : []),
          { id: `w${web ? 3 : 1}`, title: "Анализ материалов", tool: "analyze", input: goal.slice(0, 400) },
        ];
      }
      emit({ type: "plan", summary: plan?.summary?.slice(0, 300) ?? goal.slice(0, 200), steps });
      emit({ type: "phase", phase: "running" });

      const state = newResearch();
      const notes: string[] = [];
      if (attachments) notes.push(`Файлы пользователя:\n${attachments.slice(0, 40_000)}`);

      for (const step of steps) {
        if (signal.aborted) return;
        emit({ type: "step", id: step.id, status: "running" });
        try {
          let output = "";
          if (step.tool === "search") {
            const r = await doSearch(state, step.input, signal);
            if (r.error) throw new Error(r.error);
            output = `Найдено ${r.count} результатов (${r.provider}) по запросу «${step.input}»`;
          } else if (step.tool === "browse") {
            const urls = /^https?:\/\//i.test(step.input) ? [{ url: step.input }] : state.unread.slice(0, 3);
            if (urls.length === 0) throw new Error("Нет страниц для чтения — сначала нужен поиск");
            const res = await Promise.all(urls.map((u) => doRead(state, u.url, signal)));
            const ok = res.filter((r) => r.ok);
            output = `Прочитано страниц: ${ok.length}/${res.length}${ok.length ? ` — ${ok.map((r) => r.title.slice(0, 50)).join("; ")}` : ""}`;
            if (ok.length === 0) throw new Error(res.map((r) => r.error).filter(Boolean).join("; ") || "Страницы недоступны");
          } else {
            const { block } = renderSources(state.docs, 2500);
            const { text } = await collectText({
              messages: [
                { role: "system", content: `${WORK_ANALYZE_SYSTEM}\n\n${state.docs.length ? SOURCES_RULES : ""}` },
                {
                  role: "user",
                  content: `Цель: ${goal}\n\nЗадание шага («${step.title}»): ${step.input}\n\nЗаметки предыдущих шагов:\n${notes.join("\n\n") || "—"}\n\n${block}`.slice(0, 60_000),
                },
              ],
              preferredModel,
              signal,
              maxTokens: 1500,
            });
            if (!text.trim()) throw new Error("Модель вернула пустой ответ");
            notes.push(`## ${step.title}\n${text.trim()}`);
            output = text.trim().slice(0, 500);
          }
          emit({ type: "step", id: step.id, status: "done", output });
        } catch (e) {
          emit({ type: "step", id: step.id, status: "error", error: e instanceof Error ? e.message : "Ошибка шага" });
          notes.push(`## ${step.title}\n[Шаг завершился ошибкой: ${e instanceof Error ? e.message : "ошибка"}]`);
        }
      }

      emit({ type: "phase", phase: "writing" });
      const { block, flagged } = renderSources(state.docs, 2500);
      if (state.docs.length) emit({ type: "sources", sources: toSources(state) });
      if (flagged.length) emit({ type: "notice", message: `Источники ${flagged.join(", ")} содержат инструкции, похожие на prompt injection — они проигнорированы.` });
      await streamAnswer(
        {
          messages: [
            { role: "system", content: `${WORK_REPORT_SYSTEM}\n\n${state.docs.length ? SOURCES_RULES : ""}` },
            { role: "user", content: `Цель: ${goal}\n\nЖурнал и заметки:\n${notes.join("\n\n").slice(0, 40_000)}\n\n${block}`.slice(0, 80_000) },
          ],
          preferredModel,
          signal,
          temperature: 0.4,
          maxTokens: 6000,
        },
        emit,
      );
    },
    { requestSignal: req.signal, deadlineMs: 285_000, makeError: (message) => ({ type: "error", kind: "server", message, failures: [] }) },
  );
}
