import type { NexusDB, FileRecord } from "./schema";
import { getDb } from "./schema";
import { SEED_FILES } from "./seed";
import { ancestors, dirname, isDescendant, normalizePath } from "@/lib/utils/path";

/* ----------------------------- key/value store ---------------------------- */

export async function getKv<T>(key: string, db: NexusDB = getDb()): Promise<T | undefined> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : undefined;
}

export async function setKv(key: string, value: unknown, db: NexusDB = getDb()): Promise<void> {
  await db.kv.put({ key, value });
}

/* ------------------------------ file system ------------------------------- */

export async function listEntries(db: NexusDB = getDb()): Promise<FileRecord[]> {
  return db.files.toArray();
}

async function ensureFolders(path: string, db: NexusDB): Promise<void> {
  const now = Date.now();
  for (const folder of ancestors(path)) {
    const existing = await db.files.get(folder);
    if (!existing) {
      await db.files.put({ path: folder, type: "folder", content: "", createdAt: now, updatedAt: now });
    } else if (existing.type === "file") {
      throw new Error(`"${folder}" является файлом, а не папкой`);
    }
  }
}

export async function writeFile(rawPath: string, content: string, db: NexusDB = getDb()): Promise<FileRecord> {
  const path = normalizePath(rawPath);
  if (!path) throw new Error("Пустой путь");
  const existing = await db.files.get(path);
  if (existing?.type === "folder") throw new Error(`"${path}" — это папка`);
  await ensureFolders(path, db);
  const now = Date.now();
  const record: FileRecord = {
    path,
    type: "file",
    content,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.files.put(record);
  return record;
}

export async function createFile(rawPath: string, content = "", db: NexusDB = getDb()): Promise<FileRecord> {
  const path = normalizePath(rawPath);
  if (await db.files.get(path)) throw new Error(`"${path}" уже существует`);
  return writeFile(path, content, db);
}

export async function createFolder(rawPath: string, db: NexusDB = getDb()): Promise<FileRecord> {
  const path = normalizePath(rawPath);
  if (!path) throw new Error("Пустой путь");
  if (await db.files.get(path)) throw new Error(`"${path}" уже существует`);
  await ensureFolders(path, db);
  const now = Date.now();
  const record: FileRecord = { path, type: "folder", content: "", createdAt: now, updatedAt: now };
  await db.files.put(record);
  return record;
}

async function collectSubtree(path: string, db: NexusDB): Promise<FileRecord[]> {
  const root = await db.files.get(path);
  if (!root) return [];
  const children = await db.files
    .where("path")
    .startsWith(path + "/")
    .toArray();
  return [root, ...children.filter((c) => isDescendant(path, c.path))];
}

/** Deletes an entry and everything under it. Returns the removed paths. */
export async function deleteEntry(rawPath: string, db: NexusDB = getDb()): Promise<string[]> {
  const path = normalizePath(rawPath);
  const subtree = await collectSubtree(path, db);
  await db.files.bulkDelete(subtree.map((r) => r.path));
  return subtree.map((r) => r.path);
}

/** Moves/renames an entry (and its subtree). Returns a map of old -> new paths. */
export async function renameEntry(
  rawFrom: string,
  rawTo: string,
  db: NexusDB = getDb(),
): Promise<Record<string, string>> {
  const from = normalizePath(rawFrom);
  const to = normalizePath(rawTo);
  if (!from || !to) throw new Error("Пустой путь");
  if (from === to) return {};
  if (isDescendant(from, to)) throw new Error("Нельзя переместить папку внутрь самой себя");
  if (await db.files.get(to)) throw new Error(`"${to}" уже существует`);
  const subtree = await collectSubtree(from, db);
  if (subtree.length === 0) throw new Error(`"${from}" не найден`);
  await ensureFolders(to, db);
  const now = Date.now();
  const mapping: Record<string, string> = {};
  const moved = subtree.map((r) => {
    const newPath = to + r.path.slice(from.length);
    mapping[r.path] = newPath;
    return { ...r, path: newPath, updatedAt: now };
  });
  await db.transaction("rw", db.files, async () => {
    await db.files.bulkDelete(subtree.map((r) => r.path));
    await db.files.bulkPut(moved);
  });
  return mapping;
}

/** Copies an entry (and subtree). Returns the created records. */
export async function copyEntry(rawFrom: string, rawTo: string, db: NexusDB = getDb()): Promise<FileRecord[]> {
  const from = normalizePath(rawFrom);
  const to = normalizePath(rawTo);
  if (await db.files.get(to)) throw new Error(`"${to}" уже существует`);
  const subtree = await collectSubtree(from, db);
  if (subtree.length === 0) throw new Error(`"${from}" не найден`);
  await ensureFolders(to, db);
  const now = Date.now();
  const copies = subtree.map((r) => ({ ...r, path: to + r.path.slice(from.length), createdAt: now, updatedAt: now }));
  await db.files.bulkPut(copies);
  return copies;
}

/* -------------------------------- seeding --------------------------------- */

function seedRecords(): FileRecord[] {
  const now = Date.now();
  const folders = new Set<string>();
  for (const f of SEED_FILES) for (const a of ancestors(f.path)) folders.add(a);
  const records: FileRecord[] = [];
  for (const folder of folders) {
    records.push({ path: folder, type: "folder", content: "", createdAt: now, updatedAt: now });
  }
  for (const f of SEED_FILES) {
    records.push({ path: f.path, type: "file", content: f.content, createdAt: now, updatedAt: now });
  }
  return records;
}

/** Seeds the demo project on first launch only. Returns true if it seeded. */
export async function seedIfNeeded(db: NexusDB = getDb()): Promise<boolean> {
  const seeded = await getKv<boolean>("seeded", db);
  if (seeded) return false;
  const count = await db.files.count();
  if (count === 0) await db.files.bulkPut(seedRecords());
  await setKv("seeded", true, db);
  return count === 0;
}

/** Wipes the workspace and restores the demo project. */
export async function resetWorkspace(db: NexusDB = getDb()): Promise<void> {
  await db.transaction("rw", db.files, db.kv, async () => {
    await db.files.clear();
    await db.files.bulkPut(seedRecords());
    await db.kv.put({ key: "seeded", value: true });
  });
}

export { dirname };
