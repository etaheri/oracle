import { expect, it } from "vitest";
import { assessEditorial } from "../src/pipeline/editorial";
import type { PipelineDeps } from "../src/pipeline";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import { selectRound } from "../src/pipeline/gauntlet/select";
const candidate: Judged = { criticProbability: .5, candidate: { category: "sports", text: "Will the visiting team win?", resolution_criteria: "Official final score, including overtime", source_name: "League", source_url: "https://example.com/score", author_probability: .5, market_prob: null, resolves_at: "after-lock", topic_key: "visiting-team" } };
const verdict = { index: 0, understandability: 2, reasonability: 2, interest: 2, opener: true, bigOne: false, context: null, contextVerified: false };
const run = (assessments: unknown[]) => assessEditorial({ now: () => new Date("2026-09-05T12:00:00Z"), models: { critic: "test" }, claude: { structured: async () => ({ assessments }) } } as unknown as PipelineDeps, [candidate], new Date("2026-09-05T16:00:00Z"));
it("fails closed for missing, duplicate, malformed and zero-score editorial verdicts", async () => {
  for (const rows of [[], [verdict, verdict], [{ ...verdict, index: 1 }], [{ ...verdict, interest: 0 }], [{ ...verdict, interest: 3 }]]) expect(await run(rows)).toEqual([]);
});
it("only carries independently verified context that already existed before review and publication", async () => {
  const context = { text: "The final score includes overtime.", sourceUrl: "https://example.com/rules", asOf: "2026-09-04T12:00:00Z" };
  expect((await run([{ ...verdict, context, contextVerified: true }]))[0]!.candidate.context).toEqual(context);
  for (const row of [{ ...verdict, context }, { ...verdict, contextVerified: true, context: { ...context, asOf: "2026-09-05T13:00:00Z" } }]) expect((await run([row]))[0]!.candidate.context).toBeUndefined();
});
it("chooses an accessible opener and nominated Big One ahead of mere contestedness", () => {
  const candidates = (["markets", "sports", "weather", "culture", "news"] as const).map((category, index) => ({ ...candidate, candidate: { ...candidate.candidate, category, text: `Question number ${index}`, resolves_at: "2026-09-06T17:00:00Z" }, criticProbability: index === 0 ? .5 : .6, editorial: { understandability: 2, reasonability: 2, interest: 2, opener: index === 2, bigOne: index === 4 } }));
  const result = selectRound(candidates)!;
  expect(result.draft.questions[0]!.text).toBe("Question number 2");
  expect(result.draft.questions[4]!.text).toBe("Question number 4");
});
