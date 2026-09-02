import { formatCountdown, msUntil } from "./countdown";

// The card's one live field (refinement spec §1.2). The countdown lived only
// on Home, so the card never said it was ticking — a still frame of it read
// as an inert object. Machine voice: this is chrome, not scripture.
export function cardStatus(locksAt: string | null, now: number, sealed: boolean): string {
  if (sealed) return "ST: SEALED";
  const ms = msUntil(locksAt, now);
  // msUntil already returns null for a null, unparseable, or elapsed lock.
  return ms === null ? "ST: OPEN" : `LOCK ${formatCountdown(ms)}`;
}
