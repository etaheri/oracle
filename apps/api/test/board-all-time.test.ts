import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import { AllTimeBoardSchema } from "@oracle/core";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

async function world(players: number) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const tokens: string[] = [];
  for (let i = 0; i < players; i++) {
    const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
    tokens.push(((await res.json()) as { token: string }).token);
  }
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40" }).where(eq(schema.questions.roundDate, DATE));
  const as = (i: number) => (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tokens[i]}`, "content-type": "application/json" } });
  const seal = (i: number, qid: string, answer: boolean, confidence: number) =>
    as(i)("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence, idempotency_key: "k" }) });
  const dbl = (i: number, qid: string) => as(i)("/v1/predictions/double", { method: "POST", body: JSON.stringify({ question_id: qid }) });
  return { db, app, qs, as, seal, dbl };
}
afterEach(() => vi.useRealTimers());

describe("GET /v1/board/all-time (design 2026-09-14 §6.6)", () => {
  it("401s without a token", async () => {
    const { app } = await world(1);
    expect((await app.request("/v1/board/all-time")).status).toBe(401);
  });

  it("reports the field size and the caller's best, and nothing else, below the floor", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(3);
    for (const q of qs) for (let i = 0; i < 2; i++) await seal(i, q.id, true, 75);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = AllTimeBoardSchema.parse(await (await as(0)("/v1/board/all-time")).json());
    // Player 2 never sealed, so never settled a stake, so is not in the field.
    expect(json.field_size).toBe(2);
    expect(json.your_best).toBe(1558); // 1000 + 93 × 4 + 186
    expect(json.your_rank).toBeNull();
    expect(json.rows).toEqual([]);
    const spectator = AllTimeBoardSchema.parse(await (await as(2)("/v1/board/all-time")).json());
    expect(spectator.your_best).toBeNull();
  });

  it("ranks by best fortune, so the double decides the summit and a loser stands at founding", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal, dbl } = await world(6);
    const big = qs.find((q) => q.slot === 5)!;
    // players 0 and 5 go YES everywhere; player 0 doubles the Big One. players 1-4 go NO.
    for (const q of qs) {
      await seal(0, q.id, true, 75);
      for (let i = 1; i < 5; i++) await seal(i, q.id, false, 75);
      await seal(5, q.id, true, 75);
    }
    await dbl(0, big.id);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const top = AllTimeBoardSchema.parse(await (await as(0)("/v1/board/all-time")).json());
    expect(top.field_size).toBe(6);
    expect(top.your_rank).toBe(1);
    expect(top.your_best).toBe(1743); // 1000 + 93 × 4 + 371
    expect(top.best).toBe(1743);
    // Players 1-4 lost 300 each: fortune 700, but their BEST is still founding.
    // Sorted bests: 1743, 1558, 1000 × 4 → median of an even field = 1000.
    expect(top.median_best).toBe(1000);
    expect(top.rows.find((r) => r.is_you)!.best).toBe(1743);
    const loser = AllTimeBoardSchema.parse(await (await as(3)("/v1/board/all-time")).json());
    expect(loser.your_best).toBe(1000);
    expect(loser.your_rank).toBe(3); // four tied at 1000 share rank 3
    expect(loser.rows.filter((r) => r.rank === 3).length).toBeGreaterThanOrEqual(2);
    expect(loser.rows.some((r) => r.is_you)).toBe(true);
    for (const r of loser.rows) expect(r.name.length).toBeGreaterThan(0);
  });

  it("a bust does not drop a player below their best", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(5);
    const users = await db.query.users.findMany();
    await db.update(schema.users).set({ fortune: 120, bestFortune: 2600 }).where(eq(schema.users.id, users[0]!.id));
    for (const q of qs) for (let i = 0; i < 5; i++) await seal(i, q.id, true, 75);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "no");
    await settleRound(db, DATE);
    const json = AllTimeBoardSchema.parse(await (await as(0)("/v1/board/all-time")).json());
    expect(json.your_best).toBe(2600);
    expect(json.your_rank).toBe(1);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, users[0]!.id) }))!.fortune).toBe(1000); // busted and restarted
  });
});
