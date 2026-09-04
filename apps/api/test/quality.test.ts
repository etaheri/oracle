import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CONSTANTS as C } from "@oracle/core";
import { questionQuality, qualityReport, type QualityRow } from "../src/pipeline/quality";
import { RESOLVES_AFTER_LOCK, upsertDraft } from "../src/pipeline/draft";
import { authorRound, rerollSlot } from "../src/pipeline/author";
import { settle } from "../src/pipeline/actions";
import type { PipelineDeps } from "../src/pipeline";
import type { StructuredCall } from "../src/pipeline/claude";
import type { Db } from "../src/db/client";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import * as schema from "../src/db/schema";

const row = (o: Partial<QualityRow>): QualityRow => ({
  outcome: null,
  crowdYesPct: null,
  crowdCount: null,
  authorProb: null,
  ...o,
});

// A crowd big enough to be a crowd. Everything below CONTRARIAN_MIN_CROWD is
// a sample, not a consensus.
const CROWD = C.CONTRARIAN_MIN_CROWD;

// Pinned here rather than imported: the legend must state the same number the
// code enforces, and a test that read the threshold back out of the module
// under test could not catch the two drifting apart.
const UNCONTESTED = 85;


function fakeDeps(db: Db, responses: unknown[]) {
  const calls: StructuredCall[] = [];
  const deps: PipelineDeps = {
    db,
    claude: {
      async structured(call) {
        calls.push(call);
        if (responses.length === 0) throw new Error("no more fake responses queued");
        return responses.shift();
      },
    },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    telegram: { send: async () => {} },
    now: () => new Date("2026-08-27T12:00:00Z"),
    // Feeds never reach the network in tests; a rejecting fetch makes every
    // feed fail cleanly and authoring proceed market-blind.
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
  return { deps, calls };
}

// Five questions, all landed the same way, all claiming the same probability.
// Enough to move one metric at a time without any of the others guessing.
async function seedResolvedRound(
  db: Db,
  date: string,
  opts: { authorProb: string | null; outcome: "yes" | "no" | "void" },
) {
  await db.insert(schema.rounds).values({ date, status: "locked" });
  await db.insert(schema.questions).values(
    [1, 2, 3, 4, 5].map((slot) => ({
      roundDate: date,
      slot,
      isBigOne: slot === 5,
      text: `Question ${slot} on ${date}?`,
      category: "news" as const,
      resolutionCriteria: "per test",
      sourceName: "SRC",
      opensAt: new Date(`${date}T16:00:00Z`),
      locksAt: new Date(`${date}T20:00:00Z`),
      resolveBy: new Date(`${date}T21:00:00Z`),
      status: opts.outcome === "void" ? ("void" as const) : ("resolved" as const),
      outcome: opts.outcome,
      authorProb: opts.authorProb,
    })),
  );
}

describe("questionQuality — the window's shape", () => {
  it("an empty window reports nothing rather than a tidy row of zeros", () => {
    expect(questionQuality([])).toEqual({ n: 0, voidRate: null, uncontestedRate: null, authorBrier: null });
  });

  it("counts every row asked, resolved or not", () => {
    const rows = [row({ outcome: "yes" }), row({ outcome: "void" }), row({})];
    expect(questionQuality(rows).n).toBe(3);
  });
});

describe("voidRate", () => {
  it("is voided over everything asked", () => {
    const rows = [row({ outcome: "void" }), row({ outcome: "yes" }), row({ outcome: "no" }), row({ outcome: "yes" })];
    expect(questionQuality(rows).voidRate).toBeCloseTo(0.25, 10);
  });

  it("counts the still-unresolved in the denominator — they were still asked", () => {
    const rows = [row({ outcome: "void" }), row({}), row({}), row({})];
    expect(questionQuality(rows).voidRate).toBeCloseTo(0.25, 10);
  });

  it("is 1 for an all-void window, and that window's other metrics are null, not zero", () => {
    const rows = [row({ outcome: "void" }), row({ outcome: "void" })];
    const q = questionQuality(rows);
    expect(q.voidRate).toBe(1);
    expect(q.uncontestedRate).toBeNull();
    expect(q.authorBrier).toBeNull();
  });
});

describe("uncontestedRate", () => {
  const landed = (pct: number, count: number = CROWD) => row({ outcome: "yes", crowdYesPct: pct, crowdCount: count });

  it("is the share of resolved questions the crowd landed one way on", () => {
    const rows = [landed(92), landed(50), landed(60), landed(55)];
    expect(questionQuality(rows).uncontestedRate).toBeCloseTo(0.25, 10);
  });

  it("counts a landslide in either direction — 4% yes is as uncontested as 96%", () => {
    expect(questionQuality([landed(4)]).uncontestedRate).toBe(1);
    expect(questionQuality([landed(96)]).uncontestedRate).toBe(1);
  });

  it("takes the threshold inclusively at both edges", () => {
    expect(questionQuality([landed(85)]).uncontestedRate).toBe(1);
    expect(questionQuality([landed(84)]).uncontestedRate).toBe(0);
    expect(questionQuality([landed(15)]).uncontestedRate).toBe(1);
    expect(questionQuality([landed(16)]).uncontestedRate).toBe(0);
  });

  it("ignores crowds below the floor entirely — a 100% crowd of two is a sample, not a consensus", () => {
    const rows = [landed(100, CROWD - 1), landed(0, 2), landed(50, CROWD)];
    expect(questionQuality(rows).uncontestedRate).toBe(0);
  });

  it("is null when no crowd cleared the floor, rather than reporting a contented zero", () => {
    expect(questionQuality([landed(100, CROWD - 1), landed(100, 1)]).uncontestedRate).toBeNull();
  });

  it("is measured on resolved questions only — a void or an open one has no crowd verdict to judge", () => {
    const rows = [
      row({ outcome: "void", crowdYesPct: 99, crowdCount: CROWD }),
      row({ outcome: null, crowdYesPct: 99, crowdCount: CROWD }),
      landed(50),
    ];
    expect(questionQuality(rows).uncontestedRate).toBe(0);
  });

  it("skips a resolved row whose crowd split was never stamped", () => {
    const rows = [row({ outcome: "yes", crowdYesPct: null, crowdCount: CROWD }), landed(90)];
    expect(questionQuality(rows).uncontestedRate).toBe(1);
  });

  it("skips a resolved row whose crowd count was never stamped", () => {
    expect(questionQuality([row({ outcome: "yes", crowdYesPct: 90, crowdCount: null })]).uncontestedRate).toBeNull();
  });
});

describe("authorBrier", () => {
  it("scores the author's stated probability against what happened", () => {
    // 0.6 called YES and it landed → 0.16. 0.6 called YES and it did not → 0.36.
    const rows = [row({ outcome: "yes", authorProb: 0.6 }), row({ outcome: "no", authorProb: 0.6 })];
    expect(questionQuality(rows).authorBrier).toBeCloseTo(0.26, 10);
  });

  it("is 0.25 for an author who claimed a coin flip and got a coin flip", () => {
    const rows = [row({ outcome: "yes", authorProb: 0.5 }), row({ outcome: "no", authorProb: 0.5 })];
    expect(questionQuality(rows).authorBrier).toBeCloseTo(0.25, 10);
  });

  it("falls toward zero when the author was writing gimmes and calling them contested", () => {
    // Claimed 0.7 five times, right every time: 0.09. Well under a coin flip.
    const rows = Array.from({ length: 5 }, () => row({ outcome: "yes" as const, authorProb: 0.7 }));
    expect(questionQuality(rows).authorBrier).toBeCloseTo(0.09, 10);
  });

  it("skips rows carrying no stated probability — every question predates the column", () => {
    const rows = [row({ outcome: "yes", authorProb: null }), row({ outcome: "yes", authorProb: 0.5 })];
    expect(questionQuality(rows).authorBrier).toBeCloseTo(0.25, 10);
  });

  it("skips void and unresolved rows — there is no outcome to score against", () => {
    const rows = [
      row({ outcome: "void", authorProb: 0.3 }),
      row({ outcome: null, authorProb: 0.3 }),
      row({ outcome: "yes", authorProb: 0.5 }),
    ];
    expect(questionQuality(rows).authorBrier).toBeCloseTo(0.25, 10);
  });

  it("is null when nothing resolved carried a probability", () => {
    expect(questionQuality([row({ outcome: "yes" }), row({ outcome: "void", authorProb: 0.5 })]).authorBrier).toBeNull();
  });
});

describe("the metrics are independent", () => {
  it("computes a void rate for a window that can carry neither of the other two", () => {
    const rows = [row({ outcome: "void" }), row({ outcome: "yes" }), row({ outcome: "yes" }), row({ outcome: "yes" })];
    const q = questionQuality(rows);
    expect(q.voidRate).toBeCloseTo(0.25, 10);
    expect(q.uncontestedRate).toBeNull();
    expect(q.authorBrier).toBeNull();
  });

  it("computes an author brier for a window whose crowds never cleared the floor", () => {
    const rows = [row({ outcome: "yes", authorProb: 0.5, crowdYesPct: 90, crowdCount: 3 })];
    const q = questionQuality(rows);
    expect(q.uncontestedRate).toBeNull();
    expect(q.authorBrier).toBeCloseTo(0.25, 10);
  });
});

describe("qualityReport", () => {
  it("carries its legend on the header line, readable cold", () => {
    const [header] = qualityReport(questionQuality([]));
    expect(header).toContain("QUESTION QUALITY");
    expect(header).toContain("0.25");
    expect(header).toContain(String(UNCONTESTED));
    expect(header).toContain(String(C.CONTRARIAN_MIN_CROWD));
  });

  it("renders every metric on a window that can compute them all", () => {
    const rows = [
      row({ outcome: "void" }),
      row({ outcome: "yes", authorProb: 0.5, crowdYesPct: 90, crowdCount: 40 }),
      row({ outcome: "no", authorProb: 0.5, crowdYesPct: 50, crowdCount: 40 }),
      row({ outcome: "yes", authorProb: 0.5, crowdYesPct: 60, crowdCount: 40 }),
    ];
    const [, body] = qualityReport(questionQuality(rows));
    expect(body).toBe("4 asked · void 25% · uncontested 33% · author brier 0.250");
  });

  it("says which metric is absent rather than printing a zero for it", () => {
    const [, body] = qualityReport(questionQuality([row({ outcome: "void" })]));
    expect(body).toContain("void 100%");
    expect(body).toContain("uncontested no crowds above the floor");
    expect(body).toContain("author brier no rated calls");
  });

  it("renders each absent metric independently of the others", () => {
    const rows = [row({ outcome: "yes", authorProb: 0.5 })];
    const [, body] = qualityReport(questionQuality(rows));
    expect(body).toContain("void 0%");
    expect(body).toContain("uncontested no crowds above the floor");
    expect(body).toContain("author brier 0.250");
  });

  it("says nothing was asked when nothing was", () => {
    const [, body] = qualityReport(questionQuality([]));
    expect(body).toContain("0 asked");
    expect(body).toContain("void no questions yet");
  });
});

// ---------------------------------------------------------------------------
// The write, and the two places that read it back.
// ---------------------------------------------------------------------------

describe("questions.author_prob", () => {
  it("upsertDraft persists the probability the author staked, instead of dropping it", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5);
    expect(qs.map((q) => Number(q.authorProb))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it("rerollSlot restates it too — a rerolled question carries a new claim, not the old one", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);

    const replacement = {
      slot: 3,
      category: "culture" as const,
      text: "Will the replacement thing happen before the close?",
      resolution_criteria: "Per the source page, at the stated deadline",
      source_name: "SRC",
      source_url: "https://example.com/y",
      author_probability: 0.42,
      is_big_one: false,
      market_prob: null,
      resolves_at: RESOLVES_AFTER_LOCK,
    };
    const { deps } = fakeDeps(db, [replacement]);
    await rerollSlot(deps, "2026-08-27", 3, "something else");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(Number(qs.find((q) => q.slot === 3)!.authorProb)).toBeCloseTo(0.42, 10);
    // The untouched slots keep the claim they were authored with.
    expect(Number(qs.find((q) => q.slot === 1)!.authorProb)).toBeCloseTo(0.5, 10);
  });
});

describe("the settle report carries the scorecard", () => {
  it("reports the trailing window beside the leak watch, and counts only days inside it", async () => {
    const { db } = await makeTestDb();
    // Two rounds in the window (one of them today's) and one 40 days back,
    // which must not be counted.
    await seedResolvedRound(db, "2026-08-27", { authorProb: "0.5", outcome: "yes" });
    await seedResolvedRound(db, "2026-08-20", { authorProb: "0.5", outcome: "no" });
    await seedResolvedRound(db, "2026-07-18", { authorProb: "0.5", outcome: "yes" });

    const sent: string[] = [];
    await settle({ db, telegram: { send: async (t) => void sent.push(t) } }, "2026-08-27");

    const report = sent.find((t) => t.includes("Round 2026-08-27 settled"))!;
    expect(report).toContain("QUESTION QUALITY");
    expect(report).toContain("LEAK WATCH");
    // 10 questions across the two in-window rounds, not the 15 on file.
    expect(report).toContain("10 asked");
    expect(report).toContain("author brier 0.250");
  });

  it("says what is missing rather than printing zeros for a window with no probabilities on file", async () => {
    const { db } = await makeTestDb();
    await seedResolvedRound(db, "2026-08-27", { authorProb: null, outcome: "void" });

    const sent: string[] = [];
    await settle({ db, telegram: { send: async (t) => void sent.push(t) } }, "2026-08-27");

    const report = sent.find((t) => t.includes("Round 2026-08-27 settled"))!;
    expect(report).toContain("void 100%");
    expect(report).toContain("author brier no rated calls");
  });
});

describe("the author is shown its own aggregate record", () => {
  it("puts the scorecard above the seven-day digest", async () => {
    const { db } = await makeTestDb();
    await seedResolvedRound(db, "2026-08-26", { authorProb: "0.5", outcome: "yes" });

    const { deps, calls } = fakeDeps(db, [validDraft]);
    await authorRound(deps, "2026-08-27");

    const system = calls[0]!.system;
    expect(system).toContain("QUESTION QUALITY");
    expect(system).toContain("author brier 0.250");
    // The aggregate comes first; the seven anecdotes still follow it.
    expect(system.indexOf("QUESTION QUALITY")).toBeLessThan(system.indexOf("how your last seven days landed"));
  });
});
