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
// PLAN-4 PRECONDITION (final review 2026-08-27): settleRound is not atomic —
// users settle one at a time and the round flips to "resolved" only at the
// end. A mid-loop crash + retry would double-settle already-processed users
// (streak +2, or a second shield burned). Safe while the trigger is one
// manual admin call; BEFORE the DO alarm automates (and retries) this, make
// it retry-safe per user — e.g. a users.streak_settled_through date checked
// in the loop. Also note: neon-http has no interactive transactions.
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
      patch.oracleScore = oracleScore(await completeRoundBriers(db, u.id, date));
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

// Brier scores over the user's complete rounds only (all 5 slots answered),
// in round/slot order — feeds oracleScore(). A round only counts once it is
// fully resolved ("resolved" status) or is the round being settled right now
// (its status flips to "resolved" only after this settlement pass finishes,
// so `settlingDate` covers that gap without letting a still-in-progress round
// leak partial briers into some OTHER user's score recompute).
export async function completeRoundBriers(db: Db, userId: string, settlingDate: string): Promise<number[]> {
  const resolvedRounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "resolved") });
  const eligibleDates = new Set([...resolvedRounds.map((r) => r.date), settlingDate]);

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
  return rows
    .filter((r) => perRound.get(r.roundDate) === 5 && eligibleDates.has(r.roundDate))
    .sort((x, y) => x.locksAt.getTime() - y.locksAt.getTime() || x.slot - y.slot)
    .map((r) => Number(r.brier));
}
