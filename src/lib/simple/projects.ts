"use client";

import { getDb, type DeckRecord, type ProjectRecord } from "@/lib/db/schema";
import type { Deck } from "@/lib/studio/deck";
import { createProject, deleteProject, listProjects, projectFiles, updateProject } from "@/lib/studio/projects";

/** What the user sees. Internally everything still lives in the same IndexedDB tables as before. */
export type SimpleKind = "site" | "bot" | "presentation" | "app" | "other";

export const KIND_LABEL: Record<SimpleKind, string> = {
  site: "Сайт",
  bot: "Telegram-бот",
  presentation: "Презентация",
  app: "Дизайн приложения",
  other: "Проект",
};

export const APP_STACK = "Дизайн приложения";

export interface UnifiedProject {
  /** URL-safe key: project id, or `deck_<id>` for presentations. */
  key: string;
  kind: SimpleKind;
  name: string;
  description: string;
  updatedAt: number;
  createdAt: number;
  project?: ProjectRecord;
  deck?: DeckRecord;
}

export function kindOf(p: ProjectRecord): SimpleKind {
  if (p.kind === "website") return "site";
  if (p.kind === "telegram") return "bot";
  if (p.kind === "presentation") return "presentation";
  if (p.stack === APP_STACK) return "app";
  return "other";
}

const fromProject = (p: ProjectRecord): UnifiedProject => ({ key: p.id, kind: kindOf(p), name: p.name, description: p.description, updatedAt: p.updatedAt, createdAt: p.createdAt, project: p });
const fromDeck = (d: DeckRecord): UnifiedProject => {
  const data = d.data as Deck | undefined;
  return { key: `deck_${d.id}`, kind: "presentation", name: d.title, description: `${data?.slides?.length ?? 0} слайдов`, updatedAt: d.updatedAt, createdAt: d.createdAt, deck: d };
};

export async function listUnified(): Promise<UnifiedProject[]> {
  const [projects, decks] = await Promise.all([listProjects(), getDb().decks.toArray()]);
  return [...projects.map(fromProject), ...decks.map(fromDeck)].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getUnified(key: string): Promise<UnifiedProject | null> {
  if (key.startsWith("deck_")) {
    const d = await getDb().decks.get(key.slice(5));
    return d ? fromDeck(d) : null;
  }
  const p = await getDb().projects.get(key);
  return p ? fromProject(p) : null;
}

export async function renameUnified(u: UnifiedProject, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  if (u.deck) {
    const data = u.deck.data as Deck;
    await getDb().decks.put({ ...u.deck, title: clean, data: { ...data, title: clean }, updatedAt: Date.now() });
  } else if (u.project) {
    await updateProject(u.project.id, { name: clean });
  }
}

export async function duplicateUnified(u: UnifiedProject): Promise<string> {
  const name = `Копия — ${u.name}`.slice(0, 80);
  if (u.deck) {
    const data = u.deck.data as Deck;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
    const now = Date.now();
    await getDb().decks.put({ id, title: name, data: { ...data, id, title: name }, createdAt: now, updatedAt: now });
    return `deck_${id}`;
  }
  const p = u.project as ProjectRecord;
  const files = (await projectFiles(p.folder)).map((f) => ({ path: f.rel, content: f.content }));
  const copy = await createProject({ name, kind: p.kind, stack: p.stack, description: p.description, files });
  return copy.id;
}

export async function deleteUnified(u: UnifiedProject): Promise<void> {
  if (u.deck) await getDb().decks.delete(u.deck.id);
  else if (u.project) await deleteProject(u.project);
}

export async function saveDeck(deck: Deck): Promise<void> {
  const db = getDb();
  const now = Date.now();
  const prev = await db.decks.get(deck.id);
  await db.decks.put({ id: deck.id, title: deck.title, data: deck, createdAt: prev?.createdAt ?? now, updatedAt: now });
}

/* ------------------------------ small per-project notes (bot status etc.) ------------------------------ */

export async function getMeta<T>(id: string): Promise<T | undefined> {
  const r = await getDb().kv.get(`simple-meta:${id}`);
  return r?.value as T | undefined;
}

export async function setMeta(id: string, value: unknown): Promise<void> {
  await getDb().kv.put({ key: `simple-meta:${id}`, value });
}

/* ------------------------------ unfinished work (drafts, saved in the browser) ------------------------------ */

export interface Draft {
  kind: SimpleKind;
  step: number;
  data: Record<string, unknown>;
  updatedAt: number;
}

const draftKey = (kind: SimpleKind) => `nexus-draft-${kind}`;

export function loadDraft(kind: SimpleKind): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(kind));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && typeof d.step === "number" ? d : null;
  } catch {
    return null;
  }
}

export function saveDraft(kind: SimpleKind, step: number, data: Record<string, unknown>): void {
  try {
    window.localStorage.setItem(draftKey(kind), JSON.stringify({ kind, step, data, updatedAt: Date.now() } satisfies Draft));
  } catch {
    /* best effort */
  }
}

export function clearDraft(kind: SimpleKind): void {
  try {
    window.localStorage.removeItem(draftKey(kind));
  } catch {
    /* best effort */
  }
}

export function allDrafts(): Draft[] {
  return (["site", "bot", "presentation", "app"] as SimpleKind[]).map(loadDraft).filter((d): d is Draft => d !== null && Object.values(d.data).some((v) => typeof v === "string" && v.trim().length > 0));
}

/* ------------------------------ friendly errors ------------------------------ */

/** Turns technical failures into a calm sentence that says what to do next. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  const m = msg.toLowerCase();
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network request failed")) return "Нет связи с интернетом. Проверьте подключение и нажмите «Попробовать ещё раз».";
  if (m.includes("не задан") || m.includes("api_key") || m.includes("503")) return "ИИ сейчас не подключён на сервере. Администратору нужно добавить ключ OpenRouter. Пока можно выбрать готовый шаблон.";
  if (m.includes("дневной лимит") || m.includes("исчерпан")) return "Бесплатный дневной лимит ИИ на сегодня закончился — он обновится завтра. Сейчас можно выбрать готовый шаблон, а потом изменить текст самостоятельно.";
  if (m.includes("429") || m.includes("лимит") || m.includes("rate") || m.includes("занят")) return "Бесплатные ИИ-модели сейчас перегружены. Подождите минуту и нажмите «Попробовать ещё раз».";
  if (m.includes("timeout") || m.includes("abort") || m.includes("504")) return "Ответ идёт слишком долго. Нажмите «Попробовать ещё раз» — можно описать задачу чуть короче.";
  if (m.includes("ии не вернул") || m.includes("неразборчив")) return "ИИ ответил не так, как нужно. Нажмите «Попробовать ещё раз» — обычно со второго раза получается.";
  return msg && msg.length < 220 ? msg : "Что-то пошло не так. Нажмите «Попробовать ещё раз». Ваш текст сохранён.";
}
