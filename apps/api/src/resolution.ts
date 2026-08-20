import { eq } from "drizzle-orm";
import { brier, questionPoints } from "@oracle/core";
import { schema, type Db } from "./db/client";

export async function resolveQuestion(db: Db, questionId: string, outcome: "yes" | "no" | "void", evidence: unknown = null) {
  const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");

  const yesCount = preds.filter((p) => p.answer).length;
  const crowdYesPct = preds.length === 0 ? 50 : Math.round((100 * yesCount) / preds.length);

  await db.update(schema.questions)
    .set({ outcome, status: outcome === "void" ? "void" : "resolved", resolvedAt: new Date(), crowdYesPct: String(crowdYesPct), resolutionEvidence: evidence })
    .where(eq(schema.questions.id, questionId));

  for (const p of preds) {
    const points = questionPoints({ answer: p.answer, confidence: p.confidence, outcome, isBigOne: q.isBigOne, crowdYesPct });
    const b = outcome === "void" ? null : String(brier({ answer: p.answer, confidence: p.confidence, outcome }));
    await db.update(schema.predictions).set({ points, brier: b }).where(eq(schema.predictions.id, p.id));
  }
}
