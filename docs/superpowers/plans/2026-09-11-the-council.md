# The House — the Council Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A version 3 line that is the median of three model members reasoning over one shared Exa evidence pack per question, scored publicly on a standings page and CSV, fed back per-member lessons under a strict as-of rule, and shown on the reveal as the Council split and the Oracle's reading.

**Architecture:** Pure standings arithmetic and the new wire schemas live in `@oracle/core`. The API gains a third Workflow, `oracle-council`, whose steps retrieve evidence, ask each member in its own step, and commit the median through a SQL function that wraps the existing `commit_oracle_forecast`. The resolution workflow gains a lessons step per settled question. A new unauthenticated router serves the standings JSON, CSV and HTML page. The mobile reveal fills the slot Plan 2 reserved under each card's line, and adds the reading beneath it.

**Tech Stack:** TypeScript, pnpm workspaces, Hono on Cloudflare Workers with Workflows, Drizzle ORM on Neon Postgres (PGlite in tests), Zod, Vitest, Anthropic SDK via the existing `claude.ts` client, Exa search API, Expo / React Native.

**Spec:** `docs/superpowers/specs/2026-09-11-the-council-design.md`. It refines House spec `docs/superpowers/specs/2026-09-10-the-house-design.md` §5.4b, §13, §14 and the standings row of §7.

## Global Constraints

- Members and their fixed display order: `sonnet`, `opus`, `haiku`, `market` (spec §3). Prompt version `council-v1`; lesson prompt version `lesson-v1`.
- Only the model members vote in the median; the market member is scored and shown but never voted and never sent to a model (spec C2, §7).
- Fewer than two model members present on any question means no line for the round: it opens unstaked, exactly as an uncommitted round does today, and the narration carries `‼️` (spec §7).
- `lines` rows are immutable once written. Brier and house delta per member are computed at read time, never stored (spec C4).
- A member's house delta uses the member's line clamped by `clampLine` with the same market band the house uses (spec C5).
- Evidence: Exa search, eight results, published-date floor fourteen days before the retrieval instant and ceiling at that instant, highlights on, retrieved inside the Council workflow (spec §5, C6). No member call carries a web search tool.
- The as-of rule: a member receives at most five lessons from the question's series and three from any other, most recent first, only where `resolved_at` is strictly before the commit instant, and only its own (spec §6.1).
- Version 2 rounds keep `stampOracleForecast` and `commitLine` untouched. The Council applies to rounds at rules version 3 only (spec C1).
- The Neon HTTP driver has no interactive transactions; every multi-row atomic write is a SQL function, as `commit_oracle_forecast` already is.
- The next migration number is `0015`.
- Every network read goes through an injectable fetch on `PipelineDeps` (`marketFetch`, and the new `exaFetch`); tests never touch the network.
- Copy follows the two registers: tracked caps for what is recognised, sentence case for what is read. The four new player-facing names are Sonnet, Opus, Haiku and the market; the block is "the Oracle's reading". None of them is on the retired list, so the vocabulary lints need no change.
- Reserved-height slots on the reveal are load-bearing; new content goes inside a slot that reserves its height only when it has content.
- Commit after every task with the trailer `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/council.ts` (create) | `MEMBER_ORDER`, `medianLine`, `sideOf`, `onRightSide`, `memberBrier`, `memberHouseDelta`, `standingsRow`. Pure. |
| `packages/core/src/schemas.ts` (modify) | `CouncilEntrySchema`, `EvidenceItemSchema`, `council` and `evidence` on `RevealSchema`, `StandingsSchema`. |
| `packages/core/src/index.ts` (modify) | Export `council`. |
| `packages/core/test/council.test.ts`, `test/schemas-council.test.ts` (create) | Arithmetic and schema tests. |
| `apps/api/src/db/schema.ts` (modify) | `questions.marketSeriesKey`; tables `lines`, `evidence`, `lessons`. |
| `apps/api/drizzle/0015_*.sql` (generate + append) | The migration, plus `commit_council` and the `lines` immutability trigger. |
| `apps/api/src/pipeline/draft.ts` (modify) | `market.series_key` on the draft schema; written by `upsertDraft`. |
| `apps/api/src/pipeline/market-round.ts` (modify) | `toDraft` carries `series_key`. |
| `apps/api/src/standings.ts` (create) | Loads settled version 3 calls and folds them into standings rows and CSV rows. |
| `apps/api/src/routes/standings.ts` (create) | `GET /v1/standings` (JSON, `?format=csv`) and `GET /standings` (HTML). No auth. |
| `apps/api/src/app.ts` (modify) | Mount the standings router. |
| `apps/api/src/pipeline/council/members.ts` (create) | The member table and model resolution. |
| `apps/api/src/pipeline/council/evidence.ts` (create) | `retrieveEvidence`: Exa search per question into `evidence`. |
| `apps/api/src/pipeline/council/lessonsFor.ts` (create) | `lessonsFor`: the as-of selection. |
| `apps/api/src/pipeline/council/member.ts` (create) | `commitMember`: one member's structured call over five questions, abstention as a value. |
| `apps/api/src/pipeline/council/commit.ts` (create) | `commitCouncil`: medians, `commit_council`, `commitLine`. |
| `apps/api/src/pipeline/council/index.ts` (create) | `runCouncil` (inline path) and `narrateCouncil`. |
| `apps/api/src/pipeline/council/lessons.ts` (create) | `writeLessons`: one Haiku call per model member per settled question. |
| `apps/api/src/pipeline/workflows.ts` (modify) | `WorkflowKind` gains `council`; bindings and starters. |
| `apps/api/src/pipeline/workflow-entrypoints.ts` (modify) | `CouncilWorkflow`; the lessons step in `ResolutionWorkflow`. |
| `apps/api/src/pipeline/index.ts` (modify) | `exaApiKey`, `exaFetch`, optional council/lesson models on `PipelineDeps`; the forecast action branches on rules version. |
| `apps/api/src/pipeline/resolve.ts` (modify) | `runResolution` writes lessons inline; `resolveWithClaude` passes the instants. |
| `apps/api/src/pipeline/resolver.ts` (modify) | Date anchoring on `ResolverTarget` and the prompt. |
| `apps/api/src/pipeline/spend.ts` (modify) | The budget comment. |
| `apps/api/src/worker.ts`, `apps/api/wrangler.jsonc` (modify) | `EXA_API_KEY`, `COUNCIL_WORKFLOW`, `PIPELINE_LESSON_MODEL`, the council model vars. |
| `apps/api/src/routes/admin.ts` (modify) | `POST /rounds/:date/council`, counts on `GET /rounds/:date`, `GET /lessons`, `DELETE /lessons/:id`. |
| `apps/api/src/routes/round.ts` (modify) | `council` and `evidence` on the reveal. |
| `apps/api/test/fixtures/exa/search.json` (create) | An Exa response in the documented shape. |
| `apps/api/test/*.test.ts` (create per task) | `council-schema`, `standings`, `council-evidence`, `council-member`, `council-commit`, `council-lessons`, `pipeline-resolver` (modify), `reveal-council`, `admin-council`. |
| `apps/site/public/*.html` (modify) | The Standings nav link. |
| `apps/mobile/src/game/council.ts` (create) | `councilFor`, `splitRows`, `readingFor`, `memberName`. Pure. |
| `apps/mobile/src/ui/EvidenceCard.tsx`, `ui/CouncilReading.tsx` (create) | The evidence card and the reading block. |
| `apps/mobile/src/app/reveal/[date].tsx` (modify) | The split in the reserved slot; the reading under each model member's row. |
| `apps/mobile/src/analytics/analytics.ts` (modify) | `reading_opened`. |
| `apps/mobile/test/council.test.ts` (create) | The pure modules. |

Task order follows the roadmap: the open record first (Tasks 1 to 3), the Council and memory second (Tasks 4 to 9), the reveal API and site (Tasks 10 and 11), mobile last (Tasks 12 to 14) so it can be cut at a task boundary.

---

### Task 1: Council arithmetic and the wire schemas in core

**Files:**
- Create: `packages/core/src/council.ts`
- Modify: `packages/core/src/schemas.ts` (after `RevealSchema`'s `house_delta` line and after the `AllTimeBoardSchema`)
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/council.test.ts`, `packages/core/test/schemas-council.test.ts`

**Interfaces:**
- Consumes: `payout`, `clampLine`, `Outcome` from `./fortune`.
- Produces:
  - `export type MemberId = "sonnet" | "opus" | "haiku" | "market"`; `export const MEMBER_ORDER: readonly MemberId[]`; `export const MODEL_MEMBER_IDS: readonly ("sonnet" | "opus" | "haiku")[]`.
  - `medianLine(values: number[]): number | null` — null under two values.
  - `sideOf(p: number): "yes" | "no" | null`; `onRightSide(p: number, outcome: Outcome | null): boolean | null`.
  - `memberBrier(p: number, outcome: "yes" | "no"): number`.
  - `memberHouseDelta(input: { line: number; marketProb: number | null; outcome: Outcome; predictions: { answer: boolean; stake: number }[] }): number`.
  - `standingsRow(calls: StandingsCall[]): { calls: number; brier: number | null; house_delta: number }` with `export interface StandingsCall { p: number; marketProb: number | null; outcome: "yes" | "no"; predictions: { answer: boolean; stake: number }[] }`.
  - Schemas: `CouncilEntrySchema`, `EvidenceItemSchema`, `StandingsSchema`; `RevealSchema` gains `council: z.array(CouncilEntrySchema).default([])` and `evidence: z.array(EvidenceItemSchema).default([])`. Types `CouncilEntry`, `EvidenceItem`, `Standings`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/council.test.ts
import { describe, it, expect } from "vitest";
import { medianLine, sideOf, onRightSide, memberBrier, memberHouseDelta, standingsRow, MEMBER_ORDER } from "../src/council";
import { payout, clampLine } from "../src/fortune";

describe("the median (spec §7)", () => {
  it("is null under two values", () => {
    expect(medianLine([])).toBeNull();
    expect(medianLine([0.4])).toBeNull();
  });
  it("is the mean of two and the middle of three", () => {
    expect(medianLine([0.4, 0.3])).toBeCloseTo(0.35, 10);
    expect(medianLine([0.44, 0.31, 0.40])).toBe(0.40);
  });
  it("is the mean of the middle two of four", () => {
    expect(medianLine([0.1, 0.2, 0.6, 0.9])).toBeCloseTo(0.4, 10);
  });
});

describe("sides", () => {
  it("is neither at exactly 0.5", () => {
    expect(sideOf(0.5)).toBeNull();
    expect(sideOf(0.51)).toBe("yes");
    expect(sideOf(0.49)).toBe("no");
  });
  it("is null on void and on an undecided outcome", () => {
    expect(onRightSide(0.7, "void")).toBeNull();
    expect(onRightSide(0.7, null)).toBeNull();
    expect(onRightSide(0.5, "yes")).toBeNull();
    expect(onRightSide(0.7, "yes")).toBe(true);
    expect(onRightSide(0.7, "no")).toBe(false);
  });
});

describe("member Brier", () => {
  it("is the squared distance to the outcome", () => {
    expect(memberBrier(0.7, "yes")).toBeCloseTo(0.09, 10);
    expect(memberBrier(0.7, "no")).toBeCloseTo(0.49, 10);
  });
});

describe("member house delta (spec C5)", () => {
  const preds = [{ answer: true, stake: 50 }, { answer: false, stake: 30 }, { answer: true, stake: 10 }];
  it("equals the real house delta when the member's line is the house line", () => {
    const line = clampLine(0.35, 0.40);
    const expected = preds.reduce((s, p) => s + p.stake - payout({ stake: p.stake, answer: p.answer, line, outcome: "yes" }), 0);
    expect(memberHouseDelta({ line: 0.35, marketProb: 0.40, outcome: "yes", predictions: preds })).toBe(expected);
  });
  it("clamps a wild line to the market band before pricing", () => {
    const wild = memberHouseDelta({ line: 0.02, marketProb: 0.40, outcome: "yes", predictions: preds });
    const edge = memberHouseDelta({ line: 0.25, marketProb: 0.40, outcome: "yes", predictions: preds });
    expect(wild).toBe(edge);
  });
  it("is zero on a void", () => {
    expect(memberHouseDelta({ line: 0.35, marketProb: 0.40, outcome: "void", predictions: preds })).toBe(0);
  });
  it("is zero with no stakes", () => {
    expect(memberHouseDelta({ line: 0.35, marketProb: null, outcome: "no", predictions: [] })).toBe(0);
  });
});

describe("standings row", () => {
  it("aggregates calls, mean Brier and house delta", () => {
    const row = standingsRow([
      { p: 0.7, marketProb: 0.6, outcome: "yes", predictions: [{ answer: true, stake: 100 }] },
      { p: 0.2, marketProb: 0.3, outcome: "yes", predictions: [{ answer: false, stake: 100 }] },
    ]);
    expect(row.calls).toBe(2);
    expect(row.brier).toBeCloseTo((0.09 + 0.64) / 2, 10);
    // Call 1: player YES at line 0.7 pays 100 + round(100 × 0.3/0.7) = 143 → house −43.
    // Call 2: player NO at line 0.2, outcome YES → house +100.
    expect(row.house_delta).toBe(57);
  });
  it("has a null Brier with no calls", () => {
    expect(standingsRow([])).toEqual({ calls: 0, brier: null, house_delta: 0 });
  });
  it("keeps the fixed member order", () => {
    expect(MEMBER_ORDER).toEqual(["sonnet", "opus", "haiku", "market"]);
  });
});
```

```ts
// packages/core/test/schemas-council.test.ts
import { describe, it, expect } from "vitest";
import { RevealSchema, StandingsSchema, CouncilEntrySchema, EvidenceItemSchema } from "../src/schemas";

const base = {
  rules_version: 3, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null,
  questions: [{
    id: "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e", slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 12, market_prob: 0.40, line_p_yes: 0.35,
    my: null, source_name: "Kalshi", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: 0.35,
  }],
  ledger: { settled: true, streak: 1, calls_rated: 0, oracle_score: null },
};

describe("the Council on the wire (spec §13)", () => {
  it("parses a reveal without council or evidence as empty", () => {
    const r = RevealSchema.parse(base);
    expect(r.council).toEqual([]);
    expect(r.evidence).toEqual([]);
  });
  it("carries entries and items", () => {
    const r = RevealSchema.parse({
      ...base,
      council: [{ question_id: base.questions[0]!.id, member: "sonnet", p_yes: 0.4, on_right_side: false, reasoning: "Because.", cited: [1, 3], lessons_received: 2 },
                { question_id: base.questions[0]!.id, member: "market", p_yes: 0.4, on_right_side: false, reasoning: null, cited: [], lessons_received: 0 }],
      evidence: [{ question_id: base.questions[0]!.id, rank: 1, url: "https://a.example/x", title: "A", source: "a.example", published_at: "2026-09-09T00:00:00.000Z", highlight: "h" }],
    });
    expect(r.council[1]!.reasoning).toBeNull();
    expect(r.evidence[0]!.rank).toBe(1);
  });
  it("rejects a member outside the table", () => {
    expect(CouncilEntrySchema.safeParse({ question_id: base.questions[0]!.id, member: "gpt", p_yes: 0.4, on_right_side: null, reasoning: null, cited: [], lessons_received: 0 }).success).toBe(false);
  });
  it("allows a null published date on evidence", () => {
    expect(EvidenceItemSchema.safeParse({ question_id: base.questions[0]!.id, rank: 2, url: "https://b", title: "B", source: "b", published_at: null, highlight: "h" }).success).toBe(true);
  });
  it("parses standings", () => {
    const s = StandingsSchema.parse({ as_of: "2026-09-11T12:00:00.000Z", rounds: 1, questions: 5, rows: [{ member: "sonnet", calls: 5, brier: 0.2, house_delta: -40 }, { member: "crowd", calls: 5, brier: null, house_delta: 0 }] });
    expect(s.rows[1]!.member).toBe("crowd");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run test/council.test.ts test/schemas-council.test.ts`
Expected: FAIL, `../src/council` not found; `StandingsSchema` not exported.

- [ ] **Step 3: Implement**

```ts
// packages/core/src/council.ts
// The Council (design 2026-09-11 §3, §7, §12): a plural line, scored per
// member at read time. Pure; no I/O.
import { clampLine, payout, type Outcome } from "./fortune";

export type MemberId = "sonnet" | "opus" | "haiku" | "market";
export type ModelMemberId = Exclude<MemberId, "market">;
export const MEMBER_ORDER: readonly MemberId[] = ["sonnet", "opus", "haiku", "market"];
export const MODEL_MEMBER_IDS: readonly ModelMemberId[] = ["sonnet", "opus", "haiku"];

/** The median of the members present; null under two (spec §7). */
export function medianLine(values: number[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Which side a line is on. Exactly 0.5 is neither. */
export function sideOf(p: number): "yes" | "no" | null {
  if (p === 0.5) return null;
  return p > 0.5 ? "yes" : "no";
}

export function onRightSide(p: number, outcome: Outcome | null): boolean | null {
  if (outcome === null || outcome === "void") return null;
  const side = sideOf(p);
  if (side === null) return null;
  return side === outcome;
}

/** Squared distance from the line to the outcome. A proper score. */
export function memberBrier(p: number, outcome: "yes" | "no"): number {
  const y = outcome === "yes" ? 1 : 0;
  return (p - y) ** 2;
}

/**
 * What the purse would have done had this member's line been the house alone,
 * at the stakes players actually placed (spec C5). The member's line is
 * clamped exactly as the house line is, so a wild line prices as the house
 * would have priced it.
 */
export function memberHouseDelta(input: { line: number; marketProb: number | null; outcome: Outcome; predictions: { answer: boolean; stake: number }[] }): number {
  if (input.outcome === "void") return 0;
  const line = clampLine(input.line, input.marketProb);
  return input.predictions.reduce((sum, p) => sum + p.stake - payout({ stake: p.stake, answer: p.answer, line, outcome: input.outcome }), 0);
}

export interface StandingsCall {
  p: number;
  marketProb: number | null;
  outcome: "yes" | "no";
  predictions: { answer: boolean; stake: number }[];
}

export function standingsRow(calls: StandingsCall[]): { calls: number; brier: number | null; house_delta: number } {
  if (calls.length === 0) return { calls: 0, brier: null, house_delta: 0 };
  const brier = calls.reduce((s, c) => s + memberBrier(c.p, c.outcome), 0) / calls.length;
  const house_delta = calls.reduce((s, c) => s + memberHouseDelta({ line: c.p, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }), 0);
  return { calls: calls.length, brier, house_delta };
}
```

In `packages/core/src/schemas.ts`, add before `RevealSchema`:

```ts
// The Council on the wire (design 2026-09-11 §13). Both arrays default to
// empty so an older server still parses.
export const CouncilEntrySchema = z.object({
  question_id: z.string().uuid(),
  member: z.enum(["sonnet", "opus", "haiku", "market"]),
  p_yes: z.number(),
  on_right_side: z.boolean().nullable(),
  reasoning: z.string().nullable(),
  cited: z.array(z.number().int()),
  lessons_received: z.number().int(),
});
export type CouncilEntry = z.infer<typeof CouncilEntrySchema>;
export const EvidenceItemSchema = z.object({
  question_id: z.string().uuid(),
  rank: z.number().int(),
  url: z.string(),
  title: z.string(),
  source: z.string(),
  published_at: z.string().nullable(),
  highlight: z.string(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;
```

In `RevealSchema`, after `house_delta: z.number().int().nullable().default(null),` add:

```ts
  council: z.array(CouncilEntrySchema).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
```

After `AllTimeBoardSchema` add:

```ts
// The open record (design 2026-09-11 §13). Public; nothing about any player.
export const StandingsSchema = z.object({
  as_of: z.string(),
  rounds: z.number().int(),
  questions: z.number().int(),
  rows: z.array(z.object({
    member: z.enum(["sonnet", "opus", "haiku", "market", "crowd"]),
    calls: z.number().int(),
    brier: z.number().nullable(),
    house_delta: z.number().int(),
  })),
});
export type Standings = z.infer<typeof StandingsSchema>;
```

In `packages/core/src/index.ts` add `export * from "./council";` after the `fortune` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: PASS. If `round-schemas.test.ts` compares a parsed reveal fixture by deep equality, add `council: [], evidence: []` to that fixture's expected object (the same trap Plan 1 and the ritual-core pass hit).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/council.ts packages/core/src/schemas.ts packages/core/src/index.ts packages/core/test/council.test.ts packages/core/test/schemas-council.test.ts packages/core/test/round-schemas.test.ts
git commit -m "feat(core): the Council's median, sides, member scores and wire schemas

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 2: Schema — `lines`, `evidence`, `lessons`, the series key and `commit_council`

**Files:**
- Modify: `apps/api/src/db/schema.ts` (after `marketClosesAt` in `questions`; new tables after `pipelineUsage`)
- Generate: `apps/api/drizzle/0015_<name>.sql` via drizzle-kit, then append the function and trigger
- Modify: `apps/api/src/pipeline/draft.ts:53-58` (the `market` object), `draft.ts` `upsertDraft` rows
- Modify: `apps/api/src/pipeline/market-round.ts:115` (`toDraft`'s `market` literal)
- Test: `apps/api/test/council-schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `schema.lines`, `schema.evidence`, `schema.lessons`; column `schema.questions.marketSeriesKey`; SQL function `commit_council(p_date date, p_snapshot jsonb, p_lines jsonb, p_version text, p_checked_at timestamptz) returns boolean`; draft field `market.series_key?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/council-schema.test.ts
import { describe, it, expect } from "vitest";
import { eq, sql } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { upsertDraft, DraftSchema } from "../src/pipeline/draft";
import { validDraft } from "./helpers/draft";

// 2099, not 2026: commit_oracle_forecast compares the opening deadline with the
// database clock, so a real date would fail with "opening deadline passed".
const DATE = "2099-09-10";

async function scheduled() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2099-09-10T16:00:00Z"), locksAt: new Date("2099-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", marketProb: "0.40" }).where(eq(schema.questions.roundDate, DATE));
  return { db, rows };
}

function snapshotFor(qs: { id: string; slot: number }[], full: Array<typeof schema.questions.$inferSelect>, pYes: number) {
  return full.map((q) => ({
    id: q.id, slot: q.slot, isBigOne: q.isBigOne, text: q.text, category: q.category, resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName, sourceUrl: q.sourceUrl, context: q.context, opensAt: q.opensAt.toISOString(), locksAt: q.locksAt.toISOString(), pYes,
  }));
}

describe("migration 0015", () => {
  it("creates lines, evidence and lessons, and the series key", async () => {
    const { db, rows } = await scheduled();
    await db.insert(schema.evidence).values({ questionId: rows[0]!.id, rank: 1, url: "https://a", title: "A", source: "a", publishedAt: null, highlight: "h", retrievedAt: new Date() });
    await db.insert(schema.lessons).values({ member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[0]!.id, text: "Lesson.", resolvedAt: new Date() });
    await db.update(schema.questions).set({ marketSeriesKey: "KXHIGHNY" }).where(eq(schema.questions.id, rows[0]!.id));
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(q!.marketSeriesKey).toBe("KXHIGHNY");
    expect((await db.query.evidence.findMany()).length).toBe(1);
    expect((await db.query.lessons.findMany()).length).toBe(1);
  });

  it("commit_council writes oracle_p_yes and the lines rows together, once", async () => {
    const { db, rows } = await scheduled();
    const full = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    const snapshot = snapshotFor(rows, full, 0.4);
    const lines = full.flatMap((q) => [
      { question_id: q.id, member: "sonnet", p_yes: 0.4, model: "m-s", prompt_version: "council-v1", reasoning: "R.", cited: [1, 2], lessons_received: [] },
      { question_id: q.id, member: "market", p_yes: 0.4, model: null, prompt_version: null, reasoning: null, cited: [], lessons_received: [] },
    ]);
    const call = (checkedAt: string) => db.execute(sql`select commit_council(${DATE}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${"council-v1"}, ${checkedAt}::timestamptz) as ok`);
    const first = await call("2099-09-10T14:00:00Z");
    expect((first.rows[0] as { ok: boolean }).ok).toBe(true);
    const written = await db.query.lines.findMany();
    expect(written.length).toBe(10);
    expect(written.find((l) => l.member === "sonnet")!.cited).toEqual([1, 2]);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.oracleForecastModel).toBe("council");
    expect(round!.oraclePromptVersion).toBe("council-v1");
    expect(Number((await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) }))!.oracleProbYes)).toBe(0.4);
    // A second call is a no-op: commit_oracle_forecast returns false and no lines are added.
    const second = await call("2099-09-10T14:05:00Z");
    expect((second.rows[0] as { ok: boolean }).ok).toBe(false);
    expect((await db.query.lines.findMany()).length).toBe(10);
  });

  it("a failed snapshot check rolls the lines back too", async () => {
    const { db, rows } = await scheduled();
    const full = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    const snapshot = snapshotFor(rows, full, 0.4).map((s, i) => (i === 0 ? { ...s, text: "changed" } : s));
    const lines = [{ question_id: rows[0]!.id, member: "sonnet", p_yes: 0.4, model: "m", prompt_version: "v", reasoning: "R.", cited: [], lessons_received: [] }];
    await expect(db.execute(sql`select commit_council(${DATE}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${"v"}, ${"2099-09-10T14:00:00Z"}::timestamptz)`)).rejects.toThrow(/snapshot/);
    expect((await db.query.lines.findMany()).length).toBe(0);
  });

  it("lines rows are immutable", async () => {
    const { db, rows } = await scheduled();
    await db.insert(schema.lines).values({ questionId: rows[0]!.id, member: "haiku", pYes: "0.5", committedAt: new Date() });
    await expect(db.update(schema.lines).set({ pYes: "0.6" }).where(eq(schema.lines.member, "haiku"))).rejects.toThrow(/immutable/);
  });

  it("the draft carries the series key through upsertDraft", async () => {
    const { db } = await makeTestDb();
    const draft = DraftSchema.parse({
      questions: validDraft.questions.map((q, i) => ({
        ...q, resolves_at: "2026-09-12T20:00:00.000Z",
        market: { source: "kalshi", id: `T${i}`, event_key: `E${i}`, series_key: `S${i}`, closes_at: "2026-09-12T20:00:00.000Z" },
      })),
    });
    await upsertDraft(db, "2026-09-11", draft, 3);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-11"), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => q.marketSeriesKey)).toEqual(["S0", "S1", "S2", "S3", "S4"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/council-schema.test.ts`
Expected: FAIL, `schema.evidence` undefined.

- [ ] **Step 3: Implement the Drizzle schema**

In `apps/api/src/db/schema.ts`, add `sql` to the imports (`import { sql } from "drizzle-orm";`). After `marketClosesAt` in `questions`:

```ts
  // The exchange's recurring series (design 2026-09-11 §9): Kalshi series
  // ticker, Polymarket first tag. Keys a member's lessons; null falls back to
  // the category.
  marketSeriesKey: text("market_series_key"),
```

After `pipelineUsage`:

```ts
// The Council (design 2026-09-11 §11). One row per question and member,
// written by commit_council in the same statement as oracle_p_yes and never
// rewritten. Scores are computed at read time, never stored (spec C4).
export const lines = pgTable("lines", {
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  member: text("member").notNull(),
  pYes: numeric("p_yes").notNull(),
  committedAt: timestamp("committed_at", { withTimezone: true }).notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  reasoning: text("reasoning"),
  cited: integer("cited").array().notNull().default(sql`'{}'::integer[]`),
  lessonsReceived: uuid("lessons_received").array().notNull().default(sql`'{}'::uuid[]`),
}, (t) => [primaryKey({ columns: [t.questionId, t.member] })]);

// The shared evidence pack (design 2026-09-11 §5): one Exa search per
// question, numbered in rank order, the same pack for every member.
export const evidence = pgTable("evidence", {
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  rank: integer("rank").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  highlight: text("highlight").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.questionId, t.rank] })]);

// Memory (design 2026-09-11 §8): one lesson per model member per settled
// question, fed back under the as-of rule on resolved_at.
export const lessons = pgTable("lessons", {
  id: uuid("id").primaryKey().defaultRandom(),
  member: text("member").notNull(),
  seriesKey: text("series_key").notNull(),
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("lessons_member_question_idx").on(t.member, t.questionId),
  index("lessons_member_series_idx").on(t.member, t.seriesKey, t.resolvedAt),
]);
```

- [ ] **Step 4: Generate the migration and append the function**

Run: `cd apps/api && pnpm db:generate`
Expected: a new `drizzle/0015_<adjective_noun>.sql` and a journal entry with `idx: 15`. Open the file and confirm it adds the column, the three tables, their keys and indexes, and nothing else. Then append:

```sql
--> statement-breakpoint
-- The Council commit (design 2026-09-11 §7). Wraps commit_oracle_forecast so
-- the members' rows land in the same statement as oracle_p_yes: the Neon
-- HTTP driver has no interactive transactions, and a function is one.
-- Returns false, writing nothing, when the round is already committed.
CREATE FUNCTION commit_council(
  p_date date, p_snapshot jsonb, p_lines jsonb, p_version text, p_checked_at timestamptz
) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  committed boolean;
BEGIN
  committed := commit_oracle_forecast(p_date, p_snapshot, 'council', p_version, p_checked_at);
  IF NOT committed THEN RETURN false; END IF;
  INSERT INTO lines (question_id, member, p_yes, committed_at, model, prompt_version, reasoning, cited, lessons_received)
  SELECT (x->>'question_id')::uuid, x->>'member', (x->>'p_yes')::numeric, p_checked_at,
         x->>'model', x->>'prompt_version', x->>'reasoning',
         coalesce((SELECT array_agg(v::integer) FROM jsonb_array_elements_text(coalesce(x->'cited', '[]'::jsonb)) v), '{}'::integer[]),
         coalesce((SELECT array_agg(v::uuid) FROM jsonb_array_elements_text(coalesce(x->'lessons_received', '[]'::jsonb)) v), '{}'::uuid[])
  FROM jsonb_array_elements(p_lines) x;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- A member's line is a commitment (design 2026-09-11 C4). Deletes are left to
-- the cascade from questions; nothing rewrites a row.
CREATE FUNCTION guard_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lines: a member''s line is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lines_immutable BEFORE UPDATE ON lines
  FOR EACH ROW EXECUTE FUNCTION guard_lines_immutable();
```

- [ ] **Step 5: The draft's series key**

In `apps/api/src/pipeline/draft.ts`, the `market` object gains one line after `event_key`:

```ts
      series_key: z.string().min(1).optional(),
```

In `upsertDraft`'s row literal, after `marketEventKey: q.market?.event_key ?? null,`:

```ts
      marketSeriesKey: q.market?.series_key ?? null,
```

In `apps/api/src/pipeline/market-round.ts` `toDraft`, the `market` literal becomes:

```ts
        market: { source: c.source, id: c.marketId, event_key: c.eventKey, series_key: c.seriesKey, closes_at: c.closesAt },
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && npx vitest run test/council-schema.test.ts test/market-round.test.ts test/draft.test.ts && pnpm typecheck`
Expected: PASS. If a market-round test compares `toDraft`'s output by deep equality, add `series_key` to its expected `market` object.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/pipeline/draft.ts apps/api/src/pipeline/market-round.ts apps/api/test/council-schema.test.ts apps/api/test
git commit -m "feat(db): lines, evidence, lessons, the series key and commit_council

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 3: The open record — `GET /v1/standings`, the CSV and the page

**Files:**
- Create: `apps/api/src/standings.ts`
- Create: `apps/api/src/routes/standings.ts`
- Modify: `apps/api/src/app.ts` (imports; two `app.route` lines)
- Test: `apps/api/test/standings.test.ts`

**Interfaces:**
- Consumes: `standingsRow`, `MEMBER_ORDER`, `StandingsCall`, `clampLine` from `@oracle/core`; tables from Task 2.
- Produces:
  - `export interface SettledCall { date: string; slot: number; text: string; marketSource: string | null; marketId: string | null; marketProb: number | null; linePYes: number; crowdYesPct: number | null; crowdCount: number | null; outcome: "yes" | "no"; lines: { member: string; pYes: number }[]; predictions: { answer: boolean; stake: number }[] }`
  - `export async function loadSettledCalls(db: Db): Promise<SettledCall[]>` — settled version 3 questions with a line and a yes/no outcome, oldest first, slot order.
  - `export function standings(calls: SettledCall[], asOf: Date): Standings` — the rows in `MEMBER_ORDER` then `crowd`.
  - `export function standingsCsv(calls: SettledCall[]): string` — header plus one row per call and member.
  - `export function standingsHtml(s: Standings): string`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/standings.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { StandingsSchema } from "@oracle/core";
import { loadSettledCalls, standings, standingsCsv } from "../src/standings";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

// One settled version 3 round: five questions, lines for sonnet, opus and
// market on each, one player staked YES 50 on every card, slots 1-4 YES and
// slot 5 NO, plus a void slot in a second round that must be ignored.
async function settledWorld() {
  const { db } = await makeTestDb();
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "resolved" }).where(eq(schema.rounds.date, DATE));
  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  for (const q of qs) {
    const outcome = q.slot === 5 ? "no" : "yes";
    await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40", oracleProbYes: "0.35", marketSource: "kalshi", marketId: `T${q.slot}`, status: "resolved", outcome, crowdYesPct: "60", crowdCount: 10 }).where(eq(schema.questions.id, q.id));
    await db.insert(schema.lines).values([
      { questionId: q.id, member: "sonnet", pYes: "0.30", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "R." },
      { questionId: q.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "R." },
      { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
    ]);
    await db.insert(schema.predictions).values({ questionId: q.id, userId: user!.id, answer: true, confidence: 75, stake: 50, linePYes: "0.35", fortuneAtSeal: 1000, payout: outcome === "yes" ? 143 : 0, settledAt: new Date() });
  }
  // A void question in a second round: never a call.
  const other = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "resolved" }).where(eq(schema.rounds.date, "2026-09-09"));
  await db.update(schema.questions).set({ linePYes: "0.5", status: "void", outcome: "void" }).where(eq(schema.questions.id, other[0]!.id));
  await db.insert(schema.lines).values({ questionId: other[0]!.id, member: "sonnet", pYes: "0.5", committedAt: new Date("2026-09-09T14:00:00Z") });
  return { db, qs };
}

describe("loadSettledCalls", () => {
  it("returns only settled version 3 questions with a line and a yes/no outcome", async () => {
    const { db } = await settledWorld();
    const calls = await loadSettledCalls(db);
    expect(calls.length).toBe(5);
    expect(calls.map((c) => c.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(calls[0]!.lines.map((l) => l.member).sort()).toEqual(["market", "opus", "sonnet"]);
    expect(calls[0]!.predictions).toEqual([{ answer: true, stake: 50 }]);
  });
});

describe("standings", () => {
  it("scores every member, the crowd and the market, in order", async () => {
    const { db } = await settledWorld();
    const s = standings(await loadSettledCalls(db), new Date("2026-09-11T12:00:00Z"));
    expect(s.rows.map((r) => r.member)).toEqual(["sonnet", "opus", "haiku", "market", "crowd"]);
    expect(s.rounds).toBe(1);
    expect(s.questions).toBe(5);
    const sonnet = s.rows[0]!;
    // Four YES at 0.30 → 0.49 each; one NO at 0.30 → 0.09.
    expect(sonnet.calls).toBe(5);
    expect(sonnet.brier).toBeCloseTo((4 * 0.49 + 0.09) / 5, 10);
    // Sonnet's 0.30 sits inside the band around 0.40, so it prices as is. Player YES 50 at 0.30 pays 50 + round(50 × 0.7/0.3) = 167 → house −117 on four cards, +50 on the fifth.
    expect(sonnet.house_delta).toBe(-468 + 50);
    expect(s.rows[2]).toEqual({ member: "haiku", calls: 0, brier: null, house_delta: 0 });
    const crowd = s.rows[4]!;
    expect(crowd.calls).toBe(5);
    expect(crowd.brier).toBeCloseTo((4 * 0.16 + 0.36) / 5, 10);
  });
});

describe("the CSV", () => {
  it("has the stated columns, one row per call and member, and no player fields", async () => {
    const { db } = await settledWorld();
    const csv = standingsCsv(await loadSettledCalls(db));
    const [header, ...rows] = csv.trim().split("\n");
    expect(header).toBe("date,slot,question,market_source,market_id,market_prob,member,member_line,house_line,crowd_yes_pct,crowd_count,outcome");
    expect(rows.length).toBe(15);
    expect(rows[0]).toBe("2026-09-10,1,Question 1?,kalshi,T1,0.4,sonnet,0.3,0.35,60,10,yes");
    expect(csv).not.toMatch(/user|stake|payout/);
  });
  it("quotes a question containing a comma or a quote", async () => {
    const { db, qs } = await settledWorld();
    await db.update(schema.questions).set({ text: 'Will "it", happen?' }).where(eq(schema.questions.id, qs[0]!.id));
    const csv = standingsCsv(await loadSettledCalls(db));
    expect(csv.split("\n")[1]).toContain('"Will ""it"", happen?"');
  });
});

describe("the routes", () => {
  it("serve JSON, CSV and HTML without a device token", async () => {
    const { db } = await settledWorld();
    const app = createApp({ db, env });
    const json = await app.request("/v1/standings");
    expect(json.status).toBe(200);
    expect(json.headers.get("cache-control")).toBe("public, max-age=300");
    const parsed = StandingsSchema.parse(await json.json());
    expect(parsed.rows.length).toBe(5);
    const csv = await app.request("/v1/standings?format=csv");
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect((await csv.text()).split("\n")[0]).toMatch(/^date,slot/);
    const html = await app.request("/standings");
    expect(html.headers.get("content-type")).toContain("text/html");
    const body = await html.text();
    expect(body).toContain("<table");
    expect(body).toContain("Sonnet");
    expect(body).toContain("/v1/standings?format=csv");
  });
  it("renders an empty record", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const s = StandingsSchema.parse(await (await app.request("/v1/standings")).json());
    expect(s.rows.every((r) => r.calls === 0)).toBe(true);
    expect((await app.request("/standings")).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/standings.test.ts`
Expected: FAIL, `../src/standings` not found.

- [ ] **Step 3: Implement the loader, the fold, the CSV and the page**

```ts
// apps/api/src/standings.ts
// The open record (design 2026-09-11 §13): every member scored on every
// settled version 3 question, the crowd and the market beside them, and the
// CSV that is the dataset. Nothing here names a player.
import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { MEMBER_ORDER, clampLine, standingsRow, type Standings, type StandingsCall } from "@oracle/core";
import { schema, type Db } from "./db/client";

export interface SettledCall {
  date: string;
  slot: number;
  text: string;
  marketSource: string | null;
  marketId: string | null;
  marketProb: number | null;
  linePYes: number;
  crowdYesPct: number | null;
  crowdCount: number | null;
  outcome: "yes" | "no";
  lines: { member: string; pYes: number }[];
  predictions: { answer: boolean; stake: number }[];
}

export async function loadSettledCalls(db: Db): Promise<SettledCall[]> {
  const qs = await db
    .select({
      id: schema.questions.id, date: schema.questions.roundDate, slot: schema.questions.slot, text: schema.questions.text,
      marketSource: schema.questions.marketSource, marketId: schema.questions.marketId, marketProb: schema.questions.marketProb,
      linePYes: schema.questions.linePYes, crowdYesPct: schema.questions.crowdYesPct, crowdCount: schema.questions.crowdCount, outcome: schema.questions.outcome,
    })
    .from(schema.questions)
    .innerJoin(schema.rounds, eq(schema.rounds.date, schema.questions.roundDate))
    .where(and(gte(schema.rounds.rulesVersion, 3), isNotNull(schema.questions.linePYes), inArray(schema.questions.outcome, ["yes", "no"])))
    .orderBy(asc(schema.questions.roundDate), asc(schema.questions.slot));
  if (qs.length === 0) return [];
  const ids = qs.map((q) => q.id);
  const [lines, preds] = await Promise.all([
    db.query.lines.findMany({ where: inArray(schema.lines.questionId, ids) }),
    db.query.predictions.findMany({ where: and(inArray(schema.predictions.questionId, ids), isNotNull(schema.predictions.stake)), columns: { questionId: true, answer: true, stake: true } }),
  ]);
  return qs.map((q) => ({
    date: q.date,
    slot: q.slot,
    text: q.text,
    marketSource: q.marketSource,
    marketId: q.marketId,
    marketProb: q.marketProb === null ? null : Number(q.marketProb),
    linePYes: Number(q.linePYes),
    crowdYesPct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
    crowdCount: q.crowdCount,
    outcome: q.outcome as "yes" | "no",
    lines: lines.filter((l) => l.questionId === q.id).map((l) => ({ member: l.member, pYes: Number(l.pYes) })),
    predictions: preds.filter((p) => p.questionId === q.id).map((p) => ({ answer: p.answer, stake: p.stake! })),
  }));
}

export function standings(calls: SettledCall[], asOf: Date): Standings {
  const forMember = (member: string): StandingsCall[] =>
    calls.flatMap((c) => {
      const line = c.lines.find((l) => l.member === member);
      return line ? [{ p: line.pYes, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }] : [];
    });
  const crowd: StandingsCall[] = calls.flatMap((c) =>
    c.crowdYesPct === null ? [] : [{ p: c.crowdYesPct / 100, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }],
  );
  return {
    as_of: asOf.toISOString(),
    rounds: new Set(calls.map((c) => c.date)).size,
    questions: calls.length,
    rows: [
      ...MEMBER_ORDER.map((member) => ({ member, ...standingsRow(forMember(member)) })),
      { member: "crowd" as const, ...standingsRow(crowd) },
    ],
  };
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = "date,slot,question,market_source,market_id,market_prob,member,member_line,house_line,crowd_yes_pct,crowd_count,outcome";

export function standingsCsv(calls: SettledCall[]): string {
  const rows = calls.flatMap((c) =>
    [...c.lines].sort((a, b) => MEMBER_ORDER.indexOf(a.member as never) - MEMBER_ORDER.indexOf(b.member as never)).map((l) =>
      [c.date, c.slot, c.text, c.marketSource, c.marketId, c.marketProb, l.member, l.pYes, c.linePYes, c.crowdYesPct, c.crowdCount, c.outcome].map(csvCell).join(","),
    ),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

const NAMES: Record<string, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", market: "The market", crowd: "The players" };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The site's tokens, inlined (apps/site/public/style.css): the page is served
// from the API host and must not depend on the site's stylesheet.
const STYLE = `:root{--ground:#F7F6F2;--ink:#17191F;--muted:#666A73;--gold-text:#7E6538;--line:rgba(23,25,31,.16)}
@media (prefers-color-scheme:dark){:root{--ground:#121A2B;--ink:#EDEAE2;--muted:#9AA3B6;--gold-text:#D6BA80;--line:rgba(237,234,226,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.65}
.wrap{max-width:720px;margin:0 auto;padding:30px 24px 100px}
.brand{font-family:Cinzel,Georgia,serif;font-weight:600;font-size:13px;letter-spacing:.4em;color:var(--gold-text);text-decoration:none}
h1{font-family:Marcellus,Georgia,serif;font-weight:400;font-size:28px;margin:28px 0 8px}
p{color:var(--muted);margin:0 0 18px}
table{border-collapse:collapse;width:100%;margin:12px 0 24px}
th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
td{padding:10px 6px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
td.n{text-align:right}a{color:var(--gold-text)}`;

export function standingsHtml(s: Standings): string {
  const rows = s.rows.map((r) =>
    `<tr><td>${escapeHtml(NAMES[r.member] ?? r.member)}</td><td class="n">${r.calls}</td><td class="n">${r.brier === null ? "—" : r.brier.toFixed(3)}</td><td class="n">${r.house_delta > 0 ? "+" : ""}${r.house_delta}</td></tr>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Standings · Outsee</title><style>${STYLE}</style></head><body><div class="wrap"><a class="brand" href="/">Outsee</a><h1>Standings</h1><p>Each member of the Council commits a line on every question before it opens. Brier is the mean squared error of the line, lower is better; house delta is what the purse would have done with that member alone, at the stakes players actually placed.</p><table><thead><tr><th>Member</th><th>Calls</th><th>Brier</th><th>House delta</th></tr></thead><tbody>${rows}</tbody></table><p>${s.questions} questions over ${s.rounds} rounds, as of ${escapeHtml(s.as_of.slice(0, 10))}. <a href="/v1/standings?format=csv">Download the record as CSV</a> · <a href="/v1/standings">JSON</a></p></div></body></html>`;
}
```

```ts
// apps/api/src/routes/standings.ts
// Public and unauthenticated (design 2026-09-11 §13, C3): the proof that the
// man-versus-machine claim is true, and the dataset. No device token, no
// CORS — nothing fetches this from a browser on another origin.
import { Hono } from "hono";
import type { AppContext } from "../app";
import { loadSettledCalls, standings, standingsCsv, standingsHtml } from "../standings";

const CACHE = "public, max-age=300";

export const standingsRoutes = new Hono<AppContext>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const calls = await loadSettledCalls(db);
    if (c.req.query("format") === "csv") {
      return c.body(standingsCsv(calls), 200, {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="outsee-standings.csv"',
        "cache-control": CACHE,
      });
    }
    return c.json(standings(calls, new Date()), 200, { "cache-control": CACHE });
  });

export const standingsPage = new Hono<AppContext>()
  .get("/", async (c) => {
    const { db } = c.get("deps");
    const calls = await loadSettledCalls(db);
    return c.html(standingsHtml(standings(calls, new Date())), 200, { "cache-control": CACHE });
  });
```

In `apps/api/src/app.ts`, add `import { standingsRoutes, standingsPage } from "./routes/standings";` and, after `app.route("/v1/me", meRoutes);`:

```ts
  app.route("/v1/standings", standingsRoutes);
  app.route("/standings", standingsPage);
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && npx vitest run test/standings.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/standings.ts apps/api/src/routes/standings.ts apps/api/src/app.ts apps/api/test/standings.test.ts
git commit -m "feat(api): the standings route, the CSV record and the public page

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: Evidence packs from Exa

**Files:**
- Create: `apps/api/src/pipeline/council/evidence.ts`
- Create: `apps/api/test/fixtures/exa/search.json`
- Modify: `apps/api/src/pipeline/index.ts` (`PipelineDeps`)
- Modify: `apps/api/src/worker.ts` (`WorkerEnv`, `buildPipelineDeps`), `apps/api/wrangler.jsonc` (secrets comment)
- Test: `apps/api/test/council-evidence.test.ts`

**Interfaces:**
- Consumes: `allowedDomainsFor` from `../resolver` is not used; a local `resolutionDomains(rules)` extracts hosts from URLs in the rules text.
- Produces:
  - `PipelineDeps.exaApiKey?: string`, `PipelineDeps.exaFetch?: typeof fetch`.
  - `export const EVIDENCE = { RESULTS: 8, WINDOW_DAYS: 14, QUERY_CHARS: 500, HIGHLIGHT_SENTENCES: 3 } as const`.
  - `export interface PackSummary { questionId: string; slot: number; count: number; skipped: boolean; error?: string }`
  - `export interface EvidenceSummary { packs: PackSummary[]; cost: number }`
  - `export async function retrieveEvidence(deps: PipelineDeps, date: string): Promise<EvidenceSummary>` — idempotent per question; never throws for a search failure.
  - `export function resolutionDomains(rules: string, exchangeUrl: string | null): string[] | undefined`.

- [ ] **Step 1: Write the fixture and the failing test**

`apps/api/test/fixtures/exa/search.json` — the documented shape of `POST https://api.exa.ai/search` with `contents.highlights`:

```json
{
  "requestId": "fixture",
  "results": [
    { "id": "https://www.weather.gov/okx/", "url": "https://www.weather.gov/okx/", "title": "NWS New York forecast", "publishedDate": "2026-09-09T18:00:00.000Z", "author": null, "highlights": ["Highs near 84 on Thursday with a chance of afternoon storms."], "highlightScores": [0.91] },
    { "id": "https://example.com/a", "url": "https://example.com/a", "title": "Heat builds across the Northeast", "publishedDate": "2026-09-08T12:00:00.000Z", "author": "Staff", "highlights": ["A ridge brings mid-80s to the city by midweek."], "highlightScores": [0.80] },
    { "id": "https://example.com/b", "url": "https://example.com/b", "title": "No highlight here", "publishedDate": null, "author": null, "highlights": [], "highlightScores": [] }
  ],
  "costDollars": { "total": 0.0105, "search": { "neural": 0.005 }, "contents": { "highlights": 0.0055 } }
}
```

```ts
// apps/api/test/council-evidence.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";
import { retrieveEvidence, resolutionDomains, EVIDENCE } from "../src/pipeline/council/evidence";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "fixtures/exa/search.json"), "utf8");
const DATE = "2026-09-10";
const NOW = new Date("2026-09-10T14:00:00Z");

type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];
function makeDeps(db: TestDb, exaFetch: typeof fetch, exaApiKey: string | undefined = "test-key"): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude: null,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
    exaApiKey, exaFetch,
  };
}

async function scheduledV3(db: TestDb) {
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", resolutionCriteria: "NYC high temp on Sep 11\n\nResolves per https://www.weather.gov/okx/ climate data.", sourceUrl: "https://kalshi.com/markets/kxhighny" }).where(eq(schema.questions.roundDate, DATE));
  return rows;
}

describe("retrieveEvidence (spec §5)", () => {
  it("asks Exa once per question with the window, the highlights and the resolution domain, and stores the pack in rank order", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const bodies: Array<Record<string, unknown>> = [];
    const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.exa.ai/search");
      expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
      bodies.push(JSON.parse(String(init!.body)));
      return new Response(FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(bodies.length).toBe(5);
    expect(bodies[0]).toMatchObject({ numResults: EVIDENCE.RESULTS, endPublishedDate: NOW.toISOString(), startPublishedDate: new Date(NOW.getTime() - EVIDENCE.WINDOW_DAYS * 86_400_000).toISOString(), includeDomains: ["weather.gov"], contents: { highlights: { numSentences: EVIDENCE.HIGHLIGHT_SENTENCES, highlightsPerUrl: 1 } } });
    expect(String(bodies[0]!.query)).toContain("NYC high temp");
    expect(r.packs.every((p) => p.count === 3 && !p.skipped)).toBe(true);
    expect(r.cost).toBeCloseTo(5 * 0.0105, 6);
    const items = await db.query.evidence.findMany({ where: eq(schema.evidence.questionId, r.packs[0]!.questionId), orderBy: (e, { asc }) => [asc(e.rank)] });
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3]);
    expect(items[0]!.source).toBe("weather.gov");
    expect(items[0]!.publishedAt!.toISOString()).toBe("2026-09-09T18:00:00.000Z");
    expect(items[2]!.highlight).toBe("No highlight here");
    expect(items[2]!.publishedAt).toBeNull();
    expect(items[0]!.retrievedAt.toISOString()).toBe(NOW.toISOString());
  });

  it("skips a question that already has a pack", async () => {
    const { db } = await makeTestDb();
    const rows = await scheduledV3(db);
    await db.insert(schema.evidence).values({ questionId: rows[0]!.id, rank: 1, url: "https://x", title: "X", source: "x", highlight: "h", retrievedAt: NOW });
    let calls = 0;
    const stub = (async () => { calls++; return new Response(FIXTURE, { status: 200 }); }) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(calls).toBe(4);
    expect(r.packs.find((p) => p.questionId === rows[0]!.id)).toMatchObject({ skipped: true, count: 1 });
  });

  it("a failed search leaves an empty pack and never throws", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const stub = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub), DATE);
    expect(r.packs.every((p) => p.count === 0 && p.error)).toBe(true);
    expect((await db.query.evidence.findMany()).length).toBe(0);
  });

  it("without an API key it retrieves nothing and says so", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    const stub = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    const r = await retrieveEvidence(makeDeps(db, stub, undefined), DATE);
    expect(r.packs.every((p) => p.error === "no EXA_API_KEY")).toBe(true);
  });

  it("does nothing on a version 2 round", async () => {
    const { db } = await makeTestDb();
    await scheduledV3(db);
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, DATE));
    const stub = (async () => { throw new Error("must not be called"); }) as typeof fetch;
    expect((await retrieveEvidence(makeDeps(db, stub), DATE)).packs).toEqual([]);
  });
});

describe("resolutionDomains", () => {
  it("takes hosts named in the rules and drops the exchange's own", () => {
    expect(resolutionDomains("Resolves per https://www.weather.gov/okx/ and https://kalshi.com/x", "https://kalshi.com/markets/kxhighny")).toEqual(["weather.gov"]);
  });
  it("is undefined when the rules name no source", () => {
    expect(resolutionDomains("Resolves YES if the Yankees win.", "https://polymarket.com/event/x")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/council-evidence.test.ts`
Expected: FAIL, module not found; `exaFetch` not on `PipelineDeps`.

- [ ] **Step 3: The deps and the env**

In `apps/api/src/pipeline/index.ts`, after `exchangeFeeds?: ExchangeFeed[];` in `PipelineDeps`:

```ts
  // Exa search for the Council's evidence packs (design 2026-09-11 §5).
  // Absent key → every pack is empty and the members are told so; the round
  // still commits. Fetch injectable so tests never touch the network.
  exaApiKey?: string;
  exaFetch?: typeof fetch;
  // The Council's members and the lesson writer (design 2026-09-11 §3, §8).
  // Optional with defaults in council/members.ts, so every existing test's
  // models literal stays valid.
  councilModels?: { sonnet?: string; opus?: string; haiku?: string; lesson?: string };
```

In `apps/api/src/worker.ts` `WorkerEnv`, after `PIPELINE_VOICE_MODEL?: string;`:

```ts
  PIPELINE_COUNCIL_SONNET_MODEL?: string;
  PIPELINE_COUNCIL_OPUS_MODEL?: string;
  PIPELINE_COUNCIL_HAIKU_MODEL?: string;
  PIPELINE_LESSON_MODEL?: string;
  EXA_API_KEY?: string;
```

In `buildPipelineDeps`'s returned object, after `push: { ... },`:

```ts
    exaApiKey: env.EXA_API_KEY,
    councilModels: {
      sonnet: env.PIPELINE_COUNCIL_SONNET_MODEL,
      opus: env.PIPELINE_COUNCIL_OPUS_MODEL,
      haiku: env.PIPELINE_COUNCIL_HAIKU_MODEL,
      lesson: env.PIPELINE_LESSON_MODEL,
    },
```

In `apps/api/wrangler.jsonc`, the `vars` block gains, after `PIPELINE_VOICE_MODEL`:

```jsonc
    // The Council (design 2026-09-11 §3): three independent members over one
    // shared evidence pack, no search tool; and the lesson writer at settlement.
    "PIPELINE_COUNCIL_SONNET_MODEL": "claude-sonnet-5",
    "PIPELINE_COUNCIL_OPUS_MODEL": "claude-opus-5",
    "PIPELINE_COUNCIL_HAIKU_MODEL": "claude-haiku-4-5-20251001",
    "PIPELINE_LESSON_MODEL": "claude-haiku-4-5-20251001"
```

and the secrets comment gains, under PIPELINE:

```
  //     EXA_API_KEY             the Council's evidence packs (design 2026-09-11 §5); absent → empty packs
```

- [ ] **Step 4: Implement retrieval**

```ts
// apps/api/src/pipeline/council/evidence.ts
// The shared evidence pack (design 2026-09-11 §5). Retrieval is owned by the
// pipeline, not by the members: one Exa search per question, a published-date
// ceiling at the retrieval instant, and the same numbered pack for every
// member. That ceiling is what makes the September 9 failure structurally
// impossible — no member can be shown a recap of last week's meeting as if
// it were this one.
import { and, eq, inArray } from "drizzle-orm";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";

export const EVIDENCE = { RESULTS: 8, WINDOW_DAYS: 14, QUERY_CHARS: 500, HIGHLIGHT_SENTENCES: 3 } as const;
const EXA_URL = "https://api.exa.ai/search";

export interface PackSummary { questionId: string; slot: number; count: number; skipped: boolean; error?: string }
export interface EvidenceSummary { packs: PackSummary[]; cost: number }

interface ExaResult { url: string; title?: string | null; publishedDate?: string | null; highlights?: string[] }
interface ExaResponse { results?: ExaResult[]; costDollars?: { total?: number } }

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

/** Hosts named by URL in the rules, minus the exchange's own; undefined when none. */
export function resolutionDomains(rules: string, exchangeUrl: string | null): string[] | undefined {
  const own = exchangeUrl ? hostOf(exchangeUrl) : null;
  const hosts = new Set<string>();
  for (const m of rules.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
    const h = hostOf(m[0]);
    if (h && h !== own) hosts.add(h);
  }
  return hosts.size > 0 ? [...hosts] : undefined;
}

async function search(deps: PipelineDeps, key: string, q: { resolutionCriteria: string; sourceUrl: string | null }, now: Date): Promise<{ results: ExaResult[]; cost: number }> {
  const body = {
    query: q.resolutionCriteria.slice(0, EVIDENCE.QUERY_CHARS),
    type: "auto",
    numResults: EVIDENCE.RESULTS,
    startPublishedDate: new Date(now.getTime() - EVIDENCE.WINDOW_DAYS * 86_400_000).toISOString(),
    endPublishedDate: now.toISOString(),
    ...(resolutionDomains(q.resolutionCriteria, q.sourceUrl) ? { includeDomains: resolutionDomains(q.resolutionCriteria, q.sourceUrl) } : {}),
    contents: { highlights: { numSentences: EVIDENCE.HIGHLIGHT_SENTENCES, highlightsPerUrl: 1 } },
  };
  const res = await (deps.exaFetch ?? fetch)(EXA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`exa: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as ExaResponse;
  return { results: json.results ?? [], cost: json.costDollars?.total ?? 0 };
}

export async function retrieveEvidence(deps: PipelineDeps, date: string): Promise<EvidenceSummary> {
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round || round.rulesVersion < 3) return { packs: [], cost: 0 };
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, resolutionCriteria: true, sourceUrl: true },
  });
  const existing = qs.length
    ? await deps.db.select({ questionId: schema.evidence.questionId }).from(schema.evidence).where(inArray(schema.evidence.questionId, qs.map((q) => q.id)))
    : [];
  const have = new Map<string, number>();
  for (const e of existing) have.set(e.questionId, (have.get(e.questionId) ?? 0) + 1);

  const packs: PackSummary[] = [];
  let cost = 0;
  for (const q of qs) {
    const had = have.get(q.id);
    if (had) { packs.push({ questionId: q.id, slot: q.slot, count: had, skipped: true }); continue; }
    if (!deps.exaApiKey) { packs.push({ questionId: q.id, slot: q.slot, count: 0, skipped: false, error: "no EXA_API_KEY" }); continue; }
    const now = deps.now();
    try {
      const { results, cost: c } = await search(deps, deps.exaApiKey, q, now);
      cost += c;
      const rows = results.slice(0, EVIDENCE.RESULTS).map((r, i) => ({
        questionId: q.id,
        rank: i + 1,
        url: r.url,
        title: (r.title ?? "").trim() || r.url,
        source: hostOf(r.url) ?? r.url,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
        highlight: (r.highlights?.[0] ?? "").trim() || ((r.title ?? "").trim() || r.url),
        retrievedAt: now,
      }));
      if (rows.length > 0) await deps.db.insert(schema.evidence).values(rows).onConflictDoNothing();
      packs.push({ questionId: q.id, slot: q.slot, count: rows.length, skipped: false });
    } catch (err) {
      packs.push({ questionId: q.id, slot: q.slot, count: 0, skipped: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { packs, cost };
}
```

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && npx vitest run test/council-evidence.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/council/evidence.ts apps/api/test/fixtures/exa/search.json apps/api/test/council-evidence.test.ts apps/api/src/pipeline/index.ts apps/api/src/worker.ts apps/api/wrangler.jsonc
git commit -m "feat(pipeline): the shared evidence pack from Exa, one per question

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 5: The members, the as-of rule and one member's commit

**Files:**
- Create: `apps/api/src/pipeline/council/members.ts`
- Create: `apps/api/src/pipeline/council/lessonsFor.ts`
- Create: `apps/api/src/pipeline/council/member.ts`
- Test: `apps/api/test/council-member.test.ts`

**Interfaces:**
- Consumes: `ModelMemberId`, `MODEL_MEMBER_IDS` from `@oracle/core`; `deps.claude.structured`; tables `evidence`, `lessons`.
- Produces:
  - `export const COUNCIL_PROMPT_VERSION = "council-v1"`; `export const LESSON_PROMPT_VERSION = "lesson-v1"`.
  - `export function memberModel(deps: PipelineDeps, member: ModelMemberId): string`; `export function lessonModel(deps: PipelineDeps): string`.
  - `export const LESSON_CAPS = { SAME_SERIES: 5, OTHER: 3 } as const`.
  - `export interface LessonReceived { id: string; seriesKey: string; resolvedAt: Date; text: string }`
  - `export async function lessonsFor(db: Db, member: ModelMemberId, seriesKey: string, asOf: Date): Promise<LessonReceived[]>`
  - `export function seriesKeyOf(q: { marketSeriesKey: string | null; category: string }): string`.
  - `export interface MemberLine { slot: number; questionId: string; pYes: number; reasoning: string; cited: number[]; lessonsReceived: string[] }`
  - `export interface MemberResult { member: ModelMemberId; lines: MemberLine[]; abstained: number[]; error?: string }`
  - `export async function commitMember(deps: PipelineDeps, date: string, member: ModelMemberId): Promise<MemberResult>` — never throws except `BudgetExhausted`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/council-member.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { BudgetExhausted } from "../src/pipeline/spend";
import { commitMember } from "../src/pipeline/council/member";
import { lessonsFor, seriesKeyOf, LESSON_CAPS } from "../src/pipeline/council/lessonsFor";
import { memberModel, COUNCIL_PROMPT_VERSION } from "../src/pipeline/council/members";

const DATE = "2026-09-10";
const NOW = new Date("2026-09-10T14:00:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { sonnet: "m-sonnet", opus: "m-opus", haiku: "m-haiku" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function world() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "scheduled", marketProb: "0.40", marketSeriesKey: "KXHIGHNY" }).where(eq(schema.questions.roundDate, DATE));
  for (const r of rows.slice(0, 4)) {
    await db.insert(schema.evidence).values([1, 2, 3].map((rank) => ({ questionId: r.id, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", publishedAt: new Date("2026-09-09T00:00:00Z"), highlight: `Highlight ${rank}.`, retrievedAt: NOW })));
  }
  return { db, rows };
}

const fiveLines = (p = 0.4) => ({ lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p, reasoning: `Because ${slot}.`, cited: slot === 1 ? [1, 3, 9] : [] })) });

describe("commitMember (spec §6)", () => {
  it("asks the member's model once, with no web search, the pack per question and the tool schema", async () => {
    const { db } = await world();
    const calls: StructuredCall[] = [];
    const r = await commitMember(makeDeps(db, { structured: async (c) => { calls.push(c); return fiveLines(); } }), DATE, "sonnet");
    expect(calls.length).toBe(1);
    const c = calls[0]!;
    expect(c.model).toBe("m-sonnet");
    expect(c.webSearch).toBeUndefined();
    expect(c.schemaName).toBe("council_lines");
    expect(c.system).toContain(DATE);
    expect(c.system).toContain(NOW.toISOString());
    expect(c.user).toContain("[1] Item 1 — e, 2026-09-09: Highlight 1.");
    expect(c.user).toContain("THE MARKET'S PRICE: 40% YES");
    expect(c.user).toContain("No evidence was retrieved for this question.");
    expect(r.member).toBe("sonnet");
    expect(r.lines.length).toBe(5);
    expect(r.abstained).toEqual([]);
    // Out-of-pack rank 9 is dropped, not fatal (C8).
    expect(r.lines[0]!.cited).toEqual([1, 3]);
    expect(r.lines[4]!.cited).toEqual([]);
  });

  it("abstains on every slot when the call throws, and returns the error as a value", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => { throw new Error("timeout"); } }), DATE, "opus");
    expect(r.lines).toEqual([]);
    expect(r.abstained).toEqual([1, 2, 3, 4, 5]);
    expect(r.error).toBe("timeout");
  });

  it("abstains on a slot whose probability is out of range and on a missing slot", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => ({ lines: [{ slot: 1, p_yes: 0.99, reasoning: "x", cited: [] }, { slot: 2, p_yes: 0.5, reasoning: "y", cited: [] }] }) }), DATE, "haiku");
    expect(r.lines.map((l) => l.slot)).toEqual([2]);
    expect(r.abstained).toEqual([1, 3, 4, 5]);
  });

  it("abstains entirely on output that is not the schema", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, { structured: async () => ({ nonsense: true }) }), DATE, "haiku");
    expect(r.abstained).toEqual([1, 2, 3, 4, 5]);
    expect(r.error).toMatch(/schema/);
  });

  it("lets BudgetExhausted through", async () => {
    const { db } = await world();
    await expect(commitMember(makeDeps(db, { structured: async () => { throw new BudgetExhausted(DATE, true); } }), DATE, "sonnet")).rejects.toBeInstanceOf(BudgetExhausted);
  });

  it("without a client, abstains", async () => {
    const { db } = await world();
    const r = await commitMember(makeDeps(db, null), DATE, "sonnet");
    expect(r.abstained.length).toBe(5);
  });

  it("feeds back only the member's own lessons known before the commit instant, and records their ids", async () => {
    const { db, rows } = await world();
    const settled = (d: string) => new Date(d);
    await db.insert(schema.lessons).values([
      { member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[0]!.id, text: "Same series, known.", resolvedAt: settled("2026-09-09T20:00:00Z") },
      { member: "sonnet", seriesKey: "KXHIGHNY", questionId: rows[1]!.id, text: "Same series, from the future.", resolvedAt: settled("2026-09-10T15:00:00Z") },
      { member: "sonnet", seriesKey: "sports", questionId: rows[2]!.id, text: "Other series, known.", resolvedAt: settled("2026-09-08T20:00:00Z") },
      { member: "opus", seriesKey: "KXHIGHNY", questionId: rows[3]!.id, text: "Opus's lesson.", resolvedAt: settled("2026-09-09T20:00:00Z") },
    ]);
    const calls: StructuredCall[] = [];
    const r = await commitMember(makeDeps(db, { structured: async (c) => { calls.push(c); return fiveLines(); } }), DATE, "sonnet");
    const user = calls[0]!.user;
    expect(user).toContain("Same series, known.");
    expect(user).toContain("Other series, known.");
    expect(user).not.toContain("from the future");
    expect(user).not.toContain("Opus's lesson");
    expect(r.lines[0]!.lessonsReceived.length).toBe(2);
  });
});

describe("lessonsFor caps", () => {
  it("takes at most five from the series and three from elsewhere, newest first", async () => {
    // The unique (member, question) index means one lesson per question per
    // member, so the pool of questions has to be as wide as the lessons.
    const { db, rows } = await world();
    const more = await seedRound(db, { date: "2026-08-01", opensAt: new Date("2026-08-01T16:00:00Z"), locksAt: new Date("2026-08-02T16:00:00Z") });
    const others = await seedRound(db, { date: "2026-07-01", opensAt: new Date("2026-07-01T16:00:00Z"), locksAt: new Date("2026-07-02T16:00:00Z") });
    const sameSeries = [...rows, ...more].slice(0, 8).map((q, i) => ({ member: "haiku", seriesKey: "KXHIGHNY", questionId: q.id, text: `S${i}`, resolvedAt: new Date(Date.UTC(2026, 8, 1 + i)) }));
    const otherSeries = others.map((q, i) => ({ member: "haiku", seriesKey: "other", questionId: q.id, text: `O${i}`, resolvedAt: new Date(Date.UTC(2026, 7, 1 + i)) }));
    await db.insert(schema.lessons).values([...sameSeries, ...otherSeries]);
    const got = await lessonsFor(db, "haiku", "KXHIGHNY", NOW);
    expect(got.length).toBe(LESSON_CAPS.SAME_SERIES + LESSON_CAPS.OTHER);
    expect(got.slice(0, 5).map((l) => l.text)).toEqual(["S7", "S6", "S5", "S4", "S3"]);
    expect(got.slice(5).map((l) => l.text)).toEqual(["O4", "O3", "O2"]);
  });
  it("falls back to the category as the series key", () => {
    expect(seriesKeyOf({ marketSeriesKey: null, category: "weather" })).toBe("weather");
    expect(seriesKeyOf({ marketSeriesKey: "KXHIGHNY", category: "weather" })).toBe("KXHIGHNY");
  });
});

describe("members", () => {
  it("resolve their model from deps with defaults", () => {
    // No database is touched here; the deps only carry the model table.
    const deps = makeDeps(null as unknown as TestDb, null);
    expect(memberModel(deps, "opus")).toBe("m-opus");
    expect(memberModel({ ...deps, councilModels: undefined }, "haiku")).toBe("claude-haiku-4-5-20251001");
    expect(COUNCIL_PROMPT_VERSION).toBe("council-v1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/council-member.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the member table**

```ts
// apps/api/src/pipeline/council/members.ts
// The Council's members (design 2026-09-11 §3). A static table; adding a
// member is one row. The market member is a baseline, never sent to a model,
// and is not listed here — commit.ts writes its row from questions.market_prob.
import type { ModelMemberId } from "@oracle/core";
import type { PipelineDeps } from "../index";

export const COUNCIL_PROMPT_VERSION = "council-v1";
export const LESSON_PROMPT_VERSION = "lesson-v1";

const DEFAULT_MODELS: Record<ModelMemberId, string> = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5-20251001",
};
const DEFAULT_LESSON_MODEL = "claude-haiku-4-5-20251001";

export function memberModel(deps: PipelineDeps, member: ModelMemberId): string {
  return deps.councilModels?.[member] ?? DEFAULT_MODELS[member];
}

export function lessonModel(deps: PipelineDeps): string {
  return deps.councilModels?.lesson ?? DEFAULT_LESSON_MODEL;
}
```

- [ ] **Step 4: Implement the as-of selection**

```ts
// apps/api/src/pipeline/council/lessonsFor.ts
// The as-of rule (design 2026-09-11 §6.1). A member receives its own lessons
// only, and only those whose outcome was known strictly before the commit
// instant. This is what keeps the standings honest and any later replay free
// of look-ahead.
import { and, desc, eq, lt, ne } from "drizzle-orm";
import type { ModelMemberId } from "@oracle/core";
import { schema, type Db } from "../../db/client";

export const LESSON_CAPS = { SAME_SERIES: 5, OTHER: 3 } as const;

export interface LessonReceived { id: string; seriesKey: string; resolvedAt: Date; text: string }

export function seriesKeyOf(q: { marketSeriesKey: string | null; category: string }): string {
  return q.marketSeriesKey ?? q.category;
}

export async function lessonsFor(db: Db, member: ModelMemberId, seriesKey: string, asOf: Date): Promise<LessonReceived[]> {
  const [same, other] = await Promise.all([
    db.query.lessons.findMany({
      where: and(eq(schema.lessons.member, member), eq(schema.lessons.seriesKey, seriesKey), lt(schema.lessons.resolvedAt, asOf)),
      orderBy: [desc(schema.lessons.resolvedAt)],
      limit: LESSON_CAPS.SAME_SERIES,
    }),
    db.query.lessons.findMany({
      where: and(eq(schema.lessons.member, member), ne(schema.lessons.seriesKey, seriesKey), lt(schema.lessons.resolvedAt, asOf)),
      orderBy: [desc(schema.lessons.resolvedAt)],
      limit: LESSON_CAPS.OTHER,
    }),
  ]);
  return [...same, ...other].map((l) => ({ id: l.id, seriesKey: l.seriesKey, resolvedAt: l.resolvedAt, text: l.text }));
}
```

- [ ] **Step 5: Implement the member's commit**

```ts
// apps/api/src/pipeline/council/member.ts
// One member's lines on the five questions (design 2026-09-11 §6): one
// structured call over the shared pack, no search tool, an abstention as a
// VALUE rather than an error so a Workflow step can return it and the commit
// step can take the median of whoever is present. Only BudgetExhausted
// escapes, as it does from resolveOne.
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { ModelMemberId } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { BudgetExhausted } from "../spend";
import { memberModel } from "./members";
import { lessonsFor, seriesKeyOf, type LessonReceived } from "./lessonsFor";

export interface MemberLine { slot: number; questionId: string; pYes: number; reasoning: string; cited: number[]; lessonsReceived: string[] }
export interface MemberResult { member: ModelMemberId; lines: MemberLine[]; abstained: number[]; error?: string }

const P_MIN = 0.05;
const P_MAX = 0.95;

// Lenient on purpose: one bad entry abstains that slot, not the member.
const EntrySchema = z.object({ slot: z.number().int(), p_yes: z.number(), reasoning: z.string(), cited: z.array(z.number().int()).default([]) });
const OutputSchema = z.object({ lines: z.array(z.unknown()) });

export const councilJsonSchema = {
  type: "object",
  properties: {
    lines: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object",
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 5 },
          p_yes: { type: "number", minimum: P_MIN, maximum: P_MAX, description: "Your probability that the answer is YES." },
          reasoning: { type: "string", description: "Two to five plain sentences: the route from the evidence to your number. Cite evidence by its number in square brackets." },
          cited: { type: "array", items: { type: "integer", minimum: 1 }, description: "The evidence numbers you relied on, from this question's list only." },
        },
        required: ["slot", "p_yes", "reasoning", "cited"], additionalProperties: false,
      },
    },
  },
  required: ["lines"], additionalProperties: false,
};

function systemPrompt(date: string, now: Date): string {
  return `You are one voice of THE ORACLE's Council. You are preparing the round dated ${date}, before it opens at noon ET; it locks at noon ET the following day. It is now ${now.toISOString()}.

- Forecast; do not resolve. Use only the evidence listed under each question, and cite it by number. You have no other tools.
- Report your best-supported probability of YES between ${P_MIN} and ${P_MAX}. Exactly 0.5 is valid when the evidence supports equal chances. A proper scoring rule rewards an honest expression of your uncertainty; do not exaggerate confidence or hedge for appearances.
- The market's price is context, not an answer. Disagree with it when the evidence warrants.
- Your reasoning is the route from the evidence to your number, in two to five plain sentences. It is not a transcript of your thinking and will be shown to players as written.
- Where lessons from your own earlier calls are given, weigh them; they are yours.

Call the council_lines tool exactly once with exactly one entry for each slot 1 through 5.`;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "undated";
}

function questionBlock(q: { slot: number; isBigOne: boolean; text: string; resolutionCriteria: string; marketProb: string | null }, pack: { rank: number; title: string; source: string; publishedAt: Date | null; highlight: string }[], lessons: LessonReceived[]): string {
  const head = `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}\nRESOLVES BY: ${q.resolutionCriteria}\nTHE MARKET'S PRICE: ${q.marketProb === null ? "unknown" : `${Math.round(Number(q.marketProb) * 100)}% YES`}`;
  const ev = pack.length === 0
    ? "EVIDENCE: No evidence was retrieved for this question."
    : `EVIDENCE:\n${pack.map((e) => `[${e.rank}] ${e.title} — ${e.source}, ${fmtDate(e.publishedAt)}: ${e.highlight}`).join("\n")}`;
  const mem = lessons.length === 0 ? "" : `\nWHAT YOU LEARNED BEFORE:\n${lessons.map((l) => `(${l.seriesKey}, settled ${fmtDate(l.resolvedAt)}) ${l.text}`).join("\n")}`;
  return `${head}\n${ev}${mem}`;
}

export async function commitMember(deps: PipelineDeps, date: string, member: ModelMemberId): Promise<MemberResult> {
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, resolutionCriteria: true, marketProb: true, marketSeriesKey: true, category: true },
  });
  const allSlots = qs.map((q) => q.slot);
  const abstainAll = (error: string): MemberResult => ({ member, lines: [], abstained: allSlots, error });
  if (qs.length !== 5) return abstainAll("five questions required");
  if (!deps.claude) return abstainAll("no claude client");

  const now = deps.now();
  const packRows = await deps.db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, qs.map((q) => q.id)), orderBy: (e, { asc }) => [asc(e.rank)] });
  const packs = new Map(qs.map((q) => [q.id, packRows.filter((e) => e.questionId === q.id)]));
  const received = new Map<string, LessonReceived[]>();
  for (const q of qs) received.set(q.id, await lessonsFor(deps.db, member, seriesKeyOf(q), now));

  const user = qs.map((q) => questionBlock(q, packs.get(q.id)!, received.get(q.id)!)).join("\n\n");
  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: memberModel(deps, member),
      system: systemPrompt(date, now),
      user,
      schemaName: "council_lines",
      schema: councilJsonSchema,
    });
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return abstainAll(err instanceof Error ? err.message : String(err));
  }
  const parsed = OutputSchema.safeParse(response);
  if (!parsed.success) return abstainAll("response failed the council_lines schema");

  const lines: MemberLine[] = [];
  for (const raw of parsed.data.lines) {
    const e = EntrySchema.safeParse(raw);
    if (!e.success) continue;
    const q = qs.find((x) => x.slot === e.data.slot);
    if (!q || e.data.p_yes < P_MIN || e.data.p_yes > P_MAX) continue;
    if (lines.some((l) => l.slot === q.slot)) continue;
    const ranks = new Set(packs.get(q.id)!.map((x) => x.rank));
    lines.push({
      slot: q.slot,
      questionId: q.id,
      pYes: e.data.p_yes,
      reasoning: e.data.reasoning.trim(),
      cited: [...new Set(e.data.cited.filter((r) => ranks.has(r)))].sort((a, b) => a - b),
      lessonsReceived: received.get(q.id)!.map((l) => l.id),
    });
  }
  lines.sort((a, b) => a.slot - b.slot);
  const abstained = allSlots.filter((s) => !lines.some((l) => l.slot === s));
  return { member, lines, abstained };
}
```

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && npx vitest run test/council-member.test.ts && pnpm typecheck`
Expected: PASS. `BudgetExhausted`'s constructor signature is in `spend.ts`; if it differs from `(date, first)`, construct it as that file does.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pipeline/council/members.ts apps/api/src/pipeline/council/lessonsFor.ts apps/api/src/pipeline/council/member.ts apps/api/test/council-member.test.ts
git commit -m "feat(pipeline): a Council member commits over the shared pack, with its own lessons as of the instant

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 6: The Council commit, the workflow, the tick and the admin route

**Files:**
- Create: `apps/api/src/pipeline/council/commit.ts`, `apps/api/src/pipeline/council/index.ts`
- Modify: `apps/api/src/pipeline/workflows.ts` (`WorkflowKind`, `WorkflowBindings`, `WorkflowInstanceBindings`, `bindingStarter`, `inlineStarter`)
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts` (add `CouncilWorkflow`)
- Modify: `apps/api/src/pipeline/index.ts` (`forecast` case)
- Modify: `apps/api/src/pipeline/spend.ts` (the budget comment near line 33)
- Modify: `apps/api/src/worker.ts` (export, `COUNCIL_WORKFLOW`, bindings), `apps/api/wrangler.jsonc` (workflows)
- Modify: `apps/api/src/routes/admin.ts` (`WORKFLOW_KINDS`, `POST /rounds/:date/council`)
- Modify: `apps/api/src/app.ts` (`workflows` typing follows `WorkflowInstanceBindings`; no code change if it uses the type)
- Test: `apps/api/test/council-commit.test.ts`, `apps/api/test/pipeline-tick.test.ts` (add one case)

**Interfaces:**
- Consumes: `retrieveEvidence` (Task 4), `commitMember`, `MemberResult` (Task 5), `commitLine` (`../line`), `medianLine`, `MODEL_MEMBER_IDS` from `@oracle/core`, the `commit_council` function (Task 2).
- Produces:
  - `export interface CouncilCommit { committed: boolean; reason: string | null; lines: number; slots: { slot: number; present: string[]; median: number | null }[] }`
  - `export async function commitCouncil(deps: PipelineDeps, date: string, results: MemberResult[]): Promise<CouncilCommit>`
  - `export interface CouncilRun { editable: boolean; evidence: EvidenceSummary | null; members: MemberResult[]; commit: CouncilCommit | null }`
  - `export async function runCouncil(deps: PipelineDeps, date: string): Promise<CouncilRun>` — the inline path.
  - `export async function narrateCouncil(deps: PipelineDeps, date: string, run: CouncilRun): Promise<void>`.
  - `WorkflowKind` gains `"council"`; `WorkflowBindings.COUNCIL_WORKFLOW`; `WorkerEnv.COUNCIL_WORKFLOW`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/council-commit.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { commitCouncil } from "../src/pipeline/council/commit";
import { runCouncil } from "../src/pipeline/council";
import type { MemberResult } from "../src/pipeline/council/member";

// 2099, not 2026: commit_oracle_forecast compares the opening deadline with the
// database clock, so a real date would fail with "opening deadline passed".
const DATE = "2099-09-10";
const NOW = new Date("2099-09-10T14:00:00Z");
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
  it("returns early on a version 2 round and on a committed round", async () => {
    const { db } = await world(2);
    const run = await runCouncil(makeDeps(db, null), DATE);
    expect(run.editable).toBe(false);
    expect(run.members).toEqual([]);
  });
});
```

Add to `apps/api/test/pipeline-tick.test.ts`, beside the existing forecast cases (reuse that file's `makeDeps`/seed helpers; the assertion is on the starter, so the Claude client can stay `null`):

```ts
  it("the forecast action dispatches the council for a version 3 round and stays inline for version 2", async () => {
    const { db } = await makeTestDb();
    const started: string[] = [];
    const starter = { start: async (_d: unknown, kind: string, id: string) => { started.push(`${kind}:${id}`); } };
    for (const [date, version] of [["2026-09-10", 3], ["2026-09-11", 2]] as const) {
      await seedRound(db, { date, opensAt: new Date(`${date}T16:00:00Z`), locksAt: new Date(`${date}T16:00:00Z`) });
      await db.update(schema.rounds).set({ status: "scheduled", rulesVersion: version }).where(eq(schema.rounds.date, date));
      await db.update(schema.questions).set({ status: "scheduled" }).where(eq(schema.questions.roundDate, date));
    }
    const deps = { ...makeDeps(db), workflows: starter, claude: { structured: async () => { throw new Error("no forecast in this test"); } }, now: () => new Date("2026-09-10T13:05:00Z") };
    const done = await runTick(deps as never);
    expect(done).toContain("forecast:2026-09-10");
    expect(started).toEqual(["council:council-2026-09-10-2026091009"]);
  });
```

(`2026-09-10T13:05:00Z` is 09:05 ET, inside the forecast window; the version 2 round dated the 11th is not "today" and is not forecast on this tick.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx vitest run test/council-commit.test.ts test/pipeline-tick.test.ts`
Expected: FAIL, modules not found; tick test finds `started` empty.

- [ ] **Step 3: Implement the commit**

```ts
// apps/api/src/pipeline/council/commit.ts
// The Council commit (design 2026-09-11 §7): the median of the model members
// present becomes oracle_p_yes through commit_council, which wraps the
// existing commit_oracle_forecast so the snapshot check, the deadline check
// and the members' rows land in one statement. Then the house line, by the
// same clamp the single forecast used.
import { eq, sql } from "drizzle-orm";
import { MODEL_MEMBER_IDS, medianLine } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { commitLine } from "../line";
import { COUNCIL_PROMPT_VERSION, memberModel } from "./members";
import type { MemberResult } from "./member";

export interface CouncilCommit {
  committed: boolean;
  reason: string | null;
  lines: number;
  slots: { slot: number; present: string[]; median: number | null }[];
}

export async function commitCouncil(deps: PipelineDeps, date: string, results: MemberResult[]): Promise<CouncilCommit> {
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) return { committed: false, reason: "round missing", lines: 0, slots: [] };
  if (round.oracleCommittedAt !== null) return { committed: false, reason: "already committed", lines: 0, slots: [] };
  if (round.rulesVersion < 3) return { committed: false, reason: "not a version 3 round", lines: 0, slots: [] };

  const rows = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, category: true, resolutionCriteria: true, sourceName: true, sourceUrl: true, context: true, opensAt: true, locksAt: true, marketProb: true },
  });
  if (rows.length !== 5) return { committed: false, reason: "five questions required", lines: 0, slots: [] };

  const slots = rows.map((q) => {
    const present = MODEL_MEMBER_IDS.filter((m) => results.find((r) => r.member === m)?.lines.some((l) => l.questionId === q.id));
    const values = present.map((m) => results.find((r) => r.member === m)!.lines.find((l) => l.questionId === q.id)!.pYes);
    return { slot: q.slot, present: [...present], median: medianLine(values) };
  });
  const thin = slots.find((s) => s.median === null);
  if (thin) return { committed: false, reason: `fewer than two members present on slot ${thin.slot}`, lines: 0, slots };

  const snapshot = rows.map(({ marketProb: _m, ...q }) => ({ ...q, pYes: Math.round(slots.find((s) => s.slot === q.slot)!.median! * 1e6) / 1e6 }));
  const lines = rows.flatMap((q) => {
    const members = results.flatMap((r) => {
      const l = r.lines.find((x) => x.questionId === q.id);
      return l ? [{ question_id: q.id, member: r.member, p_yes: l.pYes, model: memberModel(deps, r.member), prompt_version: COUNCIL_PROMPT_VERSION, reasoning: l.reasoning, cited: l.cited, lessons_received: l.lessonsReceived }] : [];
    });
    const market = q.marketProb === null ? [] : [{ question_id: q.id, member: "market", p_yes: Number(q.marketProb), model: null, prompt_version: null, reasoning: null, cited: [], lessons_received: [] }];
    return [...members, ...market];
  });

  const checkedAt = deps.now();
  const res = await deps.db.execute(sql`select commit_council(
    ${date}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb,
    ${COUNCIL_PROMPT_VERSION}, ${checkedAt.toISOString()}::timestamptz
  ) as ok`);
  const ok = Boolean((res.rows[0] as { ok?: boolean } | undefined)?.ok);
  if (!ok) return { committed: false, reason: "already committed", lines: 0, slots };
  await commitLine(deps.db, date);
  return { committed: true, reason: null, lines: lines.length, slots };
}
```

- [ ] **Step 4: Implement the runner and the narration**

```ts
// apps/api/src/pipeline/council/index.ts
// The inline path — `wrangler dev`, tests, and any deployment without the
// COUNCIL_WORKFLOW binding. Identical work, same order, in-process. The
// Workflow drives the same units per step; both share them, which is why the
// two paths cannot drift.
import { eq } from "drizzle-orm";
import { MODEL_MEMBER_IDS } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { retrieveEvidence, type EvidenceSummary } from "./evidence";
import { commitMember, type MemberResult } from "./member";
import { commitCouncil, type CouncilCommit } from "./commit";

export interface CouncilRun {
  editable: boolean;
  evidence: EvidenceSummary | null;
  members: MemberResult[];
  commit: CouncilCommit | null;
}

/** True when the round is a scheduled, uncommitted version 3 round. */
export async function councilEditable(deps: PipelineDeps, date: string): Promise<boolean> {
  const r = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  return !!r && r.status === "scheduled" && r.oracleCommittedAt === null && r.rulesVersion >= 3;
}

export async function runCouncil(deps: PipelineDeps, date: string): Promise<CouncilRun> {
  if (!(await councilEditable(deps, date))) return { editable: false, evidence: null, members: [], commit: null };
  const evidence = await retrieveEvidence(deps, date);
  const members: MemberResult[] = [];
  for (const m of MODEL_MEMBER_IDS) members.push(await commitMember(deps, date, m));
  const commit = await commitCouncil(deps, date, members);
  const run = { editable: true, evidence, members, commit };
  await narrateCouncil(deps, date, run);
  return run;
}

const pct = (p: number) => String(Math.round(p * 100));

export async function narrateCouncil(deps: PipelineDeps, date: string, run: CouncilRun): Promise<void> {
  if (!run.editable || !run.commit) return;
  const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date), orderBy: (q, { asc }) => [asc(q.slot)], columns: { id: true, slot: true, marketProb: true, linePYes: true } });
  const slotLines = qs.map((q) => {
    const s = run.commit!.slots.find((x) => x.slot === q.slot);
    const parts = MODEL_MEMBER_IDS.map((m) => {
      const l = run.members.find((r) => r.member === m)?.lines.find((x) => x.questionId === q.id);
      return `${m} ${l ? pct(l.pYes) : "—"}`;
    });
    parts.push(`market ${q.marketProb === null ? "—" : pct(Number(q.marketProb))}`);
    const items = run.evidence?.packs.find((p) => p.questionId === q.id)?.count ?? 0;
    const tail = s?.median === null || s === undefined ? "no median" : `median ${pct(s.median)}, line ${q.linePYes === null ? "—" : pct(Number(q.linePYes))}`;
    return `slot ${q.slot}: ${parts.join(" · ")} → ${tail} (${items} item${items === 1 ? "" : "s"})`;
  });
  const abstentions = run.members.filter((m) => m.abstained.length > 0).map((m) => `${m.member} abstained${m.error ? ` (${m.error})` : ""} on ${m.abstained.length === 5 ? "every slot" : `slot${m.abstained.length === 1 ? "" : "s"} ${m.abstained.join(", ")}`}`);
  const packErrors = (run.evidence?.packs ?? []).filter((p) => p.error).map((p) => `slot ${p.slot}: ${p.error}`);
  const cost = `exa $${(run.evidence?.cost ?? 0).toFixed(2)}`;
  const head = run.commit.committed
    ? `council ${date}: ${run.commit.lines} lines committed`
    : `‼️ council ${date}: no line — ${run.commit.reason}; the round opens unstaked`;
  const body = [head, ...slotLines, ...abstentions, ...(packErrors.length ? [`evidence: ${packErrors.join(" · ")}`] : []), cost].join("\n");
  await deps.telegram.send(body);
}
```

- [ ] **Step 5: The starter, the tick, the Workflow, the env and the admin route**

`apps/api/src/pipeline/workflows.ts`:
- `export type WorkflowKind = "author" | "resolve" | "council";`
- `WorkflowBindings` and `WorkflowInstanceBindings` gain `COUNCIL_WORKFLOW: WorkflowBinding;` / `COUNCIL_WORKFLOW: WorkflowInstanceBinding;`.
- In `bindingStarter`, the `of` record gains `council: bindings.COUNCIL_WORKFLOW,`.
- In `inlineStarter`, replace the `else` with:

```ts
      } else if (kind === "council") {
        const { runCouncil } = await import("./council");
        await runCouncil(deps, params.date);
      } else {
        const { runResolution } = await import("./resolve");
        await runResolution(deps, params.date, params.questionIds ?? []);
      }
```

`apps/api/src/pipeline/index.ts`, the `forecast` case becomes:

```ts
        case "forecast": {
          // Version 3 sits the Council (design 2026-09-11 §4.1): three members
          // in their own Workflow steps, dispatched with the hour bucket so a
          // duplicate tick collides rather than commits twice. Version 2 keeps
          // the single forecast, inline, exactly as before.
          const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, action.date), columns: { rulesVersion: true } });
          if ((round?.rulesVersion ?? 1) >= 3) {
            await deps.workflows.start(metered, "council", `council-${action.date}-${bucket}`, { date: action.date });
          } else {
            await stampOracleForecast(metered, action.date);
          }
          // The line follows the commit (design 2026-09-10 §5.5) and on every
          // later forecast tick until every question carries one.
          await commitLine(deps.db, action.date);
          done.push(`forecast:${action.date}`);
          break;
        }
```

Add `import { eq } from "drizzle-orm";` and `import { schema } from "../db/client";` to that file.

`apps/api/src/pipeline/workflow-entrypoints.ts`: add the imports `import { MODEL_MEMBER_IDS } from "@oracle/core";`, `import { councilEditable, narrateCouncil, type CouncilRun } from "./council";`, `import { retrieveEvidence } from "./council/evidence";`, `import { commitMember, type MemberResult } from "./council/member";`, `import { commitCouncil } from "./council/commit";`, and the class:

```ts
export class CouncilWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date } = event.payload;
    const editable = await durableStep(step, "editable", POLICY.db, deps, () => councilEditable(deps, date));
    if (!editable) return { committed: false, reason: "not editable" };
    const evidence = await durableStep(step, "evidence", POLICY.sourceFetch, deps, () => retrieveEvidence(deps, date));
    // One step per member (design 2026-09-11 §4.2): a timeout in one cannot
    // lose the others, and a retry of the commit step never re-asks a model.
    const members: MemberResult[] = [];
    for (const m of MODEL_MEMBER_IDS) {
      members.push(await durableStep(step, `member-${m}`, POLICY.modelWide, deps, () => commitMember(deps, date, m)));
    }
    const commit = await durableStep(step, "commit", POLICY.db, deps, () => commitCouncil(deps, date, members));
    const run: CouncilRun = { editable: true, evidence, members, commit };
    await durableStep(step, "narrate", POLICY.narrate, deps, async () => { await narrateCouncil(deps, date, run); return { narrated: true }; });
    return { committed: commit.committed, reason: commit.reason, lines: commit.lines };
  }
}
```

`apps/api/src/pipeline/steps.ts`: in the `modelWide` comment replace "UNUSED since the gauntlet's per-candidate fan-out was retired; kept as the declared policy for the next fan-out rather than re-derived then." with "Used by the Council's three member steps (design 2026-09-11 §4.2)."

`apps/api/src/worker.ts`:
- The re-export becomes `export { AuthoringWorkflow, ResolutionWorkflow, CouncilWorkflow } from "./pipeline/workflow-entrypoints";`
- `WorkerEnv` gains `COUNCIL_WORKFLOW?: WorkflowInstanceBinding;`
- In `buildPipelineDeps`, the bindings check requires all three: `env.AUTHORING_WORKFLOW && env.RESOLUTION_WORKFLOW && env.COUNCIL_WORKFLOW ? { AUTHORING_WORKFLOW: env.AUTHORING_WORKFLOW, RESOLUTION_WORKFLOW: env.RESOLUTION_WORKFLOW, COUNCIL_WORKFLOW: env.COUNCIL_WORKFLOW } : null`.
- In `fetch`, `workflows` gains `COUNCIL_WORKFLOW: env.COUNCIL_WORKFLOW,`.

`apps/api/wrangler.jsonc`, `workflows` gains:

```jsonc
    { "name": "oracle-council", "binding": "COUNCIL_WORKFLOW", "class_name": "CouncilWorkflow" }
```

`apps/api/src/pipeline/spend.ts`: in the budget comment near line 33, update the per-night enumeration so `forecast 1` reads `forecast 1 (version 2) or council 3 (version 3), lessons up to 15 at settlement`; leave `PIPELINE_DAILY_CALL_BUDGET` at 150, which still holds the total.

`apps/api/src/routes/admin.ts`:
- `const WORKFLOW_KINDS = { author: "AUTHORING_WORKFLOW", resolve: "RESOLUTION_WORKFLOW", council: "COUNCIL_WORKFLOW" } as const;`
- After the `/rounds/:date/line` route:

```ts
  // Sit the Council for a date, by hand (design 2026-09-11 §4.1). Same
  // dispatch the cron uses; a manual id so it never collides with the hour's.
  .post("/rounds/:date/council", async (c) => {
    const pipeline = c.get("deps").pipeline;
    if (!pipeline) return c.json({ error: "pipeline not configured" }, 503);
    const date = c.req.param("date");
    const round = await c.get("deps").db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    if (!round) return c.json({ error: "unknown round" }, 404);
    if (round.rulesVersion < 3) return c.json({ error: "not a version 3 round" }, 409);
    if (round.oracleCommittedAt !== null) return c.json({ error: "already committed" }, 409);
    const id = `council-${date}-manual-${Date.now()}`;
    await pipeline.workflows.start(pipeline, "council", id, { date });
    return c.json({ ok: true, date, id });
  })
```

Any test that builds a `WorkflowBindings` literal (`pipeline-workflows.test.ts` or the `workflows-test/` suite) gains a `COUNCIL_WORKFLOW` fake with the same shape as the other two.

- [ ] **Step 6: Run the tests**

Run: `cd apps/api && npx vitest run test/council-commit.test.ts test/pipeline-tick.test.ts test/pipeline-workflows.test.ts test/admin-rounds.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pipeline/council apps/api/src/pipeline/workflows.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/src/pipeline/index.ts apps/api/src/pipeline/steps.ts apps/api/src/pipeline/spend.ts apps/api/src/worker.ts apps/api/wrangler.jsonc apps/api/src/routes/admin.ts apps/api/test
git commit -m "feat(pipeline): the Council sits — evidence, three members in their own steps, the median committed as the line

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 7: Lessons at settlement

**Files:**
- Create: `apps/api/src/pipeline/council/lessons.ts`
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts` (`ResolutionWorkflow.run`)
- Modify: `apps/api/src/pipeline/resolve.ts` (`runResolution`)
- Modify: `apps/api/src/routes/admin.ts` (`GET /lessons`, `DELETE /lessons/:id`)
- Test: `apps/api/test/council-lessons.test.ts`

**Interfaces:**
- Consumes: `lessonModel`, `LESSON_PROMPT_VERSION` (Task 5), `seriesKeyOf` (Task 5), tables `lines`, `lessons`.
- Produces:
  - `export interface LessonsOutcome { questionId: string; written: number; skipped: number; error?: string }`
  - `export async function writeLessons(deps: PipelineDeps, questionId: string): Promise<LessonsOutcome>` — idempotent; never throws except `BudgetExhausted`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/council-lessons.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { writeLessons } from "../src/pipeline/council/lessons";
import { createApp } from "../src/app";

const DATE = "2026-09-10";
const NOW = new Date("2026-09-12T02:00:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { lesson: "m-lesson" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

async function settled(outcome: "yes" | "no" | "void" = "yes", rulesVersion = 3) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion, status: "locked" }).where(eq(schema.rounds.date, DATE));
  const q = rows[0]!;
  await db.update(schema.questions).set({ status: outcome === "void" ? "void" : "resolved", outcome, resolvedAt: new Date("2026-09-12T01:00:00Z"), marketSeriesKey: "KXHIGHNY", linePYes: "0.4" }).where(eq(schema.questions.id, q.id));
  await db.insert(schema.lines).values([
    { questionId: q.id, member: "sonnet", pYes: "0.30", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Sonnet's route." },
    { questionId: q.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Opus's route." },
    { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
  ]);
  return { db, q };
}

describe("writeLessons (spec §8)", () => {
  it("writes one lesson per model member with a line, keyed on the series, dated by the question's settlement", async () => {
    const { db, q } = await settled("yes");
    const calls: StructuredCall[] = [];
    const r = await writeLessons(makeDeps(db, { structured: async (c) => { calls.push(c); return { text: `Lesson for ${c.user.includes("0.3") ? "sonnet" : "opus"}.` }; } }), q.id);
    expect(r).toEqual({ questionId: q.id, written: 2, skipped: 0 });
    expect(calls.length).toBe(2);
    expect(calls[0]!.model).toBe("m-lesson");
    expect(calls[0]!.webSearch).toBeUndefined();
    expect(calls[0]!.user).toContain("Sonnet's route.");
    expect(calls[0]!.user).toContain("OUTCOME: YES");
    const rows = await db.query.lessons.findMany({ orderBy: (l, { asc }) => [asc(l.member)] });
    expect(rows.map((l) => l.member)).toEqual(["opus", "sonnet"]);
    expect(rows[0]!.seriesKey).toBe("KXHIGHNY");
    expect(rows[0]!.resolvedAt.toISOString()).toBe("2026-09-12T01:00:00.000Z");
    expect(rows[0]!.text).toMatch(/^Lesson for/);
  });

  it("never writes twice, and skips members that already have one", async () => {
    const { db, q } = await settled("no");
    const deps = makeDeps(db, { structured: async () => ({ text: "L." }) });
    await writeLessons(deps, q.id);
    const again = await writeLessons(deps, q.id);
    expect(again).toEqual({ questionId: q.id, written: 0, skipped: 2 });
    expect((await db.query.lessons.findMany()).length).toBe(2);
  });

  it("writes nothing for a void, an unresolved question, or a version 2 round", async () => {
    for (const [outcome, version] of [["void", 3], ["yes", 2]] as const) {
      const { db, q } = await settled(outcome, version);
      const r = await writeLessons(makeDeps(db, { structured: async () => { throw new Error("must not be called"); } }), q.id);
      expect(r.written).toBe(0);
      expect((await db.query.lessons.findMany()).length).toBe(0);
    }
  });

  it("a failed call is an error value, not a throw, and the other member still writes", async () => {
    const { db, q } = await settled("yes");
    const r = await writeLessons(makeDeps(db, { structured: async (c) => { if (c.user.includes("Opus")) throw new Error("down"); return { text: "L." }; } }), q.id);
    expect(r.written).toBe(1);
    expect(r.error).toContain("opus: down");
  });

  it("falls back to the category when the question has no series key", async () => {
    const { db, q } = await settled("yes");
    await db.update(schema.questions).set({ marketSeriesKey: null }).where(eq(schema.questions.id, q.id));
    await writeLessons(makeDeps(db, { structured: async () => ({ text: "L." }) }), q.id);
    expect((await db.query.lessons.findFirst())!.seriesKey).toBe("news");
  });
});

describe("the admin lessons routes", () => {
  it("lists newest first, filters by member and series, and deletes one", async () => {
    const { db, q } = await settled("yes");
    await writeLessons(makeDeps(db, { structured: async () => ({ text: "L." }) }), q.id);
    const app = createApp({ db, env: { DEVICE_TOKEN_SECRET: "s", ADMIN_SECRET: "admin" } });
    const h = { "x-admin-secret": "admin" };
    const all = (await (await app.request("/admin/lessons", { headers: h })).json()) as { lessons: { id: string; member: string; series_key: string; text: string }[] };
    expect(all.lessons.length).toBe(2);
    const opus = (await (await app.request("/admin/lessons?member=opus", { headers: h })).json()) as { lessons: { id: string }[] };
    expect(opus.lessons.length).toBe(1);
    expect((await app.request(`/admin/lessons/${opus.lessons[0]!.id}`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await db.query.lessons.findMany()).length).toBe(1);
    expect((await app.request("/admin/lessons")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/council-lessons.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/pipeline/council/lessons.ts
// Memory (design 2026-09-11 §8), taken from TradingAgents' decision log and
// nothing else of it: store the decision now, reflect once when the outcome
// is known, feed a few short lessons back under the as-of rule. One Haiku
// call per model member per settled question; written once; a member's own.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { MODEL_MEMBER_IDS, type ModelMemberId } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { BudgetExhausted } from "../spend";
import { lessonModel, LESSON_PROMPT_VERSION } from "./members";
import { seriesKeyOf } from "./lessonsFor";

export interface LessonsOutcome { questionId: string; written: number; skipped: number; error?: string }

const LessonSchema = z.object({ text: z.string().min(1) });
const lessonJsonSchema = {
  type: "object",
  properties: { text: { type: "string", description: "Two to four plain sentences." } },
  required: ["text"], additionalProperties: false,
};

const SYSTEM = `You write one lesson for a forecaster reviewing its own settled call. State in two to four plain sentences whether the line was on the right side of the outcome, what in the reasoning held or failed, and one concrete adjustment for the next question in the same series. No preamble. Prompt version ${LESSON_PROMPT_VERSION}. Call the lesson tool exactly once.`;

const NAMES: Record<ModelMemberId, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku" };

export async function writeLessons(deps: PipelineDeps, questionId: string): Promise<LessonsOutcome> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q || q.outcome === null || q.outcome === "void" || q.resolvedAt === null) return { questionId, written: 0, skipped: 0 };
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate), columns: { rulesVersion: true } });
  if (!round || round.rulesVersion < 3) return { questionId, written: 0, skipped: 0 };
  const lines = await deps.db.query.lines.findMany({ where: eq(schema.lines.questionId, questionId) });
  const have = new Set((await deps.db.query.lessons.findMany({ where: eq(schema.lessons.questionId, questionId), columns: { member: true } })).map((l) => l.member));

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const member of MODEL_MEMBER_IDS) {
    const line = lines.find((l) => l.member === member);
    if (!line) continue;
    if (have.has(member)) { skipped++; continue; }
    if (!deps.claude) { errors.push(`${member}: no claude client`); continue; }
    const user = `MEMBER: ${NAMES[member]}\nQUESTION: ${q.text}\nRESOLVES BY: ${q.resolutionCriteria}\nSERIES: ${seriesKeyOf(q)}\nYOUR LINE: ${Number(line.pYes)} (probability of YES)\nYOUR REASONING: ${line.reasoning ?? "(none)"}\nOUTCOME: ${q.outcome.toUpperCase()}`;
    try {
      const res = await deps.claude.structured({ model: lessonModel(deps), system: SYSTEM, user, schemaName: "lesson", schema: lessonJsonSchema });
      const parsed = LessonSchema.safeParse(res);
      if (!parsed.success) { errors.push(`${member}: response failed the lesson schema`); continue; }
      await deps.db.insert(schema.lessons)
        .values({ member, seriesKey: seriesKeyOf(q), questionId, text: parsed.data.text.trim(), resolvedAt: q.resolvedAt })
        .onConflictDoNothing();
      written++;
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      errors.push(`${member}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { questionId, written, skipped, ...(errors.length ? { error: errors.join(" · ") } : {}) };
}
```

In `apps/api/src/pipeline/workflow-entrypoints.ts`, `ResolutionWorkflow.run`: import `writeLessons` from `./council/lessons` and, inside the `for` loop after the `resolve-${questionId}` step:

```ts
      // Memory (design 2026-09-11 §8): its own step, after the outcome is
      // known, so a retried resolve never re-asks and a failed lesson never
      // fails the resolution. No-op below version 3 and on void.
      await durableStep(step, `lessons-${questionId}`, POLICY.model, deps, () => writeLessons(deps, questionId));
```

In `apps/api/src/pipeline/resolve.ts` `runResolution`, after each `resolveOne` push: `await writeLessons(deps, questionId);` with the import `import { writeLessons } from "./council/lessons";`.

In `apps/api/src/routes/admin.ts`, after `GET /bank`:

```ts
  // Memory is readable and cuttable by hand (design 2026-09-11 §8): a bad
  // lesson found here is deleted here, and the next commit never sees it.
  .get("/lessons", async (c) => {
    const db = c.get("deps").db;
    const member = c.req.query("member");
    const series = c.req.query("series");
    const rows = await db.query.lessons.findMany({
      where: and(...(member ? [eq(schema.lessons.member, member)] : []), ...(series ? [eq(schema.lessons.seriesKey, series)] : [])),
      orderBy: (l, { desc }) => [desc(l.resolvedAt)],
      limit: 100,
    });
    return c.json({ lessons: rows.map((l) => ({ id: l.id, member: l.member, series_key: l.seriesKey, question_id: l.questionId, text: l.text, resolved_at: l.resolvedAt.toISOString(), created_at: l.createdAt.toISOString() })) });
  })
  .delete("/lessons/:id", async (c) => {
    const rows = await c.get("deps").db.delete(schema.lessons).where(eq(schema.lessons.id, c.req.param("id"))).returning({ id: schema.lessons.id });
    if (rows.length === 0) return c.json({ error: "unknown lesson" }, 404);
    return c.json({ ok: true });
  })
```

Add `and` to that file's `drizzle-orm` import.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && npx vitest run test/council-lessons.test.ts test/pipeline-resolve.test.ts test/pipeline-resolve-exchange.test.ts && pnpm typecheck`
Expected: PASS. Existing resolve tests run at version 1 or 2 rounds, so `writeLessons` is a no-op there.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/council/lessons.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/src/pipeline/resolve.ts apps/api/src/routes/admin.ts apps/api/test/council-lessons.test.ts
git commit -m "feat(pipeline): one lesson per member per settled question, readable and cuttable by hand

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 8: The bank resolver's date anchor

**Files:**
- Modify: `apps/api/src/pipeline/resolver.ts` (`ResolverTarget`, `systemPrompt`)
- Modify: `apps/api/src/pipeline/resolve.ts:44-49` (the `target` literal in `resolveWithClaude`)
- Test: `apps/api/test/pipeline-resolver.test.ts` (modify)

**Interfaces:**
- Produces: `ResolverTarget` gains `opensAt: string; now: string` (ISO strings).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/pipeline-resolver.test.ts`, every `ResolverTarget` literal gains `opensAt: "2026-09-10T16:00:00.000Z", now: "2026-09-12T02:00:00.000Z"`, and add:

```ts
  it("anchors the resolver in time: the current instant, the open instant, and the different-event rule (design 2026-09-11 §10)", async () => {
    const calls: StructuredCall[] = [];
    const deps = makeDeps({ structured: async (c) => { calls.push(c); return { outcome: "unverifiable", quotes: [], reasoning: "" }; } });
    await askResolver(deps, "m-r", { text: "Will the 49ers beat the Rams?", resolutionCriteria: "Final score per NFL.com", sourceName: "NFL.com", sourceUrl: "https://www.nfl.com/x", opensAt: "2026-09-10T16:00:00.000Z", now: "2026-09-12T02:00:00.000Z" });
    const s = calls[0]!.system;
    expect(s).toContain("It is now 2026-09-12T02:00:00.000Z.");
    expect(s).toContain("This question opened at 2026-09-10T16:00:00.000Z.");
    expect(s).toContain("before the open instant describes a different event");
  });
```

(`makeDeps` is that file's existing helper that captures the `StructuredCall`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/pipeline-resolver.test.ts`
Expected: FAIL, type error on `opensAt` / missing text.

- [ ] **Step 3: Implement**

In `apps/api/src/pipeline/resolver.ts`:

```ts
export interface ResolverTarget {
  text: string;
  resolutionCriteria: string;
  sourceName: string;
  sourceUrl: string | null;
  // The date anchor (design 2026-09-11 §10). The September 9 void came from
  // a resolver with no clock reading last week's meeting of the same teams.
  opensAt: string;
  now: string;
}
```

and `systemPrompt`:

```ts
function systemPrompt(t: ResolverTarget): string {
  return `You resolve a prediction question for ORACLE. Question: "${t.text}". Resolution criteria: "${t.resolutionCriteria}". Source: ${t.sourceName}.
It is now ${t.now}. This question opened at ${t.opensAt}. Evidence describing events that concluded before the open instant describes a different event and must not settle this one.
Determine the outcome STRICTLY per the criteria, using only ${t.sourceName}. Quote the exact evidence.
If the source does not yet show a definitive outcome, answer "unverifiable" — never guess. Call the resolution tool exactly once.`;
}
```

In `apps/api/src/pipeline/resolve.ts` `resolveWithClaude`, the `target` literal gains:

```ts
    opensAt: q.opensAt.toISOString(),
    now: deps.now().toISOString(),
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && npx vitest run test/pipeline-resolver.test.ts test/pipeline-resolve.test.ts && pnpm typecheck`
Expected: PASS. Any other test constructing a `ResolverTarget` (grep `sourceUrl:` under `apps/api/test`) gains the two fields.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/resolver.ts apps/api/src/pipeline/resolve.ts apps/api/test
git commit -m "fix(pipeline): the bank resolver knows the time and the open instant

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 9: The Council on the reveal, and the admin round read

**Files:**
- Modify: `apps/api/src/routes/round.ts` (the reveal handler: the `Promise.all` near line 139, the response after `candidates_rejected`)
- Modify: `apps/api/src/routes/admin.ts` (`GET /rounds/:date`)
- Test: `apps/api/test/reveal-council.test.ts`

**Interfaces:**
- Consumes: `onRightSide`, `MEMBER_ORDER`, `RevealSchema` from `@oracle/core`; tables `lines`, `evidence`.
- Produces: the reveal's `council` and `evidence` arrays per spec §13; `GET /admin/rounds/:date` questions gain `lines` and `evidence` counts.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/reveal-council.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { RevealSchema } from "@oracle/core";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";
afterEach(() => vi.useRealTimers());

async function world() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const token = ((await res.json()) as { token: string }).token;
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40", oracleProbYes: "0.35" }).where(eq(schema.questions.roundDate, DATE));
  const q = qs[0]!;
  await db.insert(schema.lines).values([
    { questionId: q.id, member: "haiku", pYes: "0.44", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Haiku's route.", cited: [2], lessonsReceived: [] },
    { questionId: q.id, member: "sonnet", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z"), model: "m", promptVersion: "council-v1", reasoning: "Sonnet's route.", cited: [1, 2], lessonsReceived: ["5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e"] },
    { questionId: q.id, member: "market", pYes: "0.40", committedAt: new Date("2026-09-10T14:00:00Z") },
  ]);
  await db.insert(schema.evidence).values([1, 2].map((rank) => ({ questionId: q.id, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", publishedAt: rank === 1 ? new Date("2026-09-09T00:00:00Z") : null, highlight: `H${rank}.`, retrievedAt: new Date("2026-09-10T14:00:00Z") })));
  const get = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return { db, app, qs, get };
}

describe("the reveal's council and evidence (spec §13)", () => {
  it("carries entries in member order with the right-side verdict, and the pack, after lock", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T02:00:00Z"), toFake: ["Date"] });
    const { db, qs, get } = await world();
    await db.update(schema.questions).set({ status: "resolved", outcome: "no" }).where(eq(schema.questions.id, qs[0]!.id));
    const r = RevealSchema.parse(await (await get(`/v1/round/${DATE}/reveal`)).json());
    const mine = r.council.filter((e) => e.question_id === qs[0]!.id);
    expect(mine.map((e) => e.member)).toEqual(["sonnet", "haiku", "market"]);
    expect(mine[0]).toMatchObject({ p_yes: 0.40, on_right_side: true, reasoning: "Sonnet's route.", cited: [1, 2], lessons_received: 1 });
    expect(mine[2]).toMatchObject({ member: "market", reasoning: null, cited: [], lessons_received: 0 });
    expect(r.evidence.map((e) => e.rank)).toEqual([1, 2]);
    expect(r.evidence[0]!.published_at).toBe("2026-09-09T00:00:00.000Z");
    expect(r.evidence[1]!.published_at).toBeNull();
  });
  it("marks an undecided question's members null and a 0.5 line null", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-11T17:00:00Z"), toFake: ["Date"] });
    const { db, qs, get } = await world();
    await db.insert(schema.lines).values({ questionId: qs[1]!.id, member: "opus", pYes: "0.5", committedAt: new Date("2026-09-10T14:00:00Z") });
    await db.update(schema.questions).set({ status: "resolved", outcome: "yes" }).where(eq(schema.questions.id, qs[1]!.id));
    const r = RevealSchema.parse(await (await get(`/v1/round/${DATE}/reveal`)).json());
    expect(r.council.find((e) => e.question_id === qs[0]!.id && e.member === "sonnet")!.on_right_side).toBeNull();
    expect(r.council.find((e) => e.question_id === qs[1]!.id)!.on_right_side).toBeNull();
  });
  it("is empty before lock, because the reveal itself is", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T18:00:00Z"), toFake: ["Date"] });
    const { get } = await world();
    expect((await get(`/v1/round/${DATE}/reveal`)).status).toBe(409);
  });
});

describe("GET /admin/rounds/:date", () => {
  it("counts lines and evidence per question", async () => {
    const { app, qs } = await world();
    const json = (await (await app.request(`/admin/rounds/${DATE}`, { headers: { "x-admin-secret": "admin" } })).json()) as { questions: { id: string; lines: number; evidence: number }[] };
    expect(json.questions.find((q) => q.id === qs[0]!.id)).toMatchObject({ lines: 3, evidence: 2 });
    expect(json.questions.find((q) => q.id === qs[4]!.id)).toMatchObject({ lines: 0, evidence: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && npx vitest run test/reveal-council.test.ts`
Expected: FAIL, `council` is `[]`.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/round.ts`, add `onRightSide, MEMBER_ORDER` to the `@oracle/core` import. In the reveal handler, replace the `mine` query with a `Promise.all` that also loads the Council:

```ts
    const qIds = qs.map((q) => q.id);
    const [mine, councilRows, pack] = await Promise.all([
      db.query.predictions.findMany({ where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qIds)) }),
      // The Council and its evidence (design 2026-09-11 §13). Only here, after
      // lock: before it, the split is information and the house line is the
      // one line the player plays against.
      db.query.lines.findMany({ where: inArray(schema.lines.questionId, qIds) }),
      db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, qIds), orderBy: [asc(schema.evidence.questionId), asc(schema.evidence.rank)] }),
    ]);
    const memberRank = (m: string) => { const i = MEMBER_ORDER.indexOf(m as (typeof MEMBER_ORDER)[number]); return i === -1 ? MEMBER_ORDER.length : i; };
    const council = qs.flatMap((q) =>
      councilRows.filter((l) => l.questionId === q.id).sort((a, b) => memberRank(a.member) - memberRank(b.member)).map((l) => ({
        question_id: q.id,
        member: l.member,
        p_yes: Number(l.pYes),
        on_right_side: onRightSide(Number(l.pYes), q.outcome),
        reasoning: l.reasoning,
        cited: l.cited,
        lessons_received: l.lessonsReceived.length,
      })),
    );
    const evidence = pack.map((e) => ({
      question_id: e.questionId, rank: e.rank, url: e.url, title: e.title, source: e.source,
      published_at: e.publishedAt === null ? null : e.publishedAt.toISOString(), highlight: e.highlight,
    }));
```

and in the response object, after `candidates_rejected: round?.candidatesRejected ?? 0,`:

```ts
      council,
      evidence,
```

In `apps/api/src/routes/admin.ts` `GET /rounds/:date`, load counts alongside the questions and add them to each row:

```ts
    const ids = questions.map((q) => q.id);
    const [lineRows, evidenceRows] = ids.length
      ? await Promise.all([
          db.query.lines.findMany({ where: inArray(schema.lines.questionId, ids), columns: { questionId: true } }),
          db.query.evidence.findMany({ where: inArray(schema.evidence.questionId, ids), columns: { questionId: true } }),
        ])
      : [[], []];
    const countBy = (rows: { questionId: string }[], id: string) => rows.filter((r) => r.questionId === id).length;
```

and each mapped question gains `lines: countBy(lineRows, q.id), evidence: countBy(evidenceRows, q.id)`. Add `inArray` to the file's `drizzle-orm` import.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && npx vitest run test/reveal-council.test.ts test/round-v3.test.ts test/admin-rounds.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/src/routes/admin.ts apps/api/test/reveal-council.test.ts
git commit -m "feat(api): the reveal carries the Council split and the evidence pack after lock

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 10: The site's Standings link

**Files:**
- Modify: `apps/site/public/index.html`, `play.html`, `privacy.html`, `support.html` (the `<nav>` line in each)

- [ ] **Step 1: Find the API host**

Run: `cd apps/api && npx wrangler deployments list 2>/dev/null | head -5` or read the host from the last `pnpm deploy` output. It is the `oracle-api` worker's `workers.dev` URL, or the custom domain if one has been attached since. Call it `API_HOST` below.

- [ ] **Step 2: Add the link**

In each of the four files, the `<nav>` becomes (keep each page's own `aria-current="page"` where it already is):

```html
<nav><a class="brand" href="/">Outsee</a><a href="/privacy">Privacy</a><a href="/support">Support</a><a href="https://API_HOST/standings">Standings</a></nav>
```

with `API_HOST` replaced by the host from Step 1.

- [ ] **Step 3: Check it renders**

Run: `cd apps/site && npx wrangler dev` and open `http://localhost:8787/`; the nav shows four items and the Standings link points at the API host.

- [ ] **Step 4: Commit**

```bash
git add apps/site/public
git commit -m "docs(site): a Standings link to the open record

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 11: Mobile pure modules — the split rows and the reading

**Files:**
- Create: `apps/mobile/src/game/council.ts`
- Test: `apps/mobile/test/council.test.ts`

**Interfaces:**
- Consumes: `Reveal`, `CouncilEntry`, `EvidenceItem`, `MEMBER_ORDER` from `@oracle/core`.
- Produces:
  - `export type SplitTone = "win" | "loss" | "mute"`; `export interface SplitRow { member: CouncilEntry["member"] | "line"; label: string; tone: SplitTone }`
  - `export function councilFor(d: Reveal, questionId: string): CouncilEntry[]` — in `MEMBER_ORDER`.
  - `export function splitRows(entries: CouncilEntry[], linePYes: number | null): SplitRow[]` — empty when `entries` is empty.
  - `export function readingFor(entry: CouncilEntry, pack: EvidenceItem[]): { paragraph: string; cited: EvidenceItem[]; alsoRead: EvidenceItem[] } | null` — null for the market member or an empty paragraph.
  - `export function evidenceFor(d: Reveal, questionId: string): EvidenceItem[]` — in rank order.
  - `export function memberName(m: CouncilEntry["member"]): string` — `Sonnet`, `Opus`, `Haiku`, `the market`.
  - `export const READING_LINK = "THE ORACLE'S READING"`, `export const SPLIT_ROW_H = 15`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/test/council.test.ts
import { describe, it, expect } from "vitest";
import type { Reveal, CouncilEntry, EvidenceItem } from "@oracle/core";
import { councilFor, splitRows, readingFor, evidenceFor, memberName } from "../src/game/council";

const QID = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const entry = (over: Partial<CouncilEntry>): CouncilEntry => ({ question_id: QID, member: "sonnet", p_yes: 0.4, on_right_side: true, reasoning: "Because the forecast ran warm.", cited: [1, 3], lessons_received: 0, ...over });
const item = (rank: number): EvidenceItem => ({ question_id: QID, rank, url: `https://e/${rank}`, title: `Item ${rank}`, source: "e", published_at: "2026-09-09T00:00:00.000Z", highlight: `H${rank}.` });
const reveal = (council: CouncilEntry[], evidence: EvidenceItem[] = []): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
  delta: 0, return: 0, fortune_after: 1000, house_delta: 0, council, evidence,
  questions: [{ id: QID, slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 30, market_prob: 0.4, line_p_yes: 0.35, my: null, source_name: "Kalshi", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: 0.35 }],
  ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null },
});

describe("the Council split (spec §15.2)", () => {
  it("orders the entries and prints one row per member then the house line", () => {
    const d = reveal([entry({ member: "market", p_yes: 0.4, on_right_side: false, reasoning: null, cited: [] }), entry({ member: "haiku", p_yes: 0.44 }), entry({ member: "sonnet", p_yes: 0.40, on_right_side: false })]);
    const rows = splitRows(councilFor(d, QID), 0.35);
    expect(rows.map((r) => r.label)).toEqual(["SONNET 40", "HAIKU 44", "MARKET 40", "THE ORACLE'S LINE 35"]);
    expect(rows.map((r) => r.tone)).toEqual(["loss", "win", "loss", "mute"]);
  });
  it("is empty with no entries, so the slot keeps no height", () => {
    expect(splitRows([], 0.35)).toEqual([]);
    expect(splitRows(councilFor(reveal([]), QID), 0.35)).toEqual([]);
  });
  it("mutes an undecided or 0.5 member and omits the house line row when there is none", () => {
    const rows = splitRows([entry({ on_right_side: null })], null);
    expect(rows).toEqual([{ member: "sonnet", label: "SONNET 40", tone: "mute" }]);
  });
});

describe("the reading (spec §15.3)", () => {
  it("pairs the paragraph with cited items in rank order and lists the rest under also read", () => {
    const pack = [item(1), item(2), item(3)];
    const r = readingFor(entry({ cited: [3, 1] }), pack)!;
    expect(r.paragraph).toBe("Because the forecast ran warm.");
    expect(r.cited.map((i) => i.rank)).toEqual([1, 3]);
    expect(r.alsoRead.map((i) => i.rank)).toEqual([2]);
  });
  it("is null for the market member and for an empty paragraph", () => {
    expect(readingFor(entry({ member: "market", reasoning: null }), [])).toBeNull();
    expect(readingFor(entry({ reasoning: "  " }), [])).toBeNull();
  });
  it("finds a question's pack in rank order", () => {
    const d = reveal([], [item(2), item(1)]);
    expect(evidenceFor(d, QID).map((i) => i.rank)).toEqual([1, 2]);
  });
  it("names the members for the surface", () => {
    expect(["sonnet", "opus", "haiku", "market"].map((m) => memberName(m as CouncilEntry["member"]))).toEqual(["Sonnet", "Opus", "Haiku", "the market"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && npx vitest run test/council.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/game/council.ts
// The Council on the reveal (design 2026-09-11 §15): the split under each
// card's line, and the reading beneath a member's row. Pure; the screen
// only renders what these return.
import { MEMBER_ORDER, type CouncilEntry, type EvidenceItem, type Reveal } from "@oracle/core";

export type SplitTone = "win" | "loss" | "mute";
export interface SplitRow { member: CouncilEntry["member"] | "line"; label: string; tone: SplitTone }

export const READING_LINK = "THE ORACLE'S READING";
// One meta row of machine voice; the slot reserves rows × this when it has rows.
export const SPLIT_ROW_H = 15;

const NAMES: Record<CouncilEntry["member"], string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", market: "the market" };

export function memberName(m: CouncilEntry["member"]): string {
  return NAMES[m];
}

export function councilFor(d: Reveal, questionId: string): CouncilEntry[] {
  return d.council
    .filter((e) => e.question_id === questionId)
    .sort((a, b) => MEMBER_ORDER.indexOf(a.member) - MEMBER_ORDER.indexOf(b.member));
}

export function evidenceFor(d: Reveal, questionId: string): EvidenceItem[] {
  return d.evidence.filter((e) => e.question_id === questionId).sort((a, b) => a.rank - b.rank);
}

const pct = (p: number) => String(Math.round(p * 100));

export function splitRows(entries: CouncilEntry[], linePYes: number | null): SplitRow[] {
  if (entries.length === 0) return [];
  const rows: SplitRow[] = entries.map((e) => ({
    member: e.member,
    label: `${e.member.toUpperCase()} ${pct(e.p_yes)}`,
    tone: e.on_right_side === null ? "mute" : e.on_right_side ? "win" : "loss",
  }));
  if (linePYes !== null) rows.push({ member: "line", label: `THE ORACLE'S LINE ${pct(linePYes)}`, tone: "mute" });
  return rows;
}

export function readingFor(entry: CouncilEntry, pack: EvidenceItem[]): { paragraph: string; cited: EvidenceItem[]; alsoRead: EvidenceItem[] } | null {
  if (entry.member === "market") return null;
  const paragraph = (entry.reasoning ?? "").trim();
  if (!paragraph) return null;
  const cited = new Set(entry.cited);
  const sorted = [...pack].sort((a, b) => a.rank - b.rank);
  return { paragraph, cited: sorted.filter((i) => cited.has(i.rank)), alsoRead: sorted.filter((i) => !cited.has(i.rank)) };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/mobile && npx vitest run test/council.test.ts test/vocabulary.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/council.ts apps/mobile/test/council.test.ts
git commit -m "feat(mobile): pure modules for the Council split and the reading

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 12: The split on the reveal

**Files:**
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (imports near line 30; the reserved slot at lines 490-494; the Big One's line block near line 575)

**Interfaces:**
- Consumes: `councilFor`, `splitRows`, `SPLIT_ROW_H` (Task 11); `scaledRow` from `../../game/typeScaling`; `colors`, `role`, `Mono`.

- [ ] **Step 1: A small presentational component in the screen file**

Near the other local components in `reveal/[date].tsx` (before the default export), add:

```tsx
// The Council split (design 2026-09-11 §15.2): one row per member under the
// line, coloured by the side it was on, then the house line. Reserves its
// height only when it has rows, so a version 2 reveal, an unstaked round and
// a pending reveal lose nothing.
function CouncilSplit({ rows, fontScale, align = "left" }: { rows: SplitRow[]; fontScale: number; align?: "left" | "center" }) {
  if (rows.length === 0) return null;
  const tone = (t: SplitRow["tone"]) => (t === "win" ? colors.goldText : t === "loss" ? colors.vermilion : colors.mutedInk);
  return (
    <View style={{ minHeight: scaledRow(SPLIT_ROW_H, fontScale) * rows.length, gap: 0 }} accessibilityRole="text" accessibilityLabel={`The Council: ${rows.map((r) => r.label.toLowerCase()).join(", ")}`}>
      {rows.map((r) => (
        <Mono key={r.member} {...role.meta} color={tone(r.tone)} style={[role.meta.style, { textAlign: align }]}>{r.label}</Mono>
      ))}
    </View>
  );
}
```

Imports: `import { councilFor, splitRows, SPLIT_ROW_H, type SplitRow } from "../../game/council";`.

- [ ] **Step 2: Fill the reserved slot**

Replace lines 490-494 (the `{/* Council split lands here … */}` comment and the zero-height `View`) with:

```tsx
                  {money && <CouncilSplit rows={splitRows(councilFor(d, q.id), q.line_p_yes)} fontScale={fontScale} />}
```

`fontScale` is already in scope in the row map (it is passed to `scaledLines`).

- [ ] **Step 3: The Big One**

In the Big One block, directly after the `THE ORACLE'S LINE n% YES ✓` `Mono` (the `fortuneRound ? ( big.line_p_yes != null && … )` expression near line 575), add:

```tsx
                  {fortuneRound && <CouncilSplit rows={splitRows(councilFor(d, big.id), big.line_p_yes)} fontScale={fontScale} />}
```

- [ ] **Step 4: Typecheck and test**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean; the reveal tests and the vocabulary lint pass.

- [ ] **Step 5: Look at it**

Run: `cd apps/mobile && npx expo start` and open a settled version 3 reveal on the simulator by deep link (`xcrun simctl openurl booted "exp://127.0.0.1:8081/--/reveal/<date>"`) against the dev API with a round that has `lines` rows (the `seed3` driver seeds a version 3 round; insert three `lines` rows per question by hand with the admin SQL of your choice, or run the Council by the admin route against the dev API). Each card shows the split under its line; a version 2 reveal shows nothing extra.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/app/reveal/[date].tsx
git commit -m "feat(mobile): the Council split under each card's line

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 13: The Oracle's reading

**Files:**
- Create: `apps/mobile/src/ui/EvidenceCard.tsx`, `apps/mobile/src/ui/CouncilReading.tsx`
- Modify: `apps/mobile/src/analytics/analytics.ts` (`AnalyticsEvent`)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (`CouncilSplit` gains the reading)

**Interfaces:**
- Consumes: `readingFor`, `evidenceFor`, `memberName`, `READING_LINK` (Task 11); `QuietLink` from `../ui/Button`; `capture`.
- Produces: `EvidenceCard({ item }: { item: EvidenceItem })`; `CouncilReading({ entry, pack, questionId }: { entry: CouncilEntry; pack: EvidenceItem[]; questionId: string })` — a collapsed link that opens the paragraph and cards.

- [ ] **Step 1: The evidence card**

```tsx
// apps/mobile/src/ui/EvidenceCard.tsx
// One item of the shared pack (design 2026-09-11 §15.3), in the question
// card's materials at small scale: the hairline frame and the fresco ground,
// the title in serif, the source and date in tracked caps, the highlight in
// sentence case. Tapping opens the URL.
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";
import type { EvidenceItem } from "@oracle/core";
import { Mono, Serif, role } from "./Text";
import { colors, space } from "../theme";

function dateStamp(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "UNDATED";
}

export function EvidenceCard({ item }: { item: EvidenceItem }) {
  const [failed, setFailed] = useState(false);
  const open = () => { setFailed(false); void Linking.openURL(item.url).catch(() => setFailed(true)); };
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${item.title}, ${item.source}, ${dateStamp(item.published_at)}`} onPress={open}
      style={({ pressed }) => ({ borderWidth: 1, borderColor: colors.line, backgroundColor: colors.frescoWhite, padding: space(3), gap: space(1), opacity: pressed ? 0.7 : 1 })}>
      <Serif size={14} color={colors.ink} numberOfLines={2} style={{ lineHeight: 19 }}>{item.title}</Serif>
      <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{`${item.source.toUpperCase()} · ${dateStamp(item.published_at)}`}</Mono>
      <Mono {...role.supporting} color={colors.mutedInk} numberOfLines={4}>{item.highlight}</Mono>
      {failed && <Mono {...role.supporting} accessibilityRole="alert">The source could not be opened. Try again.</Mono>}
    </Pressable>
  );
}
```

- [ ] **Step 2: The reading block**

```tsx
// apps/mobile/src/ui/CouncilReading.tsx
// The Oracle's reading (design 2026-09-11 §15.3): under a model member's row,
// a collapsed link that opens the member's paragraph, the evidence it cited
// as cards, and an "also read" row for the rest of the pack. The paragraph is
// reading copy, set in sentence case as the member wrote it; the link and
// the labels are machine voice.
import { useState } from "react";
import { View } from "react-native";
import type { CouncilEntry, EvidenceItem } from "@oracle/core";
import { Mono, Serif, role } from "./Text";
import { QuietLink } from "./Button";
import { EvidenceCard } from "./EvidenceCard";
import { readingFor, memberName, READING_LINK } from "../game/council";
import { capture } from "../analytics/analytics";
import { colors, space } from "../theme";

export function CouncilReading({ entry, pack, questionId }: { entry: CouncilEntry; pack: EvidenceItem[]; questionId: string }) {
  const [open, setOpen] = useState(false);
  const reading = readingFor(entry, pack);
  if (!reading) return null;
  return (
    <View style={{ gap: space(2) }}>
      <QuietLink title={open ? `HIDE ${memberName(entry.member).toUpperCase()}'S READING` : `${READING_LINK} · ${memberName(entry.member).toUpperCase()}`} onPress={() => {
        if (!open) capture("reading_opened", { question_id: questionId, member: entry.member });
        setOpen((v) => !v);
      }} />
      {open && (
        <View style={{ gap: space(3) }}>
          <Serif size={15} color={colors.ink} style={{ lineHeight: 22 }}>{reading.paragraph}</Serif>
          {reading.cited.map((item) => <EvidenceCard key={item.rank} item={item} />)}
          {reading.alsoRead.length > 0 && (
            <View style={{ gap: space(1) }}>
              <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>ALSO READ</Mono>
              {reading.alsoRead.map((item) => (
                <Mono key={item.rank} {...role.supporting} color={colors.mutedInk} numberOfLines={1}>{`[${item.rank}] ${item.title} · ${item.source}`}</Mono>
              ))}
            </View>
          )}
          {reading.cited.length === 0 && reading.alsoRead.length === 0 && (
            <Mono {...role.supporting} color={colors.mutedInk}>No evidence was retrieved for this question.</Mono>
          )}
        </View>
      )}
    </View>
  );
}
```

- [ ] **Step 3: The analytics event and the wiring**

In `apps/mobile/src/analytics/analytics.ts`, add `| "reading_opened"` to `AnalyticsEvent` after `"resolution_evidence_opened"`.

In `reveal/[date].tsx`, `CouncilSplit` gains the reading under each model member's row. Change its props to take the entries and the pack rather than rows only:

```tsx
function CouncilSplit({ d, questionId, linePYes, fontScale, align = "left" }: { d: Reveal; questionId: string; linePYes: number | null; fontScale: number; align?: "left" | "center" }) {
  const entries = councilFor(d, questionId);
  const rows = splitRows(entries, linePYes);
  if (rows.length === 0) return null;
  const pack = evidenceFor(d, questionId);
  const tone = (t: SplitRow["tone"]) => (t === "win" ? colors.goldText : t === "loss" ? colors.vermilion : colors.mutedInk);
  return (
    <View style={{ minHeight: scaledRow(SPLIT_ROW_H, fontScale) * rows.length }} accessibilityLabel={`The Council: ${rows.map((r) => r.label.toLowerCase()).join(", ")}`}>
      {rows.map((r) => {
        const entry = entries.find((e) => e.member === r.member);
        return (
          <View key={r.member}>
            <Mono {...role.meta} color={tone(r.tone)} style={[role.meta.style, { textAlign: align }]}>{r.label}</Mono>
            {entry && entry.member !== "market" && <CouncilReading entry={entry} pack={pack} questionId={questionId} />}
          </View>
        );
      })}
    </View>
  );
}
```

and the two call sites become `<CouncilSplit d={d} questionId={q.id} linePYes={q.line_p_yes} fontScale={fontScale} />` and `<CouncilSplit d={d} questionId={big.id} linePYes={big.line_p_yes} fontScale={fontScale} />`. Imports: add `evidenceFor` from `../../game/council`, `CouncilReading` from `../../ui/CouncilReading`, and `type Reveal` from `@oracle/core`.

The reserved `minHeight` covers the collapsed rows only; an opened reading grows the row, which is the same allowance the resolution evidence disclosure already takes.

- [ ] **Step 4: Typecheck, test and look**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean. Then on the simulator, on the same reveal as Task 12 Step 5: tap `THE ORACLE'S READING · SONNET`; the paragraph, its cited cards and the also-read row appear; tap again to hide; the market row has no link. Capture `reveal-v3-council.png` and `reveal-v3-reading.png` into `docs/superpowers/plans/assets/the-council/`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/EvidenceCard.tsx apps/mobile/src/ui/CouncilReading.tsx apps/mobile/src/analytics/analytics.ts apps/mobile/src/app/reveal/[date].tsx docs/superpowers/plans/assets/the-council
git commit -m "feat(mobile): the Oracle's reading — each member's paragraph and the evidence it cited

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 14: Full suites, the rollout notes and the dry run

**Files:**
- Modify: `docs/launch-playbook.md` (a §2.4 "The Council" after the version 3 cutover section)

- [ ] **Step 1: Every suite**

Run, from the repo root:

```bash
pnpm -r typecheck
cd packages/core && npx vitest run && cd ../../apps/api && npx vitest run && cd ../mobile && npx vitest run
```

Expected: all green. The API suite takes about six and a half minutes; bare 5,000 ms timeouts are contention, re-run the file alone before treating one as a defect.

- [ ] **Step 2: The rollout notes**

Append to `docs/launch-playbook.md`, after §2.3:

```markdown
### 2.4 The Council (design 2026-09-11 §17)

1. Apply migration 0015 to `oracle-prod` by hand, as 0014 was.
2. `npx wrangler secret put EXA_API_KEY` in `apps/api`.
3. `pnpm --filter @oracle/api deploy`. The deploy creates the `oracle-council` Workflow from `wrangler.jsonc`. Open `https://<api-host>/standings`: it renders with zero calls.
4. On a day with a scheduled version 3 round, before noon ET: `curl -X POST -H "x-admin-secret: …" https://<api-host>/admin/rounds/<date>/council`. Read the Telegram message: five packs with item counts, each member's line per slot, the median, the line, the Exa cost. Record the observed cost per pack here: ____ per pack, ____ per night.
5. After that round settles the next evening: `GET /admin/lessons` shows up to fifteen rows; `/standings` shows the first calls.
6. Add the Standings link on the site (`apps/site`) and `pnpm --filter site deploy`.
7. Ship the mobile build with the split and the reading.
```

- [ ] **Step 3: Commit**

```bash
git add docs/launch-playbook.md
git commit -m "docs(playbook): the Council's rollout

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

## Self-review against the spec

| Spec section | Task |
| --- | --- |
| §3 members and order | 1 (`MEMBER_ORDER`), 5 (`members.ts`) |
| §4.1 trigger, version branch, admin route | 6 |
| §4.2 steps and policies | 6 (`CouncilWorkflow`) |
| §4.3 budget note and Exa cost | 6 (spend comment), 4 (`cost`), 14 (playbook) |
| §5 evidence packs, idempotent, empty pack still commits | 4, 5 (prompt says so), 6 |
| §6 member call, no search, schema, abstention, C8 dropped cites | 5 |
| §6.1 as-of rule, caps, own lessons only, ids recorded | 5 |
| §7 median of models only, fewer than two → unstaked + `‼️`, one statement, `commitLine` | 2 (`commit_council`), 6 |
| §8 lessons at settlement, once, void skipped, own step | 7 |
| §9 series key plumbed | 2 |
| §10 resolver anchor | 8 |
| §11 schema, immutability | 2 |
| §12 core functions and schemas | 1 |
| §13 reveal fields after lock; standings JSON, CSV, HTML, cache; admin routes | 9, 3, 6, 7 |
| §14 site link | 10 |
| §15 pure modules, split, reading, copy | 11, 12, 13 |
| §16 tests | each task's Step 1; 14 |
| §17 rollout | 14 |
| §18 out of scope | nothing built for Council-sits, CORS, or stored scores |

Type consistency checked: `MemberResult`/`MemberLine` (Task 5) are what Task 6's `commitCouncil` and `CouncilWorkflow` consume; `EvidenceSummary` (Task 4) is what `CouncilRun` carries; `CouncilEntry`/`EvidenceItem` (Task 1) are what Tasks 9, 11 and 13 read and write; `WorkflowKind` `"council"` is used by Task 6's tick, starter and admin route alike; `councilModels` on `PipelineDeps` (Task 4) is what Task 5's `memberModel` and Task 7's `lessonModel` read.
