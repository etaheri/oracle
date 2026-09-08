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
import type { ClaudeClient } from "../src/pipeline/claude";
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

// A thin recording wrapper, not a fake — every call still goes to the real
// Claude client. It exists only so this eval can check the RAW response's
// verdict count after criticize() has already digested it away (review
// round 1, important-2): criticize() never surfaces "the model returned
// fewer verdicts than candidates" as anything other than one more per-
// candidate rejection, indistinguishable from a genuine ambiguity call. A
// gate that silently short-counts is a real failure mode critic.ts itself
// guards against ("no verdict returned for this candidate") — this eval
// should not let that pass as a quiet, correctly-scored reject.
function recordingClaude(inner: ClaudeClient): { client: ClaudeClient; lastResponse: () => unknown } {
  let last: unknown;
  return {
    client: {
      async structured(call) {
        const res = await inner.structured(call);
        last = res;
        return res;
      },
    },
    lastResponse: () => last,
  };
}

function verdictCountOf(response: unknown): number | undefined {
  if (!response || typeof response !== "object") return undefined;
  const verdicts = (response as { verdicts?: unknown }).verdicts;
  return Array.isArray(verdicts) ? verdicts.length : undefined;
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("critic eval: ANTHROPIC_API_KEY is not set");

  const fixtures = loadFixtures();
  const candidates = fixtures.map(toCandidate);

  const { client: claude, lastResponse } = recordingClaude(makeClaudeClient(apiKey));

  const deps: PipelineDeps = {
    db: null as unknown as Db, // criticize() never touches the database
    telegram: { send: async () => {} },
    claude,
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

  // THE FIX FOR IMPORTANT-1 (review round 1): these fixtures are written to
  // probe critic.ts's ambiguity verdict — readable_two_ways,
  // criteria_determine_outcome, resolves_at_plausible — NOT the bundled
  // pass/reject outcome. The bundled outcome also folds in the §7 contested
  // band and the author/critic disagreement check, both scored against a
  // author_probability=0.5 filler this eval assigns to every candidate. An
  // unambiguous, uncontroversial fixture (a snow total, a closing price) can
  // fail THAT check for reasons that have nothing to do with ambiguity, which
  // would confound this eval's signal with a gate it isn't measuring.
  //
  // criticize()'s own branch order does the un-confounding for free: the
  // ambiguity block runs FIRST and is the only path that produces reason
  // "ambiguous" (readable_two_ways / !criteria_determine_outcome /
  // !resolves_at_plausible, or no verdict returned at all — critic.ts). Only
  // if ambiguity passes does the contested-band/disagreement check even run,
  // producing reason "uncontested". So "reason === ambiguous" is exactly the
  // ambiguity verdict rejecting the candidate; anything else — passed, or
  // rejected later as "uncontested" — is the ambiguity verdict passing it.
  const rejectionReasonByText = new Map(result.rejected.map((r) => [r.text, r.reason]));
  const cases = fixtures.map((f) => ({
    expected: f.expected,
    actual: (rejectionReasonByText.get(f.text) === "ambiguous" ? "reject" : "pass") as "pass" | "reject",
  }));

  const confusion = score(cases);
  console.log(formatConfusion("critic (ambiguity verdict)", confusion));

  // THE FIX FOR IMPORTANT-2 (review round 1): the old `cases.length !==
  // fixtures.length` check was dead — cases is built by fixtures.map(...),
  // so the lengths are equal by construction, always. The real failure mode
  // it was reaching for is the MODEL returning fewer verdicts than
  // candidates submitted, and that has to be checked against the RAW
  // response, not criticize()'s already-digested output (which silently
  // folds a missing verdict into an ordinary "ambiguous" rejection).
  const verdictCount = verdictCountOf(lastResponse());
  if (verdictCount !== undefined && verdictCount < candidates.length) {
    console.error(`critic eval: the critic returned ${verdictCount} verdicts for ${candidates.length} candidates — failing loudly instead of letting the shortfall score as ordinary rejections`);
    process.exit(1);
  }

  // The critic has no fail-closed contract the way taste does — a false pass
  // here means one ambiguous question slips a tier deeper, not that it ships
  // (taste and the rest of the gauntlet still run after it). So this eval
  // reports the asymmetry without gating the exit code on it.
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
