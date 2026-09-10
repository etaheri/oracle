import type { Reveal } from "@oracle/core";
import { formatFortune, signedFortune } from "./fortuneText";
import { receiptLine } from "./stakeText";
import { readingLine } from "./revealRows";

type Question = Reveal["questions"][number];

export function isFortuneRound(d: Reveal): boolean {
  return d.rules_version >= 3;
}

// The headline (design §8.3): the round's delta and the fortune after, once
// every card is decided. The route withholds all four round figures until
// then, so `delta === null` is the withheld signal -- never a partial sum.
export type FortuneHeadline =
  | { kind: "withheld"; read: string }
  | { kind: "settled"; delta: string; fortune: string }
  | { kind: "none" };

export function fortuneHeadline(d: Reveal): FortuneHeadline {
  const staked = d.questions.some((q) => q.my !== null && q.my.stake !== null);
  if (!staked) return { kind: "none" };
  if (d.delta === null || d.fortune_after === null) return { kind: "withheld", read: readingLine(d.questions) };
  return { kind: "settled", delta: signedFortune(d.delta), fortune: `FORTUNE ${formatFortune(d.fortune_after)}` };
}

// Each card's stake, read back in money. Confidence appears only when the
// round was unstaked (design §5.5), because then it is all there is.
export function stakeReceipt(q: Question): string | null {
  if (!q.my) return null;
  const side = q.my.answer ? "YES" : "NO";
  if (q.my.stake === null) return receiptLine({ answer: q.my.answer, stake: null, wins: null, confidence: q.my.confidence });
  const head = `${side} · STAKED ${formatFortune(q.my.stake)}`;
  if (q.outcome === null || q.my.payout === null) return `${head} · PENDING`;
  if (q.outcome === "void") return `${head} · STAKE RETURNED`;
  return q.my.payout > 0 ? `${head} · PAID ${formatFortune(q.my.payout)}` : `${head} · LOST ${formatFortune(q.my.stake)}`;
}

// The Oracle comparison, as who took whom (design §8.3).
export function oracleTake(q: Question): string | null {
  if (!q.my || q.my.delta === null || q.outcome === null || q.outcome === "void") return null;
  if (q.my.delta > 0) return `YOU TOOK THE ORACLE FOR ${formatFortune(q.my.delta)}`;
  if (q.my.delta < 0) return `THE ORACLE TOOK ${formatFortune(-q.my.delta)}`;
  return null;
}

export function lineContext(q: Question): string | null {
  if (q.line_p_yes === null) return null;
  const line = `THE LINE ${Math.round(q.line_p_yes * 100)}% YES`;
  return q.market_prob === null ? line : `${line} · THE MARKET ${Math.round(q.market_prob * 100)}%`;
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
