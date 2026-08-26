import { useEffect, useState } from "react";
import { colors } from "../theme";
import { Mono } from "./Text";
import { formatCountdown, msUntil } from "../game/countdown";

// A quiet machine-voice countdown. Ticks once a second; shows the fallback
// line (or nothing) when the target is missing or already past. Ticking text
// is not "motion" — no reduced-motion branch (brand brief §11 keeps text as
// the accessible signal).
export function Countdown({ until, prefix, fallback }: { until: string | null; prefix: string; fallback?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = msUntil(until, now);
  if (ms === null) {
    if (!fallback) return null;
    return (
      <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{fallback}</Mono>
    );
  }
  return (
    <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>
      {prefix} {formatCountdown(ms)}
    </Mono>
  );
}
