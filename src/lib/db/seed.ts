export interface SeedFile {
  path: string;
  content: string;
}

export const SEED_FILES: SeedFile[] = [
  {
    path: "README.md",
    content: `# Nexus Demo Project

Добро пожаловать в **Nexus IDE** — веб-среду разработки с мульти-агентным ИИ.

## Что попробовать

- \`Cmd/Ctrl + K\` — командная палитра
- \`Cmd/Ctrl + L\` — фокус на ИИ-агенте
- \`Cmd/Ctrl + B\` — показать/скрыть сайдбар
- Переключите режим агента: **Chat**, **Work** или **Code**

Все файлы сохраняются в IndexedDB вашего браузера и переживают перезагрузку.
`,
  },
  {
    path: "package.json",
    content: `{
  "name": "nexus-demo",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`,
  },
  {
    path: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "react-jsx",
    "skipLibCheck": true
  },
  "include": ["src"]
}
`,
  },
  {
    path: "src/index.ts",
    content: `import { add, fibonacci, clamp } from "./lib/math";
import { fetchJson } from "./lib/fetcher";

interface Todo {
  id: number;
  title: string;
  completed: boolean;
}

async function main(): Promise<void> {
  console.log("2 + 3 =", add(2, 3));
  console.log("fib(10) =", fibonacci(10));
  console.log("clamp(15, 0, 10) =", clamp(15, 0, 10));

  const todo = await fetchJson<Todo>("https://jsonplaceholder.typicode.com/todos/1");
  console.log("Todo:", todo.title);
}

main().catch((error: unknown) => {
  console.error("Fatal:", error);
});
`,
  },
  {
    path: "src/lib/math.ts",
    content: `export function add(a: number, b: number): number {
  return a + b;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Медленная рекурсивная реализация — отличная цель для рефакторинга агентом
export function fibonacci(n: number): number {
  if (n < 2) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}
`,
  },
  {
    path: "src/lib/fetcher.ts",
    content: `export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const data = await response.json();
  return data as T;
}
`,
  },
  {
    path: "src/components/Button.tsx",
    content: `import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base = "px-4 py-2 rounded-md font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-indigo-600 text-white hover:bg-indigo-500"
      : "bg-transparent text-zinc-300 hover:bg-zinc-800";
  return <button className={\`\${base} \${styles} \${className}\`} {...props} />;
}
`,
  },
  {
    path: "src/components/Counter.tsx",
    content: `import { useState } from "react";
import { Button } from "./Button";

export function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => setCount(count - 1)}>-</Button>
      <span>{count}</span>
      <Button onClick={() => setCount(count + 1)}>+</Button>
    </div>
  );
}
`,
  },
  {
    path: "src/styles/app.css",
    content: `:root {
  --bg: #0a0a0a;
  --fg: #fafafa;
  --accent: #6366f1;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: ui-sans-serif, system-ui, sans-serif;
}

.card {
  border: 1px solid #27272a;
  border-radius: 12px;
  padding: 16px;
}
`,
  },
  {
    path: "docs/ROADMAP.md",
    content: `# Roadmap

- [x] Базовая структура проекта
- [ ] Покрыть \`math.ts\` unit-тестами
- [ ] Добавить обработку ошибок в \`fetchJson\`
- [ ] Написать компонент \`TodoList\`
`,
  },
];
