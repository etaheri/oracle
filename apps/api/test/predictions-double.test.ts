import { describe, it, expect, vi, afterEach } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

// `linelessSlot`, when given, is left out of the house-line update below so
// that question seals unstaked. guard_house_line (migration 0014) makes
// questions.line_p_yes immutable once set, so a lineless question must never
// be given a line in the first place -- it can't be set then nulled back out.
async function setup(opts: { linelessSlot?: number } = {}) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  const lineWhere = opts.linelessSlot != null
    ? and(eq(schema.questions.roundDate, DATE), ne(schema.questions.slot, opts.linelessSlot))!
    : eq(schema.questions.roundDate, DATE);
  await db.update(schema.questions).set({ linePYes: "0.35" }).where(lineWhere);
  const post = (path: string, body: object) => app.request(path, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const seal = (qid: string, answer = true) => post("/v1/predictions", { question_id: qid, answer, idempotency_key: "k" });
  const dbl = (qid: string) => post("/v1/predictions/double", { question_id: qid });
  const me = async () => (await db.query.users.findMany())[0]!;
  return { db, qs, seal, dbl, me };
}
afterEach(() => vi.useRealTimers());

describe("POST /v1/predictions/double (design 2026-09-14 §6.2)", () => {
  it("doubles one sealed call's stake, once per round, and prices the win", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, seal, dbl, me } = await setup();
    for (const q of qs) await seal(q.id);
    const big = qs.find((q) => q.slot === 5)!;
    const res = await dbl(big.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ question_id: big.id, stake: 200, wins: 371 }); // round(200 × 0.65/0.35)
    const u = await me();
    const p = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, big.id), eq(schema.predictions.userId, u.id)) });
    expect(p).toMatchObject({ stake: 200, doubled: true, fortuneAtSeal: 1000 });
    const ur = await db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, u.id), eq(schema.userRounds.date, DATE)) });
    expect(ur!.doubleQuestionId).toBe(big.id);
    // Every other call is untouched.
    const others = await db.query.predictions.findMany({ where: eq(schema.predictions.userId, u.id) });
    expect(others.filter((x) => x.questionId !== big.id).every((x) => x.stake === 50 && !x.doubled)).toBe(true);
  });
  it("prices a NO double at the NO odds", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, seal, dbl } = await setup();
    await seal(qs[0]!.id, false);
    expect(await (await dbl(qs[0]!.id)).json()).toEqual({ question_id: qs[0]!.id, stake: 100, wins: 54 }); // round(100 × 0.35/0.65)
  });
  it("is idempotent on the same question and 409 placed on another", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, seal, dbl } = await setup();
    await seal(qs[0]!.id);
    await seal(qs[1]!.id);
    expect((await dbl(qs[0]!.id)).status).toBe(200);
    const again = await dbl(qs[0]!.id);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ question_id: qs[0]!.id, stake: 100, wins: 186 });
    const other = await dbl(qs[1]!.id);
    expect(other.status).toBe(409);
    expect(await other.json()).toEqual({ error: "placed" });
  });
  it("404s an unknown question and a question the caller has not sealed", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, dbl } = await setup();
    expect((await dbl("5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e")).status).toBe(404);
    const res = await dbl(qs[0]!.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no prediction" });
  });
  it("409s after the question's lock", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, seal, dbl } = await setup();
    await seal(qs[0]!.id);
    vi.setSystemTime(new Date("2026-09-11T16:00:01Z"));
    const res = await dbl(qs[0]!.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "locked" });
  });
  it("409s on a round that is not open", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, seal, dbl } = await setup();
    await seal(qs[0]!.id);
    await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, DATE));
    expect(await (await dbl(qs[0]!.id)).json()).toEqual({ error: "not open" });
  });
  it("404s an unstaked seal (a lineless question has no stake to double)", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, seal, dbl } = await setup({ linelessSlot: 1 });
    await seal(qs[0]!.id);
    expect(await (await dbl(qs[0]!.id)).json()).toEqual({ error: "no prediction" });
  });
  it("400s a malformed body", async () => {
    const { dbl } = await setup();
    expect((await dbl("not-a-uuid")).status).toBe(400);
  });
});
