import { useEffect, useRef } from "react";

export interface Hotkey {
  /** Lower-case `KeyboardEvent.key` (ignored if `code` is set). */
  key?: string;
  /** `KeyboardEvent.code`, e.g. "Digit1" — layout independent. */
  code?: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** Fire even while typing in inputs / the editor. Default true for mod combos. */
  allowInInput?: boolean;
  handler: (event: KeyboardEvent) => void;
}

export function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
}

export function matchHotkey(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, h: Hotkey, mac: boolean): boolean {
  const modPressed = mac ? e.metaKey : e.ctrlKey;
  if (!!h.mod !== modPressed) return false;
  // Never steal the *other* modifier: Ctrl on mac / Meta on win are not ours.
  if (mac ? e.ctrlKey && !h.mod : e.metaKey) return false;
  if (!!h.shift !== e.shiftKey) return false;
  if (!!h.alt !== e.altKey) return false;
  if (h.code) return e.code === h.code;
  return !!h.key && e.key.toLowerCase() === h.key.toLowerCase();
}

export function formatShortcut(h: Pick<Hotkey, "key" | "mod" | "shift" | "alt">, mac: boolean): string {
  const key = (h.key ?? "").length === 1 ? (h.key ?? "").toUpperCase() : (h.key ?? "");
  if (mac) return `${h.mod ? "⌘" : ""}${h.alt ? "⌥" : ""}${h.shift ? "⇧" : ""}${key}`;
  return [h.mod ? "Ctrl" : "", h.alt ? "Alt" : "", h.shift ? "Shift" : "", key].filter(Boolean).join("+");
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/** Registers global hotkeys in the capture phase (so Monaco cannot swallow them). */
export function useHotkeys(hotkeys: Hotkey[]): void {
  const ref = useRef(hotkeys);
  useEffect(() => {
    ref.current = hotkeys;
  });

  useEffect(() => {
    const mac = detectMac();
    const onKeyDown = (e: KeyboardEvent) => {
      for (const h of ref.current) {
        if (!matchHotkey(e, h, mac)) continue;
        const allowInInput = h.allowInInput ?? !!h.mod;
        if (!allowInInput && isTypingTarget(e.target)) continue;
        e.preventDefault();
        e.stopPropagation();
        h.handler(e);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
