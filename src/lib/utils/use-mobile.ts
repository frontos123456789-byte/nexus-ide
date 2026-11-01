"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Single source of truth for "phone layout".
 * Keep in sync with `@custom-variant mobile` in globals.css.
 *  - narrow screens (phones, small tablets in portrait)
 *  - landscape phones (coarse pointer + very low height)
 */
export const MOBILE_QUERY = "(max-width: 860px), (pointer: coarse) and (max-height: 520px)";

function subscribe(onChange: () => void): () => void {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** Reactive media-query hook. The IDE is client-only, so the server snapshot is never hydrated into UI. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}

/**
 * Keeps `--app-h` / `--app-top` in sync with the *visual* viewport, so the layout shrinks
 * above the on-screen keyboard instead of being covered by it (iOS Safari doesn't resize
 * the layout viewport when the keyboard opens).
 */
export function useVisualViewportVars(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    const vv = window.visualViewport;
    const apply = () => {
      root.style.setProperty("--app-h", `${vv?.height ?? window.innerHeight}px`);
      root.style.setProperty("--app-top", `${vv?.offsetTop ?? 0}px`);
      // iOS scrolls the (non-scrollable) page to reveal the focused field — undo it.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
    };
    apply();
    vv?.addEventListener("resize", apply);
    vv?.addEventListener("scroll", apply);
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    return () => {
      vv?.removeEventListener("resize", apply);
      vv?.removeEventListener("scroll", apply);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      root.style.removeProperty("--app-h");
      root.style.removeProperty("--app-top");
    };
  }, [enabled]);
}

function isEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button"].includes(el.type))) {
    return !el.readOnly;
  }
  return el.isContentEditable;
}

export interface KeyboardState {
  /** A text field is focused and the visible area is small → the soft keyboard is (most likely) open. */
  open: boolean;
  /** The focused field belongs to the Monaco editor. */
  editorFocused: boolean;
}

/** Tracks the soft keyboard so we can hide the bottom navigation and show the symbol bar. */
export function useSoftKeyboard(enabled: boolean): KeyboardState {
  const [state, setState] = useState<{ editable: boolean; editor: boolean; height: number }>({
    editable: false,
    editor: false,
    height: typeof window === "undefined" ? 800 : (window.visualViewport?.height ?? window.innerHeight),
  });

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      const el = document.activeElement;
      setState((s) => ({
        ...s,
        editable: isEditable(el),
        editor: isEditable(el) && !!el?.closest(".monaco-editor"),
        height: window.visualViewport?.height ?? window.innerHeight,
      }));
    };
    // Debounce focusout so hopping between two inputs doesn't flicker the layout.
    const onFocusChange = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 60);
    };
    const onViewport = () => setState((s) => ({ ...s, height: window.visualViewport?.height ?? window.innerHeight }));
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    window.visualViewport?.addEventListener("resize", onViewport);
    sync();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      window.visualViewport?.removeEventListener("resize", onViewport);
    };
  }, [enabled]);

  return { open: state.editable && state.height < 560, editorFocused: state.editor && state.height < 560 };
}
