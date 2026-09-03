import { describe, expect, it } from "vitest";
import { crowdDrift, lateEdge, earlyLockRate, leakReport, loadLeakRows, pooledLeak, type SealRow } from "../src/pipeline/leak";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

const at = (min: number, answer: boolean, brier: number | null = null): SealRow => ({
  createdAt: new Date(Date.UTC(2026, 7, 27, 16, min)),
  answer,
  brier,
});

describe("crowdDrift", () => {
  it("is null below eight seals — a quartile of two is not a signal", () => {
    expect(crowdDrift([at(0, true), at(1, false), at(2, true)])).toBeNull();
  });

  it("is zero when the crowd never changed its mind", () => {
    // 12 seals, every third one YES: the first quartile (0,1,2) and the last
    // (9,10,11) both run 1-in-3 YES, so the split never moved.
    const rows = Array.from({ length: 12 }, (_, i) => at(i, i % 3 === 0));
    expect(crowdDrift(rows)).toBe(0);
  });

  it("measures the swing between the first and last quartile of sealers", () => {
    // 12 seals: first 3 all NO, last 3 all YES → 0% vs 100% → 100pp.
    const rows = [
      ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0)),
      ...[9, 10, 11].map((m) => at(m, true)),
    ];
    expect(crowdDrift(rows)).toBe(100);
  });

  it("sorts by seal time, not array order", () => {
    const rows = [...[9, 10, 11].map((m) => at(m, true)), ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0))];
    expect(crowdDrift(rows)).toBe(100);
  });

  it("is null at exactly seven seals — one below the floor", () => {
    const rows = Array.from({ length: 7 }, (_, i) => at(i, i % 2 === 0));
    expect(crowdDrift(rows)).toBeNull();
  });
});

describe("lateEdge", () => {
  it("is null below eight rated rows", () => {
    expect(lateEdge([at(0, true, 0.1), at(1, true, 0.1)])).toBeNull();
  });

  it("is positive when the later half scored better (lower brier)", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      ...[4, 5, 6, 7].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });

  it("ignores unrated rows entirely", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      at(4, true, null),
      ...[5, 6, 7, 8].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });

  it("is null at exactly seven rated rows — one below the floor", () => {
    const rows = Array.from({ length: 7 }, (_, i) => at(i, true, 0.1));
    expect(lateEdge(rows)).toBeNull();
  });

  it("is null when there are enough raw seals but not enough rated rows", () => {
    // 8 total seals (clears the raw floor crowdDrift would use) but only 2
    // are rated — the guarantee is on rated rows specifically.
    const rows = [
      ...[0, 1, 2, 3, 4, 5].map((m) => at(m, true, null)),
      at(6, true, 0.2),
      at(7, true, 0.1),
    ];
    expect(lateEdge(rows)).toBeNull();
  });

  it("is null when nothing is rated at all", () => {
    const rows = Array.from({ length: 10 }, (_, i) => at(i, true, null));
    expect(lateEdge(rows)).toBeNull();
  });

  it("drops the middle row on an odd-length rated set", () => {
    // 9 rated rows: half = 4. Rows 0-3 average 0.3, rows 5-8 average 0.1;
    // row 4 (brier 0.9) must land in neither half, or the result would not
    // come out to exactly 0.2.
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.3)),
      at(4, true, 0.9),
      ...[5, 6, 7, 8].map((m) => at(m, true, 0.1)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });

  it("sorts by seal time, not array order", () => {
    const early = [0, 1, 2, 3].map((m) => at(m, true, 0.25));
    const late = [4, 5, 6, 7].map((m) => at(m, true, 0.05));
    expect(lateEdge([...late, ...early])).toBeCloseTo(0.2, 10);
  });
});

describe("earlyLockRate", () => {
  const noon = new Date("2026-08-28T16:00:00Z");
  it("counts questions that closed before the round did", () => {
    expect(earlyLockRate(
      [{ locksAt: new Date("2026-08-27T22:00:00Z") }, { locksAt: noon }, { locksAt: noon }],
      noon,
    )).toBe("1/3");
  });
});

describe("leakReport", () => {
  const noon = new Date("2026-08-28T16:00:00Z"); // noon ET (EDT)
  it("renders one line per slot plus the rate, and says so when a slot has too few seals for both metrics", () => {
    // 2026-08-27T22:00Z is 18:00 ET under EDT.
    const out = leakReport([
      { slot: 1, drift: 12, edge: 0.031, locksAt: new Date("2026-08-27T22:00:00Z") },
      { slot: 2, drift: null, edge: null, locksAt: noon },
    ], noon);
    expect(out[1]).toBe("1 drift 12pp · late edge +0.031 · locks 2026-08-27T18:00ET");
    expect(out[2]).toBe("2 too few seals · locks noon ET");
    expect(out[3]).toBe("early-lock rate 1/2");
  });

  it("carries a legend on the header line explaining what the numbers mean and which sign is bad", () => {
    const out = leakReport([{ slot: 1, drift: 0, edge: 0, locksAt: noon }], noon);
    expect(out[0]).toContain("LEAK WATCH");
    expect(out[0]).toContain("crowd swing");
    expect(out[0]).toContain("positive means late sealers scored better");
  });

  it("renders drift and late edge independently — a voided question can drift without ever being rated", () => {
    // Plenty of seals (drift is computable) but zero rated briers (edge is
    // not): the exact leak signature a shared null used to hide behind
    // "too few seals".
    const out = leakReport([{ slot: 3, drift: 70, edge: null, locksAt: noon }], noon);
    expect(out[1]).toBe("3 drift 70pp · late edge too few seals · locks noon ET");
  });

  it("never renders a missing metric the same as a real zero", () => {
    const out = leakReport([{ slot: 4, drift: 0, edge: 0, locksAt: noon }], noon);
    expect(out[1]).toBe("4 drift 0pp · late edge +0.000 · locks noon ET");
  });
});

describe("loadLeakRows", () => {
  it("converts the driver's string brier to a number, and leaves null as null", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [u1] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    const [u2] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    await db.insert(schema.predictions).values([
      { questionId: qs[0]!.id, userId: u1!.id, answer: true, confidence: 80, createdAt: new Date("2026-08-20T17:00:00Z"), brier: "0.25" },
      { questionId: qs[0]!.id, userId: u2!.id, answer: false, confidence: 60, createdAt: new Date("2026-08-20T18:00:00Z"), brier: null },
    ]);
    const rows = await loadLeakRows(db, qs[0]!.id);
    const rated = rows.find((r) => r.answer === true)!;
    expect(rated.brier).toBe(0.25);
    expect(typeof rated.brier).toBe("number");
    expect(rows.find((r) => r.answer === false)!.brier).toBeNull();
  });

  it("treats a NaN brier (garbage numeric row) as unrated rather than poisoning the mean", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [u1] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    await db.insert(schema.predictions).values({
      questionId: qs[0]!.id, userId: u1!.id, answer: true, confidence: 80, createdAt: new Date("2026-08-20T17:00:00Z"), brier: "NaN",
    });
    const rows = await loadLeakRows(db, qs[0]!.id);
    expect(rows[0]!.brier).toBeNull();
  });
});

describe("pooledLeak", () => {
  // Build one question's worth of seals: `n` rows marching forward in time,
  // with `lateYes` of the last half answering YES and briers supplied.
  const q = (specs: Array<{ answer: boolean; brier: number | null }>): SealRow[] =>
    specs.map((s, i) => ({ createdAt: new Date(2026, 0, 1, 12, i), answer: s.answer, brier: s.brier }));

  const flat = (n: number) => q(Array.from({ length: n }, () => ({ answer: true, brier: 0.2 })));

  it("returns nulls and counts nothing when every question is under the seal floor", () => {
    const out = pooledLeak([flat(3), flat(4)]);
    expect(out.drift).toBeNull();
    expect(out.edge).toBeNull();
    expect(out.questions).toBe(0);
    expect(out.seals).toBe(7);
  });

  it("pools per-question metrics rather than concatenating rows", () => {
    // Two questions, each internally drifting from NO to YES. Concatenated by
    // wall clock they would interleave and cancel; pooled per question they
    // agree.
    const drifting = q([
      { answer: false, brier: 0.4 }, { answer: false, brier: 0.4 },
      { answer: false, brier: 0.4 }, { answer: false, brier: 0.4 },
      { answer: true, brier: 0.1 }, { answer: true, brier: 0.1 },
      { answer: true, brier: 0.1 }, { answer: true, brier: 0.1 },
    ]);
    const out = pooledLeak([drifting, drifting]);
    expect(out.questions).toBe(2);
    expect(out.drift).toBe(100);
    // Earlier half brier 0.4, later half 0.1 → +0.3, late sealers scored better.
    expect(out.edge).toBeCloseTo(0.3, 6);
  });

  it("counts a question toward drift but not edge when it has no rated rows", () => {
    const unrated = q(Array.from({ length: 8 }, (_, i) => ({ answer: i >= 4, brier: null })));
    const out = pooledLeak([unrated]);
    expect(out.drift).toBe(100);
    expect(out.edge).toBeNull();
    expect(out.rated).toBe(0);
  });
});
