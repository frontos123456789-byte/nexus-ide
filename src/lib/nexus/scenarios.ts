/** AI Task Marketplace: scenarios are prompt templates only — they never execute code by themselves. */

export interface Scenario {
  id: string;
  name: string;
  category: "Качество" | "Тесты" | "Документация" | "Безопасность" | "Архитектура" | "UI";
  version: string;
  description: string;
  inputs: { key: string; label: string; placeholder?: string }[];
  system: string;
  template: string;
  builtin?: boolean;
}

export const BUILTIN_SCENARIOS: Scenario[] = [
  { id: "jsdoc", name: "Документировать модуль", category: "Документация", version: "1.0.0", builtin: true, description: "Добавляет JSDoc/TSDoc ко всем экспортам файла.", inputs: [{ key: "path", label: "Файл", placeholder: "src/lib/utils/path.ts" }], system: "Ты технический писатель. Не меняй логику кода.", template: "Добавь JSDoc ко всем экспортируемым функциям и типам в файле {{path}}. Верни полный файл." },
  { id: "readme", name: "Сгенерировать README", category: "Документация", version: "1.0.0", builtin: true, description: "Создаёт README по структуре проекта.", inputs: [], system: "Ты технический писатель.", template: "Составь README.md проекта: назначение, запуск, структура, переменные окружения. Опирайся только на реальные файлы." },
  { id: "tests-unit", name: "Юнит-тесты для файла", category: "Тесты", version: "1.0.0", builtin: true, description: "Генерирует vitest-тесты.", inputs: [{ key: "path", label: "Файл" }], system: "Ты QA-инженер. Пиши vitest-тесты без выдуманных API.", template: "Напиши vitest-тесты для {{path}}: основные сценарии, граничные случаи, ошибки. Сохрани рядом как *.test.ts." },
  { id: "dedupe", name: "Убрать дублирование", category: "Качество", version: "1.0.0", builtin: true, description: "Находит и сводит повторяющийся код.", inputs: [{ key: "scope", label: "Папка", placeholder: "src/lib" }], system: "Ты опытный рефакторер. Сохраняй поведение.", template: "Найди дублирующийся код в {{scope}} и вынеси общую часть в функцию. Не ломай публичные API." },
  { id: "a11y-fix", name: "Исправить доступность", category: "UI", version: "1.0.0", builtin: true, description: "Добавляет alt, aria, label, фокус.", inputs: [{ key: "path", label: "Файл" }], system: "Ты эксперт по WCAG 2.2 AA.", template: "Исправь проблемы доступности в {{path}}: alt, label, aria, контраст, порядок фокуса. Верни полный файл." },
  { id: "sec-review", name: "Security review файла", category: "Безопасность", version: "1.0.0", builtin: true, description: "Ищет уязвимости и предлагает патч.", inputs: [{ key: "path", label: "Файл" }], system: "Ты AppSec-инженер.", template: "Проведи security-ревью {{path}} (OWASP Top 10). Исправь найденное минимальным патчем." },
  { id: "adr", name: "Записать ADR", category: "Архитектура", version: "1.0.0", builtin: true, description: "Оформляет архитектурное решение.", inputs: [{ key: "decision", label: "Решение", placeholder: "Используем Zustand для стейта" }], system: "Ты архитектор ПО.", template: "Оформи ADR в docs/adr/ по шаблону (Контекст, Решение, Последствия, Альтернативы): {{decision}}" },
  { id: "types-fix", name: "Устранить any", category: "Качество", version: "1.0.0", builtin: true, description: "Заменяет any на точные типы.", inputs: [{ key: "path", label: "Файл" }], system: "Ты TypeScript-эксперт.", template: "Замени `any` на точные типы в {{path}} без изменения поведения." },
];

export function renderScenario(s: Scenario, values: Record<string, string>): string {
  return s.template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k]?.trim() || `[${k}]`);
}

/** Basic structural validation for imported/custom scenarios. */
export function validateScenario(s: Partial<Scenario>): string | null {
  if (!s.name?.trim()) return "Укажите название";
  if (!s.template?.trim()) return "Шаблон не может быть пустым";
  if (s.template.length > 4000) return "Шаблон длиннее 4000 символов";
  if (/(```|<script|rm\s+-rf|curl\s+[^|]*\|\s*(ba)?sh)/i.test(s.template)) return "Шаблон содержит потенциально опасные конструкции";
  return null;
}
