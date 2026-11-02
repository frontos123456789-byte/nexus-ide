"use client";

import { create } from "zustand";

/**
 * App-level settings (Nexus AI + developer mode + readability). Persisted in localStorage so the value is
 * available synchronously on the very first client render — no flash of the wrong UI.
 */
export type SearchMode = "auto" | "on" | "off";
export type TextScale = 100 | 115 | 130 | 150;

export interface SettingsData {
  devMode: boolean;
  searchMode: SearchMode;
  preferredModel: string;
  /** Page text size in percent (accessibility). */
  textScale: TextScale;
  /** The short first-run greeting was dismissed. */
  welcomeDone: boolean;
}

const KEY = "nexus-settings-v2";
const DEFAULTS: SettingsData = { devMode: false, searchMode: "auto", preferredModel: "", textScale: 100, welcomeDone: false };

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
      textScale: p.textScale === 115 || p.textScale === 130 || p.textScale === 150 ? p.textScale : 100,
      welcomeDone: p.welcomeDone === true,
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

export function applyTextScale(scale: number): void {
  if (typeof document !== "undefined") document.documentElement.style.fontSize = `${scale}%`;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const data = load();
    set({ ...data, hydrated: true });
    applyTextScale(data.textScale);
  },
  set: (patch) => {
    set(patch);
    const { devMode, searchMode, preferredModel, textScale, welcomeDone } = get();
    if (patch.textScale) applyTextScale(textScale);
    try {
      window.localStorage.setItem(KEY, JSON.stringify({ devMode, searchMode, preferredModel, textScale, welcomeDone }));
    } catch {
      /* storage may be unavailable (private mode) — keep in-memory value */
    }
  },
}));
