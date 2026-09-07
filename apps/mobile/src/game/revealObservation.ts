import type { DuelQuestion } from "@oracle/core";
export function revealObservation(qs: DuelQuestion[]): string | null {
  if (qs.some(q => q.outcome === null)) return null;
  const scored = qs.filter(q => q.my && (q.outcome === "yes" || q.outcome === "no"));
  if (scored.length < 3) return null;
  const highest = Math.max(...scored.map(q => q.my!.confidence));
  const top = scored.filter(q => q.my!.confidence === highest);
  if (top.length !== 1) return null;
  return (top[0]!.my!.answer ? "yes" : "no") !== top[0]!.outcome ? "YOUR MOST CONFIDENT CALL WAS WRONG. CONVICTION HAS A COST." : null;
}
