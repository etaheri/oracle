import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { RevealSchema } from "@oracle/core";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";
afterEach(() => vi.useRealTimers());

async function world() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const token = ((await res.json()) as { token: string }).token;
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40", oracleProbYes: "0.35" }).where(eq(schema.questions.roundDate, DATE));
  const q = qs[0]!;
  await db.insert(schema.lines).values([
    { questionId: q.id, member: "haiku", pYes: "0.44", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Haiku's route.", cited: [2], lessonsReceived: [] },
    { questionId: q.id, member: "sonnet", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Sonnet's route.", cited: [1, 2], lessonsReceived: ["5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e"] },
    { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
  ]);
  await db.insert(schema.evidence).values([1, 2].map((rank) => ({ questionId: q.id, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", publishedAt: rank === 1 ? new Date("2026-09-09T00:00:00Z") : null, highlight: `H${rank}.`, retrievedAt: new Date("2026-09-10T14:00:00Z") })));
  const get = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return { db, app, qs, get };
}

describe("the reveal's council and evidence (spec §13)", () => {
  it("carries entries in member order with the right-side verdict, and the pack, after lock", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T02:00:00Z"), toFake: ["Date"] });
    const { db, qs, get } = await world();
    await db.update(schema.questions).set({ status: "resolved", outcome: "no" }).where(eq(schema.questions.id, qs[0]!.id));
    const r = RevealSchema.parse(await (await get(`/v1/round/${DATE}/reveal`)).json());
    const mine = r.council.filter((e) => e.question_id === qs[0]!.id);
    expect(mine.map((e) => e.member)).toEqual(["sonnet", "haiku", "market"]);
    expect(mine[0]).toMatchObject({ p_yes: 0.40, on_right_side: true, reasoning: "Sonnet's route.", cited: [1, 2], lessons_received: 1 });
    expect(mine[2]).toMatchObject({ member: "market", reasoning: null, cited: [], lessons_received: 0 });
    expect(r.evidence.map((e) => e.rank)).toEqual([1, 2]);
    expect(r.evidence[0]!.published_at).toBe("2026-09-09T00:00:00.000Z");
    expect(r.evidence[1]!.published_at).toBeNull();
  });
  it("marks an undecided question's members null and a 0.5 line null", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T17:00:00Z"), toFake: ["Date"] });
    const { db, qs, get } = await world();
    await db.insert(schema.lines).values({ questionId: qs[1]!.id, member: "opus", pYes: "0.5", committedAt: new Date("2026-09-10T14:00:00Z") });
    await db.update(schema.questions).set({ status: "resolved", outcome: "yes" }).where(eq(schema.questions.id, qs[1]!.id));
    const r = RevealSchema.parse(await (await get(`/v1/round/${DATE}/reveal`)).json());
    expect(r.council.find((e) => e.question_id === qs[0]!.id && e.member === "sonnet")!.on_right_side).toBeNull();
    expect(r.council.find((e) => e.question_id === qs[1]!.id)!.on_right_side).toBeNull();
  });
  it("is empty before lock, because the reveal itself is", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T18:00:00Z"), toFake: ["Date"] });
    const { get } = await world();
    expect((await get(`/v1/round/${DATE}/reveal`)).status).toBe(409);
  });
});

describe("GET /admin/rounds/:date", () => {
  it("counts lines and evidence per question", async () => {
    const { app, qs } = await world();
    const json = (await (await app.request(`/admin/rounds/${DATE}`, { headers: { "x-admin-secret": "admin" } })).json()) as { questions: { id: string; lines: number; evidence: number }[] };
    expect(json.questions.find((q) => q.id === qs[0]!.id)).toMatchObject({ lines: 3, evidence: 2 });
    expect(json.questions.find((q) => q.id === qs[4]!.id)).toMatchObject({ lines: 0, evidence: 0 });
  });
});
