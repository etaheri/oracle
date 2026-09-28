import { describe, it, expect } from "vitest";
import { lineLabel, receiptLine, crowdCallLine, sealHint, SWIPE_HINT, SWIPE_HINT_ROOM, TAP_HINT } from "../src/game/stakeText";

describe("the card's estimate text (design 2026-09-22 §9)", () => {
  it("prints what the Oracle expected as a YES percentage, and nothing when there is no line", () => {
    expect(lineLabel(0.38)).toBe("THE ORACLE EXPECTED 38% YES");
    expect(lineLabel(null)).toBeNull();
  });
  it("writes the receipt as the side and the estimate, marks the double, and says only the side without a line", () => {
    expect(receiptLine({ answer: true, line: 0.38 })).toBe("YES · THE ORACLE EXPECTED 38% YES");
    expect(receiptLine({ answer: true, line: 0.38, doubled: true })).toBe("YES · THE ORACLE EXPECTED 38% YES · DOUBLED");
    expect(receiptLine({ answer: false, line: null })).toBe("NO");
  });
  it("keeps both hints to one line by ending neither with a full stop", () => {
    expect(SWIPE_HINT.endsWith(".")).toBe(false);
    expect(TAP_HINT.endsWith(".")).toBe(false);
  });
  it("teaches the way in that actually works, so reduced motion is never told to swipe a dead gesture", () => {
    expect(SWIPE_HINT).toBe("SWIPE RIGHT FOR YES, LEFT FOR NO");
    expect(TAP_HINT).toBe("TAP A SIDE TO SEAL");
    expect(sealHint(false)).toBe(SWIPE_HINT);
    expect(sealHint(true)).toBe(TAP_HINT);
  });
});

describe("the round screen's line per sealed call (design 2026-09-22 §9.2)", () => {
  it("prints the side and the estimate, and the double", () => {
    expect(crowdCallLine({ answer: true, line: 0.38, doubled: false })).toBe("YES · THE ORACLE EXPECTED 38% YES");
    expect(crowdCallLine({ answer: false, line: 0.38, doubled: true })).toBe("NO · THE ORACLE EXPECTED 38% YES · DOUBLED");
  });
  it("says only whose side it is when no line was committed", () => {
    expect(crowdCallLine({ answer: true, line: null, doubled: false })).toBe("YOU: YES");
  });
});

describe("the card's text on a hot take (design 2026-09-25 §7)", () => {
  it("expects a share to agree", () => {
    expect(lineLabel(0.38, true)).toBe("THE ORACLE EXPECTED 38% TO AGREE");
    expect(lineLabel(null, true)).toBeNull();
  });
  it("writes the receipt in agree and disagree", () => {
    expect(receiptLine({ answer: true, line: 0.38, room: true })).toBe("AGREE · THE ORACLE EXPECTED 38% TO AGREE");
    expect(receiptLine({ answer: false, line: 0.38, doubled: true, room: true })).toBe("DISAGREE · THE ORACLE EXPECTED 38% TO AGREE · DOUBLED");
    expect(receiptLine({ answer: false, line: null, room: true })).toBe("DISAGREE");
    expect(crowdCallLine({ answer: true, line: null, doubled: false, room: true })).toBe("YOU: AGREE");
  });
  it("teaches the swipe in the same length as the market hint, so it still fits one line", () => {
    expect(SWIPE_HINT_ROOM).toBe("RIGHT TO AGREE, LEFT TO DISAGREE");
    expect(SWIPE_HINT_ROOM.length).toBeLessThanOrEqual(SWIPE_HINT.length);
    expect(sealHint(false, true)).toBe(SWIPE_HINT_ROOM);
    expect(sealHint(true, true)).toBe(TAP_HINT);
  });
});
