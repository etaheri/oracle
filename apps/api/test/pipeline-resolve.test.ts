import { describe, expect, it, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveWithClaude } from "../src/pipeline/resolve";
import { runTick, type PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import * as schema from "../src/db/schema";

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
    db,
    claude,
    models: { author: "m-a", resolve: "m-r" },
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

    const { claude } = fakeClaude([{ outcome: "yes", quotes: [{ url: "https://www.example.com/page", quote: "It happened." }], reasoning: "clear" }]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(true);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("resolved");
    expect(q!.outcome).toBe("yes");
    expect((q!.resolutionEvidence as any).quotes).toHaveLength(1);

    const pred = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, id) });
    expect(pred!.points).not.toBeNull();
    expect(pred!.brier).not.toBeNull();
  });

  it("b) unverifiable leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([{ outcome: "unverifiable", quotes: [], reasoning: "not yet decided" }]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("locked");
  });

  it("c) yes with zero quotes leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([{ outcome: "yes", quotes: [], reasoning: "trust me" }]);
    const { deps } = fakeDeps(db, claude);

    const result = await resolveWithClaude(deps, id);
    expect(result).toBe(false);

    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, id) });
    expect(q!.status).toBe("locked");
  });

  it("malformed structured output leaves the question locked and returns false", async () => {
    const { db } = await makeTestDb();
    const id = await lockedQuestion(db);
    const { claude } = fakeClaude([{ outcome: "maybe", quotes: [], reasoning: "garbage" }]);
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
    const { claude: claudeA, calls: callsA } = fakeClaude([{ outcome: "unverifiable", quotes: [], reasoning: "n/a" }]);
    await resolveWithClaude(fakeDeps(db, claudeA).deps, withUrl);
    expect(callsA[0]!.webSearch?.allowedDomains).toEqual(["example.com"]);
    expect(callsA[0]!.webSearch?.maxUses).toBe(5);

    const withoutUrl = await lockedQuestion(db, { sourceUrl: null }, "2026-08-27");
    const { claude: claudeB, calls: callsB } = fakeClaude([{ outcome: "unverifiable", quotes: [], reasoning: "n/a" }]);
    await resolveWithClaude(fakeDeps(db, claudeB).deps, withoutUrl);
    expect(callsB[0]!.webSearch?.allowedDomains).toBeUndefined();
  });
});

describe("runTick with resolution wired", () => {
  it("e) resolves a locked round then settles it on the next tick", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });

    const { claude } = fakeClaude([
      { outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" },
      { outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" },
      { outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" },
      { outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" },
      { outcome: "yes", quotes: [{ url: "https://x", quote: "a" }], reasoning: "r" },
    ]);

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
