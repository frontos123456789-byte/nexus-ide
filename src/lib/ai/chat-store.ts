"use client";

import { create } from "zustand";
import { getDb, type ConversationRecord, type StoredMessage, type ToolLogEntry, type WorkRecord } from "@/lib/db/schema";
import { HttpError, postEventStream, createBatcher } from "@/lib/utils/sse-client";
import { useSettings } from "@/lib/settings/store";
import type { AiEvent } from "./events";

export type AiMode = "chat" | "work";
export interface Attachment {
  name: string;
  size: number;
  text: string;
}

const uid = (): string => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const MAX_ATTACH_CHARS = 60_000;

interface ChatsState {
  ready: boolean;
  conversations: ConversationRecord[];
  activeId: string | null;
  messages: StoredMessage[];
  mode: AiMode;
  busy: boolean;
  init: () => Promise<void>;
  select: (id: string | null) => Promise<void>;
  newChat: () => void;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setMode: (m: AiMode) => void;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  stop: () => void;
}

let controller: AbortController | null = null;

function embed(m: StoredMessage): string {
  return m.attachmentText ? `${m.content}\n\n${m.attachmentText}` : m.content;
}

export function formatAttachments(files: Attachment[]): string {
  return files
    .map((f) => `<attachment name="${f.name.replace(/"/g, "'")}">\n${f.text.slice(0, MAX_ATTACH_CHARS).replace(/<\/attachment>/gi, "")}\n</attachment>`)
    .join("\n");
}

export const useChats = create<ChatsState>((set, get) => {
  const db = () => getDb();

  const persistMessage = (m: StoredMessage) => void db().messages.put(m).catch(() => undefined);
  const touch = async (id: string, patch: Partial<ConversationRecord> = {}) => {
    const now = Date.now();
    await db().conversations.update(id, { updatedAt: now, ...patch }).catch(() => undefined);
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === id ? { ...c, updatedAt: now, ...patch } : c)).sort(sortConv) }));
  };

  const patchMsg = (id: string, fn: (m: StoredMessage) => StoredMessage) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));

  async function run(conversationId: string, assistantId: string, history: StoredMessage[]): Promise<void> {
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    set({ busy: true });
    const { searchMode, preferredModel } = useSettings.getState();
    const mode = get().mode;
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    let content = "";
    const tools: ToolLogEntry[] = [];
    let work: WorkRecord | undefined = mode === "work" ? { summary: "", phase: "planning", steps: [] } : undefined;
    const batcher = createBatcher((chunk) => {
      content += chunk;
      patchMsg(assistantId, (m) => ({ ...m, content }));
    }, 60);

    const body =
      mode === "work"
        ? { goal: lastUser?.content ?? "", attachments: lastUser?.attachmentText, searchMode, preferredModel: preferredModel || undefined }
        : { messages: history.slice(-30).map((m) => ({ role: m.role, content: embed(m) })), searchMode, preferredModel: preferredModel || undefined };

    let finalStatus: StoredMessage["status"] = "done";
    let error: string | undefined;
    try {
      for await (const ev of postEventStream<AiEvent>(mode === "work" ? "/api/ai/work" : "/api/ai/chat", body, ac.signal)) {
        switch (ev.type) {
          case "delta":
            batcher.push(ev.content);
            break;
          case "reset":
            batcher.discard();
            content = "";
            patchMsg(assistantId, (m) => ({ ...m, content: "" }));
            break;
          case "attempt":
            patchMsg(assistantId, (m) => ({ ...m, modelLabel: ev.label }));
            break;
          case "switch":
            patchMsg(assistantId, (m) => ({ ...m, modelLabel: ev.toLabel, notices: [...(m.notices ?? []), ev.message] }));
            break;
          case "tool": {
            const i = tools.findIndex((t) => t.id === ev.id);
            const entry: ToolLogEntry = { id: ev.id, name: ev.name, status: ev.status, input: ev.input, summary: ev.summary };
            if (i >= 0) tools[i] = entry;
            else tools.push(entry);
            patchMsg(assistantId, (m) => ({ ...m, tools: [...tools] }));
            break;
          }
          case "sources":
            patchMsg(assistantId, (m) => ({ ...m, sources: ev.sources }));
            break;
          case "notice":
            patchMsg(assistantId, (m) => ({ ...m, notices: [...(m.notices ?? []), ev.message] }));
            break;
          case "plan":
            work = { summary: ev.summary, phase: "running", steps: ev.steps.map((s) => ({ ...s, tool: s.tool, status: "todo" as const })) };
            patchMsg(assistantId, (m) => ({ ...m, work }));
            break;
          case "phase":
            if (work) {
              work = { ...work, phase: ev.phase };
              patchMsg(assistantId, (m) => ({ ...m, work }));
            }
            break;
          case "step":
            if (work) {
              work = { ...work, steps: work.steps.map((s) => (s.id === ev.id ? { ...s, status: ev.status, output: ev.output ?? s.output, error: ev.error } : s)) };
              patchMsg(assistantId, (m) => ({ ...m, work }));
            }
            break;
          case "done":
            patchMsg(assistantId, (m) => ({ ...m, modelLabel: ev.label }));
            break;
          case "error":
            finalStatus = "error";
            error = ev.message;
            break;
          default:
            break;
        }
      }
    } catch (e) {
      if (ac.signal.aborted) finalStatus = "stopped";
      else {
        finalStatus = "error";
        error = e instanceof HttpError || e instanceof Error ? e.message : "Ошибка соединения";
      }
    } finally {
      batcher.flush();
      if (controller === ac) controller = null;
    }
    if (ac.signal.aborted) finalStatus = "stopped";
    if (work && finalStatus === "done") work = { ...work, phase: "done" };
    if (work && finalStatus === "error") work = { ...work, phase: "error" };
    patchMsg(assistantId, (m) => ({ ...m, content, status: finalStatus, error, work }));
    const final = get().messages.find((m) => m.id === assistantId);
    if (final) persistMessage(final);
    await touch(conversationId);
    set({ busy: false });
  }

  async function startTurn(text: string, attachments: Attachment[] = []): Promise<void> {
    let id = get().activeId;
    const now = Date.now();
    if (!id) {
      id = uid();
      const conv: ConversationRecord = { id, title: text.trim().slice(0, 60) || "Новый чат", mode: get().mode, pinned: 0, createdAt: now, updatedAt: now };
      await db().conversations.put(conv);
      set((s) => ({ conversations: [conv, ...s.conversations].sort(sortConv), activeId: id, messages: [] }));
    }
    const conversationId = id as string;
    const userMsg: StoredMessage = {
      id: uid(),
      conversationId,
      role: "user",
      content: text,
      status: "done",
      attachments: attachments.map((a) => ({ name: a.name, size: a.size })),
      attachmentText: attachments.length ? formatAttachments(attachments) : undefined,
      createdAt: now,
    };
    const asst: StoredMessage = { id: uid(), conversationId, role: "assistant", content: "", status: "streaming", createdAt: now + 1 };
    set((s) => ({ messages: [...s.messages, userMsg, asst] }));
    persistMessage(userMsg);
    persistMessage(asst);
    await run(conversationId, asst.id, [...get().messages.filter((m) => m.id !== asst.id)]);
  }

  return {
    ready: false,
    conversations: [],
    activeId: null,
    messages: [],
    mode: "chat",
    busy: false,

    init: async () => {
      if (get().ready) return;
      // Messages that were streaming when the tab closed can never finish — mark them as interrupted.
      const stale = await db().messages.filter((m) => m.status === "streaming").toArray().catch(() => [] as StoredMessage[]);
      for (const m of stale) await db().messages.put({ ...m, status: "stopped" });
      const conversations = (await db().conversations.toArray()).sort(sortConv);
      set({ conversations, ready: true });
      const last = conversations[0];
      if (last) await get().select(last.id);
    },

    select: async (id) => {
      if (get().busy) get().stop();
      if (!id) return set({ activeId: null, messages: [] });
      const messages = (await db().messages.where("conversationId").equals(id).toArray()).sort((a, b) => a.createdAt - b.createdAt);
      set({ activeId: id, messages });
    },

    newChat: () => {
      if (get().busy) get().stop();
      set({ activeId: null, messages: [] });
    },

    rename: async (id, title) => {
      const t = title.trim().slice(0, 80);
      if (t) await touch(id, { title: t });
    },

    remove: async (id) => {
      if (get().activeId === id && get().busy) get().stop();
      await db().transaction("rw", db().conversations, db().messages, async () => {
        await db().messages.where("conversationId").equals(id).delete();
        await db().conversations.delete(id);
      });
      set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), ...(s.activeId === id ? { activeId: null, messages: [] } : {}) }));
    },

    togglePin: async (id) => {
      const c = get().conversations.find((x) => x.id === id);
      if (c) await touch(id, { pinned: c.pinned ? 0 : 1 });
    },

    setMode: (mode) => set({ mode }),

    send: async (text, attachments) => {
      if (get().busy || (!text.trim() && !attachments?.length)) return;
      await startTurn(text.trim() || "Проанализируй приложенные файлы.", attachments);
    },

    editAndResend: async (messageId, text) => {
      const { messages, activeId } = get();
      if (get().busy || !activeId) return;
      const idx = messages.findIndex((m) => m.id === messageId);
      const target = messages[idx];
      if (!target || target.role !== "user" || !text.trim()) return;
      const dropped = messages.slice(idx + 1).map((m) => m.id);
      await db().messages.bulkDelete(dropped);
      const edited: StoredMessage = { ...target, content: text.trim() };
      await db().messages.put(edited);
      const asst: StoredMessage = { id: uid(), conversationId: activeId, role: "assistant", content: "", status: "streaming", createdAt: Date.now() };
      set({ messages: [...messages.slice(0, idx), edited, asst] });
      persistMessage(asst);
      await run(activeId, asst.id, [...messages.slice(0, idx), edited]);
    },

    regenerate: async () => {
      const { messages, activeId } = get();
      if (get().busy || !activeId) return;
      const last = messages[messages.length - 1];
      if (!last || last.role !== "assistant") return;
      await db().messages.delete(last.id);
      const history = messages.slice(0, -1);
      const asst: StoredMessage = { id: uid(), conversationId: activeId, role: "assistant", content: "", status: "streaming", createdAt: Date.now() };
      set({ messages: [...history, asst] });
      persistMessage(asst);
      await run(activeId, asst.id, history);
    },

    stop: () => {
      controller?.abort();
    },
  };
});

function sortConv(a: ConversationRecord, b: ConversationRecord): number {
  return b.pinned - a.pinned || b.updatedAt - a.updatedAt;
}

export function searchConversations(list: ConversationRecord[], q: string): ConversationRecord[] {
  const s = q.trim().toLowerCase();
  return s ? list.filter((c) => c.title.toLowerCase().includes(s)) : list;
}
