import { useEffect, useState } from "react";

// A ticking clock. Three places on Home needed one — the countdown, the risk
// line's 30s re-evaluation, the sleeping panel — and each grew its own
// interval; this is the one implementation.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
