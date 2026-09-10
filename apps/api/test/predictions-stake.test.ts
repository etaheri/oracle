import { describe, it, expect, vi, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

async function setup(opts: { rulesVersion: number; line: string | null }) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: opts.rulesVersion }).where(eq(schema.rounds.date, DATE));
  if (opts.line !== null) await db.update(schema.questions).set({ linePYes: opts.line }).where(eq(schema.questions.roundDate, DATE));
  const submit = (body: object) => app.request("/v1/predictions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const me = async () => (await db.query.users.findMany())[0]!;
  return { db, qs, submit, me };
}
const body = (questionId: string, confidence = 70, answer = true) => ({ question_id: questionId, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("the stake at seal (version 3)", () => {
  it("freezes fortune, stake and line on the prediction and returns the stake", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const res = await submit(body(qs[0]!.id, 70));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; stake: number };
    expect(json.stake).toBe(40);
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, json.id) });
    expect(p).toMatchObject({ fortuneAtSeal: 1000, stake: 40 });
    expect(Number(p!.linePYes)).toBe(0.35);
  });
  it("doubles the stake fraction on the Big One", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const big = qs.find((q) => q.slot === 5)!;
    expect(((await (await submit(body(big.id, 95))).json()) as { stake: number }).stake).toBe(180);
  });
  it("writes fortune_at_open on the first seal only, and does not debit the fortune", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit, me } = await setup({ rulesVersion: 3, line: "0.35" });
    await submit(body(qs[0]!.id, 70));
    const u = await me();
    expect(u.fortune).toBe(1000);
    await db.update(schema.users).set({ fortune: 1500 }).where(eq(schema.users.id, u.id)); // an earlier round settling mid-window
    await submit(body(qs[1]!.id, 70));
    const ur = await db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, u.id), eq(schema.userRounds.date, DATE)) });
    expect(ur!.fortuneAtOpen).toBe(1000);
    const second = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, qs[1]!.id), eq(schema.predictions.userId, u.id)) });
    expect(second!.stake).toBe(60); // cut from the fortune at THIS seal
  });
  it("a duplicate seal returns the original stake, not a recomputed one", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const first = (await (await submit(body(qs[0]!.id, 70))).json()) as { stake: number };
    const again = (await (await submit(body(qs[0]!.id, 95))).json()) as { stake: number };
    expect(again.stake).toBe(first.stake);
  });
  it("a lineless version 3 question seals unstaked", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 3, line: null });
    const json = (await (await submit(body(qs[0]!.id, 70))).json()) as { id: string; stake: number | null };
    expect(json.stake).toBeNull();
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, json.id) });
    expect(p!.stake).toBeNull();
    expect(p!.fortuneAtSeal).toBeNull();
  });
  it("version 2 rounds are unchanged", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 2, line: "0.35" });
    const json = (await (await submit(body(qs[0]!.id, 70))).json()) as { id: string; stake: number | null };
    expect(json.stake).toBeNull();
    expect(await db.query.userRounds.findFirst()).toBeUndefined();
  });
});
