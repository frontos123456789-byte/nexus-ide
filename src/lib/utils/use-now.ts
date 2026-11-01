import { useEffect, useState } from "react";

/** Returns a ticking timestamp while `active` (used for live elapsed timers). */
export function useNow(active: boolean, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const kick = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => {
      clearTimeout(kick);
      clearInterval(id);
    };
  }, [active, intervalMs]);
  return now;
}
