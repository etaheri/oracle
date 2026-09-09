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

describe("selectRound composes a fast slate (design 2026-09-09 §1.2)", () => {
  const fastBy = new Date("2026-09-05T20:00:00Z");
  const at = (n: number, category: Candidate["category"], p: number, resolves_at: string): Judged => ({ ...j(category, p, n), candidate: { ...j(category, p, n).candidate, resolves_at } });

  it("with only fast candidates, behaves as before", () => {
    const s = selectRound(five, { fastBy })!;
    expect(s.draft.questions).toHaveLength(5);
  });
  it("takes at most one slow candidate and makes it the Big One", () => {
    const pool = [
      at(1, "markets", 0.55, "2026-09-05T18:00:00Z"),
      at(2, "sports", 0.45, "2026-09-05T19:00:00Z"),
      at(3, "culture", 0.60, "2026-09-05T19:30:00Z"),
      at(4, "news", 0.50, "2026-09-06T12:30:00Z"),   // slow, and the most contested
      at(5, "news", 0.52, "2026-09-06T13:00:00Z"),   // slow, second most contested — must NOT be chosen
      at(6, "weather", 0.40, "2026-09-05T18:30:00Z"),
    ];
    const s = selectRound(pool, { fastBy })!;
    const texts = s.draft.questions.map((q) => q.text);
    expect(texts).not.toContain("Will thing 5 happen?");
    const big = s.draft.questions.find((q) => q.is_big_one)!;
    expect(big.text).toBe("Will thing 4 happen?");
  });
  it("returns null when fewer than four fast candidates survive", () => {
    const pool = [
      at(1, "markets", 0.55, "2026-09-05T18:00:00Z"),
      at(2, "sports", 0.45, "2026-09-05T19:00:00Z"),
      at(3, "culture", 0.60, "2026-09-06T12:00:00Z"),
      at(4, "news", 0.50, "2026-09-06T12:30:00Z"),
      at(5, "weather", 0.52, "2026-09-06T13:00:00Z"),
    ];
    expect(selectRound(pool, { fastBy })).toBeNull();
  });

  it("the fill pass also enforces the one-slow limit, even when the second slow candidate sits in its own otherwise-unused category", () => {
    // Two slow candidates in DIFFERENT, otherwise-unused categories: weather
    // and culture each hold exactly one candidate, and it is slow. Without
    // the fill pass's `isSlow(j, w) && slowTaken` guard, the spread pass
    // takes the first slow one (weather, most contested) and skips the
    // second (culture) only because a category was already used by then —
    // but the fill pass would then pick culture right back up, since it was
    // never chosen and no category constraint applies there. A spare fast
    // candidate in an already-used category (markets, again) is what the
    // fill pass should choose instead.
    const pool = [
      at(1, "weather", 0.50, "2026-09-06T12:30:00Z"), // slow, most contested — becomes the Big One
      at(2, "culture", 0.52, "2026-09-06T13:00:00Z"), // slow, otherwise-unused category — must be excluded
      at(3, "markets", 0.55, "2026-09-05T18:00:00Z"), // fast
      at(4, "sports", 0.60, "2026-09-05T19:00:00Z"), // fast
      at(5, "news", 0.65, "2026-09-05T19:30:00Z"), // fast
      at(6, "markets", 0.70, "2026-09-05T18:30:00Z"), // fast, spare — fills the last slot in the fill pass
    ];
    const s = selectRound(pool, { fastBy })!;
    expect(s.draft.questions).toHaveLength(5);
    const texts = s.draft.questions.map((q) => q.text);
    expect(texts).not.toContain("Will thing 2 happen?");
    expect(texts).toContain("Will thing 6 happen?");
    const slowChosen = s.draft.questions.filter((q) => new Date(q.resolves_at).getTime() > fastBy.getTime());
    expect(slowChosen).toHaveLength(1);
    expect(slowChosen[0]!.is_big_one).toBe(true);
    expect(slowChosen[0]!.text).toBe("Will thing 1 happen?");
  });
});
