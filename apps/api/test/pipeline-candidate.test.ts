import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { screenCandidates, recentTopicKeys, CandidateSchema } from "../src/pipeline/candidate";
import { RESOLVES_AFTER_LOCK } from "../src/pipeline/draft";

const opensAt = new Date("2026-09-04T16:00:00Z");
const locksAtDefault = new Date("2026-09-05T16:00:00Z");
const none = new Set<string>();

const base = {
  category: "markets",
  text: "Will the index close above 5000?",
  resolution_criteria: "The official closing print on the exchange's own page",
  source_name: "SRC",
  source_url: "https://example.com/close",
  author_probability: 0.5,
  market_prob: null,
  resolves_at: "2026-09-05T14:00:00Z",
  topic_key: "index-close-above-threshold",
};
const cand = (o: Record<string, unknown> = {}) => ({ ...base, ...o });

describe("CandidateSchema", () => {
  it("has no slot and no is_big_one — those are selection's job, not authoring's", () => {
    const parsed = CandidateSchema.safeParse({ ...base, slot: 3, is_big_one: true });
    expect(parsed.success).toBe(false);
  });
  it("requires a topic_key", () => {
    const { topic_key, ...withoutKey } = base;
    expect(CandidateSchema.safeParse(withoutKey).success).toBe(false);
  });
});

describe("screenCandidates — tier 0", () => {
  it("passes a well-formed candidate", () => {
    const r = screenCandidates([cand()], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it("rejects a probability outside the contested band", () => {
    const r = screenCandidates([cand({ author_probability: 0.85 })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("structural");
  });

  it("rejects weather that claims after-lock — a forecast is always partly knowable", () => {
    const r = screenCandidates([cand({ category: "weather", resolves_at: RESOLVES_AFTER_LOCK })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.rejected[0]!.reason).toBe("structural");
  });

  it("rejects a resolves_at at or before the round opens — its answer already exists", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-04T15:00:00Z" })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.rejected[0]!.reason).toBe("structural");
  });

  it("rejects a resolves_at past the round's own close", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-06T00:00:00Z" })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.rejected[0]!.reason).toBe("structural");
  });

  it("accepts after-lock for a non-weather candidate", () => {
    const r = screenCandidates([cand({ resolves_at: RESOLVES_AFTER_LOCK })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.passed).toHaveLength(1);
  });

  it("rejects a topic_key seen in the recent window", () => {
    const r = screenCandidates([cand()], { opensAt, locksAtDefault, recentTopicKeys: new Set(["index-close-above-threshold"]) });
    expect(r.rejected[0]!.reason).toBe("duplicate-topic");
  });

  it("rejects the second candidate that repeats a topic_key inside one batch", () => {
    const r = screenCandidates([cand(), cand({ text: "Will the index close above 6000?" })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toBe("duplicate-topic");
  });

  it("rejects a compound clause, which is the classic ambiguity generator", () => {
    const r = screenCandidates(
      [cand({ text: "Will the index close above 5000 and hold it overnight?" })],
      { opensAt, locksAtDefault, recentTopicKeys: none },
    );
    expect(r.rejected[0]!.reason).toBe("compound");
    const or = screenCandidates(
      [cand({ text: "Will the index close above 5000 or below 4000?" })],
      { opensAt, locksAtDefault, recentTopicKeys: none },
    );
    expect(or.rejected[0]!.reason).toBe("compound");
  });

  it("does not mistake a word merely containing 'and' for a conjunction", () => {
    const r = screenCandidates(
      [cand({ text: "Will the Standard Index close above 5000?" })],
      { opensAt, locksAtDefault, recentTopicKeys: none },
    );
    expect(r.passed).toHaveLength(1);
  });

  it("names the offending text on every rejection, so narration can be honest", () => {
    const r = screenCandidates([cand({ author_probability: 0.9 })], { opensAt, locksAtDefault, recentTopicKeys: none });
    expect(r.rejected[0]!.text).toContain("index close above 5000");
    expect(r.rejected[0]!.detail.length).toBeGreaterThan(0);
  });
});

describe("tier-0 at v2 — instants and the void deadline (design 2026-09-09 §1)", () => {
  const voidAt = new Date("2026-09-06T16:00:00Z");
  const v2 = { opensAt, locksAtDefault, rulesVersion: 2, voidAt, recentTopicKeys: none };

  it("rejects after-lock at v2: the gauntlet must state the instant", () => {
    const r = screenCandidates([cand({ resolves_at: RESOLVES_AFTER_LOCK, category: "news" })], v2);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("structural");
    expect(r.rejected[0]!.detail).toContain("instant");
  });
  it("rejects an instant past the void deadline as slow", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-07T12:00:00Z" })], v2);
    expect(r.rejected[0]!.reason).toBe("slow");
  });
  it("passes an instant between the lock and the void deadline", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-05T20:00:00Z" })], v2);
    expect(r.passed).toHaveLength(1);
  });
  it("requires forecast_point on weather and accepts it", () => {
    const noPoint = screenCandidates([cand({ category: "weather", resolves_at: "2026-09-06T00:00:00Z", topic_key: "nyc-high" })], v2);
    expect(noPoint.rejected[0]!.reason).toBe("structural");
    const withPoint = screenCandidates([cand({ category: "weather", resolves_at: "2026-09-06T00:00:00Z", topic_key: "nyc-high-2", forecast_point: { lat: 40.78, lon: -73.97 } })], v2);
    expect(withPoint.passed).toHaveLength(1);
    expect(withPoint.passed[0]!.forecast_point).toEqual({ lat: 40.78, lon: -73.97 });
  });
  it("ignores forecast_point on a non-weather candidate without rejecting it", () => {
    const r = screenCandidates([cand({ forecast_point: { lat: 1, lon: 1 }, resolves_at: "2026-09-05T20:00:00Z" })], v2);
    expect(r.passed).toHaveLength(1);
  });
});

describe("recentTopicKeys", () => {
  it("reads the last seven days and ignores older rounds and null keys", async () => {
    const { db } = await makeTestDb();
    const q = (date: string, key: string | null) => ({
      roundDate: date, slot: 1, text: `q ${date}`, category: "news" as const,
      resolutionCriteria: "x", sourceName: "SRC", topicKey: key,
      opensAt, locksAt: locksAtDefault, resolveBy: locksAtDefault,
    });
    for (const d of ["2026-08-26", "2026-08-29", "2026-09-03"]) {
      await db.insert(schema.rounds).values({ date: d });
    }
    await db.insert(schema.questions).values([
      q("2026-08-26", "too-old"),
      q("2026-08-29", "in-window"),
      q("2026-09-03", null),
    ]);
    const keys = await recentTopicKeys(db, "2026-09-04");
    expect(keys.has("in-window")).toBe(true);
    expect(keys.has("too-old")).toBe(false);
    expect(keys.size).toBe(1);
  });
});
