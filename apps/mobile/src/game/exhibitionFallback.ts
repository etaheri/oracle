import { ExhibitionSchema } from "@oracle/core";

export const EXHIBITION_FALLBACK = ExhibitionSchema.parse({
  id: "fictional-marble-v1",
  kind: "fictional",
  question: "Will the blue marble be drawn?",
  context: "This fictional bag contains 7 blue marbles and 3 amber marbles. One will be drawn.",
  sourceName: "Fictional example",
  roundDate: null,
  oraclePYes: 0.7,
  outcome: "yes",
});
