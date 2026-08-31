import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { assignEpithet, CONSTANTS } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

const WINDOW_MS = 28 * 86_400_000;

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

    interface Row { correct: boolean; confidence: number; sidePct: number | null; inWindow: boolean }
    const resolved: Row[] = [];
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      resolved.push({
        correct: p.answer === (q.outcome === "yes"),
        confidence: p.confidence,
        sidePct: crowd === null ? null : p.answer ? crowd : 100 - crowd,
        inWindow: q.locksAt.getTime() >= windowStart,
      });
    }

    const stats = (rows: Row[]) => {
      const withCrowd = rows.filter((r) => r.sidePct !== null && r.sidePct !== 50);
      return {
        accuracyPct: rows.length ? Math.round((100 * rows.filter((r) => r.correct).length) / rows.length) : null,
        avgConfidence: rows.length ? Math.round(rows.reduce((s, r) => s + r.confidence, 0) / rows.length) : null,
        tideWins: rows.filter((r) => r.correct && r.sidePct !== null && r.sidePct < CONSTANTS.CONTRARIAN_CROWD_PCT).length,
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
    const completeRounds = [...byDate.entries()].filter(([date, n]) => {
      const anyQ = qs.find((q) => q.roundDate === date);
      return n >= 5 && anyQ !== undefined && anyQ.locksAt.getTime() >= windowStart;
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
      days_consulted: byDate.size,
      streak: user?.streakCurrent ?? 0,
      accuracy_pct: life.accuracyPct,
      avg_confidence: life.avgConfidence,
      tide_wins: life.tideWins,
      majority_rate: life.majorityRate,
      // Shield state (streak.ts month rule). shield_used_on only dates the
      // FREE shield — paid burns are undated, an accepted v1 limitation.
      free_shield_available: (() => {
        const usedAt = user?.freeShieldUsedAt ?? null;
        return usedAt === null || usedAt.slice(0, 7) !== new Date().toISOString().slice(0, 7);
      })(),
      paid_shields: ent?.shieldsRemaining ?? 0,
      shield_used_on: user?.freeShieldUsedAt ?? null,
      epithet,
      computed_through: new Date().toISOString().slice(0, 10),
    });
  });
