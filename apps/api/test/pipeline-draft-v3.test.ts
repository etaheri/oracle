import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { schema } from "../src/db/client";
import { upsertDraft, DraftSchema } from "../src/pipeline/draft";
import { noonET, addDays } from "../src/pipeline/clock";

const DATE = "2026-09-10";
const lock = noonET(addDays(DATE, 1));
const h = (n: number) => new Date(lock.getTime() + n * 3_600_000).toISOString();

function marketDraft(closes: (slot: number) => string) {
  return DraftSchema.parse({
    questions: validDraft.questions.map((q) => ({
      ...q,
      resolves_at: closes(q.slot),
      market_prob: 0.4,
      market: { source: "kalshi", id: `KXT-${q.slot}`, event_key: `KXT-E${q.slot}`, closes_at: closes(q.slot) },
    })),
  });
}

describe("upsertDraft at rules version 3", () => {
  it("stamps the market columns and keeps the common lock", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, DATE, marketDraft(() => h(10)), 3);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, DATE) });
    expect(q!.marketSource).toBe("kalshi");
    expect(q!.marketId).toBe(`KXT-${q!.slot}`);
    expect(q!.marketClosesAt!.toISOString()).toBe(h(10));
    expect(q!.locksAt.toISOString()).toBe(lock.toISOString());
    expect(q!.resolvesAt!.toISOString()).toBe(h(10));
  });
  it("does not apply the version 2 fast-round rule: every market may close the next morning", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft(() => h(13)), 3)).resolves.toBeUndefined();
  });
  it("refuses a market closing inside the answering window", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft((s) => (s === 2 ? h(1) : h(10))), 3)).rejects.toThrow(/market closes before lock \+ 2h/);
  });
  it("refuses a market closing later than lock + 30h", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft((s) => (s === 4 ? h(31) : h(10))), 3)).rejects.toThrow(/later than lock \+ 30h/);
  });
  it("refuses a version 3 question without a market", async () => {
    const { db } = await makeTestDb();
    const d = marketDraft(() => h(10));
    delete (d.questions[0] as { market?: unknown }).market;
    await expect(upsertDraft(db, DATE, d, 3)).rejects.toThrow(/every version 3 question names its market/);
  });
  it("version 2 drafts are untouched by the market field", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, DraftSchema.parse(validDraft), 2)).resolves.toBeUndefined();
  });
});
