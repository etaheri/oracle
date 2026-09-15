import { describe, it, expect } from "vitest";
import { lineLabel, sideLine, receiptLine, sealHint, SWIPE_HINT, TAP_HINT } from "../src/game/stakeText";

describe("the card's money text (design §5.1)", () => {
  it("prints the Oracle's line as a YES percentage, and nothing when there is no line", () => {
    expect(lineLabel(0.35)).toBe("THE ORACLE'S LINE · 35% YES");
    expect(lineLabel(null)).toBeNull();
  });
  it("prints a side's stake and winnings, and names the Big One", () => {
    expect(sideLine(true, 50, 93, false)).toBe("STAKE 50 · WINS 93");
    expect(sideLine(false, 1240, 2303, false)).toBe("STAKE 1,240 · WINS 2,303");
    expect(sideLine(true, 100, 186, true)).toBe("THE BIG ONE · STAKE 100 · WINS 186");
  });
  it("writes the receipt in money, marks the double, and says only the side on an unstaked round", () => {
    expect(receiptLine({ answer: true, stake: 50, wins: 93 })).toBe("YES · STAKED 50 · WINS 93");
    expect(receiptLine({ answer: true, stake: 100, wins: 186, doubled: true })).toBe("YES · STAKED 100 · WINS 186 · DOUBLED");
    expect(receiptLine({ answer: false, stake: null, wins: null })).toBe("NO");
  });
  it("teaches the way in that actually works, so reduced motion is never told to swipe a dead gesture", () => {
    expect(SWIPE_HINT).toBe("SWIPE RIGHT FOR YES, LEFT FOR NO.");
    expect(TAP_HINT).toBe("TAP A SIDE TO SEAL.");
    expect(sealHint(false)).toBe(SWIPE_HINT);
    expect(sealHint(true)).toBe(TAP_HINT);
  });
});
