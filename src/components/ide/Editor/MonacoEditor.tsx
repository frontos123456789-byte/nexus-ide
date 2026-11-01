"use client";

import { useCallback, useEffect, useRef } from "react";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useAtomValue, useSetAtom } from "jotai";
import { cursorAtom, editorReadyAtom, editorSettingsAtom } from "@/lib/store/editor-atoms";
import { editorBridge } from "@/lib/store/editor-bridge";
import { useIdeStore } from "@/lib/store/ide";
import { languageFromPath } from "@/lib/utils/path";
import { MOBILE_QUERY, useIsMobile } from "@/lib/utils/use-mobile";
import { EditorSkeleton } from "./EditorSkeleton";
import { configureLanguages, configureMonacoLoader, defineNexusTheme, NEXUS_THEME } from "./monaco-setup";

configureMonacoLoader();

const FONT_FAMILY = "'Geist Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export function MonacoEditor({ path }: { path: string }) {
  const value = useIdeStore((s) => s.contents[path] ?? "");
  const nodes = useIdeStore((s) => s.nodes);
  const settings = useAtomValue(editorSettingsAtom);
  const isMobile = useIsMobile();
  const setCursor = useSetAtom(cursorAtom);
  const setReady = useSetAtom(editorReadyAtom);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const disposables = useRef<Monaco.IDisposable[]>([]);

  const beforeMount = useCallback<BeforeMount>((monaco) => {
    defineNexusTheme(monaco);
    configureLanguages(monaco);
  }, []);

  const onMount = useCallback<OnMount>(
    (editor, monaco) => {
      monacoRef.current = monaco;
      editorBridge.editor = editor;
      setReady(true);

      const updateCursor = () => {
        const pos = editor.getPosition();
        const sel = editor.getSelection();
        const model = editor.getModel();
        const selected = sel && model && !sel.isEmpty() ? model.getValueInRange(sel).length : 0;
        if (pos) setCursor({ line: pos.lineNumber, column: pos.column, selected });
      };
      updateCursor();
      disposables.current.push(
        editor.onDidChangeCursorPosition(updateCursor),
        editor.onDidChangeCursorSelection(updateCursor),
        editor.onDidChangeModel(updateCursor),
      );
      // Don't pop the soft keyboard on phones just because a file was opened.
      if (!window.matchMedia(MOBILE_QUERY).matches) editor.focus();
    },
    [setCursor, setReady],
  );

  useEffect(() => {
    const items = disposables.current;
    return () => {
      for (const d of items) d.dispose();
      items.length = 0;
      if (editorBridge.editor) editorBridge.editor = null;
      setReady(false);
    };
  }, [setReady]);

  // Drop Monaco models of deleted/renamed files so recreated paths start fresh.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    for (const model of monaco.editor.getModels()) {
      if (model.uri.scheme !== "file") continue;
      const p = decodeURIComponent(model.uri.path).replace(/^\//, "");
      if (!nodes[p] && p !== path) model.dispose();
    }
  }, [nodes, path]);

  return (
    <Editor
      height="100%"
      path={`file:///${path}`}
      language={languageFromPath(path)}
      value={value}
      theme={NEXUS_THEME}
      loading={<EditorSkeleton />}
      beforeMount={beforeMount}
      onMount={onMount}
      keepCurrentModel
      onChange={(next) => {
        if (next !== undefined) useIdeStore.getState().updateContent(path, next);
      }}
      options={{
        automaticLayout: true,
        fontFamily: FONT_FAMILY,
        fontSize: isMobile ? Math.max(settings.fontSize, 14) : settings.fontSize,
        fontLigatures: true,
        lineHeight: Math.round((isMobile ? Math.max(settings.fontSize, 14) : settings.fontSize) * 1.65),
        // Phones: no minimap, wrapped lines (no sideways panning) and a compact gutter to give code the width.
        minimap: { enabled: settings.minimap && !isMobile, renderCharacters: false, scale: 1 },
        wordWrap: settings.wordWrap || isMobile ? "on" : "off",
        ...(isMobile
          ? {
              glyphMargin: false,
              folding: false,
              lineNumbersMinChars: 3,
              lineDecorationsWidth: 6,
              stickyScroll: { enabled: false },
              occurrencesHighlight: "off" as const,
              renderLineHighlight: "line" as const,
              guides: { bracketPairs: false, indentation: false },
              quickSuggestionsDelay: 200,
              suggestOnTriggerCharacters: true,
              parameterHints: { enabled: false },
              hover: { enabled: false },
              dragAndDrop: false,
            }
          : {}),
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        scrollBeyondLastLine: false,
        renderLineHighlight: "all",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true },
        padding: { top: 12, bottom: isMobile ? 96 : 12 },
        tabSize: 2,
        insertSpaces: true,
        fixedOverflowWidgets: true,
        roundedSelection: true,
        scrollbar: { verticalScrollbarSize: isMobile ? 6 : 10, horizontalScrollbarSize: isMobile ? 6 : 10, useShadows: false, alwaysConsumeMouseWheel: false },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        stickyScroll: { enabled: !isMobile },
        mouseWheelZoom: !isMobile,
        accessibilitySupport: "off",
      }}
    />
  );
}
