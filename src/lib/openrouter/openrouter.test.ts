import { describe, expect, it, vi } from "vitest";
import { LlmError, runLlm, streamWithFallback, type StreamOptions } from "./client";
import { FREE_MODEL_CHAIN, isFreeModel, resolveChain } from "./models";
import { parseSSEData, readChunks, readSSE } from "./stream-parser";
import type { LlmEvent } from "./types";

const enc = new TextEncoder();

function bodyOf(parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
}

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const reasoning = (r: string) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning: r } }] })}\n\n`;
const DONE = "data: [DONE]\n\n";

function okResponse(texts: string[]): Response {
  return new Response(bodyOf([": OPENROUTER PROCESSING\n\n", ...texts.map(delta), DONE]), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function errResponse(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, code: status } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (init: RequestInit) => Promise<Response> | Response;

function mockFetch(handlers: Record<string, Handler>) {
  const calls: string[] = [];
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    calls.push(body.model);
    const h = handlers[body.model];
    if (!h) return errResponse(404, "no handler");
    return h(init ?? {});
  });
  return { fetchImpl: fn as unknown as typeof fetch, calls, fn };
}

const base = (fetchImpl: typeof fetch, extra: Partial<StreamOptions> = {}): StreamOptions => ({
  messages: [{ role: "user", content: "hi" }],
  apiKey: "test-key",
  baseUrl: "http://mock",
  fetchImpl,
  passes: 1,
  sleep: async () => {},
  ...extra,
});

async function collect(opts: StreamOptions): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const e of streamWithFallback(opts)) events.push(e);
  return events;
}

const [M1, M2, M3, M4, M5, M6, M7] = FREE_MODEL_CHAIN.map((m) => m.id);

describe("model chain", () => {
  it("matches the required priority order and is free-only", () => {
    expect(FREE_MODEL_CHAIN.map((m) => m.id)).toEqual([
      "recursive/flint-v1.0:free",
      "cohere/north-mini-code:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "thinkingmachines/inkling-small:free",
      "google/gemma-4-31b-it:free",
      "nvidia/nemotron-3.5-lightning:free",
      "openrouter/free",
    ]);
    expect(FREE_MODEL_CHAIN.every((m) => isFreeModel(m.id))).toBe(true);
  });

  it("filters out paid models and honors the preferred model", () => {
    const chain = resolveChain(undefined, [
      ...FREE_MODEL_CHAIN,
      { id: "openai/gpt-4o", label: "paid", vendor: "x" },
    ]);
    expect(chain.some((m) => m.id === "openai/gpt-4o")).toBe(false);
    expect(resolveChain(M3)[0].id).toBe(M3);
    expect(resolveChain(M3)).toHaveLength(7);
    expect(resolveChain("unknown/model")[0].id).toBe(M1);
  });
});

describe("SSE parsing", () => {
  it("handles chunk boundaries inside lines, comments and [DONE]", async () => {
    const raw = delta("Hel") + ": keep-alive\n\n" + delta("lo") + DONE;
    const parts = [raw.slice(0, 7), raw.slice(7, 40), raw.slice(40)];
    const out: string[] = [];
    for await (const c of readChunks(bodyOf(parts))) if (c.content) out.push(c.content);
    expect(out.join("")).toBe("Hello");
  });

  it("parses reasoning, usage and errors", () => {
    expect(parseSSEData(JSON.stringify({ choices: [{ delta: { reasoning_content: "think" } }] }))).toMatchObject({
      reasoning: "think",
    });
    expect(parseSSEData(JSON.stringify({ choices: [], usage: { total_tokens: 5 } }))).toMatchObject({
      usage: { totalTokens: 5 },
    });
    expect(parseSSEData(JSON.stringify({ error: { message: "boom", code: 502 } }))).toMatchObject({
      error: { message: "boom", code: 502 },
    });
    expect(parseSSEData("[DONE]")).toBe("done");
    expect(parseSSEData("not json")).toBeNull();
  });

  it("ignores comment-only streams", async () => {
    const lines: string[] = [];
    for await (const l of readSSE(bodyOf([": a\n\n", ": b\n\n"]))) lines.push(l);
    expect(lines).toEqual([]);
  });
});

describe("fallback engine", () => {
  it("streams from the first model when healthy", async () => {
    const { fetchImpl, calls, fn } = mockFetch({ [M1]: () => okResponse(["Hel", "lo"]) });
    const events = await collect(base(fetchImpl));
    expect(calls).toEqual([M1]);
    expect(events.filter((e) => e.type === "delta").map((e) => (e as { content: string }).content)).toEqual(["Hel", "lo"]);
    expect(events.at(-1)).toMatchObject({ type: "done", model: M1, attempts: 1 });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("switches on 429, 5xx and empty responses with UI messages", async () => {
    const { fetchImpl, calls } = mockFetch({
      [M1]: () => errResponse(429, "Rate limit exceeded: temporarily"),
      [M2]: () => errResponse(503, "overloaded"),
      [M3]: () =>
        new Response(bodyOf([DONE]), { status: 200, headers: { "content-type": "text/event-stream" } }),
      [M4]: () => okResponse(["ok"]),
    });
    const events = await collect(base(fetchImpl));
    expect(calls).toEqual([M1, M2, M3, M4]);
    const switches = events.filter((e): e is Extract<LlmEvent, { type: "switch" }> => e.type === "switch");
    expect(switches.map((s) => s.reason)).toEqual(["rate_limit", "server", "empty"]);
    expect(switches[0].message).toContain("Переключение на North Mini Code");
    expect(events.at(-1)).toMatchObject({ type: "done", model: M4, attempts: 4 });
  });

  it("switches on first-token timeout", async () => {
    const hang: Handler = (init) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const { fetchImpl, calls } = mockFetch({ [M1]: hang, [M2]: () => okResponse(["fine"]) });
    const events = await collect(base(fetchImpl, { firstTokenTimeoutMs: 40 }));
    expect(calls).toEqual([M1, M2]);
    expect(events.find((e) => e.type === "switch")).toMatchObject({ reason: "timeout" });
    expect(events.at(-1)).toMatchObject({ type: "done", model: M2 });
  });

  it("switches on idle timeout after the stream started and resets partial output", async () => {
    const stall: Handler = (init) => {
      let sent = false;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(enc.encode(delta("partial")));
            return;
          }
          return new Promise<void>((_, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
              controller.error(new DOMException("aborted", "AbortError"));
            });
          }).catch(() => undefined);
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const { fetchImpl } = mockFetch({ [M1]: stall, [M2]: () => okResponse(["complete answer"]) });
    const result = await runLlm(base(fetchImpl, { idleTimeoutMs: 40, firstTokenTimeoutMs: 500 }));
    expect(result.text).toBe("complete answer");
    expect(result.model).toBe(M2);
  });

  it("resets partial text when a model fails mid-stream", async () => {
    const midstream: Handler = () =>
      new Response(
        bodyOf([
          delta("garbage "),
          `data: ${JSON.stringify({ error: { message: "upstream died", code: 502 } })}\n\n`,
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    const { fetchImpl } = mockFetch({ [M1]: midstream, [M2]: () => okResponse(["clean"]) });
    const seen: LlmEvent[] = [];
    const result = await runLlm(base(fetchImpl), (e) => seen.push(e));
    expect(seen.some((e) => e.type === "reset")).toBe(true);
    expect(result.text).toBe("clean");
  });

  it("forwards reasoning events but does not treat reasoning-only as success", async () => {
    const reasoningOnly: Handler = () =>
      new Response(bodyOf([reasoning("thinking..."), DONE]), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    const { fetchImpl, calls } = mockFetch({ [M1]: reasoningOnly, [M2]: () => okResponse(["answer"]) });
    const events = await collect(base(fetchImpl));
    expect(calls).toEqual([M1, M2]);
    expect(events.some((e) => e.type === "reasoning")).toBe(true);
    expect(events.some((e) => e.type === "reset")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "done", model: M2 });
  });

  it("aborts the whole chain immediately on the free-tier daily limit", async () => {
    const { fetchImpl, calls } = mockFetch({
      [M1]: () => errResponse(429, "Rate limit exceeded: free-models-per-day. Add 10 credits"),
      [M2]: () => okResponse(["never"]),
    });
    const events = await collect(base(fetchImpl));
    expect(calls).toEqual([M1]);
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "daily_limit" });
  });

  it("fails fast on 401", async () => {
    const { fetchImpl, calls } = mockFetch({ [M1]: () => errResponse(401, "No auth") });
    const events = await collect(base(fetchImpl));
    expect(calls).toEqual([M1]);
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "auth" });
  });

  it("reports an error without a key and never calls the network", async () => {
    const { fetchImpl, fn } = mockFetch({});
    const prev = { a: process.env.OPENROUTER_API_KEY, b: process.env.OPENROUTER };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER;
    try {
      const events = await collect({ ...base(fetchImpl), apiKey: undefined });
      expect(events[0]).toMatchObject({ type: "error", kind: "auth" });
      expect(fn).not.toHaveBeenCalled();
    } finally {
      if (prev.a) process.env.OPENROUTER_API_KEY = prev.a;
      if (prev.b) process.env.OPENROUTER = prev.b;
    }
  });

  it("walks all 7 models, retries the chain once and then reports exhaustion", async () => {
    const handlers: Record<string, Handler> = {};
    for (const m of FREE_MODEL_CHAIN) handlers[m.id] = () => errResponse(500, "down");
    const { fetchImpl, calls } = mockFetch(handlers);
    const sleep = vi.fn(async () => {});
    const events = await collect(base(fetchImpl, { passes: 2, sleep }));
    expect(calls).toHaveLength(14);
    expect(calls.slice(0, 7)).toEqual([M1, M2, M3, M4, M5, M6, M7]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "retry")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "exhausted" });
  });

  it("recovers on the second pass", async () => {
    let n = 0;
    const handlers: Record<string, Handler> = {};
    for (const m of FREE_MODEL_CHAIN) {
      handlers[m.id] = () => (++n <= 7 ? errResponse(502, "bad gateway") : okResponse(["back online"]));
    }
    const { fetchImpl } = mockFetch(handlers);
    const result = await runLlm(base(fetchImpl, { passes: 2 }));
    expect(result.text).toBe("back online");
  });

  it("honors a preferred model and never sends non-free ids", async () => {
    const { fetchImpl, calls } = mockFetch({ [M5]: () => okResponse(["x"]) });
    await collect(
      base(fetchImpl, {
        preferredModel: M5,
        chain: [...FREE_MODEL_CHAIN, { id: "anthropic/claude-3-opus", label: "paid", vendor: "x" }],
      }),
    );
    expect(calls).toEqual([M5]);
  });

  it("stops when the caller aborts", async () => {
    const ac = new AbortController();
    const slow: Handler = (init) =>
      new Promise<Response>((_, reject) => {
        init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        setTimeout(() => ac.abort(), 10);
      });
    const { fetchImpl, calls } = mockFetch({ [M1]: slow, [M2]: () => okResponse(["no"]) });
    const events = await collect(base(fetchImpl, { signal: ac.signal, firstTokenTimeoutMs: 5000 }));
    expect(calls).toEqual([M1]);
    expect(events.at(-1)).toMatchObject({ type: "error", kind: "aborted" });
  });

  it("runLlm throws LlmError with failures", async () => {
    const handlers: Record<string, Handler> = {};
    for (const m of FREE_MODEL_CHAIN) handlers[m.id] = () => errResponse(404, "gone");
    const { fetchImpl } = mockFetch(handlers);
    await expect(runLlm(base(fetchImpl))).rejects.toBeInstanceOf(LlmError);
  });

  it("handles a non-streaming JSON 200 reply", async () => {
    const json: Handler = () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "plain json" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const { fetchImpl } = mockFetch({ [M1]: json });
    const result = await runLlm(base(fetchImpl));
    expect(result.text).toBe("plain json");
  });
});
