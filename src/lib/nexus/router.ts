import { FREE_MODEL_CHAIN, isFreeModel } from "@/lib/openrouter/models";
import type { TaskType } from "./types";

export interface ModelInfo {
  id: string;
  label: string;
  vendor: string;
  contextWindow?: number;
  /** USD per 1M tokens as reported by the provider (0 for free models). */
  promptPrice?: number;
  completionPrice?: number;
}

export interface RouterPrefs {
  /** Manual choice: tried first for every task. */
  manualModel?: string;
  disabled: string[];
  /** Max reference USD per 1M completion tokens (paid models are never used regardless). */
  maxPrice?: number;
}

export interface RouteScore {
  model: ModelInfo;
  score: number;
  reasons: string[];
}

const TASK_HINTS: Record<TaskType, { match: RegExp; bonus: number; why: string }[]> = {
  code: [
    { match: /code|flint|coder/i, bonus: 30, why: "заточена под код" },
    { match: /nemotron/i, bonus: 12, why: "сильная инженерная модель" },
  ],
  reasoning: [
    { match: /ultra|550b|thinking|inkling/i, bonus: 30, why: "крупная модель для рассуждений" },
    { match: /nemotron/i, bonus: 10, why: "хорошие рассуждения" },
  ],
  chat: [{ match: /gemma|lightning/i, bonus: 15, why: "быстрый диалог" }],
  summarize: [{ match: /lightning|gemma/i, bonus: 18, why: "быстрая и дешёвая" }],
  json: [{ match: /gemma|nemotron/i, bonus: 14, why: "стабильный структурированный вывод" }],
  vision: [{ match: /gemma/i, bonus: 40, why: "мультимодальная" }],
};

export function baseCatalog(): ModelInfo[] {
  return FREE_MODEL_CHAIN.map((m) => ({ id: m.id, label: m.label, vendor: m.vendor }));
}

/**
 * Ranks models for a task. Never returns non-free models (policy of the IDE),
 * respects disabled models, a manual pick, context window needs and the price cap.
 */
export function rankModels(
  task: TaskType,
  needTokens: number,
  prefs: RouterPrefs,
  catalog: ModelInfo[] = baseCatalog(),
): RouteScore[] {
  const scores: RouteScore[] = [];
  catalog.forEach((m, idx) => {
    if (!isFreeModel(m.id) || prefs.disabled.includes(m.id)) return;
    const reasons: string[] = [];
    let score = 50 - idx * 2; // chain order = baseline priority
    for (const h of TASK_HINTS[task]) {
      if (h.match.test(m.id)) {
        score += h.bonus;
        reasons.push(h.why);
      }
    }
    if (m.contextWindow) {
      if (m.contextWindow < needTokens) {
        score -= 60;
        reasons.push(`контекст ${m.contextWindow} < нужных ${needTokens}`);
      } else if (m.contextWindow >= needTokens * 4) {
        score += 6;
        reasons.push("большой запас контекста");
      }
    }
    const price = (m.completionPrice ?? 0) + (m.promptPrice ?? 0);
    if (prefs.maxPrice !== undefined && price > prefs.maxPrice) {
      score -= 100;
      reasons.push("дороже лимита");
    }
    if (prefs.manualModel === m.id) {
      score += 1000;
      reasons.unshift("выбрана вручную");
    }
    scores.push({ model: m, score, reasons });
  });
  return scores.sort((a, b) => b.score - a.score);
}

/** Ordered model ids; the first is tried first and the rest form the fallback chain. */
export function routeChain(task: TaskType, needTokens: number, prefs: RouterPrefs, catalog?: ModelInfo[]): string[] {
  return rankModels(task, needTokens, prefs, catalog).map((s) => s.model.id);
}

export function taskForFeature(feature: string): TaskType {
  if (/test|refactor|fix|bug|merge|blueprint|architect|component|screenshot|heal|command/i.test(feature)) return "code";
  if (/debate|critic|security|explain/i.test(feature)) return "reasoning";
  if (/summar|memory/i.test(feature)) return "summarize";
  return "chat";
}
