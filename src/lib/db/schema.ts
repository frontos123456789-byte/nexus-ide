import Dexie, { type Table } from "dexie";

export interface FileRecord {
  /** Primary key: normalized path without leading slash. */
  path: string;
  type: "file" | "folder";
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface KvRecord {
  key: string;
  value: unknown;
}

/* ---------- v2 (Nexus AI + Code Studio) ---------- */

export interface ChatSource {
  n: number;
  title: string;
  url: string;
  date?: string;
  provider?: string;
}

export interface ToolLogEntry {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  input: string;
  summary?: string;
}

export interface StoredMessage {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  modelLabel?: string;
  sources?: ChatSource[];
  tools?: ToolLogEntry[];
  /** Work mode: plan/step journal. */
  work?: WorkRecord;
  attachments?: { name: string; size: number }[];
  /** Text of attached files (sent to the model with the message, not shown in the bubble). */
  attachmentText?: string;
  notices?: string[];
  createdAt: number;
}

export interface WorkStepRecord {
  id: string;
  title: string;
  tool: string;
  input: string;
  status: "todo" | "running" | "done" | "error";
  output?: string;
  error?: string;
}

export interface WorkRecord {
  summary: string;
  phase: "planning" | "running" | "writing" | "done" | "error";
  steps: WorkStepRecord[];
}

export interface ConversationRecord {
  id: string;
  title: string;
  mode: "chat" | "work";
  pinned: 0 | 1;
  createdAt: number;
  updatedAt: number;
}

export type StudioKind = "telegram" | "website" | "presentation" | "other";

export interface ProjectRecord {
  id: string;
  name: string;
  kind: StudioKind;
  /** Folder inside the IDE file system (`projects/<slug>`), so the Monaco IDE can open it as-is. */
  folder: string;
  stack: string;
  description: string;
  githubRepo?: string;
  vercelProject?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DeckRecord {
  id: string;
  title: string;
  data: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface ActivityRecord {
  id: string;
  ts: number;
  agent: string;
  project?: string;
  kind: "task" | "file" | "commit" | "deploy" | "error" | "confirm" | "info";
  title: string;
  detail?: string;
}

export class NexusDB extends Dexie {
  files!: Table<FileRecord, string>;
  kv!: Table<KvRecord, string>;
  conversations!: Table<ConversationRecord, string>;
  messages!: Table<StoredMessage, string>;
  projects!: Table<ProjectRecord, string>;
  decks!: Table<DeckRecord, string>;
  activity!: Table<ActivityRecord, string>;

  constructor(name = "nexus-ide") {
    super(name);
    // v1 is kept verbatim: existing users keep their files and kv records untouched.
    this.version(1).stores({
      files: "path, type, updatedAt",
      kv: "key",
    });
    // v2 only ADDS tables — Dexie upgrades in place, nothing is deleted or rewritten.
    this.version(2).stores({
      files: "path, type, updatedAt",
      kv: "key",
      conversations: "id, updatedAt, pinned",
      messages: "id, conversationId, createdAt",
      projects: "id, kind, updatedAt",
      decks: "id, updatedAt",
      activity: "id, ts, project",
    });
  }
}

let instance: NexusDB | null = null;

/** Lazily creates the browser database (never touched during SSR). */
export function getDb(): NexusDB {
  if (!instance) instance = new NexusDB();
  return instance;
}
