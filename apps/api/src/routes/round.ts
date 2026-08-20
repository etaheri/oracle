import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

export const roundRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/today", async (c) => {
    const { db } = c.get("deps");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
    if (!round) return c.json({ error: "no open round" }, 404);
    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, round.date),
      orderBy: [asc(schema.questions.slot)],
    });
    return c.json({
      date: round.date,
      locks_at: qs[0]?.locksAt ?? null,
      player_count: round.playerCount,
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
  });
