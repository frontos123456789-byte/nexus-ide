"use client";

import { create } from "zustand";
import { getKv, setKv } from "@/lib/db/fs";
import { DEFAULT_BUDGET, DEFAULT_RATES, type ReferenceRates } from "./cost";
import { DEFAULT_POLICY, normalizePolicy } from "./permissions";
import type { ModelInfo, RouterPrefs } from "./router";
import type { Workflow } from "./workflow";
import type { Scenario } from "./scenarios";
import type { AgentDef, AgentTask, Budget, Capability, MemoryItem, PolicyMap, ReplayEvent, SnapshotMeta, UsageEvent } from "./types";

export type WorkspaceId = "agents" | "intelligence" | "visual" | "devtools" | "control";

export interface NexusData {
  policy: PolicyMap;
  agents: AgentDef[];
  tasks: AgentTask[];
  memory: MemoryItem[];
  usage: UsageEvent[];
  budget: Budget;
  rates: ReferenceRates;
  router: RouterPrefs;
  snapshots: SnapshotMeta[];
  autoSnapshot: boolean;
  replay: ReplayEvent[];
  secretAllow: string[];
  workflows: Workflow[];
  customScenarios: Scenario[];
  installedScenarios: string[];
  predictive: boolean;
  adminKey: string;
  project: string;
}

export interface ServerStatus {
  features: { ai: boolean; adminKeyConfigured: boolean; database: boolean; github: boolean; vercel: boolean; figma: boolean; docker: boolean };
  production: boolean;
  models: ModelInfo[];
  providerMetadata: boolean;
}

export interface PendingPermission {
  id: string;
  capability: Capability;
  detail: string;
  agent?: string;
  resolve: (ok: boolean) => void;
}

export const DEFAULT_DATA: NexusData = {
  policy: DEFAULT_POLICY,
  agents: [],
  tasks: [],
  memory: [],
  usage: [],
  budget: DEFAULT_BUDGET,
  rates: DEFAULT_RATES,
  router: { disabled: [] },
  snapshots: [],
  autoSnapshot: true,
  replay: [],
  secretAllow: [],
  workflows: [],
  customScenarios: [],
  installedScenarios: [],
  predictive: false,
  adminKey: "",
  project: "nexus-demo",
};

export interface NexusState {
  data: NexusData;
  hydrated: boolean;
  open: boolean;
  workspace: WorkspaceId;
  tool: string | null;
  server: ServerStatus | null;
  pending: PendingPermission[];
  hydrate: () => Promise<void>;
  patch: (p: Partial<NexusData>) => void;
  update: <K extends keyof NexusData>(key: K, fn: (v: NexusData[K]) => NexusData[K]) => void;
  setOpen: (open: boolean) => void;
  openTool: (workspace: WorkspaceId, tool: string | null) => void;
  setServer: (s: ServerStatus | null) => void;
  enqueuePermission: (p: PendingPermission) => void;
  resolvePermission: (id: string, ok: boolean) => void;
}

const KEY = "nexus-data";
let timer: ReturnType<typeof setTimeout> | null = null;

function persist(data: NexusData) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void setKv(KEY, data).catch(() => undefined), 400);
}

export const useNexus = create<NexusState>((set, get) => ({
  data: DEFAULT_DATA,
  hydrated: false,
  open: false,
  workspace: "agents",
  tool: null,
  server: null,
  pending: [],
  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const saved = await getKv<Partial<NexusData>>(KEY);
      const data: NexusData = { ...DEFAULT_DATA, ...saved, policy: normalizePolicy(saved?.policy) };
      // Tasks interrupted by a page reload cannot continue — mark them honestly.
      data.tasks = data.tasks.map((t) => (t.status === "running" || t.status === "queued" ? { ...t, status: "cancelled", error: "Прервано перезагрузкой страницы" } : t));
      set({ data, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  patch: (p) => {
    const data = { ...get().data, ...p };
    set({ data });
    persist(data);
  },
  update: (key, fn) => {
    const data = { ...get().data, [key]: fn(get().data[key]) };
    set({ data });
    persist(data);
  },
  setOpen: (open) => set({ open }),
  openTool: (workspace, tool) => set({ open: true, workspace, tool }),
  setServer: (server) => set({ server }),
  enqueuePermission: (p) => set({ pending: [...get().pending, p] }),
  resolvePermission: (id, ok) => {
    const p = get().pending.find((x) => x.id === id);
    set({ pending: get().pending.filter((x) => x.id !== id) });
    p?.resolve(ok);
  },
}));
