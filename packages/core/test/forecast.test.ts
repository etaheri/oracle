import { describe, it, expect } from "vitest";
import { oracleForecast, extremize } from "../src/forecast";

describe("extremize", () => {
  it("pushes probabilities away from 0.5", () => {
    expect(extremize(0.7, 1.5)).toBeGreaterThan(0.7);
    expect(extremize(0.3, 1.5)).toBeLessThan(0.3);
    expect(extremize(0.5, 1.5)).toBeCloseTo(0.5, 10);
  });
});

describe("oracleForecast", () => {
  it("null with no predictions", () => {
    expect(oracleForecast([], 1000)).toBeNull();
  });
  it("cold start (< 500 rated): raw unweighted mean, no extremizing", () => {
    const preds = [
      { pYes: 0.6, oracleScore: 900 },
      { pYes: 0.8, oracleScore: null },
    ];
    expect(oracleForecast(preds, 499)).toBeCloseTo(0.7, 10);
  });
  it("warm: high-score players pull the aggregate toward their view", () => {
    const preds = [
      { pYes: 0.9, oracleScore: 900 }, // weight e^2.5 ≈ 12.18
      { pYes: 0.1, oracleScore: null }, // weight 1
    ];
    const p = oracleForecast(preds, 1000)!;
    // weighted mean ≈ (12.18×0.9 + 0.1)/13.18 ≈ 0.839, then extremized above that
    expect(p).toBeGreaterThan(0.84);
  });
  it("warm path extremizes: identical 0.7s land above 0.7", () => {
    const preds = Array(10).fill({ pYes: 0.7, oracleScore: null });
    expect(oracleForecast(preds, 1000)!).toBeGreaterThan(0.7);
  });
});
