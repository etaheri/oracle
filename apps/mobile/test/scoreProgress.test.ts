import { describe, it, expect } from "vitest";
import { scoreValue } from "../src/game/scoreProgress";

describe("scoreValue", () => {
  it("counts the road to fifty until the score is written", () => {
    expect(scoreValue(null, 0)).toBe("UNWRITTEN · 0 OF 50");
    expect(scoreValue(null, 37)).toBe("UNWRITTEN · 37 OF 50");
    expect(scoreValue(812, 60)).toBe("812");
  });

  it("stays short enough to be a stat-row value, not a sentence", () => {
    // The plaque sets this opposite a label in a space-between row. At 36
    // characters it wrapped, the label wrapped with it, and the two second
    // lines landed side by side: "ORACLE / RATING" beside "UNWRITTEN · 0 OF
    // 50 / QUALIFYING CALLS" — one row reading as four fragments, on the
    // app's most shareable screen. What "qualifying" means is the job of the
    // gloss directly beneath the row, which says it in full.
    for (const rated of [0, 1, 37, 49]) {
      expect(scoreValue(null, rated).length, `${rated} rated`).toBeLessThanOrEqual(21);
    }
  });
});
