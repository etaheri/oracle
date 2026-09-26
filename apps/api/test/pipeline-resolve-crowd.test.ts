import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { PIPELINE_LINES } from "@oracle/core";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveOne, resolveFromCrowd, runResolution, CROWD_RESOLVE_MIN } from "../src/pipeline/resolve";
import { claimResolutionPushes } from "../src/push/compose";
import { loadPipelineState } from "../src/pipeline/state";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";

const DATE = "2026-09-23";
const LOCK = new Date("2026-09-24T16:00:00Z");

async function world(answers: boolean[], opts: { locked?: boolean; now?: string } = {}) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-23T16:00:00Z"), locksAt: LOCK });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: opts.locked === false ? "open" : "locked" }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({
    status: opts.locked === false ? "open" : "locked", marketSource: "crowd", marketId: DATE, marketClosesAt: LOCK, linePYes: "0.38", sourceName: "THE PLAYERS",
  }).where(eq(schema.questions.roundDate, DATE));
  await db.update(schema.questions).set({ marketEventKey: "1" }).where(eq(schema.questions.id, rows[0]!.id));
  const users: string[] = [];
  for (const answer of answers) {
    const [u] = await db.insert(schema.users).values({ fortune: 1000 }).returning({ id: schema.users.id });
    users.push(u!.id);
    await db.insert(schema.devices).values({ userId: u!.id, installTokenHash: "h", platform: "ios" });
    await db.insert(schema.predictions).values({ questionId: rows[0]!.id, userId: u!.id, answer, confidence: 75, stake: 50, linePYes: "0.38", fortuneAtSeal: 1000 });
  }
  const calls: string[] = [];
  const deps: PipelineDeps = {
    db, telegram: { send: async () => {} },
    claude: { structured: async (call) => { calls.push(call.schemaName); return {}; } },
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", taste: "t", voice: "v" },
    now: () => new Date(opts.now ?? "2026-09-24T16:10:00Z"), workflows: inlineStarter(), siteUrl: "https://example.test",
    exchangeFeeds: [{ source: "kalshi", list: async () => [], read: async () => { throw new Error("no exchange read on a crowd question"); } }],
    marketFetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch,
    crowdResolveMin: 1,
  };
  return { db, deps, qId: rows[0]!.id, users, calls };
}

describe("resolveFromCrowd (design 2026-09-22 §6.1)", () => {
  it("resolves YES on a majority and writes the room's share as evidence", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    expect(await resolveFromCrowd(deps, qId)).toBe(true);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("resolved");
    expect(q!.outcome).toBe("yes");
    expect(Number(q!.crowdYesPct)).toBe(67);
    expect(q!.crowdCount).toBe(3);
    expect(q!.resolutionEvidence).toEqual({
      resolver: "crowd", crowd_yes_pct: 67, crowd_count: 3, checked_at: "2026-09-24T16:10:00.000Z",
      quotes: [{ quote: "67% of 3 players said YES.", url: "https://example.test/play" }],
    });
    // Paid at the line's odds (T8): YES at 0.38 wins 50 × 0.62/0.38 ≈ 82 on top of the stake.
    const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qId) });
    expect(preds.filter((p) => p.answer).every((p) => p.payout! > 50)).toBe(true);
    expect(preds.filter((p) => !p.answer).every((p) => p.payout === 0)).toBe(true);
  });
  it("resolves NO on a minority", async () => {
    const { db, deps, qId } = await world([true, false, false]);
    await resolveFromCrowd(deps, qId);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.outcome).toBe("no");
    expect((q!.resolutionEvidence as { quotes: { quote: string }[] }).quotes[0]!.quote).toBe("33% of 3 players said YES.");
  });
  it("voids an exact split", async () => {
    const { db, deps, qId } = await world([true, false]);
    expect(await resolveFromCrowd(deps, qId)).toBe(true);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("void");
    expect(q!.resolutionEvidence).toMatchObject({ resolver: "crowd", reason: PIPELINE_LINES.crowdSplit, crowd_yes_pct: 50, crowd_count: 2 });
    const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qId) });
    expect(preds.every((p) => p.payout === 50)).toBe(true); // stake returned
  });
  it("voids when below the floor of 4 and honours the configured floor", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    deps.crowdResolveMin = 4;
    expect(await resolveFromCrowd(deps, qId)).toBe(true);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("void");
    expect(q!.resolutionEvidence).toMatchObject({ resolver: "crowd", reason: PIPELINE_LINES.crowdTooFew, crowd_count: 3 });
  });
  it("voids a three-player room at the default floor of 20", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    delete deps.crowdResolveMin;
    expect(await resolveFromCrowd(deps, qId)).toBe(true);
    expect((await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) }))!.outcome).toBe("void");
  });
  it("does nothing before the lock, and nothing on an already-resolved row", async () => {
    const early = await world([true, true], { now: "2026-09-24T15:59:00Z" });
    expect(await resolveFromCrowd(early.deps, early.qId)).toBe(false);
    expect((await early.db.query.questions.findFirst({ where: eq(schema.questions.id, early.qId) }))!.status).toBe("locked");
    const open = await world([true, true], { locked: false });
    expect(await resolveFromCrowd(open.deps, open.qId)).toBe(false);
    const done = await world([true, true]);
    await resolveFromCrowd(done.deps, done.qId);
    expect(await resolveFromCrowd(done.deps, done.qId)).toBe(false);
  });
  it("stamps resolve_pushed_at so no per-question push is ever composed (T7)", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    await resolveFromCrowd(deps, qId);
    const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qId) });
    expect(preds.every((p) => p.resolvePushedAt !== null)).toBe(true);
    expect(await claimResolutionPushes(db, qId, deps.now())).toEqual([]);
  });
});

describe("resolveOne on a crowd question", () => {
  it("routes to the crowd, never to an exchange read or a model, and composes no push", async () => {
    const { db, deps, qId, calls } = await world([true, false, false]);
    const r = await resolveOne(deps, qId);
    expect(r).toMatchObject({ questionId: qId, resolved: true, pushed: 0 });
    expect(calls).toEqual([]);
    expect((await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) }))!.outcome).toBe("no");
  });
});

describe("the tick's view of a crowd question", () => {
  it("never lists a crowd question among the model ids, so it resolves on the first tick after lock", async () => {
    const { db, qId } = await world([true]);
    const st = await loadPipelineState(db, new Date("2026-09-24T16:10:00Z"), true);
    expect(st.lockedRound!.unresolvedIds).toContain(qId);
    expect(st.lockedRound!.modelIds).not.toContain(qId);
  });
});

describe("reactions on the inline path (design 2026-09-25 §9)", () => {
  it("writes reactions after the crowd resolves, before lessons, and narrates the count", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    await db.insert(schema.lines).values([
      { questionId: qId, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-23T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "no" },
      { questionId: qId, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-23T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "yes" },
    ]);
    const order: string[] = [];
    const sent: string[] = [];
    deps.telegram = { send: async (t) => { sent.push(t); } };
    deps.claude = {
      async structured(call) {
        order.push(call.schemaName);
        if (call.schemaName === "reaction") return { text: "ok the room is wrong" };
        if (call.schemaName === "taste_verdicts") return { verdicts: [{ index: 0, allowed: true, reason: "" }] };
        if (call.schemaName === "lesson") return { text: "L." };
        throw new Error(`unexpected ${call.schemaName}`);
      },
    };
    await runResolution(deps, DATE, [qId]);
    expect(order).toEqual(["reaction", "taste_verdicts", "lesson", "lesson"]);
    const rows = await db.query.reactions.findMany();
    expect(rows.map((r) => r.member)).toEqual(["haiku"]);
    expect(sent.some((t) => t.includes("reactions: 1 written, 0 dropped"))).toBe(true);
  });
});
