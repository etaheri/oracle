import { CONSTANTS, COPY_BANK, selectLine, type Reveal } from "@oracle/core";
import { VERDICT_MIN_PLAYERS } from "./crowdVerdict";
import { numeral } from "./numerals";

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

// A true minus sign for a loss — matches payoffLine's receipt formatting,
// never the ASCII hyphen.
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

export function rowRight(q: Question): string {
  const state = rowState(q);
  if (state === "win" || state === "loss") {
    return signed(q.my!.points ?? 0);
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
  if (l.oracle_score !== null) return [streakLine, `ORACLE SCORE ${l.oracle_score}`];
  // This used to read "0 OF 50 CALLS WRITTEN" — a progress bar toward an
  // unnamed thing, in which nothing said what a CALL was, what 50 bought, or
  // what was being written. The first line now names the thing that does not
  // exist yet; the second counts toward it AND states the rate.
  //
  // The rate is the load-bearing half. This screen is about ONE day, and every
  // surface of that day says five — five questions, five numerals, seal all
  // five. A bare "OF 50" on it reads as the same scale, and the honest
  // question a player asks is "fifty of what, there are only five?". "FIVE A
  // DAY" answers it in three words and makes fifty legible as ten days.
  return [
    streakLine,
    "ORACLE SCORE UNWRITTEN",
    `${l.calls_rated} OF ${CONSTANTS.ORACLE_SCORE_MIN_CALLS} RATED CALLS · FIVE A DAY`,
  ];
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

// Was the crowd big enough to be worth reading back? Same floor the round's
// footer verdict and the finale use — a percentage over three players is
// mostly the reader (audit 2026-09-02 §2.1).
export function crowdReadable(q: Question): boolean {
  return q.crowd_yes_pct !== null && q.crowd_count !== null && q.crowd_count >= VERDICT_MIN_PLAYERS;
}

// Said in the crowd's place on the Big One, where a silent hole in a gilded
// frame reads as a rendering fault. Past tense: by reveal time the crowd is
// not still gathering, there simply were not enough of them.
export const TOO_FEW_LINE = "TOO FEW SPOKE TO READ THE CROWD";

// The ordinary rows' missing half (audit 2026-09-02 §3.1). The reveal printed
// the question, the source and the points, and nothing else — so the app whose
// liturgy is "NOTHING IS FORGOTTEN" could not tell you, one day later, what
// you had actually said on four of the day's five calls. Both halves are
// already in the payload; the Big One's own block has read them back all
// along. Null for a row the player never answered — the outcome column
// already speaks for those.
export function callLine(q: Question): string | null {
  const crowd = crowdReadable(q) ? `CROWD ${q.crowd_yes_pct}% YES` : null;
  // A row the player never answered still has something to say: what the
  // crowd made of it. On a lapsed day that IS the page — four outcomes and
  // four sources, and no sense of what was missed.
  if (!q.my) return crowd;
  const mine = `YOU: ${q.my.answer ? "YES" : "NO"} @ ${q.my.confidence}%`;
  return crowd ? `${mine} · ${crowd}` : mine;
}

// How much of the day has actually been read. Shown in the day-points slot
// while any row is still pending: the score at that moment is real but
// partial, and a number that silently climbs on the next refresh is exactly
// the revision the liturgy promises never happens (audit 2026-09-02 §3.2).
export function readingLine(questions: ReadonlyArray<Question>): string {
  const read = questions.filter((q) => q.outcome !== null).length;
  // Roman numerals have no zero, and `numeral(0)` falls back to arabic — so
  // the one count the ceremony can actually open on would print "0 OF V".
  return `${read === 0 ? "NONE" : numeral(read)} OF ${numeral(questions.length)} READ`;
}
