import { FREE_MODEL_CHAIN, isFreeModel, resolveChain, type ModelSpec } from "./models";
import { parseSSEData, readChunks } from "./stream-parser";
import {
  DAILY_LIMIT_MESSAGE,
  FAILURE_REASON_RU,
  type AttemptFailure,
  type ChatMessage,
  type FailureKind,
  type LlmEvent,
  type Usage,
} from "./types";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The key is read from OPENROUTER_API_KEY. `OPENROUTER` is accepted as a
 * legacy alias because some sandboxes expose the secret under that name.
 */
export function getApiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  const key = env.OPENROUTER_API_KEY?.trim() || env.OPENROUTER?.trim();
  return key || undefined;
}

export interface StreamOptions {
  messages: ChatMessage[];
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  chain?: readonly ModelSpec[];
  preferredModel?: string;
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  /** Max wait for the first content/reasoning token of an attempt. */
  firstTokenTimeoutMs?: number;
  /** Max silence between tokens once streaming has started. */
  idleTimeoutMs?: number;
  /** How many times the whole chain may be walked (>=1). */
  passes?: number;
  passDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  referer?: string;
  title?: string;
}

interface ResolvedOptions {
  messages: ChatMessage[];
  apiKey: string | undefined;
  baseUrl: string;
  fetchImpl: typeof fetch;
  chain: readonly ModelSpec[];
  preferredModel: string | undefined;
  signal: AbortSignal | undefined;
  temperature: number;
  maxTokens: number;
  firstTokenTimeoutMs: number;
  idleTimeoutMs: number;
  passes: number;
  passDelayMs: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  referer: string;
  title: string;
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveOptions(o: StreamOptions): ResolvedOptions {
  return {
    messages: o.messages,
    apiKey: o.apiKey ?? getApiKey(),
    baseUrl: (o.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? OPENROUTER_BASE_URL).replace(/\/$/, ""),
    fetchImpl: o.fetchImpl ?? fetch,
    chain: o.chain ?? FREE_MODEL_CHAIN,
    preferredModel: o.preferredModel,
    signal: o.signal,
    temperature: o.temperature ?? 0.4,
    maxTokens: o.maxTokens ?? 6000,
    firstTokenTimeoutMs: o.firstTokenTimeoutMs ?? 25_000,
    idleTimeoutMs: o.idleTimeoutMs ?? 30_000,
    passes: Math.max(1, o.passes ?? 2),
    passDelayMs: o.passDelayMs ?? 2_500,
    sleep: o.sleep ?? defaultSleep,
    referer: o.referer ?? process.env.NEXT_PUBLIC_APP_URL ?? "https://nexus-ide.vercel.app",
    title: o.title ?? "Nexus IDE",
  };
}

/* ------------------------------ classification ----------------------------- */

interface Classified {
  kind: FailureKind;
  fatal: boolean;
}

function extractErrorMessage(body: string): string {
  try {
    const json: unknown = JSON.parse(body);
    if (typeof json === "object" && json !== null && "error" in json) {
      const err = (json as { error: unknown }).error;
      if (typeof err === "string") return err;
      if (typeof err === "object" && err !== null && "message" in err) {
        const m = (err as { message: unknown }).message;
        if (typeof m === "string") return m;
      }
    }
  } catch {
    /* not JSON */
  }
  return body.trim().slice(0, 240) || "empty body";
}

export function classifyHttp(status: number, body: string): Classified {
  const isDaily = /free-models-per-day|per-day|openrouter_free_tier_daily|daily/i.test(body);
  if (status === 429) return isDaily ? { kind: "daily_limit", fatal: true } : { kind: "rate_limit", fatal: false };
  if (status === 401) return { kind: "auth", fatal: true };
  if (status === 402) return { kind: "payment", fatal: false };
  if (status === 404) return { kind: "not_found", fatal: false };
  if (status === 408) return { kind: "timeout", fatal: false };
  if (status === 400 || status === 403 || status === 422) return { kind: "bad_request", fatal: false };
  return { kind: "server", fatal: false };
}

const TRANSIENT: ReadonlySet<FailureKind> = new Set<FailureKind>([
  "rate_limit",
  "server",
  "timeout",
  "empty",
  "network",
  "midstream",
]);

/* --------------------------------- attempt --------------------------------- */

type AttemptResult =
  | { ok: true; usage?: Usage }
  | { ok: false; kind: FailureKind; detail: string; emitted: boolean; fatal: boolean };

async function* attempt(model: ModelSpec, o: ResolvedOptions): AsyncGenerator<LlmEvent, AttemptResult> {
  if (!isFreeModel(model.id)) {
    return { ok: false, kind: "bad_request", detail: "Только :free модели разрешены", emitted: false, fatal: false };
  }
  if (o.signal?.aborted) return { ok: false, kind: "aborted", detail: "Отменено", emitted: false, fatal: true };

  const ac = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, ms);
  };
  const onAbort = () => ac.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });

  let emitted = false;
  let contentChars = 0;
  let usage: Usage | undefined;

  const failFromError = (err: unknown): AttemptResult => {
    if (o.signal?.aborted) return { ok: false, kind: "aborted", detail: "Отменено", emitted, fatal: true };
    if (timedOut) {
      const ms = emitted ? o.idleTimeoutMs : o.firstTokenTimeoutMs;
      return { ok: false, kind: "timeout", detail: `нет данных ${ms} мс`, emitted, fatal: false };
    }
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, kind: emitted ? "midstream" : "network", detail, emitted, fatal: false };
  };

  try {
    arm(o.firstTokenTimeoutMs);

    let res: Response;
    try {
      res = await o.fetchImpl(`${o.baseUrl}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${o.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": o.referer,
          "X-Title": o.title,
        },
        body: JSON.stringify({
          model: model.id,
          messages: o.messages,
          stream: true,
          temperature: o.temperature,
          max_tokens: o.maxTokens,
        }),
      });
    } catch (err) {
      return failFromError(err);
    }

    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch (err) {
        return failFromError(err);
      }
      const c = classifyHttp(res.status, text);
      return {
        ok: false,
        kind: c.kind,
        detail: `HTTP ${res.status}: ${extractErrorMessage(text)}`,
        emitted: false,
        fatal: c.fatal,
      };
    }

    if (!res.body) return { ok: false, kind: "empty", detail: "пустое тело ответа", emitted: false, fatal: false };

    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      // Non-streaming reply (or a 200 carrying an error envelope).
      let text = "";
      try {
        text = await res.text();
      } catch (err) {
        return failFromError(err);
      }
      const parsed = parseSSEData(text);
      if (parsed && parsed !== "done") {
        if (parsed.error) {
          const code = typeof parsed.error.code === "number" ? parsed.error.code : 500;
          const c = classifyHttp(code, `${parsed.error.message} ${text}`);
          return { ok: false, kind: c.kind, detail: parsed.error.message, emitted: false, fatal: c.fatal };
        }
        if (parsed.content) {
          contentChars += parsed.content.length;
          emitted = true;
          yield { type: "delta", content: parsed.content };
        }
        usage = parsed.usage;
      }
    } else {
      for await (const chunk of readChunks(res.body)) {
        if (chunk.error) {
          const code = typeof chunk.error.code === "number" ? chunk.error.code : 502;
          const c = classifyHttp(code, `${chunk.error.message}`);
          return {
            ok: false,
            kind: emitted ? "midstream" : c.kind,
            detail: chunk.error.message,
            emitted,
            fatal: !emitted && c.fatal,
          };
        }
        if (chunk.usage) usage = chunk.usage;
        if (chunk.reasoning) {
          emitted = true;
          arm(o.idleTimeoutMs);
          yield { type: "reasoning", content: chunk.reasoning };
        }
        if (chunk.content) {
          emitted = true;
          contentChars += chunk.content.length;
          arm(o.idleTimeoutMs);
          yield { type: "delta", content: chunk.content };
        }
      }
    }

    if (o.signal?.aborted) return { ok: false, kind: "aborted", detail: "Отменено", emitted, fatal: true };
    if (timedOut) return failFromError(new Error("timeout"));
    if (contentChars === 0) {
      return { ok: false, kind: "empty", detail: "модель вернула пустой ответ", emitted, fatal: false };
    }
    return { ok: true, usage };
  } catch (err) {
    return failFromError(err);
  } finally {
    if (timer) clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    ac.abort();
  }
}

/* ---------------------------------- engine --------------------------------- */

function fatalMessage(kind: FailureKind, detail: string): string {
  if (kind === "daily_limit") return DAILY_LIMIT_MESSAGE;
  if (kind === "auth") return `OPENROUTER_API_KEY не задан или недействителен (${detail}).`;
  if (kind === "aborted") return "Запрос отменён.";
  return detail;
}

/**
 * Streams a completion, transparently walking the free-model chain on
 * 429 / 5xx / timeout / empty responses. Yields UI-friendly events.
 */
export async function* streamWithFallback(options: StreamOptions): AsyncGenerator<LlmEvent> {
  const o = resolveOptions(options);
  const failures: AttemptFailure[] = [];

  if (!o.apiKey) {
    yield {
      type: "error",
      kind: "auth",
      message: "OPENROUTER_API_KEY не задан. Добавьте ключ в переменные окружения (см. README).",
      failures,
    };
    return;
  }

  const chain = resolveChain(o.preferredModel, o.chain);
  if (chain.length === 0) {
    yield { type: "error", kind: "bad_request", message: "Цепочка моделей пуста.", failures };
    return;
  }

  let attempts = 0;
  for (let pass = 0; pass < o.passes; pass++) {
    const passStart = failures.length;
    for (let i = 0; i < chain.length; i++) {
      const model = chain[i];
      attempts++;
      yield { type: "attempt", model: model.id, label: model.label, index: i, total: chain.length };

      const result = yield* attempt(model, o);
      if (result.ok) {
        yield { type: "done", model: model.id, label: model.label, attempts, usage: result.usage };
        return;
      }

      failures.push({ model: model.id, kind: result.kind, detail: result.detail });
      if (result.emitted) yield { type: "reset", model: model.id, reason: result.kind };

      if (result.fatal) {
        yield { type: "error", kind: result.kind, message: fatalMessage(result.kind, result.detail), failures };
        return;
      }

      const next = chain[i + 1];
      if (next) {
        yield {
          type: "switch",
          from: model.id,
          fromLabel: model.label,
          to: next.id,
          toLabel: next.label,
          reason: result.kind,
          detail: result.detail,
          message: `Переключение на ${next.label}… (${model.label}: ${FAILURE_REASON_RU[result.kind]})`,
        };
      }
    }

    const passFailures = failures.slice(passStart);
    const canRetry = passFailures.some((f) => TRANSIENT.has(f.kind));
    if (pass < o.passes - 1 && canRetry) {
      const seconds = Math.round(o.passDelayMs / 100) / 10;
      yield {
        type: "retry",
        reason: passFailures[passFailures.length - 1].kind,
        delayMs: o.passDelayMs,
        message: `Все модели временно недоступны. Повтор цепочки через ${seconds}с…`,
      };
      await o.sleep(o.passDelayMs, o.signal);
      if (o.signal?.aborted) {
        yield { type: "error", kind: "aborted", message: "Запрос отменён.", failures };
        return;
      }
    } else {
      break;
    }
  }

  const last = failures[failures.length - 1];
  const summary = failures
    .slice(-chain.length)
    .map((f) => `${f.model}: ${FAILURE_REASON_RU[f.kind]}`)
    .join("; ");
  yield {
    type: "error",
    kind: "exhausted",
    message: `Все модели из цепочки не ответили (${summary || "нет данных"}).${last ? ` Последняя ошибка: ${last.detail}` : ""}`,
    failures,
  };
}

/* ---------------------------------- helpers --------------------------------- */

export class LlmError extends Error {
  readonly kind: FailureKind | "exhausted";
  readonly failures: AttemptFailure[];
  constructor(kind: FailureKind | "exhausted", message: string, failures: AttemptFailure[]) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.failures = failures;
  }
}

export interface LlmResult {
  text: string;
  reasoning: string;
  model: string;
  label: string;
  usage?: Usage;
}

/** Runs a completion to the end, forwarding every event to `onEvent`. */
export async function runLlm(options: StreamOptions, onEvent?: (e: LlmEvent) => void): Promise<LlmResult> {
  let text = "";
  let reasoning = "";
  let model = "";
  let label = "";
  let usage: Usage | undefined;
  for await (const e of streamWithFallback(options)) {
    onEvent?.(e);
    if (e.type === "done") {
      usage = e.usage;
      model = e.model;
      label = e.label;
    }
    if (e.type === "delta") text += e.content;
    else if (e.type === "reasoning") reasoning += e.content;
    else if (e.type === "reset") {
      text = "";
      reasoning = "";
    } else if (e.type === "attempt") {
      model = e.model;
      label = e.label;
    } else if (e.type === "error") throw new LlmError(e.kind, e.message, e.failures);
  }
  return { text, reasoning, model, label, usage };
}
