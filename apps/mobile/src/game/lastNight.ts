import type { Reveal } from "@oracle/core";
import { signedFortune } from "./fortuneText";

// Last night's result, paired with today's five (design 2026-09-25 §6.5, audit
// E4). The only place Home mentions yesterday. It waits for the round's delta,
// which the route withholds until every take is decided, so the figure never
// climbs after it has been shown.
export function lastNightLine(d: Reveal | { pending: true } | null | undefined): string | null {
  if (!d || "pending" in d || d.delta === null) return null;
  const mine = d.questions.filter((q) => q.crowd && q.my !== null && (q.outcome === "yes" || q.outcome === "no"));
  if (mine.length === 0) return null;
  const read = mine.filter((q) => q.my!.answer === (q.outcome === "yes")).length;
  return `LAST NIGHT · ${signedFortune(d.delta)} · YOU READ THE ROOM ON ${read} OF ${mine.length}`;
}
