export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type FailureKind =
  | "rate_limit"
  | "daily_limit"
  | "server"
  | "timeout"
  | "empty"
  | "network"
  | "not_found"
  | "payment"
  | "bad_request"
  | "auth"
  | "midstream"
  | "aborted";

export interface AttemptFailure {
  model: string;
  kind: FailureKind;
  detail: string;
}

/** Events produced by the fallback engine (and streamed to the UI as SSE). */
export type LlmEvent =
  | { type: "attempt"; model: string; label: string; index: number; total: number }
  | {
      type: "switch";
      from: string;
      fromLabel: string;
      to: string;
      toLabel: string;
      reason: FailureKind;
      detail: string;
      message: string;
    }
  | { type: "retry"; reason: FailureKind; delayMs: number; message: string }
  | { type: "reset"; model: string; reason: FailureKind }
  | { type: "delta"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "done"; model: string; label: string; attempts: number; usage?: Usage }
  | { type: "error"; kind: FailureKind | "exhausted"; message: string; failures: AttemptFailure[] };

export const FAILURE_REASON_RU: Record<FailureKind, string> = {
  rate_limit: "лимит запросов",
  daily_limit: "дневной лимит",
  server: "ошибка сервера",
  timeout: "таймаут",
  empty: "пустой ответ",
  network: "сбой сети",
  not_found: "модель недоступна",
  payment: "требуется оплата",
  bad_request: "запрос отклонён",
  auth: "ошибка авторизации",
  midstream: "обрыв потока",
  aborted: "отменено",
};

export const DAILY_LIMIT_MESSAGE =
  "Исчерпан дневной лимит бесплатных запросов OpenRouter. Лимит сбрасывается раз в сутки (UTC); пополнение баланса на $10 поднимает его до 1000 запросов/день.";
