import { describe, it, expect } from "vitest";
import { scoreValue } from "../src/game/scoreProgress";

describe("scoreValue", () => {
  it("counts the road to fifty until the score is written", () => {
    expect(scoreValue(null, 0)).toBe("UNWRITTEN · 0 OF 50 QUALIFYING CALLS");
    expect(scoreValue(null, 37)).toBe("UNWRITTEN · 37 OF 50 QUALIFYING CALLS");
    expect(scoreValue(812, 60)).toBe("812");
  });
});
