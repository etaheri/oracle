import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { commitCouncil } from "../src/pipeline/council/commit";
import { runCouncil, narrateCouncil } from "../src/pipeline/council";
import type { MemberResult } from "../src/pipeline/council/member";

// 2099, not 2026: commit_oracle_forecast compares the opening deadline with the
// database clock, so a real date would fail with "opening deadline passed".
const DATE = "2099-09-10";
const NOW = new Date("2099-09-10T14:00:00Z");
// Past world()'s 16:00 opening — commit_oracle_forecast raises "opening
// deadline passed" the instant p_checked_at (deps.now()) reaches it.
const LATE = new Date("2099-09-10T17:00:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null, sent: string[] = []): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { sonnet: "m-sonnet", opus: "m-opus", haiku: "m-haiku" },
    telegram: { send: async (t) => { sent.push(t); } }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
    exaApiKey: "k",
    exaFetch: (async () => new Response(JSON.stringify({ results: [{ url: "https://e/1", title: "One", publishedDate: "2099-09-09T00:00:00Z", highlights: ["H."] }], costDollars: { total: 0.01 } }), { status: 200 })) as typeof fetch,
  };
}

async function world(rulesVersion = 3) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2099-09-10T16:00:00Z"), locksAt: new Date("2099-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", marketProb: "0.40" }).where(eq(schema.questions.roundDate, DATE));
  return { db, rows };
}

const result = (member: MemberResult["member"], rows: { id: string; slot: number }[], p: number, skip: number[] = []): MemberResult => ({
  member,
  lines: rows.filter((r) => !skip.includes(r.slot)).map((r) => ({ slot: r.slot, questionId: r.id, pYes: p, reasoning: `${member} says.`, cited: [], lessonsReceived: [] })),
  abstained: skip,
});

describe("commitCouncil (spec §7)", () => {
  it("writes the median of the models present as oracle_p_yes, one lines row per present member plus the market, and the clamped line", async () => {
    const { db, rows } = await world();
    const c = await commitCouncil(makeDeps(db, null), DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.31), result("haiku", rows, 0.44)]);
    expect(c.committed).toBe(true);
    expect(c.lines).toBe(20);
    expect(c.slots[0]).toEqual({ slot: 1, present: ["sonnet", "opus", "haiku"], median: 0.40 });
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.every((q) => Number(q.oracleProbYes) === 0.40 && Number(q.linePYes) === 0.40)).toBe(true);
    const market = await db.query.lines.findMany({ where: eq(schema.lines.member, "market") });
    expect(market.length).toBe(5);
    expect(Number(market[0]!.pYes)).toBe(0.40);
    expect(market[0]!.model).toBeNull();
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.oracleForecastModel).toBe("council");
    expect(round!.oraclePromptVersion).toBe("council-v1");
  });

  it("clamps the median to the market band", async () => {
    const { db, rows } = await world();
    await commitCouncil(makeDeps(db, null), DATE, [result("sonnet", rows, 0.10), result("opus", rows, 0.12)]);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, DATE) });
    expect(Number(q!.oracleProbYes)).toBe(0.11);
    expect(Number(q!.linePYes)).toBe(0.25);
  });

  it("with two present on every slot, commits their mean; an abstaining member is excluded", async () => {
    const { db, rows } = await world();
    const c = await commitCouncil(makeDeps(db, null), DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.30), { member: "haiku", lines: [], abstained: [1, 2, 3, 4, 5], error: "timeout" }]);
    expect(c.committed).toBe(true);
    expect(c.slots[0]!.median).toBeCloseTo(0.35, 10);
    expect((await db.query.lines.findMany({ where: eq(schema.lines.member, "haiku") })).length).toBe(0);
  });

  it("with one present on any slot, commits nothing and says which slot", async () => {
    const { db, rows } = await world();
    const c = await commitCouncil(makeDeps(db, null), DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.30, [3]), result("haiku", rows, 0.30, [3])]);
    expect(c.committed).toBe(false);
    expect(c.reason).toBe("fewer than two members present on slot 3");
    expect((await db.query.lines.findMany()).length).toBe(0);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.oracleCommittedAt).toBeNull();
  });

  it("is a no-op on an already committed round", async () => {
    const { db, rows } = await world();
    const deps = makeDeps(db, null);
    await commitCouncil(deps, DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.31)]);
    const again = await commitCouncil(deps, DATE, [result("sonnet", rows, 0.90), result("opus", rows, 0.90)]);
    expect(again.committed).toBe(false);
    expect(again.reason).toBe("already committed");
    expect((await db.query.lines.findMany()).length).toBe(15);
  });

  it("omits the market row when the question has no market price", async () => {
    const { db, rows } = await world();
    await db.update(schema.questions).set({ marketProb: null }).where(eq(schema.questions.id, rows[0]!.id));
    await commitCouncil(makeDeps(db, null), DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.31)]);
    expect((await db.query.lines.findMany({ where: eq(schema.lines.member, "market") })).length).toBe(4);
  });

  it("closes out a line stranded by a step that landed the commit but died before commitLine ran", async () => {
    // Reproduces a Workflow retry of the `commit` step: commit_council lands,
    // then the step throws before commitLine runs (e.g. a crash mid-step).
    // The retry must still see "already committed" (spec's return contract)
    // but must NOT strand the line — it should finish what the first attempt
    // started.
    //
    // line_p_yes is DB-level immutable once set (migration 0014's
    // guard_house_line trigger), so a successful commitCouncil() call cannot
    // be used to set up this scenario and then unwind it — commitCouncil
    // always runs commitLine itself. Instead, commit_council is called
    // directly (as council-schema.test.ts's migration tests do), which lands
    // the round's commitment in the DB WITHOUT the JS-level commitLine call
    // that commit.ts normally makes right after it — exactly the crash this
    // test reproduces.
    const { db, rows } = await world();
    const full = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    const snapshot = full.map((q) => ({
      id: q.id, slot: q.slot, isBigOne: q.isBigOne, text: q.text, category: q.category, resolutionCriteria: q.resolutionCriteria,
      sourceName: q.sourceName, sourceUrl: q.sourceUrl, context: q.context, opensAt: q.opensAt.toISOString(), locksAt: q.locksAt.toISOString(), pYes: 0.40,
    }));
    const lines = full.map((q) => ({ question_id: q.id, member: "sonnet", p_yes: 0.40, model: "m-sonnet", prompt_version: "council-v1", reasoning: "R.", cited: [], lessons_received: [] }));
    await db.execute(sql`select commit_council(${DATE}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${"council-v1"}, ${"2099-09-10T14:00:00Z"}::timestamptz)`);
    const before = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(before!.linePYes).toBeNull();

    const deps = makeDeps(db, null);
    const retried = await commitCouncil(deps, DATE, [result("sonnet", rows, 0.90), result("opus", rows, 0.90)]);
    expect(retried).toEqual({ committed: false, reason: "already committed", lines: 0, slots: [] });
    const after = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(after!.linePYes).not.toBeNull();
    expect(Number(after!.linePYes)).toBe(0.40);
  });

  it("reports an uncommitted outcome, not a rejection, when commit_council itself raises", async () => {
    // commit_council wraps commit_oracle_forecast, which raises (rather than
    // returning false) once the opening deadline has passed — the same
    // failure that used to exhaust the Workflow's `commit` step's retries and
    // strand the round with no narration at all (finding 1).
    const { db, rows } = await world();
    const deps = { ...makeDeps(db, null), now: () => LATE };
    const c = await commitCouncil(deps, DATE, [result("sonnet", rows, 0.40), result("opus", rows, 0.31)]);
    expect(c.committed).toBe(false);
    expect(c.reason).toMatch(/deadline/);
    expect(c.lines).toBe(0);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.oracleCommittedAt).toBeNull();
  });
});

describe("runCouncil (the inline path)", () => {
  it("retrieves, asks all three members, commits, and narrates", async () => {
    const { db } = await world();
    const sent: string[] = [];
    const calls: StructuredCall[] = [];
    const claude = { structured: async (c: StructuredCall) => { calls.push(c); const p = c.model === "m-opus" ? 0.31 : c.model === "m-haiku" ? 0.44 : 0.40; return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p, reasoning: "R.", cited: [1] })) }; } };
    const run = await runCouncil(makeDeps(db, claude, sent), DATE);
    expect(run.editable).toBe(true);
    expect(run.evidence!.packs.length).toBe(5);
    expect(calls.map((c) => c.model)).toEqual(["m-sonnet", "m-opus", "m-haiku"]);
    expect(calls.every((c) => c.webSearch === undefined)).toBe(true);
    expect(run.commit!.committed).toBe(true);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("slot 1: sonnet 40 · opus 31 · haiku 44 · market 40 → median 40, line 40 (1 item)");
    expect(sent[0]).toContain("exa $0.05");
  });
  it("alerts with ‼️ when the round opens unstaked", async () => {
    const { db } = await world();
    const sent: string[] = [];
    const claude = { structured: async (c: StructuredCall) => { if (c.model !== "m-sonnet") throw new Error("down"); return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: 0.4, reasoning: "R.", cited: [] })) }; } };
    const run = await runCouncil(makeDeps(db, claude, sent), DATE);
    expect(run.commit!.committed).toBe(false);
    expect(sent[0]).toMatch(/^‼️/);
    expect(sent[0]).toContain("opus abstained (down)");
  });
  it("narrates with ‼️, not a rejection, when commit_council raises past the opening deadline", async () => {
    const { db } = await world();
    const sent: string[] = [];
    const claude = { structured: async (c: StructuredCall) => { const p = c.model === "m-opus" ? 0.31 : c.model === "m-haiku" ? 0.44 : 0.40; return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p, reasoning: "R.", cited: [1] })) }; } };
    const deps = { ...makeDeps(db, claude, sent), now: () => LATE };
    const run = await runCouncil(deps, DATE);
    expect(run.commit!.committed).toBe(false);
    expect(run.commit!.reason).toMatch(/deadline/);
    expect(sent[0]).toMatch(/^‼️/);
    expect(sent[0]).toContain("opens unstaked");
  });
  it("returns early on a version 2 round and on a committed round", async () => {
    const { db } = await world(2);
    const run = await runCouncil(makeDeps(db, null), DATE);
    expect(run.editable).toBe(false);
    expect(run.members).toEqual([]);
  });

  // A second top-level runCouncil() on an already-committed round returns
  // early via councilEditable — it never reaches commitCouncil or narration
  // again. The scenario this guards is the Workflow's own retry, which calls
  // commitCouncil and narrateCouncil as SEPARATE steps (workflow-entrypoints.ts):
  // a retried "commit" step sees "already committed" and the SAME run object
  // is then handed to the "narrate" step. This reproduces that hand-off
  // directly rather than through a second runCouncil call, which cannot reach
  // it at all.
  it("narrates without an alert when a retried commit step finds the round already staked", async () => {
    const { db } = await world();
    const sent: string[] = [];
    const claude = { structured: async (c: StructuredCall) => { const p = c.model === "m-opus" ? 0.31 : c.model === "m-haiku" ? 0.44 : 0.40; return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p, reasoning: "R.", cited: [1] })) }; } };
    const deps = makeDeps(db, claude, sent);
    const first = await runCouncil(deps, DATE);
    expect(first.commit!.committed).toBe(true);
    sent.length = 0;
    const retried = await commitCouncil(deps, DATE, first.members);
    expect(retried).toEqual({ committed: false, reason: "already committed", lines: 0, slots: [] });
    await narrateCouncil(deps, DATE, { editable: true, evidence: first.evidence, members: first.members, commit: retried });
    expect(sent.length).toBe(1);
    expect(sent[0]).not.toMatch(/^‼️/);
    expect(sent[0]).not.toContain("opens unstaked");
    expect(sent[0]).toContain(`council ${DATE}: already committed; nothing written`);
    // Each slot line reports the line that landed, not "no median" — commit's
    // slots array is [] on an already-committed outcome, so the member/median
    // form would be misleading here (finding 3).
    expect(sent[0]).toContain("slot 1: committed line 40");
    expect(sent[0]).not.toContain("no median");
  });
});
