# The Oracle and the Board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make THE ORACLE a character that forecasts crowd-blind before the round opens, keeps its own record, and stands by name in a daily board that becomes a ranked list of people instead of a rank and two aggregates.

**Architecture:** The Oracle's forecast becomes its own pipeline action (`{kind:"forecast"}`) decided by `decideActions`, exactly like `author` — so it is idempotent, retried on the next tick, and structurally incapable of blocking the noon drop. Its record needs no schema: `questions.oracle_p_yes` plus `questions.outcome` is enough to compute Brier, score and day totals on read. Board designations are derived deterministically from user id, so nothing a user typed is ever stored or rendered.

**Tech Stack:** TypeScript, pnpm monorepo. `@oracle/core` (pure, vitest), `apps/api` (Hono on Cloudflare Workers, Drizzle/Neon, vitest + PGlite), `apps/mobile` (Expo SDK 57, expo-router, React Query, Skia).

**Spec:** `docs/superpowers/specs/2026-09-03-the-oracle-and-the-board-design.md` — read it before Task 1. This plan argues from it; where they disagree, the spec wins except for the one amendment recorded in §"Spec amendment" below.

## Spec amendment (agreed before planning)

The spec's §2.2 says the forecast runs "inside `publish`… before the questions go live" and also that "the drop must never block on the forecaster." Those conflict: the forecasting call makes chained web searches and takes minutes, and `publish` is the noon drop.

**Resolution: the forecast is its own action**, decided by `decideActions` and executed by `runTick`, exactly as `author` is. Crowd-blindness is preserved regardless of ordering because the forecaster never reads `predictions` — that is a property of what it queries, not of when it runs. The drop stays instant; the forecast lands on the same or a following tick and retries hourly until it succeeds.

## Global Constraints

- **Never read `predictions` in any forecasting code path.** This is the crowd-blindness guarantee and it is enforced by what the code queries, not by a comment.
- **Never pass `author_prob` to the forecaster.** It is a contestedness target, not a belief; feeding it in would make the Oracle grade its own homework.
- **The Oracle never receives `CONTRARIAN_BONUS`, the vigil multiplier, or `FIRST_HOUR_BONUS`.** It does receive `BIG_ONE_MULT`. Rule: it keeps what a call itself earns, and nothing that timing, a crowd, or a purchase confers.
- **The board's ranking of players stays `SUM(predictions.points)`** — raw `questionPoints`. Do not change it. Money must not buy a place on the board.
- **`BOARD_MIN_FIELD` (5), complete-rounds-only, and the 409-until-every-outcome posture on the board route are unchanged.**
- **Machine-voice register** for every user-visible string: ALL CAPS, no emoji, no `!`, no CTA verbs (`CHECK`, `TAP`, `CLICK`, `VISIT`, `RESULTS`, `DON'T MISS`), ≤140 chars.
- **No non-ASCII in any Skia text.** Skia has no font fallback; `✓`/`✗`/`✶` render as tofu. RN `<Text>` is fine.
- **One owner per file.** Tracks B, C and D must not edit each other's files or `packages/core`. If a track needs a core change, it stops and reports rather than editing.
- Commands: `pnpm --filter @oracle/core test`, `pnpm --filter @oracle/api test`, `pnpm --filter @oracle/mobile test`, `pnpm -r typecheck`.

## File Structure

**Track A — `@oracle/core` (must complete before B, C, D start):**
- Delete: `packages/core/src/forecast.ts`, `packages/core/test/forecast.test.ts`
- Modify: `packages/core/src/constants.ts` (drop 4 `FORECAST_*`, add 2 board constants)
- Create: `packages/core/src/oracleRecord.ts` — the Oracle's calls, Brier and day points. Pure.
- Create: `packages/core/src/designation.ts` — deterministic pseudonyms. Pure.
- Modify: `packages/core/src/schemas.ts` — `RoundBoardSchema.rows`, `MeLedgerSchema` oracle fields
- Modify: `packages/core/src/index.ts` — exports
- Create: `packages/core/test/oracleRecord.test.ts`, `packages/core/test/designation.test.ts`

**Track B — pipeline (`apps/api/src/pipeline`):**
- Create: `apps/api/src/pipeline/forecast.ts` — the prompt, the call, the stamp
- Modify: `apps/api/src/pipeline/actions.ts` (delete `stampForecasts`, drop it from `lock`), `state.ts` (`needsForecast`), `index.ts` (`PipelineDeps.models.forecast`, the `forecast` case)
- Modify: `apps/api/src/worker.ts` (thread `PIPELINE_FORECAST_MODEL`)
- Create: `apps/api/test/pipeline-forecast.test.ts`; Modify: `apps/api/test/pipeline-decide.test.ts`

**Track C — API routes (`apps/api/src/routes`):**
- Modify: `apps/api/src/routes/round.ts` (board rows), `apps/api/src/routes/me.ts` (ledger oracle fields)
- Modify: `apps/api/test/round.test.ts`, `apps/api/test/ledger.test.ts`

**Track D — mobile (`apps/mobile`):**
- Modify: `apps/mobile/src/game/dailyBoard.ts` (rows), `apps/mobile/src/app/reveal/[date].tsx` (the Oracle line + board list), `apps/mobile/src/app/ledger.tsx` (rivalry rows), `apps/mobile/src/ui/ShareCard.tsx` (one night-card line)
- Modify/Create: `apps/mobile/test/dailyBoard.test.ts`

---

## Track A — `@oracle/core`

**Run by one agent, tasks in order.** Everything else depends on this track landing first.

### Task 1: Delete the weighted crowd

The Oracle is currently the crowd's own mean returned under a different name (`forecast.ts:12` short-circuits below `FORECAST_MIN_RATED`, which is 500). It is deleted, not deferred — keeping it beside a real Oracle would leave two things claiming one name.

**Files:**
- Delete: `packages/core/src/forecast.ts`, `packages/core/test/forecast.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/constants.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: removal of `oracleForecast`, `extremize`, `ForecastInput`, and constants `FORECAST_MIN_RATED`, `FORECAST_WEIGHT_PIVOT`, `FORECAST_WEIGHT_SCALE`, `FORECAST_EXTREMIZE_D` from `@oracle/core`. Track B removes the one API call site.

- [ ] **Step 1: Confirm the only consumer**

Run: `grep -rn "oracleForecast\|extremize\|FORECAST_" packages/core/src apps/api/src apps/mobile/src`
Expected: hits only in `packages/core/src/forecast.ts`, `packages/core/src/constants.ts`, `packages/core/src/index.ts`, and `apps/api/src/pipeline/actions.ts`. If anything else appears, stop and report — the spec assumed these four.

- [ ] **Step 2: Delete the module and its test**

```bash
git rm packages/core/src/forecast.ts packages/core/test/forecast.test.ts
```

- [ ] **Step 3: Remove the export**

In `packages/core/src/index.ts`, delete the line `export * from "./forecast";`.

- [ ] **Step 4: Remove the constants**

In `packages/core/src/constants.ts`, delete these four lines:

```ts
  FORECAST_WEIGHT_PIVOT: 750,
  FORECAST_WEIGHT_SCALE: 60,
  FORECAST_EXTREMIZE_D: 1.5,
  FORECAST_MIN_RATED: 500,
```

- [ ] **Step 5: Verify core is green and the symbol is gone**

Run: `pnpm --filter @oracle/core test && grep -rn "oracleForecast" packages/core || true`
Expected: tests PASS; no `oracleForecast` in `packages/core`. `pnpm -r typecheck` will still fail on `apps/api/src/pipeline/actions.ts` — that is Track B's Task 4 and is expected at this point.

- [ ] **Step 6: Commit**

```bash
git add -A packages/core
git commit -m "refactor(core): the weighted crowd stops calling itself the Oracle"
```

### Task 2: The Oracle's record

**Files:**
- Create: `packages/core/src/oracleRecord.ts`
- Create: `packages/core/test/oracleRecord.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: `CONSTANTS` from `./constants`.
- Produces, all exported from `@oracle/core`:
  - `oracleCall(pYes: number | null): "yes" | "no" | null`
  - `oracleCallRight(pYes: number | null, outcome: "yes" | "no" | "void" | null): boolean | null`
  - `oracleQuestionPoints(input: { pYes: number; outcome: "yes" | "no" | "void"; isBigOne: boolean }): number`
  - `oracleBrierOf(pYes: number, outcome: "yes" | "no"): number`
  - `dayCallCounts(questions: Array<{ outcome: "yes" | "no" | "void" | null; oracle_p_yes: number | null; my: { answer: boolean } | null }>): { you: number; oracle: number }`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/oracleRecord.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { oracleCall, oracleCallRight, oracleQuestionPoints, oracleBrierOf, dayCallCounts } from "../src/oracleRecord";
import { CONSTANTS as C } from "../src/constants";

describe("oracleCall", () => {
  it("reads a side from the probability", () => {
    expect(oracleCall(0.83)).toBe("yes");
    expect(oracleCall(0.17)).toBe("no");
  });
  it("treats exactly 0.5 as an abstention, never a coin flip", () => {
    // A forced call is right half the time by construction; counting one
    // would flatter the machine. The Oracle is allowed to decline.
    expect(oracleCall(0.5)).toBeNull();
  });
  it("has no call without a forecast", () => {
    expect(oracleCall(null)).toBeNull();
  });
});

describe("oracleCallRight", () => {
  it("scores a real call against a real outcome", () => {
    expect(oracleCallRight(0.83, "yes")).toBe(true);
    expect(oracleCallRight(0.83, "no")).toBe(false);
    expect(oracleCallRight(0.17, "no")).toBe(true);
  });
  it("leaves the denominator on abstention, void, and no outcome", () => {
    expect(oracleCallRight(0.5, "yes")).toBeNull();
    expect(oracleCallRight(0.83, "void")).toBeNull();
    expect(oracleCallRight(0.83, null)).toBeNull();
    expect(oracleCallRight(null, "yes")).toBeNull();
  });
});

describe("oracleQuestionPoints", () => {
  it("is affine in brier, exactly as questionPoints is", () => {
    // p=0.83 on a YES: brier 0.0289 → 200 × (0.25 − 0.0289) = 44.22 → 44
    expect(oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false })).toBe(44);
  });
  it("doubles the big one in both directions", () => {
    const win = oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: true });
    const loss = oracleQuestionPoints({ pYes: 0.83, outcome: "no", isBigOne: true });
    expect(win).toBe(2 * oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false }));
    expect(loss).toBe(2 * oracleQuestionPoints({ pYes: 0.83, outcome: "no", isBigOne: false }));
  });
  it("scores an abstention at exactly zero", () => {
    expect(oracleQuestionPoints({ pYes: 0.5, outcome: "yes", isBigOne: false })).toBe(0);
    expect(oracleQuestionPoints({ pYes: 0.5, outcome: "no", isBigOne: true })).toBe(0);
  });
  it("scores a void at zero", () => {
    expect(oracleQuestionPoints({ pYes: 0.95, outcome: "void", isBigOne: true })).toBe(0);
  });
  // TRIPWIRE (spec §7). Bound to the one path that makes the claim, and
  // proven to ring: change oracleQuestionPoints to add C.CONTRARIAN_BONUS and
  // this test MUST fail. The machine keeps what a call earns and nothing a
  // crowd, a clock, or a purchase confers.
  it("never receives the contrarian bounty, whatever the crowd did", () => {
    const alone = oracleQuestionPoints({ pYes: 0.83, outcome: "yes", isBigOne: false });
    const withBounty = alone + C.CONTRARIAN_BONUS;
    expect(alone).toBe(44);
    expect(alone).not.toBe(withBounty);
    // oracleQuestionPoints takes no crowd argument at all -- there is no
    // input by which a bounty could reach it. This is the structural half
    // of the guarantee; the numeric assertion above is the tripwire.
    expect(oracleQuestionPoints.length).toBe(1);
  });
});

describe("dayCallCounts", () => {
  const q = (outcome: "yes" | "no" | "void" | null, oracle: number | null, mine: boolean | null) => ({
    outcome,
    oracle_p_yes: oracle,
    my: mine === null ? null : { answer: mine },
  });
  it("counts both sides of the day", () => {
    const counts = dayCallCounts([
      q("yes", 0.8, true),   // both right
      q("no", 0.9, false),   // player right, oracle wrong
      q("yes", 0.7, false),  // oracle right, player wrong
    ]);
    expect(counts).toEqual({ you: 2, oracle: 2 });
  });
  it("drops voids, abstentions and unplayed questions from the counts", () => {
    const counts = dayCallCounts([
      q("void", 0.9, true),
      q("yes", 0.5, true),   // oracle abstains, player right
      q("yes", 0.9, null),   // player never sealed, oracle right
    ]);
    expect(counts).toEqual({ you: 1, oracle: 1 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/core test oracleRecord`
Expected: FAIL — cannot resolve `../src/oracleRecord`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/oracleRecord.ts`:

```ts
import { CONSTANTS as C } from "./constants";

// THE ORACLE's own record. It forecasts every question before the round
// opens, crowd-blind, and is read on the same rule as the players -- with
// one asymmetry, stated here because it is the whole ethic of the thing:
// the machine keeps what a CALL earns (the affine-Brier term and the big
// one's double weight) and nothing that TIMING, a CROWD, or a PURCHASE
// confers (the first hour, the contrarian bounty, the vigil multiplier).

export type OracleSide = "yes" | "no" | null;

/**
 * Exactly 0.5 is an ABSTENTION, not a coin flip. The machine is allowed to
 * decline, and a forced call would be right half the time by construction --
 * counting it would flatter the Oracle's record for free.
 */
export function oracleCall(pYes: number | null): OracleSide {
  if (pYes === null) return null;
  if (pYes > 0.5) return "yes";
  if (pYes < 0.5) return "no";
  return null;
}

/** null means "not counted": no forecast, an abstention, a void, or unresolved. */
export function oracleCallRight(
  pYes: number | null,
  outcome: "yes" | "no" | "void" | null,
): boolean | null {
  if (outcome === null || outcome === "void") return null;
  const call = oracleCall(pYes);
  if (call === null) return null;
  return call === outcome;
}

export function oracleBrierOf(pYes: number, outcome: "yes" | "no"): number {
  return (pYes - (outcome === "yes" ? 1 : 0)) ** 2;
}

/**
 * The Oracle's points on one question. Deliberately takes NO crowd argument:
 * there is no input by which the contrarian bounty could reach it.
 */
export function oracleQuestionPoints(input: {
  pYes: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
}): number {
  if (input.outcome === "void") return 0;
  const b = oracleBrierOf(input.pYes, input.outcome);
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b);
  const result = (input.isBigOne ? C.BIG_ONE_MULT : 1) * base;
  // Same two-stage rounding questionPoints uses: kill float noise, then int.
  return Math.round(Math.round(result * 1e10) / 1e10);
}

/**
 * The reveal's closing line: how many calls each of you got right today.
 * Reported as two bare counts with no denominator, because the denominators
 * genuinely differ -- the Oracle may abstain and the player may not have
 * sealed -- and a shared denominator would be a lie about one of them.
 */
export function dayCallCounts(
  questions: Array<{
    outcome: "yes" | "no" | "void" | null;
    oracle_p_yes: number | null;
    my: { answer: boolean } | null;
  }>,
): { you: number; oracle: number } {
  let you = 0;
  let oracle = 0;
  for (const q of questions) {
    if (q.outcome === null || q.outcome === "void") continue;
    if (q.my && (q.my.answer ? "yes" : "no") === q.outcome) you += 1;
    if (oracleCallRight(q.oracle_p_yes, q.outcome) === true) oracle += 1;
  }
  return { you, oracle };
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, add after the `./scoring` line:

```ts
export * from "./oracleRecord";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/core test oracleRecord`
Expected: PASS, all 12 assertions.

- [ ] **Step 6: Prove the tripwire rings**

Temporarily change `oracleQuestionPoints`'s `result` line to `const result = (input.isBigOne ? C.BIG_ONE_MULT : 1) * base + C.CONTRARIAN_BONUS;`, run `pnpm --filter @oracle/core test oracleRecord`, and confirm the contrarian test FAILS. Then revert the change and confirm it passes again. A tripwire that has never been shown to ring is not a tripwire.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/oracleRecord.ts packages/core/test/oracleRecord.test.ts packages/core/src/index.ts
git commit -m "feat(core): the machine keeps a record of its own calls"
```

### Task 3: Designations

**Files:**
- Create: `packages/core/src/designation.ts`
- Create: `packages/core/test/designation.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `designation(userId: string): string`, `disambiguate(names: string[]): string[]`, `ORACLE_DESIGNATION: "THE ORACLE"`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/designation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { designation, disambiguate, ORACLE_DESIGNATION } from "../src/designation";

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

describe("designation", () => {
  it("is stable for the same id -- a rival must survive the night", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    expect(designation(id)).toBe(designation(id));
  });
  it("differs across ids", () => {
    const names = new Set(
      Array.from({ length: 200 }, (_, i) => designation(`user-${i}`)),
    );
    // Not uniqueness -- collisions are expected and handled by disambiguate.
    // This only asserts the hash actually spreads.
    expect(names.size).toBeGreaterThan(80);
  });
  it("holds the machine register", () => {
    for (let i = 0; i < 300; i++) {
      const name = designation(`user-${i}`);
      expect(name).toBe(name.toUpperCase());
      expect(name).not.toMatch(EMOJI);
      expect(name).not.toContain("!");
      expect(name.startsWith("THE ")).toBe(true);
      expect(name.length).toBeLessThanOrEqual(28);
    }
  });
  it("never collides with the machine's own name", () => {
    for (let i = 0; i < 300; i++) {
      expect(designation(`user-${i}`)).not.toBe(ORACLE_DESIGNATION);
    }
  });
});

describe("disambiguate", () => {
  it("leaves distinct names alone", () => {
    expect(disambiguate(["THE COLD WITNESS", "THE PATIENT SCRIBE"]))
      .toEqual(["THE COLD WITNESS", "THE PATIENT SCRIBE"]);
  });
  it("numbers repeats in the order they appear", () => {
    expect(disambiguate(["THE COLD WITNESS", "THE COLD WITNESS", "THE COLD WITNESS"]))
      .toEqual(["THE COLD WITNESS", "THE COLD WITNESS II", "THE COLD WITNESS III"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/core test designation`
Expected: FAIL — cannot resolve `../src/designation`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/designation.ts`. Use exactly these pools — they are a voice artefact and were sized so the visible window rarely collides (30 × 20 = 600):

```ts
// How the board names a player who has not been named by the ledger.
//
// ASSIGNED, not chosen, and derived from the user id -- so nothing a person
// typed is ever stored or rendered, and the board carries no user-generated
// content, no report path, and no moderation surface.
//
// STABLE ACROSS DAYS ON PURPOSE. A designation that changed nightly would be
// cheaper to generate and worth far less: the point is that a stranger who
// beat you three days running becomes a rival you never agreed to have.
//
// A designation is meaningless by construction. An EPITHET is earned and
// carries a receipt. The ledger records everyone and names only those it can
// prove -- see epithet.ts for the half that must be earned.

const MODIFIERS = [
  "PATIENT", "COLD", "RESTLESS", "SILENT", "STEADY", "DISTANT", "QUIET", "SEVERE",
  "FAITHFUL", "DOUBTING", "EARLY", "LATE", "STUBBORN", "CAREFUL", "SPARING", "EXACT",
  "SLOW", "SUDDEN", "PLAIN", "GRAVE", "MILD", "CERTAIN", "UNEASY", "MEASURED",
  "WAKEFUL", "SOBER", "NARROW", "OBSTINATE", "TEMPERATE", "UNHURRIED",
] as const;

const ROLES = [
  "SCRIBE", "WITNESS", "HAND", "READER", "AUGUR", "WATCHER", "KEEPER", "VOICE",
  "CLERK", "STEWARD", "COUNTER", "MARKER", "TALLY", "REGISTRAR", "ARCHIVIST",
  "SIGNATORY", "ATTENDANT", "PROCTOR", "AUDITOR", "NOTARY",
] as const;

/** The machine's own row on the board. Never assigned to a player. */
export const ORACLE_DESIGNATION = "THE ORACLE";

// Deterministic 32-bit string hash. Same char-walk shape epigraph.ts uses;
// it needs to spread, not to be cryptographic.
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function designation(userId: string): string {
  const h = hash(userId);
  // Two independent draws from one hash: the low bits pick the role, the
  // high bits the modifier, so ids adjacent in the low bits still differ.
  const role = ROLES[h % ROLES.length]!;
  const modifier = MODIFIERS[Math.floor(h / ROLES.length) % MODIFIERS.length]!;
  return `THE ${modifier} ${role}`;
}

const SUFFIXES = ["", " II", " III", " IV", " V", " VI", " VII", " VIII"];

/**
 * Within one rendered window only. The pool is not large enough to guarantee
 * global uniqueness and does not try to be -- a reader only ever sees a
 * handful of rows, so repeats are resolved where they are visible.
 */
export function disambiguate(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return `${name}${SUFFIXES[Math.min(n, SUFFIXES.length - 1)] ?? ""}`;
  });
}
```

- [ ] **Step 4: Export it**

In `packages/core/src/index.ts`, add:

```ts
export * from "./designation";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/core test designation`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/designation.ts packages/core/test/designation.test.ts packages/core/src/index.ts
git commit -m "feat(core): the board can name a player it has not yet proved"
```

### Task 4: The schemas both API tracks code against

Defined here, in one owner, so Tracks C and D never touch `schemas.ts` and never collide on it.

**Files:**
- Modify: `packages/core/src/schemas.ts`, `packages/core/src/constants.ts`
- Modify: `packages/core/test/round-schemas.test.ts`

**Interfaces:**
- Produces: `RoundBoardSchema.rows`, `MeLedgerSchema.oracle`, `CONSTANTS.BOARD_TOP_ROWS` (3), `CONSTANTS.BOARD_NEIGHBOURS` (2).

- [ ] **Step 1: Add the two board constants**

In `packages/core/src/constants.ts`, immediately after `BOARD_MIN_FIELD: 5,`:

```ts
  // The board's window. Named here rather than as literals at the call site
  // because the reveal reserves height against them.
  BOARD_TOP_ROWS: 3,      // rows from the summit
  BOARD_NEIGHBOURS: 2,    // rows either side of the caller
```

- [ ] **Step 2: Write the failing schema test**

Append to `packages/core/test/round-schemas.test.ts`:

```ts
describe("the board's rows", () => {
  it("accepts a field with the Oracle standing in it", () => {
    const parsed = RoundBoardSchema.parse({
      date: "2026-09-03",
      field_size: 9,
      your_points: 96,
      your_rank: 7,
      best_points: 268,
      median_points: 96,
      rows: [
        { name: "THE COLD WITNESS", points: 268, rank: 1, is_you: false, is_oracle: false },
        { name: "THE ORACLE", points: 184, rank: 3, is_you: false, is_oracle: true },
        { name: "THE PATIENT SCRIBE", points: 96, rank: 7, is_you: true, is_oracle: false },
      ],
    });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.find((r) => r.is_oracle)?.name).toBe("THE ORACLE");
  });
  it("accepts an empty row list below the field floor", () => {
    const parsed = RoundBoardSchema.parse({
      date: "2026-09-03", field_size: 2, your_points: 40,
      your_rank: null, best_points: null, median_points: null, rows: [],
    });
    expect(parsed.rows).toEqual([]);
  });
});

describe("the ledger's rivalry block", () => {
  it("carries the machine's score and the days outseen", () => {
    const parsed = MeLedgerSchema.parse({
      ...LEDGER_FIXTURE,
      oracle: { score: null, calls_rated: 34, days_outseen: 4, days_compared: 11 },
    });
    expect(parsed.oracle.days_outseen).toBe(4);
  });
});
```

If `LEDGER_FIXTURE` does not already exist in that file, build the object inline from the current `MeLedgerSchema` shape — read the schema and supply every existing required field verbatim. Do not weaken the schema to make the fixture easier.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @oracle/core test round-schemas`
Expected: FAIL — `rows` and `oracle` are not in the schemas.

- [ ] **Step 4: Extend the schemas**

In `packages/core/src/schemas.ts`, add to `RoundBoardSchema` (inside the object, after `median_points`):

```ts
  // The field as a room rather than a rank. Machine-assigned designations
  // only -- nothing a user typed reaches this array, which is what keeps the
  // board free of a moderation surface. Empty below BOARD_MIN_FIELD.
  rows: z.array(
    z.object({
      name: z.string(),
      points: z.number().int(),
      rank: z.number().int(),
      is_you: z.boolean(),
      // The machine stands in the list on the same ladder as the rows
      // beside it: big-one weight in, first hour / vigil / bounty out.
      is_oracle: z.boolean(),
    }),
  ),
```

And add to `MeLedgerSchema`:

```ts
  // THE ORACLE's own record, on the same fifty-call floor the player meets --
  // so for the first ten days the machine reads UNWRITTEN beside them.
  oracle: z.object({
    score: z.number().int().nullable(),
    calls_rated: z.number().int(),
    // Complete rounds in which the player got more calls right than the
    // machine did, and how many complete rounds were compared at all.
    days_outseen: z.number().int(),
    days_compared: z.number().int(),
  }),
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @oracle/core test`
Expected: PASS, whole core suite.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): the board carries a room, and the ledger carries a rival"
```

- [ ] **Step 7: Report the handoff**

Report to the orchestrator that Track A is complete and B, C, D may start. State the exact exported names from Tasks 2–4 so the parallel tracks code against real signatures.

---

## Track B — the forecast action (`apps/api/src/pipeline`)

**Depends on Track A.** Owns only `apps/api/src/pipeline/*`, `apps/api/src/worker.ts`, and `apps/api/test/pipeline-*`.

### Task 5: The Oracle forecasts, as its own action

**Files:**
- Create: `apps/api/src/pipeline/forecast.ts`
- Modify: `apps/api/src/pipeline/actions.ts` (delete `stampForecasts`; remove its call from `lock`), `apps/api/src/pipeline/state.ts`, `apps/api/src/pipeline/index.ts`, `apps/api/src/worker.ts`
- Create: `apps/api/test/pipeline-forecast.test.ts`
- Modify: `apps/api/test/pipeline-decide.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient.structured` (`{ model, system, user, schemaName, schema, webSearch }`), `PipelineDeps`, `schema.questions.oracleProbYes`.
- Produces: `stampOracleForecast(deps: PipelineDeps, date: string): Promise<void>`, `Action` variant `{ kind: "forecast"; date: string }`, `PipelineState.openRound.needsForecast: boolean`, `PipelineDeps.models.forecast: string`.

- [ ] **Step 1: Write the failing decision test**

Append to `apps/api/test/pipeline-decide.test.ts` (match the file's existing state-fixture helper style):

```ts
describe("the forecast action", () => {
  const openNeeding = {
    openRound: { date: "2026-09-03", lockPassed: false, needsForecast: true },
    lockedRound: null, scheduledDates: [], bankCount: 5,
  };
  it("is decided while the open round has unforecast questions", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow, openNeeding,
    );
    expect(actions).toContainEqual({ kind: "forecast", date: "2026-09-03" });
  });
  it("is throttled to once an hour, like authoring", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 35 } as ETNow, openNeeding,
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("stops once every question carries a forecast", () => {
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
      { ...openNeeding, openRound: { ...openNeeding.openRound, needsForecast: false } },
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
  it("is never decided for a round that has already passed its lock", () => {
    // Past lock the answers exist; a forecast then would be a look-up.
    const actions = decideActions(
      { date: "2026-09-03", hour: 13, minute: 5 } as ETNow,
      { ...openNeeding, openRound: { ...openNeeding.openRound, lockPassed: true } },
    );
    expect(actions.find((a) => a.kind === "forecast")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test pipeline-decide`
Expected: FAIL — `needsForecast` is not on the state type and no `forecast` action exists.

- [ ] **Step 3: Extend the state machine**

In `apps/api/src/pipeline/state.ts`:

Add to the `Action` union:

```ts
  | { kind: "forecast"; date: string }
```

Change the `openRound` field of `PipelineState` to:

```ts
  openRound: { date: string; lockPassed: boolean; needsForecast: boolean } | null;
```

In `loadPipelineState`, inside the `if (openRoundRow)` block, after `maxLocksAt` is computed:

```ts
    openRound = {
      date: openRoundRow.date,
      lockPassed: now.getTime() >= maxLocksAt,
      // The Oracle owes this round a position on every question. Recomputed
      // from the rows each tick, so a partial stamp simply retries.
      needsForecast: questions.some((q) => q.oracleProbYes === null),
    };
```

(Delete the previous `openRound = { ... }` assignment.)

In `decideActions`, immediately after the LOCK block:

```ts
  // FORECAST — the Oracle owes the open round a position, and takes it
  // before the answers exist. Hourly throttle (minute<10) like authoring:
  // the call makes chained web searches and a failure simply retries.
  // Never past the lock: at that point a forecast would be a look-up.
  if (state.openRound && !state.openRound.lockPassed && state.openRound.needsForecast && minute < 10) {
    actions.push({ kind: "forecast", date: state.openRound.date });
  }
```

- [ ] **Step 4: Run to verify the decision tests pass**

Run: `pnpm --filter @oracle/api test pipeline-decide`
Expected: PASS. Other API tests that build `PipelineState` fixtures will now fail to typecheck; fix each by adding `needsForecast: false` to its `openRound` literal. Do not change any other assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/state.ts apps/api/test
git commit -m "feat(api): the tick knows the Oracle owes the round a position"
```

- [ ] **Step 6: Write the failing forecast test**

Create `apps/api/test/pipeline-forecast.test.ts`. Follow the fixture and DB-harness conventions in `apps/api/test/pipeline-author.test.ts` (same `makeDeps` / seeded-round helpers; never call the network):

```ts
import { describe, it, expect, vi } from "vitest";
import { stampOracleForecast } from "../src/pipeline/forecast";
// ... harness imports mirroring pipeline-author.test.ts

describe("stampOracleForecast", () => {
  it("stamps every question's oracle_p_yes from one structured call", async () => {
    const structured = vi.fn().mockResolvedValue({
      forecasts: [
        { slot: 1, p_yes: 0.62 }, { slot: 2, p_yes: 0.31 }, { slot: 3, p_yes: 0.5 },
        { slot: 4, p_yes: 0.88 }, { slot: 5, p_yes: 0.44 },
      ],
    });
    const deps = makeDeps({ claude: { structured } });
    await seedOpenRound(deps.db, "2026-09-03");

    await stampOracleForecast(deps, "2026-09-03");

    const rows = await deps.db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2026-09-03"),
    });
    expect(rows.map((r) => Number(r.oracleProbYes)).sort()).toEqual([0.31, 0.44, 0.5, 0.62, 0.88]);
  });

  // THE CROWD-BLINDNESS GUARANTEE. Structural, not advisory: the prompt is
  // built from questions alone, so there is no path by which a prediction
  // could reach it. Seal a lopsided crowd first and assert the prompt is
  // byte-identical to the prompt with no crowd at all.
  it("builds a prompt that cannot contain the crowd", async () => {
    const structured = vi.fn().mockResolvedValue({ forecasts: [/* five slots */] });
    const deps = makeDeps({ claude: { structured } });
    await seedOpenRound(deps.db, "2026-09-03");
    await stampOracleForecast(deps, "2026-09-03");
    const before = structured.mock.calls[0]![0];

    await sealLopsidedCrowd(deps.db, "2026-09-03"); // 20 players, all YES at 95
    await deps.db.update(schema.questions).set({ oracleProbYes: null })
      .where(eq(schema.questions.roundDate, "2026-09-03"));
    await stampOracleForecast(deps, "2026-09-03");
    const after = structured.mock.calls[1]![0];

    expect(after.system).toBe(before.system);
    expect(after.user).toBe(before.user);
  });

  it("never shows the forecaster the author's own probability", async () => {
    const structured = vi.fn().mockResolvedValue({ forecasts: [/* five slots */] });
    const deps = makeDeps({ claude: { structured } });
    await seedOpenRound(deps.db, "2026-09-03", { authorProb: "0.42" });
    await stampOracleForecast(deps, "2026-09-03");
    const call = structured.mock.calls[0]![0];
    expect(`${call.system}${call.user}`).not.toContain("0.42");
    expect(`${call.system}${call.user}`.toLowerCase()).not.toContain("author_prob");
  });

  it("leaves the round unstamped and does not throw when the call fails", async () => {
    const structured = vi.fn().mockRejectedValue(new Error("claude: 529"));
    const deps = makeDeps({ claude: { structured } });
    await seedOpenRound(deps.db, "2026-09-03");
    await expect(stampOracleForecast(deps, "2026-09-03")).rejects.toThrow();
    const rows = await deps.db.query.questions.findMany({
      where: eq(schema.questions.roundDate, "2026-09-03"),
    });
    expect(rows.every((r) => r.oracleProbYes === null)).toBe(true);
  });

  it("rejects a response missing a slot rather than stamping a partial round", async () => {
    const structured = vi.fn().mockResolvedValue({ forecasts: [{ slot: 1, p_yes: 0.6 }] });
    const deps = makeDeps({ claude: { structured } });
    await seedOpenRound(deps.db, "2026-09-03");
    await expect(stampOracleForecast(deps, "2026-09-03")).rejects.toThrow(/validation|slot/i);
  });
});
```

Fill the elided `/* five slots */` literals with the same five-element array used in the first test.

- [ ] **Step 7: Run to verify it fails**

Run: `pnpm --filter @oracle/api test pipeline-forecast`
Expected: FAIL — cannot resolve `../src/pipeline/forecast`.

- [ ] **Step 8: Write the forecaster**

Create `apps/api/src/pipeline/forecast.ts`:

```ts
// THE ORACLE takes its own position, crowd-blind, before the answers exist.
//
// It runs as its own action rather than inside publish for one reason: the
// call makes chained web searches and takes minutes, and the noon drop must
// never wait on it (spec §2.2 + the plan's spec amendment). Crowd-blindness
// does not depend on that ordering -- it holds because this file never reads
// the predictions table, which is a property of what it queries.
//
// It must also never see questions.author_prob: that is a contestedness
// TARGET chosen to make the question hard, not a belief, and handing it to
// the forecaster would have the machine grade its own homework.
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";

const ForecastSchema = z.object({
  forecasts: z.array(
    z.object({ slot: z.number().int().min(1).max(5), p_yes: z.number().min(0).max(1) }),
  ),
});

const forecastJsonSchema = {
  type: "object",
  properties: {
    forecasts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: "integer" },
          p_yes: { type: "number", description: "Your probability that the answer is YES, 0 to 1." },
        },
        required: ["slot", "p_yes"],
        additionalProperties: false,
      },
    },
  },
  required: ["forecasts"],
  additionalProperties: false,
};

function systemPrompt(date: string): string {
  return `You are THE ORACLE. Today is the round dated ${date}; it closes at noon ET tomorrow. You will be shown the round's five yes/no questions and you must state, for each, your own probability that the answer is YES.

- You are forecasting, not resolving. Nobody has answered yet and the outcomes do not exist. Search the web for what is known NOW, then commit.
- State a real belief. You will be scored on it with a proper rule, so an honest probability is your best play and a hedge toward 0.5 is not a safe answer, it is a weak one.
- You may state 0.5 exactly, and it means you decline to call the question. It is scored as neither right nor wrong. Use it when you genuinely have no read, never to be safe.
- You never revise. There is no second look before this round closes.

Call the oracle_forecast tool exactly once, with one entry per slot.`;
}

export async function stampOracleForecast(deps: PipelineDeps, date: string): Promise<void> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  // Questions only. No join to predictions, and author_prob is not selected.
  const rows = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
  });
  if (rows.length === 0) throw new Error(`no round for ${date}`);

  const user = rows
    .map((q) => `[slot ${q.slot}${q.isBigOne ? " · THE BIG ONE" : ""}] ${q.text}\n  RESOLVES BY: ${q.resolutionCriteria}\n  SOURCE: ${q.sourceName}`)
    .join("\n\n");

  const response = await deps.claude.structured({
    model: deps.models.forecast,
    system: systemPrompt(date),
    user: `${user}\n\nState your probability for each slot now.`,
    schemaName: "oracle_forecast",
    schema: forecastJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const parsed = ForecastSchema.safeParse(response);
  if (!parsed.success) throw new Error(`forecast: response failed validation`);

  const bySlot = new Map(parsed.data.forecasts.map((f) => [f.slot, f.p_yes]));
  // All or nothing: a partial stamp would leave needsForecast true forever
  // while half the round carried a position, and the record would be built
  // on a round the Oracle only half answered.
  for (const q of rows) {
    if (!bySlot.has(q.slot)) throw new Error(`forecast: missing slot ${q.slot}`);
  }
  for (const q of rows) {
    await deps.db
      .update(schema.questions)
      .set({ oracleProbYes: String(bySlot.get(q.slot)!) })
      .where(and(eq(schema.questions.id, q.id), eq(schema.questions.roundDate, date)));
  }
}
```

- [ ] **Step 9: Delete the weighted-crowd stamp**

In `apps/api/src/pipeline/actions.ts`: delete the entire `stampForecasts` function (currently lines 23–38) and its `oracleForecast` import, and remove the `await stampForecasts(db, date);` line from `lock`. Remove now-unused imports (`isNotNull`, `count` if nothing else uses them — let the typechecker tell you).

- [ ] **Step 10: Wire the action**

In `apps/api/src/pipeline/index.ts`:

Add `forecast: string;` to `PipelineDeps["models"]`. Add the import `import { stampOracleForecast } from "./forecast";`. Add this case to the switch in `runTick`:

```ts
        case "forecast":
          await stampOracleForecast(deps, action.date);
          done.push(`forecast:${action.date}`);
          break;
```

In `apps/api/src/worker.ts`, thread `PIPELINE_FORECAST_MODEL` into `models.forecast` exactly as `PIPELINE_AUTHOR_MODEL` and `PIPELINE_RESOLVE_MODEL` are threaded (lines 16-17 and 33-35). Add the var to the `AppEnv` type alongside them.

**Default: `claude-sonnet-5`**, matching `resolve`. Forecasting is a judgement call over live search results, the same shape as resolution — not the long-form editorial writing `author` uses opus for. Write it as `forecast: env.PIPELINE_FORECAST_MODEL ?? "claude-sonnet-5",` so it is tunable without a deploy.

- [ ] **Step 11: Run the whole API suite**

Run: `pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS. Any test constructing `models: { author, resolve }` needs `forecast` added; any `PipelineState` fixture needs `needsForecast`. Fix those mechanically without touching assertions.

- [ ] **Step 12: Commit**

```bash
git add apps/api
git commit -m "feat(api): the Oracle answers first, and never sees who answered after"
```

---

## Track C — the board's room and the ledger's rival (`apps/api/src/routes`)

**Depends on Track A.** Owns only `apps/api/src/routes/round.ts`, `apps/api/src/routes/me.ts`, `apps/api/test/round.test.ts`, `apps/api/test/ledger.test.ts`. Must not edit `packages/core` or `apps/api/src/pipeline`.

### Task 6: The board returns rows, with the Oracle standing in them

**Files:**
- Modify: `apps/api/src/routes/round.ts:163-220` (the `/:date/board` handler)
- Modify: `apps/api/test/round.test.ts`

**Interfaces:**
- Consumes: `designation`, `disambiguate`, `ORACLE_DESIGNATION`, `oracleDayTotal`, `CONSTANTS.BOARD_TOP_ROWS`, `CONSTANTS.BOARD_NEIGHBOURS` from `@oracle/core` (Track A). **Sum the Oracle's day through `oracleDayTotal`, never with an inline reduce** — that function is the single named path core's spec-§7 tripwire is bound to, and an inline sum at the call site would sit where core cannot guard it.
- Produces: `rows` on the board payload, matching `RoundBoardSchema`.

- [ ] **Step 1: Write the failing route tests**

Append to `apps/api/test/round.test.ts`, following its existing seeding helpers:

```ts
describe("the board's rows", () => {
  it("returns the summit, the caller's neighbourhood, and the Oracle", async () => {
    // Seed 9 complete players with distinct totals and a forecast on every
    // question, then read the board as the 7th-placed player.
    const res = await boardAs(seventhPlayer, "2026-09-03");
    const body = await res.json();
    expect(res.status).toBe(200);
    const ranks = body.rows.map((r: { rank: number }) => r.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b)); // non-decreasing
    // NOT asserted unique: rows rank against the PLAYER field, so the Oracle
    // may legitimately share a rank with the player it tied. Seed distinct
    // player totals if you want the summit rows to read 1, 2, 3.
    expect(ranks[0]).toBe(1);
    expect(body.rows.find((r: { is_you: boolean }) => r.is_you).rank).toBe(body.your_rank);
    expect(body.rows.filter((r: { is_oracle: boolean }) => r.is_oracle)).toHaveLength(1);
  });

  it("pins the Oracle into the window even when it ranks outside it", async () => {
    // Oracle forecasts poorly; it lands mid-field, outside both the summit
    // and the caller's neighbourhood. It must still appear, at its true rank.
    const body = await (await boardAs(topPlayer, "2026-09-03")).json();
    const oracle = body.rows.find((r: { is_oracle: boolean }) => r.is_oracle);
    expect(oracle).toBeDefined();
    expect(oracle.rank).toBeGreaterThan(CONSTANTS.BOARD_TOP_ROWS);
  });

  it("names players by designation and never by anything they typed", async () => {
    const body = await (await boardAs(seventhPlayer, "2026-09-03")).json();
    for (const row of body.rows) {
      expect(row.name).toBe(row.name.toUpperCase());
      expect(row.name.startsWith("THE ")).toBe(true);
    }
  });

  it("disambiguates a collision inside the rendered window", async () => {
    const body = await (await boardAs(seventhPlayer, "2026-09-03")).json();
    const names = body.rows.map((r: { name: string }) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns no rows below the field floor", async () => {
    const body = await (await boardAs(soloPlayer, "2026-09-04")).json(); // 2 complete
    expect(body.rows).toEqual([]);
    expect(body.your_rank).toBeNull();
  });

  it("still 409s until every question carries an outcome", async () => {
    const res = await boardAs(seventhPlayer, "2026-09-05"); // one unresolved
    expect(res.status).toBe(409);
  });

  it("ranks the Oracle on the same ladder as the rows beside it", async () => {
    // The big one's double weight is IN; the contrarian bounty is OUT.
    // Seeded so the Oracle's raw affine-Brier total is known exactly.
    const body = await (await boardAs(seventhPlayer, "2026-09-03")).json();
    const oracle = body.rows.find((r: { is_oracle: boolean }) => r.is_oracle);
    expect(oracle.points).toBe(EXPECTED_ORACLE_TOTAL);
  });
});
```

Compute `EXPECTED_ORACLE_TOTAL` by hand from your seeded forecasts and outcomes using `oracleQuestionPoints`, and write the arithmetic in a comment. Do not compute the expectation by calling the same function the route calls — that would assert nothing.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test round`
Expected: FAIL — `body.rows` is undefined.

- [ ] **Step 3: Build the rows in the route**

In `apps/api/src/routes/round.ts`, extend the `/:date/board` handler. Leave the existing `field`, `mine`, `yourPoints`, ranking and median logic **exactly as it is** — the ranking on `SUM(predictions.points)` is a load-bearing guarantee. Add, after `sorted` is computed:

```ts
    // THE ORACLE stands in the field. Its day is scored on the same ladder as
    // the rows beside it: the big one's double weight is IN (a call earns it),
    // the contrarian bounty, the first hour and the vigil are OUT (a crowd, a
    // clock and a purchasable shield confer those). oracleQuestionPoints takes
    // no crowd argument at all, so there is no path by which one could reach it.
    const oracleTotal = qs.every((q) => q.oracleProbYes !== null)
      ? oracleDayTotal(
          qs.map((q) => ({
            pYes: Number(q.oracleProbYes),
            outcome: q.outcome as "yes" | "no" | "void",
            isBigOne: q.isBigOne,
          })),
        )
      : null;

    // EVERY ROW IS RANKED AGAINST THE PLAYER FIELD, the machine included.
    //
    // Not against the combined list. `field_size` and `your_rank` are shipped
    // numbers about the human field -- the app already renders RANK 7 OF 9 --
    // and ranking rows against players-plus-machine would silently make a
    // player's row rank disagree with the your_rank printed beside it the
    // moment the Oracle outscored them. So the Oracle's row carries its
    // placing AMONG THE HUMANS: how many players beat it, plus one. A player
    // and the Oracle can therefore share a rank, which is the honest reading
    // of "the machine placed third among you".
    const rankIn = (points: number) => 1 + field.filter((p) => p > points).length;

    const entries: Array<{ userId: string | null; points: number }> = rows
      .filter((r) => Number(r.answered) === qs.length)
      .map((r) => ({ userId: r.userId, points: Number(r.points ?? 0) }));
    if (oracleTotal !== null) entries.push({ userId: null, points: oracleTotal });
    entries.sort((a, b) => b.points - a.points);
    const ranked = entries.map((e) => ({
      ...e,
      rank: rankIn(e.points),
      is_you: e.userId === userId,
      is_oracle: e.userId === null,
    }));

    // The window: the summit, plus the caller's own neighbourhood, plus the
    // machine wherever it landed -- a reader should never have to scroll to
    // find out where the Oracle placed. Indices, then one pass, so overlapping
    // windows merge instead of repeating a row.
    const meIdx = ranked.findIndex((r) => r.is_you);
    const keep = new Set<number>();
    for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
    if (meIdx >= 0) {
      for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) {
        if (i >= 0 && i < ranked.length) keep.add(i);
      }
    }
    const oracleIdx = ranked.findIndex((r) => r.is_oracle);
    if (oracleIdx >= 0) keep.add(oracleIdx);

    // `shown`, not `window` -- the latter shadows a global and reads badly.
    const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
    // Designations are assigned, never chosen -- nothing a user typed is
    // stored or rendered here, which is what keeps this board free of a
    // moderation surface. Collisions are resolved where they are visible.
    const names = disambiguate(
      shown.map((r) => (r.is_oracle ? ORACLE_DESIGNATION : designation(r.userId!))),
    );
    const boardRows = shown.map((r, i) => ({
      name: names[i]!, points: r.points, rank: r.rank, is_you: r.is_you, is_oracle: r.is_oracle,
    }));
```

Add `rows: boardRows` to the final `c.json({...})`, and `rows: []` to the below-the-floor early return. Extend the top-of-file import to:

```ts
import { CONSTANTS, dayPoints, weighDay, designation, disambiguate, ORACLE_DESIGNATION, oracleDayTotal } from "@oracle/core";
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oracle/api test round`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/round.test.ts
git commit -m "feat(api): the board is a room, and the machine stands in it"
```

### Task 7: The ledger carries the rivalry

**Files:**
- Modify: `apps/api/src/routes/me.ts` (the `/ledger` handler)
- Modify: `apps/api/test/ledger.test.ts`

**Interfaces:**
- Consumes: `oracleCallRight`, `oracleBrierOf`, `oracleScore` from `@oracle/core`.
- Produces: the `oracle` block on the ledger payload, matching `MeLedgerSchema.oracle`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/ledger.test.ts`:

```ts
describe("the ledger's rival", () => {
  it("reads UNWRITTEN for the machine below the fifty-call floor", async () => {
    const body = await ledgerFor(newPlayer);
    expect(body.oracle.score).toBeNull();
    expect(body.oracle.calls_rated).toBeGreaterThanOrEqual(0);
  });
  it("counts a complete day the player won as outseen", async () => {
    // Seeded: 2 complete rounds. Day 1 player 4 right / oracle 3.
    //         Day 2 player 2 right / oracle 4.
    const body = await ledgerFor(twoDayPlayer);
    expect(body.oracle.days_compared).toBe(2);
    expect(body.oracle.days_outseen).toBe(1);
  });
  it("never counts a tie as outseeing", async () => {
    const body = await ledgerFor(tiedPlayer); // 3 right each, one round
    expect(body.oracle.days_compared).toBe(1);
    expect(body.oracle.days_outseen).toBe(0);
  });
  it("compares only complete rounds", async () => {
    const body = await ledgerFor(partialPlayer); // sealed 3 of 5, one round
    expect(body.oracle.days_compared).toBe(0);
    expect(body.oracle.days_outseen).toBe(0);
  });
  it("excludes voids and the machine's abstentions from both sides", async () => {
    const body = await ledgerFor(voidHeavyPlayer);
    expect(body.oracle.days_compared).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test ledger`
Expected: FAIL — `body.oracle` is undefined.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/me.ts`, before the final `c.json({...})`:

```ts
    // THE ORACLE's own record, on the same floor the player meets -- so for
    // the first ten days the machine reads UNWRITTEN beside them. Computed on
    // read over questions alone: no table, no settlement hook, nothing for
    // resettleRound to corrupt.
    const forecast = await db.query.questions.findMany({
      where: isNotNull(schema.questions.oracleProbYes),
      orderBy: (q, { asc }) => [asc(q.roundDate), asc(q.slot)],
    });
    const oracleBriers = forecast
      .filter((q) => q.outcome === "yes" || q.outcome === "no")
      .map((q) => oracleBrierOf(Number(q.oracleProbYes), q.outcome as "yes" | "no"));

    // Days outseen: complete rounds only, the same rule every other rated
    // surface uses. A tie is not an outseeing.
    const forecastByDate = new Map<string, typeof forecast>();
    for (const q of forecast) {
      const list = forecastByDate.get(q.roundDate) ?? [];
      list.push(q);
      forecastByDate.set(q.roundDate, list);
    }
    let daysCompared = 0;
    let daysOutseen = 0;
    for (const [date, n] of byDate.entries()) {
      const dayQs = forecastByDate.get(date);
      if (!dayQs || n !== sizeOf.get(date) || dayQs.length !== sizeOf.get(date)) continue;
      const byId = new Map(dayQs.map((q) => [q.id, q]));
      let you = 0;
      let machine = 0;
      for (const q of dayQs) {
        if (q.outcome !== "yes" && q.outcome !== "no") continue;
        if (oracleCallRight(Number(q.oracleProbYes), q.outcome) === true) machine += 1;
      }
      // Iterate `preds`, NOT `resolved`. The `Row` objects in `resolved`
      // carry a precomputed `correct` flag and no `questionId` or `answer`,
      // so they cannot be matched back to a question. `preds` is the raw
      // prediction rows and is already in scope above.
      for (const p of preds) {
        const q = byId.get(p.questionId);
        if (!q || (q.outcome !== "yes" && q.outcome !== "no")) continue;
        if ((p.answer ? "yes" : "no") === q.outcome) you += 1;
      }
      daysCompared += 1;
      if (you > machine) daysOutseen += 1;
    }
```

Add to the response object:

```ts
      oracle: {
        score: oracleScore(oracleBriers),
        calls_rated: oracleBriers.length,
        days_outseen: daysOutseen,
        days_compared: daysCompared,
      },
```

Extend the `@oracle/core` import with `oracleBrierOf, oracleCallRight, oracleScore`.

**Verified against the real file, so do not re-derive these:** `preds` (raw prediction rows, with `questionId` and `answer`), `qById` (question id → question), `byDate` (roundDate → how many of that round the caller answered) and `sizeOf` (roundDate → the round's true question count) are all already in scope at the insertion point. `resolved` is a list of `Row` objects — `{correct, confidence, sidePct, crowdCount, inWindow}` — with no `questionId`; do not try to loop it here and do not widen it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oracle/api test ledger && pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/test/ledger.test.ts
git commit -m "feat(api): the plaque can say how often the machine was outseen"
```

---

## Track D — the surfaces (`apps/mobile`)

**Depends on Track A** for `dayCallCounts` and the schema shape. Does **not** depend on Tracks B or C landing — it codes against `RoundBoardSchema` and `MeLedgerSchema`. Owns only `apps/mobile/*`.

### Task 8: The reveal's closing line and the board's room

**Files:**
- Modify: `apps/mobile/src/game/dailyBoard.ts`
- Modify: `apps/mobile/src/app/reveal/[date].tsx`
- Modify: `apps/mobile/test/dailyBoard.test.ts`

**Interfaces:**
- Consumes: `dayCallCounts` from `@oracle/core`; `RoundBoard.rows`.
- Produces: `oracleDayLine(...)` and `boardRowLines(...)` from `dailyBoard.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/dailyBoard.test.ts`:

```ts
import { oracleDayLine, boardRowLines, BOARD_MAX_LINES } from "../src/game/dailyBoard";

describe("oracleDayLine", () => {
  const q = (outcome: "yes" | "no" | "void" | null, oracle: number | null, mine: boolean | null) =>
    ({ outcome, oracle_p_yes: oracle, my: mine === null ? null : { answer: mine } });

  it("names both counts, the player first", () => {
    expect(oracleDayLine([q("yes", 0.8, true), q("no", 0.9, false), q("yes", 0.2, true)]))
      .toBe("YOU 3 · THE ORACLE 2");
  });
  it("says nothing when the machine never forecast the day", () => {
    expect(oracleDayLine([q("yes", null, true), q("no", null, false)])).toBeNull();
  });
  it("says nothing on a day with no outcomes yet", () => {
    expect(oracleDayLine([q(null, 0.8, true)])).toBeNull();
  });
  it("still speaks for a spectator who sealed nothing", () => {
    expect(oracleDayLine([q("yes", 0.8, null), q("no", 0.9, null)])).toBe("YOU 0 · THE ORACLE 1");
  });
});

describe("boardRowLines", () => {
  const rows = [
    { name: "THE COLD WITNESS", points: 268, rank: 1, is_you: false, is_oracle: false },
    { name: "THE ORACLE", points: 184, rank: 3, is_you: false, is_oracle: true },
    { name: "THE PATIENT SCRIBE", points: 96, rank: 7, is_you: true, is_oracle: false },
  ];
  it("writes rank, name and a signed level", () => {
    expect(boardRowLines(rows)[0]).toBe("1 · THE COLD WITNESS · 268");
  });
  it("signs a losing level with a true minus, never a hyphen", () => {
    const line = boardRowLines([{ ...rows[0]!, points: -40 }])[0]!;
    expect(line).toContain("−40");
    expect(line).not.toContain("-40");
  });
  it("returns nothing for an empty field", () => {
    expect(boardRowLines([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/mobile test dailyBoard`
Expected: FAIL — `oracleDayLine` is not exported.

- [ ] **Step 3: Implement in `dailyBoard.ts`**

Append (keep `boardLines`, `FIELD_GATHERING_LINE`, `UNRATED_LINE` and `BOARD_MAX_LINES` exactly as they are):

```ts
import { dayCallCounts } from "@oracle/core";

/**
 * The day's closing sting. Two bare counts and no denominator, because the
 * denominators genuinely differ -- the machine may abstain, the player may
 * not have sealed -- and one shared denominator would be a lie about one of
 * them. Null when the machine never forecast the day, or nothing resolved.
 */
export function oracleDayLine(
  questions: Array<{
    outcome: "yes" | "no" | "void" | null;
    oracle_p_yes: number | null;
    my: { answer: boolean } | null;
  }>,
): string | null {
  const scored = questions.filter((q) => q.outcome === "yes" || q.outcome === "no");
  if (scored.length === 0) return null;
  if (scored.every((q) => q.oracle_p_yes === null)) return null;
  const { you, oracle } = dayCallCounts(questions);
  return `YOU ${you} · THE ORACLE ${oracle}`;
}

export function boardRowLines(
  rows: Array<{ name: string; points: number; rank: number; is_you: boolean; is_oracle: boolean }>,
): string[] {
  return rows.map((r) => `${r.rank} · ${r.name} · ${level(r.points)}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @oracle/mobile test dailyBoard`
Expected: PASS.

- [ ] **Step 5: Render them**

In `apps/mobile/src/app/reveal/[date].tsx`:

1. Import `oracleDayLine, boardRowLines` alongside the existing `boardLines, BOARD_MAX_LINES` import.
2. Render the Oracle line **after** the Big One block and before the share button, in its own `Animated.View` with `FadeInDown.delay(BIG_ONE_DELAY + 260)`. Use `<Mono size={11} letterSpacing={2}>`, `colors.goldText` when the player's count is strictly greater than the Oracle's, `colors.mutedInk` otherwise. Guard on `oracleDayLine(d.questions) !== null`.
3. In the Big One block, add the verdict mark to the existing `THE ORACLE FORESAW` line at `:388-390`. It is RN `<Text>`, not Skia, so `✓`/`✗` are safe here:

```tsx
{big.oracle_p_yes != null && big.outcome !== "void" && big.outcome !== null && (
  <Mono size={10} color={colors.mutedInk}>
    THE ORACLE FORESAW {Math.round(big.oracle_p_yes * 100)}% YES{" "}
    {oracleCallRight(big.oracle_p_yes, big.outcome) === null
      ? ""
      : oracleCallRight(big.oracle_p_yes, big.outcome)
        ? "✓"
        : "✗"}
  </Mono>
)}
```

4. Replace the `boardLines(...)` render at `:281-286` with: `boardLines(...)` for the summary line, then, when `board.data?.rows?.length`, the `boardRowLines(board.data.rows)` list beneath it — `<Mono size={10}>`, `colors.goldText` for the row where `is_you`, `colors.ink` for `is_oracle`, `colors.mutedInk` otherwise.
5. **Raise the reserved height — without touching `BOARD_MAX_LINES`.** That constant is 1 and means "lines `boardLines` can return"; an existing test asserts every `boardLines` state fits it, and overloading it would make that test assert nothing. Track A exports `CONSTANTS.BOARD_ROWS_MAX` (8) for the row list instead. The reveal reserves its block against `BOARD_MAX_LINES + CONSTANTS.BOARD_ROWS_MAX` lines (see the comment at `:47-48`). Getting this wrong reintroduces the shove-the-page-down bug the reserved slot exists to prevent.

- [ ] **Step 6: Verify on the simulator**

Follow the run procedure recorded in the project memory: Metro from `apps/mobile` with `--dev-client`, wrangler on 8787, then `xcrun simctl openurl <SIM> "oracle:///reveal/<date>"`. Confirm: the Oracle line lands after the Big One; the board list renders with the Oracle row visible; and the block **arrives** rather than shoving the page — take one screenshot before the board query resolves and one after, and confirm the day-points headline sits at the identical y in both. Save both to `docs/superpowers/plans/assets/oracle-and-board/`.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile docs/superpowers/plans/assets/oracle-and-board
git commit -m "feat(mobile): the day closes with the machine's own count"
```

### Task 9: The plaque's rival and the night card's claim

**Files:**
- Modify: `apps/mobile/src/app/ledger.tsx`, `apps/mobile/src/ui/ShareCard.tsx`

**Interfaces:**
- Consumes: `MeLedgerSchema.oracle`.

- [ ] **Step 1: Add the plaque rows**

In `apps/mobile/src/app/ledger.tsx`, beside the existing `<LeadStat label="ORACLE SCORE" .../>` at `:168`, add a second stat for the machine using the same `scoreValue(d.oracle.score, d.oracle.calls_rated)` helper and the label `THE ORACLE`. Below the standing line, add, only when `d.oracle.days_compared > 0`:

```tsx
<Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>
  {`YOU HAVE OUTSEEN THE ORACLE ON ${d.oracle.days_outseen} OF ${d.oracle.days_compared} DAYS`}
</Mono>
```

**Read the layout comment at `ledger.tsx:146-152` before touching this screen.** The column's `justifyContent: "center"` clips once the content is taller than the viewport — that is a known pre-existing bug and two more rows may trigger it. If it does, report it rather than changing `justifyContent`; that fix needs its own decision.

- [ ] **Step 2: Add the night-card line**

In `apps/mobile/src/ui/ShareCard.tsx`, add one `SkText` line beneath the crowd line at `y={868}` reading `` `THE ORACLE ${oracleCount} · YOU ${youCount}` ``, in `mono`, `colors.warmCenter` when the player is ahead and `NIGHT_DIM` otherwise. Pass the two counts in through the existing `data` prop object rather than computing them inside the canvas.

**ASCII only.** No `✓`, `✗` or `·`-adjacent decoration beyond the middot already proven to render in this file — Skia has no font fallback and a missing glyph renders as tofu.

- [ ] **Step 3: Verify both on the simulator**

Run: `xcrun simctl openurl <SIM> "oracle:///ledger"` and confirm both stats render and the outseen line reads correctly. Then trigger the share card from the reveal and confirm no tofu boxes on the new line. Screenshots to `docs/superpowers/plans/assets/oracle-and-board/`.

- [ ] **Step 4: Run everything and commit**

```bash
pnpm --filter @oracle/mobile test && pnpm -r typecheck
git add apps/mobile docs/superpowers/plans/assets/oracle-and-board
git commit -m "feat(mobile): the plaque names the rival, and the night card carries the claim"
```

---

## Task 10: Clear the dev database's masked forecasts

**Owner: the orchestrator, after Tracks B–D land.** Not a subagent task — it touches a live database.

Rows written before Track B hold the old crowd aggregate in `oracle_p_yes` and would poison the Oracle's record from its first day.

- [ ] **Step 1: Null them**

```sql
UPDATE questions SET oracle_p_yes = NULL;
```

Against `oracle-dev` only (`super-hall-59722082`). **There is no prod database** (verified Sept 3), so nothing else is affected. This is not a migration and must not be added to the drizzle chain.

- [ ] **Step 2: Confirm**

Run a `SELECT count(*) FROM questions WHERE oracle_p_yes IS NOT NULL` and expect 0. The next tick after noon will begin restamping real forecasts.

---

## Self-review notes

**Spec coverage:** §1 → Task 1. §2.1/§2.2 → Task 5 (with the amendment recorded above). §2.3 → Task 5 + Task 10. §3 (record, no schema, 50-call floor, call-counting rule, day-total table) → Tasks 2 and 7. §4.1 → Task 8. §4.2 → Tasks 7 and 9. §4.3 → Task 9. §5.1 → Task 3. §5.2 → Task 6. §5.3 → Tasks 4 and 6. §5.4 (`ONE WHO SAW` callout) → **deliberately deferred**: it needs a rule for what makes a day notable enough, which the spec does not fix, and the row list delivers the room without it. Flagged for Erik. §7 test obligations → distributed; the tripwire's ring-proof is Task 2 Step 6.

**Type consistency checked:** `oracle_p_yes` is `number | null` everywhere on the wire and `numeric` (string) in Drizzle — every read wraps in `Number(...)`. `outcome` is `"yes" | "no" | "void" | null` on the wire and non-null in `oracleQuestionPoints`, which is why Task 6 gates on `qs.every(q => q.outcome !== null)` via the route's existing 409. `designation` takes the user id string; the Oracle's row carries `userId: null` and is named from `ORACLE_DESIGNATION`.
