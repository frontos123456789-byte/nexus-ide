import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

/**
 * Atomic editor state (Jotai). High-frequency values such as the cursor
 * position live here so only the status bar re-renders while typing.
 */

export interface CursorInfo {
  line: number;
  column: number;
  selected: number;
}

export const cursorAtom = atom<CursorInfo>({ line: 1, column: 1, selected: 0 });

export interface EditorSettings {
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = { fontSize: 13, wordWrap: false, minimap: true };

export const editorSettingsAtom = atomWithStorage<EditorSettings>("nexus-editor-settings", DEFAULT_EDITOR_SETTINGS);

export const editorReadyAtom = atom(false);
