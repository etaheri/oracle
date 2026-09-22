import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { StandingsSchema } from "@oracle/core";
import { loadSettledCalls, standings, standingsCsv, standingsHtml } from "../src/standings";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

// One settled version 3 round: five questions, lines for sonnet, opus and
// market on each, one player staked YES 50 on every card, slots 1-4 YES and
// slot 5 NO, plus a void slot in a second round that must be ignored.
async function settledWorld() {
  const { db } = await makeTestDb();
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "resolved" }).where(eq(schema.rounds.date, DATE));
  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  for (const q of qs) {
    const outcome = q.slot === 5 ? "no" : "yes";
    await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40", oracleProbYes: "0.35", marketSource: "kalshi", marketId: `T${q.slot}`, status: "resolved", outcome, crowdYesPct: "60", crowdCount: 10 }).where(eq(schema.questions.id, q.id));
    await db.insert(schema.lines).values([
      { questionId: q.id, member: "sonnet", pYes: "0.30", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "R." },
      { questionId: q.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "R." },
      { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
    ]);
    await db.insert(schema.predictions).values({ questionId: q.id, userId: user!.id, answer: true, confidence: 75, stake: 50, linePYes: "0.35", fortuneAtSeal: 1000, payout: outcome === "yes" ? 143 : 0, settledAt: new Date() });
  }
  // A void question in a second round: never a call.
  const other = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "resolved" }).where(eq(schema.rounds.date, "2026-09-09"));
  await db.update(schema.questions).set({ linePYes: "0.5", status: "void", outcome: "void" }).where(eq(schema.questions.id, other[0]!.id));
  await db.insert(schema.lines).values({ questionId: other[0]!.id, member: "sonnet", pYes: "0.5", committedAt: new Date("2026-09-09T14:00:00Z") });
  return { db, qs };
}

describe("loadSettledCalls", () => {
  it("returns only settled version 3 questions with a line and a yes/no outcome", async () => {
    const { db } = await settledWorld();
    const calls = await loadSettledCalls(db);
    expect(calls.length).toBe(5);
    expect(calls.map((c) => c.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(calls[0]!.lines.map((l) => l.member).sort()).toEqual(["market", "opus", "sonnet"]);
    expect(calls[0]!.predictions).toEqual([{ answer: true, stake: 50 }]);
  });
});

describe("standings", () => {
  it("scores every member, the crowd and the market, in order", async () => {
    const { db } = await settledWorld();
    const s = standings(await loadSettledCalls(db), new Date("2026-09-11T12:00:00Z"));
    expect(s.rows.map((r) => r.member)).toEqual(["sonnet", "opus", "haiku", "market", "crowd"]);
    expect(s.rounds).toBe(1);
    expect(s.questions).toBe(5);
    const sonnet = s.rows[0]!;
    // Four YES at 0.30 → 0.49 each; one NO at 0.30 → 0.09.
    expect(sonnet.calls).toBe(5);
    expect(sonnet.brier).toBeCloseTo((4 * 0.49 + 0.09) / 5, 10);
    // Sonnet's 0.30 sits inside the band around 0.40, so it prices as is. Player YES 50 at 0.30 pays 50 + round(50 × 0.7/0.3) = 167 → house −117 on four cards, +50 on the fifth.
    expect(sonnet.house_delta).toBe(-468 + 50);
    expect(s.rows[2]).toEqual({ member: "haiku", calls: 0, brier: null, house_delta: 0 });
    const crowd = s.rows[4]!;
    expect(crowd.calls).toBe(5);
    expect(crowd.brier).toBeCloseTo((4 * 0.16 + 0.36) / 5, 10);
  });
});

describe("the CSV", () => {
  it("has the stated columns, one row per call and member, and no player fields", async () => {
    const { db } = await settledWorld();
    const csv = standingsCsv(await loadSettledCalls(db));
    const [header, ...rows] = csv.trim().split("\n");
    expect(header).toBe("date,slot,question,market_source,market_id,market_prob,member,member_line,house_line,crowd_yes_pct,crowd_count,outcome");
    expect(rows.length).toBe(15);
    expect(rows[0]).toBe("2026-09-10,1,Question 1?,kalshi,T1,0.4,sonnet,0.3,0.35,60,10,yes");
    expect(csv).not.toMatch(/user|stake|payout/);
  });
  it("quotes a question containing a comma or a quote", async () => {
    const { db, qs } = await settledWorld();
    await db.update(schema.questions).set({ text: 'Will "it", happen?' }).where(eq(schema.questions.id, qs[0]!.id));
    const csv = standingsCsv(await loadSettledCalls(db));
    expect(csv.split("\n")[1]).toContain('"Will ""it"", happen?"');
  });
});

describe("the routes", () => {
  it("serve JSON, CSV and HTML without a device token", async () => {
    const { db } = await settledWorld();
    const app = createApp({ db, env });
    const json = await app.request("/v1/standings");
    expect(json.status).toBe(200);
    expect(json.headers.get("cache-control")).toBe("public, max-age=300");
    const parsed = StandingsSchema.parse(await json.json());
    expect(parsed.rows.length).toBe(5);
    const csv = await app.request("/v1/standings?format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect((await csv.text()).split("\n")[0]).toMatch(/^date,slot/);
    const html = await app.request("/standings");
    expect(html.headers.get("content-type")).toContain("text/html");
    const body = await html.text();
    expect(body).toContain("<table");
    expect(body).toContain("Sonnet");
    expect(body).toContain("/v1/standings?format=csv");
  });
  it("renders an empty record", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const s = StandingsSchema.parse(await (await app.request("/v1/standings")).json());
    expect(s.rows.every((r) => r.calls === 0)).toBe(true);
    expect((await app.request("/standings")).status).toBe(200);
  });

  it("footnotes the crowd as the baseline on opinion rounds (design 2026-09-22 §7)", () => {
    const html = standingsHtml(standings([], new Date("2026-09-24T17:00:00Z")));
    expect(html).toContain("On opinion rounds the players are the answer, so their row is the baseline the machines are measured against.");
  });
});
