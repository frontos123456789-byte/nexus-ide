import type { Budget, UsageEvent } from "./types";

export const DEFAULT_BUDGET: Budget = { dailyTokens: 400_000, dailyRequests: 300, monthlyUsd: 5 };

/** User-configurable *reference* rates (USD / 1M tokens). Free models are billed $0 by OpenRouter. */
export interface ReferenceRates {
  input: number;
  output: number;
}
export const DEFAULT_RATES: ReferenceRates = { input: 0.5, output: 1.5 };

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function referenceCost(e: Pick<UsageEvent, "promptTokens" | "completionTokens">, rates: ReferenceRates): number {
  return (e.promptTokens * rates.input + e.completionTokens * rates.output) / 1_000_000;
}

const DAY = 86_400_000;

export interface BudgetStatus {
  tokensToday: number;
  requestsToday: number;
  usdMonth: number;
  level: "ok" | "warn" | "blocked";
  messages: string[];
}

export function budgetStatus(events: UsageEvent[], budget: Budget, rates: ReferenceRates, now = Date.now()): BudgetStatus {
  const day = events.filter((e) => now - e.ts < DAY);
  const month = events.filter((e) => now - e.ts < 30 * DAY);
  const tokensToday = day.reduce((n, e) => n + e.promptTokens + e.completionTokens, 0);
  const usdMonth = month.reduce((n, e) => n + referenceCost(e, rates), 0);
  const messages: string[] = [];
  let level: BudgetStatus["level"] = "ok";
  const check = (used: number, limit: number, what: string) => {
    if (limit <= 0) return;
    if (used >= limit) {
      level = "blocked";
      messages.push(`Лимит исчерпан: ${what}`);
    } else if (used >= limit * 0.8 && level !== "blocked") {
      level = "warn";
      messages.push(`Использовано ≥80%: ${what}`);
    }
  };
  check(tokensToday, budget.dailyTokens, "токены за сутки");
  check(day.length, budget.dailyRequests, "запросы за сутки");
  check(usdMonth, budget.monthlyUsd, "референсные расходы за 30 дней");
  return { tokensToday, requestsToday: day.length, usdMonth, level, messages };
}

export interface Breakdown {
  key: string;
  requests: number;
  tokens: number;
  actualTokens: number;
  estimatedTokens: number;
  usd: number;
}

export function breakdownBy(
  events: UsageEvent[],
  pick: (e: UsageEvent) => string,
  rates: ReferenceRates,
): Breakdown[] {
  const map = new Map<string, Breakdown>();
  for (const e of events) {
    const key = pick(e) || "—";
    const b = map.get(key) ?? { key, requests: 0, tokens: 0, actualTokens: 0, estimatedTokens: 0, usd: 0 };
    const t = e.promptTokens + e.completionTokens;
    b.requests += 1;
    b.tokens += t;
    if (e.estimated) b.estimatedTokens += t;
    else b.actualTokens += t;
    b.usd += referenceCost(e, rates);
    map.set(key, b);
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens);
}
