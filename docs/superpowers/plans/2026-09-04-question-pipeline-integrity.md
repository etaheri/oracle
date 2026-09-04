# Question Pipeline Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily question pipeline fully autonomous and self-verifying — it authors a surplus of candidates, puts each through a four-tier gauntlet, resolves every question twice with two different models, heals locks mid-window when an answer appears, caps its own spend, and shows the player what it threw away.

**Architecture:** `decideActions` stays a pure function over `(ETNow, PipelineState)` and gains one new action (`probe`). Long fan-outs (`author`, `resolve`, `probe`) stop running inline in the 15-minute cron and are dispatched through a `WorkflowStarter` seam — Cloudflare Workflows in production, a direct inline call in tests and local dev. The gauntlet's tiers are ordinary async functions taking `PipelineDeps`, so every one of them is testable against PGlite with a fake Claude client and no network. One shared resolver (`askResolver`) serves three callers: resolution (twice, two models), the pre-flight (pointed backwards at authoring time), and the in-window probe (pointed forwards).

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Cloudflare Workflows, Drizzle ORM + Neon (PGlite in tests), Zod 4, Vitest, Expo/React Native for the two player-facing surfaces.

**Spec:** `docs/superpowers/specs/2026-09-04-question-pipeline-integrity-design.md`

---

## Global Constraints

These bind every task. Copy them into every dispatch.

1. **`decideActions` stays pure.** No `Date.now()`, no I/O, no DB access — a function of `(ETNow, PipelineState)` only. External facts (`bankCount`, `claudeAvailable`) arrive as fields on `PipelineState`, never as lookups.
2. **No test touches the network.** Every model call goes through `deps.claude` (a `ClaudeClient`), every HTTP fetch through an injected `fetch`. Fixtures only.
3. **The gauntlet never lowers its own bar.** Relaxation (§4 of the spec) applies to composition rules — the four-distinct-category requirement — and never to an integrity gate. There is no path in which a candidate that failed a gate is published because nothing better was available.
4. **The taste gate is fail-closed.** An error, a timeout, or unparseable output rejects the entire batch. It is the only gate in this design that is fail-closed, and it runs last.
5. **Disagreement never picks a winner.** Two resolvers that disagree produce `unverifiable`, never an outcome.
6. **A probe never moves a lock later.** `locks_at := min(locks_at, now)`. `Math.min` is the whole rule.
7. **`questions.lock_healed_at` is written only by the probe.** An authored early lock must leave it null. That is the column's entire reason for existing.
8. **Every player-facing string lives in `packages/core/src/copy.ts`** and is governed by the copy lint: ALL CAPS, no emoji, no `!`, none of `CHECK`/`TAP`/`CLICK`/`VISIT`/`RESULTS`/`DON'T MISS`, and ≤140 characters after worst-case slot expansion. Never add a string at the call site to dodge the lint.
9. **Adding a rite grows the canon, so `NUMERALS` must grow with it.** `apps/mobile/src/game/numerals.ts` must stay at least `RITES_LINES.length` long; `apps/mobile/test/numerals.test.ts` asserts it.
10. **Deterministic actions are never blocked by the spend ceiling.** `lock`, `publish`, `publish-bank`, `void`, `settle` cost nothing and the game must still turn.
11. **`neon-http` has no transactions.** Every write is a standalone statement; every multi-step action must be safe to retry on the next tick.
12. **Commit after every task**, with a message in the repo's existing voice (lower-case `type(scope): sentence`, no trailing period), and end every commit message with:
    ```
    Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
    ```
13. **Run the full suite from the repo root before committing**: `pnpm test` and `pnpm typecheck`. Both must be green. 808 tests pass at the baseline; the count only goes up.

### Threshold values (copy verbatim, never re-derive)

| Name | Value | Home |
|---|---|---|
| `CANDIDATE_TARGET` | `14` | `pipeline/gauntlet/generate.ts` |
| `CANDIDATE_MIN` | `12` | `pipeline/gauntlet/generate.ts` |
| `CANDIDATE_MAX` | `15` | `pipeline/gauntlet/generate.ts` |
| `TOPIC_KEY_DAYS` | `7` | `pipeline/candidate.ts` |
| `SOURCE_TIMEOUT_MS` | `5000` | `pipeline/gauntlet/sources.ts` |
| `CONTESTED_MAX_DELTA` | `0.25` | `pipeline/gauntlet/critic.ts` |
| `PROB_DISAGREEMENT_MAX` | `0.30` | `pipeline/gauntlet/critic.ts` |
| `PROBE_INTERVAL_HOURS` | `4` | `pipeline/state.ts` |
| `PIPELINE_DAILY_CALL_BUDGET` | `150` | `pipeline/spend.ts` |
| `MIN_DISTINCT_CATEGORIES` | `4` | `pipeline/gauntlet/select.ts` |
| `RELAXED_DISTINCT_CATEGORIES` | `3` | `pipeline/gauntlet/select.ts` |

All of these are first guesses per spec §14.1. They are named constants so the first live week can tune them in one place.

---

## Rulings made while writing this plan

The spec left these open or implied; each is decided here so no implementer has to guess.

- **R1 — `questions.topic_key` is a new column, and the spec does not name it.** Spec §3.2 requires rejecting a `topic_key` seen in the last 7 days. Nothing can be compared against history that is not stored, so migration 0007 adds `questions.topic_key` (nullable text) alongside the three columns §11 names. *Cost if wrong:* one unused nullable column.
- **R2 — `DraftQuestionSchema` gains an OPTIONAL `topic_key`.** Spec §3.1 says `DraftQuestionSchema` and everything downstream keep their current shape so `/reroll`, the bank and the admin API are untouched. Adding a field that defaults to `null` keeps every existing caller and fixture valid while letting `upsertDraft` persist the key in the write it already performs — the alternative (a second UPDATE pass after `upsertDraft`) is a non-atomic write on a database with no transactions. *Cost if wrong:* a nullable field on a schema that did not need it.
- **R3 — `candidates_rejected` counts gate rejections, not "everything unpublished".** A survivor that passed every gate but lost the slot draw was not "put down". *Cost if wrong:* the reveal line under-counts on nights where more than five survive.
- **R4 — Compound-clause rejection is a literal `" and "` / `" or "` scan of `text`.** Detecting whether two predicates are actually joined needs a parser this project will not have. Surplus is what makes over-rejection affordable — that is the whole argument of §3.1. *Cost if wrong:* a handful of legitimate questions get thrown away each night, absorbed by the surplus.
- **R5 — The disagreement verdict is persisted on the question at disagreement time.** §6 resolves a disagreement to `unverifiable`, which means the question stays locked and voids hours later in `voidQuestions` — by which point the disagreement is gone unless it was written down. `resolveWithClaude` writes `resolution_evidence = { disagreement: true, a, b, checked_at }` without touching `status`; `voidQuestions` reads that flag to choose §11.3's void reason. This also satisfies §6's "evidence from both models is stored". *Cost if wrong:* a struck question reads as a generic unverifiable void.
- **R6 — `WorkflowStarter` has an inline implementation.** Tests, `wrangler dev`, and any deployment without the Workflow bindings run the same runner functions directly, so `runTick`'s executed-action labels are identical either way and the existing tick tests keep working. Production uses the binding-backed starter. `buildPipelineDeps` picks the binding starter when all three bindings are present and `console.warn`s when it falls back. *Cost if wrong:* a misconfigured production Worker keeps the latent 15-minute bug instead of failing loudly.
- **R7 — The taste gate runs on all survivors, before selection.** §8 says it runs "last, on the small set that survived everything else". Running it before selection means a single tasteless candidate is removed rather than killing the round, while the fail-closed path (the whole batch rejected) still falls through to the bank exactly as specified. *Cost if wrong:* one extra candidate's worth of Haiku tokens.
- **R8 — `claude.ts` moves to `web_search_20260209`.** Spec §14.3 calls this worth changing regardless. Every search-using call in this design runs on Opus 5 or Sonnet 5, which support it. *Cost if wrong:* a 400 from the API on the search tool, caught by the existing `claude: <status>` error path.
- **R9 — The healed-lock line renders on the round screen above the numeral row**, in a fixed-height slot, when at least one question in today's round is healed AND unsealed by this player. That is exactly the case where a struck numeral needs explaining; a player who sealed before the heal does not need it, and a fixed-height slot keeps the layout from jumping. *Cost if wrong:* a player who sealed a question that later healed does not learn that it healed.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `apps/api/drizzle/0007_*.sql` | Migration: two `rounds` columns, two `questions` columns, the `pipeline_spend` table |
| `apps/api/src/pipeline/resolver.ts` | One shared model-resolver call, used by resolution, pre-flight and probe |
| `apps/api/src/pipeline/spend.ts` | The daily model-call ceiling and the metered Claude wrapper |
| `apps/api/src/pipeline/candidate.ts` | `CandidateSchema` + tier 0 (structural screening, topic dedupe, compound clauses) |
| `apps/api/src/pipeline/gauntlet/generate.ts` | Candidate authoring: the surplus prompt and its one model call |
| `apps/api/src/pipeline/gauntlet/sources.ts` | Tier 1 — source reachability |
| `apps/api/src/pipeline/gauntlet/critic.ts` | Tier 2 — the adversarial critic, and the §7 contestedness gate |
| `apps/api/src/pipeline/gauntlet/preflight.ts` | Tier 3 — the pre-flight resolve, inverted |
| `apps/api/src/pipeline/gauntlet/taste.ts` | Tier 4 — the fail-closed taste gate |
| `apps/api/src/pipeline/gauntlet/select.ts` | Selection into a round, with category relaxation |
| `apps/api/src/pipeline/gauntlet/index.ts` | `runAuthoringGauntlet` — the orchestration, the counts, the narration |
| `apps/api/src/pipeline/probe.ts` | The in-window probe and lock healing |
| `apps/api/src/pipeline/workflows.ts` | `WorkflowStarter`, the binding-backed starter, three `WorkflowEntrypoint` classes |

**Modified**

| File | Change |
|---|---|
| `apps/api/src/db/schema.ts` | Four columns, one table |
| `apps/api/src/pipeline/draft.ts` | Optional `topic_key` on `DraftQuestionSchema`; `upsertDraft` persists it |
| `apps/api/src/pipeline/resolve.ts` | Two models, disagreement handling, evidence from both |
| `apps/api/src/pipeline/actions.ts` | `voidQuestions` reads the disagreement flag for its void reason |
| `apps/api/src/pipeline/state.ts` | The `probe` action, `PROBE_INTERVAL_HOURS`, `openRound.probeIds` |
| `apps/api/src/pipeline/index.ts` | `PipelineDeps` gains models + `workflows`; long actions dispatch; budget metering |
| `apps/api/src/pipeline/claude.ts` | `web_search_20260209` |
| `apps/api/src/worker.ts` | New env vars, `WorkerEnv` bindings, exported Workflow classes |
| `apps/api/wrangler.jsonc` | `workflows` bindings, model vars, secret documentation |
| `apps/api/src/routes/round.ts` | Reveal carries the provenance counts; `/today` carries `lock_healed` |
| `packages/core/src/copy.ts` | `PIPELINE_LINES`, `provenanceLine`, one new rite |
| `packages/core/src/schemas.ts` | `RevealSchema` + `RoundTodaySchema` fields |
| `apps/mobile/src/game/numerals.ts` | `NUMERALS` grows to cover the grown canon |
| `apps/mobile/src/app/reveal/[date].tsx` | The provenance line |
| `apps/mobile/src/app/round.tsx` | The healed-lock line |

---

## Shared Interfaces

Every task's `Interfaces` block refers back to these. Names and types here are binding.

```ts
// apps/api/src/pipeline/resolver.ts
export interface ResolverQuote { url: string; quote: string }
export interface ResolverVerdict {
  outcome: "yes" | "no" | "unverifiable";
  quotes: ResolverQuote[];
  reasoning: string;
}
export interface ResolverTarget {
  text: string;
  resolutionCriteria: string;
  sourceName: string;
  sourceUrl: string | null;
}
export function allowedDomainsFor(sourceUrl: string | null): string[] | undefined;
export async function askResolver(deps: PipelineDeps, model: string, target: ResolverTarget): Promise<ResolverVerdict>;
/** The ONE definition of "the answer exists": yes/no WITH receipts. Null otherwise. */
export function settled(v: ResolverVerdict): "yes" | "no" | null;

// apps/api/src/pipeline/spend.ts
export const PIPELINE_DAILY_CALL_BUDGET = 150;
export class BudgetExhausted extends Error {}
/** Atomic increment. Returns the new count for `date`. */
export async function chargeCall(db: Db, date: string): Promise<number>;
/** Wraps a ClaudeClient so every structured() call is charged first. */
export function meterClaude(db: Db, claude: ClaudeClient, date: string): ClaudeClient;

// apps/api/src/pipeline/candidate.ts
export type Candidate = z.infer<typeof CandidateSchema>;
export const REJECT_REASONS = [
  "structural", "duplicate-topic", "compound", "dead-source",
  "ambiguous", "uncontested", "already-resolvable", "taste",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];
export interface Rejection { text: string; reason: RejectReason; detail: string }
export interface Screened { passed: Candidate[]; rejected: Rejection[] }
export const TOPIC_KEY_DAYS = 7;
export function screenCandidates(
  raw: unknown[],
  opts: { opensAt: Date; locksAtDefault: Date; recentTopicKeys: ReadonlySet<string> },
): Screened;
export async function recentTopicKeys(db: Db, date: string): Promise<Set<string>>;
export function emptyTally(): Record<RejectReason, number>;

// apps/api/src/pipeline/gauntlet/critic.ts
export interface Judged { candidate: Candidate; criticProbability: number }
export async function criticize(deps: PipelineDeps, candidates: Candidate[]): Promise<Screened & { judged: Judged[] }>;

// apps/api/src/pipeline/gauntlet/select.ts
export interface Selection { draft: Draft; relaxed: boolean }  // topic_key rides on the draft
export function selectRound(judged: Judged[]): Selection | null;

// apps/api/src/pipeline/gauntlet/index.ts
export interface GauntletResult {
  written: number;
  rejected: number;
  tally: Record<RejectReason, number>;
  published: boolean;
  relaxed: boolean;
}
export async function runAuthoringGauntlet(deps: PipelineDeps, date: string): Promise<GauntletResult>;

// apps/api/src/pipeline/probe.ts
export async function probeQuestion(deps: PipelineDeps, questionId: string): Promise<boolean>;
export async function runProbe(deps: PipelineDeps, date: string, questionIds: string[]): Promise<number>;

// apps/api/src/pipeline/resolve.ts
export async function runResolution(deps: PipelineDeps, date: string, questionIds: string[]): Promise<void>;

// apps/api/src/pipeline/workflows.ts
export type WorkflowKind = "author" | "resolve" | "probe";
export interface WorkflowStarter {
  // `deps` is passed in at start time, not captured at construction: runTick
  // hands it the METERED client, so inline execution is charged against the
  // spend ceiling exactly as dispatched execution is. bindingStarter ignores it.
  start(deps: PipelineDeps, kind: WorkflowKind, id: string, params: { date: string; questionIds?: string[] }): Promise<void>;
}
export function inlineStarter(): WorkflowStarter;
export function bindingStarter(bindings: WorkflowBindings): WorkflowStarter;
export function hourBucket(now: ETNow): string;  // "2026090417"

// packages/core/src/copy.ts
export const PIPELINE_LINES: Readonly<{ lockHealed: string; voidDisagreement: string }>;
export function provenanceLine(written: number, rejected: number): string | null;
```

`PipelineDeps` after this plan:

```ts
export interface PipelineDeps {
  db: Db;
  telegram: TelegramClient;
  claude: ClaudeClient | null;
  models: {
    author: string; resolve: string; resolveB: string; forecast: string;
    critic: string; preflight: string; probe: string; taste: string;
  };
  now(): Date;
  // Arrives in Task 14. Do NOT reference it in any test fixture before then —
  // the eight-model `models` shape lands in Task 3, `workflows` does not.
  workflows: WorkflowStarter;
  push?: PushEnv;
  marketFetch?: typeof fetch;
  /** Injected fetch for tier-1 source reachability. Defaults to global fetch. */
  sourceFetch?: typeof fetch;
}
```

---

### Task 1: Migration 0007 — the columns the rest of the plan writes to

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0007_the_machine_shows_its_work.sql` (generated)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `schema.rounds.candidatesWritten`, `schema.rounds.candidatesRejected`, `schema.questions.lockHealedAt`, `schema.questions.topicKey`, `schema.pipelineSpend` (`date` pk, `calls` integer not null default 0).

- [ ] **Step 1: Add the columns and the table to the Drizzle schema**

In `apps/api/src/db/schema.ts`, extend `rounds`:

```ts
export const rounds = pgTable("rounds", {
  date: date("date").primaryKey(),
  status: roundStatus("status").notNull().default("scheduled"),
  playerCount: integer("player_count").notNull().default(0),
  // What the gauntlet cost, in candidates (design 2026-09-04 §11.1). Default
  // 0 so every round authored before 0007 reads as "unknown" rather than as a
  // perfect night — the reveal withholds the line entirely at 0.
  candidatesWritten: integer("candidates_written").notNull().default(0),
  candidatesRejected: integer("candidates_rejected").notNull().default(0),
});
```

Extend `questions` (add both fields inside the existing object, after `oracleProbYes`):

```ts
  // Written ONLY by the in-window probe (pipeline/probe.ts) when it finds the
  // answer already exists and pulls the lock forward. This is why a boolean
  // derived from locks_at will not do: an authored early lock and a healed one
  // both produce locks_at < noon, and only the second is the machine catching
  // a leak in real time (design 2026-09-04 §11.2).
  lockHealedAt: timestamp("lock_healed_at", { withTimezone: true }),
  // The normalized subject of the question ("btc-close-above-threshold"), as
  // stated by the author. The gauntlet's tier-0 dedupe compares against the
  // last TOPIC_KEY_DAYS of these; the text dedupe it replaces let "will BTC
  // close above $X" through every night with a new X.
  topicKey: text("topic_key"),
```

Append the new table at the end of the file:

```ts
// The pipeline's daily model-call meter (design 2026-09-04 §9.1). One row per
// ET date, incremented before every model call. An unattended loop with hourly
// retries has no upper bound without it.
export const pipelineSpend = pgTable("pipeline_spend", {
  date: date("date").primaryKey(),
  calls: integer("calls").notNull().default(0),
});
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter @oracle/api db:generate`

Expected: a new `apps/api/drizzle/0007_*.sql` plus an updated `drizzle/meta/_journal.json`. Rename the generated `.sql` to `0007_the_machine_shows_its_work.sql` **and update its filename in `drizzle/meta/_journal.json` (`tag` field) to match**, so `db:migrate` and the PGlite test helper agree.

Verify the file contains exactly these five statements (order may differ):

```sql
ALTER TABLE "rounds" ADD COLUMN "candidates_written" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "candidates_rejected" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "lock_healed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "topic_key" text;--> statement-breakpoint
CREATE TABLE "pipeline_spend" (
	"date" date PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL
);
```

If `db:generate` produces anything else (a dropped column, a renamed table), stop and report it — the schema edit was wrong.

- [ ] **Step 3: Write the failing test**

Append to `apps/api/test/schema.test.ts`:

```ts
describe("migration 0007", () => {
  it("defaults a round's provenance counts to zero, so a pre-0007 round reads as unknown", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04" });
    const r = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-04") });
    expect(r!.candidatesWritten).toBe(0);
    expect(r!.candidatesRejected).toBe(0);
  });

  it("leaves lock_healed_at and topic_key null on an ordinary question", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-04", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-04T16:00:00Z"),
      locksAt: new Date("2026-09-05T16:00:00Z"),
      resolveBy: new Date("2026-09-05T17:00:00Z"),
    }).returning();
    expect(q!.lockHealedAt).toBeNull();
    expect(q!.topicKey).toBeNull();
  });

  it("holds a spend row per date", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: 3 });
    const row = await db.query.pipelineSpend.findFirst({
      where: eq(schema.pipelineSpend.date, "2026-09-04"),
    });
    expect(row!.calls).toBe(3);
  });
});
```

If `apps/api/test/schema.test.ts` does not already import `eq`, `schema` and `makeTestDb`, add those imports at the top of the file to match the style of the tests already there.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- schema`
Expected: PASS. (These are pure schema assertions; they pass as soon as the migration exists.)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm test && pnpm typecheck` from the repo root.
Expected: everything green. Nothing else reads the new columns yet.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/schema.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): the round records what it threw away, and the lock records who moved it

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 2: The copy — two lines, one rite, and the numeral table that has to grow with it

**Files:**
- Modify: `packages/core/src/copy.ts`
- Modify: `apps/mobile/src/game/numerals.ts`
- Test: `packages/core/test/copy-lint.test.ts`, `apps/mobile/test/numerals.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `PIPELINE_LINES` (`{ lockHealed, voidDisagreement }`), `provenanceLine(written, rejected)`, one new entry in `RITES_LINES`.

**Why the rite and not a card line:** every published question passed the pre-flight by construction, so a per-question line would be constant and therefore say nothing. It is not a fact about a card; it is a rule of the game.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/copy-lint.test.ts` (and add `PIPELINE_LINES, provenanceLine` to the existing import from `../src/copy`):

```ts
describe("the pipeline's own lines (design 2026-09-04 §11)", () => {
  it("holds the register: caps, no emoji, no exclamation, no CTA verbs, push-length", () => {
    const lines = [...Object.values(PIPELINE_LINES), provenanceLine(99, 99)!];
    for (const l of lines) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });

  it("withholds the provenance line when nothing was written, so a bank drop claims no gauntlet", () => {
    expect(provenanceLine(0, 0)).toBeNull();
    expect(provenanceLine(0, 5)).toBeNull();
    expect(provenanceLine(15, 10)).toBe("15 WRITTEN · 10 PUT DOWN");
  });

  it("names the pre-flight in the canon exactly once", () => {
    // Bound to the ONE line that makes the claim. An assertion against the
    // joined canon is vacuous the moment a phrase appears in two rites.
    const rite = RITES_LINES.find((l) => l.includes("PUT TO THE MACHINE"));
    expect(rite).toBeDefined();
    expect(rite).toContain("WHAT IT COULD ANSWER, YOU NEVER SEE.");
    expect(RITES_LINES.filter((l) => l.includes("PUT TO THE MACHINE"))).toHaveLength(1);
  });

  it("keeps the new rite out of the opening — a first-timer meets it in play", () => {
    const rite = RITES_LINES.find((l) => l.includes("PUT TO THE MACHINE"))!;
    expect(OPENING_RITES_LINES).not.toContain(rite);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — `provenanceLine is not a function`, `PIPELINE_LINES` undefined, and the rite lookup returns `undefined`.

- [ ] **Step 3: Add the copy**

In `packages/core/src/copy.ts`, insert the new rite into `RITES_LINES` in the **second** group (after `OPENING_RITES` = 9), directly after the line about a question closing when its answer begins to exist — the two rules are about the same guarantee, one seen from inside the window and one from before it:

```ts
  "A QUESTION CLOSES THE MOMENT ITS ANSWER BEGINS TO EXIST. SOME CLOSE BEFORE NOON.",
  "EVERY QUESTION IS PUT TO THE MACHINE BEFORE IT IS PUT TO YOU. WHAT IT COULD ANSWER, YOU NEVER SEE.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
```

Then append at the end of the file:

```ts
// The pipeline's own two lines (design 2026-09-04 §11.2, §11.3). Both describe
// something the machine DID, in the moment it did it — an early lock it pulled
// forward because the answer appeared, and a question two independent readers
// could not agree on. Kept here, in the bank's file, so the copy lint governs
// them; adding either at its call site would be adding it to dodge the lint.
export const PIPELINE_LINES = Object.freeze({
  lockHealed: "THE ANSWER EXISTS. THIS ONE IS CLOSED.",
  voidDisagreement: "THE READERS DID NOT AGREE. THIS ONE IS STRUCK.",
} as const);

// What the gauntlet cost, in candidates. Null below one written candidate, so
// a bank drop — and every round authored before migration 0007 — stays silent
// rather than claiming a gauntlet that never ran.
export function provenanceLine(written: number, rejected: number): string | null {
  if (written <= 0) return null;
  return `${written} WRITTEN · ${rejected} PUT DOWN`;
}
```

- [ ] **Step 4: Update the canon's exact-length assertion**

`packages/core/test/copy-lint.test.ts` already carries `expect(RITES_LINES.length).toBe(15);`
(inside the test named *"state the current rules: bounty not double, all five
for the first hour, the city of noon, partial days, staggered locks"*). It is a
deliberate tripwire against silent canon growth, and it is doing its job — the
canon really did grow. Change it to `16`, and nothing else in that test.

Leave `apps/mobile/src/app/rites.tsx:127` alone: it computes
`RITES_LINES.length - OPENING_RITES_LINES.length` and reads correctly at any
size.

- [ ] **Step 5: Run the core tests**

Run: `pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 6: Run the mobile tests and watch the numeral tripwire ring**

Run: `pnpm --filter @oracle/mobile test -- numerals`
Expected: **FAIL** — `NUMERALS.length` is 15 and `RITES_LINES.length` is now 16, so `numeral(16)` returns the string `"16"`.

This failure is the point. It is the guard that exists because the canon once reached fifteen while the table stopped at fourteen and the last rite rendered as arabic `15`. Do not skip past it.

- [ ] **Step 7: Grow the numeral table**

In `apps/mobile/src/game/numerals.ts`:

```ts
// Pure — lives outside CardChrome.tsx so node tests (vitest chokes on the
// RN imports in a .tsx file) can import it without dragging in react-native.
// Sixteen entries: five for the card's own slots, the rest so the Rites
// number in Ritual numerals throughout instead of falling back to arabic
// partway down the list. Keep this at least RITES_LINES.length — the rites
// test asserts it, and it has caught a real regression.
export const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI"] as const;
```

- [ ] **Step 8: Run the mobile tests**

Run: `pnpm --filter @oracle/mobile test -- numerals`
Expected: PASS.

- [ ] **Step 9: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts apps/mobile/src/game/numerals.ts
git commit -m "$(cat <<'MSG'
feat(copy): the machine names the questions it put down, and the canon grows a rule

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 3: One shared resolver, and the current web-search tool

**Files:**
- Create: `apps/api/src/pipeline/resolver.ts`
- Modify: `apps/api/src/pipeline/resolve.ts`
- Modify: `apps/api/src/pipeline/claude.ts:30` (the `web_search` tool block)
- Test: `apps/api/test/pipeline-resolver.test.ts` (new), `apps/api/test/pipeline-claude.test.ts` (existing)

**Interfaces:**
- Consumes: `PipelineDeps` (unchanged this task), `ClaudeClient`.
- Produces: `ResolverVerdict`, `ResolverTarget`, `askResolver(deps, model, target)`, `settled(v)`, `allowedDomainsFor(sourceUrl)` — see Shared Interfaces.

**Why this task exists:** three different callers need "ask a model to read one named source and report an outcome with receipts" — resolution (twice), the pre-flight pointed backwards, and the in-window probe pointed forwards. Extracting it once means the pre-flight and the probe inherit machinery already hardened in production instead of growing a second, subtly different copy.

This is a **pure refactor plus one constant change**. `resolveWithClaude`'s behaviour must not change; `apps/api/test/pipeline-resolve.test.ts` must pass untouched.

- [ ] **Step 0: Widen `deps.models` and its four call sites**

In `apps/api/src/pipeline/index.ts`, replace the `models` field of `PipelineDeps`:

```ts
  models: {
    author: string;    // Opus 5 + search — writes the candidates
    resolve: string;   // Sonnet 5 + search — resolver A
    resolveB: string;  // Opus 5 + search — resolver B, a DIFFERENT model on purpose
    forecast: string;  // Sonnet 5 + search — the Oracle's own position
    critic: string;    // Opus 5, no search — prosecutes the candidates
    preflight: string; // Sonnet 5 + search — the pre-flight resolve
    probe: string;     // Sonnet 5 + search — the in-window probe
    taste: string;     // Haiku 4.5, no search — classification only
  };
```

In `apps/api/src/worker.ts`, add the five new optional env vars to `WorkerEnv`
(`PIPELINE_RESOLVE_MODEL_B`, `PIPELINE_CRITIC_MODEL`, `PIPELINE_PREFLIGHT_MODEL`,
`PIPELINE_PROBE_MODEL`, `PIPELINE_TASTE_MODEL`) and fill them in
`buildPipelineDeps`:

```ts
    models: {
      author: env.PIPELINE_AUTHOR_MODEL ?? "claude-opus-5",
      resolve: env.PIPELINE_RESOLVE_MODEL ?? "claude-sonnet-5",
      // A DIFFERENT model, not the same one twice: running one model twice
      // correlates its errors, so agreement would mean nothing. Independent
      // errors require independent models (design 2026-09-04 §6.2).
      resolveB: env.PIPELINE_RESOLVE_MODEL_B ?? "claude-opus-5",
      forecast: env.PIPELINE_FORECAST_MODEL ?? "claude-sonnet-5",
      critic: env.PIPELINE_CRITIC_MODEL ?? "claude-opus-5",
      preflight: env.PIPELINE_PREFLIGHT_MODEL ?? "claude-sonnet-5",
      probe: env.PIPELINE_PROBE_MODEL ?? "claude-sonnet-5",
      taste: env.PIPELINE_TASTE_MODEL ?? "claude-haiku-4-5-20251001",
    },
```

Then run `pnpm --filter @oracle/api typecheck` and fix every test fixture it
reports — each one builds a `models` object literal and now needs the five new
keys. Give them the same `"m-<letter>"` placeholder style already in use
(`resolveB: "m-rb"`, `critic: "m-c"`, `preflight: "m-p"`, `probe: "m-pr"`,
`taste: "m-t"`). Expect to touch roughly `pipeline-tick.test.ts`,
`pipeline-author.test.ts`, `pipeline-bank.test.ts`, `pipeline-resolve.test.ts`,
`pipeline-forecast.test.ts` — run the typechecker rather than trusting this list.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/pipeline-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { askResolver, settled, allowedDomainsFor, type ResolverVerdict } from "../src/pipeline/resolver";
import type { PipelineDeps } from "../src/pipeline";

function deps(db: PipelineDeps["db"], reply: unknown, seen: { call?: Record<string, unknown> } = {}): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => { seen.call = call as unknown as Record<string, unknown>; return reply; } },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T16:00:00Z"),
  };
}

const target = { text: "Will it?", resolutionCriteria: "per the page", sourceName: "SRC", sourceUrl: "https://www.example.com/x" };

describe("allowedDomainsFor", () => {
  it("strips www and returns one hostname", () => {
    expect(allowedDomainsFor("https://www.example.com/x")).toEqual(["example.com"]);
  });
  it("returns undefined for a null or unparseable url, so search runs unrestricted", () => {
    expect(allowedDomainsFor(null)).toBeUndefined();
    expect(allowedDomainsFor("not a url")).toBeUndefined();
  });
});

describe("askResolver", () => {
  it("restricts the search to the source's own hostname and uses the model it was handed", async () => {
    const { db } = await makeTestDb();
    const seen: { call?: Record<string, unknown> } = {};
    await askResolver(deps(db, { outcome: "unverifiable", quotes: [], reasoning: "nothing yet" }, seen), "model-x", target);
    expect(seen.call!.model).toBe("model-x");
    expect((seen.call!.webSearch as { allowedDomains?: string[] }).allowedDomains).toEqual(["example.com"]);
  });

  it("collapses an unparseable response to unverifiable rather than throwing", async () => {
    const { db } = await makeTestDb();
    const v = await askResolver(deps(db, { nonsense: true }), "model-x", target);
    expect(v.outcome).toBe("unverifiable");
    expect(v.quotes).toEqual([]);
  });
});

describe("settled — the one definition of 'the answer exists'", () => {
  const v = (o: ResolverVerdict["outcome"], quotes: ResolverVerdict["quotes"]): ResolverVerdict => ({ outcome: o, quotes, reasoning: "" });
  const q = [{ url: "https://example.com/x", quote: "it happened" }];
  it("is the outcome when yes or no arrives WITH receipts", () => {
    expect(settled(v("yes", q))).toBe("yes");
    expect(settled(v("no", q))).toBe("no");
  });
  it("is null for unverifiable, and for a ruling with no receipts", () => {
    expect(settled(v("unverifiable", q))).toBeNull();
    expect(settled(v("yes", []))).toBeNull();
    expect(settled(v("no", []))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- pipeline-resolver`
Expected: FAIL — `Cannot find module '../src/pipeline/resolver'`.

- [ ] **Step 3: Create the resolver**

Create `apps/api/src/pipeline/resolver.ts`:

```ts
// One model-resolver call, shared by everything that needs to ask "does the
// answer exist yet, and can you show me where" (design 2026-09-04 §3, §5, §6).
//
// Three callers, three directions:
//   - resolve.ts  — forwards, after lock: what IS the outcome (run twice)
//   - preflight   — backwards, at authoring time: an answer that EXISTS is a
//                   rejection, because the question was never a prediction
//   - probe       — sideways, mid-window: an answer that has APPEARED pulls
//                   the lock forward to now
//
// The domain restriction is deliberate and it bounds what a verdict means: an
// `unverifiable` proves the NAMED SOURCE does not show it yet, not that no
// source does. That is the right scope, because resolution will read only that
// source too — but it is a narrower claim than "not knowable anywhere".
import { z } from "zod";
import type { PipelineDeps } from "./index";

export interface ResolverQuote { url: string; quote: string }
export interface ResolverVerdict {
  outcome: "yes" | "no" | "unverifiable";
  quotes: ResolverQuote[];
  reasoning: string;
}
export interface ResolverTarget {
  text: string;
  resolutionCriteria: string;
  sourceName: string;
  sourceUrl: string | null;
}

const ResolutionSchema = z.object({
  outcome: z.enum(["yes", "no", "unverifiable"]),
  quotes: z.array(z.object({ url: z.string(), quote: z.string() })),
  reasoning: z.string(),
});

export const resolutionJsonSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["yes", "no", "unverifiable"] },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" }, quote: { type: "string" } },
        required: ["url", "quote"],
        additionalProperties: false,
      },
    },
    reasoning: { type: "string" },
  },
  required: ["outcome", "quotes", "reasoning"],
  additionalProperties: false,
};

// Hostname of source_url, www.-stripped, when it parses as a URL; otherwise
// undefined — the web_search tool then runs with no allowed_domains
// restriction (claude.ts only sets allowed_domains when this is non-empty).
// The system prompt still names source_name as the only acceptable source
// either way.
export function allowedDomainsFor(sourceUrl: string | null): string[] | undefined {
  if (!sourceUrl) return undefined;
  try {
    return [new URL(sourceUrl).hostname.replace(/^www\./, "")];
  } catch {
    return undefined;
  }
}

function systemPrompt(t: ResolverTarget): string {
  return `You resolve a prediction question for ORACLE. Question: "${t.text}". Resolution criteria: "${t.resolutionCriteria}". Source: ${t.sourceName}.
Determine the outcome STRICTLY per the criteria, using only ${t.sourceName}. Quote the exact evidence.
If the source does not yet show a definitive outcome, answer "unverifiable" — never guess. Call the resolution tool exactly once.`;
}

// An unparseable response is not an error here: it is the same fact as
// "the source does not show it". Every caller already has a correct branch for
// unverifiable, and throwing instead would turn a bad model turn into a failed
// tick.
const UNVERIFIABLE: ResolverVerdict = { outcome: "unverifiable", quotes: [], reasoning: "" };

export async function askResolver(deps: PipelineDeps, model: string, target: ResolverTarget): Promise<ResolverVerdict> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const response = await deps.claude.structured({
    model,
    system: systemPrompt(target),
    user: `Resolve this question now, using only ${target.sourceName}.`,
    schemaName: "resolution",
    schema: resolutionJsonSchema,
    webSearch: { allowedDomains: allowedDomainsFor(target.sourceUrl), maxUses: 5 },
  });
  const parsed = ResolutionSchema.safeParse(response);
  return parsed.success ? parsed.data : UNVERIFIABLE;
}

// THE ONE DEFINITION of "the answer exists". A yes/no with no quotes is a
// ruling without receipts, and this codebase has always treated that as
// identical to unverifiable — three callers now depend on that being decided
// in exactly one place.
export function settled(v: ResolverVerdict): "yes" | "no" | null {
  if (v.outcome === "unverifiable") return null;
  if (v.quotes.length === 0) return null;
  return v.outcome;
}
```

- [ ] **Step 4: Point `resolve.ts` at it, changing no behaviour**

Rewrite `apps/api/src/pipeline/resolve.ts` to delegate. Keep the file's existing header comment; replace its body:

```ts
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";
import { askResolver, settled } from "./resolver";

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);

  const verdict = await askResolver(deps, deps.models.resolve, {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  });
  const outcome = settled(verdict);
  if (outcome === null) return false;

  // The Claude call above can take minutes across chained web searches, and
  // cron ticks can overlap: another tick may have voided this question (or
  // otherwise moved it off "locked") while this call was in flight. Re-check
  // right before writing so a late resolve never clobbers a void.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;

  await resolveQuestion(deps.db, questionId, outcome, {
    outcome,
    quotes: verdict.quotes,
    reasoning: verdict.reasoning,
    checked_at: deps.now().toISOString(),
    model: deps.models.resolve,
  });
  return true;
}
```

Delete the now-duplicated `ResolutionSchema`, `resolutionJsonSchema`, `allowedDomainsFor` and `systemPrompt` from `resolve.ts` — they live in `resolver.ts` now. If any test imports them from `resolve.ts`, update the import path rather than re-exporting.

- [ ] **Step 5: Move `web_search` to the current tool version**

In `apps/api/src/pipeline/claude.ts`, inside `buildTools`, change the search tool's `type`:

```ts
  if (call.webSearch) {
    tools.push({
      // web_search_20260209 is the current variant for Opus 5 and Sonnet 5 and
      // adds dynamic filtering (design 2026-09-04 §14.3). Every search-using
      // call in this pipeline runs on one of those two models.
      type: "web_search_20260209",
      name: "web_search",
      max_uses: call.webSearch.maxUses ?? 5,
      ...(call.webSearch.allowedDomains?.length ? { allowed_domains: call.webSearch.allowedDomains } : {}),
    });
  }
```

If `apps/api/test/pipeline-claude.test.ts` asserts the literal `"web_search_20250305"`, update that assertion to `"web_search_20260209"`.

- [ ] **Step 6: Run the resolver and resolve tests**

Run: `pnpm --filter @oracle/api test -- pipeline-resolver pipeline-resolve pipeline-claude`
Expected: PASS, including `pipeline-resolve.test.ts` **unchanged** apart from any import path. If a resolve test now fails on behaviour, the refactor changed something it must not have — fix the refactor, not the test.

- [ ] **Step 7: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/resolver.ts apps/api/src/pipeline/resolve.ts apps/api/src/pipeline/claude.ts apps/api/test
git commit -m "$(cat <<'MSG'
refactor(pipeline): one resolver, so the pre-flight and the probe inherit hardened machinery

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 4: The spend ceiling

**Files:**
- Create: `apps/api/src/pipeline/spend.ts`
- Test: `apps/api/test/pipeline-spend.test.ts`

**Interfaces:**
- Consumes: `schema.pipelineSpend` (Task 1), `ClaudeClient` from `pipeline/claude.ts`.
- Produces: `PIPELINE_DAILY_CALL_BUDGET`, `BudgetExhausted`, `chargeCall(db, date)`, `meterClaude(db, claude, date)`.

**The design in one sentence:** every model call in the pipeline goes through `deps.claude`, so wrapping that one object is the whole ceiling — and deterministic actions (`lock`, `publish`, `void`, `settle`) never touch it, which is why they can never be blocked.

The alert fires on the transition tick only: `chargeCall` returns the new count, and the caller alerts when that count is exactly `PIPELINE_DAILY_CALL_BUDGET + 1`. No extra state, no repeated criticals.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/pipeline-spend.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { chargeCall, meterClaude, BudgetExhausted, PIPELINE_DAILY_CALL_BUDGET } from "../src/pipeline/spend";
import type { ClaudeClient } from "../src/pipeline/claude";

const okClaude: ClaudeClient = { structured: async () => ({ ok: true }) };

describe("chargeCall", () => {
  it("creates the day's row on first call and increments after", async () => {
    const { db } = await makeTestDb();
    expect(await chargeCall(db, "2026-09-04")).toBe(1);
    expect(await chargeCall(db, "2026-09-04")).toBe(2);
    const row = await db.query.pipelineSpend.findFirst({ where: eq(schema.pipelineSpend.date, "2026-09-04") });
    expect(row!.calls).toBe(2);
  });

  it("counts each ET day separately", async () => {
    const { db } = await makeTestDb();
    await chargeCall(db, "2026-09-04");
    expect(await chargeCall(db, "2026-09-05")).toBe(1);
  });
});

describe("meterClaude", () => {
  it("charges before the call and passes the call through", async () => {
    const { db } = await makeTestDb();
    let seen = 0;
    const metered = meterClaude(db, { structured: async () => { seen++; return { ok: true }; } }, "2026-09-04");
    await metered.structured({ model: "m", system: "s", user: "u", schemaName: "n", schema: {} });
    expect(seen).toBe(1);
    const row = await db.query.pipelineSpend.findFirst({ where: eq(schema.pipelineSpend.date, "2026-09-04") });
    expect(row!.calls).toBe(1);
  });

  it("throws BudgetExhausted past the ceiling and never reaches the model", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    let reached = false;
    const metered = meterClaude(db, { structured: async () => { reached = true; return {}; } }, "2026-09-04");
    await expect(
      metered.structured({ model: "m", system: "s", user: "u", schemaName: "n", schema: {} }),
    ).rejects.toBeInstanceOf(BudgetExhausted);
    expect(reached).toBe(false);
  });

  it("marks only the crossing call as first, so the critical alert fires once", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    const metered = meterClaude(db, okClaude, "2026-09-04");
    const call = { model: "m", system: "s", user: "u", schemaName: "n", schema: {} };
    const first = await metered.structured(call).catch((e: unknown) => e as BudgetExhausted);
    const second = await metered.structured(call).catch((e: unknown) => e as BudgetExhausted);
    expect((first as BudgetExhausted).first).toBe(true);
    expect((second as BudgetExhausted).first).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- pipeline-spend`
Expected: FAIL — `Cannot find module '../src/pipeline/spend'`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/pipeline/spend.ts`:

```ts
// The pipeline's daily model-call ceiling (design 2026-09-04 §9.1).
//
// A fully unattended loop with hourly retries has no upper bound on model
// calls. A pathological night — authoring failing validation, probes retrying —
// spends until the window closes. This caps it.
//
// THE CEILING IS APPLIED BY WRAPPING deps.claude, and that is the whole
// argument for its correctness: every model call in this pipeline goes through
// that one object, and no deterministic action (lock, publish, void, settle)
// touches it at all. The game therefore keeps turning after the budget is
// gone; only the machine's opinions stop.
//
// The budget is an ops threshold, not a game rule, so it lives here beside
// BANK_LOW_WATER rather than in @oracle/core, whose header says "Scoring/game
// tunables".
import { sql } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import type { ClaudeClient, StructuredCall } from "./claude";

// Roughly three times a nominal night (authoring 1, critic 1, pre-flight ~12,
// taste 1, forecast 1, resolution 5x2, probes ~25 = ~52): high enough that a
// normal night never approaches it, low enough that a retry storm is capped
// within hours rather than days.
export const PIPELINE_DAILY_CALL_BUDGET = 150;

export class BudgetExhausted extends Error {
  /** True only on the call that crossed the line — the one tick that alerts. */
  readonly first: boolean;
  constructor(date: string, calls: number, first: boolean) {
    super(`pipeline: daily call budget exhausted for ${date} (${calls} of ${PIPELINE_DAILY_CALL_BUDGET})`);
    this.name = "BudgetExhausted";
    this.first = first;
  }
}

// One atomic statement, because neon-http has no transactions and two ticks
// can overlap: a read-then-write would lose counts under exactly the retry
// storm this exists to bound.
export async function chargeCall(db: Db, date: string): Promise<number> {
  const [row] = await db
    .insert(schema.pipelineSpend)
    .values({ date, calls: 1 })
    .onConflictDoUpdate({
      target: schema.pipelineSpend.date,
      set: { calls: sql`${schema.pipelineSpend.calls} + 1` },
    })
    .returning({ calls: schema.pipelineSpend.calls });
  return row!.calls;
}

export function meterClaude(db: Db, claude: ClaudeClient, date: string): ClaudeClient {
  return {
    async structured(call: StructuredCall): Promise<unknown> {
      // Charged BEFORE the call, never after: a call that throws still cost
      // tokens, and a meter that only counts successes is not a ceiling.
      const calls = await chargeCall(db, date);
      if (calls > PIPELINE_DAILY_CALL_BUDGET) {
        throw new BudgetExhausted(date, calls, calls === PIPELINE_DAILY_CALL_BUDGET + 1);
      }
      return claude.structured(call);
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-spend`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/spend.ts apps/api/test/pipeline-spend.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): the unattended loop gets an upper bound on what it can spend

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 5: `CandidateSchema` and tier 0 — the free gates

**Files:**
- Create: `apps/api/src/pipeline/candidate.ts`
- Modify: `apps/api/src/pipeline/draft.ts` (optional `topic_key`; `upsertDraft` persists it)
- Test: `apps/api/test/pipeline-candidate.test.ts`

**Interfaces:**
- Consumes: `schema.questions.topicKey` (Task 1), `lockFromResolvesAt`/`RESOLVES_AFTER_LOCK` from `pipeline/draft.ts`.
- Produces: `CandidateSchema`, `Candidate`, `REJECT_REASONS`, `RejectReason`, `Rejection`, `Screened`, `TOPIC_KEY_DAYS`, `screenCandidates(raw, opts)`, `recentTopicKeys(db, date)` — see Shared Interfaces.

**Why a separate schema:** candidates are not slotted at generation. Slot, the Big One and the four-distinct-category rule are *selection* constraints applied to survivors, not authoring constraints — otherwise a rejection in one category forces a re-author rather than a substitution. `DraftQuestionSchema` and everything downstream of it keep their shape, so `/reroll`, the bank and the admin API are untouched.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/pipeline-candidate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- pipeline-candidate`
Expected: FAIL — `Cannot find module '../src/pipeline/candidate'`.

- [ ] **Step 3: Write `candidate.ts`**

Create `apps/api/src/pipeline/candidate.ts`:

```ts
// The candidate — what the author produces now, in surplus, before anything
// has decided which five will run (design 2026-09-04 §3).
//
// A candidate is a DraftQuestion minus the two fields selection assigns (slot,
// is_big_one) plus the one the dedupe needs (topic_key). Keeping the two shapes
// separate is what lets a rejection in one category be SUBSTITUTED rather than
// re-authored: nothing about a candidate commits it to a position in a round.
import { z } from "zod";
import { and, gte, isNotNull, lt } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import { addDays } from "./clock";
import { RESOLVES_AFTER_LOCK } from "./draft";

// A repeated subject is the dedupe the text comparison never caught: "will BTC
// close above $X" passed it every night with a new X (audit 2026-09-01 §2.5).
export const TOPIC_KEY_DAYS = 7;

export const CandidateSchema = z
  .object({
    category: z.enum(["markets", "sports", "weather", "culture", "news"]),
    text: z.string().min(10),
    resolution_criteria: z.string().min(10),
    source_name: z.string().min(1),
    source_url: z.string().url(),
    author_probability: z.number().min(0.3).max(0.7),
    market_prob: z.number().min(0).max(1).nullable().default(null),
    resolves_at: z.union([z.iso.datetime({ offset: true }), z.literal(RESOLVES_AFTER_LOCK)]),
    // A NORMALIZED SUBJECT, not the question text: "btc-close-above-threshold",
    // never "Will BTC close above $70,000 on Friday?".
    topic_key: z.string().min(3).max(64).regex(/^[a-z0-9-]+$/),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.category === "weather" && q.resolves_at === RESOLVES_AFTER_LOCK) {
      ctx.addIssue({ code: "custom", message: "weather must name a resolves_at instant", path: ["resolves_at"] });
    }
  });

export type Candidate = z.infer<typeof CandidateSchema>;

export const REJECT_REASONS = [
  "structural",
  "duplicate-topic",
  "compound",
  "dead-source",
  "ambiguous",
  "uncontested",
  "already-resolvable",
  "taste",
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export interface Rejection { text: string; reason: RejectReason; detail: string }
export interface Screened { passed: Candidate[]; rejected: Rejection[] }

export function emptyTally(): Record<RejectReason, number> {
  return Object.fromEntries(REJECT_REASONS.map((r) => [r, 0])) as Record<RejectReason, number>;
}

// A literal scan, deliberately. Detecting whether two PREDICATES are joined
// needs a parser this project will not have, and surplus is exactly what makes
// over-rejection affordable — that is the argument of §3.1. A false rejection
// costs one of fourteen candidates; a compound question that ships costs a
// day's ledger entry that two careful readers can answer differently.
const COMPOUND = /\s(and|or)\s/i;

function textOf(raw: unknown): string {
  if (raw && typeof raw === "object" && typeof (raw as { text?: unknown }).text === "string") {
    return (raw as { text: string }).text;
  }
  return "(unparseable candidate)";
}

export function screenCandidates(
  raw: unknown[],
  opts: { opensAt: Date; locksAtDefault: Date; recentTopicKeys: ReadonlySet<string> },
): Screened {
  const passed: Candidate[] = [];
  const rejected: Rejection[] = [];
  // A key repeated INSIDE one batch is as much a repeat as one from last week;
  // the first occurrence wins and every later one is put down.
  const seen = new Set<string>(opts.recentTopicKeys);

  for (const item of raw) {
    const parsed = CandidateSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({
        text: textOf(item),
        reason: "structural",
        detail: parsed.error.issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    const c = parsed.data;

    if (c.resolves_at !== RESOLVES_AFTER_LOCK) {
      const t = new Date(c.resolves_at);
      if (Number.isNaN(t.getTime()) || t.getTime() <= opts.opensAt.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at is at or before the round opens" });
        continue;
      }
      if (t.getTime() > opts.locksAtDefault.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at runs past the round's own close" });
        continue;
      }
    }

    if (seen.has(c.topic_key)) {
      rejected.push({ text: c.text, reason: "duplicate-topic", detail: `topic_key "${c.topic_key}" ran within ${TOPIC_KEY_DAYS} days` });
      continue;
    }

    if (COMPOUND.test(c.text)) {
      rejected.push({ text: c.text, reason: "compound", detail: "two clauses joined by and/or" });
      continue;
    }

    seen.add(c.topic_key);
    passed.push(c);
  }

  return { passed, rejected };
}

export async function recentTopicKeys(db: Db, date: string): Promise<Set<string>> {
  const since = addDays(date, -TOPIC_KEY_DAYS);
  const rows = await db.query.questions.findMany({
    where: and(
      gte(schema.questions.roundDate, since),
      lt(schema.questions.roundDate, date),
      isNotNull(schema.questions.topicKey),
    ),
    columns: { topicKey: true },
  });
  return new Set(rows.map((r) => r.topicKey!).filter((k) => k.length > 0));
}
```

- [ ] **Step 4: Let `upsertDraft` persist the key**

In `apps/api/src/pipeline/draft.ts`, add one optional field to `DraftQuestionSchema` (inside the `z.object({...})`, after `resolves_at`):

```ts
    // The normalized subject, when the gauntlet authored this question. Optional
    // and null-defaulted on purpose: /reroll, the evergreen bank and the admin
    // API all post drafts that never had one, and none of them should have to
    // change to keep working (design 2026-09-04 §3.1).
    topic_key: z.string().min(3).max(64).nullable().default(null),
```

and one line to the row mapping inside `upsertDraft`, beside `authorProb`:

```ts
      topicKey: q.topic_key,
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-candidate pipeline-draft pipeline-bank`
Expected: PASS. `pipeline-draft` and `pipeline-bank` must be green **unchanged** — the new field is optional precisely so they are.

- [ ] **Step 6: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/candidate.ts apps/api/src/pipeline/draft.ts apps/api/test/pipeline-candidate.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): a candidate is not yet a question, and the free gates run first

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 6: Tier 1 — source reachability

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/sources.ts`
- Test: `apps/api/test/gauntlet-sources.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `Screened`, `Rejection` from `pipeline/candidate.ts`.
- Produces: `SOURCE_TIMEOUT_MS`, `checkSources(fetchFn: typeof fetch, candidates: Candidate[]): Promise<Screened>`.

**Why:** a hallucinated but well-formed URL passes `z.string().url()` today and fails 24 hours later at resolution, by which point the question has already run and voids. One HTTP GET per candidate, no model, catches it the night before.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-sources.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkSources } from "../src/pipeline/gauntlet/sources";
import type { Candidate } from "../src/pipeline/candidate";

const cand = (url: string, text = "Will it?"): Candidate => ({
  category: "news", text, resolution_criteria: "per the page",
  source_name: "SRC", source_url: url, author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: "k-" + url.length,
});

describe("checkSources — tier 1", () => {
  it("passes a source that answers 2xx", async () => {
    const fetchFn = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/a")]);
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it("rejects a 404 — a well-formed url that leads nowhere", async () => {
    const fetchFn = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/gone")]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("dead-source");
    expect(r.rejected[0]!.detail).toContain("404");
  });

  it("rejects a source that throws, including a timeout", async () => {
    const fetchFn = (async () => { throw new Error("The operation was aborted due to timeout"); }) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/slow")]);
    expect(r.rejected[0]!.reason).toBe("dead-source");
    expect(r.rejected[0]!.detail).toContain("timeout");
  });

  it("judges each candidate independently — one dead source never sinks the batch", async () => {
    const fetchFn = (async (input: RequestInfo | URL) =>
      String(input).includes("gone") ? new Response("", { status: 500 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/ok", "A?"), cand("https://example.com/gone", "B?")]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?"]);
    expect(r.rejected.map((x) => x.text)).toEqual(["B?"]);
  });

  it("preserves candidate order among survivors", async () => {
    const fetchFn = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/1", "A?"), cand("https://example.com/2", "B?"), cand("https://example.com/3", "C?")]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?", "B?", "C?"]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-sources`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `sources.ts`**

Create `apps/api/src/pipeline/gauntlet/sources.ts`:

```ts
// Tier 1 — does the promised source actually exist (design 2026-09-04 §3.2).
//
// z.string().url() checks a string's SHAPE. A hallucinated but well-formed URL
// passes it today and fails 24 hours later at resolution, by which point the
// question has already run in front of everyone and voids. One GET per
// candidate, no model, catches it the night before for nothing.
//
// feeds.ts already performs keyless HTTP from this Worker, so the pattern
// exists; the fetch is injected so no test ever touches the network.
import type { Candidate, Rejection, Screened } from "../candidate";

export const SOURCE_TIMEOUT_MS = 5000;

export async function checkSources(fetchFn: typeof fetch, candidates: Candidate[]): Promise<Screened> {
  // In parallel and settled, not raced: one unreachable source must never
  // abort the batch, and a rejection here is a normal outcome rather than an
  // error condition.
  const results = await Promise.all(
    candidates.map(async (c): Promise<Rejection | null> => {
      try {
        const res = await fetchFn(c.source_url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
        });
        if (!res.ok) return { text: c.text, reason: "dead-source", detail: `${c.source_url} answered ${res.status}` };
        return null;
      } catch (err) {
        // A timeout is a rejection, not a retry: a source this slow the night
        // before is not a source resolution can lean on tomorrow.
        return { text: c.text, reason: "dead-source", detail: `${c.source_url}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }),
  );

  const passed: Candidate[] = [];
  const rejected: Rejection[] = [];
  results.forEach((r, i) => (r ? rejected.push(r) : passed.push(candidates[i]!)));
  return { passed, rejected };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-sources`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet/sources.ts apps/api/test/gauntlet-sources.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): a named source has to answer before a question can name it

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 7: Tier 2 — the adversarial critic, and the contestedness gate

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/critic.ts`
- Test: `apps/api/test/gauntlet-critic.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `Rejection`, `Screened` from `pipeline/candidate.ts`; `PipelineDeps`.
- Produces: `CONTESTED_MAX_DELTA`, `PROB_DISAGREEMENT_MAX`, `Judged` (`{ candidate, criticProbability }`), `criticize(deps, candidates): Promise<Screened & { judged: Judged[] }>`.

**Two things in one call, on purpose.** The critic's three booleans are validity checks; its `critic_probability` is the independent second opinion `author_probability` never had. Both come out of one Opus call, so the §7 contestedness gate costs nothing extra and is decided here, next to the number it reads.

**The critic must never see `author_probability`.** Not as a matter of prompt wording — structurally, by building the user block from an explicit field list that does not contain it. A critic shown the author's number is anchored to it, and the §7 disagreement check becomes a comparison of a number with itself.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-critic.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { criticize, CONTESTED_MAX_DELTA, PROB_DISAGREEMENT_MAX } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";
import type { PipelineDeps } from "../src/pipeline";

const cand = (o: Partial<Candidate> = {}): Candidate => ({
  category: "news", text: "Will it happen?", resolution_criteria: "per the page",
  source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: "topic-one", ...o,
});

const verdict = (index: number, o: Record<string, unknown> = {}) => ({
  index, readable_two_ways: false, criteria_determine_outcome: true,
  resolves_at_plausible: true, critic_probability: 0.5, reasons: [], ...o,
});

function deps(db: PipelineDeps["db"], reply: unknown, seen: { user?: string } = {}): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => { seen.user = call.user; return reply; } },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}

describe("criticize — tier 2", () => {
  it("never shows the critic the author's own probability", async () => {
    const { db } = await makeTestDb();
    const seen: { user?: string } = {};
    await criticize(deps(db, { verdicts: [verdict(0)] }, seen), [cand({ author_probability: 0.42 })]);
    expect(seen.user).not.toContain("0.42");
    expect(seen.user!.toLowerCase()).not.toContain("author_probability");
  });

  it("passes a candidate the critic finds sound and contested", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.55 })] }), [cand()]);
    expect(r.passed).toHaveLength(1);
    expect(r.judged[0]!.criticProbability).toBe(0.55);
  });

  it("rejects a candidate two careful people could read differently", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { readable_two_ways: true })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects criteria that do not determine the outcome", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { criteria_determine_outcome: false })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects an implausible resolves_at", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { resolves_at_plausible: false })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects an uncontested candidate — the critic's own number outside the band", async () => {
    const { db } = await makeTestDb();
    const outside = 0.5 + CONTESTED_MAX_DELTA + 0.01;
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: outside })] }), [cand()]);
    expect(r.rejected[0]!.reason).toBe("uncontested");
  });

  it("keeps a candidate exactly at the edge of the band", async () => {
    const { db } = await makeTestDb();
    const edge = 0.5 + CONTESTED_MAX_DELTA;
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: edge })] }), [cand({ author_probability: 0.7 })]);
    expect(r.passed).toHaveLength(1);
  });

  it("rejects when the two readings are too far apart, which usually means the sentence is ambiguous", async () => {
    const { db } = await makeTestDb();
    // 0.31 vs 0.69 is 0.38 apart: both inside the contested band, both
    // reasonable on their own, and a gap that says the sentence is not one
    // sentence. This is a DISTINCT failure from either estimate being extreme.
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.69 })] }), [cand({ author_probability: 0.31 })]);
    expect(0.69 - 0.31).toBeGreaterThan(PROB_DISAGREEMENT_MAX);
    expect(r.rejected[0]!.reason).toBe("uncontested");
    expect(r.rejected[0]!.detail).toContain("apart");
  });

  it("rejects every candidate the critic did not return a verdict for", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0)] }), [cand({ text: "A?" }), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?"]);
    expect(r.rejected[0]!.text).toBe("B?");
    expect(r.rejected[0]!.reason).toBe("ambiguous");
  });

  it("rejects the whole batch when the response cannot be parsed — no candidate is judged sound by default", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { nonsense: true }), [cand(), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("makes exactly one model call for the whole set", async () => {
    const { db } = await makeTestDb();
    let calls = 0;
    const d = deps(db, { verdicts: [verdict(0), verdict(1)] });
    d.claude = { structured: async () => { calls++; return { verdicts: [verdict(0), verdict(1)] }; } };
    await criticize(d, [cand({ text: "A?" }), cand({ text: "B?", topic_key: "topic-two" })]);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-critic`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `critic.ts`**

Create `apps/api/src/pipeline/gauntlet/critic.ts`:

```ts
// Tier 2 — the prosecution (design 2026-09-04 §3.2), and the contestedness
// gate that reads its number (§7).
//
// The author advocates for its own draft; this call prosecutes it. Separate
// prompt, separate role, one call for the whole surviving set.
//
// THE CRITIC NEVER SEES author_probability. Not as a matter of prompt wording:
// the user block below is built from an explicit field list that does not
// contain it. A critic shown the author's number anchors to it, and §7's
// disagreement check degenerates into comparing a number with itself.
import { z } from "zod";
import type { PipelineDeps } from "../index";
import type { Candidate, Rejection, Screened } from "../candidate";

// Outside 0.25–0.75. The author's own band is 0.3–0.7; this is the same band,
// verified by someone else, with a little tolerance.
export const CONTESTED_MAX_DELTA = 0.25;
// Two competent models this far apart on one sentence usually means the
// sentence is ambiguous, not that one of them is badly calibrated.
export const PROB_DISAGREEMENT_MAX = 0.3;

export interface Judged { candidate: Candidate; criticProbability: number }

const VerdictSchema = z.object({
  index: z.number().int().min(0),
  readable_two_ways: z.boolean(),
  criteria_determine_outcome: z.boolean(),
  resolves_at_plausible: z.boolean(),
  critic_probability: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([]),
});
const CriticSchema = z.object({ verdicts: z.array(VerdictSchema) });

const criticJsonSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The candidate's index, exactly as given." },
          readable_two_ways: { type: "boolean", description: "Could two careful people reach different answers from the same criteria?" },
          criteria_determine_outcome: { type: "boolean", description: "Do the stated criteria fully determine the outcome?" },
          resolves_at_plausible: { type: "boolean", description: "Is the stated resolution instant credible given what the question asks?" },
          critic_probability: { type: "number", description: "YOUR OWN probability that the answer is YES, 0 to 1." },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["index", "readable_two_ways", "criteria_determine_outcome", "resolves_at_plausible", "critic_probability", "reasons"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const SYSTEM = `You are the adversary. You are shown candidate yes/no questions for a prediction game and your job is to find what is wrong with each one. Someone else wrote them and wants them accepted; you do not.

For every candidate, report:
- readable_two_ways: true if two careful people, given only the question and its resolution criteria, could defensibly reach different answers about the same real-world facts.
- criteria_determine_outcome: true only if the stated criteria fully determine a yes or a no. Vague measurements, missing thresholds and unnamed pages are false.
- resolves_at_plausible: true if the stated resolution instant is credible for what the question asks. A question about a closing price that claims to resolve before the close is not.
- critic_probability: YOUR OWN probability that the answer is YES. Nobody else's number has been shown to you and you must not try to guess one. State what you actually believe.
- reasons: short notes on anything you flagged.

Return exactly one verdict per candidate, carrying that candidate's index unchanged. Call the critic_verdicts tool exactly once.`;

// The explicit field list is the enforcement mechanism, not a convenience:
// author_probability, market_prob and topic_key are absent by construction.
function candidateBlock(candidates: Candidate[]): string {
  return candidates
    .map((c, i) => `[${i}] (${c.category}) ${c.text}\n  CRITERIA: ${c.resolution_criteria}\n  SOURCE: ${c.source_name} <${c.source_url}>\n  RESOLVES AT: ${c.resolves_at}`)
    .join("\n\n");
}

export async function criticize(
  deps: PipelineDeps,
  candidates: Candidate[],
): Promise<Screened & { judged: Judged[] }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  if (candidates.length === 0) return { passed: [], rejected: [], judged: [] };

  const response = await deps.claude.structured({
    model: deps.models.critic,
    system: SYSTEM,
    user: `${candidateBlock(candidates)}\n\nReturn one verdict per candidate now.`,
    schemaName: "critic_verdicts",
    schema: criticJsonSchema,
    // No search. This is a reading of the sentence, not of the world.
  });

  const parsed = CriticSchema.safeParse(response);
  // No verdict is not "sound by default". A gate that passes what it could not
  // read is not a gate — and the night falls through to the bank, which is a
  // mechanism that already exists and is already tested.
  if (!parsed.success) {
    return {
      passed: [],
      judged: [],
      rejected: candidates.map((c) => ({ text: c.text, reason: "ambiguous" as const, detail: "the critic's response could not be read" })),
    };
  }

  const byIndex = new Map(parsed.data.verdicts.map((v) => [v.index, v]));
  const passed: Candidate[] = [];
  const judged: Judged[] = [];
  const rejected: Rejection[] = [];

  candidates.forEach((c, i) => {
    const v = byIndex.get(i);
    if (!v) {
      rejected.push({ text: c.text, reason: "ambiguous", detail: "the critic returned no verdict for this candidate" });
      return;
    }
    if (v.readable_two_ways || !v.criteria_determine_outcome || !v.resolves_at_plausible) {
      const flags = [
        v.readable_two_ways ? "readable two ways" : null,
        v.criteria_determine_outcome ? null : "criteria do not determine the outcome",
        v.resolves_at_plausible ? null : "resolves_at is not plausible",
      ].filter(Boolean);
      rejected.push({ text: c.text, reason: "ambiguous", detail: `${flags.join("; ")}${v.reasons.length ? ` — ${v.reasons.join("; ")}` : ""}` });
      return;
    }

    // §7, decided here beside the number it reads. Two distinct failures:
    if (Math.abs(v.critic_probability - 0.5) > CONTESTED_MAX_DELTA) {
      rejected.push({ text: c.text, reason: "uncontested", detail: `critic reads it at ${v.critic_probability}, outside the contested band` });
      return;
    }
    const gap = Math.abs(c.author_probability - v.critic_probability);
    if (gap > PROB_DISAGREEMENT_MAX) {
      rejected.push({ text: c.text, reason: "uncontested", detail: `author and critic are ${gap.toFixed(2)} apart, which usually means the sentence is` });
      return;
    }

    passed.push(c);
    judged.push({ candidate: c, criticProbability: v.critic_probability });
  });

  return { passed, rejected, judged };
}
```

Note the `detail` string on the disagreement branch ends in "which usually means the sentence is" — finish that sentence in the implementation as `... apart, which usually means the sentence is ambiguous`. The test asserts only that the detail contains `"apart"`.

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-critic`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet/critic.ts apps/api/test/gauntlet-critic.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): something prosecutes the draft, and states a number of its own

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 8: Tier 3 — the pre-flight, inverted

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/preflight.ts`
- Test: `apps/api/test/gauntlet-preflight.test.ts`

**Interfaces:**
- Consumes: `askResolver`, `settled` from `pipeline/resolver.ts` (Task 3); `Judged` from `pipeline/gauntlet/critic.ts`; `Rejection` from `pipeline/candidate.ts`.
- Produces: `preflight(deps, judged: Judged[]): Promise<{ passed: Judged[]; rejected: Rejection[] }>`.

**The inversion is the whole idea, and it is the tripwire of the gauntlet.** Run the resolver against the candidate *tonight*, against its own named source, and read the answer backwards:

| Pre-flight result | Verdict |
|---|---|
| `yes` / `no` with quotes | **reject** — the answer already exists; this was never a prediction |
| `unverifiable` | **pass** — the answer does not exist yet, which is the requirement |

**A limit that must be stated in the code, not discovered later:** the resolver is domain-restricted to the source's own hostname, so a pre-flight `unverifiable` proves *the named source does not show it yet* — not that no source does. A question already answered on a wire service but not yet on the named source will pass. That is the right scope, because resolution will read only that source too, but the guarantee is "not answerable from the source we will judge it by", not "not knowable anywhere".

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-preflight.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { preflight } from "../src/pipeline/gauntlet/preflight";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";
import type { PipelineDeps } from "../src/pipeline";

const cand = (text: string, key: string): Candidate => ({
  category: "news", text, resolution_criteria: "per the page",
  source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: key,
});
const judged = (text: string, key: string): Judged => ({ candidate: cand(text, key), criticProbability: 0.5 });

function deps(db: PipelineDeps["db"], reply: (user: string) => unknown): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => reply(call.user) },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}

const UNVERIFIABLE = { outcome: "unverifiable", quotes: [], reasoning: "not yet" };
const ANSWERED = { outcome: "yes", quotes: [{ url: "https://example.com/x", quote: "it happened" }], reasoning: "done" };

describe("preflight — tier 3, the inversion", () => {
  it("passes a candidate the resolver CANNOT answer, which is the requirement", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => UNVERIFIABLE), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  // THE TRIPWIRE. If this test can be made to pass while the fake resolver
  // answers YES, the inversion has been implemented backwards and every
  // already-answered question in the world is eligible for tomorrow's round.
  it("REJECTS a candidate the resolver can already answer — it was never a prediction", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => ANSWERED), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("already-resolvable");
    expect(r.rejected[0]!.detail).toContain("yes");
  });

  it("passes a ruling that arrived with no receipts — a resolver that cannot quote has not answered", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(deps(db, () => ({ outcome: "yes", quotes: [], reasoning: "vibes" })), [judged("Will it?", "k1")]);
    expect(r.passed).toHaveLength(1);
  });

  it("judges each candidate on its own call", async () => {
    const { db } = await makeTestDb();
    const r = await preflight(
      deps(db, (user) => (user.includes("A?") ? ANSWERED : UNVERIFIABLE)),
      [judged("A?", "k1"), judged("B?", "k2")],
    );
    expect(r.passed.map((j) => j.candidate.text)).toEqual(["B?"]);
    expect(r.rejected.map((x) => x.text)).toEqual(["A?"]);
  });

  it("carries the critic's probability through untouched", async () => {
    const { db } = await makeTestDb();
    const j: Judged = { candidate: cand("Will it?", "k1"), criticProbability: 0.43 };
    const r = await preflight(deps(db, () => UNVERIFIABLE), [j]);
    expect(r.passed[0]!.criticProbability).toBe(0.43);
  });

  it("uses the preflight model, not the resolution model", async () => {
    const { db } = await makeTestDb();
    let model = "";
    const d = deps(db, () => UNVERIFIABLE);
    d.claude = { structured: async (call) => { model = call.model; return UNVERIFIABLE; } };
    await preflight(d, [judged("Will it?", "k1")]);
    expect(model).toBe("m-p");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-preflight`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `preflight.ts`**

Create `apps/api/src/pipeline/gauntlet/preflight.ts`:

```ts
// Tier 3 — the pre-flight resolve, pointed backwards (design 2026-09-04 §3.2).
//
// This is the check that makes the anti-leak guarantee REAL instead of
// self-reported. `resolves_at` is a claim the author makes about its own draft
// and nothing has ever verified it; here the pipeline's own resolver is turned
// on the candidate tonight, against its own named source, and the meaning of
// the answer is inverted:
//
//   yes / no WITH quotes  -> REJECT. The answer already exists. This was never
//                            a prediction; it is a lookup with a countdown.
//   unverifiable          -> PASS. The answer does not exist yet, which is the
//                            entire requirement.
//
// A LIMIT, STATED HERE RATHER THAN DISCOVERED LATER: askResolver restricts the
// search to the source's own hostname, so an `unverifiable` proves THE NAMED
// SOURCE does not show it yet — not that no source does. A question already
// answered on a wire service but not yet on the named source will pass. That
// is the right scope, because resolution will read only that source too, but
// the guarantee is "not answerable from the source we will judge it by", never
// "not knowable anywhere". If leak telemetry ever shows questions arriving
// pre-answered from elsewhere, widening this search is the lever.
import type { PipelineDeps } from "../index";
import type { Rejection } from "../candidate";
import type { Judged } from "./critic";
import { askResolver, settled } from "../resolver";

export async function preflight(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  const passed: Judged[] = [];
  const rejected: Rejection[] = [];

  // One call per survivor, in parallel: they are independent, and this is the
  // slowest tier in the gauntlet.
  const verdicts = await Promise.all(
    judged.map((j) =>
      askResolver(deps, deps.models.preflight, {
        text: j.candidate.text,
        resolutionCriteria: j.candidate.resolution_criteria,
        sourceName: j.candidate.source_name,
        sourceUrl: j.candidate.source_url,
      }),
    ),
  );

  verdicts.forEach((v, i) => {
    const j = judged[i]!;
    const answer = settled(v);
    if (answer === null) {
      passed.push(j);
      return;
    }
    rejected.push({
      text: j.candidate.text,
      reason: "already-resolvable",
      detail: `${j.candidate.source_name} already answers this: ${answer}`,
    });
  });

  return { passed, rejected };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-preflight`
Expected: PASS.

- [ ] **Step 5: Prove the tripwire rings**

Temporarily invert the branch (`if (answer !== null) { passed.push(j); return; }`) and re-run. The test named *"REJECTS a candidate the resolver can already answer"* must **fail**. Restore the correct branch, re-run, confirm PASS. Report in your task report that you did this and what the failure said.

- [ ] **Step 6: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet/preflight.ts apps/api/test/gauntlet-preflight.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): every question is put to the machine before it is put to anyone

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 9: Tier 4 — the taste gate, fail-closed

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/taste.ts`
- Test: `apps/api/test/gauntlet-taste.test.ts`

**Interfaces:**
- Consumes: `Judged` from `pipeline/gauntlet/critic.ts`; `Rejection` from `pipeline/candidate.ts`; `PipelineDeps`.
- Produces: `tasteCheck(deps, judged: Judged[]): Promise<{ passed: Judged[]; rejected: Rejection[] }>`.

**Why this gate is different from every other one.** The forbidden list — deaths, disasters or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm — lives today as a clause in the authoring prompt, checked by nothing. With no human reading questions before they go live, one tasteless question reaching every player is the largest brand and App Review risk in the system, and it would be guarded by the same class of component that generates the risk.

So it gets its own narrow call, its own model, and one rule the other gates do not have: **if the call errors, times out, or returns unparseable output, every candidate in the batch is rejected.** Every other gate may fail open on infrastructure trouble; a taste check that fails open is not a taste check. The cost of failing closed is a night that falls through to the evergreen bank, which is a mechanism that already exists and is already tested.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-taste.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { tasteCheck } from "../src/pipeline/gauntlet/taste";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { PipelineDeps } from "../src/pipeline";

const judged = (text: string, key: string): Judged => ({
  candidate: {
    category: "news", text, resolution_criteria: "per the page", source_name: "SRC",
    source_url: "https://example.com/x", author_probability: 0.5, market_prob: null,
    resolves_at: "2026-09-05T14:00:00Z", topic_key: key,
  },
  criticProbability: 0.5,
});

function deps(db: PipelineDeps["db"], structured: PipelineDeps["claude"]): PipelineDeps {
  return {
    db,
    telegram: { send: async () => {} },
    claude: structured,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
  };
}
const reply = (r: unknown): PipelineDeps["claude"] => ({ structured: async () => r });

const batch = [judged("A?", "k1"), judged("B?", "k2")];

describe("tasteCheck — tier 4", () => {
  it("passes candidates the gate allows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.passed).toHaveLength(2);
    expect(r.rejected).toHaveLength(0);
  });

  it("removes only the candidate it disallows", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: false, reason: "a named person's medical outcome" }, { index: 1, allowed: true, reason: "" }] })), batch);
    expect(r.passed.map((j) => j.candidate.text)).toEqual(["B?"]);
    expect(r.rejected[0]!.reason).toBe("taste");
    expect(r.rejected[0]!.detail).toContain("medical");
  });

  // FAIL-CLOSED, one test per failure mode. A fail-closed gate that has only
  // been tested on the success path is not known to be fail-closed.
  it("rejects the WHOLE batch when the call throws", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, { structured: async () => { throw new Error("boom"); } }), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected.every((x) => x.reason === "taste")).toBe(true);
  });

  it("rejects the WHOLE batch when the call times out", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, { structured: async () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); } }), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("rejects the WHOLE batch when the output cannot be parsed", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: "not an array" })), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("rejects the WHOLE batch when a verdict is missing — a silent gap is a failure, not a pass", async () => {
    const { db } = await makeTestDb();
    const r = await tasteCheck(deps(db, reply({ verdicts: [{ index: 0, allowed: true, reason: "" }] })), batch);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(2);
  });

  it("returns an empty result for an empty batch without calling the model", async () => {
    const { db } = await makeTestDb();
    let called = false;
    const r = await tasteCheck(deps(db, { structured: async () => { called = true; return {}; } }), []);
    expect(called).toBe(false);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });

  it("asks for no web search — this is classification, not research", async () => {
    const { db } = await makeTestDb();
    let sawSearch: unknown = "unset";
    const d = deps(db, { structured: async (call) => { sawSearch = call.webSearch; return { verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: true, reason: "" }] }; } });
    await tasteCheck(d, batch);
    expect(sawSearch).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-taste`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `taste.ts`**

Create `apps/api/src/pipeline/gauntlet/taste.ts`:

```ts
// Tier 4 — taste, and the only fail-closed gate in this design
// (design 2026-09-04 §8).
//
// The forbidden list lives today as a clause in the AUTHORING prompt, checked
// by nothing. With no human reading questions before they go live, one
// tasteless question reaching every player is the largest brand and App Review
// risk in the system — and it would be guarded by the same class of component
// that generates it.
//
// FAIL-CLOSED. An error, a timeout, or unparseable output rejects EVERY
// candidate in the batch. Every other gate here may fail open on infrastructure
// trouble; a taste check that fails open is not a taste check. The cost of
// failing closed is a night that falls through to the evergreen bank — a
// mechanism that already exists and is already tested.
//
// It runs LAST, on the small set that survived everything else, so the
// fail-closed blast radius is as small as it can be.
import { z } from "zod";
import type { PipelineDeps } from "../index";
import type { Rejection } from "../candidate";
import type { Judged } from "./critic";

const TasteSchema = z.object({
  verdicts: z.array(z.object({ index: z.number().int().min(0), allowed: z.boolean(), reason: z.string().default("") })),
});

const tasteJsonSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The candidate's index, exactly as given." },
          allowed: { type: "boolean" },
          reason: { type: "string", description: "Which rule it breaks. Empty when allowed." },
        },
        required: ["index", "allowed", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const SYSTEM = `You screen candidate questions for a daily prediction game. For each candidate, decide whether it is acceptable to put in front of every player.

Set allowed to false if the question does any of these:
- treats a death, a disaster or a tragedy as the thing being bet on
- concerns a private individual rather than a public figure
- concerns the medical outcome of a named person
- is derogatory about any person or group
- rewards a player for hoping that harm comes to someone

A public figure's professional outcome — an election, a resignation, a contract, a result — is acceptable. Ordinary markets, sports, weather and culture questions are acceptable.

Return exactly one verdict per candidate, carrying that candidate's index unchanged. Call the taste_verdicts tool exactly once.`;

function rejectAll(judged: Judged[], detail: string): { passed: Judged[]; rejected: Rejection[] } {
  return { passed: [], rejected: judged.map((j) => ({ text: j.candidate.text, reason: "taste" as const, detail })) };
}

export async function tasteCheck(
  deps: PipelineDeps,
  judged: Judged[],
): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  if (judged.length === 0) return { passed: [], rejected: [] };

  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: deps.models.taste,
      system: SYSTEM,
      user: `${judged.map((j, i) => `[${i}] ${j.candidate.text}`).join("\n")}\n\nReturn one verdict per candidate now.`,
      schemaName: "taste_verdicts",
      schema: tasteJsonSchema,
      // No webSearch. Classification, not research.
    });
  } catch (err) {
    return rejectAll(judged, `the taste gate could not be reached, so the batch was refused: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = TasteSchema.safeParse(response);
  if (!parsed.success) return rejectAll(judged, "the taste gate's response could not be read, so the batch was refused");

  const byIndex = new Map(parsed.data.verdicts.map((v) => [v.index, v]));
  // A missing verdict is a failed check, not a pass. Anything less would make
  // the gate's coverage depend on the model remembering to answer.
  if (judged.some((_, i) => !byIndex.has(i))) {
    return rejectAll(judged, "the taste gate did not judge every candidate, so the batch was refused");
  }

  const passed: Judged[] = [];
  const rejected: Rejection[] = [];
  judged.forEach((j, i) => {
    const v = byIndex.get(i)!;
    if (v.allowed) passed.push(j);
    else rejected.push({ text: j.candidate.text, reason: "taste", detail: v.reason || "refused by the taste gate" });
  });
  return { passed, rejected };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-taste`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet/taste.ts apps/api/test/gauntlet-taste.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): the one gate that refuses the batch rather than fail open

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 10: Selection — five questions out of the survivors

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/select.ts`
- Test: `apps/api/test/gauntlet-select.test.ts`

**Interfaces:**
- Consumes: `Judged` from `pipeline/gauntlet/critic.ts`; `Draft`/`DraftSchema` from `pipeline/draft.ts`.
- Produces: `MIN_DISTINCT_CATEGORIES`, `RELAXED_DISTINCT_CATEGORIES`, `Selection` (`{ draft: Draft; relaxed: boolean }`), `selectRound(judged: Judged[]): Selection | null`.

**The rules, from spec §4:** five questions, slots 1–5, the Big One at slot 5, at least four distinct categories. Ranking among survivors is *most contested first* — `|critic_probability − 0.5|` ascending — then category spread. The Big One is the most contested survivor, which is the definition `2026-08-27` already gives it.

**When fewer than five survive the constraints:** relax the category rule to three distinct and record that the round ran relaxed. If that still does not yield a round, return `null` — the caller falls through to the evergreen bank. **Relaxation applies to composition rules only, never to integrity gates.** There is no path here in which a candidate that failed a gate is published because nothing better was available.

This function is **pure** — no I/O, no deps — so the composition rules are testable without a database.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-select.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectRound } from "../src/pipeline/gauntlet/select";
import { DraftSchema } from "../src/pipeline/draft";
import type { Judged } from "../src/pipeline/gauntlet/critic";
import type { Candidate } from "../src/pipeline/candidate";

const j = (category: Candidate["category"], p: number, n: number): Judged => ({
  candidate: {
    category, text: `Will thing ${n} happen?`, resolution_criteria: "per the page",
    source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5,
    market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: `topic-${n}`,
  },
  criticProbability: p,
});

const five = [j("markets", 0.62, 1), j("sports", 0.40, 2), j("weather", 0.58, 3), j("culture", 0.35, 4), j("news", 0.50, 5)];

describe("selectRound", () => {
  it("produces a draft that DraftSchema accepts", () => {
    const s = selectRound(five)!;
    expect(DraftSchema.safeParse(s.draft).success).toBe(true);
  });

  it("fills slots 1..5 with exactly one big one, at slot 5", () => {
    const s = selectRound(five)!;
    expect(s.draft.questions.map((q) => q.slot).sort()).toEqual([1, 2, 3, 4, 5]);
    const big = s.draft.questions.filter((q) => q.is_big_one);
    expect(big).toHaveLength(1);
    expect(big[0]!.slot).toBe(5);
  });

  it("gives slot 5 to the MOST contested survivor", () => {
    const s = selectRound(five)!;
    // 0.50 is nearest 0.5, so "Will thing 5 happen?" is the big one.
    expect(s.draft.questions.find((q) => q.slot === 5)!.text).toContain("thing 5");
  });

  it("carries topic_key through onto the draft, so the dedupe has something to read next week", () => {
    const s = selectRound(five)!;
    expect(s.draft.questions.every((q) => typeof q.topic_key === "string" && q.topic_key!.length > 0)).toBe(true);
  });

  it("runs unrelaxed when four distinct categories are available", () => {
    const s = selectRound(five)!;
    expect(s.relaxed).toBe(false);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("prefers spread over contest when both are possible", () => {
    // Six survivors, three of them markets. The three most contested are ALL
    // markets, so a naive top-five would produce three categories; the greedy
    // one-per-category pass must reach four.
    const pool = [
      j("markets", 0.50, 1), j("markets", 0.51, 2), j("markets", 0.52, 3),
      j("sports", 0.30, 4), j("news", 0.70, 5), j("culture", 0.72, 6),
    ];
    const s = selectRound(pool)!;
    expect(s.relaxed).toBe(false);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBeGreaterThanOrEqual(4);
  });

  it("relaxes to three distinct categories rather than dropping the round", () => {
    const pool = [j("markets", 0.50, 1), j("markets", 0.52, 2), j("markets", 0.55, 3), j("sports", 0.45, 4), j("news", 0.60, 5)];
    const s = selectRound(pool)!;
    expect(s.relaxed).toBe(true);
    expect(new Set(s.draft.questions.map((q) => q.category)).size).toBe(3);
    expect(DraftSchema.safeParse(s.draft).success).toBe(false); // four distinct is DraftSchema's rule
  });

  it("returns null below five survivors — no round is better than a bad one", () => {
    expect(selectRound(five.slice(0, 4))).toBeNull();
    expect(selectRound([])).toBeNull();
  });

  it("returns null when even three distinct categories are impossible", () => {
    const pool = [j("markets", 0.50, 1), j("markets", 0.51, 2), j("markets", 0.52, 3), j("sports", 0.45, 4), j("sports", 0.46, 5)];
    expect(selectRound(pool)).toBeNull();
  });

  it("is pure — the same input twice gives the same round", () => {
    expect(JSON.stringify(selectRound(five))).toBe(JSON.stringify(selectRound(five)));
  });
});
```

Note the relaxed case deliberately asserts `DraftSchema.safeParse(...).success === false`: `DraftSchema` encodes the four-category rule, so a relaxed round cannot satisfy it. Task 11 must therefore call `upsertDraft` on a relaxed round **without** re-validating through `DraftSchema` — see that task's step on the relaxed path.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-select`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `select.ts`**

Create `apps/api/src/pipeline/gauntlet/select.ts`:

```ts
// Selection (design 2026-09-04 §4): five questions out of whatever survived
// the gauntlet.
//
// Pure — no deps, no I/O — so the composition rules are testable without a
// database, and so that "what shape is a round" stays one readable function.
//
// RELAXATION APPLIES TO COMPOSITION ONLY. Four distinct categories is an
// interest heuristic; five valid questions matter more than the spread. There
// is no path in this file by which a candidate that failed an integrity gate
// is published because nothing better was available — this function never sees
// a rejected candidate at all.
import type { Draft } from "../draft";
import type { Judged } from "./critic";

export const MIN_DISTINCT_CATEGORIES = 4;
export const RELAXED_DISTINCT_CATEGORIES = 3;
const ROUND_SIZE = 5;

export interface Selection { draft: Draft; relaxed: boolean }

// Most contested first. The Big One is the most contested survivor, which is
// the definition 2026-08-27 already gives it.
const byContest = (a: Judged, b: Judged) =>
  Math.abs(a.criticProbability - 0.5) - Math.abs(b.criticProbability - 0.5);

// Greedy spread: walk the contest-ranked list taking the most contested
// candidate of each category first, then fill the remaining slots from what is
// left, still in contest order. This is what makes "prefer spread over contest
// when both are possible" true without a search.
function pickFive(ranked: Judged[]): Judged[] | null {
  if (ranked.length < ROUND_SIZE) return null;
  const chosen: Judged[] = [];
  const usedCategories = new Set<string>();
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (usedCategories.has(j.candidate.category)) continue;
    chosen.push(j);
    usedCategories.add(j.candidate.category);
  }
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (chosen.includes(j)) continue;
    chosen.push(j);
  }
  return chosen.length === ROUND_SIZE ? chosen : null;
}

function toDraft(chosen: Judged[]): Draft {
  // Slot 5 is the most contested of the five; slots 1-4 take the rest in
  // contest order, which puts the day's sharpest questions earliest.
  const ranked = [...chosen].sort(byContest);
  const big = ranked[0]!;
  const rest = ranked.slice(1);
  const question = (j: Judged, slot: number) => ({
    slot,
    category: j.candidate.category,
    text: j.candidate.text,
    resolution_criteria: j.candidate.resolution_criteria,
    source_name: j.candidate.source_name,
    source_url: j.candidate.source_url,
    author_probability: j.candidate.author_probability,
    is_big_one: slot === ROUND_SIZE,
    market_prob: j.candidate.market_prob,
    resolves_at: j.candidate.resolves_at,
    topic_key: j.candidate.topic_key,
  });
  return { questions: [...rest.map((j, i) => question(j, i + 1)), question(big, ROUND_SIZE)] };
}

export function selectRound(judged: Judged[]): Selection | null {
  const ranked = [...judged].sort(byContest);
  const chosen = pickFive(ranked);
  if (!chosen) return null;

  const distinct = new Set(chosen.map((j) => j.candidate.category)).size;
  if (distinct >= MIN_DISTINCT_CATEGORIES) return { draft: toDraft(chosen), relaxed: false };
  if (distinct >= RELAXED_DISTINCT_CATEGORIES) return { draft: toDraft(chosen), relaxed: true };
  return null;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-select`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet/select.ts apps/api/test/gauntlet-select.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): the round is chosen from survivors, and says when it ran relaxed

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 11: Generating the surplus, and running the gauntlet end to end

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/generate.ts`
- Create: `apps/api/src/pipeline/gauntlet/index.ts`
- Test: `apps/api/test/gauntlet-run.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–10, plus `upsertDraft`/`lockFromResolvesAt` from `pipeline/draft.ts`, `noonET`/`addDays` from `pipeline/clock.ts`, `fetchMarketSignals` from `pipeline/feeds.ts`, `loadQualityRows`/`qualityReport`/`questionQuality` from `pipeline/quality.ts`.
- Produces: `CANDIDATE_TARGET`/`CANDIDATE_MIN`/`CANDIDATE_MAX`, `generateCandidates(deps, date): Promise<unknown[]>`, `GauntletResult`, `runAuthoringGauntlet(deps, date): Promise<GauntletResult>`.

**Order of the tiers, and why.** 0 (free) → 1 (one HTTP GET each) → 2 (one model call, and the §7 gate decided from its number) → 3 (one model call *per survivor*, the most expensive tier) → 4 (taste, last and fail-closed) → selection. Running the contestedness gate before the pre-flight is what keeps the expensive tier from being spent on candidates that were never going to survive.

**Cold start must not be a failure mode.** The first live day has no history digest, no author scorecard, no market signals if feeds are down, and an empty bank. `recentQuestionDigest` already returns `"(no history yet)"`; `recentTopicKeys` returns an empty set; the gauntlet must not reject on absent history, and a `null` selection must return a result rather than throw so the caller can fall through to the bank.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/gauntlet-run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { runAuthoringGauntlet } from "../src/pipeline/gauntlet";
import type { PipelineDeps } from "../src/pipeline";

// One fake Claude that answers each schemaName in turn. Every tier's contract
// is exercised through the real orchestration; nothing is stubbed past it.
function fakeClaude(over: Partial<Record<string, unknown>> = {}) {
  const candidates = [1, 2, 3, 4, 5, 6].map((n) => ({
    category: (["markets", "sports", "weather", "culture", "news", "markets"] as const)[n - 1],
    text: `Will thing ${n} happen?`,
    resolution_criteria: "The official number on the source's own page",
    source_name: "SRC",
    source_url: `https://example.com/${n}`,
    author_probability: 0.5,
    market_prob: null,
    resolves_at: "2026-09-06T14:00:00Z",
    topic_key: `topic-${n}`,
  }));
  const defaults: Record<string, unknown> = {
    candidate_round: { candidates },
    critic_verdicts: { verdicts: candidates.map((_, i) => ({ index: i, readable_two_ways: false, criteria_determine_outcome: true, resolves_at_plausible: true, critic_probability: 0.5 + i * 0.01, reasons: [] })) },
    resolution: { outcome: "unverifiable", quotes: [], reasoning: "not yet" },
    taste_verdicts: { verdicts: candidates.map((_, i) => ({ index: i, allowed: true, reason: "" })) },
  };
  const table = { ...defaults, ...over };
  return {
    structured: async (call: { schemaName: string }) => {
      const r = table[call.schemaName];
      if (r === undefined) throw new Error(`unexpected schemaName ${call.schemaName}`);
      if (typeof r === "function") return (r as () => unknown)();
      return r;
    },
  };
}

function deps(db: PipelineDeps["db"], claude: PipelineDeps["claude"], sent: string[] = []): PipelineDeps {
  return {
    db,
    telegram: { send: async (t) => void sent.push(t) },
    claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date("2026-09-04T22:00:00Z"),
    marketFetch: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch,
    sourceFetch: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
  };
}

describe("runAuthoringGauntlet", () => {
  it("publishes a scheduled round and records what it cost", async () => {
    const { db } = await makeTestDb();
    const sent: string[] = [];
    const r = await runAuthoringGauntlet(deps(db, fakeClaude(), sent), "2026-09-05");
    expect(r.published).toBe(true);
    expect(r.written).toBe(6);
    expect(r.rejected).toBe(0);

    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round!.status).toBe("scheduled");
    expect(round!.candidatesWritten).toBe(6);
    expect(round!.candidatesRejected).toBe(0);

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-05") });
    expect(qs).toHaveLength(5);
    expect(qs.every((q) => q.topicKey !== null)).toBe(true);
    expect(sent.join("\n")).toContain("6 candidates");
  });

  it("counts a dead source as a rejection and still ships the round", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, fakeClaude());
    d.sourceFetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/6") ? new Response("", { status: 404 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(true);
    expect(r.rejected).toBe(1);
    expect(r.tally["dead-source"]).toBe(1);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round!.candidatesRejected).toBe(1);
  });

  it("REJECTS a candidate the pre-flight can already answer", async () => {
    const { db } = await makeTestDb();
    // Every pre-flight now answers YES with receipts: nothing survives.
    const r = await runAuthoringGauntlet(
      deps(db, fakeClaude({ resolution: { outcome: "yes", quotes: [{ url: "https://example.com/1", quote: "it happened" }], reasoning: "done" } })),
      "2026-09-05",
    );
    expect(r.published).toBe(false);
    expect(r.tally["already-resolvable"]).toBe(6);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round).toBeUndefined();
  });

  it("refuses the whole night when the taste gate fails, leaving noon to the bank", async () => {
    const { db } = await makeTestDb();
    const r = await runAuthoringGauntlet(
      deps(db, fakeClaude({ taste_verdicts: () => { throw new Error("taste is down"); } })),
      "2026-09-05",
    );
    expect(r.published).toBe(false);
    expect(r.tally.taste).toBe(6);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-05") });
    expect(round).toBeUndefined();
  });

  it("never publishes a candidate that failed a gate, even when the round would otherwise be short", async () => {
    const { db } = await makeTestDb();
    // Five ambiguous, one sound: four survivors is not a round, and the one
    // sound candidate must not be joined by any of the five.
    const d = deps(db, fakeClaude({
      critic_verdicts: { verdicts: [0, 1, 2, 3, 4, 5].map((i) => ({ index: i, readable_two_ways: i > 0, criteria_determine_outcome: true, resolves_at_plausible: true, critic_probability: 0.5, reasons: [] })) },
    }));
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(false);
    expect(r.tally.ambiguous).toBe(5);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-09-05") });
    expect(qs).toHaveLength(0);
  });

  it("survives a cold start: no history, no market signals, an empty database", async () => {
    const { db } = await makeTestDb();
    const d = deps(db, fakeClaude());
    d.marketFetch = (async () => { throw new Error("feeds are down"); }) as unknown as typeof fetch;
    const r = await runAuthoringGauntlet(d, "2026-09-05");
    expect(r.published).toBe(true);
  });

  it("narrates what it threw away, by reason", async () => {
    const { db } = await makeTestDb();
    const sent: string[] = [];
    const d = deps(db, fakeClaude(), sent);
    d.sourceFetch = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/6") ? new Response("", { status: 404 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    await runAuthoringGauntlet(d, "2026-09-05");
    const msg = sent.join("\n");
    expect(msg).toContain("rejected:");
    expect(msg).toContain("dead-source");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @oracle/api test -- gauntlet-run`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `generate.ts`**

Create `apps/api/src/pipeline/gauntlet/generate.ts`:

```ts
// Candidate authoring (design 2026-09-04 §3.1): surplus, not exactly enough.
//
// A gauntlet that cannot afford to reject is not a gauntlet, and generating
// exactly five makes every rejection a serial re-authoring round-trip against
// a six-hour window. Candidates are NOT slotted here: slot, the Big One and
// the category spread are selection constraints applied to survivors, so that
// a rejection in one category is substituted rather than re-authored.
import type { PipelineDeps } from "../index";
import { addDays } from "../clock";
import { fetchMarketSignals, type MarketSignal } from "../feeds";
import { loadQualityRows, qualityReport, questionQuality } from "../quality";
import { recentQuestionDigest } from "../author";

export const CANDIDATE_MIN = 12;
export const CANDIDATE_TARGET = 14;
export const CANDIDATE_MAX = 15;

const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;

const candidateProperties = {
  category: { type: "string", enum: [...CATEGORIES] },
  text: { type: "string", minLength: 10 },
  resolution_criteria: { type: "string", minLength: 10 },
  source_name: { type: "string", minLength: 1 },
  source_url: { type: "string", format: "uri" },
  author_probability: { type: "number", minimum: 0.3, maximum: 0.7 },
  market_prob: { type: ["number", "null"], minimum: 0, maximum: 1 },
  resolves_at: {
    type: "string",
    description:
      'ISO-8601 UTC instant at which this outcome first becomes publicly determinable from the named source, or the literal "after-lock" when nothing about it is knowable before the round locks.',
  },
  topic_key: {
    type: "string",
    description:
      'A normalized, lower-case, hyphenated subject key for what this question is ABOUT, never its wording: "btc-close-above-threshold", not "will-btc-close-above-70000-on-friday". Two questions about the same underlying subject must share a key even when their numbers differ.',
  },
};

const candidateSetJsonSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: candidateProperties,
        required: Object.keys(candidateProperties),
        additionalProperties: false,
      },
      minItems: CANDIDATE_MIN,
      maxItems: CANDIDATE_MAX,
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

function marketSignalsBlock(signals: MarketSignal[]): string {
  if (signals.length === 0) return "";
  const lines = signals.map(
    (s) => `- [${s.source}] "${s.question}" — ${Math.round(s.prob * 100)}% YES — closes ${s.closesAt}`,
  );
  return `
LIVE MARKET SIGNALS — real prediction markets closing within 36 hours. These are contested by actual bettors:
${lines.join("\n")}
- Prefer adapting market-backed candidates where they fit. When a candidate is adapted from a listed market, set market_prob to that market's probability (0-1); otherwise set market_prob to null.
- NEVER cite a prediction market as the resolution source — resolution always names a primary public source.
- A candidate adapted from a listed market MUST set resolves_at to that market's own close: the price is public and converges on the answer, so answers have to close with it.`;
}

function systemPrompt(date: string, recent: string, signals: MarketSignal[], scorecard: string): string {
  const lockDay = addDays(date, 1);
  return `You author CANDIDATE questions for ORACLE, a prediction game. Produce ${CANDIDATE_TARGET} yes/no candidates for the round dated ${date} (ET). The round opens at noon ET on ${date} and closes at noon ET on ${lockDay}.

You are writing a SURPLUS on purpose. Every candidate you write is put through a gauntlet — an adversarial reader, a source check, and a resolver that tries to answer it tonight — and most nights several are thrown away. Do not write five careful questions; write ${CANDIDATE_TARGET} you would defend, and let the gauntlet choose. Do not assign slots, do not nominate a big one, and do not try to balance the categories: something else does all three from whatever survives.

Rules for every candidate:
- Binary YES/NO in plain English, resolvable from ONE named public source.
- ONE CLAUSE. Never join two conditions with "and" or "or" — a compound question is the classic way for two careful readers to reach different answers, and it will be thrown out.
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. Set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. A resolver will be run against your named source TONIGHT, and any candidate it can already answer is rejected. If nothing about the outcome is determinable before noon ET on ${lockDay}, set resolves_at to "after-lock".
- Prefer questions whose resolves_at lands inside the round's own window and comfortably before noon ET on ${lockDay}, so the named source has actually published before the ledger is read at 12:10 ET on ${lockDay}.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. An independent reader will state its own probability without seeing yours, and a candidate the two of you read very differently is rejected as ambiguous.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically.
- source_url must be a real, reachable page. Every URL is fetched before the round is chosen, and one that does not answer is rejected.
- topic_key is the SUBJECT, not the wording. A key used in the last seven days is rejected, so do not re-ask last week's question with a new number.
- WEATHER: the measurement period must begin after the round opens and its end must fall before noon ET on ${lockDay}. Set resolves_at to the end of the measurement period. Weather may never use "after-lock".
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine. A separate screen refuses these, and a refusal there costs the whole night.
- Here is your own record in aggregate. It is the standard you are held to.
${scorecard}
- Here is how your last seven days landed. Do not repeat them, and read the outcomes and crowd splits as feedback on your own question-writing: ${recent}${marketSignalsBlock(signals)}
Search the web for today's actual news before writing. When your candidates are final, call the candidate_round tool exactly once.`;
}

export async function generateCandidates(deps: PipelineDeps, date: string): Promise<unknown[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const recent = await recentQuestionDigest(deps.db, date);
  // Market feeds are advisory: any failure logs inside fetchMarketSignals and
  // authoring proceeds market-blind on an empty list. Cold start reaches here
  // with no history and no signals and must still produce a round.
  const { signals } = await fetchMarketSignals(deps.marketFetch ?? fetch, deps.now());
  const scorecard = qualityReport(questionQuality(await loadQualityRows(deps.db, date))).join("\n  ");

  const response = await deps.claude.structured({
    model: deps.models.author,
    system: systemPrompt(date, recent, signals, scorecard),
    user: `Produce ${CANDIDATE_TARGET} candidate questions for ${date} now.`,
    schemaName: "candidate_round",
    schema: candidateSetJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const list = (response as { candidates?: unknown }).candidates;
  // No retry loop here, unlike authorRound: the gauntlet's whole design is that
  // bad candidates are THROWN AWAY rather than corrected, and a malformed
  // response is simply a night with no candidates, which falls to the bank.
  return Array.isArray(list) ? list : [];
}
```

`recentQuestionDigest` is currently module-private in `apps/api/src/pipeline/author.ts`. Export it (`export async function recentQuestionDigest`) — it is the same digest, and duplicating it would let the two drift.

- [ ] **Step 4: Write the orchestration**

Create `apps/api/src/pipeline/gauntlet/index.ts`:

```ts
// The gauntlet, end to end (design 2026-09-04 §3, §4, §9.2).
//
// ORDER IS LOAD-BEARING, cheapest first:
//   0 structural   free
//   1 sources      one HTTP GET each, no model
//   2 critic       ONE model call for the whole set — and §7's contestedness
//                  gate, decided from the number that call already produced
//   3 pre-flight   one model call PER SURVIVOR — the most expensive tier, so
//                  it runs after §7 has already thinned the set
//   4 taste        last, and fail-closed, so its blast radius is smallest
//   then selection
//
// Nothing here can promote a rejected candidate. Each tier hands the next its
// survivors and its rejections separately, and the rejected list is only ever
// counted.
import { eq } from "drizzle-orm";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { addDays, noonET } from "../clock";
import { upsertDraft } from "../draft";
import { emptyTally, recentTopicKeys, screenCandidates, type RejectReason, type Rejection } from "../candidate";
import { generateCandidates } from "./generate";
import { checkSources } from "./sources";
import { criticize } from "./critic";
import { preflight } from "./preflight";
import { tasteCheck } from "./taste";
import { selectRound } from "./select";

export interface GauntletResult {
  written: number;
  rejected: number;
  tally: Record<RejectReason, number>;
  published: boolean;
  relaxed: boolean;
}

// Counts, not a table (design 2026-09-04 §9.2). Persisting every rejected
// candidate is the version that supports precise tuning; the counts answer
// most of what anyone would ask, at zero schema cost, and promoting this to a
// stored table later is purely additive.
function narrate(date: string, written: number, published: boolean, tally: Record<RejectReason, number>, relaxed: boolean): string {
  const reasons = Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([reason, n]) => `${n} ${reason}`)
    .join(" · ");
  return [
    `HERMES · GAUNTLET ${date}`,
    `${written} candidates → ${published ? 5 : 0} published${relaxed ? " (categories relaxed to three)" : ""}`,
    `rejected: ${reasons || "none"}`,
  ].join("\n");
}

export async function runAuthoringGauntlet(deps: PipelineDeps, date: string): Promise<GauntletResult> {
  const tally = emptyTally();
  const count = (rejections: Rejection[]) => rejections.forEach((r) => (tally[r.reason] += 1));

  const raw = await generateCandidates(deps, date);
  const written = raw.length;

  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));

  // Tier 0 — free.
  const tier0 = screenCandidates(raw, { opensAt, locksAtDefault, recentTopicKeys: await recentTopicKeys(deps.db, date) });
  count(tier0.rejected);

  // Tier 1 — one GET each.
  const tier1 = await checkSources(deps.sourceFetch ?? fetch, tier0.passed);
  count(tier1.rejected);

  // Tier 2 — one model call, plus §7.
  const tier2 = await criticize(deps, tier1.passed);
  count(tier2.rejected);

  // Tier 3 — one model call per survivor.
  const tier3 = await preflight(deps, tier2.judged);
  count(tier3.rejected);

  // Tier 4 — last, fail-closed.
  const tier4 = await tasteCheck(deps, tier3.passed);
  count(tier4.rejected);

  const rejected = Object.values(tally).reduce((a, b) => a + b, 0);
  const selection = selectRound(tier4.passed);

  if (!selection) {
    // No round. `publish-bank` already covers noon, and the noon alert already
    // in decideActions fires if the bank is empty too. A drop that does not
    // happen is the correct outcome for a ledger whose brand is that it does
    // not lie.
    await deps.telegram.send(narrate(date, written, false, tally, false));
    return { written, rejected, tally, published: false, relaxed: false };
  }

  await upsertDraft(deps.db, date, selection.draft);
  await deps.db
    .update(schema.rounds)
    .set({ candidatesWritten: written, candidatesRejected: rejected })
    .where(eq(schema.rounds.date, date));

  await deps.telegram.send(narrate(date, written, true, tally, selection.relaxed));
  return { written, rejected, tally, published: true, relaxed: selection.relaxed };
}
```

Note: `upsertDraft` takes a typed `Draft` and does not re-run `DraftSchema`, which is what lets a relaxed three-category round through. That is deliberate — do not add a `DraftSchema.parse` here.

- [ ] **Step 5: Add `sourceFetch` to `PipelineDeps`**

In `apps/api/src/pipeline/index.ts`, add beside `marketFetch`:

```ts
  // Fetch used for tier-1 source reachability (gauntlet/sources.ts); defaults
  // to global fetch. Injectable so tests never touch the network.
  sourceFetch?: typeof fetch;
```

- [ ] **Step 6: Run the tests**

Run: `pnpm --filter @oracle/api test -- gauntlet-run`
Expected: PASS.

- [ ] **Step 7: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/gauntlet apps/api/src/pipeline/index.ts apps/api/src/pipeline/author.ts apps/api/test/gauntlet-run.test.ts
git commit -m "$(cat <<'MSG'
feat(pipeline): the night writes fifteen and publishes five, and says which five it put down

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 12: Adversarial resolution, and the question that was struck

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts`
- Modify: `apps/api/src/pipeline/actions.ts` (`voidQuestions`)
- Test: `apps/api/test/pipeline-resolve.test.ts` (extend), `apps/api/test/pipeline-tick.test.ts` (existing, must stay green)

**Interfaces:**
- Consumes: `askResolver`, `settled` from `pipeline/resolver.ts`; `PIPELINE_LINES` from `@oracle/core`.
- Produces: `resolveWithClaude(deps, questionId)` (same signature, new behaviour), `runResolution(deps, date, questionIds)`.

**Why this and not more authoring.** Compare the cost of error: a bad **question** ships, it voids, everyone scores 0 on that slot — one diminished day. A bad **resolution** ships and every player's points, Brier, streak, epithet and Oracle Score are permanently wrong, while the liturgy says `NOTHING REVISED`. The second is strictly worse, permanent, and today has *less* machinery than the first: one Sonnet call, no second opinion, no disagreement detection.

**The rule:**

| A | B | Result |
|---|---|---|
| `yes` | `yes` | resolve `yes` |
| `no` | `no` | resolve `no` |
| any disagreement | | `unverifiable` — retry next hour, void at the deadline if it persists |
| either `unverifiable` | | `unverifiable` |

**Two different models, not the same model twice.** Running one model twice correlates its errors: the second call fails the same way the first did, and agreement means nothing. Independent errors require independent models.

**Disagreement resolves to `unverifiable`, never to a winner.** The pipeline has no basis for preferring one reading, and `unverifiable` already has correct, tested behaviour — hourly retry, then void. A void is an honest "we could not read this"; a coin-flip between two disagreeing readings is a lie with a number attached.

**Carrying the disagreement to the void (R5).** Disagreement leaves the question locked, so the void happens hours later inside `voidQuestions`. `resolveWithClaude` therefore writes `resolution_evidence = { disagreement: true, a, b, checked_at }` **without touching `status`**, and `voidQuestions` reads that flag to pick its reason. This also satisfies §6's requirement that evidence from both models is stored so a disputed outcome is inspectable after the fact.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-resolve.test.ts` (match the file's existing fixture style; the deps builder there already exists — extend it so `claude.structured` can answer differently per model):

```ts
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
```

Add a local `seedOneLockedQuestion(db)` helper to the test file if one is not already there: insert a round plus one question with `status: "locked"`, `sourceUrl: "https://example.com/x"`, and return the inserted rows. Add a `depsWith(db, structured)` helper that builds a `PipelineDeps` with `models.resolve = "m-r"` and `models.resolveB = "m-rb"`.

- [ ] **Step 2: Run and watch it fail**

Run: `pnpm --filter @oracle/api test -- pipeline-resolve`
Expected: FAIL — one model is called, so `new Set(models).size` is 1 and no `disagreement` key is written.

- [ ] **Step 3: Rewrite `resolveWithClaude`**

Replace the body of `apps/api/src/pipeline/resolve.ts`:

```ts
// Hermes resolution (design 2026-09-04 §6): verify TWICE, with two different
// models, or void.
//
// Why here and not more authoring: a bad QUESTION ships, it voids, everyone
// scores 0 on that slot — one diminished day. A bad RESOLUTION ships and every
// player's points, Brier, streak, epithet and Oracle Score are permanently
// wrong, while the liturgy says NOTHING REVISED. The second is strictly worse,
// permanent, and until now had LESS machinery than the first.
//
// TWO DIFFERENT MODELS, NOT THE SAME MODEL TWICE. Running one model twice
// correlates its errors: the second call fails the same way the first did, and
// agreement means nothing. Independent errors require independent models.
//
// DISAGREEMENT RESOLVES TO UNVERIFIABLE, NEVER TO A WINNER. The pipeline has no
// basis for preferring one reading, and unverifiable already has correct,
// tested behaviour: hourly retry, then void at the deadline. A void is an
// honest "we could not read this"; a coin-flip between two disagreeing readings
// is a lie with a number attached. resettleRound remains available if a human
// ever corrects one by hand.
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";
import { askResolver, settled, type ResolverVerdict } from "./resolver";

function evidenceOf(deps: PipelineDeps, a: ResolverVerdict, b: ResolverVerdict, disagreement: boolean) {
  return {
    disagreement,
    checked_at: deps.now().toISOString(),
    a: { model: deps.models.resolve, ...a },
    b: { model: deps.models.resolveB, ...b },
  };
}

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);

  const target = {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  };
  // In parallel: they are independent readings of the same page, and running
  // them in series would double the slowest step in the whole pipeline.
  const [a, b] = await Promise.all([
    askResolver(deps, deps.models.resolve, target),
    askResolver(deps, deps.models.resolveB, target),
  ]);
  const sa = settled(a);
  const sb = settled(b);

  if (sa === null || sb === null || sa !== sb) {
    // WRITTEN DOWN, not merely returned. Disagreement leaves the question
    // locked, so the void happens hours later inside voidQuestions — by which
    // point the disagreement is gone unless it was recorded. This also makes a
    // disputed outcome inspectable after the fact (§6.2).
    await deps.db
      .update(schema.questions)
      .set({ resolutionEvidence: evidenceOf(deps, a, b, sa !== null && sb !== null && sa !== sb) })
      .where(eq(schema.questions.id, questionId));
    return false;
  }

  // The calls above can take minutes across chained web searches, and cron
  // ticks can overlap: another tick may have voided this question (or otherwise
  // moved it off "locked") while they were in flight. Re-check right before
  // writing so a late resolve never clobbers a void.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;

  await resolveQuestion(deps.db, questionId, sa, {
    outcome: sa,
    quotes: [...a.quotes, ...b.quotes],
    reasoning: `${a.reasoning}\n\n${b.reasoning}`,
    ...evidenceOf(deps, a, b, false),
  });
  return true;
}

// Every question resolves independently: one failing read must never stall the
// others. This is the function the resolution Workflow's step calls.
export async function runResolution(deps: PipelineDeps, date: string, questionIds: string[]): Promise<void> {
  for (const questionId of questionIds) {
    try {
      await resolveWithClaude(deps, questionId);
    } catch (err) {
      await deps.telegram.send(`⚠ resolve failed (${date}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
```

- [ ] **Step 4: Teach `voidQuestions` to name a struck question**

In `apps/api/src/pipeline/actions.ts`, import `PIPELINE_LINES` from `@oracle/core` and change the void loop:

```ts
  for (const row of stillLocked) {
    // A question two independent readers could not agree on is not the same
    // event as one nobody could read at all, and the reveal renders void_reason
    // verbatim. Reading the flag the last resolve attempt wrote is the only way
    // that distinction survives to void time (design 2026-09-04 §11.3).
    const ev = row.resolutionEvidence as { disagreement?: unknown } | null;
    const struck = ev !== null && typeof ev === "object" && ev.disagreement === true;
    await resolveQuestion(db, row.id, "void", {
      unverifiable: true,
      checked_at: nowIso,
      reason: struck ? PIPELINE_LINES.voidDisagreement : "unverifiable within 24 hours of lock",
    });
  }
```

- [ ] **Step 4b: Collapse `runTick`'s inline resolve loop into `runResolution`**

`runTick`'s `resolve` case in `apps/api/src/pipeline/index.ts` currently owns
its own `for (const questionId of action.questionIds)` loop with its own
try/catch and telegram narration. `runResolution` is that loop. Leaving both
in place is verbatim duplication of a logic block, and a reviewer would be
right to flag it. Replace the case body:

```ts
        case "resolve":
          // "resolve:<date>" means the tick ATTEMPTED resolution for every
          // still-locked question in this round — not that all of them
          // resolved. Unresolved questions stay locked and are retried
          // hourly; they void at noon ET two days after the round date.
          await runResolution(deps, action.date, action.questionIds);
          done.push(`resolve:${action.date}`);
          break;
```

and delete the old loop. Task 14 turns this call into a Workflow dispatch;
until then it behaves exactly as before.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-resolve pipeline-tick resolve-reveal`
Expected: PASS. `pipeline-tick.test.ts` drives resolution end to end through `runTick`; any fixture there whose fake Claude answered one model now has to answer both. Update the fixtures, never the assertions about outcomes.

- [ ] **Step 6: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/resolve.ts apps/api/src/pipeline/actions.ts apps/api/test
git commit -m "$(cat <<'MSG'
feat(pipeline): the permanent half of the ledger is read twice, by two different readers

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 13: The in-window probe, lock healing, and the `probe` action

**Files:**
- Create: `apps/api/src/pipeline/probe.ts`
- Modify: `apps/api/src/pipeline/state.ts`
- Test: `apps/api/test/pipeline-probe.test.ts`, `apps/api/test/pipeline-decide.test.ts` (extend), `apps/api/test/pipeline-draft.test.ts` (extend, DST)

**Interfaces:**
- Consumes: `askResolver`, `settled` from `pipeline/resolver.ts`; `schema.questions.lockHealedAt` (Task 1).
- Produces: `probeQuestion(deps, questionId): Promise<boolean>`, `runProbe(deps, date, questionIds): Promise<number>`, `PROBE_INTERVAL_HOURS`, `Action` variant `{ kind: "probe"; date: string; questionIds: string[] }`, `PipelineState["openRound"].probeIds`.

**Why:** `resolves_at` is a claim about the future made the night before. Tier 3 verified it was true *at authoring time*; nothing verifies it stays true. A periodic probe during the open window makes the stated invariant — *"the lock always moves to the information"* — enforced rather than asserted.

**`locks_at := min(locks_at, now)`.** A probe never moves a lock later. `Math.min` is the whole rule.

**`lock_healed_at` is written only here.** An authored early lock and a healed one both produce `locks_at < noon`, and only the second is the machine catching a leak in real time. That distinction is the column's entire reason for existing, so a test that only checks the column is *set* is not testing it — one must also prove an authored early lock leaves it null.

- [ ] **Step 1: Write the failing probe tests**

Create `apps/api/test/pipeline-probe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { probeQuestion, runProbe } from "../src/pipeline/probe";
import { publish } from "../src/pipeline/actions";
import type { PipelineDeps } from "../src/pipeline";

const OPENS = new Date("2026-09-04T16:00:00Z");
const LOCKS = new Date("2026-09-05T16:00:00Z");
const ANSWERED = { outcome: "yes", quotes: [{ url: "https://example.com/x", quote: "final score 3-1" }], reasoning: "done" };
const NOT_YET = { outcome: "unverifiable", quotes: [], reasoning: "not yet" };

async function seedOpen(db: PipelineDeps["db"], locksAt = LOCKS) {
  await db.insert(schema.rounds).values({ date: "2026-09-04", status: "open" });
  return db.insert(schema.questions).values({
    roundDate: "2026-09-04", slot: 1, text: "Will they win?", category: "sports",
    resolutionCriteria: "the official box score", sourceName: "SRC",
    sourceUrl: "https://example.com/x", opensAt: OPENS, locksAt, resolveBy: LOCKS,
    status: "open",
  }).returning();
}

function deps(db: PipelineDeps["db"], reply: unknown, nowIso = "2026-09-04T20:00:00Z", sent: string[] = []): PipelineDeps {
  return {
    db,
    telegram: { send: async (t) => void sent.push(t) },
    claude: { structured: async () => reply },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", critic: "m-c", preflight: "m-p", probe: "m-pr", taste: "m-t" },
    now: () => new Date(nowIso),
  };
}

describe("probeQuestion — the lock moves to the information", () => {
  it("pulls the lock forward to now and stamps lock_healed_at when the answer appears", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, ANSWERED), q!.id)).toBe(true);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.toISOString()).toBe("2026-09-04T20:00:00.000Z");
    expect(row!.lockHealedAt).not.toBeNull();
  });

  it("leaves everything alone when the source still cannot answer", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, NOT_YET), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(LOCKS.getTime());
    expect(row!.lockHealedAt).toBeNull();
  });

  it("treats a ruling with no receipts as no answer", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    expect(await probeQuestion(deps(db, { outcome: "yes", quotes: [], reasoning: "vibes" }), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(LOCKS.getTime());
  });

  it("NEVER moves a lock later", async () => {
    const { db } = await makeTestDb();
    const early = new Date("2026-09-04T18:00:00Z");
    const [q] = await seedOpen(db, early);
    // now is 20:00, two hours PAST an already-early lock.
    await probeQuestion(deps(db, ANSWERED), q!.id);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.getTime()).toBe(early.getTime());
  });

  it("never moves a lock later, over a spread of lock times and probe times", async () => {
    const { db } = await makeTestDb();
    for (const lockOffsetH of [1, 4, 9, 16, 23]) {
      for (const probeOffsetH of [0.5, 3, 8, 15, 22]) {
        const locksAt = new Date(OPENS.getTime() + lockOffsetH * 3_600_000);
        const probeAt = new Date(OPENS.getTime() + probeOffsetH * 3_600_000);
        const [q] = await db.insert(schema.questions).values({
          roundDate: "2026-09-04", slot: 2, text: "Will they win?", category: "sports",
          resolutionCriteria: "box score", sourceName: "SRC", sourceUrl: "https://example.com/x",
          opensAt: OPENS, locksAt, resolveBy: LOCKS, status: "open",
        }).returning();
        await probeQuestion(deps(db, ANSWERED, probeAt.toISOString()), q!.id);
        const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
        expect(row!.locksAt.getTime(), `lock+${lockOffsetH}h probe+${probeOffsetH}h`).toBeLessThanOrEqual(locksAt.getTime());
      }
    }
  });

  it("does nothing to a question that is no longer open", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.id, q!.id));
    expect(await probeQuestion(deps(db, ANSWERED), q!.id)).toBe(false);
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.lockHealedAt).toBeNull();
  });

  it("leaves lock_healed_at NULL on an authored early lock, which is the column's whole point", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-04", status: "scheduled" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-04", slot: 1, text: "Will they win?", category: "sports",
      resolutionCriteria: "box score", sourceName: "SRC", sourceUrl: "https://example.com/x",
      opensAt: OPENS, locksAt: new Date("2026-09-04T22:00:00Z"), resolveBy: LOCKS, status: "scheduled",
    }).returning();
    await publish(db, { send: async () => {} }, "2026-09-04");
    const row = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(row!.locksAt.toISOString()).toBe("2026-09-04T22:00:00.000Z"); // early, as authored
    expect(row!.lockHealedAt).toBeNull();                                 // and NOT healed
  });
});

describe("runProbe", () => {
  it("returns how many locks it healed and narrates each one", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const n = await runProbe(deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent), "2026-09-04", [q!.id]);
    expect(n).toBe(1);
    expect(sent.join("\n")).toContain("closed early");
  });

  it("keeps probing the rest when one probe throws", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedOpen(db);
    const sent: string[] = [];
    const d = deps(db, ANSWERED, "2026-09-04T20:00:00Z", sent);
    const n = await runProbe(d, "2026-09-04", ["00000000-0000-0000-0000-000000000000", q!.id]);
    expect(n).toBe(1);
    expect(sent.join("\n")).toContain("probe failed");
  });
});
```

- [ ] **Step 2: Write the failing decide tests**

Append to `apps/api/test/pipeline-decide.test.ts` (reuse that file's existing `state(...)` / `etNow` fixture helpers; add `probeIds` to whatever `openRound` factory it has):

```ts
describe("the probe action (design 2026-09-04 §5)", () => {
  const openWithProbes = { date: "2026-09-04", lockPassed: false, needsForecast: false, probeIds: ["q1", "q2"] };

  it("fires on the probe interval, not on the hourly one", () => {
    const at = (hour: number, minute: number) =>
      decideActions({ date: "2026-09-04", hour, minute }, { openRound: openWithProbes, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true })
        .filter((a) => a.kind === "probe");
    expect(at(16, 3)).toHaveLength(1);  // 16 % 4 === 0
    expect(at(17, 3)).toHaveLength(0);  // hourly, but not on the interval
    expect(at(16, 30)).toHaveLength(0); // on the interval, past the minute window
  });

  it("carries the still-open question ids", () => {
    const [action] = decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, { openRound: openWithProbes, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true }).filter((a) => a.kind === "probe");
    expect(action).toMatchObject({ kind: "probe", date: "2026-09-04", questionIds: ["q1", "q2"] });
  });

  it("never fires past the lock — at that point the probe would be a lookup", () => {
    const actions = decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, { openRound: { ...openWithProbes, lockPassed: true }, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true });
    expect(actions.filter((a) => a.kind === "probe")).toHaveLength(0);
  });

  it("never fires with no claude client, exactly as forecast does not", () => {
    const actions = decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, { openRound: openWithProbes, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: false });
    expect(actions.filter((a) => a.kind === "probe")).toHaveLength(0);
  });

  it("never fires with nothing left to probe", () => {
    const actions = decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, { openRound: { ...openWithProbes, probeIds: [] }, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true });
    expect(actions.filter((a) => a.kind === "probe")).toHaveLength(0);
  });

  it("stays pure: the same clock and state give the same actions", () => {
    const s = { openRound: openWithProbes, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true };
    expect(decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, s)).toEqual(decideActions({ date: "2026-09-04", hour: 16, minute: 3 }, s));
  });
});
```

- [ ] **Step 3: Run both and watch them fail**

Run: `pnpm --filter @oracle/api test -- pipeline-probe pipeline-decide`
Expected: FAIL — `probe.ts` missing, and `decideActions` never emits a `probe` action.

- [ ] **Step 4: Write `probe.ts`**

Create `apps/api/src/pipeline/probe.ts`:

```ts
// In-window lock healing (design 2026-09-04 §5).
//
// resolves_at is a claim about the FUTURE, made the night before. The gauntlet's
// pre-flight verified it was true at authoring time; nothing verified it stays
// true. This probe is what makes draft.ts's stated invariant — "the lock always
// moves to the information" — enforced rather than asserted.
//
// locks_at := min(locks_at, now). A PROBE NEVER MOVES A LOCK LATER. Math.min is
// the whole rule, and an early-locked question stays early-locked.
//
// lock_healed_at IS WRITTEN ONLY HERE. An authored early lock and a healed one
// both produce locks_at < noon, and only the second is the machine catching a
// leak in real time — which is why the round screen can say so.
import { and, eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { askResolver, settled } from "./resolver";

export async function probeQuestion(deps: PipelineDeps, questionId: string): Promise<boolean> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`probe: question not found: ${questionId}`);
  if (q.status !== "open") return false;

  const verdict = await askResolver(deps, deps.models.probe, {
    text: q.text,
    resolutionCriteria: q.resolutionCriteria,
    sourceName: q.sourceName,
    sourceUrl: q.sourceUrl,
  });
  if (settled(verdict) === null) return false;

  const now = deps.now();
  const healed = new Date(Math.min(q.locksAt.getTime(), now.getTime()));
  // Already at or before now: the lock has nothing left to learn, and stamping
  // lock_healed_at would claim a heal that did not happen.
  if (healed.getTime() >= q.locksAt.getTime()) return false;

  await deps.db
    .update(schema.questions)
    .set({ locksAt: healed, lockHealedAt: now })
    // Guarded on `open`: the probe call takes minutes, and a tick that locked
    // the round while it was in flight must not have its lock rewritten.
    .where(and(eq(schema.questions.id, questionId), eq(schema.questions.status, "open")));
  return true;
}

export async function runProbe(deps: PipelineDeps, date: string, questionIds: string[]): Promise<number> {
  let healed = 0;
  for (const questionId of questionIds) {
    try {
      if (await probeQuestion(deps, questionId)) {
        healed += 1;
        const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
        await deps.telegram.send(`⚠ ${date} slot ${q?.slot}: the answer exists, so the question closed early — "${q?.text}"`);
      }
    } catch (err) {
      await deps.telegram.send(`⚠ probe failed (${date}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return healed;
}
```

- [ ] **Step 5: Add the action and the state it reads**

In `apps/api/src/pipeline/state.ts`:

```ts
// How often the open window is swept for questions whose answers have already
// appeared. Four hours gives roughly five probes per question across a 24-hour
// window; the spend ceiling in spend.ts is what bounds the cost. An ops
// threshold, like BANK_LOW_WATER — not a game rule.
export const PROBE_INTERVAL_HOURS = 4;
```

Extend the `Action` union:

```ts
  | { kind: "probe"; date: string; questionIds: string[] }
```

Extend `PipelineState["openRound"]`:

```ts
  openRound: {
    date: string;
    lockPassed: boolean;
    needsForecast: boolean;
    // Questions still open AND still ahead of their own lock — the only ones a
    // probe could teach anything. A question already past its lock is the
    // lock action's business, not the probe's.
    probeIds: string[];
  } | null;
```

In `loadPipelineState`, inside the `if (openRoundRow)` block, after `maxLocksAt`:

```ts
    openRound = {
      date: openRoundRow.date,
      lockPassed: now.getTime() >= maxLocksAt,
      needsForecast: questions.some((q) => q.oracleProbYes === null),
      probeIds: questions
        .filter((q) => q.status === "open" && q.locksAt.getTime() > now.getTime())
        .sort((a, b) => a.slot - b.slot)
        .map((q) => q.id),
    };
```

In `decideActions`, directly after the FORECAST block:

```ts
  // PROBE (design 2026-09-04 §5) — sweep the open window for questions whose
  // answers have already appeared, and pull their locks forward.
  //
  // Its throttle is NOT the hourly one the other actions use: it fires on the
  // interval, so a 4-hour cadence is expressed once, here, rather than as a
  // counter somewhere with state. Gated on claudeAvailable exactly as FORECAST
  // is, and never past the lock — at that point a probe would be a lookup.
  if (
    state.openRound &&
    !state.openRound.lockPassed &&
    state.openRound.probeIds.length > 0 &&
    state.claudeAvailable &&
    hour % PROBE_INTERVAL_HOURS === 0 &&
    minute < 10
  ) {
    actions.push({ kind: "probe", date: state.openRound.date, questionIds: state.openRound.probeIds });
  }
```

Then fix every existing construction of `openRound` in the test files the typechecker flags — each needs a `probeIds: []`.

- [ ] **Step 5b: Wire the probe executor into `runTick`**

`decideActions` now emits a `probe` action that nothing executes: the tick
would decide it every four hours and silently drop it. Add the case to
`runTick`'s switch in `apps/api/src/pipeline/index.ts`, beside `resolve`:

```ts
        case "probe":
          await runProbe(deps, action.date, action.questionIds);
          done.push(`probe:${action.date}`);
          break;
```

with `import { runProbe } from "./probe";` at the top. Task 14 turns this call
into a Workflow dispatch; until then it behaves exactly as written.

- [ ] **Step 6: Add the DST test**

`resolves_at` is a UTC instant a model derives by reasoning about "noon ET tomorrow". Across a DST boundary that reasoning is a classic failure, and the failure is silent — an hour's worth of leak. `noonET` is already DST-proof; the check is that `lockFromResolvesAt` compares against *it* and never against a model-computed noon.

Append to `apps/api/test/pipeline-draft.test.ts`:

```ts
describe("lockFromResolvesAt across a DST boundary (design 2026-09-04 §10)", () => {
  // 2026-11-01 is the US fall-back: noon ET on 2026-10-31 is 16:00Z (EDT) and
  // noon ET on 2026-11-01 is 17:00Z (EST). A model that reasons "noon ET
  // tomorrow is 16:00Z" is an hour early, and the leak is silent.
  const opensAt = noonET("2026-10-31");
  const locksAtDefault = noonET("2026-11-01");

  it("takes the default lock from noonET, which is 17:00Z on the fall-back day", () => {
    expect(opensAt.toISOString()).toBe("2026-10-31T16:00:00.000Z");
    expect(locksAtDefault.toISOString()).toBe("2026-11-01T17:00:00.000Z");
  });

  it("clamps a resolves_at in the extra hour to the real noon, never to a model's guess at it", () => {
    // 16:30Z on 2026-11-01 is 11:30 EST — still before noon ET, and inside the
    // hour that only exists because the clocks went back.
    const locks = lockFromResolvesAt("2026-11-01T16:30:00Z", opensAt, locksAtDefault);
    expect(locks.toISOString()).toBe("2026-11-01T16:30:00.000Z");
    expect(locks.getTime()).toBeLessThan(locksAtDefault.getTime());
  });

  it("clamps anything past the real noon back to it", () => {
    expect(lockFromResolvesAt("2026-11-01T20:00:00Z", opensAt, locksAtDefault).toISOString()).toBe(locksAtDefault.toISOString());
  });

  it("does the same across the spring-forward boundary", () => {
    const springOpens = noonET("2026-03-07");
    const springLocks = noonET("2026-03-08");
    expect(springOpens.toISOString()).toBe("2026-03-07T17:00:00.000Z");
    expect(springLocks.toISOString()).toBe("2026-03-08T16:00:00.000Z");
    expect(lockFromResolvesAt("2026-03-08T20:00:00Z", springOpens, springLocks).toISOString()).toBe(springLocks.toISOString());
  });
});
```

If any expected instant above disagrees with what `noonET` actually returns, **the test is wrong, not the code** — `noonET` derives the offset from `Intl` and is the authority. Correct the expectation and say so in your report.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-probe pipeline-decide pipeline-draft`
Expected: PASS.

- [ ] **Step 8: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline/probe.ts apps/api/src/pipeline/state.ts apps/api/test
git commit -m "$(cat <<'MSG'
feat(pipeline): the lock moves to the information while the round is still open

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 14: The execution substrate — cron decides, Workflow executes

**Files:**
- Create: `apps/api/src/pipeline/workflows.ts`
- Modify: `apps/api/src/pipeline/index.ts`
- Modify: `apps/api/src/worker.ts`
- Modify: `apps/api/wrangler.jsonc`
- Test: `apps/api/test/pipeline-workflows.test.ts`, `apps/api/test/pipeline-tick.test.ts` (extend)

**Interfaces:**
- Consumes: `runAuthoringGauntlet` (Task 11), `runResolution` (Task 12), `runProbe` (Task 13), `meterClaude`/`BudgetExhausted` (Task 4).
- Produces: `WorkflowKind`, `WorkflowStarter`, `hourBucket(now: ETNow)`, `inlineStarter(deps)`, `bindingStarter(bindings)`, `AuthoringWorkflow`/`ResolutionWorkflow`/`ProbeWorkflow`, `PipelineDeps["workflows"]`.

**The limit, measured.** Cloudflare Cron Triggers on a sub-hour schedule get 30 seconds CPU and a **hard 15-minute wall-clock cap**. CPU is not the constraint — waiting on `fetch` is I/O. The 15 minutes is. **This is already a latent production bug:** `runTick`'s `resolve` case loops all five questions sequentially in one invocation, and `resolve.ts`'s own header says the call "can take minutes across chained web searches". The gauntlet adds roughly eight more long calls to the authoring tick and would exceed the cap every night.

**What does NOT change.** `decideActions` stays pure over `(ETNow, PipelineState)` with no I/O — that is what makes every action idempotent, replayable and testable, and it is a better property for *deciding* than durable execution is. What changes is that `runTick` **starts** long work instead of awaiting it.

**Instance IDs carry an hour bucket**, which makes idempotency fall out of the throttles that already exist: `decideActions` fires `author` and `resolve` at most once an hour, so a duplicate `create` inside the same hour collides on the ID and is skipped, and a new hour gets a fresh instance — exactly the hourly-retry semantics the state machine already specifies. The database stays the source of truth for what is resolved or scheduled; a duplicate instance that does start simply finds nothing to do.

**`forecast` stays inline** — one model call with web search fits the 15-minute cap comfortably; it is the fan-outs that do not. If the noon tick ever grows a second long inline call, forecast is the one to move next.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/pipeline-workflows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hourBucket, bindingStarter } from "../src/pipeline/workflows";

describe("hourBucket", () => {
  it("is the ET date and hour, zero-padded, with no separators", () => {
    expect(hourBucket({ date: "2026-09-04", hour: 17, minute: 3 })).toBe("2026090417");
    expect(hourBucket({ date: "2026-09-04", hour: 3, minute: 59 })).toBe("2026090403");
    expect(hourBucket({ date: "2026-09-04", hour: 0, minute: 0 })).toBe("2026090400");
  });
});

describe("bindingStarter", () => {
  const binding = (created: unknown[]) => ({ create: async (o: unknown) => void created.push(o) });
  // bindingStarter ignores the deps argument entirely — the Workflow builds its
  // own deps from env on the other side of the dispatch.
  const noDeps = null as unknown as import("../src/pipeline").PipelineDeps;

  it("routes each kind to its own binding and passes the id and params through", async () => {
    const author: unknown[] = [], resolve: unknown[] = [], probe: unknown[] = [];
    const s = bindingStarter({ AUTHORING_WORKFLOW: binding(author), RESOLUTION_WORKFLOW: binding(resolve), PROBE_WORKFLOW: binding(probe) });
    await s.start(noDeps, "author", "author-2026-09-05-2026090417", { date: "2026-09-05" });
    await s.start(noDeps, "resolve", "resolve-2026-09-04-2026090412", { date: "2026-09-04", questionIds: ["q1"] });
    await s.start(noDeps, "probe", "probe-2026-09-04-2026090416", { date: "2026-09-04", questionIds: ["q1"] });
    expect(author).toEqual([{ id: "author-2026-09-05-2026090417", params: { date: "2026-09-05" } }]);
    expect(resolve[0]).toMatchObject({ id: "resolve-2026-09-04-2026090412" });
    expect(probe[0]).toMatchObject({ id: "probe-2026-09-04-2026090416" });
  });

  it("swallows a duplicate-instance error, because a collision IS the idempotency", async () => {
    const s = bindingStarter({
      AUTHORING_WORKFLOW: { create: async () => { throw new Error("instance.already_exists: an instance with id author-x already exists"); } },
      RESOLUTION_WORKFLOW: { create: async () => {} },
      PROBE_WORKFLOW: { create: async () => {} },
    });
    await expect(s.start(noDeps, "author", "author-x", { date: "2026-09-05" })).resolves.toBeUndefined();
  });

  it("still throws on any OTHER failure — a broken binding must not look like a duplicate", async () => {
    const s = bindingStarter({
      AUTHORING_WORKFLOW: { create: async () => { throw new Error("binding is not configured"); } },
      RESOLUTION_WORKFLOW: { create: async () => {} },
      PROBE_WORKFLOW: { create: async () => {} },
    });
    await expect(s.start(noDeps, "author", "author-x", { date: "2026-09-05" })).rejects.toThrow("not configured");
  });
});
```

Append to `apps/api/test/pipeline-tick.test.ts`:

```ts
describe("runTick dispatches long work instead of awaiting it (design 2026-09-04 §2)", () => {
  it("starts the authoring workflow with an hour-bucketed instance id", async () => {
    const { db } = await makeTestDb();
    const started: Array<{ kind: string; id: string }> = [];
    const { deps } = fakeDeps(db, "2026-09-04T21:05:00Z"); // 17:05 ET
    deps.claude = { structured: async () => ({}) };
    deps.workflows = { start: async (_d, kind, id) => void started.push({ kind, id }) };
    const done = await runTick(deps);
    expect(done).toContain("author:2026-09-05");
    expect(started).toEqual([{ kind: "author", id: "author-2026-09-05-2026090417" }]);
  });

  it("uses the same instance id twice inside one hour, so the second start collides", async () => {
    const { db } = await makeTestDb();
    const ids: string[] = [];
    for (const iso of ["2026-09-04T21:01:00Z", "2026-09-04T21:08:00Z"]) {
      const { deps } = fakeDeps(db, iso);
      deps.claude = { structured: async () => ({}) };
      deps.workflows = { start: async (_d, _k, id) => void ids.push(id) };
      await runTick(deps);
    }
    expect(new Set(ids).size).toBe(1);
  });

  it("keeps lock, publish, void and settle inline — they are short DB writes", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const started: string[] = [];
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    deps.workflows = { start: async (_d, kind) => void started.push(kind) };
    const done = await runTick(deps);
    expect(done).toContain("lock:2026-08-26");
    expect(started).toHaveLength(0);
  });
});

describe("the spend ceiling in the tick (design 2026-09-04 §9.1)", () => {
  it("blocks a model call past the ceiling and raises one critical", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-09-04", calls: PIPELINE_DAILY_CALL_BUDGET });
    const { deps, sent } = fakeDeps(db, "2026-09-04T21:05:00Z");
    let reached = false;
    deps.claude = { structured: async () => { reached = true; return {}; } };
    // The inline starter runs the runner in-process, so the metered client is
    // exercised end to end.
    await runTick(deps);
    expect(reached).toBe(false);
    expect(sent.join("\n")).toContain("budget");
  });

  it("never blocks lock, publish, void or settle", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.pipelineSpend).values({ date: "2026-08-27", calls: PIPELINE_DAILY_CALL_BUDGET + 50 });
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    const done = await runTick(deps);
    expect(done).toContain("lock:2026-08-26");
  });
});
```

**Two fixture obligations that are easy to miss and both matter:**

1. **`workflows` is a REQUIRED field on `PipelineDeps`**, so every existing
   `PipelineDeps` object literal in the test suite stops compiling. Run
   `pnpm --filter @oracle/api typecheck` and add `workflows: inlineStarter()`
   to each one the typechecker names — expect `pipeline-tick`,
   `pipeline-author`, `pipeline-bank`, `pipeline-resolve`,
   `pipeline-forecast`, `pipeline-resolver`, `pipeline-probe`,
   `gauntlet-critic`, `gauntlet-preflight`, `gauntlet-taste`,
   `gauntlet-run`. Trust the typechecker over that list.

2. **`fakeDeps` must never reach the network.** Once `runTick` dispatches
   `author` through the inline starter, `runAuthoringGauntlet` runs inside
   tick tests — and it calls `fetchMarketSignals` (which falls back to global
   `fetch`) and tier 1's `checkSources` (same). Add both fakes to `fakeDeps`:

   ```ts
     marketFetch: (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch,
     sourceFetch: (async () => new Response("", { status: 200 })) as unknown as typeof fetch,
   ```

   `fetchMarketSignals` isolates per-feed failures and returns `[]` on any
   throw, so authoring proceeds market-blind either way — but a test that
   *attempts* a network call still violates Global Constraint 2.

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @oracle/api test -- pipeline-workflows pipeline-tick`
Expected: FAIL — `workflows.ts` missing; `deps.workflows` is not a field.

- [ ] **Step 3: Write `workflows.ts`**

Create `apps/api/src/pipeline/workflows.ts`:

```ts
// The execution substrate (design 2026-09-04 §2): cron DECIDES, a Workflow
// EXECUTES.
//
// THE LIMIT, MEASURED. Cloudflare Cron Triggers on a sub-hour schedule get 30
// seconds of CPU and a HARD 15-MINUTE WALL-CLOCK CAP. CPU is not the
// constraint here — waiting on fetch is I/O. The 15 minutes is, and runTick's
// resolve case has been sitting on it: five sequential resolves, each of which
// "can take minutes across chained web searches" by resolve.ts's own admission.
// It has not bitten only because the pipeline has never run an unattended day.
// The gauntlet adds roughly eight more long calls to the authoring tick.
//
// Cloudflare Workflows: unlimited wall-clock per step, retries built in. Fan-out
// of long external calls is its shape.
//
// decideActions DOES NOT CHANGE ITS NATURE. It stays pure over
// (ETNow, PipelineState) — that purity is what makes every action idempotent,
// replayable and testable, and it is a better property for DECIDING than
// durable execution is. What changes is only that runTick starts long work
// rather than awaiting it.
import type { ETNow } from "./clock";

export type WorkflowKind = "author" | "resolve" | "probe";

export interface WorkflowStarter {
  // deps is passed AT START TIME rather than captured at construction, so
  // runTick can hand the inline path its METERED Claude client — inline
  // execution is then charged against the spend ceiling exactly as dispatched
  // execution is. bindingStarter ignores it.
  start(
    deps: PipelineDeps,
    kind: WorkflowKind,
    id: string,
    params: { date: string; questionIds?: string[] },
  ): Promise<void>;
}

// The hour bucket is what makes idempotency FALL OUT of throttles that already
// exist: decideActions fires author and resolve at most once an hour, so a
// duplicate create inside the same hour collides on this id and is skipped,
// while a new hour gets a fresh instance — which is exactly the hourly-retry
// semantics the state machine already specifies.
export function hourBucket(now: ETNow): string {
  return `${now.date.replace(/-/g, "")}${String(now.hour).padStart(2, "0")}`;
}

// The subset of Cloudflare's Workflow binding this file uses. Declared
// structurally so the tests can pass a plain object and the Worker types stay
// out of the test tsconfig.
export interface WorkflowBinding {
  create(options: { id: string; params: { date: string; questionIds?: string[] } }): Promise<unknown>;
}
export interface WorkflowBindings {
  AUTHORING_WORKFLOW: WorkflowBinding;
  RESOLUTION_WORKFLOW: WorkflowBinding;
  PROBE_WORKFLOW: WorkflowBinding;
}

const DUPLICATE = /already exists|instance\.already_exists|duplicate/i;

export function bindingStarter(bindings: WorkflowBindings): WorkflowStarter {
  const of: Record<WorkflowKind, WorkflowBinding> = {
    author: bindings.AUTHORING_WORKFLOW,
    resolve: bindings.RESOLUTION_WORKFLOW,
    probe: bindings.PROBE_WORKFLOW,
  };
  return {
    // The deps argument is ignored here on purpose: the Workflow builds its own
    // PipelineDeps from env on the other side of the dispatch. It exists so
    // inlineStarter can receive runTick's metered client.
    async start(_deps, kind, id, params) {
      try {
        await of[kind].create({ id, params });
      } catch (err) {
        // A COLLISION IS THE IDEMPOTENCY, not a failure: this hour's instance
        // already exists and is already doing the work.
        if (err instanceof Error && DUPLICATE.test(err.message)) return;
        throw err;
      }
    },
  };
}
```

- [ ] **Step 4: Wire dispatch, metering and the inline starter into `runTick`**

Append the inline starter to `apps/api/src/pipeline/workflows.ts`:

```ts
// Runs the workflow's body in-process instead of dispatching it. This is a real
// fallback, not a stub: everything the Workflow would do happens, just inside
// the tick's own 15 minutes. Tests and `wrangler dev` take this path, which is
// why every existing tick test keeps asserting the same outcomes.
//
// The runners are imported lazily to keep this module free of an import cycle
// (index.ts -> workflows.ts -> gauntlet -> index.ts).
export function inlineStarter(): WorkflowStarter {
  return {
    async start(deps, kind, _id, params) {
      if (kind === "author") {
        const { runAuthoringGauntlet } = await import("./gauntlet");
        await runAuthoringGauntlet(deps, params.date);
      } else if (kind === "resolve") {
        const { runResolution } = await import("./resolve");
        await runResolution(deps, params.date, params.questionIds ?? []);
      } else {
        const { runProbe } = await import("./probe");
        await runProbe(deps, params.date, params.questionIds ?? []);
      }
    },
  };
}
```

`workflows.ts` needs `import type { PipelineDeps } from "./index";` for the signature. That is a type-only import, so it creates no runtime cycle.

In `apps/api/src/pipeline/index.ts`, add the field to `PipelineDeps`:

```ts
  // How long work is launched. In production this is bindingStarter over the
  // three Workflow bindings; in tests and wherever the bindings are absent it
  // is inlineStarter, which awaits the runner in-process — so behaviour and the
  // executed-action labels are identical either way.
  workflows: WorkflowStarter;
```

Then rewrite `runTick`'s opening and its three long cases:

```ts
export async function runTick(deps: PipelineDeps): Promise<string[]> {
  const now = deps.now();
  const et = etNow(now);
  const bucket = hourBucket(et);

  // THE CEILING, APPLIED IN ONE PLACE. Every model call in this pipeline goes
  // through deps.claude, and no deterministic action touches it — which is
  // exactly why lock, publish, void and settle can never be blocked by the
  // budget. Everything downstream, including the inline starter's runners,
  // receives this metered copy.
  const metered: PipelineDeps = {
    ...deps,
    claude: deps.claude ? meterClaude(deps.db, deps.claude, et.date) : null,
  };

  const state = await loadPipelineState(deps.db, now, deps.claude !== null);
  const actions = decideActions(et, state);
  const done: string[] = [];

  for (const action of actions) {
    try {
      switch (action.kind) {
        // lock / publish / publish-bank / void / settle / alert: unchanged,
        // still called with `deps.db` and `deps.telegram` directly.

        // forecast / author-bank: unchanged in shape, but pass `metered`
        // instead of `deps` so their model calls are charged:
        //   case "forecast": await stampOracleForecast(metered, action.date); ...
        //   case "author-bank": await authorBankEntry(metered); ...

        case "author":
          await deps.workflows.start(metered, "author", `author-${action.date}-${bucket}`, { date: action.date });
          done.push(`author:${action.date}`);
          break;

        case "resolve":
          // "resolve:<date>" means the tick DISPATCHED resolution for every
          // still-locked question in this round — not that all of them
          // resolved. Unresolved questions stay locked and are retried hourly;
          // they void at noon ET two days after the round date.
          await deps.workflows.start(metered, "resolve", `resolve-${action.date}-${bucket}`, {
            date: action.date,
            questionIds: action.questionIds,
          });
          done.push(`resolve:${action.date}`);
          break;

        case "probe":
          await deps.workflows.start(metered, "probe", `probe-${action.date}-${bucket}`, {
            date: action.date,
            questionIds: action.questionIds,
          });
          done.push(`probe:${action.date}`);
          break;
      }
    } catch (err) {
      // The budget's own alert, raised exactly once — on the call that crossed
      // the line, because BudgetExhausted.first is true only there.
      if (err instanceof BudgetExhausted && err.first) {
        await deps.telegram.send(
          `‼️ the daily model-call budget of ${PIPELINE_DAILY_CALL_BUDGET} is spent — no further model calls today; the bank covers noon`,
        );
      } else {
        await deps.telegram.send(`⚠ ${action.kind} failed: ${errorMessage(err)}`);
      }
    }
  }

  return done;
}
```

The old inline `resolve` case — the `for (const questionId of action.questionIds)` loop with its own try/catch — moves wholesale into `runResolution` (Task 12) and must be deleted from `index.ts`. The `author` case's `authorRound` call is replaced by the dispatch above; **do not delete `authorRound` itself** — `POST /admin/rounds/:date` and `/reroll` still use it, and the evergreen bank's author shares its file.

Imports `index.ts` gains: `hourBucket`, `type WorkflowStarter` from `./workflows`; `meterClaude`, `BudgetExhausted`, `PIPELINE_DAILY_CALL_BUDGET` from `./spend`.

- [ ] **Step 5: Write the Workflow entrypoints**

Create `apps/api/src/pipeline/workflow-entrypoints.ts` — a separate file from
`workflows.ts` because it imports `cloudflare:workers`, which the test tsconfig
has no module for. `workflows.ts` keeps `WorkflowStarter`, `hourBucket`,
`bindingStarter` and `inlineStarter`; only `worker.ts` imports this file.

```ts
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { WorkerEnv } from "../worker";

interface Params { date: string; questionIds?: string[] }

// Each class is a thin shell. All the work lives in ordinary async functions
// that take PipelineDeps, so every one of them is testable against PGlite with
// a fake Claude client — a Workflow class is not.
export class AuthoringWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await step.do("gauntlet", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await runAuthoringGauntlet(deps, event.payload.date);
    });
  }
}

export class ResolutionWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await step.do("resolve", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await runResolution(deps, event.payload.date, event.payload.questionIds ?? []);
    });
  }
}

export class ProbeWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    await step.do("probe", async () => {
      const deps = metered(this.env);
      if (!deps) return;
      await runProbe(deps, event.payload.date, event.payload.questionIds ?? []);
    });
  }
}
```

Factor the three-line preamble the classes share into one helper in the same
file, and use plain top-level imports (this file is never loaded by the test
tsconfig, so there is no reason for dynamic `import()`):

```ts
import { buildPipelineDeps, type WorkerEnv } from "../worker";
import { meterClaude } from "./spend";
import { etNow } from "./clock";
import { runAuthoringGauntlet } from "./gauntlet";
import { runResolution } from "./resolve";
import { runProbe } from "./probe";
import type { PipelineDeps } from "./index";

// A Workflow instance builds its own deps from env — it is on the far side of
// the dispatch and shares nothing with the tick that started it. The spend
// ceiling therefore has to be applied here too, or every long call would escape
// the meter the moment the substrate started working.
function metered(env: WorkerEnv): PipelineDeps | null {
  const deps = buildPipelineDeps(env);
  if (!deps) return null;
  const et = etNow(new Date());
  return { ...deps, claude: deps.claude ? meterClaude(deps.db, deps.claude, et.date) : null };
}
```

Rewrite `AuthoringWorkflow` above to use the same helper.

- [ ] **Step 6: Wire the Worker and wrangler**

In `apps/api/src/worker.ts`:

```ts
export interface WorkerEnv {
  // ... existing fields, plus:
  PIPELINE_RESOLVE_MODEL_B?: string;
  PIPELINE_CRITIC_MODEL?: string;
  PIPELINE_PREFLIGHT_MODEL?: string;
  PIPELINE_PROBE_MODEL?: string;
  PIPELINE_TASTE_MODEL?: string;
  AUTHORING_WORKFLOW?: WorkflowBinding;
  RESOLUTION_WORKFLOW?: WorkflowBinding;
  PROBE_WORKFLOW?: WorkflowBinding;
}

export { AuthoringWorkflow, ResolutionWorkflow, ProbeWorkflow } from "./pipeline/workflow-entrypoints";
```

and in `buildPipelineDeps`, after the models block:

```ts
  const bindings =
    env.AUTHORING_WORKFLOW && env.RESOLUTION_WORKFLOW && env.PROBE_WORKFLOW
      ? { AUTHORING_WORKFLOW: env.AUTHORING_WORKFLOW, RESOLUTION_WORKFLOW: env.RESOLUTION_WORKFLOW, PROBE_WORKFLOW: env.PROBE_WORKFLOW }
      : null;
  if (!bindings) {
    // Not fatal, but it means authoring and resolution run inside the cron's
    // hard 15-minute cap — which is the exact bug the Workflow substrate
    // exists to fix (design 2026-09-04 §2.1).
    console.warn("pipeline: no Workflow bindings; long actions will run inline inside the cron's 15-minute cap");
  }

  return {
    // ... db, telegram, claude, models, now, push — unchanged
    workflows: bindings ? bindingStarter(bindings) : inlineStarter(),
  };
```

`inlineStarter()` takes no arguments: `runTick` hands it the metered deps at
`start` time, which is the whole reason `WorkflowStarter.start` carries `deps`.

In `apps/api/wrangler.jsonc`, add the bindings and the new model vars:

```jsonc
  "workflows": [
    { "name": "oracle-authoring", "binding": "AUTHORING_WORKFLOW", "class_name": "AuthoringWorkflow" },
    { "name": "oracle-resolution", "binding": "RESOLUTION_WORKFLOW", "class_name": "ResolutionWorkflow" },
    { "name": "oracle-probe", "binding": "PROBE_WORKFLOW", "class_name": "ProbeWorkflow" }
  ],
  "vars": {
    "PIPELINE_AUTHOR_MODEL": "claude-opus-5",
    "PIPELINE_RESOLVE_MODEL": "claude-sonnet-5",
    "PIPELINE_RESOLVE_MODEL_B": "claude-opus-5",
    "PIPELINE_FORECAST_MODEL": "claude-sonnet-5",
    "PIPELINE_CRITIC_MODEL": "claude-opus-5",
    "PIPELINE_PREFLIGHT_MODEL": "claude-sonnet-5",
    "PIPELINE_PROBE_MODEL": "claude-sonnet-5",
    "PIPELINE_TASTE_MODEL": "claude-haiku-4-5-20251001"
  }
```

Add one line to the secrets comment block already in that file, under PIPELINE:

```
  //     (PIPELINE_RESOLVE_MODEL_B is a DIFFERENT model from PIPELINE_RESOLVE_MODEL
  //      on purpose — see design 2026-09-04 §6.2. Setting both to the same model
  //      silently removes the error independence the second read exists to buy.)
```

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @oracle/api test`
Expected: PASS, all of it.

- [ ] **Step 8: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add apps/api/src/pipeline apps/api/src/worker.ts apps/api/wrangler.jsonc apps/api/test
git commit -m "$(cat <<'MSG'
feat(pipeline): the cron decides and a workflow executes, so the long work stops racing a cap

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

### Task 15: The machine shows its work — the two player-facing surfaces

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Modify: `apps/api/src/routes/round.ts`
- Modify: `apps/mobile/src/app/reveal/[date].tsx`
- Modify: `apps/mobile/src/app/round.tsx`
- Test: `apps/api/test/round.test.ts` (extend), `packages/core/test/round-schemas.test.ts` (extend), `apps/mobile/test/revealRows.test.ts` (extend)

**Interfaces:**
- Consumes: `rounds.candidatesWritten`/`candidatesRejected` and `questions.lockHealedAt` (Task 1); `provenanceLine`/`PIPELINE_LINES` (Task 2).
- Produces: `RevealSchema.candidates_written` / `.candidates_rejected` (both `number`), `RoundTodaySchema.questions[].lock_healed` (`boolean`).

**Why this matters and is not decoration.** Every gate in this spec is invisible. Fifteen questions get written, ten get put down, one gets slammed shut mid-window because its answer appeared — and the player sees five cards indistinguishable from five unguarded ones. For a correctness project that is a virtue. For a system whose premise is an all-knowing machine held to receipts, it is the whole point going unwitnessed.

The third surface — the struck void reason — landed in Task 12 and needs nothing here: `evidenceSummary` already lifts `reason` out of the evidence JSON, and `receiptLine` already renders `VOID · <reason>`.

**Push is deliberately out of scope.** An early lock is the best push notification this app will ever have, and it is not specced: `apps/api/src/push/compose.ts` carries four binding obligations recorded in its own header and is intentionally uncalled. Do not call it.

- [ ] **Step 1: Write the failing API tests**

Append to `apps/api/test/round.test.ts` (match the file's existing device-auth helper style):

```ts
describe("the reveal carries what the gauntlet cost (design 2026-09-04 §11.1)", () => {
  it("reports both counts", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: authEnv });
    const call = await player(app);
    await seedSettledRound(db, "2026-09-02");
    await db.update(schema.rounds).set({ candidatesWritten: 15, candidatesRejected: 10 }).where(eq(schema.rounds.date, "2026-09-02"));
    const res = await call("/v1/round/2026-09-02/reveal");
    const body = (await res.json()) as { candidates_written: number; candidates_rejected: number };
    expect(body.candidates_written).toBe(15);
    expect(body.candidates_rejected).toBe(10);
  });

  it("reports zero for a round that predates the columns, so the client withholds the line", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: authEnv });
    const call = await player(app);
    await seedSettledRound(db, "2026-09-02");
    const body = (await (await call("/v1/round/2026-09-02/reveal")).json()) as { candidates_written: number };
    expect(body.candidates_written).toBe(0);
  });
});

describe("/today says which locks were healed (design 2026-09-04 §11.2)", () => {
  it("is false for an ordinary question and for an authored early lock", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: authEnv });
    const call = await player(app);
    await seedOpenRoundNow(db);
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ lock_healed: boolean }> };
    expect(body.questions.every((q) => q.lock_healed === false)).toBe(true);
  });

  it("is true only for a question the probe closed", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: authEnv });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.id, qs[0]!.id));
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; lock_healed: boolean }> };
    expect(body.questions.filter((q) => q.lock_healed).map((q) => q.id)).toEqual([qs[0]!.id]);
  });
});
```

Reuse whatever round-seeding helpers `round.test.ts` already has; add `seedSettledRound` / `seedOpenRoundNow` locally only if no equivalent exists. A "settled" round means every question carries an outcome — `/:date/reveal` 409s otherwise.

- [ ] **Step 2: Write the failing schema test**

Append to `packages/core/test/round-schemas.test.ts`:

```ts
describe("the provenance and healed-lock fields", () => {
  it("RevealSchema requires both counts", () => {
    const ok = RevealSchema.safeParse({ ...validReveal, candidates_written: 15, candidates_rejected: 10 });
    expect(ok.success).toBe(true);
    const missing = RevealSchema.safeParse(validReveal);
    expect(missing.success).toBe(false);
  });

  it("RoundTodaySchema requires lock_healed on every question", () => {
    const withFlag = { ...validToday, questions: validToday.questions.map((q) => ({ ...q, lock_healed: false })) };
    expect(RoundTodaySchema.safeParse(withFlag).success).toBe(true);
    expect(RoundTodaySchema.safeParse(validToday).success).toBe(false);
  });
});
```

`validReveal` and `validToday` are that file's existing fixtures; extend them with the new fields once the schemas require them, so the rest of the file keeps passing.

- [ ] **Step 3: Run both and watch them fail**

Run: `pnpm --filter @oracle/api test -- round` and `pnpm --filter @oracle/core test -- round-schemas`
Expected: FAIL on both.

- [ ] **Step 4: Extend the schemas**

In `packages/core/src/schemas.ts`, add to `RevealSchema` (top level, beside `first_hour`):

```ts
  // What the gauntlet cost, in candidates (design 2026-09-04 §11.1). Zero for a
  // bank drop and for every round authored before migration 0007 — the client
  // withholds the line entirely at zero rather than claim a perfect night.
  candidates_written: z.number().int(),
  candidates_rejected: z.number().int(),
```

and to each question object in `RoundTodaySchema`:

```ts
      // True only when the in-window probe pulled this lock forward because the
      // answer appeared. An AUTHORED early lock is false: both produce a lock
      // before noon, and only this one is the machine catching a leak live.
      lock_healed: z.boolean(),
```

- [ ] **Step 5: Fill them in the route**

In `apps/api/src/routes/round.ts`, `/today`'s question mapping gains one line:

```ts
        locks_at: q.locksAt.toISOString(),
        lock_healed: q.lockHealedAt !== null,
```

and `/:date/reveal`'s response gains two, beside `first_hour`:

```ts
      first_hour: allFirstHour,
      candidates_written: round?.candidatesWritten ?? 0,
      candidates_rejected: round?.candidatesRejected ?? 0,
```

(`round` is already loaded in that handler for `ledger.settled`.)

- [ ] **Step 6: Run the API and core tests**

Run: `pnpm --filter @oracle/api test -- round && pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 7: Put the provenance line on the reveal**

In `apps/mobile/src/app/reveal/[date].tsx`, add `provenanceLine` to the `@oracle/core` import, and add one line inside the muted standing block — the same `<View>` that renders `ledgerLines(d.ledger)`:

```tsx
          <View style={{ alignItems: "center", gap: space(1), marginTop: space(2) }}>
            {ledgerLines(d.ledger).map((line, i) => (
              <Mono key={i} size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>{line}</Mono>
            ))}
            {/* What the night cost, in candidates. It belongs with the standing
                lines rather than the day's headline: it is a fact about the
                machine, not about this player's day. Null — and therefore
                absent — for a bank drop and for every round authored before
                migration 0007. */}
            {provenanceLine(d.candidates_written, d.candidates_rejected) && (
              <Mono size={10} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }}>
                {provenanceLine(d.candidates_written, d.candidates_rejected)}
              </Mono>
            )}
          </View>
```

This block sits inside the reveal's headline `Animated.View`, above the board slot — it does **not** contribute to `BOARD_SLOT_H`, so no height reservation changes. Confirm that by reading the file rather than assuming it: if the block you edit turns out to be inside the board's reserved slot, add one line to `BOARD_LINES_MAX` and say so in your report.

- [ ] **Step 8: Put the healed-lock line on the round screen**

In `apps/mobile/src/app/round.tsx`, add `PIPELINE_LINES` to the `@oracle/core` import (there is no existing one in this file — add `import { PIPELINE_LINES } from "@oracle/core";`), and insert a fixed-height slot directly above the numeral row:

```tsx
      {/* A healed lock is the most dramatic thing this system does, and without
          this line it happens in silence: the numeral is simply struck, the same
          as a slot the player let expire. Shown only for a healed question the
          player never sealed — that is exactly the strike that needs explaining,
          and a player who sealed in time has nothing to be told. Fixed height so
          the layout does not jump when a probe lands mid-session. */}
      <View style={{ height: scaledRow(16, chromeScale), justifyContent: "center" }}>
        {qs.some((q) => q.lock_healed && !answers[q.id]?.sealed) && (
          <Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>
            {PIPELINE_LINES.lockHealed}
          </Mono>
        )}
      </View>
      <View style={{ flexDirection: "row", gap: space(4), justifyContent: "center", paddingTop: space(2) }}>
```

- [ ] **Step 9: Add the mobile test**

Append to `apps/mobile/test/revealRows.test.ts` (or create `apps/mobile/test/provenance.test.ts` if that file's fixtures do not suit):

```ts
import { provenanceLine, PIPELINE_LINES } from "@oracle/core";

describe("the machine's own lines on the player's screens", () => {
  it("says what the night cost when a gauntlet ran", () => {
    expect(provenanceLine(15, 10)).toBe("15 WRITTEN · 10 PUT DOWN");
  });

  it("says nothing at all for a bank drop", () => {
    expect(provenanceLine(0, 0)).toBeNull();
  });

  it("keeps the healed-lock line in the machine's register", () => {
    expect(PIPELINE_LINES.lockHealed).toBe(PIPELINE_LINES.lockHealed.toUpperCase());
    expect(PIPELINE_LINES.lockHealed).not.toContain("!");
  });
});
```

- [ ] **Step 10: Look at it on the simulator**

The unit tests cannot see a layout. Use the project skill — do not hand-roll `xcrun`:

```bash
cd apps/mobile
node .claude/skills/run-oracle-mobile/driver.mjs doctor
node .claude/skills/run-oracle-mobile/driver.mjs up
node .claude/skills/run-oracle-mobile/driver.mjs seed
node .claude/skills/run-oracle-mobile/driver.mjs launch
node .claude/skills/run-oracle-mobile/driver.mjs go /reveal/2026-09-02
node .claude/skills/run-oracle-mobile/driver.mjs shot reveal-provenance
```

**Open the screenshot and look at it.** You are checking two things: that the provenance line appears in the muted block under the day's number without pushing the board off-screen, and that the reveal still fits without clipping. A blank frame or `THE ORACLE SLEEPS` means you have not reached the app — see the skill's troubleshooting table.

The seeded round has `candidates_written = 0`, so the line will be **absent**, which is itself the assertion for the withholding case. To see the line, set the counts on the seeded round first:

```bash
cd apps/api && node -e '
const { neon } = require("@neondatabase/serverless");
const url = require("fs").readFileSync(".dev.vars","utf8").match(/DATABASE_URL=(.*)/)[1].trim();
const sql = neon(url);
sql.query("update rounds set candidates_written=$1, candidates_rejected=$2 where date=$3", [15, 10, "2026-09-02"]).then(() => console.log("stamped"));
'
```

This writes to the **dev** Neon branch and touches only a settled past round's two new provenance columns. If `.dev.vars` is missing, skip this step and report that the visual check for the present-line case could not be run.

Then re-shoot and look again.

- [ ] **Step 11: Full suite, typecheck, commit**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/round.ts apps/mobile/src apps/mobile/test packages/core/test apps/api/test
git commit -m "$(cat <<'MSG'
feat(reveal): the round says what it threw away, and a healed lock stops happening in silence

Claude-Session: https://claude.ai/code/session_01GbuBtBFt6xzihwV6GLCNKa
MSG
)"
```

---

## Test Obligations Checklist

Every one of these comes from spec §13 and must be green at the end. Check them off in the final review, naming the test that covers each.

- [ ] `decideActions` stays pure over `(ETNow, PipelineState)`; the new `probe` action has a throttle test, a `claudeAvailable` gate test, and proof it cannot fire past the lock. *(Task 13)*
- [ ] The pre-flight's inversion is bound to a test that rings when the fake resolver returns `yes`. *(Task 8, Step 5)*
- [ ] The taste gate's fail-closed behaviour has a test per failure mode: throw, timeout, unparseable. *(Task 9)*
- [ ] Resolution disagreement produces `unverifiable` and leaves the DB row untouched — asserted on the row, not on the return value. *(Task 12)*
- [ ] Lock healing never moves a lock later, over a spread of lock and probe times. *(Task 13)*
- [ ] The spend ceiling blocks model calls and does not block `lock`/`publish`/`settle`/`void`. *(Tasks 4 and 14)*
- [ ] `lockFromResolvesAt` at both DST transitions. *(Task 13, Step 6)*
- [ ] §11's copy goes through the copy lint, and the numeral table covers the grown canon. *(Task 2)*
- [ ] `lock_healed_at` is written only by the probe — an authored early lock leaves it null. *(Task 13)*
- [ ] The provenance line is withheld when `candidates_written` is 0. *(Tasks 2 and 15)*
- [ ] Every model call is injected through `PipelineDeps`; fixtures only; no test touches the network. *(all tasks)*

---

## What this plan deliberately does not build

Carried from spec §12, so no implementer adds them on their own initiative:

- **A stored rejection table.** §9.2's counts first; the table when directional tuning stops being enough. Promoting the counts to a table later is purely additive.
- **A bank drill** — deliberately exercising `publish-bank` on a schedule so a stale parachute is found on a normal day. A real gap, but operational hygiene rather than integrity.
- **Retiring or reshaping weather.** Tier 0 keeps the existing "never after-lock" rule and nothing more.
- **`/hold`.** This plan makes the machine the gate instead, which is the whole point; `/reroll` remains as the override.
- **Moving anything to Hermes.** Nothing in the ingestion pipeline depends on it.
- **Push notifications for a healed lock.** See Task 15's preamble.
