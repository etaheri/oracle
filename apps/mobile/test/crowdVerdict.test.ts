import { describe, it, expect } from "vitest";
import { crowdVerdict } from "../src/game/crowdVerdict";

describe("crowdVerdict", () => {
  it("reads WITH THE TIDE when the crowd clearly sides with the player", () => {
    expect(crowdVerdict(true, 62, 50)).toEqual({ line: "62% SAY YES · WITH THE TIDE", against: false });
    expect(crowdVerdict(false, 30, 50)).toEqual({ line: "30% SAY YES · WITH THE TIDE", against: false });
  });
  it("reads AGAINST THE TIDE below the contrarian line (my side < 40)", () => {
    expect(crowdVerdict(false, 62, 50)).toEqual({ line: "62% SAY YES · AGAINST THE TIDE", against: true });
    expect(crowdVerdict(true, 39, 50)).toEqual({ line: "39% SAY YES · AGAINST THE TIDE", against: true });
  });
  it("reads THE CROWD SPLITS in the contested middle (40..59 on my side)", () => {
    expect(crowdVerdict(true, 45, 50)).toEqual({ line: "45% SAY YES · THE CROWD SPLITS", against: false });
    expect(crowdVerdict(false, 55, 50)).toEqual({ line: "55% SAY YES · THE CROWD SPLITS", against: false });
    expect(crowdVerdict(true, 40, 50)).toEqual({ line: "40% SAY YES · THE CROWD SPLITS", against: false });
    expect(crowdVerdict(true, 59, 50)).toEqual({ line: "59% SAY YES · THE CROWD SPLITS", against: false });
  });
  it("agrees with the scoring engine's contrarian rule exactly at the boundary", () => {
    // sidePct < 40 is the CONTRARIAN_MULT condition — 40 itself is not contrarian.
    expect(crowdVerdict(true, 40, 50).against).toBe(false);
    expect(crowdVerdict(false, 60, 50).against).toBe(false);
    expect(crowdVerdict(false, 61, 50).against).toBe(true);
  });
  it("holds its tongue under five players", () => {
    expect(crowdVerdict(true, 0, 1)).toEqual({ line: "THE CROWD IS STILL GATHERING", against: false });
    expect(crowdVerdict(true, 25, 4)).toEqual({ line: "THE CROWD IS STILL GATHERING", against: false });
  });
  it("names the tide from five players but promises the bounty only from twenty", () => {
    expect(crowdVerdict(true, 30, 5)).toEqual({ line: "30% SAY YES · AGAINST THE TIDE", against: false });
    expect(crowdVerdict(true, 30, 20)).toEqual({ line: "30% SAY YES · AGAINST THE TIDE", against: true });
  });
});
