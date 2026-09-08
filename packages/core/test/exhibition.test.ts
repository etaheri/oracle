import { describe, expect, it } from "vitest";
import { compareExhibition, ExhibitionSchema, oracleQuestionPoints, type Exhibition } from "../src";

const exhibition = (overrides: Partial<Exhibition> = {}): Exhibition => ({
  id: "sample",
  kind: "fictional",
  question: "Draw blue?",
  context: "7 blue, 3 amber",
  sourceName: "Fictional example",
  roundDate: null,
  oraclePYes: 0.7,
  outcome: "yes",
  ...overrides,
});

describe("ExhibitionSchema", () => {
  it("accepts probabilities at both valid boundaries and rejects empty public text", () => {
    expect(ExhibitionSchema.parse(exhibition({ oraclePYes: 0 })).oraclePYes).toBe(0);
    expect(ExhibitionSchema.parse(exhibition({ oraclePYes: 1 })).oraclePYes).toBe(1);
    expect(ExhibitionSchema.safeParse(exhibition({ context: "" })).success).toBe(false);
  });
});

describe("compareExhibition", () => {
  it("ties when the player and Oracle make the same call at the same confidence", () => {
    const result = compareExhibition({ answer: true, confidence: 70 }, exhibition());
    expect(result).toEqual({
      youPoints: oracleQuestionPoints({ pYes: 0.7, outcome: "yes", isBigOne: false }),
      oraclePoints: oracleQuestionPoints({ pYes: 0.7, outcome: "yes", isBigOne: false }),
      winner: "tie",
    });
  });

  it("awards a win when the player's probability scores higher", () => {
    const result = compareExhibition(
      { answer: true, confidence: 90 },
      exhibition({ oraclePYes: 0.6, outcome: "yes" }),
    );
    expect(result.winner).toBe("you");
  });

  it("awards a loss when the Oracle's probability scores higher", () => {
    const result = compareExhibition(
      { answer: false, confidence: 80 },
      exhibition({ oraclePYes: 0.8, outcome: "yes" }),
    );
    expect(result.winner).toBe("oracle");
  });

  it("scores a no outcome using each participant's yes probability", () => {
    const result = compareExhibition(
      { answer: false, confidence: 75 },
      exhibition({ oraclePYes: 0.4, outcome: "no" }),
    );
    expect(result.youPoints).toBe(oracleQuestionPoints({ pYes: 0.25, outcome: "no", isBigOne: false }));
    expect(result.oraclePoints).toBe(oracleQuestionPoints({ pYes: 0.4, outcome: "no", isBigOne: false }));
  });

  it("treats an Oracle probability of 0.5 as abstention scoring", () => {
    const result = compareExhibition(
      { answer: true, confidence: 55 },
      exhibition({ oraclePYes: 0.5, outcome: "yes" }),
    );
    expect(result.oraclePoints).toBe(0);
    expect(result.winner).toBe("you");
  });

  it("distinguishes confidence when both participants choose the same answer", () => {
    const result = compareExhibition(
      { answer: true, confidence: 80 },
      exhibition({ oraclePYes: 0.65, outcome: "no" }),
    );
    expect(result.youPoints).toBeLessThan(result.oraclePoints);
    expect(result.winner).toBe("oracle");
  });

  it("rejects confidence outside the shared input grid", () => {
    expect(() => compareExhibition({ answer: true, confidence: 72 }, exhibition())).toThrow();
  });
});
