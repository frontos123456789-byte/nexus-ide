import { loader } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

/** Monaco is served from a pinned CDN build — keeps the Vercel bundle small and SSR-safe. */
export const MONACO_VERSION = "0.52.2";
let configured = false;

export function configureMonacoLoader(): void {
  if (configured) return;
  configured = true;
  loader.config({ paths: { vs: `https://cdn.jsdelivr.net/npm/monaco-editor@${MONACO_VERSION}/min/vs` } });
}

export const NEXUS_THEME = "nexus-dark";
let themeDefined = false;

export function defineNexusTheme(monaco: typeof Monaco): void {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme(NEXUS_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "keyword.control", foreground: "c084fc" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fdba74" },
      { token: "type", foreground: "7dd3fc" },
      { token: "type.identifier", foreground: "7dd3fc" },
      { token: "tag", foreground: "fda4af" },
      { token: "attribute.name", foreground: "fcd34d" },
      { token: "delimiter", foreground: "a1a1aa" },
    ],
    colors: {
      "editor.background": "#0a0a0a",
      "editor.foreground": "#d4d4d8",
      "editorGutter.background": "#0a0a0a",
      "editorLineNumber.foreground": "#3f3f46",
      "editorLineNumber.activeForeground": "#a1a1aa",
      "editor.lineHighlightBackground": "#111113",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#4f46e540",
      "editor.inactiveSelectionBackground": "#4f46e520",
      "editor.findMatchBackground": "#f59e0b44",
      "editorCursor.foreground": "#818cf8",
      "editorIndentGuide.background1": "#1c1c20",
      "editorIndentGuide.activeBackground1": "#32323a",
      "editorWhitespace.foreground": "#27272a",
      "editorWidget.background": "#121215",
      "editorWidget.border": "#2b2b31",
      "editorSuggestWidget.background": "#121215",
      "editorSuggestWidget.border": "#2b2b31",
      "editorSuggestWidget.selectedBackground": "#4f46e53a",
      "editorHoverWidget.background": "#121215",
      "editorHoverWidget.border": "#2b2b31",
      "scrollbarSlider.background": "#26262b88",
      "scrollbarSlider.hoverBackground": "#3a3a42aa",
      "minimap.background": "#0a0a0a",
      "diffEditor.insertedTextBackground": "#10b9811f",
      "diffEditor.removedTextBackground": "#ef44441f",
      "diffEditor.insertedLineBackground": "#10b98112",
      "diffEditor.removedLineBackground": "#ef444412",
    },
  });
}

/** Silences false-positive module errors: the workspace is virtual, there is no real node_modules. */
export function configureLanguages(monaco: typeof Monaco): void {
  const ts = monaco.languages.typescript;
  const compilerOptions: Monaco.languages.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    jsx: ts.JsxEmit.ReactJSX,
    allowNonTsExtensions: true,
    allowJs: true,
    esModuleInterop: true,
    strict: true,
  };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(compilerOptions);
    defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSuggestionDiagnostics: true, noSyntaxValidation: false });
  }
}

export const EDITOR_FONT = "var(--font-geist-mono), 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
