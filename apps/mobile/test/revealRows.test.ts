import { describe, it, expect } from "vitest";
import type { Reveal } from "@oracle/core";
import { rowState, rowMark, rowRight, receiptLine, ledgerLines, pendingLine, lapsedLine } from "../src/game/revealRows";

type Question = Reveal["questions"][number];

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slot: 1,
    text: "Will it happen?",
    outcome: "yes",
    crowd_yes_pct: 60,
    market_prob: 0.55,
    my: { answer: true, confidence: 75, points: 12, brier: 0.1 },
    source_name: "reuters",
    source_url: "https://example.com",
    evidence_quote: "It happened, per officials.",
    void_reason: null,
    oracle_p_yes: 0.7,
    ...overrides,
  };
}

describe("revealRows", () => {
  describe("rowState", () => {
    it("pending beats everything — outcome null wins even with my present or void reason set", () => {
      expect(rowState(question({ outcome: null }))).toBe("pending");
      expect(rowState(question({ outcome: null, my: null }))).toBe("pending");
      expect(rowState(question({ outcome: null, void_reason: "SOURCE UNAVAILABLE" }))).toBe("pending");
    });
    it("spectator when my is null and outcome is settled", () => {
      expect(rowState(question({ my: null, outcome: "yes" }))).toBe("spectator");
      expect(rowState(question({ my: null, outcome: "void" }))).toBe("spectator");
    });
    it("void when outcome is void and my is present", () => {
      expect(rowState(question({ outcome: "void", my: { answer: true, confidence: 60, points: 0, brier: null } }))).toBe("void");
    });
    it("win when points positive", () => {
      expect(rowState(question({ my: { answer: true, confidence: 60, points: 8, brier: 0.2 } }))).toBe("win");
    });
    it("loss otherwise (zero or negative points)", () => {
      expect(rowState(question({ my: { answer: true, confidence: 60, points: 0, brier: 0.2 } }))).toBe("loss");
      expect(rowState(question({ my: { answer: true, confidence: 60, points: -4, brier: 0.2 } }))).toBe("loss");
      expect(rowState(question({ my: { answer: true, confidence: 60, points: null, brier: 0.2 } }))).toBe("loss");
    });
  });

  describe("rowMark", () => {
    it("maps each state to its glyph", () => {
      expect(rowMark("win")).toBe("✓");
      expect(rowMark("loss")).toBe("✗");
      expect(rowMark("void")).toBe("∅");
      expect(rowMark("pending")).toBe("…");
      expect(rowMark("spectator")).toBe("·");
    });
  });

  describe("rowRight", () => {
    it("signs points for win/loss", () => {
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: 12, brier: 0.1 } }))).toBe("+12");
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: 0, brier: 0.1 } }))).toBe("0");
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: -6, brier: 0.1 } }))).toBe("−6");
    });
    it("shows an em dash for void and pending", () => {
      expect(rowRight(question({ outcome: "void", my: { answer: true, confidence: 60, points: 0, brier: null } }))).toBe("—");
      expect(rowRight(question({ outcome: null }))).toBe("—");
    });
    it("shows the outcome word for spectator rows, including YES", () => {
      expect(rowRight(question({ my: null, outcome: "yes" }))).toBe("YES");
      expect(rowRight(question({ my: null, outcome: "no" }))).toBe("NO");
      expect(rowRight(question({ my: null, outcome: "void" }))).toBe("VOID");
    });
  });

  describe("receiptLine", () => {
    it("void: VOID · uppercased reason", () => {
      expect(
        receiptLine(
          question({
            outcome: "void",
            void_reason: "source retracted the claim",
            my: { answer: true, confidence: 60, points: 0, brier: null },
          })
        )
      ).toBe("VOID · SOURCE RETRACTED THE CLAIM");
    });
    it("pending: PER {source} · NOT YET READ", () => {
      expect(receiptLine(question({ outcome: null, source_name: "reuters" }))).toBe("PER REUTERS · NOT YET READ");
    });
    it("settled: PER {source} plus quote when present", () => {
      expect(receiptLine(question({ source_name: "ap wire", evidence_quote: "Confirmed by three officials." }))).toBe(
        'PER AP WIRE · "Confirmed by three officials."'
      );
    });
    it("settled with no quote: PER {source} only", () => {
      expect(receiptLine(question({ source_name: "ap wire", evidence_quote: null }))).toBe("PER AP WIRE");
    });
    it("trims a quote longer than 90 chars with an ellipsis", () => {
      const longQuote = "x".repeat(120);
      const clipped = "x".repeat(89) + "…";
      expect(receiptLine(question({ source_name: "wire", evidence_quote: longQuote }))).toBe(
        `PER WIRE · "${clipped}"`
      );
    });
    it("leaves a quote of exactly 90 chars untouched", () => {
      const exact = "x".repeat(90);
      expect(receiptLine(question({ source_name: "wire", evidence_quote: exact }))).toBe(`PER WIRE · "${exact}"`);
    });
  });

  describe("ledgerLines", () => {
    it("settled with an active streak and no oracle score yet", () => {
      expect(ledgerLines({ settled: true, streak: 4, calls_rated: 0, oracle_score: null })).toEqual([
        "VIGIL: DAY 4",
        "0 OF 50 CALLS WRITTEN",
      ]);
    });
    it("settled with streak reset to zero", () => {
      expect(ledgerLines({ settled: true, streak: 0, calls_rated: 12, oracle_score: null })).toEqual([
        "THE VIGIL BEGINS AGAIN",
        "12 OF 50 CALLS WRITTEN",
      ]);
    });
    it("settled once the oracle score exists", () => {
      expect(ledgerLines({ settled: true, streak: 6, calls_rated: 50, oracle_score: 73 })).toEqual([
        "VIGIL: DAY 6",
        "ORACLE SCORE 73",
      ]);
    });
    it("not settled — a single holding line", () => {
      expect(ledgerLines({ settled: false, streak: 6, calls_rated: 50, oracle_score: 73 })).toEqual([
        "THE VIGIL IS COUNTED SHORTLY",
      ]);
    });
  });

  describe("pendingLine", () => {
    it("a past date still unread: patience line", () => {
      expect(pendingLine("2026-08-20", "2026-08-21")).toBe("THE LEDGER IS BEING READ. PATIENCE.");
    });
    it("today or a future date: return-at-noon line", () => {
      expect(pendingLine("2026-08-21", "2026-08-21")).toBe("RETURN AT NOON.");
      expect(pendingLine("2026-08-22", "2026-08-21")).toBe("RETURN AT NOON.");
    });
  });

  describe("lapsedLine", () => {
    it("returns an uppercase noon.lapsed line", () => {
      const l = lapsedLine("2026-08-28");
      expect(l).toBe(l.toUpperCase());
      expect(l.length).toBeGreaterThan(0);
    });
    it("is deterministic for the same seed", () => {
      expect(lapsedLine("2026-08-28")).toBe(lapsedLine("2026-08-28"));
    });
  });
});
