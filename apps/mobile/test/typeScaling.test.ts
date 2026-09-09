import { describe, it, expect } from "vitest";
import { CHROME_CAP, cappedScale, scaledLines, scaledRow } from "../src/game/typeScaling";

describe("cappedScale", () => {
  it("never shrinks below 1 — chrome does not get smaller than designed", () => {
    expect(cappedScale(0.85)).toBe(1);
    expect(cappedScale(1)).toBe(1);
  });
  it("passes scale through below the cap", () => {
    expect(cappedScale(1.15)).toBeCloseTo(1.15);
  });
  it("clamps at the chrome cap", () => {
    expect(cappedScale(2.4)).toBe(CHROME_CAP);
    expect(cappedScale(3.5)).toBe(CHROME_CAP);
  });
  it("honours an explicit cap", () => {
    expect(cappedScale(2, 1.6)).toBe(1.6);
  });
  it("falls back to 1 on a nonsense scale rather than collapsing the layout", () => {
    expect(cappedScale(Number.NaN)).toBe(1);
    expect(cappedScale(0)).toBe(1);
    expect(cappedScale(Number.POSITIVE_INFINITY)).toBe(CHROME_CAP);
  });
});

describe("scaledRow", () => {
  it("grows a reserved row with the capped scale", () => {
    expect(scaledRow(16, 1.25)).toBe(20);
  });
  it("returns whole pixels — a reserved slot must not land on a subpixel", () => {
    expect(Number.isInteger(scaledRow(14, 1.15))).toBe(true);
  });
  it("leaves a row untouched at default scale", () => {
    expect(scaledRow(16, 1)).toBe(16);
  });
  it("stops growing past the cap", () => {
    expect(scaledRow(20, 3)).toBe(scaledRow(20, CHROME_CAP));
  });
});

describe("scaledLines", () => {
  // Question text scales freely (it is content, not chrome) but was clamped
  // by LINE COUNT — numberOfLines={3} on the reveal, {2} on the crowd finale.
  // Raising the OS text size therefore fits fewer words per line into the
  // same number of lines and truncated MORE of the question: the setting that
  // exists to make text readable was removing it.
  it("grows the line allowance with the text size, so the same words still fit", () => {
    expect(scaledLines(3, 1)).toBe(3);
    expect(scaledLines(3, 2)).toBe(6);
    expect(scaledLines(2, 1.5)).toBe(3);
  });

  it("never allows fewer lines than the design asked for", () => {
    // fontScale below 1 is a reader who shrank their text; the clamp is a
    // ceiling on truncation, not a floor on it.
    expect(scaledLines(3, 0.8)).toBe(3);
    expect(scaledLines(3, 0)).toBe(3);
  });

  it("survives a nonsense scale rather than clamping text to nothing", () => {
    expect(scaledLines(3, Number.NaN)).toBe(3);
  });
});
