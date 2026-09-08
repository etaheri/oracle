import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { probeQuestion, runProbe, probeOne, narrateProbe } from "../src/pipeline/probe";
import { publish } from "../src/pipeline/actions";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";
import { meterClaude, BudgetExhausted, PIPELINE_DAILY_CALL_BUDGET } from "../src/pipeline/spend";

const OPENS = new Date("2026-09-04T16:00:00Z");
const LOCKS = new Date("2026-09-05T16:00:00Z");
const ANSWERED = { outcome: "yes", quotes: [{ url: "https://example.com/x", quote: "final score 3-1" }], reasoning: "done" };
const NOT_YET = { outcome: "unverifiable", quotes: [], reasoning: "not yet" };

async function seedOpen(db: PipelineDeps["db"], locksAt = LOCKS) {
  await db.insert(schema.rounds).values({ date: "2026-09-04", status: "open" });
  return db.insert(schema.questions).values({
    roundDate: "2026-09-04", slot: 1, text: "Will they win?", category: "sports",
    resolutionCriteria: "the official box score", sourceName: "SRC",
    sourceUrl: "https://example.com/x", opensAt: OPENS, locksAt, resolveBy: LOCKS,
    status: "open",
  }).returning();
}

function deps(db: PipelineDeps["db"], reply: unknown, nowIso = "2026-09-04T20:00:00Z", sent: string[] = []): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async (t) => void sent.push(t) },
    claude: { structured: async () => reply },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date(nowIso),
  };
}

describe("probeQuestion — the lock moves to the information", () => {
  it("pulls the lock forward to now and stamps lock_healed_at when the answer appears", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, ANSWERED), q!.id)).toBe(true);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.toISOString()).toBe("2026-09-04T20:00:00.000Z");
    expect(row!.lockHealedAt).not.toBeNull();
  });

  it("leaves everything alone when the source still cannot answer", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, NOT_YET), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(LOCKS.getTime());
    expect(row!.lockHealedAt).toBeNull();
  });

  it("treats a ruling with no receipts as no answer", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, { outcome: "yes", quotes: [], reasoning: "vibes" }), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(LOCKS.getTime());
  });

  it("NEVER moves a lock later", async () => {
    const { db } = await makeTestDb();
    const early = new Date("2026-09-04T18:00:00Z");
    const [q] = await seedOpen(db, early);
    // now is 20:00, two hours PAST an already-early lock.
    await probeQuestion(deps(db, ANSWERED), q!.id);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(early.getTime());
  });

  it("never moves a lock later, over a spread of lock times and probe times", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04", status: "open" });
    for (const lockOffsetH of [1, 4, 9, 16, 23]) {
      for (const probeOffsetH of [0.5, 3, 8, 15, 22]) {
        const locksAt = new Date(OPENS.getTime() + lockOffsetH * 3_600_000);
        const probeAt = new Date(OPENS.getTime() + probeOffsetH * 3_600_000);
        const [q] = await db.insert(schema.questions).values({
          roundDate: "2026-09-04", slot: 2, text: "Will they win?", category: "sports",
          resolutionCriteria: "box score", sourceName: "SRC", sourceUrl: "https://example.com/x",
          opensAt: OPENS, locksAt, resolveBy: LOCKS, status: "open",
        }).returning();
        await probeQuestion(deps(db, ANSWERED, probeAt.toISOString()), q!.id);
        const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
        expect(row!.locksAt.getTime(), `lock+${lockOffsetH}h probe+${probeOffsetH}h`).toBeLessThanOrEqual(locksAt.getTime());
      }
    }
  });

  it("does nothing to a question that is no longer open", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.id, q!.id));
    expect(await probeQuestion(deps(db, ANSWERED), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.lockHealedAt).toBeNull();
  });

  it("leaves lock_healed_at NULL on an authored early lock, which is the column's whole point", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04", status: "scheduled" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-04", slot: 1, text: "Will they win?", category: "sports",
      resolutionCriteria: "box score", sourceName: "SRC", sourceUrl: "https://example.com/x",
      opensAt: OPENS, locksAt: new Date("2026-09-04T22:00:00Z"), resolveBy: LOCKS, status: "scheduled",
    }).returning();
    await publish(db, { send: async () => {} }, "2026-09-04");
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.toISOString()).toBe("2026-09-04T22:00:00.000Z"); // early, as authored
    expect(row!.lockHealedAt).toBeNull();                                 // and NOT healed
  });

  it("reports no heal when the round locked while the probe was in flight", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);
    // The lock lands mid-call: the read saw "open", the write will see "locked".
    d.claude = {
      structured: async () => {
        await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.id, q!.id));
        return ANSWERED;
      },
    };
    expect(await probeQuestion(d, q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(LOCKS.getTime());
    expect(row!.lockHealedAt).toBeNull();
    expect((await runProbe(d, "2026-09-04", [q!.id])).filter((o) => o.healed)).toHaveLength(0);
    expect(sent.join("\n")).not.toContain("closed early");
  });
});

describe("runProbe", () => {
  it("returns how many locks it healed and narrates each one", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const outcomes = await runProbe(deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent), "2026-09-04", [q!.id]);
    expect(outcomes.filter((o) => o.healed)).toHaveLength(1);
    expect(sent.join("\n")).toContain("closed early");
  });

  it("keeps probing the rest when one probe throws", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);
    const outcomes = await runProbe(d, "2026-09-04", ["00000000-0000-0000-0000-000000000000", q!.id]);
    expect(outcomes.filter((o) => o.healed)).toHaveLength(1);
    expect(sent.join("\n")).toContain("probe failed");
  });

  it("rethrows BudgetExhausted instead of narrating it per question — a spent budget stops the DAY", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);
    d.claude = meterClaude(db, d.claude!, "2026-09-04");
    await expect(runProbe(d, "2026-09-04", [q!.id, q!.id])).rejects.toBeInstanceOf(BudgetExhausted);
    expect(sent.filter((t) => t.includes("probe failed"))).toHaveLength(0);
  });
});

describe("probeOne and narrateProbe (design 2026-09-08 §3.3, §5.2)", () => {
  it("probeOne returns the slot and text a narrator needs, without narrating", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);

    const out = await probeOne(d, q!.id);
    expect(out.healed).toBe(true);
    expect(out.slot).toBeTypeOf("number");
    expect(out.text).toBeTypeOf("string");
    // A step returns a SUMMARY. Narration is a separate, terminal step, so
    // probeOne must not send anything itself.
    expect(sent).toEqual([]);
  });

  it("probeOne captures a failure instead of throwing it", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const d = deps(db, ANSWERED);
    d.claude = { structured: async () => { throw new Error("upstream 503"); } };
    const out = await probeOne(d, q!.id);
    expect(out).toEqual({ questionId: q!.id, healed: false, error: "upstream 503" });
  });

  it("probeOne still propagates a spent budget", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    const d = deps(db, ANSWERED);
    d.claude = meterClaude(db, d.claude!, "2026-09-04");
    await expect(probeOne(d, q!.id)).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it("narrateProbe sends one line per heal and nothing when none healed", async () => {
    const { db } = await makeTestDb();
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);

    await narrateProbe(d, "2026-09-08", [{ questionId: "q1", healed: false }]);
    expect(sent).toEqual([]);

    await narrateProbe(d, "2026-09-08", [
      { questionId: "q1", healed: true, slot: 3, text: "Will it rain?" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("slot 3");
    expect(sent[0]).toContain("Will it rain?");
  });
});
