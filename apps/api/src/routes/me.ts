import { Hono } from "hono";
import { count, eq, inArray } from "drizzle-orm";
import { assignEpithet, contrarianApplies } from "@oracle/core";
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

    return c.json({
      oracle_score: user?.oracleScore ?? null,
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
    });
  });
