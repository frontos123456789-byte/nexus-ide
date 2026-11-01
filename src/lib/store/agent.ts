import { create } from "zustand";
import { getKv, setKv } from "@/lib/db/fs";
import type { AgentRole, AgentStatus, FileProposal, ReviewResult, RunStats } from "@/lib/agents/types";
import type { StepSize } from "@/lib/agents/work";
import type { AgentMode } from "./ide";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning: string;
  model?: string;
  modelLabel?: string;
  status: "streaming" | "done" | "error";
  error?: string;
  notices: string[];
  createdAt: number;
}

export interface WorkStep {
  id: string;
  title: string;
  detail: string;
  size: StepSize;
  status: "todo" | "running" | "done" | "error";
  result: string;
  error?: string;
}

export interface WorkSession {
  id: string;
  goal: string;
  createdAt: number;
  raw: string;
  reasoning: string;
  planGoal: string;
  steps: WorkStep[];
  phase: "planning" | "ready" | "error";
  error?: string;
  model?: string;
  modelLabel?: string;
  notices: string[];
}

export interface AgentView {
  id: string;
  role: AgentRole;
  title: string;
  status: AgentStatus;
  dependsOn: string[];
  model?: string;
  modelLabel?: string;
  output: string;
  notices: string[];
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface ProposalView extends FileProposal {
  id: string;
  agentId: string;
  /** File content when the proposal arrived (null = file did not exist). */
  original: string | null;
  status: "pending" | "applied" | "rejected";
}

export interface CodeRun {
  id: string;
  task: string;
  createdAt: number;
  status: "running" | "done" | "error" | "cancelled";
  planSummary: string;
  planFallback: boolean;
  agents: Record<string, AgentView>;
  order: string[];
  proposals: ProposalView[];
  reviews: { agentId: string; review: ReviewResult }[];
  summary: string;
  summaryStreaming: boolean;
  error?: string;
  durationMs?: number;
  stats?: RunStats;
}

interface PersistedAgent {
  messages: UiMessage[];
  sessions: WorkSession[];
  activeSessionId: string | null;
  runs: CodeRun[];
  includeContext: boolean;
}

export interface AgentState {
  hydrated: boolean;
  messages: UiMessage[];
  sessions: WorkSession[];
  activeSessionId: string | null;
  runs: CodeRun[];
  includeContext: boolean;
  busy: Record<AgentMode, boolean>;

  hydrate: () => Promise<void>;
  setBusy: (mode: AgentMode, busy: boolean) => void;
  setIncludeContext: (v: boolean) => void;

  addMessage: (m: UiMessage) => void;
  patchMessage: (id: string, fn: (m: UiMessage) => UiMessage) => void;
  clearChat: () => void;

  addSession: (s: WorkSession) => void;
  patchSession: (id: string, fn: (s: WorkSession) => WorkSession) => void;
  setActiveSession: (id: string | null) => void;
  deleteSession: (id: string) => void;

  addRun: (r: CodeRun) => void;
  patchRun: (id: string, fn: (r: CodeRun) => CodeRun) => void;
  clearRuns: () => void;
}

const KEY = "agent-state";
let hydratePromise: Promise<void> | null = null;

/** Anything that was mid-flight when the page closed can never finish. */
function settleInterrupted(p: PersistedAgent): PersistedAgent {
  return {
    ...p,
    messages: p.messages.map((m) =>
      m.status === "streaming"
        ? { ...m, status: "error" as const, error: "Ответ прерван перезагрузкой страницы" }
        : m,
    ),
    sessions: p.sessions.map((s) => ({
      ...s,
      phase: s.phase === "planning" ? ("error" as const) : s.phase,
      error: s.phase === "planning" ? "Планирование прервано перезагрузкой страницы" : s.error,
      steps: s.steps.map((st) =>
        st.status === "running" ? { ...st, status: "error" as const, error: "Прервано перезагрузкой" } : st,
      ),
    })),
    runs: p.runs.map((r) =>
      r.status === "running"
        ? {
            ...r,
            status: "cancelled" as const,
            summaryStreaming: false,
            agents: Object.fromEntries(
              Object.entries(r.agents).map(([id, a]) => [
                id,
                a.status === "running" || a.status === "queued"
                  ? { ...a, status: "error" as const, error: "Прервано перезагрузкой" }
                  : a,
              ]),
            ),
          }
        : r,
    ),
  };
}

export const useAgentStore = create<AgentState>((set, get) => ({
  hydrated: false,
  messages: [],
  sessions: [],
  activeSessionId: null,
  runs: [],
  includeContext: true,
  busy: { chat: false, work: false, code: false },

  hydrate: () => {
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      try {
        const saved = await getKv<PersistedAgent>(KEY);
        if (saved) {
          const s = settleInterrupted(saved);
          set({
            messages: s.messages ?? [],
            sessions: s.sessions ?? [],
            activeSessionId: s.activeSessionId ?? null,
            runs: s.runs ?? [],
            includeContext: s.includeContext ?? true,
          });
        }
      } catch {
        /* storage unavailable: start empty */
      }
      set({ hydrated: true });
      if (typeof window !== "undefined") {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const save = () => {
          const s = get();
          const payload: PersistedAgent = {
            messages: s.messages.slice(-80),
            sessions: s.sessions.slice(-15),
            activeSessionId: s.activeSessionId,
            runs: s.runs.slice(-8),
            includeContext: s.includeContext,
          };
          void setKv(KEY, payload).catch(() => undefined);
        };
        useAgentStore.subscribe((st, prev) => {
          if (
            st.messages === prev.messages &&
            st.sessions === prev.sessions &&
            st.runs === prev.runs &&
            st.activeSessionId === prev.activeSessionId &&
            st.includeContext === prev.includeContext
          )
            return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(save, 700);
        });
      }
    })();
    return hydratePromise;
  },

  setBusy: (mode, busy) => set({ busy: { ...get().busy, [mode]: busy } }),
  setIncludeContext: (v) => set({ includeContext: v }),

  addMessage: (m) => set({ messages: [...get().messages, m] }),
  patchMessage: (id, fn) => set({ messages: get().messages.map((m) => (m.id === id ? fn(m) : m)) }),
  clearChat: () => set({ messages: [] }),

  addSession: (s) => set({ sessions: [...get().sessions, s], activeSessionId: s.id }),
  patchSession: (id, fn) => set({ sessions: get().sessions.map((s) => (s.id === id ? fn(s) : s)) }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    set({
      sessions,
      activeSessionId: get().activeSessionId === id ? (sessions[sessions.length - 1]?.id ?? null) : get().activeSessionId,
    });
  },

  addRun: (r) => set({ runs: [...get().runs, r] }),
  patchRun: (id, fn) => set({ runs: get().runs.map((r) => (r.id === id ? fn(r) : r)) }),
  clearRuns: () => set({ runs: [] }),
}));
