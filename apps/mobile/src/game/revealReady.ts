import type { Reveal } from "@oracle/core";

// Home announces yesterday's ledger only when it is actually read (not
// pending) and the player has at least one RESOLVED line in it — a row that
// is merely answered but still outcome: null (mid noon-resolution window)
// does not count, or "THE LEDGER IS READ" would lie while rows are pending.
// Pure — node-tested.
export function revealReady(r: Reveal | { pending: true } | null | undefined): boolean {
  if (!r || "pending" in r) return false;
  return r.questions.some((q) => q.my !== null && q.outcome !== null);
}
