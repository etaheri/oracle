import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { ExhibitionSchema, QuestionContextSchema, type Exhibition } from "@oracle/core";
import { schema, type Db } from "./db/client";

export async function selectExhibition(db: Db): Promise<Exhibition | null> {
  const recentRounds = await db.query.rounds.findMany({
    columns: { date: true, oracleCommittedAt: true, oracleForecastSnapshot: true },
    where: eq(schema.rounds.status, "resolved"),
    orderBy: [desc(schema.rounds.date)],
    limit: 30,
  });
  const dates = recentRounds.map((round) => round.date);
  if (dates.length === 0) return null;

  const candidates = await db.query.questions.findMany({
    where: and(
      inArray(schema.questions.roundDate, dates),
      eq(schema.questions.status, "resolved"),
    ),
    orderBy: [desc(schema.questions.roundDate), asc(schema.questions.slot)],
  });
  const provenanceByDate = new Map(recentRounds.map((round) => [round.date, round]));

  for (const question of candidates) {
    const provenance = provenanceByDate.get(question.roundDate);
    if (!provenance?.oracleCommittedAt || !Array.isArray(provenance.oracleForecastSnapshot)) continue;
    if (provenance.oracleCommittedAt.getTime() > question.opensAt.getTime()) continue;
    if (question.lockHealedAt !== null || question.withdrawnAt !== null) continue;
    if (question.outcome !== "yes" && question.outcome !== "no") continue;
    if (typeof question.oracleProbYes !== "string" && typeof question.oracleProbYes !== "number") continue;
    const oraclePYes = Number(question.oracleProbYes);
    if (!Number.isFinite(oraclePYes) || oraclePYes < 0 || oraclePYes > 1) continue;
    const context = QuestionContextSchema.safeParse(question.context);
    if (!context.success || context.data.text.trim().length === 0) continue;
    if (new Date(context.data.asOf).getTime() > question.opensAt.getTime()) continue;
    if (question.text.trim().length === 0 || question.sourceName.trim().length === 0) continue;

    const projected = ExhibitionSchema.safeParse({
      id: question.id,
      kind: "historical",
      question: question.text,
      context: context.data.text,
      sourceName: question.sourceName,
      roundDate: question.roundDate,
      oraclePYes,
      outcome: question.outcome,
    });
    if (projected.success) return projected.data;
  }
  return null;
}
