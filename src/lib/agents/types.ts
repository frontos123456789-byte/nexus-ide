import type { FailureKind } from "@/lib/openrouter/types";

export type AgentRole = "director" | "architect" | "coder" | "reviewer";
export type WorkerRole = Exclude<AgentRole, "director">;
export type AgentStatus = "queued" | "running" | "done" | "error" | "skipped";

export interface SubTask {
  id: string;
  agent: WorkerRole;
  title: string;
  instruction: string;
  dependsOn: string[];
  files: string[];
}

export interface DirectorPlan {
  summary: string;
  tasks: SubTask[];
}

export interface FileProposal {
  path: string;
  content: string;
  action: "create" | "modify";
}

export interface ReviewIssue {
  severity: "info" | "warning" | "error";
  file?: string;
  message: string;
}

export interface ReviewResult {
  verdict: "approve" | "changes" | "unknown";
  summary: string;
  issues: ReviewIssue[];
}

export interface RunStats {
  agents: number;
  failed: number;
  files: number;
}

/** Events streamed from POST /api/agents. */
export type AgentEvent =
  | { type: "plan"; plan: DirectorPlan; fallback: boolean }
  | {
      type: "agent";
      id: string;
      role: AgentRole;
      title: string;
      status: AgentStatus;
      dependsOn?: string[];
      model?: string;
      modelLabel?: string;
      error?: string;
    }
  | { type: "agent_delta"; id: string; content: string }
  | { type: "agent_reset"; id: string }
  | { type: "agent_switch"; id: string; message: string }
  | { type: "proposal"; id: string; files: FileProposal[] }
  | { type: "review"; id: string; review: ReviewResult }
  | { type: "summary_delta"; content: string; reset?: boolean }
  | { type: "summary"; content: string }
  | { type: "done"; durationMs: number; stats: RunStats }
  | { type: "error"; message: string; kind?: FailureKind | "exhausted" };
