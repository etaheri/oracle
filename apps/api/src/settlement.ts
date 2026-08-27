import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { oracleScore, settleStreak } from "@oracle/core";
import { schema, type Db } from "./db/client";

// Round settlement (backend spec L73/L79/L119): streak + shield settlement for
// every affected user, complete-round scoring, then the round flips to
// "resolved" — which is also the idempotency guard. Called by the admin
// endpoint today and by Plan 4's DO lock alarm later.
// PLAN-4 NOTE: the audience is users-with-streak ∪ users-who-played; both
// queries are unbounded and per-user scoring is N queries — fine at current
// scale, revisit with the DO alarm.
export async function settleRound(db: Db, date: string): Promise<{ already: boolean; settled: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) throw new Error("unknown round");
  if (round.status === "resolved") return { already: true, settled: 0 };
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  if (!qs.every((q) => q.status === "resolved" || q.status === "void")) throw new Error("not fully resolved");

  const preds = await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) });
  const byUser = new Map<string, number>();
  for (const p of preds) byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + 1);
  const streakHolders = await db.query.users.findMany({ where: gt(schema.users.streakCurrent, 0) });
  const playedUsers = byUser.size ? await db.query.users.findMany({ where: inArray(schema.users.id, [...byUser.keys()]) }) : [];
  const audience = new Map([...streakHolders, ...playedUsers].map((u) => [u.id, u]));

  const nonVoid = qs.filter((q) => q.outcome !== "void").length;
  for (const u of audience.values()) {
    const played = (byUser.get(u.id) ?? 0) > 0;
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, u.id) });
    const result = settleStreak(
      { streakCurrent: u.streakCurrent, streakBest: u.streakBest, freeShieldUsedAt: u.freeShieldUsedAt, paidShieldsRemaining: ent?.shieldsRemaining ?? 0 },
      played,
      date,
    );
    const patch: Partial<typeof schema.users.$inferInsert> = {
      streakCurrent: result.streakCurrent,
      streakBest: result.streakBest,
      freeShieldUsedAt: result.freeShieldUsedAt,
    };
    // Complete-rounds rule: all 5 answered → the round rates.
    if (byUser.get(u.id) === qs.length) {
      patch.callsResolved = u.callsResolved + nonVoid;
      patch.oracleScore = await recomputeOracleScore(db, u.id);
    }
    await db.update(schema.users).set(patch).where(eq(schema.users.id, u.id));
    if (result.usedPaidShield && ent) {
      await db.update(schema.entitlements)
        .set({ shieldsRemaining: result.paidShieldsRemaining, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, u.id));
    }
  }

  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  return { already: false, settled: audience.size };
}

// Oracle Score over the user's complete rounds only, in round/slot order.
async function recomputeOracleScore(db: Db, userId: string): Promise<number | null> {
  const rows = await db
    .select({ brier: schema.predictions.brier, roundDate: schema.questions.roundDate, locksAt: schema.questions.locksAt, slot: schema.questions.slot })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(and(eq(schema.predictions.userId, userId), isNotNull(schema.predictions.brier)));
  const perRound = new Map<string, number>();
  const all = await db
    .select({ roundDate: schema.questions.roundDate })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(eq(schema.predictions.userId, userId));
  for (const r of all) perRound.set(r.roundDate, (perRound.get(r.roundDate) ?? 0) + 1);
  const briers = rows
    .filter((r) => perRound.get(r.roundDate) === 5)
    .sort((x, y) => x.locksAt.getTime() - y.locksAt.getTime() || x.slot - y.slot)
    .map((r) => Number(r.brier));
  return oracleScore(briers);
}
