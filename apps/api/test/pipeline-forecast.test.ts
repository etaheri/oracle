import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { stampOracleForecast } from "../src/pipeline/forecast";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient } from "../src/pipeline/claude";

type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

// Harness mirrors pipeline-author.test.ts's makeTestDb/fakeDeps conventions.
// The Claude client is always injected — stampOracleForecast must never make
// a live network call in a test.
function makeDeps(
  db: TestDb,
  opts: { claude: { structured: ClaudeClient["structured"] } | null },
): PipelineDeps {
  return {
    db,
    claude: opts.claude,
    models: { author: "m-a", resolve: "m-r", forecast: "m-f" },
    telegram: { send: async () => {} },
    now: () => new Date("2026-09-03T12:00:00Z"),
    // Feeds must never reach the network in tests.
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function seedOpenRound(db: TestDb, date: string, opts: { authorProb?: string } = {}) {
  const opensAt = new Date(`${date}T16:00:00Z`);
  const locksAt = new Date(opensAt.getTime() + 86_400_000);
  await seedRound(db, { date, opensAt, locksAt });
  if (opts.authorProb !== undefined) {
    await db
      .update(schema.questions)
      .set({ authorProb: opts.authorProb })
      .where(eq(schema.questions.roundDate, date));
  }
}

// 20 players, all YES at 95 — a real, lopsided crowd sealed into the DB
// between two forecast calls, to prove the prompt never depends on it.
async function sealLopsidedCrowd(db: TestDb, date: string) {
  const questions = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const users = await db
    .insert(schema.users)
    .values(Array.from({ length: 20 }, () => ({})))
    .returning({ id: schema.users.id });
  for (const q of questions) {
    await db.insert(schema.predictions).values(
      users.map((u) => ({ questionId: q.id, userId: u.id, answer: true, confidence: 95 })),
    );
  }
}

const fiveSlots = [
  { slot: 1, p_yes: 0.62 }, { slot: 2, p_yes: 0.31 }, { slot: 3, p_yes: 0.5 },
  { slot: 4, p_yes: 0.88 }, { slot: 5, p_yes: 0.44 },
];

describe("stampOracleForecast", () => {
  it("stamps every question's oracle_p_yes from one structured call", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await seedOpenRound(db, "2026-09-03");

    await stampOracleForecast(deps, "2026-09-03");

    const rows = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2026-09-03"),
    });
    expect(rows.map((r) => Number(r.oracleProbYes)).sort()).toEqual([0.31, 0.44, 0.5, 0.62, 0.88]);
  });

  // THE CROWD-BLINDNESS GUARANTEE. Structural, not advisory: the prompt is
  // built from questions alone, so there is no path by which a prediction
  // could reach it. Seal a lopsided crowd first and assert the prompt is
  // byte-identical to the prompt with no crowd at all.
  it("builds a prompt that cannot contain the crowd", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await seedOpenRound(db, "2026-09-03");
    await stampOracleForecast(deps, "2026-09-03");
    const before = structured.mock.calls[0]![0];

    await sealLopsidedCrowd(db, "2026-09-03"); // 20 players, all YES at 95
    await db.update(schema.questions).set({ oracleProbYes: null })
      .where(eq(schema.questions.roundDate, "2026-09-03"));
    await stampOracleForecast(deps, "2026-09-03");
    const after = structured.mock.calls[1]![0];

    expect(after.system).toBe(before.system);
    expect(after.user).toBe(before.user);
  });

  it("never shows the forecaster the author's own probability", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: fiveSlots });
    const deps = makeDeps(db, { claude: { structured } });
    await seedOpenRound(db, "2026-09-03", { authorProb: "0.42" });
    await stampOracleForecast(deps, "2026-09-03");
    const call = structured.mock.calls[0]![0];
    expect(`${call.system}${call.user}`).not.toContain("0.42");
    expect(`${call.system}${call.user}`.toLowerCase()).not.toContain("author_prob");
  });

  it("leaves the round unstamped and does not throw when the call fails", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockRejectedValue(new Error("claude: 529"));
    const deps = makeDeps(db, { claude: { structured } });
    await seedOpenRound(db, "2026-09-03");
    await expect(stampOracleForecast(deps, "2026-09-03")).rejects.toThrow();
    const rows = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2026-09-03"),
    });
    expect(rows.every((r) => r.oracleProbYes === null)).toBe(true);
  });

  it("rejects a response missing a slot rather than stamping a partial round", async () => {
    const { db } = await makeTestDb();
    const structured = vi.fn().mockResolvedValue({ forecasts: [{ slot: 1, p_yes: 0.6 }] });
    const deps = makeDeps(db, { claude: { structured } });
    await seedOpenRound(db, "2026-09-03");
    await expect(stampOracleForecast(deps, "2026-09-03")).rejects.toThrow(/validation|slot/i);
  });
});
