"use client";

import { deleteEntry, listEntries, writeFile } from "@/lib/db/fs";
import { getDb, type ActivityRecord, type ProjectRecord, type StudioKind } from "@/lib/db/schema";

const uid = (): string => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface GeneratedFile {
  path: string;
  content: string;
}

export function slugify(name: string): string {
  const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya" };
  const s = name
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "project";
}

export function safeRelPath(p: string): string | null {
  const parts = p.replace(/\\/g, "/").split("/").filter((x) => x && x !== ".");
  if (parts.length === 0 || parts.some((x) => x === "..") || p.startsWith("/")) return null;
  return parts.join("/");
}

export async function logActivity(a: Omit<ActivityRecord, "id" | "ts">): Promise<void> {
  try {
    await getDb().activity.put({ ...a, id: uid(), ts: Date.now() });
  } catch {
    /* journal is best-effort */
  }
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return (await getDb().projects.toArray()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function createProject(input: { name: string; kind: StudioKind; stack: string; description: string; files: GeneratedFile[] }): Promise<ProjectRecord> {
  const db = getDb();
  const entries = new Set((await listEntries()).map((e) => e.path));
  const base = slugify(input.name);
  let slug = base;
  for (let i = 2; entries.has(`projects/${slug}`); i++) slug = `${base}-${i}`;
  const folder = `projects/${slug}`;
  for (const f of input.files) {
    const rel = safeRelPath(f.path);
    if (rel) await writeFile(`${folder}/${rel}`, f.content);
  }
  const now = Date.now();
  const rec: ProjectRecord = { id: uid(), name: input.name, kind: input.kind, folder, stack: input.stack, description: input.description, createdAt: now, updatedAt: now };
  await db.projects.put(rec);
  await logActivity({ agent: "Nexus Studio", project: rec.id, kind: "file", title: `Создан проект «${rec.name}»`, detail: `${input.files.length} файл(ов) в ${folder}` });
  return rec;
}

export async function projectFiles(folder: string): Promise<{ path: string; rel: string; content: string }[]> {
  const prefix = `${folder}/`;
  return (await listEntries())
    .filter((e) => e.type === "file" && e.path.startsWith(prefix))
    .map((e) => ({ path: e.path, rel: e.path.slice(prefix.length), content: e.content }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

export async function saveProjectFile(project: ProjectRecord, rel: string, content: string): Promise<void> {
  const safe = safeRelPath(rel);
  if (!safe) throw new Error("Недопустимый путь");
  await writeFile(`${project.folder}/${safe}`, content);
  await getDb().projects.update(project.id, { updatedAt: Date.now() });
  await logActivity({ agent: "Nexus Studio", project: project.id, kind: "file", title: `Изменён файл ${safe}`, detail: project.name });
}

export async function updateProject(id: string, patch: Partial<ProjectRecord>): Promise<void> {
  await getDb().projects.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteProject(p: ProjectRecord): Promise<void> {
  await deleteEntry(p.folder).catch(() => undefined);
  await getDb().projects.delete(p.id);
  await logActivity({ agent: "Nexus Studio", kind: "info", title: `Проект «${p.name}» удалён` });
}

/** Opens a project file in the Monaco IDE (/code/ide). */
export function ideUrl(path?: string): string {
  return path ? `/code/ide?open=${encodeURIComponent(path)}` : "/code/ide";
}
