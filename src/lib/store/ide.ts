import { create } from "zustand";
import {
  copyEntry as dbCopy,
  createFile as dbCreateFile,
  createFolder as dbCreateFolder,
  deleteEntry as dbDelete,
  getKv,
  listEntries,
  renameEntry as dbRename,
  resetWorkspace as dbReset,
  seedIfNeeded,
  setKv,
  writeFile as dbWrite,
} from "@/lib/db/fs";
import { setSoundEnabled as applySound } from "@/lib/utils/sound";
import { ancestors, dirname, isDescendant, normalizePath, uniqueCopyPath } from "@/lib/utils/path";

export type AgentMode = "chat" | "work" | "code";
export type LogLevel = "info" | "warn" | "error" | "success" | "ai";
export type AiState = "idle" | "connecting" | "streaming" | "switching" | "error";
export type BottomTab = "logs" | "terminal";
/** Active full-screen view in the phone layout (desktop shows all panes at once). */
export type MobileTab = "files" | "editor" | "agent" | "terminal";

export interface LogEntry {
  id: number;
  ts: number;
  level: LogLevel;
  source: string;
  message: string;
}

export interface NodeMeta {
  path: string;
  type: "file" | "folder";
}

export interface AiStatus {
  state: AiState;
  model: string | null;
  modelLabel: string | null;
  message: string | null;
  /** null = unknown yet. */
  configured: boolean | null;
}

interface PersistedUi {
  sidebarVisible: boolean;
  agentVisible: boolean;
  bottomVisible: boolean;
  bottomTab: BottomTab;
  soundEnabled: boolean;
  showThoughts: boolean;
  agentMode: AgentMode;
  openTabs: string[];
  activePath: string | null;
  expanded: Record<string, boolean>;
}

export interface IdeState extends PersistedUi {
  ready: boolean;
  firstRun: boolean;
  nodes: Record<string, NodeMeta>;
  contents: Record<string, string>;
  selectedPath: string | null;
  paletteOpen: boolean;
  paletteMode: "all" | "files";
  logs: LogEntry[];
  ai: AiStatus;
  saveState: "saved" | "saving";
  diffView: { runId: string; path: string } | null;
  focusAgentNonce: number;
  mobileTab: MobileTab;

  init: () => Promise<void>;
  openFile: (path: string) => void;
  closeTab: (path: string) => void;
  setActive: (path: string) => void;
  select: (path: string | null) => void;
  toggleFolder: (path: string) => void;
  setExpanded: (path: string, open: boolean) => void;
  collapseAll: () => void;
  createFile: (path: string, content?: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  renameEntry: (from: string, to: string) => Promise<void>;
  deleteEntry: (path: string) => Promise<void>;
  duplicateEntry: (path: string) => Promise<string>;
  updateContent: (path: string, content: string) => void;
  upsertFile: (path: string, content: string, open?: boolean) => Promise<void>;
  flushWrites: () => Promise<void>;
  resetWorkspace: () => Promise<void>;

  setSidebarVisible: (v: boolean) => void;
  setAgentVisible: (v: boolean) => void;
  setBottomVisible: (v: boolean) => void;
  setBottomTab: (t: BottomTab) => void;
  setAgentMode: (m: AgentMode) => void;
  setSoundEnabled: (v: boolean) => void;
  setShowThoughts: (v: boolean) => void;
  openPalette: (mode?: "all" | "files") => void;
  closePalette: () => void;
  setDiffView: (v: { runId: string; path: string } | null) => void;
  focusAgent: () => void;
  setMobileTab: (t: MobileTab) => void;

  log: (level: LogLevel, source: string, message: string) => void;
  clearLogs: () => void;
  setAi: (patch: Partial<AiStatus>) => void;
}

const UI_KEY = "ui-state";
const MAX_LOGS = 500;
const WRITE_DEBOUNCE_MS = 350;

const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
let logSeq = 0;
let initPromise: Promise<void> | null = null;

function nodesFrom(records: { path: string; type: "file" | "folder" }[]): Record<string, NodeMeta> {
  const nodes: Record<string, NodeMeta> = {};
  for (const r of records) nodes[r.path] = { path: r.path, type: r.type };
  return nodes;
}

function remapPath(path: string, mapping: Record<string, string>): string {
  return mapping[path] ?? path;
}

export const useIdeStore = create<IdeState>((set, get) => {
  const persistNow = () => {
    const s = get();
    const ui: PersistedUi = {
      sidebarVisible: s.sidebarVisible,
      agentVisible: s.agentVisible,
      bottomVisible: s.bottomVisible,
      bottomTab: s.bottomTab,
      soundEnabled: s.soundEnabled,
      showThoughts: s.showThoughts,
      agentMode: s.agentMode,
      openTabs: s.openTabs,
      activePath: s.activePath,
      expanded: s.expanded,
    };
    void setKv(UI_KEY, ui).catch(() => undefined);
  };

  const performWrite = async (path: string) => {
    writeTimers.delete(path);
    const content = get().contents[path];
    if (content === undefined || get().nodes[path]?.type !== "file") return;
    try {
      await dbWrite(path, content);
    } catch (err) {
      get().log("error", "fs", `Не удалось сохранить ${path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (writeTimers.size === 0) set({ saveState: "saved" });
  };

  const scheduleWrite = (path: string) => {
    const prev = writeTimers.get(path);
    if (prev) clearTimeout(prev);
    writeTimers.set(path, setTimeout(() => void performWrite(path), WRITE_DEBOUNCE_MS));
    set({ saveState: "saving" });
  };

  const addNodes = (path: string, type: "file" | "folder") => {
    const nodes = { ...get().nodes };
    for (const a of ancestors(path)) if (!nodes[a]) nodes[a] = { path: a, type: "folder" };
    nodes[path] = { path, type };
    return nodes;
  };

  const expandAncestors = (path: string) => {
    const expanded = { ...get().expanded };
    for (const a of ancestors(path)) expanded[a] = true;
    return expanded;
  };

  return {
    ready: false,
    firstRun: false,
    nodes: {},
    contents: {},
    openTabs: [],
    activePath: null,
    selectedPath: null,
    expanded: {},
    sidebarVisible: true,
    agentVisible: true,
    bottomVisible: true,
    bottomTab: "logs",
    paletteOpen: false,
    paletteMode: "all",
    soundEnabled: false,
    showThoughts: true,
    agentMode: "chat",
    logs: [],
    ai: { state: "idle", model: null, modelLabel: null, message: null, configured: null },
    saveState: "saved",
    diffView: null,
    focusAgentNonce: 0,
    mobileTab: "editor",

    init: () => {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        try {
          const seeded = await seedIfNeeded();
          const records = await listEntries();
          const nodes = nodesFrom(records);
          const contents: Record<string, string> = {};
          for (const r of records) if (r.type === "file") contents[r.path] = r.content;
          const saved = await getKv<Partial<PersistedUi>>(UI_KEY);
          const openTabs = (saved?.openTabs ?? []).filter((p) => nodes[p]?.type === "file");
          const activePath =
            saved?.activePath && openTabs.includes(saved.activePath) ? saved.activePath : (openTabs[0] ?? null);
          const firstOnboarding = (await getKv<boolean>("onboarded")) !== true;
          set({
            nodes,
            contents,
            openTabs: seeded && openTabs.length === 0 ? ["README.md"] : openTabs,
            activePath: seeded && openTabs.length === 0 ? "README.md" : activePath,
            selectedPath: activePath,
            expanded: saved?.expanded ?? { src: true },
            sidebarVisible: saved?.sidebarVisible ?? true,
            agentVisible: saved?.agentVisible ?? true,
            bottomVisible: saved?.bottomVisible ?? true,
            bottomTab: saved?.bottomTab ?? "logs",
            soundEnabled: saved?.soundEnabled ?? false,
            showThoughts: saved?.showThoughts ?? true,
            agentMode: saved?.agentMode ?? "chat",
            firstRun: seeded || firstOnboarding,
            ready: true,
          });
          applySound(get().soundEnabled);
          get().log("success", "system", `Рабочее пространство загружено: ${Object.keys(contents).length} файлов из IndexedDB`);
          if (seeded) get().log("info", "system", "Первый запуск — создан демо-проект nexus-demo");

          if (typeof window !== "undefined") {
            let timer: ReturnType<typeof setTimeout> | null = null;
            useIdeStore.subscribe((s, prev) => {
              const changed =
                s.sidebarVisible !== prev.sidebarVisible ||
                s.agentVisible !== prev.agentVisible ||
                s.bottomVisible !== prev.bottomVisible ||
                s.bottomTab !== prev.bottomTab ||
                s.soundEnabled !== prev.soundEnabled ||
                s.showThoughts !== prev.showThoughts ||
                s.agentMode !== prev.agentMode ||
                s.openTabs !== prev.openTabs ||
                s.activePath !== prev.activePath ||
                s.expanded !== prev.expanded;
              if (!changed) return;
              if (timer) clearTimeout(timer);
              timer = setTimeout(persistNow, 300);
            });
            const flush = () => void get().flushWrites();
            window.addEventListener("beforeunload", flush);
            document.addEventListener("visibilitychange", () => {
              if (document.visibilityState === "hidden") flush();
            });
          }
        } catch (err) {
          initPromise = null;
          const message = err instanceof Error ? err.message : String(err);
          get().log("error", "system", `Не удалось открыть IndexedDB: ${message}. Работа в режиме памяти.`);
          set({ ready: true });
        }
      })();
      return initPromise;
    },

    openFile: (path) => {
      const node = get().nodes[path];
      if (!node || node.type !== "file") return;
      const openTabs = get().openTabs.includes(path) ? get().openTabs : [...get().openTabs, path];
      set({ openTabs, activePath: path, selectedPath: path, diffView: null, expanded: expandAncestors(path) });
    },

    closeTab: (path) => {
      const { openTabs, activePath } = get();
      const idx = openTabs.indexOf(path);
      if (idx === -1) return;
      const next = openTabs.filter((p) => p !== path);
      let nextActive = activePath;
      if (activePath === path) nextActive = next[Math.min(idx, next.length - 1)] ?? null;
      set({ openTabs: next, activePath: nextActive });
    },

    setActive: (path) => set({ activePath: path, selectedPath: path, diffView: null }),
    select: (path) => set({ selectedPath: path }),

    toggleFolder: (path) => set({ expanded: { ...get().expanded, [path]: !get().expanded[path] } }),
    setExpanded: (path, open) => set({ expanded: { ...get().expanded, [path]: open } }),
    collapseAll: () => set({ expanded: {} }),

    createFile: async (rawPath, content = "") => {
      const path = normalizePath(rawPath);
      await dbCreateFile(path, content);
      set({
        nodes: addNodes(path, "file"),
        contents: { ...get().contents, [path]: content },
        expanded: expandAncestors(path),
      });
      get().log("info", "fs", `Создан файл ${path}`);
      get().openFile(path);
    },

    createFolder: async (rawPath) => {
      const path = normalizePath(rawPath);
      await dbCreateFolder(path);
      set({ nodes: addNodes(path, "folder"), expanded: { ...expandAncestors(path), [path]: true } });
      get().log("info", "fs", `Создана папка ${path}`);
    },

    renameEntry: async (from, to) => {
      await get().flushWrites();
      const mapping = await dbRename(from, to);
      const nodes: Record<string, NodeMeta> = {};
      for (const n of Object.values(get().nodes)) {
        const p = remapPath(n.path, mapping);
        nodes[p] = { path: p, type: n.type };
      }
      for (const a of ancestors(normalizePath(to))) if (!nodes[a]) nodes[a] = { path: a, type: "folder" };
      const contents: Record<string, string> = {};
      for (const [p, c] of Object.entries(get().contents)) contents[remapPath(p, mapping)] = c;
      const expanded: Record<string, boolean> = {};
      for (const [p, v] of Object.entries(get().expanded)) expanded[remapPath(p, mapping)] = v;
      const s = get();
      set({
        nodes,
        contents,
        expanded,
        openTabs: s.openTabs.map((p) => remapPath(p, mapping)),
        activePath: s.activePath ? remapPath(s.activePath, mapping) : null,
        selectedPath: s.selectedPath ? remapPath(s.selectedPath, mapping) : null,
      });
      get().log("info", "fs", `Переименовано ${from} → ${to}`);
    },

    deleteEntry: async (rawPath) => {
      const path = normalizePath(rawPath);
      for (const [p, t] of writeTimers) {
        if (p === path || isDescendant(path, p)) {
          clearTimeout(t);
          writeTimers.delete(p);
        }
      }
      const removed = new Set(await dbDelete(path));
      const nodes = { ...get().nodes };
      const contents = { ...get().contents };
      for (const p of removed) {
        delete nodes[p];
        delete contents[p];
      }
      const s = get();
      const openTabs = s.openTabs.filter((p) => !removed.has(p));
      let activePath = s.activePath;
      if (activePath && removed.has(activePath)) activePath = openTabs[openTabs.length - 1] ?? null;
      set({
        nodes,
        contents,
        openTabs,
        activePath,
        selectedPath: s.selectedPath && removed.has(s.selectedPath) ? null : s.selectedPath,
        saveState: writeTimers.size === 0 ? "saved" : s.saveState,
      });
      get().log("warn", "fs", `Удалено: ${path}${removed.size > 1 ? ` (${removed.size} элементов)` : ""}`);
    },

    duplicateEntry: async (path) => {
      await get().flushWrites();
      const target = uniqueCopyPath(path, (p) => !!get().nodes[p]);
      const copies = await dbCopy(path, target);
      const nodes = { ...get().nodes };
      const contents = { ...get().contents };
      for (const c of copies) {
        nodes[c.path] = { path: c.path, type: c.type };
        if (c.type === "file") contents[c.path] = c.content;
      }
      set({ nodes, contents });
      get().log("info", "fs", `Дубликат ${path} → ${target}`);
      return target;
    },

    updateContent: (path, content) => {
      if (get().contents[path] === content) return;
      set({ contents: { ...get().contents, [path]: content } });
      scheduleWrite(path);
    },

    upsertFile: async (rawPath, content, open = true) => {
      const path = normalizePath(rawPath);
      const exists = get().nodes[path]?.type === "file";
      if (!exists) {
        await dbCreateFile(path, content);
        set({ nodes: addNodes(path, "file"), contents: { ...get().contents, [path]: content } });
      } else {
        set({ contents: { ...get().contents, [path]: content } });
        const t = writeTimers.get(path);
        if (t) clearTimeout(t);
        await dbWrite(path, content);
      }
      set({ expanded: expandAncestors(path) });
      if (open) get().openFile(path);
    },

    flushWrites: async () => {
      const paths = Array.from(writeTimers.keys());
      for (const p of paths) {
        const t = writeTimers.get(p);
        if (t) clearTimeout(t);
      }
      await Promise.all(paths.map((p) => performWrite(p)));
      set({ saveState: "saved" });
    },

    resetWorkspace: async () => {
      for (const t of writeTimers.values()) clearTimeout(t);
      writeTimers.clear();
      await dbReset();
      const records = await listEntries();
      const contents: Record<string, string> = {};
      for (const r of records) if (r.type === "file") contents[r.path] = r.content;
      set({
        nodes: nodesFrom(records),
        contents,
        openTabs: ["README.md"],
        activePath: "README.md",
        selectedPath: "README.md",
        expanded: { src: true },
        diffView: null,
        saveState: "saved",
      });
      get().log("warn", "system", "Рабочее пространство сброшено до демо-проекта");
    },

    // The visibility setters also steer the phone layout: "show X" == "go to the X tab".
    setSidebarVisible: (v) => set(v ? { sidebarVisible: true, mobileTab: "files" } : { sidebarVisible: false }),
    setAgentVisible: (v) => set(v ? { agentVisible: true, mobileTab: "agent" } : { agentVisible: false }),
    setBottomVisible: (v) => set(v ? { bottomVisible: true, mobileTab: "terminal" } : { bottomVisible: false }),
    setBottomTab: (t) => set({ bottomTab: t, bottomVisible: true, mobileTab: "terminal" }),
    setMobileTab: (t) => set({ mobileTab: t }),
    setAgentMode: (m) => set({ agentMode: m }),
    setSoundEnabled: (v) => {
      applySound(v);
      set({ soundEnabled: v });
    },
    setShowThoughts: (v) => set({ showThoughts: v }),
    openPalette: (mode = "all") => set({ paletteOpen: true, paletteMode: mode }),
    closePalette: () => set({ paletteOpen: false }),
    setDiffView: (v) => set(v ? { diffView: v, mobileTab: "editor" } : { diffView: null }),
    focusAgent: () => set({ agentVisible: true, mobileTab: "agent", focusAgentNonce: get().focusAgentNonce + 1 }),

    log: (level, source, message) => {
      const entry: LogEntry = { id: ++logSeq, ts: Date.now(), level, source, message };
      const logs = get().logs;
      set({ logs: logs.length >= MAX_LOGS ? [...logs.slice(logs.length - MAX_LOGS + 1), entry] : [...logs, entry] });
    },
    clearLogs: () => set({ logs: [] }),
    setAi: (patch) => set({ ai: { ...get().ai, ...patch } }),
  };
});

export { dirname };
