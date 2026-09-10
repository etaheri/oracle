// The house line (design 2026-09-10 §5.5): oracle_p_yes held inside the
// market band. Runs after the forecast commit and on every forecast tick
// until every question has one; a line is written once and never rewritten.
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { clampLine } from "@oracle/core";
import { schema, type Db } from "../db/client";

export async function commitLine(db: Db, date: string): Promise<{ written: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round || round.rulesVersion < 3 || round.oracleCommittedAt === null) return { written: 0 };
  const pending = await db.query.questions.findMany({
    where: and(eq(schema.questions.roundDate, date), isNull(schema.questions.linePYes), isNotNull(schema.questions.oracleProbYes)),
  });
  let written = 0;
  for (const q of pending) {
    const raw = clampLine(Number(q.oracleProbYes), q.marketProb === null ? null : Number(q.marketProb));
    // clampLine's band arithmetic (e.g. 0.35 − 0.15) can leave IEEE-754 noise
    // (0.19999999999999998); round to 6dp — far past any probability we'd
    // ever state — before it becomes a permanent (immutable) stored value.
    const line = Math.round(raw * 1e6) / 1e6;
    const rows = await db.update(schema.questions)
      .set({ linePYes: String(line) })
      .where(and(eq(schema.questions.id, q.id), isNull(schema.questions.linePYes)))
      .returning({ id: schema.questions.id });
    written += rows.length;
  }
  return { written };
}
