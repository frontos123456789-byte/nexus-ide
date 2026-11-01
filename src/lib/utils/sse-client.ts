import { readSSE } from "@/lib/openrouter/stream-parser";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

function hasType(v: unknown): v is { type: string } {
  return typeof v === "object" && v !== null && typeof (v as { type?: unknown }).type === "string";
}

/**
 * POSTs JSON and yields each SSE event payload. The caller narrows `T`
 * (events always carry a string `type`, anything else is dropped).
 */
export async function* postEventStream<T extends { type: string }>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let message = `HTTP ${res.status}`;
    try {
      const j: unknown = await res.json();
      if (typeof j === "object" && j !== null && "error" in j && typeof (j as { error: unknown }).error === "string") {
        message = (j as { error: string }).error;
      }
    } catch {
      /* keep default */
    }
    throw new HttpError(res.status, message);
  }
  for await (const data of readSSE(res.body)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      continue;
    }
    if (hasType(parsed)) yield parsed as T;
  }
}

/** Coalesces high-frequency stream deltas into at most one flush per interval. */
export function createBatcher(flush: (text: string) => void, intervalMs = 50) {
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    if (!buffer) return;
    const text = buffer;
    buffer = "";
    flush(text);
  };
  return {
    push(text: string) {
      buffer += text;
      if (!timer) timer = setTimeout(run, intervalMs);
    },
    flush() {
      if (timer) clearTimeout(timer);
      run();
    },
    discard() {
      if (timer) clearTimeout(timer);
      timer = null;
      buffer = "";
    },
  };
}
