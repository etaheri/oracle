import { desc, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "./db/client";

// The purse (design §4.4, §7): every settled round's delta since founding, and
// the newest of them. Read as aggregates -- the row set grows by one a day
// forever and /today is the hottest route we serve.
export async function houseSummary(db: Db): Promise<{ total: number; last_delta: number | null }> {
  const [[houseTotal], [houseLast]] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${schema.rounds.houseDelta}), 0)` }).from(schema.rounds).where(isNotNull(schema.rounds.houseDelta)),
    db.select({ delta: schema.rounds.houseDelta }).from(schema.rounds).where(isNotNull(schema.rounds.houseDelta)).orderBy(desc(schema.rounds.date)).limit(1),
  ]);
  return { total: Number(houseTotal?.total ?? 0), last_delta: houseLast?.delta ?? null };
}
