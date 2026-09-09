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
import { and, eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";
import { askResolver, settled, type ResolverVerdict } from "./resolver";
import { BudgetExhausted } from "./spend";
import { claimResolutionPushes } from "../push/compose";
import { sendPushes } from "../push/onesignal";

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
    // point the disagreement is gone unless it was recorded.
    //
    // Guarded on `locked` for the same reason the success path below is: these
    // calls take minutes and now run inside a Workflow that outlives its tick,
    // so a void or a resolution can land while they are in flight. Without the
    // guard this write lands ON TOP of that judgement's evidence and erases
    // its receipt — the void's reason, or the resolved question's quote.
    await deps.db
      .update(schema.questions)
      .set({ resolutionEvidence: evidenceOf(deps, a, b, sa !== null && sb !== null && sa !== sb) })
      .where(and(eq(schema.questions.id, questionId), eq(schema.questions.status, "locked")));
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

export interface ResolveOutcome {
  questionId: string;
  resolved: boolean;
  error?: string;
  /** Resolution pushes composed on this pass (design 2026-09-09 §2.1). */
  pushed?: number;
  /** How many of `pushed` actually went out vs. were skipped (no reachable
   *  device, or OneSignal unconfigured) — set only when a push was attempted. */
  sent?: number;
  skipped?: number;
  pushError?: string;
}

/**
 * One question, resolved or not, as a VALUE rather than an effect.
 *
 * This is the unit a Workflow step drives (design 2026-09-08 §3.2). It throws
 * only BudgetExhausted — a day-level stop that must reach the entrypoint's
 * mapper and become a NonRetryableError. Every other failure is captured into
 * the outcome, because one failing read must never stall the others and a step
 * that returns a summary is one a later step can narrate.
 */
export async function resolveOne(deps: PipelineDeps, questionId: string): Promise<ResolveOutcome> {
  let resolved = false;
  let error: string | undefined;
  try {
    resolved = await resolveWithClaude(deps, questionId);
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    error = err instanceof Error ? err.message : String(err);
  }
  // The trickle (design 2026-09-09 §2.1). State-based and run after EVERY
  // attempt — including one that just threw above — not only a successful
  // one: an attempt whose write landed but whose step then failed (or never
  // checkpointed) returns resolved=false (or throws) on replay, and its
  // players still deserve their push. The claim inside makes this safe to
  // run on every pass regardless of how resolveWithClaude finished.
  let pushed = 0;
  let sent: number | undefined;
  let skipped: number | undefined;
  let pushError: string | undefined;
  try {
    const pushes = await claimResolutionPushes(deps.db, questionId, deps.now());
    pushed = pushes.length;
    if (pushed > 0) {
      const result = await sendPushes(deps.push ?? {}, pushes);
      sent = result.sent;
      skipped = result.skipped;
    }
  } catch (err) {
    pushError = err instanceof Error ? err.message : String(err);
  }
  return {
    questionId,
    resolved,
    pushed,
    ...(error ? { error } : {}),
    ...(sent !== undefined ? { sent } : {}),
    ...(skipped !== undefined ? { skipped } : {}),
    ...(pushError ? { pushError } : {}),
  };
}

/**
 * Terminal narration (design 2026-09-08 §5.2). Its own step, so that a retry
 * of an EARLIER step can never re-send it — which is what today's in-loop
 * sends do.
 */
export async function narrateResolution(
  deps: PipelineDeps,
  date: string,
  outcomes: ResolveOutcome[],
): Promise<void> {
  const failed = outcomes.filter((o) => o.error);
  if (failed.length > 0) {
    await deps.telegram.send(
      `⚠ resolve failed (${date}): ${failed.map((f) => `${f.questionId}: ${f.error}`).join(" · ")}`,
    );
  }
  // The trickle's own summary (audit finding B): resolveOne discarded
  // sendPushes's sent/skipped, so this channel reported failures but never a
  // single success. Same shape as settle()'s hinge-push line in
  // pipeline/actions.ts, and equally silent when nothing was composed.
  if (outcomes.some((o) => (o.pushed ?? 0) > 0)) {
    const sent = outcomes.reduce((sum, o) => sum + (o.sent ?? 0), 0);
    const skipped = outcomes.reduce((sum, o) => sum + (o.skipped ?? 0), 0);
    const composed = outcomes.reduce((sum, o) => sum + (o.pushed ?? 0), 0);
    await deps.telegram.send(`push: ${sent} sent, ${skipped} skipped (${composed} composed)`);
  }
  const pushFailed = outcomes.filter((o) => o.pushError);
  if (pushFailed.length > 0) {
    await deps.telegram.send(
      `⚠ resolution push failed (${date}): ${pushFailed.map((f) => `${f.questionId}: ${f.pushError}`).join(" · ")}`,
    );
  }
}

/**
 * The INLINE path — `wrangler dev`, tests, and any deployment without Workflow
 * bindings. Identical work, same order, in-process. The Workflow drives
 * resolveOne per step instead; both share the unit, which is why the two paths
 * cannot drift.
 */
export async function runResolution(
  deps: PipelineDeps,
  date: string,
  questionIds: string[],
): Promise<ResolveOutcome[]> {
  const outcomes: ResolveOutcome[] = [];
  for (const questionId of questionIds) {
    outcomes.push(await resolveOne(deps, questionId));
  }
  await narrateResolution(deps, date, outcomes);
  return outcomes;
}
