import type { Capability, Policy, PolicyMap } from "./types";

export const CAPABILITIES: { id: Capability; label: string; dangerous: boolean; hint: string }[] = [
  { id: "read", label: "Чтение файлов", dangerous: false, hint: "Агент видит содержимое файлов проекта" },
  { id: "write", label: "Изменение файлов", dangerous: false, hint: "Создание и правка файлов" },
  { id: "delete", label: "Удаление файлов", dangerous: true, hint: "Необратимо без снапшота" },
  { id: "terminal", label: "Терминал", dangerous: true, hint: "Выполнение команд" },
  { id: "network", label: "Сетевые запросы", dangerous: false, hint: "Внешние HTTP-запросы" },
  { id: "install", label: "Установка пакетов", dangerous: true, hint: "npm install и т.п." },
  { id: "secrets", label: "Доступ к секретам", dangerous: true, hint: "Чтение переменных окружения" },
  { id: "git", label: "Git-операции", dangerous: false, hint: "Коммиты, ветки, пуш" },
  { id: "deploy", label: "Деплой", dangerous: true, hint: "Публикация preview/production" },
];

export const DEFAULT_POLICY: PolicyMap = {
  read: "allow",
  write: "ask",
  delete: "ask",
  terminal: "deny",
  network: "ask",
  install: "ask",
  secrets: "deny",
  git: "ask",
  deploy: "ask",
};

export function isDangerous(cap: Capability): boolean {
  return CAPABILITIES.find((c) => c.id === cap)?.dangerous ?? true;
}

const RANK: Record<Policy, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Effective policy = the strictest of global and per-agent policy.
 * Dangerous capabilities can never resolve to "allow": they always need a confirmation.
 */
export function resolvePolicy(cap: Capability, global: PolicyMap, agent?: Partial<PolicyMap>): Policy {
  const g = global[cap] ?? DEFAULT_POLICY[cap];
  const a = agent?.[cap];
  let eff: Policy = a && RANK[a] > RANK[g] ? a : g;
  if (eff === "allow" && isDangerous(cap)) eff = "ask";
  return eff;
}

export function normalizePolicy(raw: unknown): PolicyMap {
  const out = { ...DEFAULT_POLICY };
  if (raw && typeof raw === "object") {
    for (const c of CAPABILITIES) {
      const v = (raw as Record<string, unknown>)[c.id];
      if (v === "allow" || v === "ask" || v === "deny") out[c.id] = v;
    }
  }
  return out;
}
