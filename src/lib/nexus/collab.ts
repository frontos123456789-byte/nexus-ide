"use client";

import { useIdeStore } from "@/lib/store/ide";
import { uid } from "./types";

export type Role = "host" | "editor" | "viewer";

export interface Peer {
  id: string;
  name: string;
  role: Role;
  color: string;
  path: string | null;
  line: number | null;
  seen: number;
}

export interface RoomComment {
  id: string;
  path: string;
  line: number;
  text: string;
  author: string;
  ts: number;
}

type Msg =
  | { t: "presence"; peer: Omit<Peer, "seen"> }
  | { t: "update"; peer: string; path: string; content: string | null; clock: number }
  | { t: "comment"; comment: RoomComment }
  | { t: "bye"; peer: string }
  | { t: "sync-request"; peer: string };

const COLORS = ["#f472b6", "#38bdf8", "#34d399", "#fbbf24", "#a78bfa", "#fb923c"];

/**
 * Collaboration over BroadcastChannel (same browser, multiple tabs/windows).
 * Sync algorithm: one LWW-register per file ordered by (Lamport clock, peer id) — a state-based CRDT that converges
 * without coordination. Viewers cannot publish; updates from viewers are ignored by receivers.
 * Cross-device collaboration needs a WebSocket/WebRTC relay, which this serverless deployment does not provide.
 */
export class Room {
  readonly peerId = uid("peer");
  readonly peers = new Map<string, Peer>();
  comments: RoomComment[] = [];
  private ch: BroadcastChannel;
  private clock = 0;
  private versions = new Map<string, { clock: number; peer: string }>();
  private applying = new Set<string>();
  private timer: ReturnType<typeof setInterval>;
  private unsub: () => void;
  private lastSent = new Map<string, string>();
  me: Omit<Peer, "seen">;
  onChange: () => void = () => undefined;

  constructor(readonly code: string, name: string, role: Role) {
    this.me = { id: this.peerId, name, role, color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? "#38bdf8", path: null, line: null };
    this.ch = new BroadcastChannel(`nexus-room-${code}`);
    this.ch.onmessage = (e: MessageEvent<Msg>) => void this.receive(e.data);
    const initial = useIdeStore.getState().contents;
    for (const [p, c] of Object.entries(initial)) this.lastSent.set(p, c);
    this.unsub = useIdeStore.subscribe((s, prev) => {
      if (s.activePath !== prev.activePath) this.heartbeat();
      if (s.contents === prev.contents) return;
      for (const [p, c] of Object.entries(s.contents)) if (prev.contents[p] !== c) this.local(p, c);
    });
    this.timer = setInterval(() => this.heartbeat(), 3000);
    this.heartbeat();
    this.ch.postMessage({ t: "sync-request", peer: this.peerId } satisfies Msg);
  }

  private post(m: Msg) {
    try {
      this.ch.postMessage(m);
    } catch {
      /* channel closed */
    }
  }

  heartbeat(line?: number) {
    this.me.path = useIdeStore.getState().activePath;
    if (line !== undefined) this.me.line = line;
    this.post({ t: "presence", peer: this.me });
    const now = Date.now();
    for (const [id, p] of this.peers) if (now - p.seen > 9000) this.peers.delete(id);
    this.onChange();
  }

  private local(path: string, content: string) {
    if (this.me.role === "viewer" || this.applying.has(path) || this.lastSent.get(path) === content) return;
    this.lastSent.set(path, content);
    this.clock++;
    this.versions.set(path, { clock: this.clock, peer: this.peerId });
    this.post({ t: "update", peer: this.peerId, path, content, clock: this.clock });
  }

  private async receive(m: Msg) {
    if (m.t === "presence") {
      if (m.peer.id !== this.peerId) this.peers.set(m.peer.id, { ...m.peer, seen: Date.now() });
    } else if (m.t === "bye") this.peers.delete(m.peer);
    else if (m.t === "comment") {
      if (!this.comments.some((c) => c.id === m.comment.id)) this.comments = [...this.comments, m.comment];
    } else if (m.t === "sync-request") {
      this.heartbeat();
      for (const [path, v] of this.versions) {
        const content = useIdeStore.getState().contents[path];
        if (content !== undefined && v.peer === this.peerId) this.post({ t: "update", peer: this.peerId, path, content, clock: v.clock });
      }
    } else if (m.t === "update") {
      const sender = this.peers.get(m.peer);
      if (sender?.role === "viewer") return; // access control: viewers are read-only
      this.clock = Math.max(this.clock, m.clock);
      const cur = this.versions.get(m.path);
      if (cur && (cur.clock > m.clock || (cur.clock === m.clock && cur.peer >= m.peer))) return;
      this.versions.set(m.path, { clock: m.clock, peer: m.peer });
      if (m.content === null) return;
      this.applying.add(m.path);
      this.lastSent.set(m.path, m.content);
      try {
        const ide = useIdeStore.getState();
        if (ide.contents[m.path] !== m.content) await ide.upsertFile(m.path, m.content, false);
      } finally {
        this.applying.delete(m.path);
      }
    }
    this.onChange();
  }

  addComment(path: string, line: number, text: string) {
    const c: RoomComment = { id: uid("cm"), path, line, text, author: this.me.name, ts: Date.now() };
    this.comments = [...this.comments, c];
    this.post({ t: "comment", comment: c });
    this.onChange();
  }

  close() {
    this.post({ t: "bye", peer: this.peerId });
    clearInterval(this.timer);
    this.unsub();
    this.ch.close();
  }
}
