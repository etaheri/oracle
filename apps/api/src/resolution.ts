import { eq } from "drizzle-orm";
import { brier, questionPoints } from "@oracle/core";
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
export function evidenceSummary(evidence: unknown): { quote: string | null; reason: string | null } {
  if (!evidence || typeof evidence !== "object") return { quote: null, reason: null };
  const e = evidence as Record<string, unknown>;
  let quote: string | null = null;
  if (Array.isArray(e.quotes)) {
    const first = e.quotes.find((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).quote === "string") as { quote: string } | undefined;
    quote = first?.quote ?? null;
  }
  const reason = typeof e.reason === "string" ? e.reason : null;
  return { quote, reason };
}
