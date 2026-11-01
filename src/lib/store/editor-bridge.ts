import type * as Monaco from "monaco-editor";

/**
 * Imperative bridge to the active Monaco editor so other panels
 * (e.g. chat code blocks) can insert text without prop drilling.
 */
export const editorBridge: { editor: Monaco.editor.IStandaloneCodeEditor | null } = { editor: null };

export function insertAtCursor(text: string): boolean {
  const editor = editorBridge.editor;
  if (!editor) return false;
  const selection = editor.getSelection();
  if (!selection) return false;
  editor.executeEdits("nexus-agent", [{ range: selection, text, forceMoveMarkers: true }]);
  editor.focus();
  return true;
}

export function focusEditor(): void {
  editorBridge.editor?.focus();
}
