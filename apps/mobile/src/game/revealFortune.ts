import { FORTUNE, type Reveal } from "@oracle/core";
import { formatFortune, signedFortune } from "./fortuneText";
import { receiptLine } from "./stakeText";
import { readingLine } from "./revealRows";

type Question = Reveal["questions"][number];

export function isFortuneRound(d: Reveal): boolean {
  return d.rules_version >= 3;
}

// Did the player actually stake on this round? A version 3 round that opened
// with no line committed (design §5.5) takes predictions with no stake at
// all, so it has no money in it and reads as a points round; a spectator's
// round has no stakes either. Callers pair this with isFortuneRound.
export function stakedRound(d: Reveal): boolean {
  return d.questions.some((q) => q.my !== null && q.my.stake !== null);
}

// The headline (design §8.3): the round's delta and the fortune after, once
// every card is decided. The route withholds all four round figures until
// then, so `delta === null` is the withheld signal -- never a partial sum.
export type FortuneHeadline =
  | { kind: "withheld"; read: string }
  | { kind: "settled"; delta: string; fortune: string }
  | { kind: "none" };

export function fortuneHeadline(d: Reveal): FortuneHeadline {
  if (!stakedRound(d)) return { kind: "none" };
  if (d.delta === null || d.fortune_after === null) return { kind: "withheld", read: readingLine(d.questions) };
  return { kind: "settled", delta: signedFortune(d.delta), fortune: `FORTUNE ${formatFortune(d.fortune_after)}` };
}

// Each card's stake, read back in money. An unstaked round (design §5.5)
// has no money in it, so the receipt is the side and nothing more.
export function stakeReceipt(q: Question): string | null {
  if (!q.my) return null;
  const side = q.my.answer ? "YES" : "NO";
  if (q.my.stake === null) return receiptLine({ answer: q.my.answer, line: null });
  const head = `${side} · STAKED ${formatFortune(q.my.stake)}`;
  // The double is the call's own news, so it rides the receipt in every
  // state -- pending included, where it is the only place the player can
  // still see what they doubled on (design 2026-09-14 §8.4).
  const body =
    q.outcome === null || q.my.payout === null ? `${head} · PENDING`
    : q.outcome === "void" ? `${head} · STAKE RETURNED`
    : q.my.payout > 0 ? `${head} · PAID ${formatFortune(q.my.payout)}`
    : `${head} · LOST ${formatFortune(q.my.stake)}`;
  return q.my.doubled ? `${body} · DOUBLED` : body;
}

// The bust (design 2026-09-14 §8.4): one block, once, under the headline.
// `bust_fortune` is the fortune the house took it at; the best rides beside
// it so the run has its one number the moment it ends.
export function bustLines(d: Reveal, best: number | null): { took: string; best: string | null; read: string } | null {
  if (d.bust_fortune === null) return null;
  return {
    took: "THE HOUSE TOOK IT ALL",
    best: best === null ? null : `BEST ${formatFortune(best)}`,
    read: `A new fortune of ${formatFortune(FORTUNE.FOUNDING)} opens at noon.`,
  };
}

// The one line about the double, only when it was placed and decided.
export function doubleObservation(qs: ReadonlyArray<Question>): string | null {
  const d = qs.find((q) => q.my?.doubled);
  if (!d || !d.my || d.outcome === null || d.outcome === "void" || d.my.delta === null) return null;
  return d.my.delta > 0 ? "YOUR DOUBLE PAID" : "YOUR DOUBLE WAS WRONG";
}

// With or against the room (design 2026-09-22 §9.3): the side of the
// majority, and the money it moved.
export function oracleTake(q: Question): string | null {
  if (!q.my || q.my.delta === null || q.outcome === null || q.outcome === "void") return null;
  if (q.my.delta > 0) return `YOU WERE WITH THE ROOM · ${signedFortune(q.my.delta)}`;
  if (q.my.delta < 0) return `YOU WERE AGAINST THE ROOM · ${signedFortune(q.my.delta)}`;
  return null;
}

export function lineContext(q: Question): string | null {
  if (q.line_p_yes === null) return null;
  const expected = `THE ORACLE EXPECTED ${Math.round(q.line_p_yes * 100)}% YES`;
  return q.crowd_yes_pct === null ? expected : `${expected} · THE ROOM SAID ${Math.round(q.crowd_yes_pct)}%`;
}

export function fortuneRowRight(q: Question): string {
  if (!q.my) return q.outcome === "yes" ? "YES" : q.outcome === "no" ? "NO" : q.outcome === "void" ? "VOID" : "—";
  if (q.my.delta === null) return "—";
  return signedFortune(q.my.delta);
}

export function houseNightLine(houseDelta: number | null): string | null {
  if (houseDelta === null) return null;
  if (houseDelta > 0) return `THE HOUSE WON ${formatFortune(houseDelta)} LAST NIGHT`;
  if (houseDelta < 0) return `THE HOUSE LOST ${formatFortune(-houseDelta)} LAST NIGHT`;
  return "THE HOUSE BROKE EVEN LAST NIGHT";
}

// The row's mark at version 3, from the delta's sign -- outcome must never be
// carried by colour alone (brief §11).
export function moneyMark(q: Question): string {
  if (!q.my) return "·";
  if (q.outcome === null || q.my.delta === null) return "…";
  if (q.outcome === "void") return "∅";
  return q.my.delta > 0 ? "✓" : q.my.delta < 0 ? "✗" : "∅";
}
