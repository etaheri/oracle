import { eq } from "drizzle-orm";
import { brier, questionPoints, PIPELINE_LINES } from "@oracle/core";
import { schema, type Db } from "./db/client";

// Statuses a fresh resolution may write over. `open` is allowed because the
// admin path (and every test) resolves seeded open rounds directly; the
// pipeline always locks first. Anything already judged needs `force`.
const FRESH = new Set(["open", "locked"]);
const JUDGED = new Set(["resolved", "void"]);

export async function resolveQuestion(
  db: Db,
  questionId: string,
  outcome: "yes" | "no" | "void",
  evidence: unknown = null,
  opts: { force?: boolean } = {},
): Promise<void> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate) });
  // A healed v2 lock is an immutable global void, including resolver retries.
  if ((round?.rulesVersion ?? 1) >= 2 && q.lockHealedAt) {
    outcome = "void";
    evidence = { reason: "THE ANSWER APPEARED EARLY. THIS QUESTION IS VOID FOR EVERYONE." };
    opts = { force: true };
  }
  const allowed = FRESH.has(q.status) || (opts.force === true && JUDGED.has(q.status));
  if (!allowed) throw new Error("not resolvable");

  const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  const yesCount = preds.filter((p) => p.answer).length;
  const crowdCount = preds.length;
  const crowdYesPct = crowdCount === 0 ? 50 : Math.round((100 * yesCount) / crowdCount);

  await db.update(schema.questions)
    .set({ outcome, status: outcome === "void" ? "void" : "resolved", resolvedAt: new Date(), crowdYesPct: String(crowdYesPct), crowdCount, resolutionEvidence: evidence })
    .where(eq(schema.questions.id, questionId));

  for (const p of preds) {
    const points = questionPoints({ answer: p.answer, confidence: p.confidence, outcome, isBigOne: q.isBigOne, crowdYesPct, crowdCount });
    const b = outcome === "void" ? null : String(brier({ answer: p.answer, confidence: p.confidence, outcome }));
    await db.update(schema.predictions).set({ points, brier: b }).where(eq(schema.predictions.id, p.id));
  }
}

// The reveal's receipt: one quote and/or one reason lifted from whatever
// shape the evidence JSON took (pipeline resolve, pipeline void, admin).
export function evidenceSummary(evidence: unknown): { quote: string | null; quoteUrl: string | null; reason: string | null } {
  const empty = { quote: null, quoteUrl: null, reason: null };
  if (!evidence || typeof evidence !== "object") return empty;
  const e = evidence as Record<string, unknown>;
  const reason = typeof e.reason === "string" ? e.reason : null;
  if (Array.isArray(e.quotes)) {
    for (const item of e.quotes) {
      if (!item || typeof item !== "object") continue;
      const { quote, url } = item as Record<string, unknown>;
      if (typeof quote !== "string" || !quote.trim() || typeof url !== "string") continue;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") {
          return { quote: quote.trim(), quoteUrl: parsed.href, reason };
        }
      } catch { /* A malformed source cannot support an excerpt. */ }
    }
  }
  return { ...empty, reason };
}

export type WithdrawalReason = "misauthored" | "unresolvable";

const WITHDRAWAL_LINE: Record<WithdrawalReason, string> = {
  misauthored: PIPELINE_LINES.withdrawnMisauthored,
  unresolvable: PIPELINE_LINES.withdrawnUnresolvable,
};

// Editorial withdrawal (design 2026-09-09 §1.4). The operator strikes a live
// question with a TRUE reason. The lock moves to now so no further seal can
// land, withdrawn_at marks it (distinct from lock_healed_at, which only the
// probe writes when an answer leaked), and the void goes through
// resolveQuestion so every prediction is zeroed exactly the way any other
// void is.
//
// Idempotent across a crash between the two writes, the same shape
// probeQuestion repairs (pipeline/probe.ts): withdrawn_at set but status
// still open/locked means the first write landed and the second (the void)
// did not. A retry must finish that void rather than sticking forever behind
// "already withdrawn" — the round can never settle otherwise, since
// settleRound requires every question resolved or void. Only a
// withdrawn_at + status:"void" pair is a genuine repeat.
export async function withdrawQuestion(db: Db, questionId: string, reason: WithdrawalReason, now: Date): Promise<{ remaining: number }> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");
  if (q.withdrawnAt && !FRESH.has(q.status)) throw new Error("already withdrawn");
  if (!q.withdrawnAt && !FRESH.has(q.status)) throw new Error("not withdrawable");

  // A crashed half-withdrawal already has withdrawn_at (and locks_at) set —
  // leave both alone and only finish the void below.
  if (!q.withdrawnAt) {
    await db.update(schema.questions)
      .set({ locksAt: q.locksAt.getTime() < now.getTime() ? q.locksAt : now, withdrawnAt: now })
      .where(eq(schema.questions.id, questionId));
  }
  await resolveQuestion(db, questionId, "void", { reason: WITHDRAWAL_LINE[reason], withdrawn: true, checked_at: now.toISOString() });

  const siblings = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, q.roundDate) });
  const remaining = siblings.filter((s) => s.id !== questionId && s.status !== "void" && !s.withdrawnAt).length;
  return { remaining };
}
