// Retrospective eval for the resolver — the highest-stakes call in the
// system, and the one gate critic.eval.ts and taste.eval.ts's approach
// cannot reach (design 2026-09-08 §8.2, task 14).
//
// askResolver's web_search runs server-side at Anthropic. That page-in-time
// cannot be recorded and replayed the way a hermetic gate can — critic and
// taste both run with `models.critic`/`models.taste` (no search), so a
// fixture is a faithful record of what they judge. The resolver has no such
// fixture. What it DOES have is production history nobody reads:
// questions.resolutionEvidence already stores both resolver verdicts on
// every question the pipeline settles (resolve.ts:evidenceOf).
//
// Two numbers, read two different ways:
//   1. disagreement rate      — free. A query over evidence already written.
//   2. re-resolution agreement — costs money. Re-runs askResolver against a
//      sample of settled questions and compares to the recorded outcome.
//      Takes --sample N, default 10.
//
// CAVEAT, PRINTED EVERY RUN: a settled question's source may have moved on
// since it settled — updated, retracted, paywalled. Number 2 measures
// agreement WITH THE RECORD, not with the truth as of the round. The record
// is the only ground truth this eval has, but it was read at a different
// time than resolution read it, by definition.
//
// Run with: ANTHROPIC_API_KEY=... DATABASE_URL=... npx tsx eval/resolver.eval.ts [--sample N]
import { and, gte, lte } from "drizzle-orm";
import { PIPELINE_LINES } from "@oracle/core";
import { schema, makeDb, type Db } from "../src/db/client";
import { etNow, addDays } from "../src/pipeline/clock";
import { QUALITY_WINDOW_DAYS } from "../src/pipeline/quality";
import { askResolver, settled } from "../src/pipeline/resolver";
import { makeClaudeClient } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";

const DEFAULT_SAMPLE = 10;

function sampleFlag(argv: string[]): number {
  const i = argv.indexOf("--sample");
  if (i === -1) return DEFAULT_SAMPLE;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`resolver eval: --sample must be a positive number, got ${argv[i + 1]}`);
  }
  return n;
}

interface WindowRow {
  text: string;
  resolutionCriteria: string;
  sourceName: string;
  sourceUrl: string | null;
  status: string;
  outcome: "yes" | "no" | "void" | null;
  resolutionEvidence: unknown;
}

async function loadWindow(db: Db, since: string, until: string): Promise<WindowRow[]> {
  const rows = await db.query.questions.findMany({
    where: and(gte(schema.questions.roundDate, since), lte(schema.questions.roundDate, until)),
  });
  return rows.map((q) => ({
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
    status: q.status,
    outcome: q.outcome,
    resolutionEvidence: q.resolutionEvidence,
  }));
}

// Two shapes carry the same fact, and BOTH must be checked. A question that
// RESOLVED always has disagreement: false baked in — resolveWithClaude only
// ever calls resolveQuestion when both readers already agree (resolve.ts) —
// so the literal boolean never survives on a resolved row. A question that
// was VOIDED for disagreement has the flag translated into text instead:
// voidQuestions reads it once, then overwrites resolutionEvidence entirely
// with a reason string, PIPELINE_LINES.voidDisagreement when it was struck
// (actions.ts). Checking only `.disagreement === true` would report 0%
// forever, on every pipeline that has ever run.
function disagreed(evidence: unknown): boolean {
  if (evidence === null || typeof evidence !== "object") return false;
  const ev = evidence as { disagreement?: unknown; reason?: unknown };
  return ev.disagreement === true || ev.reason === PIPELINE_LINES.voidDisagreement;
}

function reportDisagreement(rows: WindowRow[], since: string, until: string): void {
  const settledRows = rows.filter((r) => r.status === "resolved" || r.status === "void");
  console.log(`disagreement rate — free, read from evidence already stored (window ${since}..${until})`);
  if (settledRows.length === 0) {
    console.log("  no settled questions in this window");
    return;
  }
  const flagged = settledRows.filter((r) => disagreed(r.resolutionEvidence)).length;
  console.log(`  settled       ${settledRows.length}`);
  console.log(`  disagreement  ${flagged}  (${Math.round((100 * flagged) / settledRows.length)}%)`);
}

function sample<T>(xs: T[], n: number): T[] {
  const pool = [...xs];
  const picked: T[] = [];
  while (picked.length < n && pool.length > 0) {
    const i = Math.floor(Math.random() * pool.length);
    const [chosen] = pool.splice(i, 1);
    if (chosen !== undefined) picked.push(chosen);
  }
  return picked;
}

async function reportReResolution(deps: PipelineDeps, rows: WindowRow[], sampleSize: number): Promise<void> {
  // Only questions with an unambiguous recorded verdict to compare against.
  // A VOIDED question has no resolver outcome of its own — only the
  // pipeline's "we gave up" state — so there is nothing here for a
  // re-resolution to agree or disagree WITH.
  const resolvedRows = rows.filter(
    (r): r is WindowRow & { outcome: "yes" | "no" } => r.status === "resolved" && (r.outcome === "yes" || r.outcome === "no"),
  );
  const picked = sample(resolvedRows, sampleSize);

  console.log(`re-resolution agreement — costs money, sampled ${picked.length} of ${resolvedRows.length} resolved questions`);
  if (picked.length === 0) {
    console.log("  no resolved questions available to sample");
    return;
  }

  let agree = 0;
  let disagree = 0;
  let unverifiable = 0;
  for (const row of picked) {
    const verdict = await askResolver(deps, deps.models.resolve, {
      text: row.text,
      resolutionCriteria: row.resolutionCriteria,
      sourceName: row.sourceName,
      sourceUrl: row.sourceUrl,
    });
    const outcome = settled(verdict);
    if (outcome === null) unverifiable += 1;
    else if (outcome === row.outcome) agree += 1;
    else disagree += 1;
  }

  console.log(`  agree         ${agree}`);
  console.log(`  disagree      ${disagree}   ← re-read differently than the record`);
  console.log(`  unverifiable  ${unverifiable}   ← source no longer shows a definitive answer`);
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("resolver eval: ANTHROPIC_API_KEY is not set");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("resolver eval: DATABASE_URL is not set");

  const sampleSize = sampleFlag(process.argv);
  const db = makeDb(databaseUrl);

  const until = etNow(new Date()).date;
  const since = addDays(until, -(QUALITY_WINDOW_DAYS - 1));
  const rows = await loadWindow(db, since, until);

  const deps: PipelineDeps = {
    db,
    telegram: { send: async () => {} },
    claude: makeClaudeClient(apiKey),
    models: {
      author: "unused",
      resolve: process.env.PIPELINE_RESOLVE_MODEL ?? "claude-sonnet-5",
      resolveB: "unused",
      forecast: "unused",
      critic: "unused",
      preflight: "unused",
      probe: "unused",
      taste: "unused",
    },
    now: () => new Date(),
    workflows: inlineStarter(),
  };

  console.log("RESOLVER — retrospective eval (design 2026-09-08 §8.2)");
  console.log("");
  console.log("CAVEAT: a settled question's source may have changed since it settled.");
  console.log("This measures agreement WITH THE RECORD, not with the truth as of the round.");
  console.log("");

  reportDisagreement(rows, since, until);
  console.log("");
  await reportReResolution(deps, rows, sampleSize);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
