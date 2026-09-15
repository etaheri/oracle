import { Hono } from "hono";
import { and, count, eq, sql } from "drizzle-orm";
import { FORTUNE, PredictionSubmitSchema, stake } from "@oracle/core";
import type { AppContext } from "../app";
import { schema, type Db } from "../db/client";
import { deviceAuth } from "./auth";

// The crowd at the instant this player sealed, sealer included (design
// 2026-09-09 §4.1). Best-effort: a DB hiccup here must leave the snapshot
// null, never fail a seal that already landed durably -- callers wrap this
// in try/catch and ignore its rejection. One aggregate query rather than
// pulling every prediction row for the question just to count them.
export async function snapshotCrowdAtSeal(db: Db, questionId: string, predictionId: string) {
  const [agg] = await db
    .select({ count: count(), yes: sql<number>`count(*) filter (where ${schema.predictions.answer})` })
    .from(schema.predictions)
    .where(eq(schema.predictions.questionId, questionId));
  const total = Number(agg!.count);
  const yes = Number(agg!.yes);
  await db.update(schema.predictions)
    .set({ crowdYesPctAtSeal: String(Math.round((100 * yes) / total)), crowdCountAtSeal: total })
    .where(eq(schema.predictions.id, predictionId));
}

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

    // The stake (design 2026-09-10 §4.2, 2026-09-14 §4.1): the flat fraction of
    // the fortune at THIS seal, doubled on the Big One, frozen on the row.
    // Nothing is debited here; settlement pays. A lineless version 3
    // question, and every earlier version, seals unstaked.
    const staked = (round.rulesVersion ?? 1) >= 3 && q.linePYes !== null;
    let stakeCols: { fortuneAtSeal: number; stake: number; linePYes: string } | null = null;
    if (staked) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
      const fortune = user?.fortune ?? FORTUNE.FOUNDING;
      stakeCols = { fortuneAtSeal: fortune, stake: stake(fortune, q.isBigOne), linePYes: String(q.linePYes) };
    }

    const firstHour = now.getTime() <= q.opensAt.getTime() + 3_600_000;
    const inserted = await db
      .insert(schema.predictions)
      .values({
        questionId: q.id,
        userId,
        answer: parsed.data.answer,
        // The client's confidence is accepted and ignored (design 2026-09-14
        // H8): the seal is a side, and the column holds a constant so the
        // points and Brier readers keep computing until it is deleted.
        confidence: FORTUNE.CONFIDENCE_FLAT,
        createdAt: now,
        firstHour,
        ...(stakeCols ?? {}),
      })
      .onConflictDoNothing({ target: [schema.predictions.questionId, schema.predictions.userId] })
      .returning({ id: schema.predictions.id, firstHour: schema.predictions.firstHour, stake: schema.predictions.stake });

    if (inserted.length > 0) {
      if (stakeCols) {
        // The day's denominator, written at the FIRST accepted seal and never again.
        await db.insert(schema.userRounds)
          .values({ userId, date: q.roundDate, vigilMult: "1", fortuneAtOpen: stakeCols.fortuneAtSeal })
          .onConflictDoNothing();
      }
      try {
        await snapshotCrowdAtSeal(db, q.id, inserted[0]!.id);
      } catch {
        // Best-effort: a missing snapshot is honest, a failed seal is not.
        // The row already landed durably -- report success regardless.
      }
      return c.json({ id: inserted[0]!.id, first_hour: inserted[0]!.firstHour, stake: inserted[0]!.stake ?? null });
    }
    const existing = await db.query.predictions.findFirst({
      where: and(eq(schema.predictions.questionId, q.id), eq(schema.predictions.userId, userId)),
    });
    return c.json({ id: existing!.id, first_hour: existing!.firstHour, stake: existing!.stake ?? null });
  });
