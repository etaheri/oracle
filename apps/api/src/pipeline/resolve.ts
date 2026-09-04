// Hermes resolution (spec §6): verify-or-void. Claude is handed the
// question's promised source (its hostname, if it parses, restricts the
// web_search tool it gets) and must answer strictly from that source, with
// quoted evidence. No quotes → no resolution, even on a yes/no answer — a
// ruling without receipts is treated the same as "unverifiable": left for
// the next tick to retry hourly, and eventually voided by the pipeline
// (actions.ts:voidQuestions) at noon ET two days after the round date — i.e.
// unverifiable within 24 hours of lock — if it never produces one.
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";
import { askResolver, settled } from "./resolver";

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);

  const verdict = await askResolver(deps, deps.models.resolve, {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  });
  const outcome = settled(verdict);
  if (outcome === null) return false;

  // The Claude call above can take minutes across chained web searches, and
  // cron ticks can overlap: another tick may have voided this question (or
  // otherwise moved it off "locked") while this call was in flight. Re-check
  // right before writing so a late resolve never clobbers a void.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;

  await resolveQuestion(deps.db, questionId, outcome, {
    outcome,
    quotes: verdict.quotes,
    reasoning: verdict.reasoning,
    checked_at: deps.now().toISOString(),
    model: deps.models.resolve,
  });
  return true;
}
