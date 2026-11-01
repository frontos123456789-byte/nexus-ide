import { useCallback, useEffect, useRef } from "react";

/** Keeps a scroll container pinned to the bottom unless the user scrolled up. */
export function useStickToBottom<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null);
  const stick = useRef(true);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [dep]);

  const scrollToBottom = useCallback(() => {
    const el = ref.current;
    stick.current = true;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return { ref, onScroll, scrollToBottom };
}
