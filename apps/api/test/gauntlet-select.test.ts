import { describe, expect, it } from "vitest";
import { selectRound } from "../src/pipeline/gauntlet/select";
import { DraftSchema } from "../src/pipeline/draft";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";

const j = (category: Candidate["category"], p: number, n: number): Judged => ({
  candidate: {
    category, text: `Will thing ${n} happen?`, resolution_criteria: "per the page",
    source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
    market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: `topic-${n}`,
  },
  criticProbability: p,
});

const five = [j("markets", 0.62, 1), j("sports", 0.40, 2), j("weather", 0.58, 3), j("culture", 0.35, 4), j("news", 0.50, 5)];

describe("selectRound", () => {
  it("produces a draft that DraftSchema accepts", () => {
    const s = selectRound(five)!;
    expect(DraftSchema.safeParse(s.draft).success).toBe(true);
  });

  it("fills slots 1..5 with exactly one big one, at slot 5", () => {
    const s = selectRound(five)!;
    expect(s.draft.questions.map((q) => q.slot).sort()).toEqual([1, 2, 3, 4, 5]);
    const big = s.draft.questions.filter((q) => q.is_big_one);
    expect(big).toHaveLength(1);
    expect(big[0]!.slot).toBe(5);
  });

  it("gives slot 5 to the MOST contested survivor", () => {
    const s = selectRound(five)!;
    // 0.50 is nearest 0.5, so "Will thing 5 happen?" is the big one.
    expect(s.draft.questions.find((q) => q.slot === 5)!.text).toContain("thing 5");
  });

  it("carries topic_key through onto the draft, so the dedupe has something to read next week", () => {
    const s = selectRound(five)!;
    expect(s.draft.questions.every((q) => typeof q.topic_key === "string" && q.topic_key!.length > 0)).toBe(true);
  });

  it("runs unrelaxed when four distinct categories are available", () => {
    const s = selectRound(five)!;
    expect(s.relaxed).toBe(false);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("prefers spread over contest when both are possible", () => {
    // Six survivors, three of them markets. The three most contested are ALL
    // markets, so a naive top-five would produce three categories; the greedy
    // one-per-category pass must reach four.
    const pool = [
      j("markets", 0.50, 1), j("markets", 0.51, 2), j("markets", 0.52, 3),
      j("sports", 0.30, 4), j("news", 0.70, 5), j("culture", 0.72, 6),
    ];
    const s = selectRound(pool)!;
    expect(s.relaxed).toBe(false);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("relaxes to three distinct categories rather than dropping the round", () => {
    const pool = [j("markets", 0.50, 1), j("markets", 0.52, 2), j("markets", 0.55, 3), j("sports", 0.45, 4), j("news", 0.60, 5)];
    const s = selectRound(pool)!;
    expect(s.relaxed).toBe(true);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBe(3);
    expect(DraftSchema.safeParse(s.draft).success).toBe(false); // four distinct is DraftSchema's rule
  });

  it("returns null below five survivors — no round is better than a bad one", () => {
    expect(selectRound(five.slice(0, 4))).toBeNull();
    expect(selectRound([])).toBeNull();
  });

  it("returns null when even three distinct categories are impossible", () => {
    const pool = [j("markets", 0.50, 1), j("markets", 0.51, 2), j("markets", 0.52, 3), j("sports", 0.45, 4), j("sports", 0.46, 5)];
    expect(selectRound(pool)).toBeNull();
  });

  it("is pure — the same input twice gives the same round", () => {
    expect(JSON.stringify(selectRound(five))).toBe(JSON.stringify(selectRound(five)));
  });
});
