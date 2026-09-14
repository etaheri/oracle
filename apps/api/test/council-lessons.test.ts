import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { writeLessons } from "../src/pipeline/council/lessons";
import { createApp } from "../src/app";

const DATE = "2026-09-10";
const NOW = new Date("2026-09-12T02:00:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { lesson: "m-lesson" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function settled(outcome: "yes" | "no" | "void" = "yes", rulesVersion = 3) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion, status: "locked" }).where(eq(schema.rounds.date, DATE));
  const q = rows[0]!;
  await db.update(schema.questions).set({ status: outcome === "void" ? "void" : "resolved", outcome, resolvedAt: new Date("2026-09-12T01:00:00Z"), marketSeriesKey: "KXHIGHNY", linePYes: "0.4" }).where(eq(schema.questions.id, q.id));
  await db.insert(schema.lines).values([
    { questionId: q.id, member: "sonnet", pYes: "0.30", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Sonnet's route." },
    { questionId: q.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Opus's route." },
    { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
  ]);
  return { db, q };
}

describe("writeLessons (spec §8)", () => {
  it("writes one lesson per model member with a line, keyed on the series, dated by the question's settlement", async () => {
    const { db, q } = await settled("yes");
    const calls: StructuredCall[] = [];
    const r = await writeLessons(makeDeps(db, { structured: async (c) => { calls.push(c); return { text: `Lesson for ${c.user.includes("0.3") ? "sonnet" : "opus"}.` }; } }), q.id);
    expect(r).toEqual({ questionId: q.id, written: 2, skipped: 0 });
    expect(calls.length).toBe(2);
    expect(calls[0]!.model).toBe("m-lesson");
    expect(calls[0]!.webSearch).toBeUndefined();
    expect(calls[0]!.user).toContain("Sonnet's route.");
    expect(calls[0]!.user).toContain("OUTCOME: YES");
    const rows = await db.query.lessons.findMany({ orderBy: (l, { asc }) => [asc(l.member)] });
    expect(rows.map((l) => l.member)).toEqual(["opus", "sonnet"]);
    expect(rows[0]!.seriesKey).toBe("KXHIGHNY");
    expect(rows[0]!.resolvedAt.toISOString()).toBe("2026-09-12T01:00:00.000Z");
    expect(rows[0]!.text).toMatch(/^Lesson for/);
  });

  it("never writes twice, and skips members that already have one", async () => {
    const { db, q } = await settled("no");
    const deps = makeDeps(db, { structured: async () => ({ text: "L." }) });
    await writeLessons(deps, q.id);
    const again = await writeLessons(deps, q.id);
    expect(again).toEqual({ questionId: q.id, written: 0, skipped: 2 });
    expect((await db.query.lessons.findMany()).length).toBe(2);
  });

  it("writes nothing for a void, an unresolved question, or a version 2 round", async () => {
    for (const [outcome, version] of [["void", 3], ["yes", 2]] as const) {
      const { db, q } = await settled(outcome, version);
      const r = await writeLessons(makeDeps(db, { structured: async () => { throw new Error("must not be called"); } }), q.id);
      expect(r.written).toBe(0);
      expect((await db.query.lessons.findMany()).length).toBe(0);
    }
  });

  it("a failed call is an error value, not a throw, and the other member still writes", async () => {
    const { db, q } = await settled("yes");
    const r = await writeLessons(makeDeps(db, { structured: async (c) => { if (c.user.includes("Opus")) throw new Error("down"); return { text: "L." }; } }), q.id);
    expect(r.written).toBe(1);
    expect(r.error).toContain("opus: down");
  });

  it("falls back to the category when the question has no series key", async () => {
    const { db, q } = await settled("yes");
    await db.update(schema.questions).set({ marketSeriesKey: null }).where(eq(schema.questions.id, q.id));
    await writeLessons(makeDeps(db, { structured: async () => ({ text: "L." }) }), q.id);
    expect((await db.query.lessons.findFirst())!.seriesKey).toBe("news");
  });

  it("never throws — a failing read is an error value too, not a throw", async () => {
    const { db, q } = await settled("yes");
    const failingDb = {
      ...db,
      query: { ...db.query, questions: { ...db.query.questions, findFirst: async () => { throw new Error("db down"); } } },
    } as unknown as TestDb;
    const r = await writeLessons(makeDeps(failingDb, { structured: async () => ({ text: "L." }) }), q.id);
    expect(r.written).toBe(0);
    expect(r.error).toContain("db down");
  });
});

describe("the admin lessons routes", () => {
  it("lists newest first, filters by member and series, and deletes one", async () => {
    const { db, q } = await settled("yes");
    await writeLessons(makeDeps(db, { structured: async () => ({ text: "L." }) }), q.id);
    const app = createApp({ db, env: { DEVICE_TOKEN_SECRET: "s", ADMIN_SECRET: "admin" } });
    const h = { "x-admin-secret": "admin" };
    const all = (await (await app.request("/admin/lessons", { headers: h })).json()) as { lessons: { id: string; member: string; series_key: string; text: string }[] };
    expect(all.lessons.length).toBe(2);
    const opus = (await (await app.request("/admin/lessons?member=opus", { headers: h })).json()) as { lessons: { id: string }[] };
    expect(opus.lessons.length).toBe(1);
    expect((await app.request(`/admin/lessons/${opus.lessons[0]!.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await db.query.lessons.findMany()).length).toBe(1);
    expect((await app.request("/admin/lessons")).status).toBe(401);
  });
});
