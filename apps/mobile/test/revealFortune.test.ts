import { describe, it, expect } from "vitest";
import type { Reveal } from "@oracle/core";
import { fortuneHeadline, stakeReceipt, oracleTake, lineContext, fortuneRowRight, houseNightLine, isFortuneRound, stakedRound, moneyMark, bustLines, doubleObservation } from "../src/game/revealFortune";

type Q = Reveal["questions"][number];
const q = (over: Omit<Partial<Q>, "my"> & { my?: Partial<NonNullable<Q["my"]>> | null }): Q => ({
  id: "q", slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 30, market_prob: 0.4, line_p_yes: 0.35,
  source_name: "Kalshi", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: 0.35,
  ...over,
  my: over.my === null ? null : { answer: true, confidence: 75, points: null, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null, stake: 50, payout: 143, delta: 93, doubled: false, ...(over.my ?? {}) },
});
const reveal = (over: Partial<Reveal>): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0,
  vigil_mult: 1, delta: 140, return: 0.14, fortune_after: 1140, house_delta: -140, bust_fortune: null, questions: [q({})],
  council: [], evidence: [],
  ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
});

describe("the version 3 reveal (design §8.3)", () => {
  it("is a fortune round at version 3 only", () => {
    expect(isFortuneRound(reveal({}))).toBe(true);
    expect(isFortuneRound(reveal({ rules_version: 2 }))).toBe(false);
  });

  it("withholds the headline while any card is undecided, then prints delta and fortune after", () => {
    expect(fortuneHeadline(reveal({ delta: null, questions: [q({ outcome: null, my: { payout: null, delta: null } }), q({})] })))
      .toEqual({ kind: "withheld", read: "I OF II READ" });
    expect(fortuneHeadline(reveal({}))).toEqual({ kind: "settled", delta: "+140", fortune: "FORTUNE 1,140" });
    expect(fortuneHeadline(reveal({ delta: -60, fortune_after: 940 }))).toEqual({ kind: "settled", delta: "−60", fortune: "FORTUNE 940" });
  });

  it("has no headline for a spectator who staked nothing", () => {
    expect(fortuneHeadline(reveal({ delta: null, questions: [q({ my: null })] }))).toEqual({ kind: "none" });
  });

  it("is a staked round only when a card carries a stake", () => {
    expect(stakedRound(reveal({}))).toBe(true);
    // A version 3 round that opened with no line committed (design §5.5):
    // predictions carry confidence only, so the reveal reads in points.
    expect(stakedRound(reveal({ questions: [q({ my: { stake: null, payout: null, delta: null } })] }))).toBe(false);
    expect(stakedRound(reveal({ questions: [q({ my: null })] }))).toBe(false);
  });

  it("writes the stake receipt in money", () => {
    expect(stakeReceipt(q({}))).toBe("YES · STAKED 50 · PAID 143");
    expect(stakeReceipt(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("YES · STAKED 50 · LOST 50");
    expect(stakeReceipt(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("YES · STAKED 50 · STAKE RETURNED");
    expect(stakeReceipt(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("YES · STAKED 50 · PENDING");
    expect(stakeReceipt(q({ my: null }))).toBeNull();
    expect(stakeReceipt(q({ my: { stake: null, payout: null, delta: null } }))).toBe("YES");
  });

  it("marks the doubled call on its receipt", () => {
    expect(stakeReceipt(q({ my: { stake: 100, payout: 286, delta: 186, doubled: true } }))).toBe("YES · STAKED 100 · PAID 286 · DOUBLED");
    expect(stakeReceipt(q({ outcome: null, my: { payout: null, delta: null, doubled: true } }))).toBe("YES · STAKED 50 · PENDING · DOUBLED");
  });

  it("reads the bust once, with the best beside it", () => {
    expect(bustLines(reveal({ bust_fortune: 62, delta: -410, fortune_after: 62 }), 3400))
      .toEqual({ took: "THE HOUSE TOOK IT ALL", best: "BEST 3,400", read: "A new fortune of 1,000 opens at noon." });
    expect(bustLines(reveal({ bust_fortune: 62 }), null)).toMatchObject({ took: "THE HOUSE TOOK IT ALL", best: null });
    expect(bustLines(reveal({}), 3400)).toBeNull();
  });

  it("observes the double only once it is decided", () => {
    expect(doubleObservation([q({ my: { doubled: true } })])).toBe("YOUR DOUBLE PAID");
    expect(doubleObservation([q({ outcome: "no", my: { doubled: true, payout: 0, delta: -50 } })])).toBe("YOUR DOUBLE WAS WRONG");
    expect(doubleObservation([q({ outcome: "void", my: { doubled: true, payout: 50, delta: 0 } })])).toBeNull();
    expect(doubleObservation([q({ outcome: null, my: { doubled: true, payout: null, delta: null } })])).toBeNull();
    expect(doubleObservation([q({})])).toBeNull();
  });

  it("reads the Oracle comparison as who took whom", () => {
    expect(oracleTake(q({}))).toBe("YOU TOOK THE ORACLE FOR 93");
    expect(oracleTake(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("THE ORACLE TOOK 50");
    expect(oracleTake(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBeNull();
    expect(oracleTake(q({ my: null }))).toBeNull();
  });

  it("gives the line and the market as context", () => {
    expect(lineContext(q({}))).toBe("THE LINE 35% YES · THE MARKET 40%");
    expect(lineContext(q({ market_prob: null }))).toBe("THE LINE 35% YES");
    expect(lineContext(q({ line_p_yes: null }))).toBeNull();
  });

  it("puts the delta on the row's right, and a dash when undecided", () => {
    expect(fortuneRowRight(q({}))).toBe("+93");
    expect(fortuneRowRight(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("−50");
    expect(fortuneRowRight(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("0");
    expect(fortuneRowRight(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("—");
    expect(fortuneRowRight(q({ my: null }))).toBe("YES");
  });

  it("marks a money row by the delta's sign", () => {
    expect(moneyMark(q({}))).toBe("✓");
    expect(moneyMark(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("✗");
    expect(moneyMark(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("∅");
    expect(moneyMark(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("…");
    expect(moneyMark(q({ my: null }))).toBe("·");
  });

  it("names the house's night", () => {
    expect(houseNightLine(-140)).toBe("THE HOUSE LOST 140 LAST NIGHT");
    expect(houseNightLine(1240)).toBe("THE HOUSE WON 1,240 LAST NIGHT");
    expect(houseNightLine(0)).toBe("THE HOUSE BROKE EVEN LAST NIGHT");
    expect(houseNightLine(null)).toBeNull();
  });
});
