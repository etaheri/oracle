import { describe, it, expect } from "vitest";
import { ExhibitionSchema } from "@oracle/core";
import { practiceResult } from "../src/game/practiceResult";

const ex = ExhibitionSchema.parse({
  id: "x", kind: "fictional", question: "Will the blue marble be drawn?", context: "7 blue, 3 amber.",
  sourceName: "Fictional example", roundDate: null, oraclePYes: 0.7, outcome: "yes", linePYes: 0.7,
});

describe("practice on the practice fortune (design §8.3)", () => {
  it("prices a right call at the line and says who took whom", () => {
    const r = practiceResult({ answer: true }, ex);
    expect(r.stake).toBe(50);
    expect(r.wins).toBe(21);
    expect(r.delta).toBe(21);
    expect(r.receipt).toBe("YES · THE ORACLE EXPECTED 70% YES");
    expect(r.verdict).toBe("You took the Oracle for 21.");
    expect(r.counterfactual).toBe("Had it gone NO, the same call would have lost 50.");
    expect(r.oracleLine).toBe("THE ORACLE EXPECTED 70% YES");
  });
  it("loses the stake on a wrong call", () => {
    const r = practiceResult({ answer: false }, ex);
    expect(r.stake).toBe(50);
    expect(r.delta).toBe(-50);
    expect(r.verdict).toBe("The Oracle took 50.");
    expect(r.counterfactual).toBe("Had it gone NO, the same call would have won 117.");
  });
  it("derives a line when the fixture has none", () => {
    const r = practiceResult({ answer: true }, { ...ex, linePYes: null });
    expect(r.line).toBe(0.7);
  });

  it("reads the room's result on a past hot take, and the plain outcome otherwise", () => {
    expect(practiceResult({ answer: true }, ex).roomLine).toBe("Actual outcome: YES.");
    expect(practiceResult({ answer: true }, { ...ex, kind: "historical", roundDate: "2026-09-23", crowdYesPct: 62 }).roomLine).toBe("The room said YES, 62%.");
    expect(practiceResult({ answer: true }, { ...ex, outcome: "no", crowdYesPct: 31 }).roomLine).toBe("The room said NO, 69%.");
  });

  it("speaks a past hot take in agree and disagree (design 2026-09-25 §7)", () => {
    const take = { ...ex, kind: "historical" as const, roundDate: "2026-09-23", crowd: true, crowdYesPct: 62 };
    const r = practiceResult({ answer: true }, take);
    expect(r.receipt).toBe("AGREE · THE ORACLE EXPECTED 70% TO AGREE");
    expect(r.oracleLine).toBe("THE ORACLE EXPECTED 70% TO AGREE");
    expect(r.roomLine).toBe("The room agreed, 62%.");
    expect(r.counterfactual).toBe("Had the room disagreed, the same call would have lost 50.");
    expect(practiceResult({ answer: true }, { ...take, outcome: "no", crowdYesPct: 31 }).roomLine).toBe("The room disagreed, 69%.");
  });
});
