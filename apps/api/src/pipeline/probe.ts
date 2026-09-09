import { PIPELINE_LINES } from "@oracle/core";
import { resolveQuestion } from "../resolution";
// In-window lock healing (design 2026-09-04 §5).
//
// resolves_at is a claim about the FUTURE, made the night before. The gauntlet's
// pre-flight verified it was true at authoring time; nothing verified it stays
// true. This probe is what makes draft.ts's stated invariant — "the lock always
// moves to the information" — enforced rather than asserted.
//
// locks_at := min(locks_at, now). A PROBE NEVER MOVES A LOCK LATER. Math.min is
// the whole rule, and an early-locked question stays early-locked.
//
// lock_healed_at IS WRITTEN ONLY HERE. An authored early lock and a healed one
// both produce locks_at < noon, and only the second is the machine catching a
// leak in real time — which is why the round screen can say so.
import { and, eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { askResolver, settled } from "./resolver";
import { BudgetExhausted } from "./spend";

export async function probeQuestion(deps: PipelineDeps, questionId: string): Promise<boolean> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`probe: question not found: ${questionId}`);
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate) });
  const voidHealed = async () => resolveQuestion(deps.db, questionId, "void", { reason: PIPELINE_LINES.answerLeaked }, { force: true });
  // Repair a crash after the lock write but before all prediction scores were cleared.
  if ((round?.rulesVersion ?? 1) >= 2 && q.lockHealedAt) { await voidHealed(); return false; }
  if (q.status !== "open") return false;

  const verdict = await askResolver(deps, deps.models.probe, {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  });
  if (settled(verdict) === null) return false;

  const now = deps.now();
  const healed = new Date(Math.min(q.locksAt.getTime(), now.getTime()));
  // Already at or before now: the lock has nothing left to learn, and stamping
  // lock_healed_at would claim a heal that did not happen.
  if (healed.getTime() >= q.locksAt.getTime()) return false;

  const updated = await deps.db
    .update(schema.questions)
    .set({ locksAt: healed, lockHealedAt: now })
    // Guarded on `open`: the probe call takes minutes, and a tick that locked
    // the round while it was in flight must not have its lock rewritten.
    .where(and(eq(schema.questions.id, questionId), eq(schema.questions.status, "open")))
    .returning({ id: schema.questions.id });
  // The guard above can block the write entirely, and a probe that healed
  // nothing must not be counted or narrated as one — the row count is the only
  // thing that knows which happened.
  if (updated.length > 0 && (round?.rulesVersion ?? 1) >= 2) await voidHealed();
  return updated.length > 0;
}

export interface ProbeOutcome {
  questionId: string;
  healed: boolean;
  slot?: number;
  text?: string;
  error?: string;
}

/**
 * One probe, as a VALUE (design 2026-09-08 §3.3). Carries the slot and text so
 * the terminal narrator needs no second read — today's in-loop send re-queries
 * the question purely to build its message.
 *
 * Throws only BudgetExhausted, exactly as resolveOne does.
 */
export async function probeOne(deps: PipelineDeps, questionId: string): Promise<ProbeOutcome> {
  try {
    const healed = await probeQuestion(deps, questionId);
    if (!healed) return { questionId, healed: false };
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
    return { questionId, healed: true, slot: q?.slot, text: q?.text };
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return { questionId, healed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Terminal narration (design 2026-09-08 §5.2). Its own step, so that a retry
 * of an EARLIER step can never re-send it — which is what today's in-loop
 * sends do.
 *
 * Heal messages stay one-per-healed-question, unlike resolve's batched
 * failures: each heal is its own event worth its own line, not a summary.
 */
export async function narrateProbe(
  deps: PipelineDeps,
  date: string,
  outcomes: ProbeOutcome[],
): Promise<void> {
  for (const o of outcomes.filter((x) => x.healed)) {
    await deps.telegram.send(
      `⚠ ${date} slot ${o.slot}: the answer exists, so the question closed early — "${o.text}"`,
    );
  }
  const failed = outcomes.filter((o) => o.error);
  if (failed.length > 0) {
    await deps.telegram.send(
      `⚠ probe failed (${date}): ${failed.map((f) => `${f.questionId}: ${f.error}`).join(" · ")}`,
    );
  }
}

/**
 * The INLINE path — `wrangler dev`, tests, and any deployment without Workflow
 * bindings. Identical work, same order, in-process. The Workflow drives
 * probeOne per step instead; both share the unit, which is why the two paths
 * cannot drift.
 */
export async function runProbe(
  deps: PipelineDeps,
  date: string,
  questionIds: string[],
): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  for (const questionId of questionIds) {
    outcomes.push(await probeOne(deps, questionId));
  }
  await narrateProbe(deps, date, outcomes);
  return outcomes;
}
