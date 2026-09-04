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

export async function probeQuestion(deps: PipelineDeps, questionId: string): Promise<boolean> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`probe: question not found: ${questionId}`);
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
  return updated.length > 0;
}

export async function runProbe(deps: PipelineDeps, date: string, questionIds: string[]): Promise<number> {
  let healed = 0;
  for (const questionId of questionIds) {
    try {
      if (await probeQuestion(deps, questionId)) {
        healed += 1;
        const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
        await deps.telegram.send(`⚠ ${date} slot ${q?.slot}: the answer exists, so the question closed early — "${q?.text}"`);
      }
    } catch (err) {
      await deps.telegram.send(`⚠ probe failed (${date}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return healed;
}
