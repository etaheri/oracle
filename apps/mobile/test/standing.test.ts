import { describe, it, expect } from "vitest";
import { standingLine } from "../src/game/standing";

describe("standingLine", () => {
  it("says nothing before a standing exists", () => {
    expect(standingLine(null, 0)).toBeNull();
    expect(standingLine(null, 4)).toBeNull();
    expect(standingLine(null, 312)).toBeNull();
  });

  it("names a third, never a percentile", () => {
    expect(standingLine(94, 312)).toBe("THE UPPER THIRD OF 312 SEALED RECORDS");
    expect(standingLine(50, 312)).toBe("THE MIDDLE THIRD OF 312 SEALED RECORDS");
    expect(standingLine(7, 312)).toBe("THE LOWER THIRD OF 312 SEALED RECORDS");
  });

  it("holds at both inclusive edges of the lower band", () => {
    expect(standingLine(33, 90)).toBe("THE LOWER THIRD OF 90 SEALED RECORDS");
    expect(standingLine(34, 90)).toBe("THE MIDDLE THIRD OF 90 SEALED RECORDS");
  });

  it("holds at both inclusive edges of the upper band", () => {
    expect(standingLine(66, 90)).toBe("THE MIDDLE THIRD OF 90 SEALED RECORDS");
    expect(standingLine(67, 90)).toBe("THE UPPER THIRD OF 90 SEALED RECORDS");
  });

  it("holds at the ends of the scale", () => {
    // Zero below is no longer a special case. The lower third says the same
    // thing without singling the reader out, and without a point estimate.
    expect(standingLine(0, 40)).toBe("THE LOWER THIRD OF 40 SEALED RECORDS");
    expect(standingLine(100, 40)).toBe("THE UPPER THIRD OF 40 SEALED RECORDS");
  });

  it("renders the cohort size verbatim in every band", () => {
    for (const n of [50, 51, 240, 1337, 100000]) {
      for (const p of [0, 33, 34, 66, 67, 100]) {
        expect(standingLine(p, n)).toContain(` ${n} SEALED RECORDS`);
      }
    }
  });

  it("never claims a percentile it cannot support", () => {
    // The measurement behind this line carries +/-15 percentile points of
    // median error at the 50-call floor. A two-digit number on this row would
    // be the precision the data does not have.
    for (let p = 0; p <= 100; p++) {
      const line = standingLine(p, 240)!;
      expect(line).not.toMatch(/%/);
      expect(line.replace(" 240 SEALED RECORDS", "")).not.toMatch(/\d/);
    }
  });

  it("offers exactly three bands across the whole scale", () => {
    const bands = new Set<string>();
    for (let p = 0; p <= 100; p++) bands.add(standingLine(p, 240)!);
    expect(bands.size).toBe(3);
  });
});
