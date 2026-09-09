import { and, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "./db/client";

export interface ReadingRound { date: string; settled: boolean; decided: number; total: number }

// The player's reading round (design 2026-09-09 §2.2, §3.1): the latest
// round that has locked or settled in which they hold at least one call.
// Home used to look at "the round date minus one", which a round settling
// two days later simply falls off. This is the one field home needs.
export async function readingRoundFor(db: Db, userId: string): Promise<ReadingRound | null> {
  const mine = await db.query.predictions.findMany({ where: eq(schema.predictions.userId, userId), columns: { questionId: true } });
  if (mine.length === 0) return null;
  const qs = await db.query.questions.findMany({
    where: inArray(schema.questions.id, mine.map((p) => p.questionId)),
    columns: { roundDate: true },
  });
  const dates = [...new Set(qs.map((q) => q.roundDate))];
  if (dates.length === 0) return null;
  const round = await db.query.rounds.findFirst({
    where: and(inArray(schema.rounds.date, dates), inArray(schema.rounds.status, ["locked", "resolved"])),
    orderBy: [desc(schema.rounds.date)],
  });
  if (!round) return null;
  const all = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date), columns: { outcome: true } });
  return {
    date: round.date,
    settled: round.status === "resolved",
    decided: all.filter((q) => q.outcome !== null).length,
    total: all.length,
  };
}
