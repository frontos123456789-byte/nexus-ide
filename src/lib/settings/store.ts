"use client";

import { create } from "zustand";

/**
 * App-level settings (Nexus AI + developer mode). Persisted in localStorage so the value is available
 * synchronously on the very first client render — no flash of the wrong UI.
 */
export type SearchMode = "auto" | "on" | "off";

export interface SettingsData {
  devMode: boolean;
  searchMode: SearchMode;
  preferredModel: string;
}

const KEY = "nexus-settings-v2";
const DEFAULTS: SettingsData = { devMode: false, searchMode: "auto", preferredModel: "" };

function load(): SettingsData {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const p = JSON.parse(raw) as Partial<SettingsData>;
    return {
      devMode: p.devMode === true,
      searchMode: p.searchMode === "on" || p.searchMode === "off" ? p.searchMode : "auto",
      preferredModel: typeof p.preferredModel === "string" ? p.preferredModel : "",
    };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsState extends SettingsData {
  hydrated: boolean;
  hydrate: () => void;
  set: (patch: Partial<SettingsData>) => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...load(), hydrated: true });
  },
  set: (patch) => {
    set(patch);
    const { devMode, searchMode, preferredModel } = get();
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ devMode, searchMode, preferredModel }));
    } catch {
      /* storage may be unavailable (private mode) — keep in-memory value */
    }
  },
}));
