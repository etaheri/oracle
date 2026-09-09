import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { PredictionSubmitSchema } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

export const predictionRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .post("/", async (c) => {
    const parsed = PredictionSubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, parsed.data.question_id) });
    if (!q) return c.json({ error: "unknown question" }, 404);

    const now = new Date();
    if (q.status !== "open" || now.getTime() < q.opensAt.getTime()) return c.json({ error: "not open" }, 409);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate) });
    if (round?.status !== "open") return c.json({ error: "not open" }, 409);
    if (now.getTime() >= q.locksAt.getTime()) return c.json({ error: "locked" }, 409);

    const firstHour = now.getTime() <= q.opensAt.getTime() + 3_600_000;
    const inserted = await db
      .insert(schema.predictions)
      .values({
        questionId: q.id,
        userId,
        answer: parsed.data.answer,
        confidence: parsed.data.confidence,
        createdAt: now,
        firstHour,
      })
      .onConflictDoNothing({ target: [schema.predictions.questionId, schema.predictions.userId] })
      .returning({ id: schema.predictions.id, firstHour: schema.predictions.firstHour });

    if (inserted.length > 0) {
      const all = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, q.id), columns: { answer: true } });
      const count = all.length;
      const yes = all.filter((p) => p.answer).length;
      await db.update(schema.predictions)
        .set({ crowdYesPctAtSeal: String(Math.round((100 * yes) / count)), crowdCountAtSeal: count })
        .where(eq(schema.predictions.id, inserted[0]!.id));
      return c.json({ id: inserted[0]!.id, first_hour: inserted[0]!.firstHour });
    }
    const existing = await db.query.predictions.findFirst({
      where: and(eq(schema.predictions.questionId, q.id), eq(schema.predictions.userId, userId)),
    });
    return c.json({ id: existing!.id, first_hour: existing!.firstHour });
  });
