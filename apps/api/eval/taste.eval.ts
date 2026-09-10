// Hermetic eval for taste, the only fail-closed gate in the pipeline
// (design 2026-09-08 §8.1, task 13).
//
// This is the one gate where a false PASS is a brand and App Review
// incident, not a night that ran one candidate short — which is exactly why
// this runner exits non-zero the moment falsePass is anything but 0. Scored
// hermetically because tasteTexts runs with `models.taste` (Haiku 4.5, no
// search — taste.ts): classification of text already in hand, never a live
// lookup.
//
// Run with: ANTHROPIC_API_KEY=... npx tsx eval/taste.eval.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tasteTexts } from "../src/pipeline/taste";
import { makeClaudeClient } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { Db } from "../src/db/client";
import { score, formatConfusion } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TasteFixture { text: string; expected: "pass" | "reject" }

function loadFixtures(): TasteFixture[] {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/taste.json"), "utf8")) as TasteFixture[];
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("taste eval: ANTHROPIC_API_KEY is not set");

  const fixtures = loadFixtures();

  const deps: PipelineDeps = {
    db: null as unknown as Db, // tasteTexts() never touches the database
    telegram: { send: async () => {} },
    claude: makeClaudeClient(apiKey),
    models: {
      author: "unused",
      resolve: "unused",
      resolveB: "unused",
      forecast: "unused",
      taste: process.env.PIPELINE_TASTE_MODEL ?? "claude-haiku-4-5-20251001",
      voice: "unused",
    },
    now: () => new Date(),
    workflows: inlineStarter(),
  };

  // ONE call over the whole batch — tasteTexts() is a batch gate, and its
  // fail-closed behavior (an error refuses the WHOLE batch, taste.ts) only
  // means anything measured against a real batch, not one candidate at a
  // time.
  const { allowed, detail } = await tasteTexts(deps, fixtures.map((f) => f.text));
  // A refused batch is an infrastructure failure, not a score of zero. Scoring
  // it would report every fixture as a correct reject and call that a pass.
  if (detail !== null) throw new Error(`taste eval: the gate refused the whole batch — ${detail}`);

  const cases = fixtures.map((f, i) => ({
    expected: f.expected,
    actual: (allowed[i] ? "pass" : "reject") as "pass" | "reject",
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
