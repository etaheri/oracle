import type { RoundToday } from "@oracle/core";
import { numeral } from "./numerals";

type Q = RoundToday["questions"][number];

// The card's coordinate line (design 2026-09-25 §4.3): slot and provenance. A
// hot take says where the argument was seen, or that the night shift wrote it
// from the day's mood; a market question keeps its source. PER THE PLAYERS
// stays the resolution stamp on the reveal and never prints here.
export function cardCoordinate(q: Pick<Q, "slot" | "source_name" | "crowd" | "seen_on">): string {
  const head = `:: ${numeral(q.slot)} /`;
  if (!q.crowd) return `${head} PER ${q.source_name.toUpperCase()}`;
  return q.seen_on ? `${head} SEEN ON ${q.seen_on.label.toUpperCase()}` : `${head} THE NIGHT SHIFT`;
}

// The modifiers under the title, in the Big One's chrome: what the stake
// does, what kind of take it is, and whether it closes ahead of the round.
export function cardModifiers(q: Pick<Q, "is_big_one" | "unhinged">, closesEarly: boolean): string {
  return [q.is_big_one ? "STAKES DOUBLE" : null, q.unhinged ? "UNHINGED" : null, closesEarly ? "CLOSES EARLY" : null].filter(Boolean).join(" · ");
}
