// Hermetic eval for Tier 4 — taste, the only fail-closed gate in the
// gauntlet (design 2026-09-08 §8.1, task 13).
//
// This is the one gate where a false PASS is a brand and App Review
// incident, not a night that ran one candidate short — which is exactly why
// this runner, unlike critic.eval.ts, exits non-zero the moment falsePass
// is anything but 0. Scored hermetically because tasteCheck runs with
// `models.taste` (Haiku 4.5, no search — taste.ts): classification of text
// already in hand, never a live lookup.
//
// Run with: ANTHROPIC_API_KEY=... npx tsx eval/taste.eval.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tasteCheck } from "../src/pipeline/gauntlet/taste";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import { makeClaudeClient } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { Candidate } from "../src/pipeline/candidate";
import type { Db } from "../src/db/client";
import { score, formatConfusion } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TasteFixture { text: string; expected: "pass" | "reject" }

function loadFixtures(): TasteFixture[] {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/taste.json"), "utf8")) as TasteFixture[];
}

// tasteCheck reads only j.candidate.text (taste.ts's prompt block). Every
// other field is fixed filler so this compiles against the real Judged/
// Candidate shapes without pretending to exercise the gates upstream of it.
function toJudged(f: TasteFixture, i: number): Judged {
  const candidate: Candidate = {
    category: "news",
    text: f.text,
    resolution_criteria: "per the fixture",
    source_name: "eval-fixture",
    source_url: "https://example.com/fixture",
    author_probability: 0.5,
    market_prob: null,
    resolves_at: "2026-12-31T23:59:00Z",
    topic_key: `eval-taste-${i}`,
  };
  return { candidate, criticProbability: 0.5 };
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("taste eval: ANTHROPIC_API_KEY is not set");

  const fixtures = loadFixtures();
  const judged = fixtures.map(toJudged);

  const deps: PipelineDeps = {
    db: null as unknown as Db, // tasteCheck() never touches the database
    telegram: { send: async () => {} },
    claude: makeClaudeClient(apiKey),
    models: {
      author: "unused",
      resolve: "unused",
      resolveB: "unused",
      forecast: "unused",
      critic: "unused",
      preflight: "unused",
      probe: "unused",
      taste: process.env.PIPELINE_TASTE_MODEL ?? "claude-haiku-4-5-20251001",
    },
    now: () => new Date(),
    workflows: inlineStarter(),
  };

  // ONE call over the whole batch — tasteCheck() is a batch gate, and its
  // fail-closed behavior (an error rejects the WHOLE batch, taste.ts) only
  // means anything measured against a real batch, not one candidate at a
  // time.
  const result = await tasteCheck(deps, judged);
  const passedTexts = new Set(result.passed.map((j) => j.candidate.text));

  const cases = fixtures.map((f) => ({
    expected: f.expected,
    actual: (passedTexts.has(f.text) ? "pass" : "reject") as "pass" | "reject",
  }));

  const confusion = score(cases);
  console.log(formatConfusion("taste", confusion));

  // THE ERROR THIS GATE EXISTS TO PREVENT. A false pass here means a
  // tasteless question reached the rest of the pipeline undetected — that is
  // a failed eval run regardless of how everything else scored.
  if (confusion.falsePass > 0) {
    console.error(`taste eval: ${confusion.falsePass} false-pass(es) — a tasteless question the gate should have refused was allowed through`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
