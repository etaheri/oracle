import { RESOLVES_AFTER_LOCK } from "../../src/pipeline/draft";

export const validDraft = {
  questions: [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    // Slot 3 was weather. It cannot be any more: weather is forbidden from
    // "after-lock", and an absolute instant would pin this fixture to one
    // date — but 30+ existing tests upsert it at 2026-08-27/28/29 and
    // pipeline-tick puts it in the draft bank. Date-independence is the
    // fixture's job; weather gets built inline by the tests that need it.
    // Still 4 distinct categories: markets, sports, news, culture.
    category: (["markets", "sports", "news", "culture", "news"] as const)[slot - 1]!,
    text: `Will thing ${slot} happen tomorrow?`,
    resolution_criteria: `Official number per source, page X`,
    source_name: "SRC",
    source_url: "https://example.com/x",
    author_probability: 0.5,
    is_big_one: slot === 5,
    market_prob: null,
    resolves_at: RESOLVES_AFTER_LOCK,
  })),
};
