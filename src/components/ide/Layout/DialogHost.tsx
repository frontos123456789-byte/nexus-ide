"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useDialogStore } from "@/lib/store/dialogs";

/** Renders the global confirm / prompt dialogs driven by `useDialogStore`. */
export function DialogHost() {
  const request = useDialogStore((s) => s.request);
  const close = useDialogStore((s) => s.close);
  const [draft, setDraft] = useState<{ source: unknown; value: string }>({ source: null, value: "" });
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the input whenever a new prompt request arrives (derived-state pattern).
  if (request && draft.source !== request) {
    setDraft({ source: request, value: request.kind === "prompt" ? request.initial : "" });
    if (error) setError(null);
  }
  const value = draft.value;
  const setValue = (v: string) => setDraft({ source: request, value: v });

  const cancel = () => {
    if (!request) return;
    if (request.kind === "confirm") request.resolve(false);
    else request.resolve(null);
    close();
  };

  const submit = () => {
    if (!request) return;
    if (request.kind === "confirm") {
      request.resolve(true);
      close();
      return;
    }
    const problem = request.validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      return;
    }
    request.resolve(value);
    close();
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && cancel()}>
      {request && (
        <DialogContent
          onOpenAutoFocus={(e) => {
            if (request.kind === "prompt") {
              e.preventDefault();
              inputRef.current?.focus();
              inputRef.current?.select();
            }
          }}
        >
          <DialogTitle className="text-sm font-semibold text-foreground">{request.title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-xs leading-relaxed text-subtle">
            {request.description ?? "\u00a0"}
          </DialogDescription>
          {request.kind === "prompt" && (
            <div className="mt-3">
              <input
                ref={inputRef}
                value={value}
                placeholder={request.placeholder}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                spellCheck={false}
                className="h-9 mobile:h-11 w-full rounded-md border border-border-strong bg-background px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-muted focus:border-accent"
              />
              {error && <p className="mt-1.5 text-[11px] text-red-400">{error}</p>}
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2 mobile:gap-3">
            <Button variant="ghost" onClick={cancel}>
              Отмена
            </Button>
            <Button
              variant={request.kind === "confirm" && request.destructive ? "destructive" : "default"}
              onClick={submit}
              autoFocus={request.kind === "confirm"}
            >
              {request.confirmLabel}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
