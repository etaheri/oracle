// Hermes resolution (design 2026-09-04 §6): verify TWICE, with two different
// models, or void.
//
// Why here and not more authoring: a bad QUESTION ships, it voids, everyone
// scores 0 on that slot — one diminished day. A bad RESOLUTION ships and every
// player's points, Brier, streak, epithet and Oracle Score are permanently
// wrong, while the liturgy says NOTHING REVISED. The second is strictly worse,
// permanent, and until now had LESS machinery than the first.
//
// TWO DIFFERENT MODELS, NOT THE SAME MODEL TWICE. Running one model twice
// correlates its errors: the second call fails the same way the first did, and
// agreement means nothing. Independent errors require independent models.
//
// DISAGREEMENT RESOLVES TO UNVERIFIABLE, NEVER TO A WINNER. The pipeline has no
// basis for preferring one reading, and unverifiable already has correct,
// tested behaviour: hourly retry, then void at the deadline. A void is an
// honest "we could not read this"; a coin-flip between two disagreeing readings
// is a lie with a number attached. resettleRound remains available if a human
// ever corrects one by hand.
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";
import { askResolver, settled, type ResolverVerdict } from "./resolver";

function evidenceOf(deps: PipelineDeps, a: ResolverVerdict, b: ResolverVerdict, disagreement: boolean) {
  return {
    disagreement,
    checked_at: deps.now().toISOString(),
    a: { model: deps.models.resolve, ...a },
    b: { model: deps.models.resolveB, ...b },
  };
}

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);

  const target = {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  };
  // In parallel: they are independent readings of the same page, and running
  // them in series would double the slowest step in the whole pipeline.
  const [a, b] = await Promise.all([
    askResolver(deps, deps.models.resolve, target),
    askResolver(deps, deps.models.resolveB, target),
  ]);
  const sa = settled(a);
  const sb = settled(b);

  if (sa === null || sb === null || sa !== sb) {
    // WRITTEN DOWN, not merely returned. Disagreement leaves the question
    // locked, so the void happens hours later inside voidQuestions — by which
    // point the disagreement is gone unless it was recorded. This also makes a
    // disputed outcome inspectable after the fact (§6.2).
    await deps.db
      .update(schema.questions)
      .set({ resolutionEvidence: evidenceOf(deps, a, b, sa !== null && sb !== null && sa !== sb) })
      .where(eq(schema.questions.id, questionId));
    return false;
  }

  // The calls above can take minutes across chained web searches, and cron
  // ticks can overlap: another tick may have voided this question (or otherwise
  // moved it off "locked") while they were in flight. Re-check right before
  // writing so a late resolve never clobbers a void.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;

  await resolveQuestion(deps.db, questionId, sa, {
    outcome: sa,
    quotes: [...a.quotes, ...b.quotes],
    reasoning: `${a.reasoning}\n\n${b.reasoning}`,
    ...evidenceOf(deps, a, b, false),
  });
  return true;
}

// Every question resolves independently: one failing read must never stall the
// others. This is the function the resolution Workflow's step calls.
export async function runResolution(deps: PipelineDeps, date: string, questionIds: string[]): Promise<void> {
  for (const questionId of questionIds) {
    try {
      await resolveWithClaude(deps, questionId);
    } catch (err) {
      await deps.telegram.send(`⚠ resolve failed (${date}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
