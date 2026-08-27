export const validDraft = {
  questions: [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    category: (["markets", "sports", "weather", "culture", "news"] as const)[slot - 1],
    text: `Will thing ${slot} happen tomorrow?`,
    resolution_criteria: `Official number per source, page X, by 11:00 ET`,
    source_name: "SRC",
    source_url: "https://example.com/x",
    author_probability: 0.5,
    is_big_one: slot === 5,
  })),
};
