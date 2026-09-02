import { describe, it, expect } from "vitest";
import { CONSTANTS } from "@oracle/core";
import { crowdVerdict, GATHERING_LINE, UNCOUNTED_TIDE } from "../src/game/crowdVerdict";

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
    // sidePct < 40 is the contrarianApplies condition — 40 itself is not contrarian.
    expect(crowdVerdict(true, 40, 50).against).toBe(false);
    expect(crowdVerdict(false, 60, 50).against).toBe(false);
    expect(crowdVerdict(false, 61, 50).against).toBe(true);
  });
  it("holds its tongue under five players", () => {
    expect(crowdVerdict(true, 0, 1)).toEqual({ line: GATHERING_LINE, against: false });
    expect(crowdVerdict(true, 25, 4)).toEqual({ line: GATHERING_LINE, against: false });
  });

  // The honesty rule: "AGAINST THE TIDE" is the phrase the plaque stat, the
  // epithet and the reveal's gold moment all use. It may only be said when
  // the bounty will actually pay — the distinction used to live in the text
  // colour alone, which the brief forbids.
  it("never says AGAINST THE TIDE unless the bounty will pay", () => {
    for (let n = 0; n <= 40; n++) {
      for (const pct of [0, 10, 25, 39, 40, 50, 61, 75, 100]) {
        for (const answer of [true, false]) {
          const v = crowdVerdict(answer, pct, n);
          if (v.line.includes("AGAINST THE TIDE")) expect(v.against, `n=${n} pct=${pct}`).toBe(true);
          if (v.against) expect(v.line, `n=${n} pct=${pct}`).toContain("AGAINST THE TIDE");
        }
      }
    }
  });
  it("still names the minority side between the two floors, without promising a bounty", () => {
    expect(crowdVerdict(true, 30, 5)).toEqual({ line: `30% SAY YES · ${UNCOUNTED_TIDE}`, against: false });
    expect(crowdVerdict(true, 30, CONSTANTS.CONTRARIAN_MIN_CROWD - 1)).toEqual({
      line: `30% SAY YES · ${UNCOUNTED_TIDE}`,
      against: false,
    });
    expect(crowdVerdict(true, 30, CONSTANTS.CONTRARIAN_MIN_CROWD)).toEqual({
      line: "30% SAY YES · AGAINST THE TIDE",
      against: true,
    });
  });
  it("tracks the engine's thresholds rather than its own copy of them", () => {
    // The band edges are derived from CONTRARIAN_CROWD_PCT; if it is tuned,
    // these move with it instead of the line silently lying.
    const edge = CONSTANTS.CONTRARIAN_CROWD_PCT;
    expect(crowdVerdict(true, edge - 1, 50).line).toContain("AGAINST THE TIDE");
    expect(crowdVerdict(true, edge, 50).line).toContain("THE CROWD SPLITS");
    expect(crowdVerdict(true, 100 - edge - 1, 50).line).toContain("THE CROWD SPLITS");
    expect(crowdVerdict(true, 100 - edge, 50).line).toContain("WITH THE TIDE");
  });
});
