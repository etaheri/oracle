import { count, eq, gt, inArray, sql } from "drizzle-orm";
import { oracleScore, settleStreak, vigilMultiplier } from "@oracle/core";
import { schema, type Db } from "./db/client";

// Round settlement (backend spec L73/L79/L119): streak + shield settlement for
// every affected user, complete-round scoring, then the round flips to
// "resolved" — which is also the idempotency guard. Called by the admin
// endpoint today and by Plan 4's DO lock alarm later.
// PLAN-4 NOTE: the audience is users-with-streak ∪ users-who-played; both
// queries are unbounded and per-user scoring is N queries — fine at current
// scale, revisit with the DO alarm.
// RETRY SAFETY: users.streak_settled_through marks each user done as their
// row is written, so a mid-loop crash + cron retry skips finished users.
// Write order per user: users row (streak + marker, one statement) THEN the
// entitlements decrement — a crash between the two leaves the player an
// undecremented shield (player-favorable), never a double burn.
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

  let settled = 0;
  for (const u of audience.values()) {
    if (u.streakSettledThrough !== null && u.streakSettledThrough >= date) continue; // ISO dates compare lexicographically
    const played = (byUser.get(u.id) ?? 0) > 0;
    // Stamp the vigil that weighed this day BEFORE settleStreak advances it.
    // `u.streakCurrent` here is the vigil carried INTO the round -- fixed
    // before any of today's outcomes existed, which is exactly why weighing
    // by it leaves the scoring rule proper (spec §A.3). Do-nothing on
    // conflict: a crash-retry or a resettle must never revise a stamped day.
    if (played) {
      await db.insert(schema.userRounds)
        .values({ userId: u.id, date, vigilMult: String(vigilMultiplier(u.streakCurrent)) })
        .onConflictDoNothing();
    }
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
      streakSettledThrough: date,
    };
    // Complete-rounds rule: every question of the round answered → the round rates.
    if (byUser.get(u.id) === qs.length) {
      const briers = await completeRoundBriers(db, u.id, date);
      patch.callsResolved = briers.length;
      patch.oracleScore = oracleScore(briers);
    }
    await db.update(schema.users).set(patch).where(eq(schema.users.id, u.id));
    if (result.usedPaidShield && ent) {
      // Relative decrement, not settleStreak's absolute paidShieldsRemaining:
      // a rescue purchase landing between our read above and this write must
      // not be clobbered back down to the pre-purchase value. settleStreak
      // consumes at most one paid shield per call (see streak.ts), so "-1,
      // floored at 0" is always the correct delta here.
      await db.update(schema.entitlements)
        .set({ shieldsRemaining: sql`GREATEST(${schema.entitlements.shieldsRemaining} - 1, 0)`, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, u.id));
    }
    settled++;
  }

  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  return { already: false, settled };
}

// Brier scores over the user's complete rounds only (every question of that
// round answered — void/yes/no all count), in round/slot order — feeds
// oracleScore(). A round only counts once it is fully resolved ("resolved"
// status) or is the round being settled right now (its status flips to
// "resolved" only after this settlement pass finishes, so `settlingDate`
// covers that gap without letting a still-in-progress round leak partial
// briers into some OTHER user's score recompute). `settlingDate: null` means
// resolved rounds only — used by recomputeTruth's from-scratch rebuild.
export async function completeRoundBriers(db: Db, userId: string, settlingDate: string | null): Promise<number[]> {
  const resolvedRounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "resolved") });
  const eligibleDates = new Set(resolvedRounds.map((r) => r.date));
  if (settlingDate) eligibleDates.add(settlingDate);

  const mine = await db
    .select({ brier: schema.predictions.brier, roundDate: schema.questions.roundDate, locksAt: schema.questions.locksAt, slot: schema.questions.slot })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(eq(schema.predictions.userId, userId));
  const answeredPerRound = new Map<string, number>();
  for (const r of mine) answeredPerRound.set(r.roundDate, (answeredPerRound.get(r.roundDate) ?? 0) + 1);

  // One definition of "complete": answered every question that round asked.
  const dates = [...answeredPerRound.keys()];
  const sizes = dates.length
    ? await db.select({ roundDate: schema.questions.roundDate, n: count() }).from(schema.questions).where(inArray(schema.questions.roundDate, dates)).groupBy(schema.questions.roundDate)
    : [];
  const questionsPerRound = new Map(sizes.map((s) => [s.roundDate, Number(s.n)]));

  return mine
    .filter((r) => r.brier !== null && eligibleDates.has(r.roundDate) && answeredPerRound.get(r.roundDate) === questionsPerRound.get(r.roundDate))
    .sort((x, y) => x.locksAt.getTime() - y.locksAt.getTime() || x.slot - y.slot)
    .map((r) => Number(r.brier));
}

// Rebuild one user's truth economy from the ledger itself (resolved rounds
// only). Used after a forced re-resolve; never touches streaks.
export async function recomputeTruth(db: Db, userId: string): Promise<{ callsRated: number; oracleScore: number | null }> {
  const briers = await completeRoundBriers(db, userId, null);
  const out = { callsRated: briers.length, oracleScore: oracleScore(briers) };
  await db.update(schema.users).set({ callsResolved: out.callsRated, oracleScore: out.oracleScore }).where(eq(schema.users.id, userId));
  return out;
}

export async function resettleRound(db: Db, date: string): Promise<{ users: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) throw new Error("unknown round");
  if (round.status !== "resolved") return { users: 0 }; // an unsettled round will settle normally
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const preds = qs.length ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) }) : [];
  const userIds = [...new Set(preds.map((p) => p.userId))];
  for (const id of userIds) await recomputeTruth(db, id);
  return { users: userIds.length };
}
