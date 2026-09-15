import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import { RoundTodaySchema, RevealSchema, RoundBoardSchema, MeLedgerSchema } from "@oracle/core";

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
  return { db, app, qs, as, seal };
}
afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today at version 3", () => {
  it("carries the line, the caller's fortune and the house", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { as } = await world(1);
    const json = RoundTodaySchema.parse(await (await as(0)("/v1/round/today")).json());
    expect(json.rules_version).toBe(3);
    expect(json.fortune).toBe(1000);
    expect(json.house).toEqual({ total: 0, last_delta: null });
    expect(json.questions.every((q) => q.line_p_yes === 0.35)).toBe(true);
  });
});

describe("GET /v1/round/:date/reveal at version 3", () => {
  it("shows stake, payout, delta per card and the round's fortune figures", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, true, 70);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, q.slot === 5 ? "no" : "yes");
    await settleRound(db, DATE);
    const json = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    const first = json.questions.find((q) => q.slot === 1)!;
    expect(first.line_p_yes).toBe(0.35);
    expect(first.market_prob).toBe(0.40);
    expect(first.my).toMatchObject({ stake: 50, payout: 143, delta: 93 });
    const big = json.questions.find((q) => q.slot === 5)!;
    expect(big.my).toMatchObject({ stake: 100, payout: 0, delta: -100 });
    expect(json.delta).toBe(93 * 4 - 100);
    expect(json.return).toBeCloseTo(0.272, 6);
    expect(json.fortune_after).toBe(1272);
    expect(json.house_delta).toBe(-272);
  });
  it("withholds the round's fortune figures until every card is decided", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, true, 70);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    // Three of five read. Payouts land one question at a time, so a total
    // taken here would be a partial sum over a whole-day denominator.
    for (const q of qs.filter((q) => q.slot <= 3)) await resolveQuestion(db, q.id, "yes");
    const partial = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    expect(partial.delta).toBeNull();
    expect(partial.return).toBeNull();
    expect(partial.fortune_after).toBeNull();
    expect(partial.house_delta).toBeNull();
    // The paid card still shows its own figures -- those are final per question.
    expect(partial.questions.find((q) => q.slot === 1)!.my).toMatchObject({ stake: 50, payout: 143, delta: 93 });
    expect(partial.questions.find((q) => q.slot === 5)!.my).toMatchObject({ stake: 100, payout: null, delta: null });

    for (const q of qs.filter((q) => q.slot > 3)) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const full = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    expect(full.delta).toBe(93 * 4 + 186);
    expect(full.return).toBeCloseTo(0.558, 6);
    expect(full.fortune_after).toBe(1558);
    expect(full.house_delta).toBe(-(93 * 4 + 186));
  });
  it("reports null fortune figures on a version 2 round", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T02:00:00Z"), toFake: ["Date"] });
    const { db, as } = await world(1);
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, DATE));
    const json = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    expect(json.delta).toBeNull();
    expect(json.fortune_after).toBeNull();
  });
});

describe("GET /v1/round/:date/board at version 3", () => {
  it("ranks the field by return in basis points with no Oracle row", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(6);
    // player 0 goes YES at 95 everywhere; players 1-5 go NO at 55 everywhere
    for (const q of qs) {
      await seal(0, q.id, true, 95);
      for (let i = 1; i < 6; i++) await seal(i, q.id, false, 55);
    }
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = RoundBoardSchema.parse(await (await as(0)(`/v1/round/${DATE}/board`)).json());
    expect(json.metric).toBe("return");
    expect(json.field_size).toBe(6);
    expect(json.your_rank).toBe(1);
    // player 0: flat stakes 50×4 + 100 = 300, all right → delta 93×4 + 186 = 558 on a 1000 fortune → 5580 bp
    expect(json.your_return_bp).toBe(5580);
    expect(json.best_return_bp).toBe(5580);
    // players 1-5: −(50×4 + 100) = −300 on a 1000 fortune → −3000 bp
    expect(json.median_return_bp).toBe(-3000);
    expect(json.rows.some((r) => r.is_oracle)).toBe(false);
    expect(json.rows.find((r) => r.is_you)!.return_bp).toBe(5580);
  });
});

describe("GET /v1/me/ledger", () => {
  it("carries fortune and a per-round history", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, true, 70);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    // slots 1-4: flat stake 50, +93 each; the Big One: flat stake 100, +round(100 × 0.65/0.35) = +186
    expect(json.fortune).toBe(1000 + 93 * 4 + 186);
    expect(json.fortune_history).toEqual([{ date: DATE, delta: 93 * 4 + 186, fortune_after: 1000 + 93 * 4 + 186 }]);
  });
});

describe("GET /v1/me/ledger carries the house", () => {
  it("reports the purse total and last night's delta after settlement", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, false, 55); // every stake 50, Big One 100
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    expect(json.house).toEqual({ total: 300, last_delta: 300 });
  });

  it("is null-delta with a zero total before any round settles", async () => {
    const { as } = await world(1);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    expect(json.house).toEqual({ total: 0, last_delta: null });
  });
});
