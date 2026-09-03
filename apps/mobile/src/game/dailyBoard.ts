import { dayCallCounts, type RoundBoard } from "@oracle/core";

// Where the day stood. The reveal's answer to the one question the plaque
// cannot answer on install day -- the Oracle Score needs fifty rated calls,
// and this needs one round. Pure -- node-tested.
//
// Every number here is RAW per-question points. The route is the place that
// argument is made in full; the short of it is that a purchased shield must
// never be able to buy a rank.

// The field's own floor, said in its place. Same posture as the crowd's
// GATHERING_LINE: a rank over three people is mostly the reader, so the board
// names the day it is having rather than a placing inside it.
export const FIELD_GATHERING_LINE = "THE FIELD IS STILL GATHERING";

// Why a reader with a real day of points has no rank on it. Past tense: by
// reveal time the sealing is over, and the app has already said the present-
// tense version all through the round (PARTIAL_LINE).
export const UNRATED_LINE = "THE DAY RATED ONLY THOSE WHO SEALED ALL FIVE";

// The reveal reserves this block's height for this many lines, so the board
// ARRIVES when its query resolves instead of shoving the page down under the
// day's number. Every state below must fit it -- the test holds that.
//
// One. The rank and the field's shape used to be two stacked lines, in a
// headline block that had already grown to seven of them; on device that read
// as a wall rather than a result. They are one fact about one day, so they are
// one line.
export const BOARD_MAX_LINES = 1;

// A true minus sign, never the ASCII hyphen -- these are levels rather than
// deltas, so a winning field is written bare and only a losing one is signed.
const level = (n: number) => (n < 0 ? `−${Math.abs(n)}` : String(n));

export function boardLines(b: RoundBoard | undefined): string[] {
  if (!b) return [];
  // The reader's own absence first: on a quiet day it is true at the same time
  // as the small field, and it is the more specific of the two facts -- also
  // the only one of them they can do anything about.
  if (b.your_points === null || b.your_rank === null) {
    return [b.your_points === null ? UNRATED_LINE : FIELD_GATHERING_LINE];
  }
  const shape = b.best_points === null || b.median_points === null
    ? null
    : `BEST ${level(b.best_points)} · MEDIAN ${level(b.median_points)}`;
  const rank = `RANK ${b.your_rank} OF ${b.field_size}`;
  return [shape === null ? rank : `${rank} · ${shape}`];
}

/**
 * The day's closing sting. Two bare counts and no denominator, because the
 * denominators genuinely differ -- the machine may abstain, the player may
 * not have sealed -- and one shared denominator would be a lie about one of
 * them. Null when the machine never forecast the day, or nothing resolved.
 */
export function oracleDayLine(
  questions: Array<{
    outcome: "yes" | "no" | "void" | null;
    oracle_p_yes: number | null;
    my: { answer: boolean } | null;
  }>,
): string | null {
  const scored = questions.filter((q) => q.outcome === "yes" || q.outcome === "no");
  if (scored.length === 0) return null;
  if (scored.every((q) => q.oracle_p_yes === null)) return null;
  const { you, oracle } = dayCallCounts(questions);
  return `YOU ${you} · THE ORACLE ${oracle}`;
}

export function boardRowLines(
  rows: Array<{ name: string; points: number; rank: number; is_you: boolean; is_oracle: boolean }>,
): string[] {
  return rows.map((r) => `${r.rank} · ${r.name} · ${level(r.points)}`);
}
