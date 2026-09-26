import { describe, it, expect, vi, afterEach } from "vitest";
import { and, eq, ne } from "drizzle-orm";
import { TodayLogSchema, RoundTodaySchema } from "@oracle/core";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-25";
afterEach(() => vi.useRealTimers());

async function world() {
  vi.useFakeTimers({ now: new Date("2026-09-25T17:00:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
  // Column writes ahead of the round commit: guard_oracle_question_commitment
  // (migration 0009) freezes source_name/text/etc on `questions` once
  // rounds.oracle_committed_at is set, so the line/crowd/seen-on/unhinged
  // fields land before the round's commit stamp, matching the pipeline's own
  // order (draft, then commit_council).
  // qs[2] is left lineless (guard_house_line makes line_p_yes immutable once
  // set, including back to null, so the "no Council rows" test below relies
  // on this one staying untouched rather than being nulled out later).
  await db.update(schema.questions).set({ linePYes: "0.38", marketSource: "crowd", sourceName: "THE PLAYERS" }).where(and(eq(schema.questions.roundDate, DATE), ne(schema.questions.id, qs[2]!.id)));
  // qs[2] still needs crowd/source_name — just not a line — so it gets its
  // own statement that leaves line_p_yes untouched.
  await db.update(schema.questions).set({ marketSource: "crowd", sourceName: "THE PLAYERS" }).where(eq(schema.questions.id, qs[2]!.id));
  await db.update(schema.questions).set({ seenOnLabel: "r/unpopularopinion", seenOnUrl: "https://r/x", unhinged: true }).where(eq(schema.questions.id, qs[3]!.id));
  await db.update(schema.rounds).set({ rulesVersion: 3, oracleCommittedAt: new Date("2026-09-25T13:00:00Z") }).where(eq(schema.rounds.date, DATE));
  await db.insert(schema.lines).values([
    { questionId: qs[0]!.id, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "no chance" },
    { questionId: qs[0]!.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-25T13:00:01Z"), model: "m", promptVersion: "council-v2", reasoning: "Four reasons." },
    { questionId: qs[1]!.id, member: "sonnet", pYes: "0.55", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "Close." },
  ]);
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const as = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const seal = (qid: string, answer: boolean) => as("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence: 75, idempotency_key: `k-${qid}` }) });
  return { db, app, qs, as, seal };
}

describe("GET /v1/round/today (design 2026-09-25 §11)", () => {
  it("carries the shift clock and each take's provenance, and serves the line only once the caller has sealed", async () => {
    const { qs, as, seal } = await world();
    const before = RoundTodaySchema.parse(await (await as("/v1/round/today")).json());
    expect(before.council_committed_at).toBe("2026-09-25T13:00:00.000Z");
    expect(before.questions.every((q) => q.crowd)).toBe(true);
    expect(before.questions.every((q) => q.line_p_yes === null)).toBe(true);
    expect(before.questions.find((q) => q.slot === 4)).toMatchObject({ unhinged: true, seen_on: { label: "r/unpopularopinion", url: "https://r/x" } });
    expect(before.questions.find((q) => q.slot === 1)).toMatchObject({ unhinged: false, seen_on: null });
    await seal(qs[0]!.id, true);
    const after = RoundTodaySchema.parse(await (await as("/v1/round/today")).json());
    expect(after.questions.find((q) => q.slot === 1)!.line_p_yes).toBe(0.38);
    expect(after.questions.find((q) => q.slot === 2)!.line_p_yes).toBeNull();
  });
});

describe("GET /v1/round/today/log (design 2026-09-25 §6.2)", () => {
  it("serves the log only for the caller's sealed questions, ordered by commit time, mute before lock", async () => {
    const { qs, as, seal } = await world();
    await seal(qs[0]!.id, true);
    const out = TodayLogSchema.parse(await (await as("/v1/round/today/log")).json());
    expect(out.questions.map((q) => q.question_id)).toEqual([qs[0]!.id]);
    const q = out.questions[0]!;
    expect(q.line_p_yes).toBe(0.38);
    expect(q.log.map((l) => [l.member, l.p_yes, l.tone, l.kind])).toEqual([["haiku", 0.31, "mute", "say"], ["opus", 0.7, "mute", "say"]]);
    expect(q.log[0]!.at).toBe("2026-09-25T13:00:00.000Z");
    expect(q.log[0]!.text).toBe("no chance");
  });
  it("is empty when nothing is sealed and 404 with no open round", async () => {
    const { as } = await world();
    expect(TodayLogSchema.parse(await (await as("/v1/round/today/log")).json()).questions).toEqual([]);
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    expect((await as("/v1/round/today/log")).status).toBe(404);
  });
  it("a sealed question with no Council rows has an empty log and a null line", async () => {
    const { qs, as, seal } = await world();
    // qs[2] is lineless by construction (world() skips it — see the comment
    // there) and carries no lines rows, so no `db` handle is needed here.
    await seal(qs[2]!.id, false);
    const out = TodayLogSchema.parse(await (await as("/v1/round/today/log")).json());
    expect(out.questions).toEqual([{ question_id: qs[2]!.id, line_p_yes: null, log: [] }]);
  });
});
