import { Hono } from "hono";
import { asc, and, countDistinct, eq, inArray } from "drizzle-orm";
import { dayPoints } from "@oracle/core";
import type { AppContext } from "../app";
import { schema, type Db } from "../db/client";
import { deviceAuth } from "./auth";

async function openRound(db: Db) {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
  if (!round) return null;
  const qs = await db.query.questions.findMany({
    where: eq(schema.questions.roundDate, round.date),
    orderBy: [asc(schema.questions.slot)],
  });
  return { round, qs };
}

export const roundRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/today", async (c) => {
    const { db } = c.get("deps");
    const found = await openRound(db);
    if (!found) return c.json({ error: "no open round" }, 404);
    const { round, qs } = found;
    // rounds.player_count is a dead column (never written); the live count is
    // distinct predictors on this round, same source of truth as /today/crowd.
    const qIds = qs.map((q) => q.id);
    const [players] = qIds.length
      ? await db.select({ n: countDistinct(schema.predictions.userId) }).from(schema.predictions).where(inArray(schema.predictions.questionId, qIds))
      : [{ n: 0 }];
    return c.json({
      date: round.date,
      locks_at: qs[0]?.locksAt ?? null,
      player_count: Number(players?.n ?? 0),
      questions: qs.map((q) => ({
        id: q.id,
        slot: q.slot,
        is_big_one: q.isBigOne,
        text: q.text,
        category: q.category,
        source_name: q.sourceName,
        resolution_criteria: q.resolutionCriteria,
      })),
    });
  })
  .get("/today/crowd", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db);
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
    const found = await openRound(db);
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
  .get("/:date/reveal", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const date = c.req.param("date");
    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, date),
      orderBy: [asc(schema.questions.slot)],
    });
    if (qs.length === 0) return c.json({ error: "unknown round" }, 404);
    if (!qs.every((q) => q.status === "locked" || q.status === "resolved" || q.status === "void")) return c.json({ error: "not locked" }, 409);

    const mine = await db.query.predictions.findMany({
      where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
    });
    const byQ = new Map(mine.map((p) => [p.questionId, p]));
    const perQuestionPoints = mine.map((p) => p.points ?? 0);
    const allFirstHour = mine.length > 0 && mine.every((p) => p.firstHour);

    return c.json({
      date,
      day_points: dayPoints(perQuestionPoints, allFirstHour),
      first_hour: allFirstHour,
      questions: qs.map((q) => {
        const p = byQ.get(q.id);
        return {
          id: q.id,
          slot: q.slot,
          text: q.text,
          outcome: q.outcome,
          crowd_yes_pct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
          market_prob: q.marketProb === null ? null : Number(q.marketProb),
          my: p ? { answer: p.answer, confidence: p.confidence, points: p.points, brier: p.brier === null ? null : Number(p.brier) } : null,
        };
      }),
    });
  });
