/**
 * Server helpers: turn an async producer into a Server-Sent-Events Response.
 * Works on both the Edge and Node.js runtimes (Web Streams only).
 */

export function encodeSSE(event: object): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export interface SSEOptions<T extends object> {
  /** Aborts the producer when the HTTP client disconnects. */
  requestSignal?: AbortSignal;
  /** Hard wall-clock deadline for the whole stream. */
  deadlineMs?: number;
  makeError: (message: string) => T;
}

export function sseResponse<T extends object>(
  run: (emit: (event: T) => void, signal: AbortSignal) => Promise<void>,
  options: SSEOptions<T>,
): Response {
  const encoder = new TextEncoder();
  const ac = new AbortController();
  let closed = false;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: T) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSSE(event)));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (deadline) clearTimeout(deadline);
        if (heartbeat) clearInterval(heartbeat);
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const onClientAbort = () => ac.abort();
      options.requestSignal?.addEventListener("abort", onClientAbort, { once: true });
      if (options.deadlineMs) {
        deadline = setTimeout(() => {
          emit(options.makeError("Достигнут лимит времени выполнения. Результат может быть неполным."));
          ac.abort();
        }, options.deadlineMs);
      }
      // Keeps proxies from closing idle connections during long model waits.
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          closed = true;
        }
      }, 15_000);

      run(emit, ac.signal)
        .catch((err: unknown) => {
          emit(options.makeError(err instanceof Error ? err.message : "Внутренняя ошибка сервера"));
        })
        .finally(() => {
          options.requestSignal?.removeEventListener("abort", onClientAbort);
          finish();
        });
    },
    cancel() {
      closed = true;
      ac.abort();
      if (deadline) clearTimeout(deadline);
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
