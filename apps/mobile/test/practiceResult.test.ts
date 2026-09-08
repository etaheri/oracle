import { describe, expect, it } from "vitest";
import type { Exhibition } from "@oracle/core";
import { practiceResult } from "../src/game/practiceResult";

const exhibition: Exhibition = {
  id: "fixed-example",
  kind: "fictional",
  question: "Will blue be drawn?",
  context: "Seven blue and three amber marbles.",
  sourceName: "Fictional example",
  roundDate: null,
  oraclePYes: 0.7,
  outcome: "yes",
};

describe("exhibition practice result", () => {
  it("keeps the outcome and Oracle forecast fixed for either player answer", () => {
    expect(practiceResult({ answer: true, confidence: 75 }, exhibition)).toMatchObject({ correct: true, youPoints: 38, oraclePoints: 32 });
    expect(practiceResult({ answer: false, confidence: 75 }, exhibition)).toMatchObject({ correct: false, youPoints: -62, oraclePoints: 32 });
  });

  it("shows increased reward and risk with the shared scoring formula", () => {
    expect(practiceResult({ answer: true, confidence: 55 }, exhibition)).toMatchObject({ youPoints: 10, oppositePoints: -10 });
    expect(practiceResult({ answer: true, confidence: 95 }, exhibition)).toMatchObject({ youPoints: 50, oppositePoints: -130 });
    expect(practiceResult({ answer: false, confidence: 95 }, exhibition)).toMatchObject({ youPoints: -130, oppositePoints: 50 });
  });

  it("describes the Oracle's neutral 0.5 forecast as an abstention", () => {
    expect(practiceResult({ answer: true, confidence: 55 }, { ...exhibition, oraclePYes: 0.5 })).toMatchObject({
      oracleAbstained: true,
      oracleAnswer: null,
      oracleConfidence: null,
    });
  });

  it("reports confidence in the Oracle's chosen side", () => {
    expect(practiceResult({ answer: false, confidence: 75 }, { ...exhibition, oraclePYes: 0.2 })).toMatchObject({
      oracleAnswer: false,
      oracleConfidence: 80,
    });
    expect(practiceResult({ answer: true, confidence: 75 }, { ...exhibition, oraclePYes: 0.8 })).toMatchObject({
      oracleAnswer: true,
      oracleConfidence: 80,
    });
  });

  it("keeps same-side confidence comparisons distinct from answer disagreement", () => {
    expect(practiceResult({ answer: true, confidence: 95 }, exhibition)).toMatchObject({ sameAnswer: true, winner: "you" });
    expect(practiceResult({ answer: false, confidence: 95 }, exhibition)).toMatchObject({ sameAnswer: false, winner: "oracle" });
  });
});

it("does not invent a confidence gap when the exhibition points tie", () => {
  const result = practiceResult({ answer: true, confidence: 70 }, exhibition);
  expect(result.winner).toBe("tie");
  expect(result.explanation).toBe("Equal points on this call.");
});

it("explains why confidence won or lost on the same answer", () => {
  expect(practiceResult({ answer: true, confidence: 55 }, exhibition).explanation).toContain("Oracle's higher confidence earned more");
  expect(practiceResult({ answer: true, confidence: 95 }, exhibition).explanation).toContain("Your higher confidence earned more");
  const missed = { ...exhibition, outcome: "no" as const };
  expect(practiceResult({ answer: true, confidence: 55 }, missed).explanation).toContain("Your lower confidence cost less");
  expect(practiceResult({ answer: true, confidence: 95 }, missed).explanation).toContain("Your higher confidence cost more");
});
