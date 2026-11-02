# Nexus IDE — план расширения (50 функций)

## 1. Аудит репозитория (до изменений)

| Область | Находка |
|---|---|
| Стек | Next.js 16.2 (App Router, Turbopack), React 19, TypeScript 5.9, Tailwind 4, Radix UI, cmdk, sonner |
| Редактор | Monaco (`@monaco-editor/react`), вкладки, breadcrumbs, DiffViewer |
| Файлы/проекты | Виртуальная ФС в **IndexedDB (Dexie)**: таблицы `files` и `kv` (`src/lib/db`). Один проект `nexus-demo` в браузере |
| Состояние | zustand (`store/ide.ts`, `store/agent.ts`), jotai для редактора. Настройки UI — в `kv["ui-state"]` |
| AI | OpenRouter, цепочка из 7 **бесплатных** моделей с fallback (`lib/openrouter`), режимы Chat / Work / Code (оркестратор Director→Architect→Coder→Reviewer, `lib/agents`), SSE-стриминг |
| Терминал | Имитация оболочки над виртуальной ФС (`utils/terminal-commands.ts`) — реального исполнения команд нет |
| Git | Отсутствует (нет репозитория внутри IDE) |
| Серверная часть | `/api/chat`, `/api/agents`, `/api/health`. Авторизации нет — приложение публичное. Postgres в шаблоне есть, но продакшен его не использует |
| Тесты | vitest, 69 тестов (openrouter, agents, fs, path, tree-model, utils) |
| Адаптивность | Мобильный режим (`MobileShell`), PWA manifest |
| Дизайн-система | Тёмная тема, токены в `globals.css` (`bg-panel`, `border-border`, `accent`), `ui/button`, `ui/dialog`, `ui/tooltip` |

### Исходные ошибки (до изменений)
`tsc --noEmit`: 0 ошибок · `eslint .`: 0 · `vitest`: 69/69 · сборка: успешна. **Исходных ошибок нет.**

### Принятые архитектурные решения
1. **Не создавать новый стейт**: данные Nexus лежат в том же Dexie `kv` (ключи `nexus-data`, `nexus-snap:<id>`, `nexus:<panel>`).
2. **Единый проход для AI-изменений** — `applyChanges()` (`lib/nexus/actions.ts`): права → скан секретов → проверка конкурентных изменений → страховочный снапшот → запись → журнал.
3. **Единый AI-шлюз** `/api/nexus/ai` + `askAi()`: роутер моделей, бюджет, лимит вызовов на запуск, маскирование секретов, учёт токенов.
4. **Привилегированные серверные роуты** (БД, прокси, деплой, Docker, Figma, Git, env) защищены `NEXUS_ADMIN_KEY`, потому что приложение публичное. Без ключа в production они отключены.
5. Агентам **не даётся** исполнение команд на сервере приложения (нет песочницы); AI Terminal только предлагает команды.
6. Только бесплатные модели (политика существующего приложения сохранена).

## 2. Матрица функций

Условные обозначения состояния до работ: **нет** — отсутствовала, **частично** — была база.
Зависимости: новых npm-пакетов **не добавлено** (используются `diff`, `zod`, `zustand`, `dexie`, `pg`, Radix — уже были).

| # | Функция | До | Переиспользовано | Файлы | Серверная часть | Риски | Проверка готовности |
|---|---|---|---|---|---|---|---|
| 1 | Agent Commander | частично (оркестратор Code-режима) | `lib/openrouter`, SSE | `runner.ts`, `panels/agents.tsx` | `/api/nexus/ai` | Лимиты бесплатных моделей | Создать агента → задача → прогресс/отмена/ретрай |
| 2 | Visual Workflow | нет | — | `workflow.ts`, `agents2.tsx` | AI-шлюз | Циклы → запрещены валидацией | 5 unit-тестов движка |
| 3 | AI Swarm | нет | `diff` | `swarm.ts`, `merge.ts`, `runner.ts` | AI-шлюз | Конфликты правок | 3 unit-теста слияния |
| 4 | Agent Memory | нет | Dexie kv | `memory.ts`, `agents.tsx` | — | Переполнение | 3 unit-теста |
| 5 | AI Debate | нет | — | `agents2.tsx` | AI-шлюз | Качество моделей | 3 раунда в UI |
| 6 | Smart Model Router | частично (fallback-цепочка) | `FREE_MODEL_CHAIN` | `router.ts`, `/api/nexus/status` | метаданные OpenRouter | Нет контекстов у части моделей | 3 unit-теста |
| 7 | Agent Replay | нет | — | `actions.ts#logReplay`, `agents.tsx` | — | Утечка секретов → `redact()` | Тест redact |
| 8 | Bug Hunter | нет | поиск, контекст | `agents2.tsx` | AI-шлюз | Тесты не исполняются в браузере | Ручной сценарий |
| 9 | AI Project Architect | нет | `AiTool` | `agents2.tsx` | AI-шлюз | Галлюцинации | Файлы docs/ в diff |
| 10 | Agent Permissions | нет | — | `permissions.ts`, `NexusRoot.tsx` | — | Клиентское применение | 2 unit-теста |
| 11 | Predictive Editing | нет | Monaco | `predictive.ts` | AI-шлюз | Расход квоты | Ручной (Tab/Esc) |
| 12 | Semantic Search | нет | — | `search.ts` | — | Не векторный | 1 unit-тест |
| 13 | Refactoring Studio | нет | `ChangeSet` | `intelligence.tsx` | AI-шлюз | Rename по regex | diff-предпросмотр |
| 14 | Code Explanation Lens | нет | граф импортов | `intelligence.tsx` | AI-шлюз | — | Ручной |
| 15 | Smart Error Fix | нет | маркеры Monaco | `intelligence.tsx` | AI-шлюз | Маркеры только открытых файлов | Ручной |
| 16 | Multi-file Preview | частично (DiffViewer) | `diff` | `ui.tsx#ChangeSet` | — | Принятие по файлам, не по hunk | Ручной |
| 17 | Dependency Map | нет | — | `graph.ts`, `ui.tsx#GraphView` | — | Лимит 160 узлов | 2 unit-теста |
| 18 | Test Generator | нет | детект фреймворка | `intelligence.tsx` | AI-шлюз | Запуск вне браузера | Ручной |
| 19 | Natural Language Commands | нет | поиск, маркеры | `intelligence.tsx` | AI-шлюз | Неверное толкование → план+diff | Ручной |
| 20 | Code Health Score | нет | — | `health.ts` | — | Эвристики | 1 unit-тест + формула в UI |
| 21 | Visual Component Editor | нет | DOMParser | `visual.tsx` | — | Только HTML | Ручной |
| 22 | Responsive Matrix | нет | iframe | `visual.tsx` | — | sandbox без JS | Ручной |
| 23 | Screenshot → Component | нет | — | `visual.tsx` | AI-шлюз (vision) | Нужна vision-модель | Ручной |
| 24 | Visual Diff | нет | canvas | `visual.tsx` | — | Размер картинок | Ручной |
| 25 | AI UI Critic | нет | `a11y.ts` | `visual.tsx` | AI-шлюз | Субъективность отделена | Ручной |
| 26 | Design Token Manager | нет | — | `design.ts`, `visual.tsx` | — | — | 2 unit-теста |
| 27 | Component Playground | нет | iframe | `visual.tsx` | — | HTML-шаблоны, не React | Ручной |
| 28 | Figma Sync | нет | — | `/api/nexus/figma` | FIGMA_TOKEN | Нет токена в окружении | **BLOCKED** без токена |
| 29 | Animation Studio | нет | — | `design.ts`, `visual.tsx` | — | — | 1 unit-тест экспорта |
| 30 | Accessibility Inspector | нет | — | `a11y.ts` | — | Автоматика ≠ полный аудит | Ручной |
| 31 | AI Terminal Assistant | частично (симуляция shell) | — | `devtools.tsx` | AI-шлюз | Не исполняет по дизайну | Классификатор рисков |
| 32 | Git Timeline | нет | — | `/api/nexus/git` | GitHub API | Rate limit | Ручной |
| 33 | Merge Conflict Resolver | нет | `merge.ts` | `devtools.tsx` | AI-шлюз | — | 3 unit-теста |
| 34 | Preview Deploy | нет | — | `/api/nexus/deploy` | VERCEL_TOKEN | Только статика | Реальный деплой проверен |
| 35 | Environment Manager | нет | — | `/api/nexus/env`, `devtools.tsx` | ключ доступа | Утечки → только boolean | Live-тест API |
| 36 | Database Explorer | нет | `pg` | `/api/nexus/db`, `sql-guard.ts` | DATABASE_URL | Опасный SQL → подтверждение | Live-тест + unit |
| 37 | API Testing Studio | нет | — | `/api/nexus/http`, `ssrf.ts` | — | SSRF → блокировка | Live-тест + unit |
| 38 | Docker Manager | нет | — | `/api/nexus/docker` | сокет Docker | Недоступно на Vercel | **BLOCKED** |
| 39 | Performance Profiler | нет | Performance API | `devtools.tsx` | — | Нет метрик сборки | Ручной |
| 40 | Secrets Scanner | нет | — | `secrets.ts` | — | Ложные срабатывания → allowlist | 5 unit-тестов |
| 41 | Project Time Machine | нет | Dexie | `actions.ts`, `control.tsx` | — | Объём IndexedDB → лимиты | Ручной |
| 42 | AI Cost Observatory | нет | usage из OpenRouter | `cost.ts`, `control.tsx` | — | Free = $0 | 2 unit-теста |
| 43 | Knowledge Graph | нет | граф | `graph.ts` | — | — | 1 unit-тест |
| 44 | AI Task Marketplace | нет | — | `scenarios.ts` | — | Не запускает код | 2 unit-теста |
| 45 | Voice Coding | нет | Web Speech API | `control.tsx` | — | Поддержка браузера | Ручной |
| 46 | Self-Healing Workspace | нет | — | `audit.ts` | env-проверка | — | 1 unit-тест |
| 47 | Live Collaboration | нет | BroadcastChannel | `collab.ts` | — | Нет удалённого relay | Ручной (2 вкладки) |
| 48 | Blueprint Generator | нет | `AiTool` | `agents2.tsx` | AI-шлюз | Галлюцинации | Файлы docs/ в diff |
| 49 | AI Security Auditor | нет | `secrets.ts` | `audit.ts`, `/api/nexus/osv` | OSV.dev | Статический анализ | 1 unit-тест |
| 50 | Mission Control | нет | store | `control.tsx` | status | Один проект | Ручной |

## 3. Итерации

Реализация шла по слоям, а не по 7 итерациям из ТЗ, потому что функции делят общее ядро: сначала чистые библиотеки + тесты (права, секреты, память, роутер, расходы, merge, workflow, SQL/SSRF-гарды, граф, health, поиск, аудит), затем серверные роуты, затем UI-панели по 5 рабочим пространствам. После каждого слоя запускались `tsc`, `eslint`, `vitest`; в конце — production build и live-проверка API.
