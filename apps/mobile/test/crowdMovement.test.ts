import { describe, expect, it } from "vitest";
import { crowdMovement, MOVEMENT_MIN_DELTA } from "../src/game/crowdMovement";
import { VERDICT_MIN_PLAYERS } from "../src/game/crowdVerdict";

describe("crowdMovement (design 2026-09-09 §4.1)", () => {
  it("prints the move once both snapshots clear the display floor and the tide moved", () => {
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, false)).toBe("WHEN YOU SEALED 40% SAID YES · NOW 55%");
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, true)).toBe("WHEN YOU SEALED 40% SAID YES · IT ENDED AT 55%");
  });
  it("says nothing under the display floor at either end", () => {
    expect(crowdMovement({ pct: 100, count: VERDICT_MIN_PLAYERS - 1 }, { pct: 55, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: VERDICT_MIN_PLAYERS - 1 }, false)).toBeNull();
  });
  it("says nothing for a move under the threshold", () => {
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 40 + MOVEMENT_MIN_DELTA - 1, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 40 + MOVEMENT_MIN_DELTA, count: 40 }, false)).not.toBeNull();
  });
  it("says nothing without a snapshot", () => {
    expect(crowdMovement(null, { pct: 55, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, undefined, true)).toBeNull();
  });
  it("holds the register", () => {
    const l = crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, true)!;
    expect(l).toBe(l.toUpperCase()); expect(l).not.toContain("!"); expect(l.length).toBeLessThanOrEqual(60);
  });
});
