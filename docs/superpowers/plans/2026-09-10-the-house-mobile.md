# The House — Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app plays the House as designed: a two-step seal on a five-rung money ladder against the Oracle's line, fortune as the one number on home, reveal, board, record and share, practice on a fixed fortune, and the vocabulary cut to the money words.

**Architecture:** Every screen stays a thin renderer over node-tested pure modules in `apps/mobile/src/game/`, which is the house pattern (vitest, `.test.ts` only, no component tests). The seal becomes a small state machine (`sealFlow.ts`) plus text helpers (`stakeText.ts`) that the rebuilt `OracleCard` renders; the reveal, home, board, record and share each gain one pure module. Copy changes land in `@oracle/core` behind the existing lints plus a new retired-word lint, and the mobile tree gets its own retired-word lint so inline literals cannot drift back. Two API additions: the all-time board and the practice line, plus the house summary on the ledger so home can read it without an open round.

**Tech Stack:** TypeScript, pnpm workspaces, Expo SDK 57 / React Native 0.86 / Reanimated 4 / expo-router, TanStack Query, Zod, Vitest on both packages, Hono + Drizzle (PGlite in tests) for the API.

**Spec:** `docs/superpowers/specs/2026-09-10-the-house-design.md` — §4.2 (the five rungs), §7 (the all-time board and practice rows), §8 (all of it, as amended after the first playtest), §9, §10 (mobile bullets), D11 to D13. The Council split, the reading and the Council-sits state are Plan 3; the reveal only leaves a slot for them.

## Global Constraints

- The ladder is `55, 65, 75, 85, 95`, staking `1, 3, 5, 7, 9` percent of fortune; the Big One doubles each (spec §4.2, D13). The core and the API keep the full 55–95 step-5 grid; only the app's offer narrows.
- The default rung is 75. The fastest seal is two taps: a side, then SEAL (spec §8.2).
- The seal is tap side → tap rung → tap SEAL. The pan gesture, the press-and-hold buttons, the conviction column and the swipe nudge are removed, not hidden (D11).
- Money, not confidence, on the ladder and the receipt: `STAKE 50 · WINS 93` and `YES · STAKED 50 · WINS 93`. The confidence percent is stored as today and appears only in the record's calibration detail (D13).
- Player-facing vocabulary after this plan: the Oracle, the house, the line, fortune, stake, the Big One, seal, streak, streak protection, practice, void. Retired from every player-facing string: vigil, shield, exhibition, rites, ledger, crowd, conviction, epithet, and "Oracle rating" (spec §8.1, D12). "Tide" stays.
- `RITES_LINES` (the archived version 1 canon) is frozen. It is rendered for version 1 reveals and pinned by about twelve copy-lint assertions. Never edit it.
- Do NOT rename: route files (`/rites`, `/ledger`, `/practice`), SecureStore keys (`oracle.rites_seen` etc.), API paths (`/v1/round/exhibition`, `/v1/me/ledger`), the store product id `shield_rescue`, the DB columns `shields_remaining`/`vigil_mult`, or any wire field name (`free_shield_available`, `crowd_yes_pct`…). Only text a player reads changes.
- Two registers (memory `oracle-two-registers`): tracked caps for what is recognised, sentence case for what is read. Reading copy is claims, one sentence per row, never paragraphs. `packages/core/test/reading-register.test.ts` and `apps/mobile/test/typeRegister.test.ts` enforce it.
- Reserved-height slots on home and the reveal are load-bearing (late queries used to shove the composition). Keep every `minHeight` slot; put new content inside a slot or reserve a new one.
- Rounds at `rules_version` 1 and 2 still render: points headline, points rows, the points board. Branch on `rules_version` (today, reveal) or on `metric` (board). Never infer the version from a null field.
- Fortune is never written by the client. The app reads `fortune` from `/v1/round/today` and `/v1/me/ledger` and never computes a balance itself.
- `stakePreview`/`stakeLadder` in core are the only stake arithmetic the app calls. No re-implementation in the app.
- Mobile tests: `cd apps/mobile && npx vitest run test/<file>.test.ts`. Core tests: `cd packages/core && npx vitest run test/<file>.test.ts`. API tests: `cd apps/api && npx vitest run test/<file>.test.ts` (the full API suite is about 6.5 minutes; a bare 5000 ms timeout is contention, not a defect — rerun that file alone).
- Typecheck after every mobile task: `cd apps/mobile && npx tsc --noEmit`.
- Commit after every task with the trailer `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/fortune.ts` (modify) | `LADDER_CONFIDENCES`, `LADDER_DEFAULT`, `stakeLadder()`. |
| `packages/core/src/exhibition.ts` (modify) | `linePYes` on the schema, `PRACTICE_FORTUNE`, `practiceLine()`, `practiceOutcome()`. |
| `packages/core/src/schemas.ts` (modify) | `MeLedgerSchema.house`, `AllTimeBoardSchema`. |
| `packages/core/src/gameCopy.ts`, `copy.ts` (modify) | The vocabulary cut, the four rules sections, the new intro. |
| `packages/core/test/vocabulary.test.ts` (create) | Retired words never appear in player-facing core copy. |
| `apps/api/src/house.ts` (create) | `houseSummary(db)` shared by `/today` and `/me/ledger`. |
| `apps/api/src/routes/board.ts` (create) | `GET /v1/board/all-time`, ranked by fortune. |
| `apps/api/src/exhibition.ts`, `routes/me.ts`, `routes/round.ts`, `app.ts` (modify) | Practice line, ledger house, shared house summary, mounting. |
| `apps/mobile/src/game/sealFlow.ts` (create) | The two-step state machine: side, rung, canSeal. |
| `apps/mobile/src/game/stakeText.ts` (create) | `lineLabel`, `rungLabel`, `ladderReadout`, `receiptLine`, `ladderTable`. |
| `apps/mobile/src/game/fortuneText.ts` (create) | `formatFortune`, `signedFortune`, `returnPct`. |
| `apps/mobile/src/game/houseLine.ts` (create) | Home's house headline lines. |
| `apps/mobile/src/game/revealFortune.ts` (create) | Version 3 reveal: headline, per-card stake receipt, the Oracle take, the line context. |
| `apps/mobile/src/game/fortuneHistory.ts` (create) | Record screen rows. |
| `apps/mobile/src/game/shareLines.ts` (create) | Share card's fortune delta and Big One line; the share message. |
| `apps/mobile/src/game/dailyBoard.ts` (modify) | Return metric lines; all-time board lines. |
| `apps/mobile/src/game/practiceResult.ts` (rewrite) | Practice on the practice fortune. |
| `apps/mobile/src/ui/OracleCard.tsx` (rewrite) | The two-step card. |
| `apps/mobile/src/ui/StakeLadder.tsx` (create) | The five-rung row + readout + SEAL. |
| `apps/mobile/src/ui/ConvictionColumn.tsx`, `game/swipeLean.ts`, `game/payoffLine.ts`, `game/confidence.ts` + their tests (delete) | Retired with the pull. |
| `apps/mobile/src/app/round.tsx`, `index.tsx`, `reveal/[date].tsx`, `ledger.tsx`, `practice.tsx`, `rites.tsx`, `summons.tsx`, `plus.tsx` (modify) | The surfaces. |
| `apps/mobile/src/ui/PracticeCard.tsx`, `ShareCard.tsx`, `PlaqueShareCard.tsx`, `HomeChallenge.tsx`, `SleepsPanel.tsx`, `CrowdReveal.tsx` (modify) | Copy and data. |
| `apps/mobile/src/api/hooks.ts` (modify) | `useAllTimeBoard`. |
| `apps/mobile/src/analytics/analytics.ts` (modify) | `house_headline_viewed`. |
| `apps/mobile/test/vocabulary.test.ts` (create) | Retired words never appear in prose string literals under `src/`. |
| `apps/site/public/index.html`, `support.html` (modify) | The manual mirror of the rules and support text. |
| `docs/superpowers/plans/assets/plan-house-mobile/` (create) | Simulator screenshots. |

---

### Task 1: The ladder, the practice line and the two schemas in core

**Files:**
- Modify: `packages/core/src/fortune.ts` (append after `stakePreview`)
- Modify: `packages/core/src/exhibition.ts`
- Modify: `packages/core/src/schemas.ts` (`MeLedgerSchema`, new `AllTimeBoardSchema` after `RoundBoardSchema`)
- Test: `packages/core/test/fortune.test.ts` (append), `packages/core/test/practice.test.ts` (create), `packages/core/test/schemas-v3.test.ts` (append)

**Interfaces:**
- Consumes: `stake`, `odds`, `payout`, `delta`, `clampLine`, `FORTUNE` from `packages/core/src/fortune.ts`; `ExhibitionSchema`, `ConfidenceSchema`.
- Produces:
  ```ts
  // fortune.ts
  export const LADDER_CONFIDENCES: readonly [55, 65, 75, 85, 95];
  export const LADDER_DEFAULT = 75;
  export type LadderRung = { confidence: number; stake: number; wins: number };
  export function stakeLadder(input: { fortune: number; isBigOne: boolean; line: number; answer: boolean }): LadderRung[];
  // exhibition.ts
  export const PRACTICE_FORTUNE = 1000;
  // ExhibitionSchema gains linePYes: number | null (default null)
  export function practiceLine(exhibition: Exhibition): number;
  export function practiceOutcome(prediction: { answer: boolean; confidence: number }, exhibition: Exhibition):
    { line: number; stake: number; wins: number; payout: number; delta: number; correct: boolean; oppositeDelta: number };
  // schemas.ts
  // MeLedgerSchema gains house: { total: number; last_delta: number | null } | null (default null)
  export const AllTimeBoardSchema; export type AllTimeBoard;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/fortune.test.ts`:

```ts
import { LADDER_CONFIDENCES, LADDER_DEFAULT, stakeLadder } from "../src/fortune";

describe("the five-rung ladder (spec §4.2, D13)", () => {
  it("offers 55, 65, 75, 85, 95 and defaults to 75", () => {
    expect([...LADDER_CONFIDENCES]).toEqual([55, 65, 75, 85, 95]);
    expect(LADDER_DEFAULT).toBe(75);
  });

  it("stakes 1, 3, 5, 7, 9 percent of a 1,000 fortune on an ordinary card", () => {
    const rungs = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: true });
    expect(rungs.map((r) => r.stake)).toEqual([10, 30, 50, 70, 90]);
    expect(rungs.map((r) => r.confidence)).toEqual([55, 65, 75, 85, 95]);
  });

  it("doubles every rung on the Big One", () => {
    const rungs = stakeLadder({ fortune: 1000, isBigOne: true, line: 0.35, answer: true });
    expect(rungs.map((r) => r.stake)).toEqual([20, 60, 100, 140, 180]);
  });

  it("wins at the Oracle's odds for the chosen side", () => {
    // YES at a 35% line pays (1 − 0.35) / 0.35 = 1.857× on top of the stake.
    const yes = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: true });
    expect(yes[2]!.wins).toBe(93); // round(50 × 1.857)
    // NO at the same line pays 0.35 / 0.65 = 0.538×.
    const no = stakeLadder({ fortune: 1000, isBigOne: false, line: 0.35, answer: false });
    expect(no[2]!.wins).toBe(27); // round(50 × 0.538)
  });

  it("holds the floor of one below ten percent of a small fortune, and drops it under ten", () => {
    expect(stakeLadder({ fortune: 40, isBigOne: false, line: 0.5, answer: true }).map((r) => r.stake)).toEqual([1, 1, 2, 3, 4]);
    expect(stakeLadder({ fortune: 5, isBigOne: false, line: 0.5, answer: true }).map((r) => r.stake)).toEqual([0, 0, 0, 0, 0]);
  });
});
```

Create `packages/core/test/practice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExhibitionSchema, PRACTICE_FORTUNE, practiceLine, practiceOutcome } from "../src/exhibition";

const base = {
  id: "q1", kind: "historical" as const, question: "Will it rain?", context: "Clouds.",
  sourceName: "NWS", roundDate: "2026-09-01", oraclePYes: 0.7, outcome: "yes" as const,
};

describe("the practice line (spec §7, §8.3)", () => {
  it("parses an exhibition without a line, defaulting it to null", () => {
    expect(ExhibitionSchema.parse(base).linePYes).toBeNull();
  });

  it("uses the served line when there is one", () => {
    expect(practiceLine(ExhibitionSchema.parse({ ...base, linePYes: 0.42 }))).toBe(0.42);
  });

  it("falls back to the Oracle's forecast clamped to the line bounds", () => {
    expect(practiceLine(ExhibitionSchema.parse(base))).toBe(0.7);
    expect(practiceLine(ExhibitionSchema.parse({ ...base, oraclePYes: 0.01 }))).toBe(0.05);
    expect(practiceLine(ExhibitionSchema.parse({ ...base, oraclePYes: 0.99 }))).toBe(0.95);
  });
});

describe("the practice outcome runs on the practice fortune", () => {
  it("starts every practice at 1,000", () => {
    expect(PRACTICE_FORTUNE).toBe(1000);
  });

  it("pays a right call at the line's odds and never touches a real fortune", () => {
    const ex = ExhibitionSchema.parse({ ...base, linePYes: 0.7 });
    const out = practiceOutcome({ answer: true, confidence: 75 }, ex);
    expect(out.line).toBe(0.7);
    expect(out.stake).toBe(50);
    expect(out.wins).toBe(21); // round(50 × 0.3 / 0.7)
    expect(out.payout).toBe(71);
    expect(out.delta).toBe(21);
    expect(out.correct).toBe(true);
    // Had the outcome gone the other way, the same call loses the stake.
    expect(out.oppositeDelta).toBe(-50);
  });

  it("loses the stake on a wrong call", () => {
    const ex = ExhibitionSchema.parse({ ...base, linePYes: 0.7 });
    const out = practiceOutcome({ answer: false, confidence: 95 }, ex);
    expect(out.stake).toBe(90);
    expect(out.payout).toBe(0);
    expect(out.delta).toBe(-90);
    expect(out.correct).toBe(false);
    expect(out.oppositeDelta).toBe(210); // round(90 × 0.7 / 0.3)
  });

  it("rejects an off-grid confidence", () => {
    expect(() => practiceOutcome({ answer: true, confidence: 72 }, ExhibitionSchema.parse(base))).toThrow();
  });
});
```

Append to `packages/core/test/schemas-v3.test.ts`:

```ts
import { AllTimeBoardSchema, MeLedgerSchema } from "../src/schemas";

describe("the all-time board and the ledger's house (spec §7)", () => {
  it("parses a full all-time board", () => {
    const b = AllTimeBoardSchema.parse({
      field_size: 6, your_fortune: 1140, your_rank: 2, best_fortune: 2002, median_fortune: 940,
      rows: [{ name: "Quiet Heron", fortune: 2002, rank: 1, is_you: false }, { name: "You", fortune: 1140, rank: 2, is_you: true }],
    });
    expect(b.rows[1]!.is_you).toBe(true);
  });

  it("parses a sparse all-time board with nulls and no rows", () => {
    const b = AllTimeBoardSchema.parse({ field_size: 2, your_fortune: 1000, your_rank: null, best_fortune: null, median_fortune: null, rows: [] });
    expect(b.your_rank).toBeNull();
  });

  it("defaults the ledger's house to null so an older server still parses", () => {
    // The smallest ledger the schema accepts, with house absent.
    const minimal = {
      oracle_score: null, percentile: null, cohort_size: 0, calls_rated: 0, calls_answered: 0, days_consulted: 0,
      streak: 0, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null,
      free_shield_available: true, paid_shields: 0, shield_used_on: null, claimed: false,
      epithet: { id: "unread", title: "THE UNREAD", receipt: "" }, computed_through: "2026-09-10",
      oracle: { score: null, calls_rated: 0, days_outseen: 0, days_compared: 0 },
    };
    expect(MeLedgerSchema.parse(minimal).house).toBeNull();
    expect(MeLedgerSchema.parse({ ...minimal, house: { total: -1240, last_delta: -1240 } }).house?.total).toBe(-1240);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run test/fortune.test.ts test/practice.test.ts test/schemas-v3.test.ts`
Expected: FAIL — `stakeLadder`, `LADDER_CONFIDENCES`, `PRACTICE_FORTUNE`, `practiceLine`, `practiceOutcome`, `AllTimeBoardSchema` are not exported; `house` is not a key.

- [ ] **Step 3: Implement**

Append to `packages/core/src/fortune.ts`:

```ts
// The ladder the app offers (design §4.2, D13): five of the nine grid values,
// staking 1, 3, 5, 7 and 9 percent. The core and the API still accept the
// whole grid; only the offer narrows, so an older round or a later client can
// use any value on it.
export const LADDER_CONFIDENCES = [55, 65, 75, 85, 95] as const;
export const LADDER_DEFAULT = 75;

export type LadderRung = { confidence: number; stake: number; wins: number };

/** Every rung priced at the line for the chosen side: the stake, and what a right call wins on top of it. */
export function stakeLadder(input: { fortune: number; isBigOne: boolean; line: number; answer: boolean }): LadderRung[] {
  return LADDER_CONFIDENCES.map((confidence) => {
    const p = stakePreview({ ...input, confidence });
    return { confidence, stake: p.stake, wins: p.pays };
  });
}
```

Rewrite `packages/core/src/exhibition.ts`:

```ts
import { z } from "zod";
import { oracleQuestionPoints } from "./oracleRecord";
import { ConfidenceSchema } from "./schemas";
import { clampLine, payout, stake, odds } from "./fortune";

export const ExhibitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["historical", "fictional"]),
  question: z.string().min(1),
  context: z.string().min(1),
  sourceName: z.string().min(1),
  roundDate: z.string().nullable(),
  oraclePYes: z.number().min(0).max(1),
  outcome: z.enum(["yes", "no"]),
  // The house line the practice card is priced at (design §7). Served by the
  // API for historical questions; null on the fallback fixture, where
  // practiceLine derives one from the Oracle's own forecast.
  linePYes: z.number().min(0).max(1).nullable().default(null),
});

export type Exhibition = z.infer<typeof ExhibitionSchema>;

// Practice runs on a fixed fortune and never touches the player's (design §8.3).
export const PRACTICE_FORTUNE = 1000;

/** The line the practice card plays against. */
export function practiceLine(exhibition: Exhibition): number {
  return exhibition.linePYes ?? clampLine(exhibition.oraclePYes, null);
}

const PracticePredictionSchema = z.object({ answer: z.boolean(), confidence: ConfidenceSchema });

/** The practice result in the game's own currency, on the practice fortune. */
export function practiceOutcome(
  prediction: { answer: boolean; confidence: number },
  exhibition: Exhibition,
): { line: number; stake: number; wins: number; payout: number; delta: number; correct: boolean; oppositeDelta: number } {
  const p = PracticePredictionSchema.parse(prediction);
  const ex = ExhibitionSchema.parse(exhibition);
  const line = practiceLine(ex);
  const s = stake(PRACTICE_FORTUNE, p.confidence, false);
  const wins = Math.round(s * odds(p.answer, line));
  const paid = payout({ stake: s, answer: p.answer, line, outcome: ex.outcome });
  const opposite = payout({ stake: s, answer: p.answer, line, outcome: ex.outcome === "yes" ? "no" : "yes" });
  return { line, stake: s, wins, payout: paid, delta: paid - s, correct: (ex.outcome === "yes") === p.answer, oppositeDelta: opposite - s };
}

// The points duel the practice used to be scored in. Kept for the archived
// tests and for any version 1 or 2 surface; no current screen calls it.
export function compareExhibition(
  prediction: { answer: boolean; confidence: number },
  exhibition: Exhibition,
): { youPoints: number; oraclePoints: number; winner: "you" | "oracle" | "tie" } {
  const validPrediction = PracticePredictionSchema.parse(prediction);
  const validExhibition = ExhibitionSchema.parse(exhibition);
  const youPYes = validPrediction.answer ? validPrediction.confidence / 100 : 1 - validPrediction.confidence / 100;
  const youPoints = oracleQuestionPoints({ pYes: youPYes, outcome: validExhibition.outcome, isBigOne: false });
  const oraclePoints = oracleQuestionPoints({ pYes: validExhibition.oraclePYes, outcome: validExhibition.outcome, isBigOne: false });
  const winner = youPoints === oraclePoints ? "tie" : youPoints > oraclePoints ? "you" : "oracle";
  return { youPoints, oraclePoints, winner };
}
```

If `fortune.ts` imports `./schemas` and `schemas.ts` imports `./fortune`, there is no cycle today (`fortune.ts` imports only `./constants`). `exhibition.ts` importing `./fortune` is fine.

In `packages/core/src/schemas.ts`, add to `MeLedgerSchema` after `fortune_history`:

```ts
  // The purse, so home can print the house headline without an open round
  // (design §8.3). Same shape as /today's `house`. Defaulted for older servers.
  house: z.object({ total: z.number().int(), last_delta: z.number().int().nullable() }).nullable().default(null),
```

And after `RoundBoardSchema`:

```ts
// The all-time board (design §7, §8.3): every player who has settled at least
// one stake, ranked by fortune. Same floor and window as the daily board.
export const AllTimeBoardSchema = z.object({
  field_size: z.number().int(),
  // The caller's fortune. Null when the caller has never settled a stake.
  your_fortune: z.number().int().nullable(),
  your_rank: z.number().int().nullable(),
  best_fortune: z.number().int().nullable(),
  median_fortune: z.number().int().nullable(),
  rows: z.array(z.object({ name: z.string(), fortune: z.number().int(), rank: z.number().int(), is_you: z.boolean() })),
});
export type AllTimeBoard = z.infer<typeof AllTimeBoardSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/core && npx vitest run`
Expected: PASS, including the existing `exhibition.test.ts` (the schema only gained a defaulted field).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): the five-rung ladder, the practice line and outcome, the all-time board schema

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 2: API — the practice line, the ledger's house, the all-time board

**Files:**
- Create: `apps/api/src/house.ts`
- Create: `apps/api/src/routes/board.ts`
- Modify: `apps/api/src/exhibition.ts` (the `projected` object)
- Modify: `apps/api/src/routes/round.ts:26-76` (`/today` uses `houseSummary`)
- Modify: `apps/api/src/routes/me.ts` (`/ledger` adds `house`)
- Modify: `apps/api/src/app.ts` (mount `/v1/board`)
- Test: `apps/api/test/board-all-time.test.ts` (create), `apps/api/test/exhibition.test.ts` (append), `apps/api/test/round-v3.test.ts` (append)

**Interfaces:**
- Consumes: `clampLine`, `CONSTANTS.BOARD_MIN_FIELD/TOP_ROWS/NEIGHBOURS`, `designation`, `disambiguate` from `@oracle/core`; `deviceAuth` from `./auth`; the `world()` helper pattern from `apps/api/test/round-v3.test.ts:13-29`.
- Produces: `GET /v1/board/all-time` → `AllTimeBoard`; `GET /v1/round/exhibition` carries `linePYes`; `GET /v1/me/ledger` carries `house`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/board-all-time.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import { AllTimeBoardSchema } from "@oracle/core";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

async function world(players: number) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const tokens: string[] = [];
  for (let i = 0; i < players; i++) {
    const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
    tokens.push(((await res.json()) as { token: string }).token);
  }
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ linePYes: "0.35", marketProb: "0.40" }).where(eq(schema.questions.roundDate, DATE));
  const as = (i: number) => (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${tokens[i]}`, "content-type": "application/json" } });
  const seal = (i: number, qid: string, answer: boolean, confidence: number) =>
    as(i)("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence, idempotency_key: "k" }) });
  return { db, app, qs, as, seal };
}
afterEach(() => vi.useRealTimers());

describe("GET /v1/board/all-time", () => {
  it("401s without a token", async () => {
    const { app } = await world(1);
    expect((await app.request("/v1/board/all-time")).status).toBe(401);
  });

  it("reports the field size and the caller's fortune, and nothing else, below the floor", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(3);
    for (const q of qs) for (let i = 0; i < 2; i++) await seal(i, q.id, true, 75);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = AllTimeBoardSchema.parse(await (await as(0)("/v1/board/all-time")).json());
    // Player 2 never sealed, so never settled a stake, so is not in the field.
    expect(json.field_size).toBe(2);
    expect(json.your_fortune).toBeGreaterThan(1000);
    expect(json.your_rank).toBeNull();
    expect(json.rows).toEqual([]);
    const spectator = AllTimeBoardSchema.parse(await (await as(2)("/v1/board/all-time")).json());
    expect(spectator.your_fortune).toBeNull();
  });

  it("ranks by fortune with ties sharing the better rank, the summit plus the caller's neighbourhood", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(6);
    // player 0 goes YES at 95 everywhere; 1-4 go NO at 55; player 5 goes YES at 55.
    for (const q of qs) {
      await seal(0, q.id, true, 95);
      for (let i = 1; i < 5; i++) await seal(i, q.id, false, 55);
      await seal(5, q.id, true, 55);
    }
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const top = AllTimeBoardSchema.parse(await (await as(0)("/v1/board/all-time")).json());
    expect(top.field_size).toBe(6);
    expect(top.your_rank).toBe(1);
    expect(top.your_fortune).toBe(2002); // 1000 + 167×4 + 334
    expect(top.best_fortune).toBe(2002);
    // Players 1-4 all lost 60: fortune 940. Sorted: 2002, 1113 (player 5), 940×4 → median of even field = (940+940)/2.
    expect(top.median_fortune).toBe(940);
    expect(top.rows.find((r) => r.is_you)!.fortune).toBe(2002);
    const loser = AllTimeBoardSchema.parse(await (await as(3)("/v1/board/all-time")).json());
    expect(loser.your_rank).toBe(3); // four tied at 940 share rank 3
    expect(loser.rows.filter((r) => r.rank === 3).length).toBeGreaterThanOrEqual(2);
    expect(loser.rows.some((r) => r.is_you)).toBe(true);
    // Never a row with a name a user typed: designations only.
    for (const r of loser.rows) expect(r.name.length).toBeGreaterThan(0);
  });
});
```

Append to `apps/api/test/exhibition.test.ts`, inside its top-level `describe`, using the file's own `resolvedRound(db, date, options)` helper (it seeds a resolved round whose forecast snapshot sets `oraclePYes` on every question via `commit_oracle_forecast`; the selector reads `questions.oracle_prob_yes`, which that function writes):

```ts
  it("prices the practice card at the house line, clamped to the market band", async () => {
    const { db } = await makeTestDb();
    const questions = await resolvedRound(db, "2026-09-01", { oraclePYes: 0.8 });
    // Slot 1 is the first candidate the selector reaches.
    await db.update(schema.questions).set({ marketProb: "0.55" }).where(eq(schema.questions.id, questions[0]!.id));
    const ex = await selectExhibition(db);
    expect(ex?.id).toBe(questions[0]!.id);
    expect(ex?.linePYes).toBeCloseTo(0.7, 10); // 0.80 held to 0.55 + 0.15
  });

  it("prices the practice card at the forecast itself when the question had no market", async () => {
    const { db } = await makeTestDb();
    await resolvedRound(db, "2026-09-01", { oraclePYes: 0.7 });
    const ex = await selectExhibition(db);
    expect(ex?.linePYes).toBeCloseTo(0.7, 10);
  });
```

Append to `apps/api/test/round-v3.test.ts`:

```ts
describe("GET /v1/me/ledger carries the house", () => {
  it("reports the purse total and last night's delta after settlement", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, false, 55); // every stake 10, Big One 20
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    expect(json.house).toEqual({ total: 60, last_delta: 60 });
  });

  it("is null-delta with a zero total before any round settles", async () => {
    const { as } = await world(1);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    expect(json.house).toEqual({ total: 0, last_delta: null });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && npx vitest run test/board-all-time.test.ts test/exhibition.test.ts test/round-v3.test.ts`
Expected: FAIL — 404 on `/v1/board/all-time`, `linePYes` null, `house` absent.

- [ ] **Step 3: Implement**

Create `apps/api/src/house.ts`:

```ts
import { desc, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "./db/client";

// The purse (design §4.4, §7): every settled round's delta since founding, and
// the newest of them. Read as aggregates -- the row set grows by one a day
// forever and /today is the hottest route we serve.
export async function houseSummary(db: Db): Promise<{ total: number; last_delta: number | null }> {
  const [[houseTotal], [houseLast]] = await Promise.all([
    db.select({ total: sql<number>`coalesce(sum(${schema.rounds.houseDelta}), 0)` }).from(schema.rounds).where(isNotNull(schema.rounds.houseDelta)),
    db.select({ delta: schema.rounds.houseDelta }).from(schema.rounds).where(isNotNull(schema.rounds.houseDelta)).orderBy(desc(schema.rounds.date)).limit(1),
  ]);
  return { total: Number(houseTotal?.total ?? 0), last_delta: houseLast?.delta ?? null };
}
```

In `apps/api/src/routes/round.ts` `/today`, replace the inline `Promise.all` that computes `houseTotal`/`houseLast` and the `const house = …` line with:

```ts
    const [user, house] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      houseSummary(db),
    ]);
```

and add `import { houseSummary } from "../house";`. Remove the now-unused `desc`/`isNotNull`/`sql` imports only if nothing else in the file uses them (grep first).

In `apps/api/src/routes/me.ts` `/ledger`: add `import { houseSummary } from "../house";`, compute `const house = await houseSummary(db);` beside the other reads, and add `house,` to the returned JSON after `fortune_history`.

In `apps/api/src/exhibition.ts`: import `clampLine` from `@oracle/core`; before `const projected = …` add:

```ts
    const marketP = question.marketProb === null || question.marketProb === undefined ? null : Number(question.marketProb);
    const linePYes = clampLine(oraclePYes, Number.isFinite(marketP as number) ? marketP : null);
```

and add `linePYes,` to the projected object.

Create `apps/api/src/routes/board.ts`:

```ts
import { Hono } from "hono";
import { count, inArray, isNotNull } from "drizzle-orm";
import { CONSTANTS, designation, disambiguate } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

// The all-time board (design §7, §8.3): every player who has settled at least
// one stake, ranked by fortune. A player who has never staked stands at
// founding and is not in the field -- a board of untouched 1,000s ranks
// nobody. Same floor and window as the daily board; same designations, so
// nothing a user typed reaches the rows.
export const boardRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/all-time", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const staked = await db
      .select({ userId: schema.predictions.userId, n: count() })
      .from(schema.predictions)
      .where(isNotNull(schema.predictions.payout))
      .groupBy(schema.predictions.userId);
    const ids = staked.map((r) => r.userId);
    const users = ids.length ? await db.query.users.findMany({ where: inArray(schema.users.id, ids) }) : [];
    const entries = users.map((u) => ({ userId: u.id, fortune: u.fortune }));
    const field = entries.map((e) => e.fortune);
    const mine = entries.find((e) => e.userId === userId)?.fortune ?? null;
    const empty = { field_size: field.length, your_fortune: mine, your_rank: null as number | null, best_fortune: null as number | null, median_fortune: null as number | null, rows: [] as Array<{ name: string; fortune: number; rank: number; is_you: boolean }> };
    if (field.length < CONSTANTS.BOARD_MIN_FIELD) return c.json(empty);
    const sorted = [...field].sort((a, b) => b - a);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
    // Ties share the better rank: one plus the number of strictly richer players.
    const rankIn = (f: number) => 1 + field.filter((x) => x > f).length;
    const ranked = entries.map((e) => ({ ...e, rank: rankIn(e.fortune), is_you: e.userId === userId })).sort((a, b) => b.fortune - a.fortune);
    const meIdx = ranked.findIndex((r) => r.is_you);
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
    if (meIdx >= 0) for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) if (i >= 0 && i < ranked.length) keep.add(i);
    const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
    const names = disambiguate(shown.map((r) => designation(r.userId)));
    return c.json({
      ...empty,
      your_rank: mine === null ? null : rankIn(mine),
      best_fortune: sorted[0]!,
      median_fortune: median,
      rows: shown.map((r, i) => ({ name: names[i]!, fortune: r.fortune, rank: r.rank, is_you: r.is_you })),
    });
  });
```

In `apps/api/src/app.ts`: `import { boardRoutes } from "./routes/board";` and `app.route("/v1/board", boardRoutes);` after the `/v1/round` mount.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/api && npx vitest run test/board-all-time.test.ts test/exhibition.test.ts test/round-v3.test.ts test/round.test.ts test/ledger.test.ts`
Expected: PASS. If the exhibition assertion's expected line differs because the file's fixture sets a different forecast, correct the expectation to `clampLine(forecast, market)` computed by hand and say so in the commit.

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/core
git commit -m "feat(api): the all-time board, the practice line, and the house on the ledger

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 3: Core copy — the vocabulary cut, the four rules, the lints

**Files:**
- Modify: `packages/core/src/gameCopy.ts`
- Modify: `packages/core/src/copy.ts` (bank lines, `PAYWALL_CTA_LINES`, `PUSH_CAMPAIGN_LINES`, `vigilLine` → `streakLine`, `PLUS_CREED_LINES`, `SUMMONS_LINES`, `READING_LINES`, `INTRO_LINES`, `RITES_V2_SECTIONS`)
- Modify: `packages/core/test/copy-lint.test.ts:271-287` (the paywall block), `packages/core/test/reading-register.test.ts:69-71` (the gesture test)
- Create: `packages/core/test/vocabulary.test.ts`
- Do NOT touch `RITES_LINES` / `OPENING_RITES_LINES` (lines 200-225) or `epithet.ts`.

**Interfaces:**
- Produces: `GAME_TERMS = { product, opponent, players, rulesNav: 'How to play', rulesTitle: 'How to play', history: 'Your record', streak: 'Streak', streakTitle: 'Your streak', playerRating: 'Your forecast rating' }`; `CURRENT_GAME_COPY.protectionUsed` (replaces `shieldUsed`); `streakLine(streak, seedKey)` (replaces `vigilLine`); bank ids `noon.streak-1..4`, `streak.kept-1..5`, `streak.protection-1`; `RITES_V2_SECTIONS` with four sections; `INTRO_LINES` with three tap-based lines.
- Consumers that must change in Task 11: `apps/mobile/src/app/index.tsx` (`vigilLine`, `streak.shield-1`), `apps/mobile/src/game/shieldNotice.ts` (`streak.shield-1`).

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/vocabulary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  COPY_BANK, INTRO_LINES, RITES_V2_SECTIONS, PLUS_CREED_LINES, SCORE_GLOSS, SUMMONS_LINES, CALLING_LINES,
  PARTIAL_LINE, READING_LINES, PIPELINE_LINES, PAYWALL_CTA_LINES, REMINDER_CTA_LINES, PUSH_CAMPAIGN_LINES, LITURGY_LINES,
} from "../src/copy";
import { GAME_TERMS, CURRENT_GAME_COPY } from "../src/gameCopy";

// The vocabulary cut (design 2026-09-10 §8.1, D12). The first playtest called
// the rules confusing and the metaphors a lot to manage; these words are
// retired from everything a player reads. The archived version 1 canon
// (RITES_LINES) keeps them because it is history, and is not scanned here.
export const RETIRED = /\b(vigils?|shields?|exhibitions?|rites?|ledgers?|crowds?|conviction|epithets?|oracle rating)\b/i;

const SURFACE: Array<{ id: string; text: string }> = [
  ...COPY_BANK.map((l) => ({ id: l.id, text: l.text })),
  ...INTRO_LINES.map((text, i) => ({ id: `intro-${i + 1}`, text })),
  ...RITES_V2_SECTIONS.flatMap((s) => [{ id: `${s.title}:title`, text: s.title }, ...s.claims.map((text, i) => ({ id: `${s.title}-${i + 1}`, text }))]),
  ...PLUS_CREED_LINES.map((text, i) => ({ id: `creed-${i + 1}`, text })),
  ...Object.entries(SCORE_GLOSS).map(([id, text]) => ({ id: `gloss.${id}`, text })),
  ...SUMMONS_LINES.map((text, i) => ({ id: `summons-${i + 1}`, text })),
  ...CALLING_LINES.map((text, i) => ({ id: `calling-${i + 1}`, text })),
  { id: "partial", text: PARTIAL_LINE },
  ...Object.entries(READING_LINES).map(([id, text]) => ({ id: `reading.${id}`, text })),
  ...Object.entries(PIPELINE_LINES).map(([id, text]) => ({ id: `pipeline.${id}`, text })),
  ...Object.entries(PAYWALL_CTA_LINES).map(([id, text]) => ({ id: `cta.${id}`, text })),
  ...Object.entries(REMINDER_CTA_LINES).map(([id, text]) => ({ id: `reminder.${id}`, text })),
  ...Object.entries(PUSH_CAMPAIGN_LINES).map(([id, text]) => ({ id: `push.${id}`, text })),
  ...LITURGY_LINES.map((text, i) => ({ id: `liturgy-${i + 1}`, text })),
  ...Object.entries(GAME_TERMS).map(([id, text]) => ({ id: `term.${id}`, text })),
  ...Object.entries(CURRENT_GAME_COPY).map(([id, text]) => ({ id: `copy.${id}`, text })),
];

describe("the vocabulary cut", () => {
  it("scans something", () => {
    expect(SURFACE.length).toBeGreaterThan(100);
  });

  it("never lets a retired word reach a player", () => {
    for (const { id, text } of SURFACE) {
      expect(text, `${id}: "${text}"`).not.toMatch(RETIRED);
    }
  });

  it("names the money words in the rules", () => {
    const rules = RITES_V2_SECTIONS.flatMap((s) => s.claims).join(" ").toLowerCase();
    for (const word of ["line", "stake", "fortune", "big one", "streak protection", "practice", "void"]) {
      expect(rules, word).toContain(word);
    }
  });

  it("keeps the rules to four sections and about twenty claims", () => {
    expect(RITES_V2_SECTIONS.length).toBe(4);
    const claims = RITES_V2_SECTIONS.reduce((n, s) => n + s.claims.length, 0);
    expect(claims).toBeGreaterThanOrEqual(18);
    expect(claims).toBeLessThanOrEqual(24);
  });
});
```

Edit `packages/core/test/reading-register.test.ts` — replace the `"teaches the gesture that sets confidence"` case body:

```ts
  it("teaches the two-step seal", () => {
    // The one interaction the whole app turns on (design D11): a side, a
    // stake, a seal. It lives in the opening lines, which every first-time
    // player is shown.
    const intro = INTRO_LINES.join(" ").toLowerCase();
    expect(intro, "the opening lines must say how a side is chosen").toContain("tap");
    expect(intro, "the opening lines must say what is chosen next").toContain("stake");
    expect(intro, "the opening lines must say how a call is committed").toContain("seal");
  });
```

Edit `packages/core/test/copy-lint.test.ts` — in `"the paywall states the mechanic it charges for"` replace the last two assertions:

```ts
    // What the subscription actually grants, in the player's words.
    expect(shown).toContain("THREE PROTECTIONS");
    // The wall that makes the whole economy honest, said at the till (D7).
    expect(shown).toContain("FORTUNE IS NEVER SOLD");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/core && npx vitest run test/vocabulary.test.ts test/reading-register.test.ts test/copy-lint.test.ts`
Expected: FAIL on retired words throughout, on "tap"/"stake", and on "THREE PROTECTIONS".

- [ ] **Step 3: Rewrite the copy**

`packages/core/src/gameCopy.ts` in full:

```ts
/** Current vocabulary. Historical rules remain in copy.ts, explicitly versioned. */
export const GAME_TERMS = {
  product: 'Outseen', opponent: 'The Oracle', players: 'players',
  rulesNav: 'How to play', rulesTitle: 'How to play',
  history: 'Your record', streak: 'Streak', streakTitle: 'Your streak',
  playerRating: 'Your forecast rating',
} as const;
export const CURRENT_GAME_COPY = {
  purpose: 'Make your call. Beat the Oracle's line. Grow your fortune.',
  oracleIdentity: 'The Oracle makes predictions using AI.',
  opponentChallenge: 'Can you outsee it?',
  streakMeaning: 'Your streak is one call a day. It adds no fortune.',
  lapse: 'A new streak begins with your next call. Your fortune, results and record remain.',
  protectionUsed: 'Streak protection held your streak. No calls were added.',
} as const;
```

In `packages/core/src/copy.ts`, make exactly these text changes (ids in the left column; keep `pool` and `requires` as they are):

| id / export | new text |
| --- | --- |
| `noon.tide-2` | `THE PLAYERS WENT ONE WAY. YOU WENT THE OTHER. THE RECORD BOWED TO YOU.` |
| `noon.tide-3` | `FEW STOOD WHERE YOU STOOD. THE HOUSE PAID.` |
| `noon.vigil-1..4` → rename ids `noon.streak-1..4` | `YOUR STREAK: {streak} DAYS. ONE CALL AT A TIME.` |
| `resolve.plain-5` | `THE RECORD READS {outcome}. YOU CALLED {call}. {points}.` |
| `streak.vigil-1..5` → rename ids `streak.kept-1..5` | `YOUR STREAK: {streak} DAYS. ONE CALL AT A TIME.` |
| `streak.lapse-2` | `A GAP IN THE RECORD IS NOT THE END OF IT.` |
| `streak.shield-1` → rename id `streak.protection-1` | `CURRENT_GAME_COPY.protectionUsed.toUpperCase()` |
| `paywall.rescue-1` | `STREAK PROTECTION MAY CARRY AN ELIGIBLE STREAK THROUGH A MISSED ROUND.` |
| `paywall.terms-1` | `EVERY ROUND IS FREE TO PLAY. FORTUNE IS NEVER SOLD.` |
| `PAYWALL_CTA_LINES.rescue` | `PROTECT THE STREAK` |
| `PUSH_CAMPAIGN_LINES.plusWelcome` | `OUTSEEN PLUS IS ACTIVE. STREAK PROTECTION DEPENDS ON YOUR STREAK AND AVAILABLE RESERVE.` |
| `SUMMONS_LINES[1]` | `AN INVITATION TO PLAY OR RETURN TO YOUR RECORD.` |
| `READING_LINES.settled` | `THE NIGHT IS SETTLED` |
| `READING_LINES.settledCta` | `SEE THE RESULT` |

Rename `VIGIL_LINES` → `STREAK_LINES` and `vigilLine` → `streakLine` (same body; the filter reads `l.pool === "streak" && l.requires?.includes("streak") && !l.id.startsWith("streak.risk")` — keep whatever it is, only the names change). Update the comments above the bank pools so they no longer say vigil/shield (comments are not linted, but leave no false trail).

Replace `PLUS_CREED_LINES`:

```ts
export const PLUS_CREED_LINES = [
  "Streak protection carries a streak of three days or more through one missed round.",
  "One free protection each month. Plus adds three protections per billing period, capped at five paid protections per grant.",
  "Protection covers your streak, not your fortune or your rating. No calls or wins are added.",
  "It needs an eligible streak and an available protection.",
] as const;
```

Replace `INTRO_LINES`:

```ts
export const INTRO_LINES = [
  "The Oracle posts its line on five questions a day.",
  "Tap YES or NO, then tap a stake from your fortune, then seal it.",
  "Right calls pay at the Oracle's odds. Wrong calls lose the stake.",
] as const;
```

Replace `RITES_V2_SECTIONS` (the `rite()` helper is unchanged):

```ts
export const RITES_V2_SECTIONS = [
  rite("The game", ["line", "stake", "fortune", "big one"], [
    "Five questions a day about what happens next, each a live market.",
    "On every question the Oracle posts its line: its own chance of YES.",
    "Take a side and choose a stake, a slice of your fortune.",
    "A right call wins the stake at the Oracle's odds; a wrong call loses it.",
    `Your fortune starts at ${FORTUNE.FOUNDING.toLocaleString("en-US")}. It can fall hard, but it never reaches zero.`,
    "The Big One doubles the stake, in both directions.",
  ]),
  rite("Results and the board", ["reveal", "return", "void"], [
    "Questions settle from their markets after they close.",
    "The reveal shows each stake, what it paid, and whether the house won or lost the night.",
    "The daily board ranks players by return: what the day won or lost as a share of the fortune they started it with.",
    "The all-time board ranks players by fortune.",
    "A void question returns its stake to everyone.",
    `A placing needs at least ${CONSTANTS.BOARD_MIN_FIELD} eligible players and every non-void question sealed.`,
  ]),
  rite("Your record", ["streak", "streak protection", "calibration"], [
    CURRENT_GAME_COPY.streakMeaning,
    `Streak protection carries a streak of ${CONSTANTS.SHIELD_MIN_STREAK} days or more through one missed round, adding no calls.`,
    "One free protection each month; Plus adds more.",
    "Practice questions do not count.",
    "Your calibration is how well your confidence matched what happened, kept beside your fortune as the judgment record.",
  ]),
  rite("Timing and fairness", ["lock"], [
    "Every question has its own lock; nothing seals after it.",
    "Results follow the market's settlement, not a guaranteed time.",
    "Unsettled questions are pending, never losses.",
    "A correction can update your record and your fortune.",
    "Older rounds keep their own rules; open one to read them.",
  ]),
];
```

Add `import { FORTUNE } from "./fortune";` at the top of `copy.ts` beside the existing `CONSTANTS` import. `rites-terms.test.ts` requires every `defines` term to appear word-bounded in its own section's claims exactly once as the first match; the claims above satisfy that ("streak" is consumed by the first claim of "Your record", so "streak protection" is matched in the second).

- [ ] **Step 4: Run the whole core suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS. If `copy-lint` complains about a pool floor or an id prefix, the rename of an id was mistyped; if `reading-register` flags a capitalised word, it is `YES` (allowed) or a stray caps word in a claim.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): the vocabulary cut and the four rules of the House

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: The seal's pure modules — `sealFlow`, `stakeText`, `fortuneText`

**Files:**
- Create: `apps/mobile/src/game/sealFlow.ts`, `apps/mobile/src/game/stakeText.ts`, `apps/mobile/src/game/fortuneText.ts`
- Test: `apps/mobile/test/sealFlow.test.ts`, `apps/mobile/test/stakeText.test.ts`, `apps/mobile/test/fortuneText.test.ts`

**Interfaces:**
- Consumes: `LADDER_CONFIDENCES`, `LADDER_DEFAULT`, `stakeLadder`, `stakeFraction`, `FORTUNE` from `@oracle/core`.
- Produces:
  ```ts
  // sealFlow.ts
  export type SealChoice = { side: boolean | null; confidence: number };
  export const INITIAL_CHOICE: SealChoice;               // { side: null, confidence: 75 }
  export function chooseSide(c: SealChoice, side: boolean): SealChoice;   // sets side, keeps rung
  export function chooseRung(c: SealChoice, confidence: number): SealChoice; // only on the ladder, only with a side
  export function canSeal(c: SealChoice): c is SealChoice & { side: boolean };
  // stakeText.ts
  export function lineLabel(line: number | null): string | null;          // "THE ORACLE'S LINE · 35% YES"
  export function rungLabel(r: { stake: number; wins: number }): string;  // "STAKE 50 · WINS 93"
  export function rungA11y(r: { stake: number; wins: number }): string;   // "Stake 50, wins 93"
  export function unstakedRungLabel(confidence: number): string;          // "75% SURE" — lineless rounds
  export function receiptLine(input: { answer: boolean; stake: number | null; wins: number | null; confidence: number }): string;
  export function ladderTable(): Array<{ rung: string; percent: string; bigOne: string; example: string }>;
  // fortuneText.ts
  export function formatFortune(n: number): string;      // "1,240"
  export function signedFortune(n: number): string;      // "+140" / "−60" / "0"
  export function returnPct(bp: number): string;         // "+10.2%" / "−0.6%" / "0.0%"
  ```

- [ ] **Step 1: Write the failing tests**

`apps/mobile/test/sealFlow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { INITIAL_CHOICE, chooseSide, chooseRung, canSeal } from "../src/game/sealFlow";

describe("the two-step seal (design D11)", () => {
  it("starts with no side and the middle rung", () => {
    expect(INITIAL_CHOICE).toEqual({ side: null, confidence: 75 });
    expect(canSeal(INITIAL_CHOICE)).toBe(false);
  });

  it("a side makes the choice sealable at the default rung, so two taps is the fastest seal", () => {
    const c = chooseSide(INITIAL_CHOICE, true);
    expect(c).toEqual({ side: true, confidence: 75 });
    expect(canSeal(c)).toBe(true);
  });

  it("switching side keeps the rung", () => {
    const c = chooseRung(chooseSide(INITIAL_CHOICE, true), 95);
    expect(chooseSide(c, false)).toEqual({ side: false, confidence: 95 });
  });

  it("a rung needs a side first, and must be on the ladder", () => {
    expect(chooseRung(INITIAL_CHOICE, 95)).toEqual(INITIAL_CHOICE);
    const sided = chooseSide(INITIAL_CHOICE, true);
    expect(chooseRung(sided, 60)).toEqual(sided);   // on the grid, not on the ladder
    expect(chooseRung(sided, 55).confidence).toBe(55);
    expect(chooseRung(sided, 95).confidence).toBe(95);
  });
});
```

`apps/mobile/test/stakeText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lineLabel, rungLabel, rungA11y, unstakedRungLabel, receiptLine, ladderTable } from "../src/game/stakeText";

describe("the card's money text (design §8.2)", () => {
  it("prints the Oracle's line as a YES percentage, and nothing when there is no line", () => {
    expect(lineLabel(0.35)).toBe("THE ORACLE'S LINE · 35% YES");
    expect(lineLabel(0.5)).toBe("THE ORACLE'S LINE · 50% YES");
    expect(lineLabel(null)).toBeNull();
  });

  it("prints a rung as stake and winnings, never as confidence", () => {
    expect(rungLabel({ stake: 50, wins: 93 })).toBe("STAKE 50 · WINS 93");
    expect(rungLabel({ stake: 1240, wins: 2303 })).toBe("STAKE 1,240 · WINS 2,303");
    expect(rungA11y({ stake: 50, wins: 93 })).toBe("Stake 50, wins 93");
  });

  it("falls back to confidence on a round without a line", () => {
    expect(unstakedRungLabel(75)).toBe("75% SURE");
  });

  it("writes the receipt in money, or in confidence when the round was unstaked", () => {
    expect(receiptLine({ answer: true, stake: 50, wins: 93, confidence: 75 })).toBe("YES · STAKED 50 · WINS 93");
    expect(receiptLine({ answer: false, stake: 0, wins: 0, confidence: 55 })).toBe("NO · STAKED 0 · WINS 0");
    expect(receiptLine({ answer: false, stake: null, wins: null, confidence: 85 })).toBe("NO · 85% SURE");
  });

  it("tables the ladder for the rules at a founding fortune", () => {
    const rows = ladderTable();
    expect(rows.map((r) => r.percent)).toEqual(["1%", "3%", "5%", "7%", "9%"]);
    expect(rows.map((r) => r.bigOne)).toEqual(["2%", "6%", "10%", "14%", "18%"]);
    expect(rows.map((r) => r.example)).toEqual(["10", "30", "50", "70", "90"]);
    expect(rows.map((r) => r.rung)).toEqual(["I", "II", "III", "IV", "V"]);
  });
});
```

`apps/mobile/test/fortuneText.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatFortune, signedFortune, returnPct } from "../src/game/fortuneText";

describe("fortune formatting", () => {
  it("groups thousands", () => {
    expect(formatFortune(1000)).toBe("1,000");
    expect(formatFortune(940)).toBe("940");
    expect(formatFortune(-1240)).toBe("−1,240");
  });
  it("signs a delta with a true minus sign", () => {
    expect(signedFortune(140)).toBe("+140");
    expect(signedFortune(-60)).toBe("−60");
    expect(signedFortune(0)).toBe("0");
    expect(signedFortune(1002)).toBe("+1,002");
  });
  it("prints basis points as a signed percent with one decimal", () => {
    expect(returnPct(10020)).toBe("+100.2%");
    expect(returnPct(-600)).toBe("−6.0%");
    expect(returnPct(0)).toBe("0.0%");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && npx vitest run test/sealFlow.test.ts test/stakeText.test.ts test/fortuneText.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/mobile/src/game/sealFlow.ts`:

```ts
import { LADDER_CONFIDENCES, LADDER_DEFAULT } from "@oracle/core";

// The two-step seal (design D11): tap a side, tap a rung, tap SEAL. Pure --
// node-tested. The card renders this; it decides nothing itself.
export type SealChoice = { side: boolean | null; confidence: number };

export const INITIAL_CHOICE: SealChoice = { side: null, confidence: LADDER_DEFAULT };

export function chooseSide(c: SealChoice, side: boolean): SealChoice {
  return { ...c, side };
}

export function chooseRung(c: SealChoice, confidence: number): SealChoice {
  if (c.side === null) return c;
  if (!(LADDER_CONFIDENCES as readonly number[]).includes(confidence)) return c;
  return { ...c, confidence };
}

export function canSeal(c: SealChoice): c is SealChoice & { side: boolean } {
  return c.side !== null;
}
```

`apps/mobile/src/game/fortuneText.ts`:

```ts
// Fortune is unit-less by design (design §15). Thousands are grouped so 1240
// reads as money and not as a score; a loss carries a true minus sign, never
// the ASCII hyphen -- these are receipts.
export function formatFortune(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US");
  return n < 0 ? `−${abs}` : abs;
}

export function signedFortune(n: number): string {
  if (n > 0) return `+${formatFortune(n)}`;
  if (n < 0) return formatFortune(n);
  return "0";
}

// The board carries return in basis points so the wire stays integer.
export function returnPct(bp: number): string {
  const pct = (Math.abs(bp) / 100).toFixed(1);
  return bp > 0 ? `+${pct}%` : bp < 0 ? `−${pct}%` : `${pct}%`;
}
```

`apps/mobile/src/game/stakeText.ts`:

```ts
import { FORTUNE, LADDER_CONFIDENCES, stakeFraction } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { numeral } from "./numerals";

// The card's money text (design §8.2, D13). Money, never confidence, on the
// ladder and the receipt; the confidence percent is stored and shown only in
// the record's calibration detail. Machine register throughout.
export function lineLabel(line: number | null): string | null {
  if (line === null) return null;
  return `THE ORACLE'S LINE · ${Math.round(line * 100)}% YES`;
}

export function rungLabel(r: { stake: number; wins: number }): string {
  return `STAKE ${formatFortune(r.stake)} · WINS ${formatFortune(r.wins)}`;
}

export function rungA11y(r: { stake: number; wins: number }): string {
  return `Stake ${formatFortune(r.stake)}, wins ${formatFortune(r.wins)}`;
}

// A round whose line commit missed opens unstaked (design §5.5); the ladder
// still has to say something, so it says the one thing it knows.
export function unstakedRungLabel(confidence: number): string {
  return `${confidence}% SURE`;
}

export function receiptLine(input: { answer: boolean; stake: number | null; wins: number | null; confidence: number }): string {
  const side = input.answer ? "YES" : "NO";
  if (input.stake === null || input.wins === null) return `${side} · ${unstakedRungLabel(input.confidence)}`;
  return `${side} · STAKED ${formatFortune(input.stake)} · WINS ${formatFortune(input.wins)}`;
}

// The five rungs for the rules screen, at a founding fortune.
export function ladderTable(): Array<{ rung: string; percent: string; bigOne: string; example: string }> {
  const pct = (f: number) => `${Math.round(f * 100)}%`;
  return LADDER_CONFIDENCES.map((c, i) => ({
    rung: numeral(i + 1),
    percent: pct(stakeFraction(c, false)),
    bigOne: pct(stakeFraction(c, true)),
    example: formatFortune(Math.round(FORTUNE.FOUNDING * stakeFraction(c, false))),
  }));
}
```

`numeral` lives in `apps/mobile/src/game/numerals.ts` (already exists; `numeral(1) === "I"`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/mobile && npx vitest run test/sealFlow.test.ts test/stakeText.test.ts test/fortuneText.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/sealFlow.ts apps/mobile/src/game/stakeText.ts apps/mobile/src/game/fortuneText.ts apps/mobile/test/sealFlow.test.ts apps/mobile/test/stakeText.test.ts apps/mobile/test/fortuneText.test.ts
git commit -m "feat(mobile): the two-step seal's state and money text

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 5: The card — tap side, tap rung, tap SEAL

**Files:**
- Create: `apps/mobile/src/ui/StakeLadder.tsx`
- Rewrite: `apps/mobile/src/ui/OracleCard.tsx`
- Modify: `apps/mobile/src/app/round.tsx` (remove the lean/column/floor-rite machinery; pass `fortune`)
- Modify: `apps/mobile/src/ui/PracticeCard.tsx` (only enough to compile: drop `onLean`, `ConvictionColumn`, `payoffLine`, `confidenceMeaning`; pass `fortune={PRACTICE_FORTUNE}` and a line — Task 10 finishes it)
- Delete: `apps/mobile/src/ui/ConvictionColumn.tsx`, `apps/mobile/src/game/swipeLean.ts`, `apps/mobile/src/game/payoffLine.ts`, `apps/mobile/src/game/confidence.ts`, `apps/mobile/test/swipeLean.test.ts`, `apps/mobile/test/payoffLine.test.ts`, `apps/mobile/test/confidence.test.ts`
- Modify: `apps/mobile/src/api/flags.ts` — remove `getSwipeHinted`/`markSwipeHinted` and `getFloorNoticed`/`markFloorNoticed` and their keys if nothing else imports them (grep first).

**Interfaces:**
- Consumes: `sealFlow`, `stakeText`, `stakeLadder`, `LADDER_DEFAULT`; `useSubmit`, `useRoundStore`, `cardStatus`, `useNow`, `CardChrome`, `DecodeLine`, `Mono`, `GoldButton`.
- Produces:
  ```tsx
  export function OracleCard(props: {
    q: RoundToday["questions"][number];
    roundLocksAt: string | null;
    // The player's fortune at this moment; null on a round without stakes
    // (version 1/2, or a version 3 round that opened unstaked).
    fortune: number | null;
    // Fires when the seal ceremony completes, with the receipt the round's
    // footer prints under the next card: "YES · STAKED 50 · WINS 93".
    onSealed: (receipt: string) => void;
    practice?: { onSeal: (answer: boolean, confidence: number) => void; context?: string; stamp: string };
    height?: number;
  }): JSX.Element;
  export function StakeLadder(props: {
    rungs: Array<{ confidence: number; stake: number; wins: number }> | null; // null = unstaked round
    selected: number; onSelect: (confidence: number) => void; disabled?: boolean;
  }): JSX.Element;
  ```
  No `onLean`, no `forceButtons`.

- [ ] **Step 1: Delete the retired modules and confirm nothing else imports them**

```bash
cd apps/mobile
git rm src/ui/ConvictionColumn.tsx src/game/swipeLean.ts src/game/payoffLine.ts src/game/confidence.ts test/swipeLean.test.ts test/payoffLine.test.ts test/confidence.test.ts
# useScreenReader was the buttons-mode switch; delete it too if this grep shows no other importer.
grep -rn "useScreenReader" src
grep -rn "swipeLean\|payoffLine\|confidenceMeaning\|confidenceReading\|snapConfidence\|ConvictionColumn\|getSwipeHinted\|markSwipeHinted\|getFloorNoticed\|markFloorNoticed\|AsciiCharge" src test
```

Expected after the rewrite below: only `game/revealRows.ts` (a comment mentioning payoffLine — edit the comment to say "the receipt's formatting") and `ui/TerminalPatina.tsx` (the `AsciiCharge` export, now unused — delete the export and its helpers if nothing else uses them).

- [ ] **Step 2: Create `StakeLadder.tsx`**

```tsx
import { Pressable, View } from "react-native";
import { LADDER_CONFIDENCES } from "@oracle/core";
import { rungA11y, rungLabel, unstakedRungLabel } from "../game/stakeText";
import { formatFortune } from "../game/fortuneText";
import { Mono } from "./Text";
import { colors, space } from "../theme";

// The five rungs (design §8.2, D13): a row, not a column, so it fits under the
// question inside the card. Each rung shows its stake over its winnings; the
// readout under the row says the selected rung in full. Money, never
// confidence. Machine register: this is chrome.
export function StakeLadder({ rungs, selected, onSelect, disabled = false }: {
  rungs: Array<{ confidence: number; stake: number; wins: number }> | null;
  selected: number;
  onSelect: (confidence: number) => void;
  disabled?: boolean;
}) {
  const current = rungs?.find((r) => r.confidence === selected) ?? null;
  return (
    <View style={{ gap: space(2) }}>
      <View style={{ flexDirection: "row", gap: space(1) }}>
        {LADDER_CONFIDENCES.map((c) => {
          const r = rungs?.find((x) => x.confidence === c) ?? null;
          const sel = c === selected;
          return (
            <Pressable
              key={c}
              accessibilityRole="button"
              accessibilityState={{ selected: sel, disabled }}
              accessibilityLabel={r ? rungA11y(r) : unstakedRungLabel(c)}
              disabled={disabled}
              onPress={() => onSelect(c)}
              style={{ flex: 1, minHeight: 48, borderWidth: 1, borderColor: sel ? colors.agedGold : colors.line, backgroundColor: sel ? colors.goldWash : "transparent", alignItems: "center", justifyContent: "center", gap: 2 }}
            >
              <Mono size={13} color={sel ? colors.ink : colors.mutedInk} letterSpacing={1}>{r ? formatFortune(r.stake) : `${c}%`}</Mono>
              {r && <Mono size={9} color={sel ? colors.goldText : colors.mutedInk} letterSpacing={1}>{`+${formatFortune(r.wins)}`}</Mono>}
            </Pressable>
          );
        })}
      </View>
      <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>
        {current ? rungLabel(current) : unstakedRungLabel(selected)}
      </Mono>
    </View>
  );
}
```

- [ ] **Step 3: Rewrite `OracleCard.tsx`**

Keep `QUESTION_FACE`, `QuestionFace`, `THROW_MS`, the decode constants, `finishSeal`, the `coordinate`/`title`/`modifiers` derivations, the wash layer and the throw-on-seal exactly as they are. Replace everything about the pan, the hold buttons, the nudge, the lean callback and the charge overlay. The file becomes:

```tsx
import { claimFirstLiveSeal, recordSealHour } from "../api/flags";
import { useState } from "react";
import { View, Pressable, StyleSheet, useWindowDimensions, Linking } from "react-native";
import * as Haptics from "expo-haptics";
import { ScrollView } from "react-native-gesture-handler";
import { useQueryClient } from "@tanstack/react-query";
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSpring, Easing, useReducedMotion, runOnJS } from "react-native-reanimated";
import { ApiError } from "../api/client";
import { useSubmit } from "../api/hooks";
import { useRoundStore } from "../game/roundStore";
import { cardStatus } from "../game/cardStatus";
import { useNow } from "../game/useNow";
import { capture } from "../analytics/analytics";
import { INITIAL_CHOICE, canSeal, chooseRung, chooseSide, type SealChoice } from "../game/sealFlow";
import { lineLabel, receiptLine } from "../game/stakeText";
import { colors, space } from "../theme";
import { Mono } from "./Text";
import { GoldButton } from "./Button";
import { CardChrome, numeral } from "./CardChrome";
import { DecodeLine } from "./DecodeText";
import { StakeLadder } from "./StakeLadder";
import { stakeLadder, type RoundToday } from "@oracle/core";

// The throw IS the seal: tap SEAL and the card leaves your hand -- off the
// screen edge of the side you took, one heavy thunk at dispatch. The next card
// deals in under it. If the oracle refuses, the card flies back in.
const THROW_MS = 320;
// How far the card leans toward a chosen side, in points. A lean, not a pull:
// the side is a tap now (design D11), and the card acknowledges it.
const LEAN_PX = 18;

export const QUESTION_FACE = { size: 22, lineHeight: 32 } as const;
const DECODE_DELAY_MS = 250;
const DECODE_MS = 600;

function QuestionFace({ text, seed }: { text: string; seed: string }) {
  return (
    <DecodeLine serif text={text} seed={seed} delayMs={DECODE_DELAY_MS} durationMs={DECODE_MS} size={QUESTION_FACE.size} color={colors.ink} dimColor={colors.mutedInk} style={{ lineHeight: QUESTION_FACE.lineHeight, textAlign: "center" }} />
  );
}

export function OracleCard({ q, roundLocksAt, fortune, onSealed, practice, height }: {
  q: RoundToday["questions"][number];
  roundLocksAt: string | null;
  fortune: number | null;
  onSealed: (receipt: string) => void;
  practice?: { onSeal: (answer: boolean, confidence: number) => void; context?: string; stamp: string };
  height?: number;
}) {
  const { answers, setAnswer, setConfidence, markSealed } = useRoundStore();
  const { width: screenW } = useWindowDimensions();
  const entry = practice ? undefined : answers[q.id];
  const submit = useSubmit();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [thrown, setThrown] = useState(false);
  const [choice, setChoice] = useState<SealChoice>(INITIAL_CHOICE);
  const reducedMotion = useReducedMotion();
  const dragX = useSharedValue(0);
  const cardW = useSharedValue(0);
  const [showContext, setShowContext] = useState(false);
  const sealed = !!entry?.sealed;
  const now = useNow(sealed ? null : 1000);

  const line = q.line_p_yes;
  const staked = fortune !== null && line !== null;
  const rungs = staked && choice.side !== null
    ? stakeLadder({ fortune, isBigOne: q.is_big_one, line, answer: choice.side })
    : null;

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: reducedMotion ? 0 : dragX.value },
      { rotate: `${reducedMotion ? 0 : (dragX.value / Math.max(1, cardW.value)) * 8}deg` },
    ],
  }));
  // The side washes: the chosen side's sleeve colour bleeds in behind the
  // question. Same tokens as the selected button, so the card and its
  // controls speak one colour language.
  const yesWashStyle = useAnimatedStyle(() => ({ opacity: dragX.value > 0 ? Math.min(1, dragX.value / LEAN_PX) : 0 }));
  const noWashStyle = useAnimatedStyle(() => ({ opacity: dragX.value < 0 ? Math.min(1, -dragX.value / LEAN_PX) : 0 }));

  function pickSide(side: boolean) {
    if (sealed || thrown || submit.isPending) return;
    setError(null);
    setChoice((c) => chooseSide(c, side));
    void Haptics.selectionAsync();
    if (!reducedMotion) dragX.value = withSpring((side ? 1 : -1) * LEAN_PX, { damping: 18, stiffness: 220 });
  }

  function pickRung(confidence: number) {
    setChoice((c) => chooseRung(c, confidence));
    void Haptics.selectionAsync();
  }

  function finishSeal(answer: boolean, confidence: number) {
    markSealed(q.id);
    capture("question_answered", { question_id: q.id, is_big_one: q.is_big_one, confidence, staked });
    void recordSealHour(new Date());
    const rung = rungs?.find((r) => r.confidence === confidence) ?? null;
    onSealed(receiptLine({ answer, stake: rung?.stake ?? null, wins: rung?.wins ?? null, confidence }));
  }

  async function seal() {
    if (!canSeal(choice)) return;
    const answer = choice.side;
    const confidence = choice.confidence;
    setError(null);
    if (!practice) {
      setAnswer(q.id, answer);
      setConfidence(q.id, confidence);
    }
    const key = practice ? null : useRoundStore.getState().answers[q.id]!.idempotencyKey;
    let flight: Promise<void> = Promise.resolve();
    if (!reducedMotion) {
      setThrown(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      flight = new Promise<void>((resolve) => {
        dragX.value = withTiming((answer ? 1 : -1) * screenW * 1.2, { duration: THROW_MS, easing: Easing.in(Easing.poly(3)) }, () => { runOnJS(resolve)(); });
      });
    }
    if (practice) {
      await flight;
      practice.onSeal(answer, confidence);
      return;
    }
    try {
      const res = await submit.mutateAsync({ question_id: q.id, answer, confidence, idempotency_key: key! });
      if (await claimFirstLiveSeal()) capture("first_live_seal", { stake: res.stake });
      await flight;
      if (reducedMotion) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      finishSeal(answer, confidence);
    } catch (e) {
      await flight;
      setThrown(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      if (!reducedMotion) dragX.value = withSpring((answer ? 1 : -1) * LEAN_PX, { damping: 16, stiffness: 160 });
      setError(e instanceof ApiError && e.status === 409 ? "THE ORACLE HAS CLOSED" : "THE CONNECTION WAVERS — TRY AGAIN");
      if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ["round", "today"] });
    }
  }

  const coordinate = `:: ${numeral(q.slot)} / PER ${q.source_name.toUpperCase()}`;
  const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;
  const title = q.is_big_one ? "✶ THE BIG ONE" : q.category;
  const modifiers = [q.is_big_one ? "STAKES DOUBLE" : null, closesEarly ? "CLOSES EARLY" : null].filter(Boolean).join(" · ");
  const lineText = lineLabel(line);
  const busy = sealed || thrown || submit.isPending;

  return (
    <View>
      <Animated.View style={frontStyle} onLayout={(e) => { cardW.value = e.nativeEvent.layout.width; }}>
        <CardChrome height={height} slot={q.slot} title={title} modifiers={modifiers} big={q.is_big_one} coordinate={coordinate}
          status={practice ? practice.stamp : cardStatus(q.locks_at, now, sealed)}>
          <View style={{ flex: 1, minHeight: 0 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", gap: space(2) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false}>
              <QuestionFace text={q.text} seed={q.id} />
              {/* The house posts its line before the seal (design D2). */}
              {lineText && <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{lineText}</Mono>}
              {practice?.context && <Mono size={11} style={{ textAlign: "center" }}>{practice.context}</Mono>}
              {q.context && <View style={{ gap: space(1) }}>
                <Pressable accessibilityRole="button" onPress={() => setShowContext(!showContext)} style={{ minHeight: 44, justifyContent: "center" }}><Mono size={11}>{showContext ? "CLOSE CONTEXT" : "CONTEXT"}</Mono></Pressable>
                {showContext && <><Mono size={11}>{q.context.text}</Mono><Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(q.context!.sourceUrl); }} style={{ minHeight: 44 }}><Mono size={10}>SOURCE · AS OF {new Date(q.context.asOf).toLocaleString()}</Mono></Pressable></>}
              </View>}
            </ScrollView>
          </View>
          <View style={{ gap: space(3) }}>
            {/* Step one: the side. Sleeve semantics from the art: YES wears
                the ultramarine sleeve, NO the vermilion. */}
            <View style={{ flexDirection: "row", gap: space(2) }}>
              {([true, false] as const).map((v) => {
                const sel = choice.side === v;
                const tone = v ? colors.ultramarine : colors.vermilion;
                const wash = v ? colors.ultramarineWash : colors.vermilionWash;
                return (
                  <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{ selected: sel, disabled: busy }} disabled={busy} onPress={() => pickSide(v)}
                    style={{ flex: 1, borderWidth: 1, borderColor: sel ? tone : colors.line, minHeight: 48, justifyContent: "center", alignItems: "center", backgroundColor: sel ? wash : "transparent" }}>
                    <Mono size={12} color={sel ? tone : colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>{v ? "YES" : "NO"}</Mono>
                  </Pressable>
                );
              })}
            </View>
            {/* Step two and three: the rung, then the seal. Reserved so the
                card's footer does not jump when a side lands. */}
            <View style={{ minHeight: 48 + space(2) + 16 + space(3) + 48, justifyContent: "flex-end", gap: space(3) }}>
              {choice.side === null ? (
                <DecodeLine text="TAKE A SIDE" size={11} color={colors.mutedInk} letterSpacing={3} style={{ textAlign: "center" }} />
              ) : (
                <>
                  <StakeLadder rungs={rungs} selected={choice.confidence} onSelect={pickRung} disabled={busy} />
                  <GoldButton title={submit.isPending ? "SEALING…" : "SEAL"} disabled={busy} onPress={() => { void seal(); }} />
                </>
              )}
            </View>
            {error && <Mono size={11} color={colors.vermilion} style={{ textAlign: "center" }}>{error}</Mono>}
          </View>
        </CardChrome>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.ultramarineWash }, yesWashStyle]} />
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.vermilionWash }, noWashStyle]} />
        </View>
      </Animated.View>
    </View>
  );
}
```

Read the existing file's `CardChrome` call before replacing, and keep any prop the current call passes that is not listed above (e.g. a `height` forwarding detail). If `CardChrome` requires a fixed footer height for the `CardStage` to size the card, add `space(3)` of slack to the reserved footer block rather than letting it grow.

The `question_answered` event now carries `confidence` and `staked`, and `first_live_seal` carries `stake` — that is the spec §9 property addition for the seal.

- [ ] **Step 4: Update `round.tsx`**

- Remove the imports of `ConvictionColumn`, `confidenceMeaning`, `payoffLine`, `getFloorNoticed`/`markFloorNoticed`.
- Delete the `lean` state, `onLean`, `floorSeen`/`floorShown` and their effects (lines 49-79 of the current file).
- In the card mount pass `fortune={today.data.fortune}`, drop `onLean`, and change `onSealed={() => setLastSealedId(current.id)}` to `onSealed={(receipt) => { setLastSealedId(current.id); setLastReceipt(receipt); }}` with a new `const [lastReceipt, setLastReceipt] = useState<string | null>(null);`.
- Delete the `<ConvictionColumn …/>` mount.
- In the footer slot, replace the `lean.conf !== null ? (…)` branch: the slot now shows, when `lastSealedId && lastEntry`, the receipt (`<Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{lastReceipt}</Mono>`) above the existing verdict row; else the hidden-players line. Raise the slot's `minHeight` from `scaledRow(40, …)` to `scaledRow(56, …)` so the two rows fit. Rewrite the last `Mono` to read `The players' leaning is hidden until you seal.` and the `CONSULTING THE CROWD…` decode to `COUNTING THE PLAYERS…`. Rewrite the accessibility announcement prefix `The crowd:` to `The players:`.

- [ ] **Step 5: Minimal `PracticeCard.tsx` compile fix**

Remove the `ConvictionColumn`, `confidenceMeaning`, `payoffLine` imports and the `lean`/`onLean` state; in the `OracleCard` mount drop `onLean` and `forceButtons`, add `fortune={PRACTICE_FORTUNE}`, and in `exhibitionQuestion` set `line_p_yes: practiceLine(exhibition)` (import `PRACTICE_FORTUNE`, `practiceLine` from `@oracle/core`); pass `practice={{ …, stamp: "PRACTICE · UNRANKED" }}`. Replace the footer slot's `lean.conf !== null ? …` branch with just the `receipt ? … : …` halves. Remove the `USE THE PULL`/`USE HOLD BUTTONS` link and the `buttons` state. Task 10 rewrites the result; this step only has to typecheck.

- [ ] **Step 6: Typecheck and run the mobile suite**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean; the suite passes with the three deleted test files gone.

- [ ] **Step 7: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): the two-step seal on the five-rung ladder; the pull is retired

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 6: Pure modules for home, reveal, board, record and share

**Files:**
- Create: `apps/mobile/src/game/houseLine.ts`, `revealFortune.ts`, `fortuneHistory.ts`, `shareLines.ts`
- Modify: `apps/mobile/src/game/dailyBoard.ts`
- Test: `apps/mobile/test/houseLine.test.ts`, `revealFortune.test.ts`, `fortuneHistory.test.ts`, `shareLines.test.ts` (create); `apps/mobile/test/dailyBoard.test.ts` (append)

**Interfaces:**
- Consumes: `fortuneText`, `stakeText.receiptLine`, `Reveal`, `RoundBoard`, `AllTimeBoard`, `MeLedger` types from `@oracle/core`.
- Produces:
  ```ts
  // houseLine.ts
  export function houseLines(house: { total: number; last_delta: number | null } | null | undefined): string[];
  // revealFortune.ts
  export type FortuneHeadline = { kind: "withheld"; read: string } | { kind: "settled"; delta: string; fortune: string } | { kind: "none" };
  export function fortuneHeadline(d: Reveal): FortuneHeadline;
  export function stakeReceipt(q: Reveal["questions"][number]): string | null;   // "YES · STAKED 50 · PAID 143" | "… · LOST 50" | "STAKE RETURNED"
  export function oracleTake(q): string | null;                                   // "YOU TOOK THE ORACLE FOR 93" | "THE ORACLE TOOK 50"
  export function lineContext(q): string | null;                                  // "THE LINE 35% YES · THE MARKET 40%"
  export function fortuneRowRight(q): string;                                     // "+93" | "−50" | "0" | "—"
  export function houseNightLine(houseDelta: number | null): string | null;      // "THE HOUSE WON 1,240 LAST NIGHT"
  export function isFortuneRound(d: Reveal): boolean;                              // rules_version >= 3
  // fortuneHistory.ts
  export function fortuneHistoryLines(h: MeLedger["fortune_history"], max?: number): string[]; // newest first
  // shareLines.ts
  export function shareBigOneLine(input: { line: number | null; answer: boolean | null; stake: number | null; delta: number | null }): string | null;
  export function fortuneShareMessage(d: { date: string; delta: number; fortuneAfter: number; results: ReadonlyArray<QuestionResult> }, url?: string | null): string;
  // dailyBoard.ts (additions)
  export function boardLines(b, rulesVersion?): string[]      // now branches on b.metric
  export function boardRowLines(rows, metric?: "points" | "return"): string[]
  export function allTimeLines(b: AllTimeBoard | undefined | null): string[]
  export function allTimeRowLines(rows: AllTimeBoard["rows"]): string[]
  ```

- [ ] **Step 1: Write the failing tests**

`apps/mobile/test/houseLine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { houseLines } from "../src/game/houseLine";

describe("the house headline (design §8.3)", () => {
  it("says nothing before any round has settled", () => {
    expect(houseLines(null)).toEqual([]);
    expect(houseLines(undefined)).toEqual([]);
    expect(houseLines({ total: 0, last_delta: null })).toEqual([]);
  });
  it("reports last night as a win or a loss for the house", () => {
    expect(houseLines({ total: 1240, last_delta: 1240 })).toEqual(["LAST NIGHT THE HOUSE WON 1,240"]);
    expect(houseLines({ total: 200, last_delta: -60 })).toEqual(["LAST NIGHT THE HOUSE LOST 60"]);
    expect(houseLines({ total: 0, last_delta: 0 })).toEqual(["LAST NIGHT THE HOUSE BROKE EVEN"]);
  });
  it("adds the debt line when the purse is negative", () => {
    expect(houseLines({ total: -1240, last_delta: -1240 })).toEqual(["LAST NIGHT THE HOUSE LOST 1,240", "THE ORACLE OWES ITS PLAYERS 1,240"]);
  });
});
```

`apps/mobile/test/revealFortune.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Reveal } from "@oracle/core";
import { fortuneHeadline, stakeReceipt, oracleTake, lineContext, fortuneRowRight, houseNightLine, isFortuneRound } from "../src/game/revealFortune";

type Q = Reveal["questions"][number];
const q = (over: Partial<Q> & { my?: Partial<NonNullable<Q["my"]>> | null }): Q => ({
  id: "q", slot: 1, text: "Will it?", outcome: "yes", crowd_yes_pct: 60, crowd_count: 30, market_prob: 0.4, line_p_yes: 0.35,
  source_name: "Kalshi", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: 0.35,
  ...over,
  my: over.my === null ? null : { answer: true, confidence: 75, points: null, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null, stake: 50, payout: 143, delta: 93, ...(over.my ?? {}) },
});
const reveal = (over: Partial<Reveal>): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0,
  vigil_mult: 1, delta: 140, return: 0.14, fortune_after: 1140, house_delta: -140, questions: [q({})],
  ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
});

describe("the version 3 reveal (design §8.3)", () => {
  it("is a fortune round at version 3 only", () => {
    expect(isFortuneRound(reveal({}))).toBe(true);
    expect(isFortuneRound(reveal({ rules_version: 2 }))).toBe(false);
  });

  it("withholds the headline while any card is undecided, then prints delta and fortune after", () => {
    expect(fortuneHeadline(reveal({ delta: null, questions: [q({ outcome: null, my: { payout: null, delta: null } }), q({})] })))
      .toEqual({ kind: "withheld", read: "I OF II READ" });
    expect(fortuneHeadline(reveal({}))).toEqual({ kind: "settled", delta: "+140", fortune: "FORTUNE 1,140" });
    expect(fortuneHeadline(reveal({ delta: -60, fortune_after: 940 }))).toEqual({ kind: "settled", delta: "−60", fortune: "FORTUNE 940" });
  });

  it("has no headline for a spectator who staked nothing", () => {
    expect(fortuneHeadline(reveal({ delta: null, questions: [q({ my: null })] }))).toEqual({ kind: "none" });
  });

  it("writes the stake receipt in money", () => {
    expect(stakeReceipt(q({}))).toBe("YES · STAKED 50 · PAID 143");
    expect(stakeReceipt(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("YES · STAKED 50 · LOST 50");
    expect(stakeReceipt(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("YES · STAKED 50 · STAKE RETURNED");
    expect(stakeReceipt(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("YES · STAKED 50 · PENDING");
    expect(stakeReceipt(q({ my: null }))).toBeNull();
    expect(stakeReceipt(q({ my: { stake: null, payout: null, delta: null } }))).toBe("YES · 75% SURE");
  });

  it("reads the Oracle comparison as who took whom", () => {
    expect(oracleTake(q({}))).toBe("YOU TOOK THE ORACLE FOR 93");
    expect(oracleTake(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("THE ORACLE TOOK 50");
    expect(oracleTake(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBeNull();
    expect(oracleTake(q({ my: null }))).toBeNull();
  });

  it("gives the line and the market as context", () => {
    expect(lineContext(q({}))).toBe("THE LINE 35% YES · THE MARKET 40%");
    expect(lineContext(q({ market_prob: null }))).toBe("THE LINE 35% YES");
    expect(lineContext(q({ line_p_yes: null }))).toBeNull();
  });

  it("puts the delta on the row's right, and a dash when undecided", () => {
    expect(fortuneRowRight(q({}))).toBe("+93");
    expect(fortuneRowRight(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("−50");
    expect(fortuneRowRight(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("0");
    expect(fortuneRowRight(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("—");
    expect(fortuneRowRight(q({ my: null }))).toBe("YES");
  });

  it("names the house's night", () => {
    expect(houseNightLine(-140)).toBe("THE HOUSE LOST 140 LAST NIGHT");
    expect(houseNightLine(1240)).toBe("THE HOUSE WON 1,240 LAST NIGHT");
    expect(houseNightLine(0)).toBe("THE HOUSE BROKE EVEN LAST NIGHT");
    expect(houseNightLine(null)).toBeNull();
  });
});
```

`apps/mobile/test/fortuneHistory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fortuneHistoryLines } from "../src/game/fortuneHistory";

describe("the record's fortune history (design §8.3)", () => {
  it("lists newest first with delta and fortune after", () => {
    const lines = fortuneHistoryLines([
      { date: "2026-09-08", delta: 140, fortune_after: 1140 },
      { date: "2026-09-09", delta: -60, fortune_after: 1080 },
    ]);
    expect(lines).toEqual(["2026-09-09 · −60 · 1,080", "2026-09-08 · +140 · 1,140"]);
  });
  it("caps the list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, delta: 1, fortune_after: 1000 + i }));
    expect(fortuneHistoryLines(many).length).toBe(10);
    expect(fortuneHistoryLines(many, 3).length).toBe(3);
  });
  it("is empty before any settlement", () => {
    expect(fortuneHistoryLines([])).toEqual([]);
  });
});
```

`apps/mobile/test/shareLines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shareBigOneLine, fortuneShareMessage } from "../src/game/shareLines";

describe("the share card's lines (design §8.3)", () => {
  it("says the Oracle's line on the Big One and what the player did about it", () => {
    expect(shareBigOneLine({ line: 0.35, answer: true, stake: 100, delta: 186 })).toBe("THE ORACLE SAID 35% YES · YOU TOOK YES FOR 100 · +186");
    expect(shareBigOneLine({ line: 0.35, answer: false, stake: 100, delta: -100 })).toBe("THE ORACLE SAID 35% YES · YOU TOOK NO FOR 100 · −100");
    expect(shareBigOneLine({ line: 0.35, answer: null, stake: null, delta: null })).toBe("THE ORACLE SAID 35% YES · YOU SAT IT OUT");
    expect(shareBigOneLine({ line: null, answer: true, stake: 100, delta: 186 })).toBeNull();
  });
  it("composes the share message around the fortune delta", () => {
    expect(fortuneShareMessage({ date: "2026-09-10", delta: 140, fortuneAfter: 1140, results: ["win", "loss", "win", "win", "void"] }, null))
      .toBe("🔮 OUTSEEN 2026-09-10 — I✓ II✗ III✓ IV✓ V∅ · +140 · FORTUNE 1,140 · can you beat the house?");
    expect(fortuneShareMessage({ date: "2026-09-10", delta: -60, fortuneAfter: 940, results: ["loss", "loss", "loss", "loss", "loss"] }, "https://x.y"))
      .toBe("🔮 OUTSEEN 2026-09-10 — I✗ II✗ III✗ IV✗ V✗ · −60 · FORTUNE 940 · can you beat the house? https://x.y");
  });
});
```

Append to `apps/mobile/test/dailyBoard.test.ts` (read the file's existing fixture shape first and reuse its board factory if one exists; otherwise build the object inline as below):

```ts
import { allTimeLines, allTimeRowLines } from "../src/game/dailyBoard";

describe("the board by return (design §8.3)", () => {
  const ret = (over: Partial<RoundBoard>): RoundBoard => ({
    date: "2026-09-10", metric: "return", field_size: 6, your_points: null, your_rank: 1, best_points: null, median_points: null,
    your_return_bp: 10020, best_return_bp: 10020, median_return_bp: -600, rows: [], ...over,
  });
  it("ranks by return with the field's shape as percentages", () => {
    expect(boardLines(ret({}), 3)).toEqual(["RANK 1 OF 6 PLAYERS · RETURN +100.2% · BEST +100.2% · MEDIAN −6.0%"]);
  });
  it("names the unplaced reader and the small field", () => {
    expect(boardLines(ret({ your_return_bp: null, your_rank: null }), 3)).toEqual(["NO COMPETITIVE PLACING"]);
    expect(boardLines(ret({ your_rank: null, field_size: 2 }), 3)).toEqual(["THE FIELD IS STILL GATHERING"]);
  });
  it("prints rows by return, never by the zeroed points", () => {
    expect(boardRowLines([{ name: "Quiet Heron", points: 0, return_bp: 10020, rank: 1, is_you: true, is_oracle: false }], "return")).toEqual(["1 · Quiet Heron · +100.2%"]);
  });
});

describe("the all-time board by fortune", () => {
  it("ranks by fortune", () => {
    expect(allTimeLines({ field_size: 6, your_fortune: 2002, your_rank: 1, best_fortune: 2002, median_fortune: 940, rows: [] }))
      .toEqual(["RANK 1 OF 6 PLAYERS · FORTUNE 2,002 · BEST 2,002 · MEDIAN 940"]);
    expect(allTimeLines({ field_size: 2, your_fortune: 1000, your_rank: null, best_fortune: null, median_fortune: null, rows: [] })).toEqual(["THE FIELD IS STILL GATHERING"]);
    expect(allTimeLines({ field_size: 6, your_fortune: null, your_rank: null, best_fortune: 2002, median_fortune: 940, rows: [] })).toEqual(["NO STAKE SETTLED YET"]);
    expect(allTimeLines(undefined)).toEqual([]);
  });
  it("prints rows", () => {
    expect(allTimeRowLines([{ name: "Quiet Heron", fortune: 2002, rank: 1, is_you: false }])).toEqual(["1 · Quiet Heron · 2,002"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && npx vitest run test/houseLine.test.ts test/revealFortune.test.ts test/fortuneHistory.test.ts test/shareLines.test.ts test/dailyBoard.test.ts`
Expected: FAIL — modules/exports missing; `boardLines` ignores `metric`.

- [ ] **Step 3: Implement**

`apps/mobile/src/game/houseLine.ts`:

```ts
import { formatFortune } from "./fortuneText";

// Home's second line (design §8.3): whether the house won or lost last night,
// and, when the purse has gone negative, the debt. Machine register.
export function houseLines(house: { total: number; last_delta: number | null } | null | undefined): string[] {
  if (!house || house.last_delta === null) return [];
  const d = house.last_delta;
  const night = d > 0 ? `LAST NIGHT THE HOUSE WON ${formatFortune(d)}` : d < 0 ? `LAST NIGHT THE HOUSE LOST ${formatFortune(-d)}` : "LAST NIGHT THE HOUSE BROKE EVEN";
  return house.total < 0 ? [night, `THE ORACLE OWES ITS PLAYERS ${formatFortune(-house.total)}`] : [night];
}
```

`apps/mobile/src/game/revealFortune.ts`:

```ts
import type { Reveal } from "@oracle/core";
import { formatFortune, signedFortune } from "./fortuneText";
import { receiptLine } from "./stakeText";
import { readingLine } from "./revealRows";

type Question = Reveal["questions"][number];

export function isFortuneRound(d: Reveal): boolean {
  return d.rules_version >= 3;
}

// The headline (design §8.3): the round's delta and the fortune after, once
// every card is decided. The route withholds all four round figures until
// then, so `delta === null` is the withheld signal -- never a partial sum.
export type FortuneHeadline =
  | { kind: "withheld"; read: string }
  | { kind: "settled"; delta: string; fortune: string }
  | { kind: "none" };

export function fortuneHeadline(d: Reveal): FortuneHeadline {
  const staked = d.questions.some((q) => q.my !== null && q.my.stake !== null);
  if (!staked) return { kind: "none" };
  if (d.delta === null || d.fortune_after === null) return { kind: "withheld", read: readingLine(d.questions) };
  return { kind: "settled", delta: signedFortune(d.delta), fortune: `FORTUNE ${formatFortune(d.fortune_after)}` };
}

// Each card's stake, read back in money. Confidence appears only when the
// round was unstaked (design §5.5), because then it is all there is.
export function stakeReceipt(q: Question): string | null {
  if (!q.my) return null;
  const side = q.my.answer ? "YES" : "NO";
  if (q.my.stake === null) return receiptLine({ answer: q.my.answer, stake: null, wins: null, confidence: q.my.confidence });
  const head = `${side} · STAKED ${formatFortune(q.my.stake)}`;
  if (q.outcome === null || q.my.payout === null) return `${head} · PENDING`;
  if (q.outcome === "void") return `${head} · STAKE RETURNED`;
  return q.my.payout > 0 ? `${head} · PAID ${formatFortune(q.my.payout)}` : `${head} · LOST ${formatFortune(q.my.stake)}`;
}

// The Oracle comparison, as who took whom (design §8.3).
export function oracleTake(q: Question): string | null {
  if (!q.my || q.my.delta === null || q.outcome === null || q.outcome === "void") return null;
  if (q.my.delta > 0) return `YOU TOOK THE ORACLE FOR ${formatFortune(q.my.delta)}`;
  if (q.my.delta < 0) return `THE ORACLE TOOK ${formatFortune(-q.my.delta)}`;
  return null;
}

export function lineContext(q: Question): string | null {
  if (q.line_p_yes === null) return null;
  const line = `THE LINE ${Math.round(q.line_p_yes * 100)}% YES`;
  return q.market_prob === null ? line : `${line} · THE MARKET ${Math.round(q.market_prob * 100)}%`;
}

export function fortuneRowRight(q: Question): string {
  if (!q.my) return q.outcome === "yes" ? "YES" : q.outcome === "no" ? "NO" : q.outcome === "void" ? "VOID" : "—";
  if (q.my.delta === null) return "—";
  return signedFortune(q.my.delta);
}

export function houseNightLine(houseDelta: number | null): string | null {
  if (houseDelta === null) return null;
  if (houseDelta > 0) return `THE HOUSE WON ${formatFortune(houseDelta)} LAST NIGHT`;
  if (houseDelta < 0) return `THE HOUSE LOST ${formatFortune(-houseDelta)} LAST NIGHT`;
  return "THE HOUSE BROKE EVEN LAST NIGHT";
}
```

`apps/mobile/src/game/fortuneHistory.ts`:

```ts
import type { MeLedger } from "@oracle/core";
import { formatFortune, signedFortune } from "./fortuneText";

// The record's fortune history (design §8.3): one row per settled round,
// newest first. The route sends them oldest first with a running total.
export function fortuneHistoryLines(history: MeLedger["fortune_history"], max = 10): string[] {
  return [...history].reverse().slice(0, max).map((h) => `${h.date} · ${signedFortune(h.delta)} · ${formatFortune(h.fortune_after)}`);
}
```

`apps/mobile/src/game/shareLines.ts`:

```ts
import { SHARE_URL } from "../config/links";
import { formatFortune, signedFortune } from "./fortuneText";
import { patternLine, type QuestionResult } from "./sharePattern";

// The share card's second line (design §8.3): the Oracle's line on the Big
// One and what the player did about it.
export function shareBigOneLine(input: { line: number | null; answer: boolean | null; stake: number | null; delta: number | null }): string | null {
  if (input.line === null) return null;
  const said = `THE ORACLE SAID ${Math.round(input.line * 100)}% YES`;
  if (input.answer === null || input.stake === null) return `${said} · YOU SAT IT OUT`;
  const took = `YOU TOOK ${input.answer ? "YES" : "NO"} FOR ${formatFortune(input.stake)}`;
  return input.delta === null ? `${said} · ${took}` : `${said} · ${took} · ${signedFortune(input.delta)}`;
}

export function fortuneShareMessage(
  d: { date: string; delta: number; fortuneAfter: number; results: ReadonlyArray<QuestionResult> },
  url: string | null = SHARE_URL,
): string {
  const body = `🔮 OUTSEEN ${d.date} — ${patternLine(d.results)} · ${signedFortune(d.delta)} · FORTUNE ${formatFortune(d.fortuneAfter)} · can you beat the house?`;
  return url ? `${body} ${url}` : body;
}
```

In `apps/mobile/src/game/dailyBoard.ts`: import `returnPct`, `formatFortune` from `./fortuneText` and `type AllTimeBoard` from `@oracle/core`; change the three functions and add two:

```ts
export function boardLines(b: RoundBoard | undefined, _rulesVersion = 1): string[] {
  if (!b) return [];
  if (b.metric === "return") {
    if (b.your_return_bp === null) return [UNRATED_LINE];
    if (b.your_rank === null) return [FIELD_GATHERING_LINE];
    const shape = b.best_return_bp === null || b.median_return_bp === null ? null : `BEST ${returnPct(b.best_return_bp)} · MEDIAN ${returnPct(b.median_return_bp)}`;
    const rank = `RANK ${b.your_rank} OF ${b.field_size} PLAYERS · RETURN ${returnPct(b.your_return_bp)}`;
    return [shape === null ? rank : `${rank} · ${shape}`];
  }
  // … the existing points branch, unchanged …
}

export function boardSupportingLines(b: RoundBoard | undefined, rulesVersion = 1): string[] {
  if (!b) return [];
  if (b.metric === "return") {
    return b.your_return_bp === null ? ["Complete every non-void question.", "At least three must resolve."] : [];
  }
  // … existing …
}

export function boardRowLines(
  rows: Array<{ name: string; points: number; return_bp?: number | null; rank: number; is_you: boolean; is_oracle: boolean }>,
  metric: "points" | "return" = "points",
): string[] {
  return rows.map((r) => `${r.rank} · ${r.name} · ${metric === "return" ? returnPct(r.return_bp ?? 0) : level(r.points)}`);
}

export const NO_STAKE_LINE = "NO STAKE SETTLED YET";

export function allTimeLines(b: AllTimeBoard | undefined | null): string[] {
  if (!b) return [];
  if (b.your_fortune === null) return [NO_STAKE_LINE];
  if (b.your_rank === null) return [FIELD_GATHERING_LINE];
  const shape = b.best_fortune === null || b.median_fortune === null ? null : `BEST ${formatFortune(b.best_fortune)} · MEDIAN ${formatFortune(b.median_fortune)}`;
  const rank = `RANK ${b.your_rank} OF ${b.field_size} PLAYERS · FORTUNE ${formatFortune(b.your_fortune)}`;
  return [shape === null ? rank : `${rank} · ${shape}`];
}

export function allTimeRowLines(rows: AllTimeBoard["rows"]): string[] {
  return rows.map((r) => `${r.rank} · ${r.name} · ${formatFortune(r.fortune)}`);
}
```

Also rewrite `ORACLE_COMPARISON_LINE` to `"The Oracle is shown for comparison; ranks are among players."` (it already says Oracle; no retired word — leave it) and change nothing else in the points branch.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/mobile && npx vitest run && npx tsc --noEmit`
Expected: PASS. The `dailyBoard.test.ts` existing 17 cases still pass because the points branch is untouched and `metric` defaults to `"points"` in the schema.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game apps/mobile/test
git commit -m "feat(mobile): pure modules for the house line, the fortune reveal, the two boards, the history and the share

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 7: Home — fortune as the hero number, the house line

**Files:**
- Modify: `apps/mobile/src/app/index.tsx`
- Modify: `apps/mobile/src/analytics/analytics.ts` (add `"house_headline_viewed"`)
- Modify: `apps/mobile/src/ui/HomeChallenge.tsx`, `apps/mobile/src/ui/SleepsPanel.tsx` (copy only)
- Modify: `apps/mobile/src/game/arrivalState.ts` + `apps/mobile/test/arrivalState.test.ts` (labels only)
- Modify: `apps/mobile/src/game/homeLines.ts` + test (the lapse line)

**Interfaces:**
- Consumes: `houseLines` (Task 6), `formatFortune` (Task 4), `streakLine` and the renamed bank ids (Task 3), `MeLedger.house` and `.fortune` (Task 1/2).
- Produces: no new exports. The home reads fortune and house from `useMeLedger()` so it works while no round is open.

- [ ] **Step 1: Update the pure modules and their tests**

`arrivalState.ts`: `"SEE THE CROWD"` → `"SEE THE PLAYERS"`; `"CHALLENGE THE ORACLE"` → `"PRACTICE AGAINST THE ORACLE"`. Update the two matching expectations in `test/arrivalState.test.ts`.

`homeLines.ts:48`: `"THE VIGIL BEGINS AGAIN. YOUR RECORD REMAINS."` → `"A NEW STREAK BEGINS. YOUR RECORD REMAINS."`; update `test/homeLines.test.ts` if it asserts the string.

Run: `cd apps/mobile && npx vitest run test/arrivalState.test.ts test/homeLines.test.ts` → PASS.

- [ ] **Step 2: Rewrite the home's copy hooks and add the fortune block**

In `apps/mobile/src/app/index.tsx`:

1. Imports: `vigilLine` → `streakLine`; add `import { houseLines } from "../game/houseLine";` and `import { formatFortune } from "../game/fortuneText";` and `Ritual` from `../ui/Text` if not imported.
2. Line 47-48: `RESCUE_CONFIRM_LINE = COPY_BANK.find((l) => l.id === "streak.protection-1")!.text`. Line 56: `STORE_PENDING_LINE = "THE STORE ANSWERED. YOUR RECORD WILL SHOW IT SHORTLY."`.
3. Line 168: `const vigil = vigilLine(…)` → `const kept = streakLine(…)`; line 184: `const notice = shield ?? risk ?? lapse ?? kept;` (rename `shield` local to `protection` too; it is `shieldNotice(...)` from `game/shieldNotice.ts`, which stays as a filename but change its exported line lookup to the id `streak.protection-1`).
4. The nav rail (line 316): `{ label: "YOUR RECORD", a11yLabel: "Your record", … }`.
5. Add the fortune block inside the temple `View`, between `MaterializeTitle` and `OracleClock`:

```tsx
        {/* Fortune is the hero number (design D4, §8.3). It reads from the
            record, not from today's round, so it stands while no round is
            open. Reserved two rows so it never shoves the clock. */}
        <View style={{ minHeight: scaledRow(ROW_H.line, chromeScale) * 2 + space(1), alignItems: "center", justifyContent: "center", gap: space(1) }}>
          {ledger.data?.fortune != null && (
            <>
              <Ritual bold size={displayScale.epithet} letterSpacing={2} style={{ marginRight: -2 }} accessibilityLabel={`Fortune ${formatFortune(ledger.data.fortune)}`}>{formatFortune(ledger.data.fortune)}</Ritual>
              <Mono {...role.meta} color={colors.mutedInk}>FORTUNE</Mono>
            </>
          )}
        </View>
```

(`ROW_H`, `displayScale` from `../theme`; `scaledRow` is already imported on this screen — check, otherwise import from `../game/typeScaling`.)

6. Add the house lines in the notice row's sibling: after the `OracleClock` and before the closing of the temple `View`, one reserved row:

```tsx
        <View style={{ minHeight: scaledRow(ROW_H.meta, chromeScale) * 2, alignItems: "center", justifyContent: "center" }}>
          {houseLines(ledger.data?.house).map((line) => (
            <Mono key={line} {...role.meta} color={colors.goldText}>{line}</Mono>
          ))}
        </View>
```

7. Analytics: in `analytics.ts` add `| "house_headline_viewed"` to `AnalyticsEvent`. In `index.tsx` add, beside the existing `arrival_viewed` capture effect:

```tsx
  const houseSeenFor = useRef<number | null>(null);
  useEffect(() => {
    const last = ledger.data?.house?.last_delta ?? null;
    if (last === null || houseSeenFor.current === last) return;
    houseSeenFor.current = last;
    capture("house_headline_viewed", { sign: Math.sign(last) });
  }, [ledger.data?.house?.last_delta]);
```

8. The streak notice row keeps working (it is the `notice` row). The rescue block is unchanged except the constants above.

- [ ] **Step 3: Copy in `HomeChallenge.tsx` and `SleepsPanel.tsx`**

`HomeChallenge.tsx`: partial line → `` `${input.openCount} ${…"QUESTION REMAINS" : "QUESTIONS REMAIN"} · A PLACING NEEDS EVERY NON-VOID QUESTION. YOUR STAKES STILL SETTLE.` ``; submitted line → `"YOUR CALLS ARE SEALED. SEE WHERE THE PLAYERS LEAN WHILE THE MARKETS SETTLE."`; live line → `"FIVE QUESTIONS. THE ORACLE HAS POSTED ITS LINES."`; the error link `"TRY AN EXHIBITION"` → `"TRY A PRACTICE QUESTION"`; the waiting caption stays `ONE CALL, ANSWERED NOW · UNRANKED`.

`SleepsPanel.tsx`: the supporting paragraph → `A practice question has a known answer. It runs on a practice fortune and changes no record — a way to meet the call while you wait.`; the button → `"TRY A PRACTICE QUESTION"`.

- [ ] **Step 4: Typecheck and test**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): fortune is the hero number on home; the house line beneath it

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 8: The reveal and the share card

**Files:**
- Modify: `apps/mobile/src/app/reveal/[date].tsx`
- Modify: `apps/mobile/src/ui/ShareCard.tsx` (`ShareCardData`, the canvas body)
- Modify: `apps/mobile/src/api/hooks.ts` (add `useAllTimeBoard`)
- Modify: `apps/mobile/src/game/revealRows.ts` (copy only: `TOO_FEW_LINE`, `callLine`'s `CROWD` word, `ledgerLines`' rating lines stay)
- Modify: `apps/mobile/src/ui/CrowdReveal.tsx` (copy only)
- Test: `apps/mobile/test/revealRows.test.ts` (update the two crowd strings)

**Interfaces:**
- Consumes: `isFortuneRound`, `fortuneHeadline`, `stakeReceipt`, `oracleTake`, `lineContext`, `fortuneRowRight`, `houseNightLine` (Task 6); `boardLines`/`boardRowLines(rows, metric)`/`allTimeLines`/`allTimeRowLines`; `shareBigOneLine`, `fortuneShareMessage`.
- Produces:
  ```ts
  export function useAllTimeBoard(enabled: boolean): UseQueryResult<AllTimeBoard | null>;  // hooks.ts; 404 → null
  export interface ShareCardData { …existing; fortuneDelta?: number; fortuneAfter?: number; bigOneLine?: string | null }
  ```

- [ ] **Step 1: Copy in `revealRows.ts` and `CrowdReveal.tsx`**

`revealRows.ts`: `TOO_FEW_LINE = "TOO FEW PLAYED TO READ THE PLAYERS"`; in `callLine`, `CROWD ${pct}% YES` → `PLAYERS ${pct}% YES`; fix the comment that names payoffLine. Update the matching expectations in `test/revealRows.test.ts` (grep `CROWD` and `TOO FEW`).

`CrowdReveal.tsx`: any `CROWD` in a rendered string → `PLAYERS`; the card back flip label reads `PLAYERS` (spec §8.1).

Also add `moneyMark` to `apps/mobile/src/game/revealFortune.ts`:

```ts
// The row's mark at version 3, from the delta's sign -- outcome must never be
// carried by colour alone (brief §11).
export function moneyMark(q: Question): string {
  if (!q.my) return "·";
  if (q.outcome === null || q.my.delta === null) return "…";
  if (q.outcome === "void") return "∅";
  return q.my.delta > 0 ? "✓" : q.my.delta < 0 ? "✗" : "∅";
}
```

with these cases appended to `test/revealFortune.test.ts` (reusing its `q()` factory):

```ts
  it("marks a money row by the delta's sign", () => {
    expect(moneyMark(q({}))).toBe("✓");
    expect(moneyMark(q({ outcome: "no", my: { payout: 0, delta: -50 } }))).toBe("✗");
    expect(moneyMark(q({ outcome: "void", my: { payout: 50, delta: 0 } }))).toBe("∅");
    expect(moneyMark(q({ outcome: null, my: { payout: null, delta: null } }))).toBe("…");
    expect(moneyMark(q({ my: null }))).toBe("·");
  });
```

Run: `cd apps/mobile && npx vitest run test/revealRows.test.ts test/revealFortune.test.ts` → PASS.

- [ ] **Step 2: The all-time hook**

Append to `apps/mobile/src/api/hooks.ts`:

```ts
// The all-time board (design §7): every player who has settled a stake,
// ranked by fortune. 404 means the route is not deployed yet -- an empty slot.
export function useAllTimeBoard(enabled: boolean) {
  return useQuery({
    queryKey: ["board", "all-time"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/board/all-time", AllTimeBoardSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}
```

(import `AllTimeBoardSchema` from `@oracle/core`.)

- [ ] **Step 3: The reveal screen**

In `apps/mobile/src/app/reveal/[date].tsx`:

1. Imports: add the Task 6 helpers, `useAllTimeBoard`, `formatFortune`, `Ritual` if missing.
2. `const fortuneRound = loaded && isFortuneRound(d)` where `d` is the loaded reveal (define after the early returns, beside `anyPending`).
3. Eyebrow (lines 285-294): replace the three strings with `` `Day ${d.date} · still settling` ``, `` `Day ${d.date}` `` and `` `Day ${d.date} · settled` ``.
4. Pending early return: `"The ledger is not yet read."` → `"Not yet settled."`.
5. The headline block (the reserved `POINTS_SLOT_H` block): keep the block and its `minHeight`; inside it render by version:

```tsx
          {!allSpectator && (fortuneRound ? (() => {
            const h = fortuneHeadline(d);
            if (h.kind === "none") return null;
            if (h.kind === "withheld") return (
              <>
                <Ritual bold size={displayScale.epithet} color={colors.mutedInk} letterSpacing={3} style={{ marginRight: -3, textAlign: "center" }}>{h.read}</Ritual>
                <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>FORTUNE WITHHELD</Mono>
              </>
            );
            return (
              <>
                <Ritual bold size={displayScale.points} color={d.delta! >= 0 ? colors.goldText : colors.vermilion} letterSpacing={2} style={{ marginRight: -2 }}>{h.delta}</Ritual>
                <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>{h.fortune}</Mono>
                {houseNightLine(d.house_delta) && <Mono {...role.caption} color={colors.mutedInk}>{houseNightLine(d.house_delta)}</Mono>}
              </>
            );
          })() : (
            /* the existing pointsWithheld / RollingPoints block, unchanged */
          ))}
```

   The `RollingPoints` component stays for versions 1 and 2. The `ledgerLines` / `provenanceLine` standing block under the number: for a fortune round, wrap it in the details toggle from step 7 instead of rendering inline.

6. `RevealSummary` (the duel headline) and the rivalry moment: render only when `!fortuneRound`. For a fortune round the headline above is the summary.
7. Per-question rows: keep the row layout; swap the strings by version:

```tsx
            const st = rowState(q);
            const money = fortuneRound;
            const color = money
              ? (q.my?.delta == null ? colors.mutedInk : q.my.delta > 0 ? colors.goldText : q.my.delta < 0 ? colors.vermilion : colors.mutedInk)
              : st === "win" ? colors.goldText : st === "loss" ? colors.vermilion : colors.mutedInk;
            const call = money ? stakeReceipt(q) : callLine(q);
            const take = money ? oracleTake(q) : null;
            const context = money ? lineContext(q) : null;
            const right = money ? fortuneRowRight(q) : rowRight(q);
```

   Render `call`, then `take` (gold when it starts with `YOU`), then `context`, then the existing `movement`, `ResolutionEvidence`, `receipt` lines; and the right column prints `` `${rowMark(st)} ${right}` `` where for a money row `rowMark` maps from the delta sign: `delta > 0 → "✓"`, `< 0 → "✗"`, `0 → "∅"`, `null → "…"`, spectator `"·"` (`moneyMark(q)` from `revealFortune.ts`, added in step 1).
   Under `context`, reserve the Council slot: `<View style={{ minHeight: 0 }} accessibilityElementsHidden />` with a comment `Council split lands here (spec §13.3, Plan 3).` — no height, no copy.
8. The Big One block: the `YOU: YES @ 75%` row becomes `stakeReceipt(big)` with the right-hand value `fortuneRowRight(big)` coloured by delta sign; `CROWD SAID n% YES` → `PLAYERS SAID n% YES`; keep `THE MARKET SAID n% YES`; the `THE ORACLE FORESAW` line becomes, for a fortune round, `THE ORACLE'S LINE n% YES` with the same ✓/✗ mark; then `oracleTake(big)` in gold when positive; the contrarian `AGAINST THE TIDE +40` block renders only when `!fortuneRound` (there is no bounty at version 3, D8).
9. The board block: keep the reserved heights; add a mode state `const [boardMode, setBoardMode] = useState<"daily" | "all-time">("daily")` and `const allTime = useAllTimeBoard(dayRead && boardMode === "all-time")`. Render `boardLines(board.data ?? undefined, d.rules_version)` / `boardRowLines(board.data?.rows ?? [], board.data?.metric ?? "points")` in daily mode and `allTimeLines(allTime.data)` / `allTimeRowLines(allTime.data?.rows ?? [])` in all-time mode. The eyebrow reads `Daily board` or `All-time board`. Under the `SEE THE FIELD` link add `<QuietLink title={boardMode === "daily" ? "SEE THE ALL-TIME BOARD" : "SEE THE DAILY BOARD"} onPress={() => setBoardMode(m => m === "daily" ? "all-time" : "daily")} />`. Row colouring: gold for `is_you`, muted otherwise (there is no Oracle row at version 3 or on the all-time board).
10. Details toggle: for a fortune round, the standing lines (`ledgerLines`, `provenanceLine`, the milestone copy) render under a `QuietLink` `SHOW DETAILS` / `HIDE DETAILS` placed just above the board block, inside a `View` with `minHeight: scaledRow(ROW_H.meta, …) * 3` reserved when open. For versions 1 and 2 nothing moves.
11. Share: build `cardData` with `fortuneDelta: d.delta ?? undefined`, `fortuneAfter: d.fortune_after ?? undefined`, `bigOneLine: shareBigOneLine({ line: big?.line_p_yes ?? null, answer: big?.my?.answer ?? null, stake: big?.my?.stake ?? null, delta: big?.my?.delta ?? null })`; the share button condition for a fortune round is `fortuneHeadline(d).kind === "settled"`; the message is `fortuneShareMessage({ date, delta: d.delta!, fortuneAfter: d.fortune_after!, results })` for a fortune round and the existing `shareMessage` otherwise.
12. `SHOW RULES` link stays (it passes `rules_version`, which is how version 1 reveals reach the archived canon).

- [ ] **Step 4: The share card canvas**

In `ShareCard.tsx`:
- `ShareCardData` gains `fortuneDelta?: number; fortuneAfter?: number; bigOneLine?: string | null;`.
- In `ShareCardCanvas`, when `data.fortuneDelta !== undefined`: the score line at y=724 (or 660) prints `signedFortune(data.fortuneDelta)` in the numeral font, gold when ≥ 0 and `NIGHT_LOSS` when negative, with `FORTUNE ${formatFortune(data.fortuneAfter!)}` in `mono` at y+30; the duel labels/scores row is skipped; the Big One text at 802 stays; the crowd/market/oracle lines at 840/866/892 are replaced by one line: `data.bigOneLine` at 840 in `monoSmall`, `NIGHT_DIM`, centered, wrapped by hand at 44 characters (split on the last ` · ` before the limit and print the remainder at 866). Otherwise the existing body renders unchanged.
- `ShareFooter`'s gold challenge line becomes `"CAN YOU BEAT THE HOUSE?"` when `data.fortuneDelta !== undefined` (pass a `challenge` prop; default to the existing string).

- [ ] **Step 5: Typecheck and test**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): the fortune reveal, the two boards, and the share card in money

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 9: Your record — fortune history, streak, calibration

**Files:**
- Modify: `apps/mobile/src/app/ledger.tsx` (route file name unchanged)
- Modify: `apps/mobile/src/ui/PlaqueShareCard.tsx`
- Modify: `apps/mobile/src/game/sharePattern.ts` (`plaqueMessage`) + `apps/mobile/test/sharePattern.test.ts`
- Modify: `apps/mobile/src/game/shieldStat.ts` (values only) + test; `apps/mobile/src/game/standing.ts` — delete `vigilStat` if unused after this task (grep)

**Interfaces:**
- Consumes: `fortuneHistoryLines`, `formatFortune`, `GAME_TERMS.history`, `MeLedger.fortune`, `.fortune_history`, `.house`.
- Produces: `plaqueMessage(fortune: number, url?)` replaces `plaqueMessage(epithetTitle, url?)`.

- [ ] **Step 1: Pure changes and tests**

`sharePattern.ts`:

```ts
// The record's own share text: the fortune IS the challenge now.
export function plaqueMessage(fortune: number, url: string | null = SHARE_URL): string {
  const body = `🔮 OUTSEEN — FORTUNE ${fortune.toLocaleString("en-US")} · can you beat the house?`;
  return url ? `${body} ${url}` : body;
}
```

Update `test/sharePattern.test.ts`'s plaque case to `plaqueMessage(1140, null) === "🔮 OUTSEEN — FORTUNE 1,140 · can you beat the house?"`.

`shieldStat.ts` (filename stays): values `"1 FREE"`, `"{n} PAID"`, `"NONE UNTIL NEXT MONTH"` contain no retired word; leave them. Its test stays.

Run: `cd apps/mobile && npx vitest run test/sharePattern.test.ts` → PASS.

- [ ] **Step 2: The screen**

In `ledger.tsx`, inside the plaque when `d` is loaded, the sections become, in order:

1. Page head: `<Eyebrow>{GAME_TERMS.history}</Eyebrow>` and the supporting line `Your fortune, your streak, your calibration`.
2. **Fortune** (new, first inside the plaque):

```tsx
                <LeadStat label="FORTUNE" value={d.fortune === null ? "UNSETTLED" : formatFortune(d.fortune)} />
                {fortuneHistoryLines(d.fortune_history).map((line) => (
                  <Mono key={line} {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textAlign: "left" }]}>{line}</Mono>
                ))}
                {d.fortune_history.length === 0 && (
                  <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "left" }]}>Your first settled round writes the first row here.</Mono>
                )}
                <View style={{ height: 1, backgroundColor: colors.lineSoft, marginVertical: space(1) }} />
```

   `LeadStat` stacks a non-numeric value; `formatFortune` output contains a comma, so widen its `earned` test to `/^[\d,]+$/`.
3. **Streak**: keep `ROUNDS PLAYED`, `STREAK`; the gloss becomes `Your streak is one call a day. It updates when the round settles. Streak protection can carry it through a missed round. It adds no fortune.`; `SHIELDS IN RESERVE` → `STREAK PROTECTION`.
4. **Your calibration**: an `<Eyebrow>Your calibration</Eyebrow>`, then `LeadStat label="YOUR FORECAST RATING"` with `SCORE_GLOSS` beneath (unchanged strings), then `ACCURACY`, `AVG CONFIDENCE`, then `<ConfidenceHistory …/>`. Remove: the epithet block, the milestones list (they move to the reveal's details in Task 8 — they are already there via `MILESTONE_COPY`; just drop them here), `ORACLE RATING`, the standing line, the `YOU HAVE OUTSEEN THE ORACLE ON…` line, `AGAINST THE TIDE`. Delete the now-unused imports (`standingLine`, `shieldStat` if the protection row uses it keep it, `MILESTONE_COPY`, `scoreValue` stays).
5. The empty state decode line: `"THE LEDGER IS CONSULTED"` → `"THE RECORD IS CONSULTED"`. The strike copy: `EVERY VIGIL, EVERY CALL, EVERY EPITHET. THIS IS NOT UNDONE.` → `EVERY STREAK, EVERY CALL, EVERY STAKE. THIS IS NOT UNDONE.`
6. `handleShare` calls `plaqueMessage(d.fortune ?? FORTUNE.FOUNDING)`.

- [ ] **Step 3: The plaque share card**

`PlaqueShareCard.tsx`: the epithet title becomes the fortune (`formatFortune(d.fortune ?? 1000)` in the numeral font), `YOUR FORECAST RATING …` stays, `ORACLE RATING …` is removed, and `OUTSEEN · YOUR LEDGER` → `OUTSEEN · YOUR RECORD`. Its props already take the whole `MeLedger`.

- [ ] **Step 4: Typecheck and test**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run`
Expected: clean. `grep -rn "vigilStat\|standingLine" apps/mobile/src` → if only their own modules, delete `game/standing.ts`'s `vigilStat` and `test/standing.test.ts`'s cases for it (keep `standingLine` if `standing.test.ts` still tests it; the module may stay as dead code is not acceptable — delete what nothing imports).

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): your record leads with fortune; streak, protection and calibration beneath

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 10: Practice on the practice fortune

**Files:**
- Rewrite: `apps/mobile/src/game/practiceResult.ts` + `apps/mobile/test/practiceResult.test.ts`
- Modify: `apps/mobile/src/ui/PracticeCard.tsx`, `apps/mobile/src/app/practice.tsx`
- Modify: `apps/mobile/src/game/exhibitionFlow.ts` (copy: `"PLAY TODAY"`/`"RETURN HOME"` are fine; no retired words — leave), `apps/mobile/src/game/exhibitionFallback.ts` (no change; `linePYes` defaults)
- Test: `apps/mobile/test/exhibitionFlow.test.ts` unchanged

**Interfaces:**
- Consumes: `practiceOutcome`, `practiceLine`, `PRACTICE_FORTUNE` (Task 1); the rebuilt `OracleCard` with `practice.stamp` (Task 5); `receiptLine`, `formatFortune`, `signedFortune`.
- Produces:
  ```ts
  export type PracticePrediction = { answer: boolean; confidence: number };
  export function practiceResult(p: PracticePrediction, ex: Exhibition): {
    line: number; stake: number; wins: number; payout: number; delta: number; correct: boolean; oppositeDelta: number;
    receipt: string;        // "YES · STAKED 50 · WINS 21"
    verdict: string;        // "You took the Oracle for 21." | "The Oracle took 50."
    counterfactual: string; // "Had it gone NO, the same call would have lost 50."
    oracleLine: string;     // "THE ORACLE'S LINE · 70% YES"
  };
  ```

- [ ] **Step 1: Write the failing test**

Replace `apps/mobile/test/practiceResult.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ExhibitionSchema } from "@oracle/core";
import { practiceResult } from "../src/game/practiceResult";

const ex = ExhibitionSchema.parse({
  id: "x", kind: "fictional", question: "Will the blue marble be drawn?", context: "7 blue, 3 amber.",
  sourceName: "Fictional example", roundDate: null, oraclePYes: 0.7, outcome: "yes", linePYes: 0.7,
});

describe("practice on the practice fortune (design §8.3)", () => {
  it("prices a right call at the line and says who took whom", () => {
    const r = practiceResult({ answer: true, confidence: 75 }, ex);
    expect(r.stake).toBe(50);
    expect(r.wins).toBe(21);
    expect(r.delta).toBe(21);
    expect(r.receipt).toBe("YES · STAKED 50 · WINS 21");
    expect(r.verdict).toBe("You took the Oracle for 21.");
    expect(r.counterfactual).toBe("Had it gone NO, the same call would have lost 50.");
    expect(r.oracleLine).toBe("THE ORACLE'S LINE · 70% YES");
  });
  it("loses the stake on a wrong call", () => {
    const r = practiceResult({ answer: false, confidence: 95 }, ex);
    expect(r.delta).toBe(-90);
    expect(r.verdict).toBe("The Oracle took 90.");
    expect(r.counterfactual).toBe("Had it gone NO, the same call would have won 210.");
  });
  it("derives a line when the fixture has none", () => {
    const r = practiceResult({ answer: true, confidence: 55 }, { ...ex, linePYes: null });
    expect(r.line).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/mobile && npx vitest run test/practiceResult.test.ts` → FAIL (shape mismatch).

- [ ] **Step 3: Implement**

`apps/mobile/src/game/practiceResult.ts`:

```ts
import { practiceOutcome, type Exhibition } from "@oracle/core";
import { formatFortune } from "./fortuneText";
import { lineLabel, receiptLine } from "./stakeText";

export type PracticePrediction = { answer: boolean; confidence: number };

// Practice runs on the practice fortune and the exhibition's line (design
// §8.3); nothing here touches the player's fortune. Reading register for the
// sentences, machine register for the receipt and the line.
export function practiceResult(prediction: PracticePrediction, exhibition: Exhibition) {
  const out = practiceOutcome(prediction, exhibition);
  const side = (a: boolean) => (a ? "YES" : "NO");
  const verdict = out.delta > 0 ? `You took the Oracle for ${formatFortune(out.delta)}.` : `The Oracle took ${formatFortune(-out.delta)}.`;
  const other = side(exhibition.outcome !== "yes");
  const counterfactual = out.oppositeDelta >= 0
    ? `Had it gone ${other}, the same call would have won ${formatFortune(out.oppositeDelta)}.`
    : `Had it gone ${other}, the same call would have lost ${formatFortune(-out.oppositeDelta)}.`;
  return {
    ...out,
    receipt: receiptLine({ answer: prediction.answer, stake: out.stake, wins: out.wins, confidence: prediction.confidence }),
    verdict,
    counterfactual,
    oracleLine: lineLabel(out.line)!,
  };
}
```

- [ ] **Step 4: The card and the screen**

`PracticeCard.tsx`:
- `exhibitionQuestion`: `category: "PRACTICE"`, `resolution_criteria: "Practice only; this question is unranked."`, `line_p_yes: practiceLine(exhibition)`.
- Teaching line: historical → `A real question from a past round, with its context as it stood. You play it on a practice fortune of 1,000; nothing here touches your record.`; fictional → `A made-up example — no real draw occurred. You play it on a practice fortune of 1,000; nothing here touches your record.`
- Receipt chrome titles: `"CALL SEALED"` then `"PRACTICE RESULT"`; the `YOUR CALL · YES · 75%` line becomes `practiceResult(receipt, exhibition).receipt`.
- `PracticeResult` renders: the outcome decode line (`Actual outcome: YES.`), the provenance caption, `result.oracleLine`, a two-column block `YOUR STAKE {stake}` / `{signedFortune(delta)}`, `result.verdict` as the serif line, `result.counterfactual` in supporting, `Practice fortune, nothing changed.` in supporting, and the `Next: a daily round…` closer reworded to `Next: a daily round against the Oracle's lines, with your real fortune.` Remove the base-points columns and the "Previous try" line (the retry link stays as `TRY ANOTHER STAKE` and remounts the card).
- Footer slot: receipt → `UNRANKED · YOUR FORTUNE, RECORD AND STREAK ARE UNCHANGED.`; otherwise `TAP A SIDE, THEN A STAKE, THEN SEAL.`

`practice.tsx`: `"PREPARING AN EXHIBITION…"` → `"PREPARING A PRACTICE QUESTION…"`; the eyebrow/title `"Exhibition"` → `"Practice"`.

- [ ] **Step 5: Typecheck and test**

Run: `cd apps/mobile && npx tsc --noEmit && npx vitest run` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): practice plays on the practice fortune against a real line

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 11: How to play, the summons, Plus, the vocabulary sweep and its lint

**Files:**
- Modify: `apps/mobile/src/app/rites.tsx`, `summons.tsx`, `plus.tsx`
- Create: `apps/mobile/src/ui/LadderTable.tsx`
- Modify: every file the sweep in step 3 finds
- Create: `apps/mobile/test/vocabulary.test.ts`

**Interfaces:**
- Consumes: `ladderTable()` (Task 4); `GAME_TERMS`, `INTRO_LINES`, `RITES_V2_SECTIONS` (Task 3).
- Produces: the mobile retired-word lint.

- [ ] **Step 1: Write the failing lint**

`apps/mobile/test/vocabulary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// The vocabulary cut (design §8.1, D12), enforced on the app's own inline
// literals -- the core lint covers @oracle/core, but roughly eighty player
// strings live in JSX here and drift back one at a time if nothing watches.
//
// A string literal is prose when it contains a space; identifiers, route
// paths, storage keys, event names and API fields never do. Comments are
// stripped first so the reasoning in them can still name the old words.
const RETIRED = /\b(vigils?|shields?|exhibitions?|rites?|ledgers?|crowds?|conviction|epithets?|oracle rating)\b/i;
const ROOT = join(__dirname, "..", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

function proseLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const text = m[1] ?? m[2] ?? m[3] ?? "";
    if (text.includes(" ")) out.push(text);
  }
  return out;
}

describe("the vocabulary cut in the app", () => {
  it("scans the tree", () => {
    expect(walk(ROOT).length).toBeGreaterThan(50);
  });

  it("never prints a retired word to a player", () => {
    const offences: string[] = [];
    for (const file of walk(ROOT)) {
      const src = stripComments(readFileSync(file, "utf8"));
      for (const text of proseLiterals(src)) {
        if (RETIRED.test(text)) offences.push(`${file.slice(ROOT.length + 1)}: "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });
});
```

Run: `cd apps/mobile && npx vitest run test/vocabulary.test.ts` → FAIL, listing every offending literal. That list is step 3's worklist.

- [ ] **Step 2: How to play, the summons, Plus**

`rites.tsx`:
- Eyebrow: `opening ? "Your first round" : GAME_TERMS.rulesTitle` (now reads "How to play"). Remove the `ARCHIVED RULES · VERSION 1` eyebrow's dependence on nothing — it stays for `archived`.
- After the `RITES_V2_SECTIONS` map (default mode only), render the ladder table:

```tsx
            <Rite index={RITES_V2_SECTIONS.length} gutter={gutter} delayMs={RITES_V2_SECTIONS.length * 90} stamp="THE LADDER">
              <LadderTable />
            </Rite>
```

- The closing block: `ONE PRACTICE QUESTION · IMMEDIATE RESULT · UNRANKED` stays; `"TRY AN EXHIBITION"` → `"TRY A PRACTICE QUESTION"`.

`apps/mobile/src/ui/LadderTable.tsx`:

```tsx
import { View } from "react-native";
import { ladderTable } from "../game/stakeText";
import { Mono, role } from "./Text";
import { colors, space } from "../theme";

// The five rungs as a table (design §8.3): rung, share of fortune, on the Big
// One, and the stake at a founding fortune. Machine register: a table is
// recognised, not read.
export function LadderTable() {
  const rows = [{ rung: "RUNG", percent: "STAKE", bigOne: "BIG ONE", example: "AT 1,000" }, ...ladderTable()];
  return (
    <View style={{ gap: space(1) }}>
      {rows.map((r, i) => (
        <View key={r.rung} style={{ flexDirection: "row", gap: space(2) }}>
          {[r.rung, r.percent, r.bigOne, r.example].map((cell, j) => (
            <Mono key={j} {...role.meta} color={i === 0 ? colors.mutedInk : colors.ink} style={[role.meta.style, { flex: j === 0 ? 0.6 : 1, textAlign: j === 0 ? "left" : "right" }]}>{cell}</Mono>
          ))}
        </View>
      ))}
    </View>
  );
}
```

`summons.tsx`: renders `SUMMONS_LINES` from core (already renamed). Check for any local literal naming the ledger and reword to "your record".

`plus.tsx`: renders `PLUS_CREED_LINES` and `PAYWALL_CTA_LINES` from core. Update comments only if they would confuse; no lint applies to comments.

- [ ] **Step 3: The sweep**

Work down the lint's failure list. Known targets and their replacements (files the earlier tasks did not already touch):

| file | old | new |
| --- | --- | --- |
| `game/crowdVerdict.ts` | `THE CROWD IS STILL GATHERING` / `THE CROWD SPLITS` | `THE PLAYERS ARE STILL GATHERING` / `THE PLAYERS SPLIT` |
| `game/crowdAnticipation.ts` | `The crowd currently leans the other way on {n} of your calls.` | `Other players currently lean the other way on {n} of your calls.` |
| `game/reminders.ts:12` | `RETURN TO OUTSEEN TO CHECK YOUR PREDICTIONS AND THE NEXT CHALLENGE.` | `RETURN TO OUTSEEN. YOUR STAKES ARE SETTLING AND THE NEXT ROUND IS NEAR.` |
| `game/revealSummary.ts` | `{n} RIGHT · {n} CALLS READ` etc. | no retired word; leave |
| `ui/OracleClock.tsx` | check `READING_LINE` source id `system.reading-1` text in core | already clean |
| `api/auth.ts`, `api/client.ts`, `analytics/analytics.ts` | only identifiers | leave |
| `app/index.tsx` | `"The forecaster's ledger"` a11y | `"Your record"` (Task 7 did this; verify) |
| `ui/DuelPortrait.tsx`, `ui/RevealSummary.tsx` | check for `crowd`/`ledger` prose | reword to players/record |

Update every test that asserted an old string (`crowdVerdict.test.ts`, `crowdAnticipation.test.ts`, `reminders.test.ts`, `summons.test.ts`…). Do not touch route strings, keys, ids or field names; the lint ignores them because they carry no space.

- [ ] **Step 4: Run everything**

Run: `cd apps/mobile && npx vitest run && npx tsc --noEmit`
Expected: the vocabulary lint passes with an empty offence list; every other test passes.

- [ ] **Step 5: Commit**

```bash
git add -A apps/mobile
git commit -m "feat(mobile): how to play with the ladder; the vocabulary cut across the app, linted

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 12: The site mirror

**Files:**
- Modify: `apps/site/public/index.html`, `apps/site/public/support.html`

The site is static HTML with no shared copy source. Mirror the four rules sections from `RITES_V2_SECTIONS` (Task 3) verbatim, one `<h2>` per section title and one `<p>` per claim, replace the "Keep a vigil" and Plus paragraphs with the "Your record" claims and the `PLUS_CREED_LINES`, and change the exhibition paragraph to say "practice question … on a practice fortune of 1,000". In `support.html`, retitle the streak FAQ `My streak broke and I thought it was protected.` and reword its answer with "streak protection" in place of "shield" (the mechanics sentence is otherwise unchanged). Fix the existing `Outsee Plus` drift to `Outseen Plus`.

- [ ] **Step 1: Edit both files**
- [ ] **Step 2: Check** — `grep -n -i "vigil\|shield\|exhibition\|ledger\|crowd" apps/site/public/index.html apps/site/public/support.html` prints nothing except the privacy row about "how many shields remain" in `privacy.html`, which is not in scope (a policy document names the purchased item).
- [ ] **Step 3: Commit**

```bash
git add apps/site
git commit -m "docs(site): mirror the House rules and the streak-protection support text

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 13: Run-through on the simulator

**Files:**
- Create: `docs/superpowers/plans/assets/plan-house-mobile/` — `card-side.png`, `card-ladder.png`, `home.png`, `reveal-v3.png`, `reveal-v2.png`, `record.png`, `practice-result.png`, `how-to-play.png`
- Modify: `docs/superpowers/plans/2026-09-10-the-house-mobile.md` — a short "Evidence" section at the end listing the screenshots and what each shows.

Use the `run-oracle-mobile` skill (in `apps/mobile/.claude/skills`) to build, launch and drive the app. The API must serve a version 3 round with lines: either point `EXPO_PUBLIC_API_URL` at the deployed worker (production has version 3 rounds after the cutover) or run the API locally against a PGlite/Neon branch seeded with `world()`-style rows. A version 2 reveal (any date before September 10) covers the legacy branch.

- [ ] **Step 1: Card** — open today's round; screenshot after tapping YES (ladder visible, middle rung selected, readout `STAKE … · WINS …`); screenshot after tapping the 95 rung; seal and confirm the receipt on the next card's footer or the sealed state.
- [ ] **Step 2: Home** — fortune numeral and `FORTUNE` label present; the house line present if a round has settled.
- [ ] **Step 3: Reveal** — a settled version 3 date shows `+N` / `FORTUNE N`, per-card `STAKED … · PAID …`, `YOU TOOK THE ORACLE FOR …`, the line context, the board by return, the all-time toggle; a version 2 date still shows `DAY POINTS`.
- [ ] **Step 4: Record, practice, how to play** — the fortune history rows; the practice result reading `Practice fortune, nothing changed.`; the four rules and the ladder table.
- [ ] **Step 5: VoiceOver spot check** — with VoiceOver on, the YES button announces selected state, a rung announces `Stake 50, wins 93`, SEAL is a button. Note any failure in the Evidence section rather than fixing silently.
- [ ] **Step 6: Commit the evidence**

```bash
git add docs/superpowers/plans/assets/plan-house-mobile docs/superpowers/plans/2026-09-10-the-house-mobile.md
git commit -m "docs(plan): House mobile run-through evidence

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```
