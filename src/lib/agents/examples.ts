import type { AgentMode } from "@/lib/store/ide";

export interface ExamplePrompt {
  title: string;
  prompt: string;
}

export const EXAMPLE_PROMPTS: Record<AgentMode, ExamplePrompt[]> = {
  chat: [
    {
      title: "Объяснить код",
      prompt: "Объясни, что делает src/lib/math.ts, и почему fibonacci работает медленно. Как это ускорить?",
    },
    {
      title: "Типобезопасный fetch",
      prompt: "Как сделать fetchJson типобезопасным, чтобы он валидировал ответ сервера и обрабатывал ошибки?",
    },
    {
      title: "Написать тесты",
      prompt: "Напиши unit-тесты на vitest для функций из src/lib/math.ts, включая крайние случаи.",
    },
  ],
  work: [
    {
      title: "Компонент TodoList",
      prompt: "Добавить в проект компонент TodoList с сохранением в localStorage, фильтрами и тестами.",
    },
    {
      title: "Подготовка к деплою",
      prompt: "Подготовить проект к деплою на Vercel: сборка, переменные окружения, CI и документация.",
    },
    {
      title: "Рефакторинг",
      prompt: "Провести рефакторинг: вынести общие типы, добавить обработку ошибок в fetcher и покрыть тестами.",
    },
  ],
  code: [
    {
      title: "Оптимизировать fibonacci",
      prompt: "Оптимизируй fibonacci через мемоизацию в src/lib/math.ts и добавь файл с тестами src/lib/math.test.ts.",
    },
    {
      title: "Надёжный fetchJson",
      prompt: "Добавь в fetchJson проверку статуса ответа, таймаут через AbortController и понятные ошибки; обнови src/index.ts.",
    },
    {
      title: "Компонент TodoList",
      prompt: "Создай компонент src/components/TodoList.tsx с добавлением и удалением задач, используя существующий Button.",
    },
  ],
};

export const MODE_META: Record<AgentMode, { label: string; tagline: string; placeholder: string }> = {
  chat: {
    label: "Chat",
    tagline: "Диалог с ассистентом",
    placeholder: "Спросите о коде, ошибке или архитектуре…",
  },
  work: {
    label: "Work",
    tagline: "Планировщик задач",
    placeholder: "Опишите цель — агент разобьёт её на шаги…",
  },
  code: {
    label: "Code",
    tagline: "Оркестрация суб-агентов",
    placeholder: "Опишите изменение — Director запустит Architect, Coder и Reviewer…",
  },
};
