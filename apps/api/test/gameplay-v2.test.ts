import { it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveQuestion } from "../src/resolution";
import { settleRound, completeRoundBriers } from "../src/settlement";
import { createApp } from "../src/app";
import { mintDeviceToken } from "../src/auth/deviceToken";

it("v2 global voids qualify four calls, keep streak weight at one, and agree across reveal and board", async () => {
  const { db, pg } = await makeTestDb();
  try {
    const date = "2026-09-06";
    const qs = await seedRound(db, { date, opensAt: new Date("2026-09-06T16:00:00Z"), locksAt: new Date("2026-09-07T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, date));
    const users = await db.insert(schema.users).values(Array.from({ length: 5 }, () => ({ streakCurrent: 10 }))).returning();
    const user = users[0]!;
    const [device] = await db.insert(schema.devices).values({ userId: user.id, installTokenHash: "test", platform: "ios" }).returning();
    for (const u of users) for (const q of qs.slice(1)) await db.insert(schema.predictions).values({ userId: u.id, questionId: q.id, answer: true, confidence: 75, firstHour: true });
    await db.update(schema.questions).set({ oracleProbYes: ".75" }).where(eq(schema.questions.roundDate, date));
    await db.update(schema.questions).set({ lockHealedAt: new Date("2026-09-06T18:00:00Z") }).where(eq(schema.questions.id, qs[0]!.id));
    // Even a stale resolver's YES becomes the immutable global void.
    await resolveQuestion(db, qs[0]!.id, "yes");
    for (const q of qs.slice(1)) await resolveQuestion(db, q.id, "yes");
    // Retry after the global void cannot restore competitive credit.
    await resolveQuestion(db, qs[0]!.id, "no", null, { force: true });
    expect((await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[0]!.id) }))!.outcome).toBe("void");
    await settleRound(db, date);
    expect(await completeRoundBriers(db, user.id, null)).toHaveLength(4);
    const stamp = await db.query.userRounds.findFirst({ where: eq(schema.userRounds.userId, user.id) });
    expect(Number(stamp!.vigilMult)).toBe(1);
    const app = createApp({ db, env: { DEVICE_TOKEN_SECRET: "test", ADMIN_SECRET: "admin" } });
    const token = await mintDeviceToken("test", device!.id, Date.now());
    const get = async (path: string) => { const r = await app.request(path, { headers: { authorization: `Bearer ${token}` } }); expect(r.status).toBe(200); return r.json() as Promise<any>; };
    const reveal = await get(`/v1/round/${date}/reveal`);
    const board = await get(`/v1/round/${date}/board`);
    const ledger = await get("/v1/me/ledger");
    expect(reveal.rules_version).toBe(2);
    expect(reveal.day_points).toBe(189);
    expect(board.your_points).toBe(reveal.day_points);
    expect(board.rows.find((r: any) => r.is_oracle).points).toBe(reveal.day_points);
    expect(ledger.calls_rated).toBe(4);
    expect(ledger.oracle.days_outseen).toBe(0);
    expect(ledger.milestones).toContain("first_result");
    expect(ledger.oracle_score).toBeNull();
  } finally { await pg.close(); }
});
