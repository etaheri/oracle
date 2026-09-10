import { describe, it, expect } from "vitest";
import { lineLabel, rungLabel, rungA11y, unstakedRungLabel, receiptLine, ladderTable } from "../src/game/stakeText";

describe("the card's money text (design §8.2)", () => {
  it("prints the Oracle's line as a YES percentage, and nothing when there is no line", () => {
    expect(lineLabel(0.35)).toBe("THE ORACLE'S LINE · 35% YES");
    expect(lineLabel(0.5)).toBe("THE ORACLE'S LINE · 50% YES");
    expect(lineLabel(null)).toBeNull();
  });

  it("prints a rung as stake and winnings, never as confidence", () => {
    expect(rungLabel({ stake: 50, wins: 93 })).toBe("STAKE 50 · WINS 93");
    expect(rungLabel({ stake: 1240, wins: 2303 })).toBe("STAKE 1,240 · WINS 2,303");
    expect(rungA11y({ stake: 50, wins: 93 })).toBe("Stake 50, wins 93");
  });

  it("falls back to confidence on a round without a line", () => {
    expect(unstakedRungLabel(75)).toBe("75% SURE");
  });

  it("writes the receipt in money, or in confidence when the round was unstaked", () => {
    expect(receiptLine({ answer: true, stake: 50, wins: 93, confidence: 75 })).toBe("YES · STAKED 50 · WINS 93");
    expect(receiptLine({ answer: false, stake: 0, wins: 0, confidence: 55 })).toBe("NO · STAKED 0 · WINS 0");
    expect(receiptLine({ answer: false, stake: null, wins: null, confidence: 85 })).toBe("NO · 85% SURE");
  });

  it("tables the ladder for the rules at a founding fortune", () => {
    const rows = ladderTable();
    expect(rows.map((r) => r.percent)).toEqual(["1%", "3%", "5%", "7%", "9%"]);
    expect(rows.map((r) => r.bigOne)).toEqual(["2%", "6%", "10%", "14%", "18%"]);
    expect(rows.map((r) => r.example)).toEqual(["10", "30", "50", "70", "90"]);
    expect(rows.map((r) => r.rung)).toEqual(["I", "II", "III", "IV", "V"]);
  });
});
