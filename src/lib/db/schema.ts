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

export class NexusDB extends Dexie {
  files!: Table<FileRecord, string>;
  kv!: Table<KvRecord, string>;

  constructor(name = "nexus-ide") {
    super(name);
    this.version(1).stores({
      files: "path, type, updatedAt",
      kv: "key",
    });
  }
}

let instance: NexusDB | null = null;

/** Lazily creates the browser database (never touched during SSR). */
export function getDb(): NexusDB {
  if (!instance) instance = new NexusDB();
  return instance;
}
