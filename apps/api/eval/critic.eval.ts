// Hermetic eval for Tier 2 — the critic (design 2026-09-08 §8.1, task 13).
//
// Scores criticize() against fixtures that describe questions, not markets:
// each one probes readable_two_ways, criteria_determine_outcome, or a
// compound clause the gate should catch even though screenCandidates()
// normally catches it first. This is the gate the author gets prosecuted by,
// scored the only way it CAN be scored hermetically — it runs with
// `models.critic` (Opus 5, no search — critic.ts), so nothing it reads
// depends on the live web the way the resolver and pre-flight do.
//
// Run with: ANTHROPIC_API_KEY=... npx tsx eval/critic.eval.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { criticize } from "../src/pipeline/gauntlet/critic";
import { makeClaudeClient } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { Candidate } from "../src/pipeline/candidate";
import type { Db } from "../src/db/client";
import { score, formatConfusion } from "./score";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CriticFixture { text: string; resolution_criteria: string; expected: "pass" | "reject" }

function loadFixtures(): CriticFixture[] {
  return JSON.parse(readFileSync(join(__dirname, "fixtures/critic.json"), "utf8")) as CriticFixture[];
}

// Every field criticize() does not itself read is filled with one fixed,
// unambiguous value. resolves_at_plausible and the author/critic contested
// band are not what these fixtures probe — the ambiguity flags critic.ts
// actually computes from text and resolution_criteria are.
function toCandidate(f: CriticFixture, i: number): Candidate {
  return {
    category: "news",
    text: f.text,
    resolution_criteria: f.resolution_criteria,
    source_name: "eval-fixture",
    source_url: "https://example.com/fixture",
    author_probability: 0.5,
    market_prob: null,
    resolves_at: "2026-12-31T23:59:00Z",
    topic_key: `eval-critic-${i}`,
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("critic eval: ANTHROPIC_API_KEY is not set");

  const fixtures = loadFixtures();
  const candidates = fixtures.map(toCandidate);

  const deps: PipelineDeps = {
    db: null as unknown as Db, // criticize() never touches the database
    telegram: { send: async () => {} },
    claude: makeClaudeClient(apiKey),
    models: {
      author: "unused",
      resolve: "unused",
      resolveB: "unused",
      forecast: "unused",
      critic: process.env.PIPELINE_CRITIC_MODEL ?? "claude-opus-5",
      preflight: "unused",
      probe: "unused",
      taste: "unused",
    },
    now: () => new Date(),
    workflows: inlineStarter(),
  };

  // ONE call over the whole batch — criticize() is a batch gate, and it is
  // only faithful to score it the way it is actually asked to judge: every
  // fixture together, exactly as a real gauntlet run would hand it a night's
  // surviving candidates.
  const result = await criticize(deps, candidates);
  const passedTexts = new Set(result.passed.map((c) => c.text));

  const cases = fixtures.map((f) => ({
    expected: f.expected,
    actual: (passedTexts.has(f.text) ? "pass" : "reject") as "pass" | "reject",
  }));

  const confusion = score(cases);
  console.log(formatConfusion("critic", confusion));

  // The critic has no fail-closed contract the way taste does — a false pass
  // here means one ambiguous question slips a tier deeper, not that it ships
  // (taste and the rest of the gauntlet still run after it). So this eval
  // reports the asymmetry without gating the exit code on it; only a run
  // that could not judge every fixture counts as a failure.
  if (cases.length !== fixtures.length) {
    console.error("critic eval: scored fewer cases than fixtures were loaded");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
