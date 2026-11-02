/** Shared types for the Nexus Features layer (all state lives in the existing Dexie `kv` table). */

export type Capability = "read" | "write" | "delete" | "terminal" | "network" | "install" | "secrets" | "git" | "deploy";
export type Policy = "allow" | "ask" | "deny";
export type PolicyMap = Record<Capability, Policy>;

export type TaskType = "code" | "reasoning" | "chat" | "summarize" | "json" | "vision";

/** A proposed change to one file. `before`/`after` null = file did not exist / will be removed. */
export interface Change {
  path: string;
  before: string | null;
  after: string | null;
}

export interface MemoryItem {
  id: string;
  kind: "architecture" | "convention" | "preference" | "task" | "doc";
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UsageEvent {
  id: string;
  ts: number;
  feature: string;
  agent?: string;
  project: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** true when the provider did not report usage and tokens were estimated from text length. */
  estimated: boolean;
}

export interface Budget {
  dailyTokens: number;
  dailyRequests: number;
  /** Reference spend limit in USD computed from the user-configured reference rates. */
  monthlyUsd: number;
}

export interface SnapshotMeta {
  id: string;
  ts: number;
  label: string;
  kind: "auto" | "manual" | "safety";
  files: number;
  bytes: number;
}

export interface ReplayEvent {
  id: string;
  runId: string;
  ts: number;
  type: "start" | "tool" | "ai" | "file" | "command" | "error" | "checkpoint" | "end" | "permission";
  title: string;
  detail?: string;
  agent?: string;
}

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  instructions: string;
  model: string;
  policy: Partial<PolicyMap>;
  createdAt: number;
}

export type TaskStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface AgentTask {
  id: string;
  agentId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  progress: number;
  logs: { ts: number; level: "info" | "error" | "success"; text: string }[];
  result?: string;
  changes?: Change[];
  error?: string;
  model?: string;
  swarmId?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export function uid(prefix = "n"): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
