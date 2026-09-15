import { Hono } from "hono";
import { and, count, eq, sql } from "drizzle-orm";
import { DoubleSubmitSchema, FORTUNE, PredictionSubmitSchema, odds, stake } from "@oracle/core";
import type { AppContext } from "../app";
import { schema, type Db } from "../db/client";
import { deviceAuth } from "./auth";
import { executeRows } from "../resolution";

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
  })
  // The double (design 2026-09-14 §6.2): one per round, on one of the caller's
  // own sealed calls, before that question's lock. The one-per-round rule is
  // user_rounds.double_question_id; placing it and doubling the stake are ONE
  // statement, for the same reason payFortune is (neon-http has no
  // transactions). The guard_double trigger refuses every other stake change.
  // The CTE's own EXISTS repeats the outer UPDATE's predicate: without it the
  // round's one double is spent by the CTE even when the outer statement
  // matches nothing -- a prediction settled between the snapshot read and this
  // write would burn the double on a row it could not touch, and the trigger
  // would not save it because no stake changed.
  .post("/double", async (c) => {
    const parsed = DoubleSubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, parsed.data.question_id) });
    if (!q) return c.json({ error: "unknown question" }, 404);
    if (q.status !== "open" || Date.now() < q.opensAt.getTime()) return c.json({ error: "not open" }, 409);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate) });
    if (round?.status !== "open") return c.json({ error: "not open" }, 409);
    if (Date.now() >= q.locksAt.getTime()) return c.json({ error: "locked" }, 409);
    const mine = await db.query.predictions.findFirst({
      where: and(eq(schema.predictions.questionId, q.id), eq(schema.predictions.userId, userId)),
    });
    if (!mine || mine.stake === null || mine.linePYes === null) return c.json({ error: "no prediction" }, 404);

    const priced = (s: number) => ({ question_id: q.id, stake: s, wins: Math.round(s * odds(mine.answer, Number(mine.linePYes))) });
    if (mine.doubled) return c.json(priced(mine.stake));

    const res = await db.execute(sql`
      WITH placed AS (
        UPDATE user_rounds SET double_question_id = ${q.id}::uuid
        WHERE user_id = ${userId}::uuid AND date = ${q.roundDate}::date AND double_question_id IS NULL
          AND EXISTS (
            SELECT 1 FROM predictions p
            WHERE p.question_id = ${q.id}::uuid AND p.user_id = ${userId}::uuid
              AND p.settled_at IS NULL AND p.stake IS NOT NULL
          )
        RETURNING user_id
      )
      UPDATE predictions SET stake = stake * ${FORTUNE.DOUBLE_MULT}, doubled = true
      FROM placed
      WHERE predictions.question_id = ${q.id}::uuid AND predictions.user_id = placed.user_id AND predictions.settled_at IS NULL
      RETURNING predictions.stake AS stake
    `);
    const rows = executeRows(res) as Array<{ stake: number }>;
    if (rows.length > 0) return c.json(priced(Number(rows[0]!.stake)));
    // Zero rows: the round's double is already placed -- either on another
    // question, or (a race) a concurrent call just landed it on this one in
    // the gap between our snapshot read above and this statement. The
    // snapshot is stale by construction here, so re-query current state
    // rather than trust it: 200 if it landed on this question, 409 if it's
    // elsewhere -- or if this call settled under the caller.
    const current = await db.query.predictions.findFirst({
      where: and(eq(schema.predictions.questionId, q.id), eq(schema.predictions.userId, userId)),
    });
    if (current?.doubled) return c.json(priced(Number(current.stake)));
    // A call that settled in the gap is the other way to match nothing, and
    // it is the opposite news: the CTE's EXISTS kept the round's double
    // unspent, so the caller still holds it and can place it elsewhere.
    // "PLACED" would send them looking for a double they never used.
    if (current?.settledAt) return c.json({ error: "settled" }, 409);
    return c.json({ error: "placed" }, 409);
  });
