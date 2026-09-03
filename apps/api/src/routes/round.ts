import { Hono } from "hono";
import { asc, and, countDistinct, eq, inArray } from "drizzle-orm";
import { dayPoints, vigilPoints } from "@oracle/core";
import type { AppContext } from "../app";
import { schema, type Db } from "../db/client";
import { deviceAuth } from "./auth";
import { evidenceSummary } from "../resolution";
import { noonET } from "../pipeline/clock";

// The live round: earliest open round whose latest question lock is still
// ahead of the server clock. The cron flips statuses on a 10-minute tick;
// the clock is authoritative in between (predictions.ts already enforces it).
async function openRound(db: Db, now: Date) {
  const rounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "open"), orderBy: [asc(schema.rounds.date)] });
  for (const round of rounds) {
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date), orderBy: [asc(schema.questions.slot)] });
    const lastLock = qs.reduce((m, q) => Math.max(m, q.locksAt.getTime()), 0);
    if (qs.length > 0 && now.getTime() < lastLock) return { round, qs, lastLock: new Date(lastLock) };
  }
  return null;
}

export const roundRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/today", async (c) => {
    const { db } = c.get("deps");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { round, qs, lastLock } = found;
    // rounds.player_count is a dead column (never written); the live count is
    // distinct predictors on this round, same source of truth as /today/crowd.
    const qIds = qs.map((q) => q.id);
    const [players] = qIds.length
      ? await db.select({ n: countDistinct(schema.predictions.userId) }).from(schema.predictions).where(inArray(schema.predictions.questionId, qIds))
      : [{ n: 0 }];
    return c.json({
      date: round.date,
      locks_at: lastLock.toISOString(),
      player_count: Number(players?.n ?? 0),
      questions: qs.map((q) => ({
        id: q.id,
        slot: q.slot,
        is_big_one: q.isBigOne,
        text: q.text,
        category: q.category,
        source_name: q.sourceName,
        resolution_criteria: q.resolutionCriteria,
        locks_at: q.locksAt.toISOString(),
      })),
    });
  })
  .get("/today/crowd", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { qs } = found;
    const qIds = qs.map((q) => q.id);
    const preds = qIds.length
      ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qIds) })
      : [];
    const mine = new Set(preds.filter((p) => p.userId === userId).map((p) => p.questionId));
    const questions = [...mine].map((qid) => {
      const ofQ = preds.filter((p) => p.questionId === qid);
      const yes = ofQ.filter((p) => p.answer).length;
      return { id: qid, crowd_yes_pct: Math.round((100 * yes) / ofQ.length), player_count: ofQ.length };
    });
    return c.json({ questions });
  })
  .get("/today/mine", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { qs } = found;
    const mine = qs.length
      ? await db.query.predictions.findMany({
          where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
        })
      : [];
    return c.json({
      predictions: mine.map((p) => ({ question_id: p.questionId, answer: p.answer, confidence: p.confidence })),
    });
  })
  .get("/next", async (c) => {
    const { db } = c.get("deps");
    const next = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "scheduled"), orderBy: [asc(schema.rounds.date)] });
    if (!next) return c.json({ error: "no round scheduled" }, 404);
    return c.json({ date: next.date, opens_at: noonET(next.date).toISOString() });
  })
  .get("/:date/reveal", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const date = c.req.param("date");
    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, date),
      orderBy: [asc(schema.questions.slot)],
    });
    if (qs.length === 0) return c.json({ error: "unknown round" }, 404);
    const now = Date.now();
    const settledEnough = qs.every((q) => q.status === "locked" || q.status === "resolved" || q.status === "void" || now >= q.locksAt.getTime());
    if (!settledEnough) return c.json({ error: "not locked" }, 409);

    const [round, user] = await Promise.all([
      db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) }),
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
    ]);
    const mine = await db.query.predictions.findMany({
      where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
    });
    const byQ = new Map(mine.map((p) => [p.questionId, p]));
    const perQuestionPoints = mine.map((p) => p.points ?? 0);
    const allFirstHour = mine.length === qs.length && mine.every((p) => p.firstHour);
    const raw = dayPoints(perQuestionPoints, allFirstHour);
    // The vigil that weighed this day, stamped at settlement. Absent means
    // unweighed, not weightless: the client withholds the number entirely
    // rather than print one that would climb on the next refresh.
    const stamped = await db.query.userRounds.findFirst({
      where: and(eq(schema.userRounds.userId, userId), eq(schema.userRounds.date, date)),
    });
    const vigilMult = stamped ? Number(stamped.vigilMult) : null;

    return c.json({
      date,
      day_points: vigilMult === null ? raw : Math.round(raw * vigilMult),
      vigil_mult: vigilMult,
      first_hour: allFirstHour,
      questions: qs.map((q) => {
        const p = byQ.get(q.id);
        const ev = evidenceSummary(q.resolutionEvidence);
        return {
          id: q.id,
          slot: q.slot,
          text: q.text,
          outcome: q.outcome,
          crowd_yes_pct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
          // How many actually spoke on this question. The reveal needs it to
          // hold its tongue at tiny crowd sizes the way the round footer and
          // the finale already do (audit 2026-09-02 §2.1) — a percentage over
          // three players is mostly the reader.
          crowd_count: q.crowdCount,
          market_prob: q.marketProb === null ? null : Number(q.marketProb),
          my: p ? { answer: p.answer, confidence: p.confidence, points: p.points, brier: p.brier === null ? null : Number(p.brier) } : null,
          source_name: q.sourceName,
          source_url: q.sourceUrl,
          evidence_quote: ev.quote,
          void_reason: q.outcome === "void" ? (ev.reason ?? "UNVERIFIABLE") : null,
          oracle_p_yes: q.oracleProbYes === null ? null : Number(q.oracleProbYes),
        };
      }),
      ledger: {
        settled: round?.status === "resolved",
        streak: user?.streakCurrent ?? 0,
        calls_rated: user?.callsResolved ?? 0,
        oracle_score: user?.oracleScore ?? null,
      },
    });
  });
