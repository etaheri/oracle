import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { commitLine } from "../src/pipeline/line";

const DATE = "2026-09-10";
// Migration 0009's commitment guard makes oracle_p_yes immutable once the
// round carries oracle_committed_at, so every fixture writes the
// probabilities FIRST and marks the round committed LAST.
type Probs = ReadonlyArray<readonly [oracle: number | null, market: number | null]>;
async function seeded(rulesVersion: number, probs: Probs) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  for (const [i, [oracle, market]] of probs.entries()) {
    await db.update(schema.questions)
      .set({ oracleProbYes: oracle === null ? null : String(oracle), marketProb: market === null ? null : String(market) })
      .where(eq(schema.questions.id, rows[i]!.id));
  }
  await db.update(schema.rounds).set({ rulesVersion, status: "scheduled", oracleCommittedAt: new Date("2026-09-10T14:00:00Z") }).where(eq(schema.rounds.date, DATE));
  return { db, rows };
}
const FIVE: Probs = [[0.40, 0.35], [0.10, 0.35], [0.70, 0.35], [0.60, null], [0.02, 0.10]];
const EXPECTED_LINES = [0.40, 0.20, 0.50, 0.60, 0.05];

describe("commitLine", () => {
  it("writes the clamped line for every committed version 3 question", async () => {
    const { db } = await seeded(3, FIVE);
    expect(await commitLine(db, DATE)).toEqual({ written: 5 });
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => Number(q.linePYes))).toEqual(EXPECTED_LINES);
  });
  it("is idempotent: a second run writes nothing and changes nothing", async () => {
    const { db, rows } = await seeded(3, FIVE);
    await commitLine(db, DATE);
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(Number(q!.linePYes)).toBe(0.40);
  });
  it("skips questions without a forecast", async () => {
    const { db } = await seeded(3, [[0.5, 0.5], [null, 0.5], [null, 0.5], [null, 0.5], [null, 0.5]]);
    expect(await commitLine(db, DATE)).toEqual({ written: 1 });
  });
  it("skips version 2 rounds entirely", async () => {
    const { db } = await seeded(2, FIVE);
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
  });
  it("skips a round that is not yet committed", async () => {
    const { db } = await makeTestDb();
    const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
    for (const r of rows) await db.update(schema.questions).set({ oracleProbYes: "0.5", marketProb: "0.5" }).where(eq(schema.questions.id, r.id));
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
  });
});
