import { Hono } from "hono";
import { count, eq, inArray, isNotNull, lt, and } from "drizzle-orm";
import { assignEpithet, contrarianApplies, CONSTANTS, oracleBrierOf, oracleCallRight, oracleScore } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

const WINDOW_MS = 28 * 86_400_000;

// The free shield resets on the calendar month as seen from America/New_York
// (Shipaton judges + most of our players are ET), not UTC.
const etMonth = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d); // "2026-08"

export const meRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/ledger", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, userId) });
    const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.userId, userId) });
    const qs = preds.length
      ? await db.query.questions.findMany({ where: inArray(schema.questions.id, preds.map((p) => p.questionId)) })
      : [];
    const qById = new Map(qs.map((q) => [q.id, q]));
    const windowStart = Date.now() - WINDOW_MS;

    interface Row { correct: boolean; confidence: number; sidePct: number | null; crowdCount: number; inWindow: boolean }
    const resolved: Row[] = [];
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      resolved.push({
        correct: p.answer === (q.outcome === "yes"),
        confidence: p.confidence,
        sidePct: crowd === null ? null : p.answer ? crowd : 100 - crowd,
        crowdCount: q.crowdCount ?? 0,
        inWindow: q.locksAt.getTime() >= windowStart,
      });
    }

    const stats = (rows: Row[]) => {
      const withCrowd = rows.filter((r) => r.sidePct !== null && r.sidePct !== 50);
      return {
        accuracyPct: rows.length ? Math.round((100 * rows.filter((r) => r.correct).length) / rows.length) : null,
        avgConfidence: rows.length ? Math.round(rows.reduce((s, r) => s + r.confidence, 0) / rows.length) : null,
        tideWins: rows.filter((r) => r.correct && r.sidePct !== null && contrarianApplies(r.sidePct, r.crowdCount)).length,
        majorityRate: withCrowd.length ? withCrowd.filter((r) => r.sidePct! > 50).length / withCrowd.length : null,
      };
    };
    const life = stats(resolved);
    const win = stats(resolved.filter((r) => r.inWindow));

    const byDate = new Map<string, number>();
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (q) byDate.set(q.roundDate, (byDate.get(q.roundDate) ?? 0) + 1);
    }
    // Complete rounds: the user's answer count for a round must equal that
    // round's TRUE question count (not just the questions they happened to
    // answer), fetched fresh so a partial round never rates as complete.
    const roundDates = [...byDate.keys()];
    const sizes = roundDates.length
      ? await db.select({ roundDate: schema.questions.roundDate, n: count() }).from(schema.questions).where(inArray(schema.questions.roundDate, roundDates)).groupBy(schema.questions.roundDate)
      : [];
    const sizeOf = new Map(sizes.map((s) => [s.roundDate, Number(s.n)]));
    const completeRounds = [...byDate.entries()].filter(([date, n]) => {
      const anyQ = qs.find((q) => q.roundDate === date);
      return n === sizeOf.get(date) && anyQ !== undefined && anyQ.locksAt.getTime() >= windowStart;
    }).length;

    const epithet = assignEpithet({
      completeRounds,
      tideWins: win.tideWins,
      avgConfidence: win.avgConfidence,
      accuracyPct: win.accuracyPct,
      majorityRate: win.majorityRate,
      streakCurrent: user?.streakCurrent ?? 0,
      resolvedCalls: resolved.filter((r) => r.inWindow).length,
    });

    // Standing is read against the Oracle Score and nothing else. Day points
    // now carry the vigil's weight, which a shield can be bought to defend --
    // the score is the only number no purchase can reach, which is exactly
    // what makes it the honest thing to rank.
    const score = user?.oracleScore ?? null;
    const cohortSize = Number((await db
      .select({ n: count() })
      .from(schema.users)
      .where(isNotNull(schema.users.oracleScore)))[0]!.n);
    let percentile: number | null = null;
    if (score !== null && cohortSize >= CONSTANTS.PERCENTILE_MIN_COHORT) {
      const below = Number((await db
        .select({ n: count() })
        .from(schema.users)
        .where(and(isNotNull(schema.users.oracleScore), lt(schema.users.oracleScore, score))))[0]!.n);
      percentile = Math.round((100 * below) / cohortSize);
    }

    // THE ORACLE's own record, on the same floor the player meets -- so for
    // the first ten days the machine reads UNWRITTEN beside them. Computed on
    // read over questions alone: no table, no settlement hook, nothing for
    // resettleRound to corrupt.
    const forecast = await db.query.questions.findMany({
      where: isNotNull(schema.questions.oracleProbYes),
      orderBy: (q, { asc }) => [asc(q.roundDate), asc(q.slot)],
    });
    const oracleBriers = forecast
      .filter((q) => q.outcome === "yes" || q.outcome === "no")
      .map((q) => oracleBrierOf(Number(q.oracleProbYes), q.outcome as "yes" | "no"));

    // Days outseen: complete rounds only, the same rule every other rated
    // surface uses. A tie is not an outseeing.
    const forecastByDate = new Map<string, typeof forecast>();
    for (const q of forecast) {
      const list = forecastByDate.get(q.roundDate) ?? [];
      list.push(q);
      forecastByDate.set(q.roundDate, list);
    }
    let daysCompared = 0;
    let daysOutseen = 0;
    for (const [date, n] of byDate.entries()) {
      const dayQs = forecastByDate.get(date);
      if (!dayQs || n !== sizeOf.get(date) || dayQs.length !== sizeOf.get(date)) continue;
      // A round is only "compared" once every one of its questions has
      // resolved. Forecasting now happens at PUBLISH (not lock), so a round
      // can be fully answered and fully forecast while still open -- without
      // this gate, that still-open round would count today, a day early.
      if (dayQs.some((q) => q.outcome === null)) continue;
      const byId = new Map(dayQs.map((q) => [q.id, q]));
      let you = 0;
      let machine = 0;
      for (const q of dayQs) {
        if (q.outcome !== "yes" && q.outcome !== "no") continue;
        if (oracleCallRight(Number(q.oracleProbYes), q.outcome) === true) machine += 1;
      }
      // Iterate `preds`, NOT `resolved`. The `Row` objects in `resolved`
      // carry a precomputed `correct` flag and no `questionId` or `answer`,
      // so they cannot be matched back to a question. `preds` is the raw
      // prediction rows and is already in scope above.
      for (const p of preds) {
        const q = byId.get(p.questionId);
        if (!q || (q.outcome !== "yes" && q.outcome !== "no")) continue;
        if ((p.answer ? "yes" : "no") === q.outcome) you += 1;
      }
      daysCompared += 1;
      if (you > machine) daysOutseen += 1;
    }

    return c.json({
      oracle_score: user?.oracleScore ?? null,
      percentile,
      cohort_size: cohortSize,
      calls_rated: user?.callsResolved ?? 0,
      calls_answered: resolved.length,
      days_consulted: byDate.size,
      streak: user?.streakCurrent ?? 0,
      accuracy_pct: life.accuracyPct,
      avg_confidence: life.avgConfidence,
      tide_wins: life.tideWins,
      majority_rate: life.majorityRate,
      // Shield state (streak.ts month rule). shield_used_on only dates the
      // FREE shield — paid burns are undated, an accepted v1 limitation.
      // Month is keyed on America/New_York, not UTC.
      free_shield_available: (() => {
        const usedAt = user?.freeShieldUsedAt ?? null;
        return usedAt === null || usedAt.slice(0, 7) !== etMonth(new Date());
      })(),
      paid_shields: ent?.shieldsRemaining ?? 0,
      shield_used_on: user?.freeShieldUsedAt ?? null,
      claimed: Boolean(user?.appleSub),
      epithet,
      computed_through: new Date().toISOString().slice(0, 10),
      oracle: {
        score: oracleScore(oracleBriers),
        calls_rated: oracleBriers.length,
        days_outseen: daysOutseen,
        days_compared: daysCompared,
      },
    });
  });
