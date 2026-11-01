#!/usr/bin/env node
/**
 * Local mock of the OpenRouter /chat/completions streaming API for offline
 * development and e2e tests:
 *
 *   node scripts/mock-openrouter.mjs            # listens on :4010
 *   OPENROUTER_BASE_URL=http://127.0.0.1:4010/v1 OPENROUTER_API_KEY=mock npm run dev
 *
 * Failure scenario (to exercise the fallback chain):
 *   - recursive/flint-v1.0:free        -> 429 (rate limit)
 *   - cohere/north-mini-code:free      -> 503 (server error)
 *   - everything else                  -> healthy
 * Set MOCK_MODE=daily to answer every request with the free-tier daily-limit 429.
 */
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const MODE = process.env.MOCK_MODE ?? "fallback";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MATH = `const cache = new Map<number, number>();

export function add(a: number, b: number): number {
  return a + b;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Memoized Fibonacci — O(n) instead of O(2^n). */
export function fibonacci(n: number): number {
  if (n < 2) return n;
  const hit = cache.get(n);
  if (hit !== undefined) return hit;
  const value = fibonacci(n - 1) + fibonacci(n - 2);
  cache.set(n, value);
  return value;
}
`;

const MATH_TEST = `import { describe, expect, it } from "vitest";
import { add, clamp, fibonacci } from "./math";

describe("math", () => {
  it("adds", () => expect(add(2, 3)).toBe(5));
  it("clamps", () => expect(clamp(15, 0, 10)).toBe(10));
  it("computes fibonacci quickly", () => expect(fibonacci(50)).toBe(12586269025));
});
`;

function reply(system, user) {
  if (system.includes("Ты — Director, агент-режиссёр")) {
    return {
      text: JSON.stringify({
        summary: "Оптимизировать fibonacci и покрыть тестами",
        tasks: [
          { id: "t1", agent: "architect", title: "Проектирование мемоизации", instruction: "Спроектируй мемоизацию", dependsOn: [], files: [] },
          { id: "t2", agent: "coder", title: "Реализация math.ts", instruction: "Добавь мемоизацию", dependsOn: ["t1"], files: ["src/lib/math.ts"] },
          { id: "t3", agent: "coder", title: "Тесты math.test.ts", instruction: "Напиши тесты", dependsOn: ["t1"], files: ["src/lib/math.test.ts"] },
          { id: "t4", agent: "reviewer", title: "Ревью", instruction: "Проверь изменения", dependsOn: ["t2", "t3"], files: [] },
        ],
      }),
      delay: 25,
    };
  }
  if (system.includes("Ты — Architect")) {
    return { text: "## Подход\nИспользуем `Map` как кэш на уровне модуля.\n\n## Файлы\n- `src/lib/math.ts` — мемоизация\n- `src/lib/math.test.ts` — тесты\n", delay: 30 };
  }
  if (system.includes("Ты — Coder")) {
    const isTest = user.includes("Твои файлы: src/lib/math.test.ts");
    const path = isTest ? "src/lib/math.test.ts" : "src/lib/math.ts";
    return { text: `Готово.\n<file path="${path}">\n${isTest ? MATH_TEST : MATH}</file>`, delay: 40 };
  }
  if (system.includes("Ты — Reviewer")) {
    return {
      text: JSON.stringify({
        verdict: "approve",
        summary: "Изменения корректны, кэш не протекает между вызовами.",
        issues: [{ severity: "info", file: "src/lib/math.ts", message: "Можно ограничить размер кэша." }],
      }),
      delay: 25,
    };
  }
  if (system.includes("Подведи итог работы команды")) {
    return { text: "**Готово.** Fibonacci теперь работает за O(n), добавлены тесты. Ревьюер одобрил изменения.", delay: 20 };
  }
  if (system.includes("планировщик задач в режиме")) {
    return {
      text: "<thinking>\nЦель требует трёх этапов.\nСначала разберём требования, затем реализуем и проверим.\n</thinking>\n<plan>\ngoal: Реализовать фичу и проверить её\n1. Анализ требований | Уточнить входные данные и крайние случаи | S\n2. Реализация | Написать код и интеграцию | L\n3. Проверка | Добавить тесты и прогнать их | M\n</plan>",
      delay: 25,
    };
  }
  if (system.includes("исполнитель шагов плана")) {
    return { text: "Шаг выполнен.\n\n```ts\nexport const done = true;\n```", delay: 20 };
  }
  return {
    text: "Вот объяснение: `fibonacci` вызывает себя дважды, поэтому сложность растёт экспоненциально.\n\n```typescript\nconst memo = new Map<number, number>();\nexport function fib(n: number): number {\n  if (n < 2) return n;\n  if (memo.has(n)) return memo.get(n)!;\n  const v = fib(n - 1) + fib(n - 2);\n  memo.set(n, v);\n  return v;\n}\n```\n\n**Итог:** используйте мемоизацию.",
    delay: 18,
    reasoning: "Пользователь спрашивает про сложность. Нужно показать мемоизацию.",
  };
}

function chunk(content, extra = {}) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content, ...extra } }] })}\n\n`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  for await (const part of req) raw += part;
  const body = JSON.parse(raw);
  const model = body.model;
  const system = body.messages?.find((m) => m.role === "system")?.content ?? "";
  const user = body.messages?.filter((m) => m.role === "user").at(-1)?.content ?? "";
  console.log(`[mock] ${model} <- ${user.slice(0, 50).replace(/\n/g, " ")}`);

  if (!req.headers.authorization?.startsWith("Bearer ")) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "No auth", code: 401 } }));
    return;
  }
  if (MODE === "daily") {
    res.writeHead(429, { "content-type": "application/json" }).end(
      JSON.stringify({ error: { message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day", code: 429 } }),
    );
    return;
  }
  if (model === "recursive/flint-v1.0:free") {
    res.writeHead(429, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Provider rate limited", code: 429 } }));
    return;
  }
  if (model === "cohere/north-mini-code:free") {
    res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "Service unavailable", code: 503 } }));
    return;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  res.write(": OPENROUTER PROCESSING\n\n");
  const { text, delay, reasoning } = reply(system, user);
  if (reasoning) {
    res.write(chunk("", { reasoning }));
    await sleep(120);
  }
  for (let i = 0; i < text.length; i += 10) {
    if (res.destroyed) return;
    res.write(chunk(text.slice(i, i + 10)));
    await sleep(delay);
  }
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock] OpenRouter mock listening on http://127.0.0.1:${PORT}/v1 (mode=${MODE})`));
