import { describe, it, expect } from "vitest";
import { standingLine } from "../src/game/standing";

describe("standingLine", () => {
  it("says nothing before a standing exists", () => {
    expect(standingLine(null, 0)).toBeNull();
    expect(standingLine(null, 4)).toBeNull();
  });

  it("names the share of records standing below", () => {
    expect(standingLine(94, 312)).toBe("SHARPER THAN 94% OF 312 SEALED RECORDS");
  });

  it("does not boast at the bottom of the cohort", () => {
    // 0% below is a true statement and a cruel headline. Say the cohort
    // instead; the score itself is already on the plaque above.
    expect(standingLine(0, 40)).toBe("ONE OF 40 SEALED RECORDS");
  });
});

import { vigilStat } from "../src/game/standing";

describe("vigilStat", () => {
  it("is a plain count while the vigil carries no weight", () => {
    expect(vigilStat(0)).toBe("0 DAYS");
    expect(vigilStat(1)).toBe("1 DAY");
  });

  it("names the weight the vigil has earned", () => {
    expect(vigilStat(3)).toBe("3 DAYS · ×1.15");
    expect(vigilStat(10)).toBe("10 DAYS · ×1.5");
  });

  it("holds at the ceiling", () => {
    expect(vigilStat(40)).toBe("40 DAYS · ×1.5");
  });
});
