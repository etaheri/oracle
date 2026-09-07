import { describe, expect, it } from "vitest";
import { practiceResult } from "../src/game/practiceResult";

describe("fictional practice result", () => {
  it("keeps the home win fixed for both prediction sides", () => {
    expect(practiceResult({ answer: true, confidence: 75 })).toMatchObject({ correct: true, points: 38 });
    expect(practiceResult({ answer: false, confidence: 75 })).toMatchObject({ correct: false, points: -62 });
  });
  it("shows the increased reward and risk of confidence using live scoring", () => {
    expect(practiceResult({ answer: true, confidence: 55 })).toMatchObject({ points: 10, oppositePoints: -10 });
    expect(practiceResult({ answer: true, confidence: 95 })).toMatchObject({ points: 50, oppositePoints: -130 });
    expect(practiceResult({ answer: false, confidence: 95 })).toMatchObject({ points: -130, oppositePoints: 50 });
  });
});
