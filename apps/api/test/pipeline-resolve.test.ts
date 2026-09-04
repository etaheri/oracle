import { describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { PIPELINE_LINES } from "@oracle/core";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveWithClaude, runResolution } from "../src/pipeline/resolve";
import { voidQuestions } from "../src/pipeline/actions";
import { runTick, type PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import * as schema from "../src/db/schema";
import { inlineStarter } from "../src/pipeline/workflows";
import { meterClaude, BudgetExhausted, PIPELINE_DAILY_CALL_BUDGET } from "../src/pipeline/spend";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

function fakeClaude(responses: unknown[]) {
  const calls: StructuredCall[] = [];
  const claude: ClaudeClient = {
    async structured(call) {
      calls.push(call);
      if (responses.length === 0) throw new Error("no more fake responses queued");
      return responses.shift();
    },
  };
  return { claude, calls };
}

function fakeDeps(db: PipelineDeps["db"], claude: ClaudeClient | null, nowIso = "2026-08-27T16:05:00Z") {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    workflows: inlineStarter(),
    db,
    claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date(nowIso),
  };
  return { deps, sent };
}

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

async function lockedQuestion(db: Awaited<ReturnType<typeof makeTestDb>>["db"], overrides: Partial<{ sourceUrl: string | null }> = {}, date = "2026-08-26") {
  const qs = await seedRound(db, { date, opensAt: new Date(`${date}T16:00:00Z`), locksAt: new Date(`${date}T17:00:00Z`) });
  const q = qs[0]!;
  if ("sourceUrl" in overrides) {
    await db.update(schema.questions).set({ sourceUrl: overrides.sourceUrl }).where(eq(schema.questions.id, q.id));
  }
  await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.id, q.id));
  return q.id;
}

// A round plus one locked question, source pinned so both resolver calls
// point at the same page. Returns the inserted question rows (exactly one).
async function seedOneLockedQuestion(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  date = "2026-09-04",
): Promise<[typeof schema.questions.$inferSelect]> {
  await db.insert(schema.rounds).values({ date, status: "locked" });
  const rows = await db
    .insert(schema.questions)
    .values({
      roundDate: date,
      slot: 1,
      isBigOne: false,
      text: "Adversarial question?",
      category: "news",
      resolutionCriteria: "per test",
      sourceName: "test",
      sourceUrl: "https://example.com/x",
      opensAt: new Date(`${date}T16:00:00Z`),
      locksAt: new Date(`${date}T17:00:00Z`),
      resolveBy: new Date(`${date}T17:00:00Z`),
      status: "locked",
    })
    .returning();
  return rows as [typeof schema.questions.$inferSelect];
}

// A PipelineDeps whose claude.structured is driven entirely by the given
// function, with resolve/resolveB pinned to two distinguishable model names
// so a test can answer differently per model.
function depsWith(db: PipelineDeps["db"], structured: (call: StructuredCall) => Promise<unknown>): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    claude: { structured },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    telegram: { send: async () => {} },
    now: () => new Date("2026-09-04T16:05:00Z"),
  };
}

describe("resolveWithClaude", () => {
  it("throws when there is no claude client", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { deps } = fakeDeps(db, null);
    await expect(resolveWithClaude(deps, id)).rejects.toThrow("pipeline: no claude client");
  });

  it("throws when the question is missing", async () => {
    const { db } = await makeTestDb();
    const { claude } = fakeClaude([]);
    const { deps } = fakeDeps(db, claude);
    await expect(resolveWithClaude(deps, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });

  it("a) yes + quote resolves the question and computes a seeded prediction's points/brier", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);

    const id = await lockedQuestion(db, { sourceUrl: "https://www.example.com/page" });
    // Re-open briefly to place a prediction (predictions require an unlocked question).
    await db.update(schema.questions).set({ status: "open" }).where(eq(schema.questions.id, id));
    vi.useFakeTimers({ now: new Date("2026-08-26T16:30:00Z"), toFake: ["Date"] });
    await a("/v1/predictions", { method: "POST", body: body(id, true) });
    vi.useRealTimers();
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.id, id));

    const { claude } = fakeClaude([
      { outcome: "yes", quotes: [{ url: "https://www.example.com/page", quote: "It happened." }], reasoning: "clear" },
      { outcome: "yes", quotes: [{ url: "https://www.example.com/page", quote: "It happened." }], reasoning: "clear" },
    ]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(true);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("resolved");
    expect(q!.outcome).toBe("yes");
    // Both models answered with one quote each; resolveWithClaude now
    // combines both readings' quotes into the stored evidence (design
    // 2026-09-04 §6), so the receipt count doubles even though the two
    // fixture entries here are identical.
    expect((q!.resolutionEvidence as any).quotes).toHaveLength(2);

    const pred = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, id) });
    expect(pred!.points).not.toBeNull();
    expect(pred!.brier).not.toBeNull();
  });

  it("b) unverifiable leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([
      { outcome: "unverifiable", quotes: [], reasoning: "not yet decided" },
      { outcome: "unverifiable", quotes: [], reasoning: "not yet decided" },
    ]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("locked");
  });

  it("c) yes with zero quotes leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([
      { outcome: "yes", quotes: [], reasoning: "trust me" },
      { outcome: "yes", quotes: [], reasoning: "trust me" },
    ]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("locked");
  });

  it("malformed structured output leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([
      { outcome: "maybe", quotes: [], reasoning: "garbage" },
      { outcome: "maybe", quotes: [], reasoning: "garbage" },
    ]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("locked");
  });

  it("returns false and writes nothing when the question is voided while the claude call is in flight", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);

    // A concurrent tick (e.g. the 13:00 ET void sweep) resolves this
    // question to void partway through our own resolve call's Claude round
    // trip, which can take minutes across chained web searches.
    const claude: ClaudeClient = {
      async structured() {
        await db.update(schema.questions)
          .set({ status: "void", outcome: "void", resolutionEvidence: { reason: "voided concurrently" } })
          .where(eq(schema.questions.id, id));
        return { outcome: "yes", quotes: [{ url: "https://x", quote: "It happened." }], reasoning: "clear" };
      },
    };
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("void");
    expect(q!.outcome).toBe("void"); // not overwritten with "yes"
    expect((q!.resolutionEvidence as any).reason).toBe("voided concurrently");
  });

  it("d) allowedDomains strips www. from source_url's hostname, and is absent when source_url is null", async () => {
    const { db } = await makeTestDb();

    const withUrl = await lockedQuestion(db, { sourceUrl: "https://www.example.com/page" }, "2026-08-26");
    const { claude: claudeA, calls: callsA } = fakeClaude([
      { outcome: "unverifiable", quotes: [], reasoning: "n/a" },
      { outcome: "unverifiable", quotes: [], reasoning: "n/a" },
    ]);
    await resolveWithClaude(fakeDeps(db, claudeA).deps, withUrl);
    expect(callsA[0]!.webSearch?.allowedDomains).toEqual(["example.com"]);
    expect(callsA[0]!.webSearch?.maxUses).toBe(5);

    const withoutUrl = await lockedQuestion(db, { sourceUrl: null }, "2026-08-27");
    const { claude: claudeB, calls: callsB } = fakeClaude([
      { outcome: "unverifiable", quotes: [], reasoning: "n/a" },
      { outcome: "unverifiable", quotes: [], reasoning: "n/a" },
    ]);
    await resolveWithClaude(fakeDeps(db, claudeB).deps, withoutUrl);
    expect(callsB[0]!.webSearch?.allowedDomains).toBeUndefined();
  });
});

describe("runTick with resolution wired", () => {
  it("e) resolves a locked round then settles it on the next tick", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });

    // Two models now read each of the 5 questions (resolve + resolveB), so
    // the queue needs 10 agreeing answers, not 5.
    const { claude } = fakeClaude(
      Array.from({ length: 10 }, () => ({ outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" })),
    );

    const { deps: d1 } = fakeDeps(db, claude, "2026-08-27T16:01:00Z"); // 12:01 ET — locks the round
    let done = await runTick(d1);
    expect(done).toContain("lock:2026-08-26");

    const { deps: d2 } = fakeDeps(db, claude, "2026-08-27T16:05:00Z"); // 12:05 ET — resolves all 5
    done = await runTick(d2);
    expect(done).toContain("resolve:2026-08-26");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    expect(qs.every((q) => q.status === "resolved")).toBe(true);

    const { deps: d3 } = fakeDeps(db, claude, "2026-08-27T16:10:00Z"); // still 12:xx ET — settles
    done = await runTick(d3);
    expect(done).toContain("settle:2026-08-26");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-26") });
    expect(round!.status).toBe("resolved");
  });
});

describe("adversarial resolution (design 2026-09-04 §6)", () => {
  const quotes = [{ url: "https://example.com/x", quote: "it happened" }];

  it("resolves when two DIFFERENT models agree, and stores both readings", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const models: string[] = [];
    const deps = depsWith(db, async (call) => { models.push(call.model); return { outcome: "yes", quotes, reasoning: "r" }; });
    expect(await resolveWithClaude(deps, q.id)).toBe(true);
    expect(new Set(models).size).toBe(2);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect(row!.outcome).toBe("yes");
    const ev = row!.resolutionEvidence as Record<string, unknown>;
    expect(ev.a).toBeDefined();
    expect(ev.b).toBeDefined();
  });

  it("does NOT write an outcome when the two models disagree", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const deps = depsWith(db, async (call) => ({
      outcome: call.model.includes("rb") ? "no" : "yes", quotes, reasoning: "r",
    }));
    expect(await resolveWithClaude(deps, q.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    // Assert the ROW is untouched, not merely that the function returned false.
    expect(row!.outcome).toBeNull();
    expect(row!.status).toBe("locked");
    expect(row!.resolvedAt).toBeNull();
  });

  it("records the disagreement on the question so the eventual void can name it", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const deps = depsWith(db, async (call) => ({ outcome: call.model.includes("rb") ? "no" : "yes", quotes, reasoning: "r" }));
    await resolveWithClaude(deps, q.id);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect((row!.resolutionEvidence as Record<string, unknown>).disagreement).toBe(true);
  });

  it("treats either model's unverifiable as unverifiable, without calling it a disagreement", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const deps = depsWith(db, async (call) =>
      call.model.includes("rb") ? { outcome: "unverifiable", quotes: [], reasoning: "not yet" } : { outcome: "yes", quotes, reasoning: "r" },
    );
    expect(await resolveWithClaude(deps, q.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect(row!.outcome).toBeNull();
    expect((row!.resolutionEvidence as Record<string, unknown>).disagreement).toBe(false);
  });

  it("treats a ruling with no receipts as unverifiable", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const deps = depsWith(db, async () => ({ outcome: "yes", quotes: [], reasoning: "vibes" }));
    expect(await resolveWithClaude(deps, q.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect(row!.outcome).toBeNull();
  });
});

describe("the struck void (design 2026-09-04 §11.3)", () => {
  it("names disagreement as the reason when the last read was a disagreement", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    const deps = depsWith(db, async (call) => ({
      outcome: call.model.includes("rb") ? "no" : "yes",
      quotes: [{ url: "https://example.com/x", quote: "it happened" }], reasoning: "r",
    }));
    await resolveWithClaude(deps, q.id);
    const sent: string[] = [];
    await voidQuestions(db, { send: async (t) => void sent.push(t) }, [q.id], "2026-09-06T16:00:00Z");
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect(row!.outcome).toBe("void");
    expect((row!.resolutionEvidence as Record<string, unknown>).reason).toBe(PIPELINE_LINES.voidDisagreement);
  });

  it("keeps the plain reason for a question nobody could read at all", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOneLockedQuestion(db);
    await voidQuestions(db, { send: async () => {} }, [q.id], "2026-09-06T16:00:00Z");
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q.id) });
    expect((row!.resolutionEvidence as Record<string, unknown>).reason).toBe("unverifiable within 24 hours of lock");
  });
});

describe("runResolution and the spend ceiling", () => {
  it("rethrows BudgetExhausted instead of narrating it per question — a spent budget stops the DAY", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-26"));
    await db.insert(schema.pipelineSpend).values({ date: "2026-08-27", calls: PIPELINE_DAILY_CALL_BUDGET });

    const { deps, sent } = fakeDeps(db, null);
    deps.claude = meterClaude(db, { structured: async () => ({}) }, "2026-08-27");

    await expect(runResolution(deps, "2026-08-26", [qs[0]!.id, qs[1]!.id])).rejects.toBeInstanceOf(BudgetExhausted);
    // Not five warnings, not even one: the tick's catch owns this narration.
    expect(sent.filter((t) => t.includes("resolve failed"))).toHaveLength(0);
  });

  it("still narrates and continues past an ordinary per-question failure", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-26"));
    const { deps, sent } = fakeDeps(db, null);
    deps.claude = { structured: async () => { throw new Error("the source did not answer"); } };
    await expect(runResolution(deps, "2026-08-26", [qs[0]!.id, qs[1]!.id])).resolves.toBeUndefined();
    expect(sent.filter((t) => t.includes("resolve failed"))).toHaveLength(2);
  });
});
