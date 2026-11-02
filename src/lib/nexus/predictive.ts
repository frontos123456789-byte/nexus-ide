"use client";

import type { CancellationToken, IDisposable, IPosition, editor, languages } from "monaco-editor";
import { askAi } from "./actions";
import { getMonaco } from "@/components/nexus/ui";

/**
 * Predictive Editing: multi-line inline suggestions through Monaco's InlineCompletions API.
 * Tab accepts, Esc rejects, Ctrl/Cmd+Z undoes an accepted suggestion (native Monaco behaviour).
 * Calls are debounced, rate-limited client-side and go through the budget-aware AI gateway.
 */
export function registerPredictive(): IDisposable | null {
  const monaco = getMonaco();
  if (!monaco) return null;
  let last = 0;
  let ctl: AbortController | null = null;
  const provider = {
    provideInlineCompletions: async (model: editor.ITextModel, position: IPosition, _ctx: languages.InlineCompletionContext, token: CancellationToken) => {
      const now = Date.now();
      if (now - last < 3500) return { items: [] };
      await new Promise((r) => setTimeout(r, 700));
      if (token.isCancellationRequested) return { items: [] };
      const before = model.getValueInRange({ startLineNumber: Math.max(1, position.lineNumber - 40), startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column });
      const after = model.getValueInRange({ startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 15), endColumn: 1000 });
      if (before.trim().length < 12) return { items: [] };
      last = Date.now();
      ctl?.abort();
      ctl = new AbortController();
      token.onCancellationRequested(() => ctl?.abort());
      try {
        const r = await askAi({
          feature: "predictive",
          task: "code",
          maxTokens: 220,
          signal: ctl.signal,
          system: "Ты движок автодополнения кода. Верни ТОЛЬКО текст, который нужно вставить в позицию курсора (может быть несколько строк). Без пояснений, без markdown-ограждений. Если нечего предложить — верни пустую строку.",
          prompt: `Язык: ${model.getLanguageId()}\nКод до курсора:\n${before}\n<CURSOR>\nКод после курсора:\n${after}`,
        });
        const text = r.text.replace(/^```[\w-]*\n?|```$/g, "").replace(/\s+$/, "");
        if (!text || token.isCancellationRequested) return { items: [] };
        return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
      } catch {
        return { items: [] };
      }
    },
    freeInlineCompletions: () => undefined,
  } as unknown as languages.InlineCompletionsProvider;
  return monaco.languages.registerInlineCompletionsProvider({ pattern: "**" }, provider);
}
