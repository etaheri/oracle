import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { schema } from "../src/db/client";
import { upsertDraft, DraftSchema, RESOLVES_AFTER_LOCK, CROWD_RESOLUTION_CRITERIA } from "../src/pipeline/draft";
import { noonET, addDays } from "../src/pipeline/clock";

const DATE = "2026-09-23";
const lock = noonET(addDays(DATE, 1));

function crowdDraft(closesAt: (slot: number) => string = () => lock.toISOString(), categories = ["markets", "sports", "weather", "culture", "news"] as const) {
  return DraftSchema.parse({
    questions: validDraft.questions.map((q) => ({
      ...q,
      category: categories[q.slot - 1],
      resolution_criteria: CROWD_RESOLUTION_CRITERIA,
      source_name: "THE PLAYERS",
      source_url: "https://outseen-site.etaheri.workers.dev/play",
      author_probability: 0.5,
      market_prob: null,
      resolves_at: RESOLVES_AFTER_LOCK,
      market: { source: "crowd", id: DATE, event_key: String(q.slot), closes_at: closesAt(q.slot) },
    })),
  });
}

describe("a crowd draft (design 2026-09-22 §4.2)", () => {
  it("accepts crowd as a market source, weather included, with after-lock", () => {
    expect(() => crowdDraft()).not.toThrow();
  });
  it("stamps the crowd columns: the round date as id, the slot as event key, the lock as close and resolve_by six hours after", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, DATE, crowdDraft(), 3);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.length).toBe(5);
    for (const q of qs) {
      expect(q.marketSource).toBe("crowd");
      expect(q.marketId).toBe(DATE);
      expect(q.marketEventKey).toBe(String(q.slot));
      expect(q.marketClosesAt!.toISOString()).toBe(lock.toISOString());
      expect(q.locksAt.toISOString()).toBe(lock.toISOString());
      expect(q.resolveBy.toISOString()).toBe(new Date(lock.getTime() + 6 * 3_600_000).toISOString());
      expect(q.resolvesAt).toBeNull();
      expect(q.marketProb).toBeNull();
      expect(q.sourceName).toBe("THE PLAYERS");
    }
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
  });
  it("skips the exchange window checks: a close at the lock is not 'before lock + 2h'", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, crowdDraft(), 3)).resolves.toBeUndefined();
  });
  it("refuses a crowd question whose close is not the lock", async () => {
    const { db } = await makeTestDb();
    const late = new Date(lock.getTime() + 3_600_000).toISOString();
    await expect(upsertDraft(db, DATE, crowdDraft((s) => (s === 3 ? late : lock.toISOString())), 3)).rejects.toThrow(/slot 3: a crowd question closes at the lock/);
  });
  it("refuses a crowd draft below rules version 3", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, crowdDraft(), 2)).rejects.toThrow(/crowd question needs rules version 3/);
  });
});
