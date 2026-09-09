import { describe, it, expect } from "vitest";
import { CONSTANTS, type Reveal, provenanceLine, PIPELINE_LINES } from "@oracle/core";
import { rowState, rowMark, rowRight, receiptLine, callLine, movementLine, crowdReadable, ledgerLines, pendingLine, lapsedLine, readingLine, pointsWithheld, weightLine } from "../src/game/revealRows";
import { VERDICT_MIN_PLAYERS } from "../src/game/crowdVerdict";

type Question = Reveal["questions"][number];

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slot: 1,
    text: "Will it happen?",
    outcome: "yes",
    crowd_yes_pct: 60,
    crowd_count: 40,
    market_prob: 0.55,
    my: { answer: true, confidence: 75, points: 12, brier: 0.1, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null },
    source_name: "reuters",
    source_url: "https://example.com",
    evidence_quote: "It happened, per officials.",
    void_reason: null,
    oracle_p_yes: 0.7,
    ...overrides,
  };
}

function reveal({ vigil_mult, outcomes, first_hour = false }: { vigil_mult: number | null; outcomes: Array<"yes" | "no" | null>; first_hour?: boolean }): Reveal {
  return {
    date: "2026-08-20",
    rules_version: 1, bonus_points: 0, day_points: 120,
    first_hour,
    candidates_written: 0,
    candidates_rejected: 0,
    vigil_mult,
    questions: outcomes.map((outcome, i) => question({ slot: i + 1, outcome })),
    ledger: { settled: true, streak: 3, calls_rated: 12, oracle_score: null },
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
      expect(rowState(question({ outcome: "void", my: { answer: true, confidence: 60, points: 0, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("void");
    });
    it("win when points positive", () => {
      expect(rowState(question({ my: { answer: true, confidence: 60, points: 8, brier: 0.2, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("win");
    });
    it("loss otherwise (zero or negative points)", () => {
      expect(rowState(question({ my: { answer: true, confidence: 60, points: 0, brier: 0.2, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("loss");
      expect(rowState(question({ my: { answer: true, confidence: 60, points: -4, brier: 0.2, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("loss");
      expect(rowState(question({ my: { answer: true, confidence: 60, points: null, brier: 0.2, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("loss");
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
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: 12, brier: 0.1, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("+12");
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: 0, brier: 0.1, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("0");
      expect(rowRight(question({ my: { answer: true, confidence: 60, points: -6, brier: 0.1, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("−6");
    });
    it("shows an em dash for void and pending", () => {
      expect(rowRight(question({ outcome: "void", my: { answer: true, confidence: 60, points: 0, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } }))).toBe("—");
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
            my: { answer: true, confidence: 60, points: 0, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null },
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
      // Was "0 OF 50 CALLS WRITTEN": a progress bar toward an unnamed thing,
      // on a screen about ONE day of five questions — so fifty read as the
      // same scale. The pair now names what does not exist yet, counts toward
      // it, and states the rate that makes fifty mean ten days.
      expect(ledgerLines({ settled: true, streak: 4, calls_rated: 0, oracle_score: null })).toEqual([
        "STREAK: 4 DAYS",
        "YOUR FORECAST RATING UNWRITTEN",
        "0 OF 50 RATED CALLS · FIVE A DAY",
      ]);
    });
    it("settled with streak reset to zero", () => {
      expect(ledgerLines({ settled: true, streak: 0, calls_rated: 12, oracle_score: null })).toEqual([
        "A NEW STREAK CAN BEGIN. YOUR RECORD REMAINS",
        "YOUR FORECAST RATING UNWRITTEN",
        "12 OF 50 RATED CALLS · FIVE A DAY",
      ]);
    });
    it("counts to the engine's own threshold, not a private copy of it", () => {
      expect(ledgerLines({ settled: true, streak: 1, calls_rated: 3, oracle_score: null }).join(" "))
        .toContain(`OF ${CONSTANTS.ORACLE_SCORE_MIN_CALLS} RATED CALLS`);
      // The lifetime count never appears without the daily rate beside it.
      expect(ledgerLines({ settled: true, streak: 1, calls_rated: 3, oracle_score: null }).join(" "))
        .toContain("FIVE A DAY");
    });
    it("settled once the oracle score exists", () => {
      expect(ledgerLines({ settled: true, streak: 6, calls_rated: 50, oracle_score: 73 })).toEqual([
        "STREAK: 6 DAYS",
        "YOUR FORECAST RATING 73",
      ]);
    });
    it("not settled — a single holding line", () => {
      expect(ledgerLines({ settled: false, streak: 6, calls_rated: 50, oracle_score: 73 })).toEqual([
        "YOUR STREAK UPDATES WHEN THE ROUND SETTLES",
      ]);
    });
  });

  describe("pendingLine", () => {
    it("a past date still unread: patience line", () => {
      expect(pendingLine("2026-08-20", "2026-08-21")).toBe("OUTCOMES ARE STILL BEING VERIFIED.");
    });
    it("today or a future date: return-at-noon line", () => {
      expect(pendingLine("2026-08-21", "2026-08-21")).toBe("RESULTS FOLLOW VERIFICATION AFTER QUESTIONS CLOSE.");
      expect(pendingLine("2026-08-22", "2026-08-21")).toBe("RESULTS FOLLOW VERIFICATION AFTER QUESTIONS CLOSE.");
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

describe("the reveal reads the player's own call back (audit 2026-09-02 §3.1)", () => {
  describe("callLine", () => {
    it("prints the call and the crowd when the crowd was big enough to read", () => {
      expect(callLine(question({ my: { answer: true, confidence: 75, points: 12, brier: 0.1, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null }, crowd_yes_pct: 62, crowd_count: 40 })))
        .toBe("YOU: YES @ 75% · CROWD 62% YES");
      expect(callLine(question({ my: { answer: false, confidence: 55, points: -10, brier: 0.3, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null }, crowd_yes_pct: 62, crowd_count: 40 })))
        .toBe("YOU: NO @ 55% · CROWD 62% YES");
    });
    it("drops the crowd clause rather than reading a crowd of three", () => {
      expect(callLine(question({ crowd_yes_pct: 100, crowd_count: 1 }))).toBe("YOU: YES @ 75%");
      expect(callLine(question({ crowd_yes_pct: 50, crowd_count: 4 }))).toBe("YOU: YES @ 75%");
      expect(callLine(question({ crowd_yes_pct: 50, crowd_count: 5 }))).toBe("YOU: YES @ 75% · CROWD 50% YES");
    });
    it("drops the crowd clause on a row the crowd was never counted for", () => {
      expect(callLine(question({ outcome: null, crowd_yes_pct: null, crowd_count: null }))).toBe("YOU: YES @ 75%");
    });
    it("gives a row the player never answered the crowd, which is what they missed", () => {
      expect(callLine(question({ my: null, crowd_yes_pct: 62, crowd_count: 40 }))).toBe("CROWD 62% YES");
    });
    it("says nothing at all when there is neither a call nor a readable crowd", () => {
      expect(callLine(question({ my: null, crowd_yes_pct: 100, crowd_count: 1 }))).toBeNull();
      expect(callLine(question({ my: null, crowd_yes_pct: null, crowd_count: null }))).toBeNull();
    });
    it("still reads back a call the ledger refused to score", () => {
      expect(callLine(question({ outcome: "void", my: { answer: true, confidence: 90, points: 0, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null } })))
        .toBe("YOU: YES @ 90% · CROWD 60% YES");
    });
  });

  describe("crowdReadable", () => {
    it("holds the same floor the round footer and the finale hold", () => {
      expect(crowdReadable(question({ crowd_count: 4 }))).toBe(false);
      expect(crowdReadable(question({ crowd_count: 5 }))).toBe(true);
      expect(crowdReadable(question({ crowd_count: null }))).toBe(false);
      expect(crowdReadable(question({ crowd_yes_pct: null, crowd_count: 40 }))).toBe(false);
    });
  });

  describe("movementLine (design 2026-09-09 §4.1)", () => {
    it("reads the tide's move in the past tense once the question is settled", () => {
      expect(
        movementLine(
          question({
            outcome: "yes",
            crowd_yes_pct: 60,
            crowd_count: 40,
            my: { answer: true, confidence: 75, points: 12, brier: 0.1, crowd_yes_pct_at_seal: 40, crowd_count_at_seal: 12 },
          }),
        ),
      ).toBe("WHEN YOU SEALED 40% SAID YES · IT ENDED AT 60%");
    });
    it("says nothing when the crowd at seal was under the display floor", () => {
      expect(
        movementLine(
          question({
            outcome: "yes",
            crowd_yes_pct: 60,
            crowd_count: 40,
            my: {
              answer: true,
              confidence: 75,
              points: 12,
              brier: 0.1,
              crowd_yes_pct_at_seal: 40,
              crowd_count_at_seal: VERDICT_MIN_PLAYERS - 1,
            },
          }),
        ),
      ).toBeNull();
    });
    it("says nothing without a seal snapshot", () => {
      expect(movementLine(question({ outcome: "yes", crowd_yes_pct: 60, crowd_count: 40 }))).toBeNull();
    });
  });
});

describe("readingLine (audit 2026-09-02 §3.2)", () => {
  const day = (outcomes: Array<"yes" | null>) =>
    outcomes.map((o, i) => question({ slot: i + 1, outcome: o }));

  it("counts the rows that have actually been read, in the app's own numerals", () => {
    expect(readingLine(day(["yes", "yes", null, null, null]))).toBe("II OF V READ");
    expect(readingLine(day([null, null, null, null, null]))).toBe("NONE OF V READ");
    expect(readingLine(day(["yes", "yes", "yes", "yes", "yes"]))).toBe("V OF V READ");
  });
});

describe("pointsWithheld", () => {
  it("withholds while any row is unread", () => {
    const d = reveal({ vigil_mult: 1.2, outcomes: ["yes", null] });
    expect(pointsWithheld(d)).toBe(true);
  });

  it("withholds a fully-read day that has not been weighed yet", () => {
    // Every row resolved but settlement has not stamped the vigil. Printing
    // the raw total here is the provisional-number bug in a new costume.
    const d = reveal({ vigil_mult: null, outcomes: ["yes", "no"] });
    expect(pointsWithheld(d)).toBe(true);
  });

  it("releases the number once the day is both read and weighed", () => {
    const d = reveal({ vigil_mult: 1.0, outcomes: ["yes", "no"] });
    expect(pointsWithheld(d)).toBe(false);
  });
});

describe("weightLine", () => {
  it("says nothing when nothing weighed the day", () => {
    expect(weightLine(reveal({ vigil_mult: 1, outcomes: ["yes"] }))).toBeNull();
    expect(weightLine(reveal({ vigil_mult: null, outcomes: ["yes"] }))).toBeNull();
  });

  it("names the vigil's weight alone", () => {
    expect(weightLine(reveal({ vigil_mult: 1.35, outcomes: ["yes"] }))).toBe("WEIGHED: VIGIL ×1.35");
  });

  it("trims a trailing zero rather than printing 1.50", () => {
    expect(weightLine(reveal({ vigil_mult: 1.5, outcomes: ["yes"] }))).toBe("WEIGHED: VIGIL ×1.5");
  });

  it("names the first hour alone", () => {
    expect(weightLine(reveal({ vigil_mult: 1, first_hour: true, outcomes: ["yes"] }))).toBe("WEIGHED: FIRST HOUR ×1.1");
  });

  it("carries both weights on ONE line, first hour first", () => {
    // Two stacked sentences is what pushed the headline block to seven centred
    // lines under the number; these are facts, so they take the terse register.
    expect(weightLine(reveal({ vigil_mult: 1.15, first_hour: true, outcomes: ["yes"] })))
      .toBe("WEIGHED: FIRST HOUR ×1.1 · VIGIL ×1.15");
  });

  it("reads the first hour's rate off the constant", () => {
    const line = weightLine(reveal({ vigil_mult: 1, first_hour: true, outcomes: ["yes"] }))!;
    expect(line).toContain(String(Number((1 + CONSTANTS.FIRST_HOUR_BONUS).toFixed(2))));
  });
});

describe("the machine's own lines on the player's screens", () => {
  it("says what the night cost when a gauntlet ran", () => {
    expect(provenanceLine(15, 10)).toBe("15 WRITTEN · 10 PUT DOWN");
  });

  it("says nothing at all for a bank drop", () => {
    expect(provenanceLine(0, 0)).toBeNull();
  });

  it("keeps the healed-lock line in the machine's register", () => {
    expect(PIPELINE_LINES.lockHealed).toBe(PIPELINE_LINES.lockHealed.toUpperCase());
    expect(PIPELINE_LINES.lockHealed).not.toContain("!");
  });
});
