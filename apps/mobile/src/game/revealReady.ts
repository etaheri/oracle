import type { Reveal } from "@oracle/core";

// Home announces yesterday's ledger only when it is actually read (not
// pending) and the player has a line in it. Pure — node-tested.
export function revealReady(r: Reveal | { pending: true } | null | undefined): boolean {
  if (!r || "pending" in r) return false;
  return r.questions.some((q) => q.my !== null);
}
