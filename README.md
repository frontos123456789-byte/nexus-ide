# Nexus IDE

Веб-IDE с мульти-агентной оркестрацией, которая ощущается как Cursor / VS Code.
Работает **только на бесплатных моделях OpenRouter** (`:free`) с автоматическим fallback.

- **Chat** — диалоговый ассистент со стримингом, Markdown и блоками кода (копировать / вставить в курсор / в новый файл).
- **Work** — планировщик: цель → шаги с оценкой размера, прогресс-бар, выполнение шагов агентом, переключатель «Показать ход мыслей».
- **Code** — агент-режиссёр **Director** строит план и параллельно запускает суб-агентов **Architect → Coder×N → Reviewer**; живые карточки со статусами, diff-просмотрщик (Monaco), применение/отклонение файлов, итоговая сводка.

## Стек

Next.js (App Router, Turbopack) · TypeScript strict · Tailwind CSS v4 + shadcn-style UI (Radix) · Monaco (`@monaco-editor/react`, lazy, SSR-safe) ·
Zustand (глобальный стейт IDE и агентов) + Jotai (атомарный стейт редактора) · Dexie/IndexedDB (локальная ФС) · react-resizable-panels · cmdk · sonner · Vitest.

> Шаблон окружения поставляется с Next.js 16 (совместим с App Router API Next 15). `/api/chat` и `/api/agents` работают на **Edge runtime**.

## Быстрый старт

```bash
npm install
cp .env.example .env.local      # впишите OPENROUTER_API_KEY
npm run dev
```

Откройте http://localhost:3000. Все файлы хранятся в IndexedDB браузера и переживают перезагрузку.

### Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `OPENROUTER_API_KEY` | да | Ключ OpenRouter (https://openrouter.ai/keys). Читается **только на сервере**. Псевдоним `OPENROUTER` поддерживается как запасной. |
| `OPENROUTER_BASE_URL` | нет | Переопределение API (для mock-сервера в тестах). |
| `DATABASE_URL` | нет | Не используется самой IDE; проверяется в `/api/health`, только если задана. |

## Движок fallback (`src/lib/openrouter`)

Цепочка (строго `:free`; нефри-модели отфильтровываются в коде):

1. `recursive/flint-v1.0:free`
2. `cohere/north-mini-code:free`
3. `nvidia/nemotron-3-ultra-550b-a55b:free`
4. `thinkingmachines/inkling-small:free`
5. `google/gemma-4-31b-it:free`
6. `nvidia/nemotron-3.5-lightning:free`
7. `openrouter/free`

Авто-переход при 429 / 5xx / таймауте первого токена / паузе в потоке / пустом ответе / обрыве потока (частичный текст сбрасывается событием `reset`).
После полного круга цепочка проходится второй раз. Исключения: **дневной лимит free-tier** (`free-models-per-day`) и `401` останавливают цепочку сразу — повторять бессмысленно, пользователь видит понятное сообщение.
Статусы («Переключение на Nemotron…») стримятся в UI и пишутся в панель **Логи** терминала.

> Бесплатный аккаунт OpenRouter ограничен 50 запросами в день на все `:free` модели; при пополнении баланса на $10 лимит растёт до 1000.
> Режим Code делает до ~6 запросов за один запуск.

## Горячие клавиши

| Клавиши | Действие |
|---|---|
| `⌘/Ctrl+K` | Командная палитра |
| `⌘/Ctrl+P` | Быстрый переход к файлу |
| `⌘/Ctrl+L` | Фокус на агенте |
| `⌘/Ctrl+B` | Сайдбар |
| `⌘/Ctrl+J` | Терминал |
| `⌘/Ctrl+S` | Сохранить |
| `Alt+1/2/3` | Chat / Work / Code |

Звуковые уведомления выключены по умолчанию (переключатель в статус-баре / Activity Bar).

## Тесты

```bash
npm test                 # Vitest: fallback-движок, SSE-парсер, оркестратор, парсеры, IndexedDB-ФС, терминал, хоткеи
```

E2E (Playwright, не входит в зависимости проекта) с локальным mock-сервером OpenRouter, который имитирует 429/503 на первых моделях:

```bash
node scripts/mock-openrouter.mjs &
npm run build
OPENROUTER_BASE_URL=http://127.0.0.1:4010/v1 OPENROUTER_API_KEY=mock npx next start -p 3100 &
BASE_URL=http://127.0.0.1:3100 node e2e/smoke.mjs
```

## Деплой на Vercel

1. Запушьте репозиторий в GitHub и импортируйте его на https://vercel.com/new (Framework Preset: **Next.js** определяется автоматически).
2. В **Settings → Environment Variables** добавьте `OPENROUTER_API_KEY` (Production, Preview, Development).
3. Deploy. `/api/chat` и `/api/agents` — Edge-функции со стримингом (до 300 с); `/api/health` — проверка живости.

Через CLI:

```bash
npm i -g vercel
vercel link
printf '%s' "$OPENROUTER_API_KEY" | vercel env add OPENROUTER_API_KEY production
vercel deploy --prod
```

Monaco загружается с CDN jsDelivr (закреплена версия 0.52.2) — это снижает размер бандла и делает редактор SSR-безопасным.

## Структура

```
src/app/api/{chat,agents,health}   Edge-эндпоинты (SSE)
src/lib/openrouter                 клиент, fallback-цепочка, парсер потока, SSE
src/lib/agents                     промпты, Director/оркестратор, парсеры, режим Work
src/lib/store                      Zustand (ide, agent, dialogs), Jotai (editor-atoms)
src/lib/db                         Dexie-схема, ФС поверх IndexedDB, seed
src/components/ide/{Layout,Editor,Agent,FileTree,Terminal}
```

## Nexus Features (50-feature expansion)

Open with **Ctrl/Cmd+Shift+X**, the ✦ button in the activity bar, or the command palette. Five workspaces: AI Agents, Code Intelligence, Visual Studio, DevTools, Nexus Control. Status of every feature and its limits: [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md); audit and design: [`docs/NEXUS_EXPANSION_PLAN.md`](docs/NEXUS_EXPANSION_PLAN.md).
Server-side variables are listed in `.env.example`. Privileged routes need `NEXUS_ADMIN_KEY` in production.


## Accounts, GitHub & Vercel authorization

Nexus has real user accounts (PostgreSQL: `users`, `accounts`, `sessions`, `connected_providers`, `provider_permissions`,
`integration_audit_logs`). Sign in with **GitHub** or **Vercel** at `/login`; connect GitHub (GitHub App, per-repository access)
and Vercel (Vercel Integration) in **Settings → Аккаунт и подключения** or in the Control Center. No personal tokens are required.
Guest mode (no account) keeps working for chat / studios. The old manual-token form is kept under "Устаревший способ" until the
new flows are verified on real accounts.

* Setup guide (what the owner must register at GitHub/Vercel, callback URLs, env vars): [`docs/OAUTH_SETUP.md`](docs/OAUTH_SETUP.md)
* Tests: `npm test` (unit + end-to-end account flow against PostgreSQL with stubbed providers)
