import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import { COPY_BANK as COPY } from "@oracle/core";
import { schema } from "../src/db/client";
import { composeHingePushes, claimResolutionPushes, headline } from "../src/push/compose";
import { sendPushes } from "../src/push/onesignal";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

afterEach(() => vi.useRealTimers());

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token, user_id } = (await res.json()) as { token: string; user_id: string };
  const req = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  return Object.assign(req, { userId: user_id, deviceId: token.split(".")[0]! });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });
const addDay = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10);

async function resolveAll(db: Awaited<ReturnType<typeof makeTestDb>>["db"], qs: { id: string }[], outcome: "yes" | "no" | "void" = "yes") {
  for (const q of qs) await resolveQuestion(db, q.id, outcome);
}

describe("composeHingePushes", () => {
  it("tiers players: results for the sealed, silence for a stranger; text is slot-free", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    await player(app); // registered, never played anything, ever
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await resolveAll(db, qs);
    await settleRound(db, "2026-08-20");

    const pushes = await composeHingePushes(db, "2026-08-20");
    // The never-played stranger is not in settleRound's audience and is not
    // pushed at — obligation 4, the bound that keeps this off every install
    // that ever existed.
    expect(pushes).toHaveLength(3);
    for (const p of pushes) {
      expect(p.text).not.toMatch(/[{}]/);
      expect(p.lineId.startsWith("noon.")).toBe(true);
      expect(p.lineId.startsWith("noon.lapsed")).toBe(false);
    }
    const aOwnPush = pushes.find((p) => p.userId === a.userId);
    expect(aOwnPush?.lineId).not.toBe("noon.read-9"); // a was right everywhere
  });

  it("addresses each player by their DEVICE ids — the alias the client logs in as", async () => {
    // The client calls OneSignal.login(deviceId). Targeting user ids matched
    // nothing and every send would have been silently dropped.
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await resolveAll(db, qs);
    await settleRound(db, "2026-08-20");

    const [push] = await composeHingePushes(db, "2026-08-20");
    expect(push!.externalIds).toEqual([a.deviceId]);
    expect(push!.externalIds).not.toContain(a.userId);
  });

  it("composes nothing at all for a round that has not settled", async () => {
    // Obligation 2: the audience IS settleRound's stamp, so a batch cannot
    // exist for a round whose outcomes are not yet paid out.
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await resolveAll(db, qs);

    expect(await composeHingePushes(db, "2026-08-20")).toEqual([]);
  });

  it("never claims the ledger read a player whose every call voided", async () => {
    // Obligation 3: "results" is per-player, not per-round.
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const voided = await player(app);
    const scored = await player(app);
    await voided("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await scored("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await resolveQuestion(db, qs[0]!.id, "void");
    await resolveAll(db, qs.slice(1));
    await settleRound(db, "2026-08-20");

    const pushes = await composeHingePushes(db, "2026-08-20");
    const requires = (id: string) => (COPY.find((l) => l.id === id)?.requires ?? []) as string[];

    // The obligation is one-directional, and so is the assertion. A player
    // whose every call voided has "results" UNsatisfied, so no results line is
    // ever eligible to them -- that is a guarantee, and this is the test.
    const voidedPush = pushes.find((p) => p.userId === voided.userId)!;
    expect(requires(voidedPush.lineId)).not.toContain("results");
    expect(voidedPush.text).not.toMatch(/RESULT IS READY|NOW SETTLED|CROWD IS COUNTING/);

    // The scored player is the non-vacuity control, and it must NOT be
    // written as "they drew a results line". selectLine picks uniformly from
    // every ELIGIBLE line, and satisfying "results" only ADDS the results
    // lines to a pool that still holds every generic noon line -- so which
    // one a scored player draws is a hash of their randomly-minted user id,
    // not a property of the obligation. Asserting on that draw failed about
    // one run in eight, and passed the other seven for no better reason.
    //
    // What actually needs to hold is that the pools differ: results lines are
    // reachable once "results" is satisfied and unreachable before. That is a
    // fact about the bank, so assert it against the bank.
    const noon = COPY.filter((l) => l.pool === "noon");
    const eligible = (satisfied: string[]) =>
      noon.filter((l) => (l.requires ?? []).every((r) => satisfied.includes(r)));
    expect(eligible(["results"]).some((l) => (l.requires ?? []).includes("results"))).toBe(true);
    expect(eligible([]).every((l) => !(l.requires ?? []).includes("results"))).toBe(true);

    // And the scored player must still have been given a line at all.
    const scoredPush = pushes.find((p) => p.userId === scored.userId)!;
    expect(noon.some((l) => l.id === scoredPush.lineId)).toBe(true);
  });
});

describe("the lapsed line fires once per lapse, never daily", () => {
  // Obligation 1, and the reason this file used to be unwired: a lapsed
  // player pushed at every noon forever is the fastest way to be uninstalled.
  // Each round opens at noon ET on its own date and locks at noon the next,
  // so the clock has to walk with the fixture — a prediction filed after its
  // question's lock is a 409, not a prediction.
  const opens = (d: string) => new Date(`${d}T16:00:00Z`);

  async function playedDayOne() {
    vi.setSystemTime(new Date("2026-08-20T17:00:00Z"));
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const day1 = await seedRound(db, { date: "2026-08-20", opensAt: opens("2026-08-20"), locksAt: opens("2026-08-21") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(day1[0]!.id, true) });
    vi.setSystemTime(new Date("2026-08-21T17:00:00Z"));
    await resolveAll(db, day1);
    await settleRound(db, "2026-08-20");
    return { db, app, a };
  }

  async function playedRound(db: Awaited<ReturnType<typeof makeTestDb>>["db"], a: Awaited<ReturnType<typeof player>>, date: string) {
    vi.setSystemTime(new Date(`${date}T17:00:00Z`));
    const qs = await seedRound(db, { date, opensAt: opens(date), locksAt: opens(addDay(date)) });
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    vi.setSystemTime(new Date(`${addDay(date)}T17:00:00Z`));
    await resolveAll(db, qs);
    await settleRound(db, date);
  }

  async function silentRound(db: Awaited<ReturnType<typeof makeTestDb>>["db"], date: string) {
    const qs = await seedRound(db, { date, opensAt: opens(date), locksAt: opens(addDay(date)) });
    vi.setSystemTime(new Date(`${addDay(date)}T17:00:00Z`));
    await resolveAll(db, qs);
    await settleRound(db, date);
  }

  it("speaks on the day the silence starts", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { db, a } = await playedDayOne();
    await silentRound(db, "2026-08-21");

    const mine = (await composeHingePushes(db, "2026-08-21")).find((p) => p.userId === a.userId)!;
    expect(mine.lineId.startsWith("noon.lapsed")).toBe(true);
  });

  it("says nothing on the second, third and thirtieth consecutive miss", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { db, a } = await playedDayOne();
    await silentRound(db, "2026-08-21");
    expect((await composeHingePushes(db, "2026-08-21")).some((p) => p.userId === a.userId)).toBe(true);

    await silentRound(db, "2026-08-22");
    expect((await composeHingePushes(db, "2026-08-22")).some((p) => p.userId === a.userId)).toBe(false);
  });

  it("speaks again after the player comes back and lapses a second time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { db, a } = await playedDayOne();
    await silentRound(db, "2026-08-21");           // lapse one, spoken
    await playedRound(db, a, "2026-08-22");        // back at the ledger
    await silentRound(db, "2026-08-23");           // a fresh lapse

    const mine = (await composeHingePushes(db, "2026-08-23")).find((p) => p.userId === a.userId)!;
    expect(mine.lineId.startsWith("noon.lapsed")).toBe(true);
  });

  it("never greets a brand-new install as a lapsed player", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { db, app } = await playedDayOne();
    await player(app); // installed after day one, never played
    await silentRound(db, "2026-08-21");

    const lapsed = (await composeHingePushes(db, "2026-08-21")).filter((p) => p.lineId.startsWith("noon.lapsed"));
    expect(lapsed).toHaveLength(1); // the returning player only, never the stranger
  });
});

describe("claimResolutionPushes (design 2026-09-09 §2.1)", () => {
  async function seeded() {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const b = await player(app);
    const qs = await seedRound(db, { date: "2026-09-12", opensAt: new Date("2026-09-12T16:00:00Z"), locksAt: new Date("2026-09-13T16:00:00Z") });
    await db.insert(schema.predictions).values([
      { questionId: qs[0]!.id, userId: a.userId, answer: true, confidence: 75 },
      { questionId: qs[0]!.id, userId: b.userId, answer: false, confidence: 60 },
      { questionId: qs[1]!.id, userId: a.userId, answer: true, confidence: 55 },
    ]);
    return { db, qs, a, b };
  }

  it("returns nothing for an unresolved question and claims nothing", async () => {
    const { db, qs } = await seeded();
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt === null)).toBe(true);
  });

  it("composes one push per answering player with outcome, call and signed points, and stamps the claim", async () => {
    const { db, qs, a, b } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    const now = new Date("2026-09-13T20:00:00Z");
    const pushes = await claimResolutionPushes(db, qs[0]!.id, now);
    expect(pushes).toHaveLength(2);
    const mine = pushes.find((p) => p.userId === a.userId)!;
    expect(mine.text).toContain("YES");
    expect(mine.text).toContain("YES AT 75%");
    expect(mine.text).toMatch(/\+\d+\./);
    expect(mine.externalIds).toEqual([a.deviceId]);
    expect(mine.lineId.startsWith("resolve.")).toBe(true);
    expect(mine.text).not.toMatch(/[{}]/);
    const theirs = pushes.find((p) => p.userId === b.userId)!;
    expect(theirs.text).toContain("NO AT 60%");
    expect(theirs.text).toMatch(/-\d+\./);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt?.toISOString() === now.toISOString())).toBe(true);
  });

  it("is idempotent: a second claim returns nothing", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toHaveLength(2);
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
  });

  it("never pushes a void, and leaves the claim unset so nothing later mistakes it for sent", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "void", { reason: "test" });
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt === null)).toBe(true);
  });

  it("truncates a long question to a 70-char headline and keeps the whole text under 160", async () => {
    const { db, qs } = await seeded();
    await db.update(schema.questions).set({ text: "Will the S&P 500 close higher on Thursday, September 10 than it closed on Wednesday, September 9, per S&P Dow Jones Indices?" }).where(eq(schema.questions.id, qs[0]!.id));
    await resolveQuestion(db, qs[0]!.id, "no");
    const [p] = await claimResolutionPushes(db, qs[0]!.id, new Date());
    expect(p!.text.length).toBeLessThanOrEqual(160);
    expect(p!.text).toContain("…");
  });

  it("selects the line deterministically per user and question", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    const first = await claimResolutionPushes(db, qs[0]!.id, new Date());
    await db.update(schema.predictions).set({ resolvePushedAt: null }).where(eq(schema.predictions.questionId, qs[0]!.id));
    const second = await claimResolutionPushes(db, qs[0]!.id, new Date());
    expect(second.map((p) => p.lineId)).toEqual(first.map((p) => p.lineId));
  });

  it("waits for the row's points, not only the question's outcome, since resolveQuestion writes them separately", async () => {
    const { db, qs } = await seeded();
    // Simulate the mid-flight state: outcome written, per-row points not yet
    // scored (resolveQuestion has no transaction across those two writes).
    await db.update(schema.questions).set({ outcome: "yes", status: "resolved" }).where(eq(schema.questions.id, qs[0]!.id));
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt === null)).toBe(true);

    await db.update(schema.predictions).set({ points: 10 }).where(eq(schema.predictions.questionId, qs[0]!.id));
    const pushes = await claimResolutionPushes(db, qs[0]!.id, new Date());
    expect(pushes).toHaveLength(2);
    for (const p of pushes) expect(p.text).toMatch(/\+10\./);
  });
});

describe("headline (audit finding G)", () => {
  it("never splits a surrogate pair when truncating an emoji-bearing question", () => {
    // 80 code points total, with the emoji sitting right at the UTF-16
    // truncation boundary (index 68) a code-unit-based slice(0, 69) would cut
    // through — the emoji is two UTF-16 units, so that slice keeps its high
    // surrogate and drops its low surrogate, leaving a lone surrogate behind.
    const text = `${"a".repeat(68)}😀${"a".repeat(11)}`;
    const result = headline(text);
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("sendPushes", () => {
  it("no-ops cleanly without OneSignal keys — the state until the account exists", async () => {
    const out = await sendPushes({}, [{ externalIds: ["d1"], text: "THE LEDGER IS READ." }]);
    expect(out).toEqual({ sent: 0, skipped: 1 });
  });

  it("skips the push rather than aborting the batch when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    try {
      const out = await sendPushes({ ONESIGNAL_APP_ID: "app", ONESIGNAL_API_KEY: "key" }, [
        { externalIds: ["d1"], text: "THE LEDGER IS READ." },
        { externalIds: ["d2"], text: "WHAT WAS SEALED IS NOW SETTLED." },
      ]);
      expect(out).toEqual({ sent: 0, skipped: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("addresses a player's devices as aliases, and never calls out for a player with none", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const out = await sendPushes({ ONESIGNAL_APP_ID: "app", ONESIGNAL_API_KEY: "key" }, [
        { externalIds: ["d1", "d2"], text: "THE LEDGER IS READ." },
        { externalIds: [], text: "NOBODY IS LISTENING." },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(sent.include_aliases).toEqual({ external_id: ["d1", "d2"] });
      expect(sent.app_id).toBe("app");
      expect(out).toEqual({ sent: 1, skipped: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
