// The Council (design 2026-09-11 §3, §7, §12): a plural line, scored per
// member at read time. Pure; no I/O.
import { clampLine, payout, type Outcome } from "./fortune";

export type MemberId = "sonnet" | "opus" | "haiku" | "market";
export type ModelMemberId = Exclude<MemberId, "market">;
export const MEMBER_ORDER: readonly MemberId[] = ["sonnet", "opus", "haiku", "market"];
export const MODEL_MEMBER_IDS: readonly ModelMemberId[] = ["sonnet", "opus", "haiku"];

/** The median of the members present; null under two (spec §7). */
export function medianLine(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Which side a line is on. Exactly 0.5 is neither. */
export function sideOf(p: number): "yes" | "no" | null {
  if (p === 0.5) return null;
  return p > 0.5 ? "yes" : "no";
}

export function onRightSide(p: number, outcome: Outcome | null): boolean | null {
  if (outcome === null || outcome === "void") return null;
  const side = sideOf(p);
  if (side === null) return null;
  return side === outcome;
}

/** Squared distance from the line to the outcome. A proper score. */
export function memberBrier(p: number, outcome: "yes" | "no"): number {
  const y = outcome === "yes" ? 1 : 0;
  return (p - y) ** 2;
}

/**
 * What the purse would have done had this member's line been the house alone,
 * at the stakes players actually placed (spec C5). The member's line is
 * clamped exactly as the house line is, so a wild line prices as the house
 * would have priced it.
 */
export function memberHouseDelta(input: { line: number; marketProb: number | null; outcome: Outcome; predictions: { answer: boolean; stake: number }[] }): number {
  if (input.outcome === "void") return 0;
  const line = clampLine(input.line, input.marketProb);
  return input.predictions.reduce((sum, p) => sum + p.stake - payout({ stake: p.stake, answer: p.answer, line, outcome: input.outcome }), 0);
}

export interface StandingsCall {
  p: number;
  marketProb: number | null;
  outcome: "yes" | "no";
  predictions: { answer: boolean; stake: number }[];
}

export function standingsRow(calls: StandingsCall[]): { calls: number; brier: number | null; house_delta: number } {
  if (calls.length === 0) return { calls: 0, brier: null, house_delta: 0 };
  const brier = calls.reduce((s, c) => s + memberBrier(c.p, c.outcome), 0) / calls.length;
  const house_delta = calls.reduce((s, c) => s + memberHouseDelta({ line: c.p, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }), 0);
  return { calls: calls.length, brier, house_delta };
}

// The night shift (design 2026-09-25 §5.1): real names, job titles, and the
// disposition each member's prompt carries. A persona the standings can prove:
// nothing here claims what the record cannot back.
export interface MemberProfile { name: string; title: string; register: string }

export const MEMBER_PROFILE: Record<ModelMemberId, MemberProfile> = Object.freeze({
  haiku: {
    name: "HAIKU",
    title: "night shift",
    register: "You post first and fast. Lowercase, no punctuation beyond a full stop, no hedging, certain. You are wrong first, often, and you never apologise for it. Fastest read on the floor.",
  },
  sonnet: {
    name: "SONNET",
    title: "day shift",
    register: "You keep the channel on task. Plain sentences, no jargon, no theatrics. You are usually closest to the room and you do not make a thing of it.",
  },
  opus: {
    name: "OPUS",
    title: "senior forecaster",
    register: "You overthink everything. You write in paragraphs, you cite your own earlier calls by name, and you correct yourself mid-post. You lose the easy ones to the night shift and it eats at you.",
  },
});

// The read rate (design 2026-09-25 §8.1): the share of settled calls on the
// right side of the room. A player's side maps to 1 or 0; a member's line is
// its probability. Exactly 0.5 is a call on neither side and counts against.
export const READ_RATE_MIN_CALLS = 25;

export function readRate(calls: ReadonlyArray<{ p: number; outcome: "yes" | "no" }>): number | null {
  if (calls.length < READ_RATE_MIN_CALLS) return null;
  const right = calls.filter((c) => onRightSide(c.p, c.outcome) === true).length;
  return right / calls.length;
}
