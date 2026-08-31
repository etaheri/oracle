import { COPY_BANK, selectLine, type Reveal } from "@oracle/core";

type Question = Reveal["questions"][number];

// The reveal's row taxonomy (audit §3.3, §3.5): an unresolved question is
// pending no matter what else is true of it — never mistaken for a loss.
// A settled question the player skipped is a spectator row, not a loss.
export type RowState = "win" | "loss" | "void" | "pending" | "spectator";

export function rowState(q: Question): RowState {
  if (q.outcome === null) return "pending";
  if (q.my === null) return "spectator";
  if (q.outcome === "void") return "void";
  return (q.my.points ?? 0) > 0 ? "win" : "loss";
}

export function rowMark(state: RowState): string {
  switch (state) {
    case "win":
      return "✓";
    case "loss":
      return "✗";
    case "void":
      return "∅";
    case "pending":
      return "…";
    case "spectator":
      return "·";
  }
}

export function rowRight(q: Question): string {
  const state = rowState(q);
  if (state === "win" || state === "loss") {
    const points = q.my!.points ?? 0;
    return points > 0 ? `+${points}` : String(points);
  }
  if (state === "spectator") {
    return q.outcome === "yes" ? "YES" : q.outcome === "no" ? "NO" : "VOID";
  }
  return "—"; // void, pending
}

const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// The receipt: the source that answered, and — when it spoke — the words it
// used. A void row names why the ledger refused to score it (audit §3.3); a
// pending row admits the source hasn't been read yet, not that it failed.
export function receiptLine(q: Question): string | null {
  const state = rowState(q);
  if (state === "void") {
    return `VOID · ${(q.void_reason ?? "UNVERIFIABLE").toUpperCase()}`;
  }
  if (state === "pending") {
    return `PER ${q.source_name.toUpperCase()} · NOT YET READ`;
  }
  const base = `PER ${q.source_name.toUpperCase()}`;
  return q.evidence_quote ? `${base} · "${clip(q.evidence_quote)}"` : base;
}

// Dopamine hit #2's missing half (audit §3.2): the vigil's day count and the
// Oracle Score's progress, spoken only once the day is actually settled.
export function ledgerLines(l: Reveal["ledger"]): string[] {
  if (!l.settled) return ["THE VIGIL IS COUNTED SHORTLY"];
  const streakLine = l.streak > 0 ? `VIGIL: DAY ${l.streak}` : "THE VIGIL BEGINS AGAIN";
  const scoreLine = l.oracle_score === null ? `${l.calls_rated} OF 50 CALLS WRITTEN` : `ORACLE SCORE ${l.oracle_score}`;
  return [streakLine, scoreLine];
}

// A day already past noon and still unresolved reads differently than one
// still waiting on today's noon (audit §3.5's "RETURN AT NOON" at noon).
export function pendingLine(date: string, todayIso: string): string {
  return date < todayIso ? "THE LEDGER IS BEING READ. PATIENCE." : "RETURN AT NOON.";
}

const LAPSED_LINES = COPY_BANK.filter((l) => l.id.startsWith("noon.lapsed"));

// A lapsed player's reveal gets a line, not a page of dots (audit #6).
export function lapsedLine(seedKey: string): string {
  return selectLine(LAPSED_LINES, seedKey, ["lapsed"])?.text ?? LAPSED_LINES[0]!.text;
}
