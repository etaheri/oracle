import { useEffect, useState } from "react";

// A ticking clock. Three places on Home needed one — the countdown, the risk
// line's 30s re-evaluation, the sleeping panel — and each grew its own
// interval; this is the one implementation.
//
// A null interval stops the clock rather than slowing it: a caller whose line
// has stopped changing should not be re-rendering at all. The last reading is
// kept, so a component that stops ticking does not snap back to its mount.
export function useNow(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
