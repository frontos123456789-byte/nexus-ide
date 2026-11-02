"use client";

import type { ComponentType } from "react";
import type { WorkspaceId } from "@/lib/nexus/store";
import { ArchitectPanel, BlueprintPanel, BugHunterPanel, DebatePanel, WorkflowPanel } from "./panels/agents2";
import { CommanderPanel, MemoryPanel, PermissionsPanel, ReplayPanel, RouterPanel, SwarmPanel } from "./panels/agents";
import { DepMapPanel, ErrorFixPanel, ExplainPanel, HealthPanel, NLCommandPanel, PredictivePanel, RefactorPanel, SearchPanel, TestGenPanel } from "./panels/intelligence";
import { A11yPanel, AnimationPanel, CriticPanel, FigmaPanel, PlaygroundPanel, ResponsivePanel, ScreenshotPanel, TokensPanel, VisualDiffPanel, VisualEditorPanel } from "./panels/visual";
import { ApiStudioPanel, DatabasePanel, DeployPanel, DockerPanel, EnvPanel, GitTimelinePanel, HealPanel, MergePanel, ProfilerPanel, SecretsPanel, TerminalAssistantPanel } from "./panels/devtools";
import { CollabPanel, CostPanel, KnowledgePanel, MarketplacePanel, MissionPanel, SecurityPanel, TimeMachinePanel, VoicePanel } from "./panels/control";

export interface ToolDef {
  id: string;
  n: number;
  title: string;
  desc: string;
  workspace: WorkspaceId;
  /** Shown immediately; the rest sit behind "Показать все". */
  primary?: boolean;
  Panel: ComponentType;
}

export const WORKSPACES: { id: WorkspaceId; title: string; desc: string }[] = [
  { id: "agents", title: "AI Agents", desc: "Агенты, рой, память, права" },
  { id: "intelligence", title: "Code Intelligence", desc: "Поиск, рефакторинг, качество" },
  { id: "visual", title: "Visual Studio", desc: "Preview, доступность, токены" },
  { id: "devtools", title: "DevTools", desc: "Git, БД, API, секреты" },
  { id: "control", title: "Nexus Control", desc: "Снапшоты, расходы, безопасность" },
];

export const TOOLS: ToolDef[] = [
  { id: "commander", n: 1, title: "Agent Commander", desc: "Агенты, задачи, статусы, логи, параллельный запуск", workspace: "agents", primary: true, Panel: CommanderPanel },
  { id: "workflow", n: 2, title: "Visual Workflow", desc: "Drag-and-drop редактор процессов агентов", workspace: "agents", primary: true, Panel: WorkflowPanel },
  { id: "swarm", n: 3, title: "AI Swarm", desc: "Параллельные агенты в изолированных копиях + слияние", workspace: "agents", Panel: SwarmPanel },
  { id: "memory", n: 4, title: "Agent Memory", desc: "Долговременная память проекта", workspace: "agents", primary: true, Panel: MemoryPanel },
  { id: "debate", n: 5, title: "AI Debate", desc: "Архитектор, критик и судья обсуждают решение", workspace: "agents", Panel: DebatePanel },
  { id: "router", n: 6, title: "Smart Model Router", desc: "Выбор модели по задаче, контексту и цене", workspace: "agents", Panel: RouterPanel },
  { id: "replay", n: 7, title: "Agent Replay", desc: "История действий агентов без секретов", workspace: "agents", Panel: ReplayPanel },
  { id: "bughunter", n: 8, title: "Bug Hunter", desc: "Ошибка → причина → тест → исправление", workspace: "agents", Panel: BugHunterPanel },
  { id: "architect", n: 9, title: "AI Project Architect", desc: "Архитектура, API-контракты, документация", workspace: "agents", Panel: ArchitectPanel },
  { id: "permissions", n: 10, title: "Agent Permissions", desc: "Права агентов и подтверждение опасного", workspace: "agents", primary: true, Panel: PermissionsPanel },
  { id: "blueprint", n: 48, title: "Blueprint Generator", desc: "Проект из технического задания", workspace: "agents", Panel: BlueprintPanel },

  { id: "search", n: 12, title: "Semantic Code Search", desc: "Поиск по смыслу с живым индексом", workspace: "intelligence", primary: true, Panel: SearchPanel },
  { id: "nl", n: 19, title: "Natural Language Commands", desc: "Команды обычными словами: план и diff", workspace: "intelligence", primary: true, Panel: NLCommandPanel },
  { id: "health", n: 20, title: "Code Health Score", desc: "Оценка качества с формулой", workspace: "intelligence", primary: true, Panel: HealthPanel },
  { id: "depmap", n: 17, title: "Dependency Map", desc: "Интерактивный граф импортов", workspace: "intelligence", primary: true, Panel: DepMapPanel },
  { id: "predictive", n: 11, title: "Predictive Editing", desc: "Многострочные подсказки в редакторе", workspace: "intelligence", Panel: PredictivePanel },
  { id: "refactor", n: 13, title: "Refactoring Studio", desc: "Rename, извлечение, дедупликация", workspace: "intelligence", Panel: RefactorPanel },
  { id: "explain", n: 14, title: "Code Explanation Lens", desc: "Объяснение кода с зависимостями", workspace: "intelligence", Panel: ExplainPanel },
  { id: "errorfix", n: 15, title: "Smart Error Fix", desc: "Исправление ошибок диагностики", workspace: "intelligence", Panel: ErrorFixPanel },
  { id: "tests", n: 18, title: "Instant Test Generator", desc: "Генерация тестов под ваш фреймворк", workspace: "intelligence", Panel: TestGenPanel },

  { id: "responsive", n: 22, title: "Responsive Matrix", desc: "Preview на нескольких размерах", workspace: "visual", primary: true, Panel: ResponsivePanel },
  { id: "veditor", n: 21, title: "Visual Component Editor", desc: "Правка элементов в preview → в код", workspace: "visual", primary: true, Panel: VisualEditorPanel },
  { id: "a11y", n: 30, title: "Accessibility Inspector", desc: "Контраст, ARIA, фокус, семантика", workspace: "visual", primary: true, Panel: A11yPanel },
  { id: "tokens", n: 26, title: "Design Token Manager", desc: "Цвета, шрифты, интервалы, темы", workspace: "visual", primary: true, Panel: TokensPanel },
  { id: "critic", n: 25, title: "AI UI Critic", desc: "Объективные ошибки и рекомендации", workspace: "visual", Panel: CriticPanel },
  { id: "screenshot", n: 23, title: "Screenshot to Component", desc: "Компонент по картинке", workspace: "visual", Panel: ScreenshotPanel },
  { id: "vdiff", n: 24, title: "Visual Diff", desc: "Сравнение скриншотов", workspace: "visual", Panel: VisualDiffPanel },
  { id: "playground", n: 27, title: "Component Playground", desc: "Props и состояния HTML-шаблонов", workspace: "visual", Panel: PlaygroundPanel },
  { id: "animation", n: 29, title: "Animation Studio", desc: "Таймлайн, keyframes, экспорт", workspace: "visual", Panel: AnimationPanel },
  { id: "figma", n: 28, title: "Figma Sync", desc: "Компоненты и токены из Figma", workspace: "visual", Panel: FigmaPanel },

  { id: "secrets", n: 40, title: "Secrets Scanner", desc: "Поиск ключей в коде", workspace: "devtools", primary: true, Panel: SecretsPanel },
  { id: "heal", n: 46, title: "Self-Healing Workspace", desc: "Диагностика и исправление окружения", workspace: "devtools", primary: true, Panel: HealPanel },
  { id: "api", n: 37, title: "API Testing Studio", desc: "Запросы, коллекции, окружения", workspace: "devtools", primary: true, Panel: ApiStudioPanel },
  { id: "db", n: 36, title: "Database Explorer", desc: "Схема, SQL, защита от опасных запросов", workspace: "devtools", primary: true, Panel: DatabasePanel },
  { id: "terminal", n: 31, title: "AI Terminal Assistant", desc: "Текст → команда с оценкой риска", workspace: "devtools", Panel: TerminalAssistantPanel },
  { id: "git", n: 32, title: "Git Timeline", desc: "История коммитов и действий агентов", workspace: "devtools", Panel: GitTimelinePanel },
  { id: "merge", n: 33, title: "Merge Conflict Resolver", desc: "Разрешение конфликтов", workspace: "devtools", Panel: MergePanel },
  { id: "deploy", n: 34, title: "Preview Deploy", desc: "Preview-деплой на Vercel", workspace: "devtools", Panel: DeployPanel },
  { id: "env", n: 35, title: "Environment Manager", desc: "dev/staging/production без утечек", workspace: "devtools", Panel: EnvPanel },
  { id: "docker", n: 38, title: "Docker Workspace", desc: "Контейнеры, логи, запуск/остановка", workspace: "devtools", Panel: DockerPanel },
  { id: "profiler", n: 39, title: "Performance Profiler", desc: "Метрики загрузки, памяти, сети", workspace: "devtools", Panel: ProfilerPanel },

  { id: "mission", n: 50, title: "Nexus Mission Control", desc: "Общая панель состояния", workspace: "control", primary: true, Panel: MissionPanel },
  { id: "timemachine", n: 41, title: "Project Time Machine", desc: "Снапшоты, сравнение, откат", workspace: "control", primary: true, Panel: TimeMachinePanel },
  { id: "cost", n: 42, title: "AI Cost Observatory", desc: "Токены, бюджеты, предупреждения", workspace: "control", primary: true, Panel: CostPanel },
  { id: "security", n: 49, title: "AI Security Auditor", desc: "Уязвимости, инъекции, секреты", workspace: "control", primary: true, Panel: SecurityPanel },
  { id: "knowledge", n: 43, title: "Knowledge Graph", desc: "Карта файлов, документов, решений", workspace: "control", Panel: KnowledgePanel },
  { id: "marketplace", n: 44, title: "AI Task Marketplace", desc: "Библиотека сценариев", workspace: "control", Panel: MarketplacePanel },
  { id: "voice", n: 45, title: "Voice Coding", desc: "Голосовые команды с подтверждением", workspace: "control", Panel: VoicePanel },
  { id: "collab", n: 47, title: "Live Collaboration", desc: "Комнаты и CRDT между вкладками", workspace: "control", Panel: CollabPanel },
];
