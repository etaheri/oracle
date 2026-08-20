# ORACLE Foundation Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo + shared scoring engine + Cloudflare Workers API serving a complete predict→lock→resolve cycle, verifiable end-to-end with tests and curl.

**Architecture:** pnpm monorepo. `packages/core` holds all game math (Brier, points, Oracle Score, streaks, forecast) as pure, heavily-tested functions plus zod schemas — imported by the API now and the mobile app in Plan 2. `apps/api` is a Hono app on Cloudflare Workers with Drizzle ORM → Neon Postgres; route handlers receive the db via context so tests inject an in-memory PGlite Postgres.

**Tech Stack:** pnpm workspaces, TypeScript (strict), zod, Vitest, Hono 4, Drizzle ORM + drizzle-kit, Neon serverless driver (prod) / PGlite (tests), Cloudflare Workers (wrangler).

## Global Constraints

- TypeScript `strict: true` everywhere; no `any` in `packages/core`.
- All scoring constants live in `packages/core/src/constants.ts` — never inline numbers in formulas elsewhere.
- Scoring formulas are normative (from backend spec §3): Brier `b=(p_yes−outcome)²`; per-question points `Math.round(mult × 200 × (0.25 − b))` (proper: affine Brier transform; rounded once at the end) where `mult` = Big One ×2 (wins AND losses) × contrarian ×2 (wins only, when your side's final crowd % < 40; "win" = points before rounding > 0); Oracle Score `round(1000×(1−mean(b)))` over last 100 resolved non-void calls **from complete rounds only** (all 5 answered — selection enforced at the aggregation query, Plan 4), null until 50.
- Confidence is an integer 55–95, step 5, on the *chosen* side.
- Server clock only; `locks_at` enforced in SQL predicates, not app logic.
- One prediction per (user, question): DB unique index is the enforcement.
- API routes are `/v1/...`; every request/response body validated with zod schemas from `packages/core`.
- Void questions: excluded from Brier/Oracle Score; points 0; still count as "played" for streaks.
- Commit after every green test cycle (`feat:`/`test:`/`chore:` conventional messages).
- Install with `pnpm add <pkg>@latest` unless a version is printed in the task; majors floor: hono@4, drizzle-orm ≥0.36, vitest@3, zod@4 (drop to zod@3 only if a peer dependency conflicts, and note it in the commit message).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.nvmrc`
- Modify: `.gitignore`

**Interfaces:**
- Produces: workspace layout `packages/*`, `apps/*`; root scripts `pnpm typecheck`, `pnpm test` that recurse into all workspaces.

- [ ] **Step 1: Write workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`package.json`:
```json
{
  "name": "oracle",
  "private": true,
  "scripts": {
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test"
  },
  "packageManager": "pnpm@9.15.0"
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "types": []
  }
}
```

`.nvmrc`:
```
22
```

- [ ] **Step 2: Append build artifacts to `.gitignore`**

Append (keep existing lines):
```
node_modules/
dist/
.wrangler/
*.tsbuildinfo
```

- [ ] **Step 3: Verify install works**

Run: `pnpm install`
Expected: succeeds, creates `pnpm-lock.yaml` (no packages yet — that's fine).

- [ ] **Step 4: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .nvmrc .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm monorepo"
```

---

### Task 2: `packages/core` package with constants and zod schemas

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/constants.ts`, `packages/core/src/schemas.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/schemas.test.ts`

**Interfaces:**
- Produces: package `@oracle/core`; `CONSTANTS` object; zod schemas `PredictionSubmitSchema`, `ConfidenceSchema`, and types `PredictionSubmit`.

- [ ] **Step 1: Package scaffolding**

`packages/core/package.json`:
```json
{
  "name": "@oracle/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

Run: `pnpm add -D --filter @oracle/core typescript vitest && pnpm add --filter @oracle/core zod@latest`

- [ ] **Step 2: Write failing schema test**

`packages/core/test/schemas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PredictionSubmitSchema } from "../src/schemas";

const valid = {
  question_id: "3f0d8c1e-2b4a-4c6d-9e8f-1a2b3c4d5e6f",
  answer: true,
  confidence: 75,
  idempotency_key: "abc-123",
};

describe("PredictionSubmitSchema", () => {
  it("accepts a valid submission", () => {
    expect(PredictionSubmitSchema.parse(valid)).toEqual(valid);
  });
  it("rejects confidence off the 55-95 step-5 grid", () => {
    for (const confidence of [50, 54, 96, 100, 72]) {
      expect(PredictionSubmitSchema.safeParse({ ...valid, confidence }).success).toBe(false);
    }
  });
  it("accepts every legal confidence value", () => {
    for (let confidence = 55; confidence <= 95; confidence += 5) {
      expect(PredictionSubmitSchema.safeParse({ ...valid, confidence }).success).toBe(true);
    }
  });
  it("rejects a non-uuid question_id", () => {
    expect(PredictionSubmitSchema.safeParse({ ...valid, question_id: "nope" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — cannot resolve `../src/schemas`.

- [ ] **Step 4: Implement constants and schemas**

`packages/core/src/constants.ts`:
```ts
/** Scoring/game tunables. ⚙ values may be tuned during TestFlight; properties are spec-fixed. */
export const CONSTANTS = {
  CONFIDENCE_MIN: 55,
  CONFIDENCE_MAX: 95,
  CONFIDENCE_STEP: 5,
  POINTS_SCALE: 200,    // points = round(mult × POINTS_SCALE × (POINTS_BASELINE − brier))
  POINTS_BASELINE: 0.25, // coin-flip brier — EV of a 50/50 guess is 0 points
  BIG_ONE_MULT: 2,      // applies to wins and losses
  CONTRARIAN_MULT: 2,   // wins only
  CONTRARIAN_CROWD_PCT: 40, // your side's final crowd % must be strictly below this
  FIRST_HOUR_BONUS: 0.10,   // +10% of the day's positive total
  ORACLE_SCORE_WINDOW: 100,
  ORACLE_SCORE_MIN_CALLS: 50,
  FORECAST_WEIGHT_PIVOT: 750,
  FORECAST_WEIGHT_SCALE: 60,
  FORECAST_EXTREMIZE_D: 1.5,
  FORECAST_MIN_RATED: 500,
} as const;
```

`packages/core/src/schemas.ts`:
```ts
import { z } from "zod";
import { CONSTANTS } from "./constants";

export const ConfidenceSchema = z
  .number()
  .int()
  .min(CONSTANTS.CONFIDENCE_MIN)
  .max(CONSTANTS.CONFIDENCE_MAX)
  .refine((n) => (n - CONSTANTS.CONFIDENCE_MIN) % CONSTANTS.CONFIDENCE_STEP === 0, {
    message: "confidence must be on the 55-95 step-5 grid",
  });

export const PredictionSubmitSchema = z.object({
  question_id: z.string().uuid(),
  answer: z.boolean(),
  confidence: ConfidenceSchema,
  idempotency_key: z.string().min(1).max(128),
});
export type PredictionSubmit = z.infer<typeof PredictionSubmitSchema>;
```

`packages/core/src/index.ts`:
```ts
export * from "./constants";
export * from "./schemas";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @oracle/core test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core pnpm-lock.yaml
git commit -m "feat(core): constants and prediction submit schema"
```

---

### Task 3: Brier score and per-question daily points

**Files:**
- Create: `packages/core/src/scoring.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./scoring";`)
- Test: `packages/core/test/scoring.test.ts`

**Interfaces:**
- Produces:
  - `brier(input: { answer: boolean; confidence: number; outcome: "yes" | "no" }): number`
  - `questionPoints(input: { answer: boolean; confidence: number; outcome: "yes" | "no" | "void"; isBigOne: boolean; crowdYesPct: number }): number`

- [ ] **Step 1: Write failing tests**

`packages/core/test/scoring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { brier, questionPoints } from "../src/scoring";

describe("brier", () => {
  it("is (p_yes - outcome)^2 for a YES answer", () => {
    // answer YES @ 75 → p_yes = 0.75; outcome yes → (0.75-1)^2 = 0.0625
    expect(brier({ answer: true, confidence: 75, outcome: "yes" })).toBeCloseTo(0.0625, 10);
  });
  it("maps a NO answer to p_yes = 1 - confidence", () => {
    // answer NO @ 95 → p_yes = 0.05; outcome yes → (0.05-1)^2 = 0.9025 (worst case)
    expect(brier({ answer: false, confidence: 95, outcome: "yes" })).toBeCloseTo(0.9025, 10);
  });
  it("best case: right at 95 → 0.0025", () => {
    expect(brier({ answer: true, confidence: 95, outcome: "yes" })).toBeCloseTo(0.0025, 10);
  });
});

describe("questionPoints", () => {
  const base = { isBigOne: false, crowdYesPct: 50 };
  // points = Math.round(mult × 200 × (0.25 − brier)) — proper affine Brier transform.
  // Win ladder (55..95): 10, 26, 38, 46, 50. Loss ladder: −10, −34, −62, −94, −130.
  it("correct: round(200×(0.25−brier))", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 55, outcome: "yes" })).toBe(10);  // b=0.2025 → 9.5 → 10
    expect(questionPoints({ ...base, answer: true, confidence: 75, outcome: "yes" })).toBe(38);  // b=0.0625 → 37.5 → 38
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "yes" })).toBe(50);  // b=0.0025 → 49.5 → 50
  });
  it("wrong: same formula, brier > 0.25 goes negative", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 55, outcome: "no" })).toBe(-10);  // b=0.3025 → −10.5 → −10
    expect(questionPoints({ ...base, answer: true, confidence: 75, outcome: "no" })).toBe(-62);  // b=0.5625 → −62.5 → −62
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "no" })).toBe(-130); // b=0.9025 → −130.5 → −130
  });
  it("void: always 0", () => {
    expect(questionPoints({ ...base, answer: true, confidence: 95, outcome: "void" })).toBe(0);
  });
  it("big one doubles wins and losses (multiplied before the single rounding)", () => {
    expect(questionPoints({ ...base, isBigOne: true, answer: true, confidence: 75, outcome: "yes" })).toBe(75);   // 2×37.5 = 75
    expect(questionPoints({ ...base, isBigOne: true, answer: true, confidence: 75, outcome: "no" })).toBe(-125);  // 2×−62.5 = −125
  });
  it("contrarian ×2 on wins when your side's crowd % < 40", () => {
    // answered YES, crowd was 39% YES → contrarian win: 2×37.5 = 75
    expect(questionPoints({ isBigOne: false, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(75);
    // exactly 40 is NOT contrarian
    expect(questionPoints({ isBigOne: false, crowdYesPct: 40, answer: true, confidence: 75, outcome: "yes" })).toBe(38);
    // NO answer: side pct = 100 − crowdYesPct → 61% YES means 39% NO side
    expect(questionPoints({ isBigOne: false, crowdYesPct: 61, answer: false, confidence: 75, outcome: "no" })).toBe(75);
  });
  it("contrarian never amplifies losses", () => {
    expect(questionPoints({ isBigOne: false, crowdYesPct: 39, answer: true, confidence: 75, outcome: "no" })).toBe(-62);
  });
  it("big one + contrarian stack: ×4 on a win", () => {
    expect(questionPoints({ isBigOne: true, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(150); // 4×37.5
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — `../src/scoring` not found.

- [ ] **Step 3: Implement**

`packages/core/src/scoring.ts`:
```ts
import { CONSTANTS as C } from "./constants";

export function brier(input: { answer: boolean; confidence: number; outcome: "yes" | "no" }): number {
  const pYes = input.answer ? input.confidence / 100 : 1 - input.confidence / 100;
  const outcome = input.outcome === "yes" ? 1 : 0;
  return (pYes - outcome) ** 2;
}

export function questionPoints(input: {
  answer: boolean;
  confidence: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
  crowdYesPct: number;
}): number {
  if (input.outcome === "void") return 0;
  const b = brier({ answer: input.answer, confidence: input.confidence, outcome: input.outcome });
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b); // proper: affine in brier
  const win = base > 0;
  const sidePct = input.answer ? input.crowdYesPct : 100 - input.crowdYesPct;
  const contrarian = win && sidePct < C.CONTRARIAN_CROWD_PCT;
  const mult = (input.isBigOne ? C.BIG_ONE_MULT : 1) * (contrarian ? C.CONTRARIAN_MULT : 1);
  return Math.round(mult * base); // single rounding at the end
}
```

Add to `packages/core/src/index.ts`: `export * from "./scoring";`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scoring.ts packages/core/src/index.ts packages/core/test/scoring.test.ts
git commit -m "feat(core): brier and per-question daily points"
```

---

### Task 4: Day settlement (first-hour bonus) and Oracle Score

**Files:**
- Modify: `packages/core/src/scoring.ts`, `packages/core/src/index.ts` (no new export line needed — same module)
- Test: `packages/core/test/scoring-day.test.ts`

**Interfaces:**
- Produces:
  - `dayPoints(perQuestion: number[], firstHour: boolean): number` — sums, then adds `round(FIRST_HOUR_BONUS × sum)` only if the sum is positive and firstHour.
  - `oracleScore(briers: number[]): number | null` — null under `ORACLE_SCORE_MIN_CALLS`; mean over the most recent `ORACLE_SCORE_WINDOW` entries (array ordered oldest→newest); `Math.round(1000 × (1 − mean))`. **Callers must pass briers from complete rounds only** (all 5 answered) — the anti-abstention rule; the selection query lives in Plan 4's aggregation job, this function stays pure.

- [ ] **Step 1: Write failing tests**

`packages/core/test/scoring-day.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { dayPoints, oracleScore } from "../src/scoring";

describe("dayPoints", () => {
  it("sums per-question points", () => {
    expect(dayPoints([50, -15, 10, 0, 90], false)).toBe(135);
  });
  it("adds 10% first-hour bonus on positive totals only", () => {
    expect(dayPoints([50, 50], true)).toBe(110);
    expect(dayPoints([-50, 10], true)).toBe(-40); // negative day: no bonus
  });
  it("rounds the bonus", () => {
    expect(dayPoints([10, 15], true)).toBe(28); // 25 + round(2.5) = 28
  });
});

describe("oracleScore", () => {
  it("is null below 50 resolved calls", () => {
    expect(oracleScore(Array(49).fill(0.25))).toBeNull();
  });
  it("coin-flipping at 55 ≈ 750-ish: exact for constant briers", () => {
    // constant b=0.25 → 1000×(1−0.25) = 750
    expect(oracleScore(Array(50).fill(0.25))).toBe(750);
  });
  it("perfect calls → 1000, worst → 98", () => {
    expect(oracleScore(Array(50).fill(0))).toBe(1000);
    expect(oracleScore(Array(50).fill(0.9025))).toBe(98);
  });
  it("uses only the most recent 100 (array ordered oldest→newest)", () => {
    const briers = [...Array(100).fill(0.9025), ...Array(100).fill(0)];
    expect(oracleScore(briers)).toBe(1000); // old bad calls aged out
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — `dayPoints` not exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/scoring.ts`:
```ts
export function dayPoints(perQuestion: number[], firstHour: boolean): number {
  const sum = perQuestion.reduce((a, b) => a + b, 0);
  if (!firstHour || sum <= 0) return sum;
  return sum + Math.round(C.FIRST_HOUR_BONUS * sum);
}

export function oracleScore(briers: number[]): number | null {
  if (briers.length < C.ORACLE_SCORE_MIN_CALLS) return null;
  const window = briers.slice(-C.ORACLE_SCORE_WINDOW);
  const mean = window.reduce((a, b) => a + b, 0) / window.length;
  return Math.round(1000 * (1 - mean));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/scoring.ts packages/core/test/scoring-day.test.ts
git commit -m "feat(core): day settlement with first-hour bonus and oracle score"
```

---

### Task 5: Streak settlement

**Files:**
- Create: `packages/core/src/streak.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./streak";`)
- Test: `packages/core/test/streak.test.ts`

**Interfaces:**
- Produces:
```ts
export interface StreakState {
  streakCurrent: number;
  streakBest: number;
  freeShieldUsedAt: string | null; // ISO date "2026-08-01" or null
  paidShieldsRemaining: number;
}
export interface StreakResult extends StreakState {
  usedFreeShield: boolean;
  usedPaidShield: boolean;
}
export function settleStreak(state: StreakState, played: boolean, roundDate: string): StreakResult;
```
Rules: played → streak+1 (update best). Missed → free shield if none used this calendar month (set `freeShieldUsedAt = roundDate`, hold streak); else paid shield if `paidShieldsRemaining > 0` (decrement, hold); else reset to 0.

- [ ] **Step 1: Write failing tests**

`packages/core/test/streak.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { settleStreak, type StreakState } from "../src/streak";

const base: StreakState = { streakCurrent: 10, streakBest: 12, freeShieldUsedAt: null, paidShieldsRemaining: 0 };

describe("settleStreak", () => {
  it("increments on played and updates best", () => {
    const r = settleStreak({ ...base, streakCurrent: 12 }, true, "2026-08-20");
    expect(r.streakCurrent).toBe(13);
    expect(r.streakBest).toBe(13);
    expect(r.usedFreeShield).toBe(false);
  });
  it("missed day consumes the free monthly shield first", () => {
    const r = settleStreak(base, false, "2026-08-20");
    expect(r.streakCurrent).toBe(10);
    expect(r.usedFreeShield).toBe(true);
    expect(r.freeShieldUsedAt).toBe("2026-08-20");
  });
  it("free shield unavailable if already used this calendar month", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03" }, false, "2026-08-20");
    expect(r.usedFreeShield).toBe(false);
    expect(r.streakCurrent).toBe(0); // no paid shields either
  });
  it("free shield refreshes in a new month", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-07-31" }, false, "2026-08-01");
    expect(r.usedFreeShield).toBe(true);
    expect(r.streakCurrent).toBe(10);
  });
  it("falls back to paid shield", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03", paidShieldsRemaining: 2 }, false, "2026-08-20");
    expect(r.usedPaidShield).toBe(true);
    expect(r.paidShieldsRemaining).toBe(1);
    expect(r.streakCurrent).toBe(10);
  });
  it("no shields: reset to zero, best preserved", () => {
    const r = settleStreak({ ...base, freeShieldUsedAt: "2026-08-03" }, false, "2026-08-20");
    expect(r.streakCurrent).toBe(0);
    expect(r.streakBest).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/streak.ts`:
```ts
export interface StreakState {
  streakCurrent: number;
  streakBest: number;
  freeShieldUsedAt: string | null;
  paidShieldsRemaining: number;
}
export interface StreakResult extends StreakState {
  usedFreeShield: boolean;
  usedPaidShield: boolean;
}

const month = (isoDate: string) => isoDate.slice(0, 7); // "2026-08"

export function settleStreak(state: StreakState, played: boolean, roundDate: string): StreakResult {
  if (played) {
    const streakCurrent = state.streakCurrent + 1;
    return {
      ...state,
      streakCurrent,
      streakBest: Math.max(state.streakBest, streakCurrent),
      usedFreeShield: false,
      usedPaidShield: false,
    };
  }
  const freeAvailable = state.freeShieldUsedAt === null || month(state.freeShieldUsedAt) !== month(roundDate);
  if (freeAvailable) {
    return { ...state, freeShieldUsedAt: roundDate, usedFreeShield: true, usedPaidShield: false };
  }
  if (state.paidShieldsRemaining > 0) {
    return {
      ...state,
      paidShieldsRemaining: state.paidShieldsRemaining - 1,
      usedFreeShield: false,
      usedPaidShield: true,
    };
  }
  return { ...state, streakCurrent: 0, usedFreeShield: false, usedPaidShield: false };
}
```

Add to `packages/core/src/index.ts`: `export * from "./streak";`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/streak.ts packages/core/src/index.ts packages/core/test/streak.test.ts
git commit -m "feat(core): streak settlement with free monthly and paid shields"
```

---

### Task 6: The Oracle's forecast (skill-weighted, extremized aggregate)

**Files:**
- Create: `packages/core/src/forecast.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./forecast";`)
- Test: `packages/core/test/forecast.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ForecastInput { pYes: number; oracleScore: number | null; }
/** Returns p_yes in (0,1), or null when there are no predictions. */
export function oracleForecast(predictions: ForecastInput[], ratedPlayerCount: number): number | null;
export function extremize(p: number, d: number): number;
```
Weights: `1` when `oracleScore` is null, else `exp((score − 750)/60)`. Cold start: when `ratedPlayerCount < FORECAST_MIN_RATED (500)`, return the *unweighted, un-extremized* mean. Otherwise extremize the weighted mean with `d = 1.5`: `p^d / (p^d + (1−p)^d)`.

- [ ] **Step 1: Write failing tests**

`packages/core/test/forecast.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { oracleForecast, extremize } from "../src/forecast";

describe("extremize", () => {
  it("pushes probabilities away from 0.5", () => {
    expect(extremize(0.7, 1.5)).toBeGreaterThan(0.7);
    expect(extremize(0.3, 1.5)).toBeLessThan(0.3);
    expect(extremize(0.5, 1.5)).toBeCloseTo(0.5, 10);
  });
});

describe("oracleForecast", () => {
  it("null with no predictions", () => {
    expect(oracleForecast([], 1000)).toBeNull();
  });
  it("cold start (< 500 rated): raw unweighted mean, no extremizing", () => {
    const preds = [
      { pYes: 0.6, oracleScore: 900 },
      { pYes: 0.8, oracleScore: null },
    ];
    expect(oracleForecast(preds, 499)).toBeCloseTo(0.7, 10);
  });
  it("warm: high-score players pull the aggregate toward their view", () => {
    const preds = [
      { pYes: 0.9, oracleScore: 900 }, // weight e^2.5 ≈ 12.18
      { pYes: 0.1, oracleScore: null }, // weight 1
    ];
    const p = oracleForecast(preds, 1000)!;
    // weighted mean ≈ (12.18×0.9 + 0.1)/13.18 ≈ 0.839, then extremized above that
    expect(p).toBeGreaterThan(0.84);
  });
  it("warm path extremizes: identical 0.7s land above 0.7", () => {
    const preds = Array(10).fill({ pYes: 0.7, oracleScore: null });
    expect(oracleForecast(preds, 1000)!).toBeGreaterThan(0.7);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/forecast.ts`:
```ts
import { CONSTANTS as C } from "./constants";

export interface ForecastInput { pYes: number; oracleScore: number | null; }

export function extremize(p: number, d: number): number {
  const num = p ** d;
  return num / (num + (1 - p) ** d);
}

export function oracleForecast(predictions: ForecastInput[], ratedPlayerCount: number): number | null {
  if (predictions.length === 0) return null;
  if (ratedPlayerCount < C.FORECAST_MIN_RATED) {
    return predictions.reduce((a, x) => a + x.pYes, 0) / predictions.length;
  }
  let wSum = 0;
  let wpSum = 0;
  for (const { pYes, oracleScore } of predictions) {
    const w = oracleScore === null
      ? 1
      : Math.exp((oracleScore - C.FORECAST_WEIGHT_PIVOT) / C.FORECAST_WEIGHT_SCALE);
    wSum += w;
    wpSum += w * pYes;
  }
  return extremize(wpSum / wSum, C.FORECAST_EXTREMIZE_D);
}
```

Add to `packages/core/src/index.ts`: `export * from "./forecast";`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/forecast.ts packages/core/src/index.ts packages/core/test/forecast.test.ts
git commit -m "feat(core): skill-weighted extremized oracle forecast"
```

---

### Task 7: API scaffold — Hono app factory + health route

**Files:**
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/vitest.config.ts`, `apps/api/wrangler.jsonc`, `apps/api/src/app.ts`, `apps/api/src/worker.ts`
- Test: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `createApp(deps: { db: Db; env: AppEnv }): Hono` — the factory every later task extends; tests call `app.request(path, init)` directly (no server needed). `Db` is defined in Task 8; for this task use a placeholder `type Db = unknown`.
- `AppEnv = { DEVICE_TOKEN_SECRET: string; ADMIN_SECRET: string }`.

- [ ] **Step 1: Package scaffolding**

`apps/api/package.json`:
```json
{
  "name": "@oracle/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["@cloudflare/workers-types"] },
  "include": ["src", "test"]
}
```

`apps/api/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
```

`apps/api/wrangler.jsonc`:
```jsonc
{
  "name": "oracle-api",
  "main": "src/worker.ts",
  "compatibility_date": "2026-08-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true }
  // secrets (wrangler secret put): DEVICE_TOKEN_SECRET, ADMIN_SECRET, DATABASE_URL
}
```

Run:
```bash
pnpm add --filter @oracle/api hono@latest @oracle/core@workspace:*
pnpm add -D --filter @oracle/api typescript vitest wrangler @cloudflare/workers-types
```

- [ ] **Step 2: Write failing health test**

`apps/api/test/health.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";

describe("GET /v1/health", () => {
  it("returns ok", async () => {
    const app = createApp({ db: null as unknown, env: { DEVICE_TOKEN_SECRET: "s", ADMIN_SECRET: "a" } });
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @oracle/api test`
Expected: FAIL — `../src/app` not found.

- [ ] **Step 4: Implement app factory and worker entry**

`apps/api/src/app.ts`:
```ts
import { Hono } from "hono";

export type Db = unknown; // replaced by Drizzle type in Task 8
export interface AppEnv {
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
}
export interface Deps { db: Db; env: AppEnv; }
export type AppContext = { Variables: { deps: Deps } };

export function createApp(deps: Deps) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => { c.set("deps", deps); await next(); });
  app.get("/v1/health", (c) => c.json({ ok: true }));
  return app;
}
```

`apps/api/src/worker.ts`:
```ts
import { createApp } from "./app";
import { makeDb } from "./db/client"; // created in Task 8; until then comment this line and pass db: null

interface WorkerEnv {
  DATABASE_URL: string;
  DEVICE_TOKEN_SECRET: string;
  ADMIN_SECRET: string;
}

export default {
  fetch(req: Request, env: WorkerEnv) {
    const app = createApp({
      db: makeDb(env.DATABASE_URL),
      env: { DEVICE_TOKEN_SECRET: env.DEVICE_TOKEN_SECRET, ADMIN_SECRET: env.ADMIN_SECRET },
    });
    return app.fetch(req);
  },
};
```
(Until Task 8 exists, stub the import: `const makeDb = (_: string) => null as unknown;` inline, and delete the stub in Task 8.)

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): hono app factory with health route"
```

---

### Task 8: Drizzle schema, migrations, and PGlite test harness

**Files:**
- Create: `apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/drizzle.config.ts`, `apps/api/test/helpers/db.ts`
- Modify: `apps/api/src/app.ts` (replace `type Db = unknown` with the Drizzle type), `apps/api/src/worker.ts` (real `makeDb` import)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `schema` tables `users`, `devices`, `rounds`, `questions`, `predictions` (naming per backend spec §1); `makeDb(url: string): Db` (Neon HTTP driver); test helper `makeTestDb(): Promise<{ db: Db; seed: typeof seedRound }>` backed by PGlite with migrations applied; `seedRound(db, { date, opensAt, locksAt })` inserting a round + 5 questions (slot 5 = big one) and returning their ids.

- [ ] **Step 1: Install deps**

```bash
pnpm add --filter @oracle/api drizzle-orm @neondatabase/serverless
pnpm add -D --filter @oracle/api drizzle-kit @electric-sql/pglite
```

- [ ] **Step 2: Write the schema**

`apps/api/src/db/schema.ts`:
```ts
import { pgTable, uuid, text, integer, boolean, timestamp, date, numeric, jsonb, uniqueIndex, pgEnum } from "drizzle-orm/pg-core";

export const questionStatus = pgEnum("question_status", ["draft", "approved", "scheduled", "open", "locked", "resolved", "void"]);
export const outcome = pgEnum("outcome", ["yes", "no", "void"]);
export const roundStatus = pgEnum("round_status", ["scheduled", "open", "locked", "resolved"]);
export const category = pgEnum("category", ["markets", "sports", "weather", "culture", "news"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkId: text("clerk_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  streakCurrent: integer("streak_current").notNull().default(0),
  streakBest: integer("streak_best").notNull().default(0),
  freeShieldUsedAt: date("free_shield_used_at"),
  oracleScore: integer("oracle_score"),
  callsResolved: integer("calls_resolved").notNull().default(0),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  installTokenHash: text("install_token_hash").notNull(),
  platform: text("platform").notNull(),
});

export const rounds = pgTable("rounds", {
  date: date("date").primaryKey(),
  status: roundStatus("status").notNull().default("scheduled"),
  playerCount: integer("player_count").notNull().default(0),
});

export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  roundDate: date("round_date").notNull().references(() => rounds.date),
  slot: integer("slot").notNull(),
  isBigOne: boolean("is_big_one").notNull().default(false),
  text: text("text").notNull(),
  category: category("category").notNull(),
  resolutionCriteria: text("resolution_criteria").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  locksAt: timestamp("locks_at", { withTimezone: true }).notNull(),
  resolveBy: timestamp("resolve_by", { withTimezone: true }).notNull(),
  status: questionStatus("status").notNull().default("scheduled"),
  outcome: outcome("outcome"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionEvidence: jsonb("resolution_evidence"),
  crowdYesPct: numeric("crowd_yes_pct"),
  marketProb: numeric("market_prob"),
});

export const predictions = pgTable("predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id").notNull().references(() => questions.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  answer: boolean("answer").notNull(),
  confidence: integer("confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  firstHour: boolean("first_hour").notNull().default(false),
  brier: numeric("brier"),
  points: integer("points"),
}, (t) => [uniqueIndex("predictions_question_user_unique").on(t.questionId, t.userId)]);
```

`apps/api/src/db/client.ts`:
```ts
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export function makeDb(url: string) {
  return drizzle(neon(url), { schema });
}
export type Db = ReturnType<typeof makeDb>;
export { schema };
```

`apps/api/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
```

In `apps/api/src/app.ts`, replace `export type Db = unknown;` with:
```ts
import type { Db } from "./db/client";
export type { Db };
```
In `apps/api/src/worker.ts`, delete the stub and use the real `import { makeDb } from "./db/client";`.

- [ ] **Step 3: Generate migrations**

Run: `cd apps/api && pnpm drizzle-kit generate`
Expected: SQL file(s) appear in `apps/api/drizzle/`.

- [ ] **Step 4: Write the PGlite test harness + failing schema test**

`apps/api/test/helpers/db.ts`:
```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as schema from "../../src/db/schema";

export async function makeTestDb() {
  const pg = new PGlite();
  const dir = join(__dirname, "../../drizzle");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    // drizzle separates statements with "--> statement-breakpoint"
    for (const stmt of readFileSync(join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await pg.exec(stmt);
    }
  }
  const db = drizzle(pg, { schema });
  return { db, pg };
}

export async function seedRound(
  db: Awaited<ReturnType<typeof makeTestDb>>["db"],
  opts: { date: string; opensAt: Date; locksAt: Date },
) {
  await db.insert(schema.rounds).values({ date: opts.date, status: "open" });
  const rows = await db
    .insert(schema.questions)
    .values(
      [1, 2, 3, 4, 5].map((slot) => ({
        roundDate: opts.date,
        slot,
        isBigOne: slot === 5,
        text: `Question ${slot}?`,
        category: "news" as const,
        resolutionCriteria: "per test",
        sourceName: "test",
        opensAt: opts.opensAt,
        locksAt: opts.locksAt,
        resolveBy: new Date(opts.locksAt.getTime() + 86_400_000),
        status: "open" as const,
      })),
    )
    .returning({ id: schema.questions.id, slot: schema.questions.slot });
  return rows;
}
```

`apps/api/test/schema.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

describe("schema + harness", () => {
  it("migrates, seeds a round with 5 questions, and enforces the unique prediction index", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    expect(qs).toHaveLength(5);

    const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
    const pred = { questionId: qs[0]!.id, userId: user!.id, answer: true, confidence: 75 };
    await db.insert(schema.predictions).values(pred);
    await expect(db.insert(schema.predictions).values(pred)).rejects.toThrow(); // unique index
  });
});
```

- [ ] **Step 5: Run to verify it fails, then passes**

Run: `pnpm --filter @oracle/api test`
Expected: first run may FAIL on missing migration dir if Step 3 skipped — otherwise PASS. Fix until PASS.

- [ ] **Step 6: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): drizzle schema, migrations, pglite test harness"
```

---

### Task 9: Device auth — token mint + verify middleware

**Files:**
- Create: `apps/api/src/auth/deviceToken.ts`, `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/app.ts` (mount route + middleware)
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Produces:
  - `mintDeviceToken(secret: string, deviceId: string, issuedAtMs: number): Promise<string>` → `"<deviceId>.<issuedAtMs>.<hexhmac>"`
  - `verifyDeviceToken(secret: string, token: string): Promise<string | null>` → deviceId or null
  - `POST /v1/auth/device` `{ platform: "ios" | "android" }` → `{ token, user_id }` — creates a `users` row + `devices` row (installTokenHash = SHA-256 hex of token), returns token.
  - `deviceAuth` middleware: reads `Authorization: Bearer <token>`, verifies, loads the device+user, sets `c.set("userId", ...)`; 401 otherwise. Later tasks consume `c.get("userId")`.

- [ ] **Step 1: Write failing tests**

`apps/api/test/auth.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mintDeviceToken, verifyDeviceToken } from "../src/auth/deviceToken";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

describe("device tokens", () => {
  it("round-trips mint → verify", async () => {
    const t = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, "dev-1", 1755600000000);
    expect(await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, t)).toBe("dev-1");
  });
  it("rejects tampered tokens and wrong secrets", async () => {
    const t = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, "dev-1", 1755600000000);
    expect(await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, t.replace("dev-1", "dev-2"))).toBeNull();
    expect(await verifyDeviceToken("other-secret", t)).toBeNull();
  });
});

describe("POST /v1/auth/device", () => {
  it("creates a user and returns a working bearer token", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "ios" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; user_id: string };
    expect(body.token.split(".").length).toBe(3);
    expect(body.user_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("rejects a bad platform", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/v1/auth/device", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ platform: "vax" }),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/api test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/auth/deviceToken.ts`:
```ts
const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function mintDeviceToken(secret: string, deviceId: string, issuedAtMs: number): Promise<string> {
  const payload = `${deviceId}.${issuedAtMs}`;
  return `${payload}.${await hmacHex(secret, payload)}`;
}

export async function verifyDeviceToken(secret: string, token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [deviceId, ts, sig] = parts as [string, string, string];
  const expected = await hmacHex(secret, `${deviceId}.${ts}`);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? deviceId : null;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
```

`apps/api/src/routes/auth.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { mintDeviceToken, verifyDeviceToken, sha256Hex } from "../auth/deviceToken";

const BodySchema = z.object({ platform: z.enum(["ios", "android"]) });

export const authRoutes = new Hono<AppContext>().post("/device", async (c) => {
  const parsed = BodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { db, env } = c.get("deps");
  const deviceId = crypto.randomUUID();
  const token = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, deviceId, Date.now());
  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  await db.insert(schema.devices).values({
    id: deviceId,
    userId: user!.id,
    installTokenHash: await sha256Hex(token),
    platform: parsed.data.platform,
  });
  return c.json({ token, user_id: user!.id });
});

/** Middleware: sets userId from a valid bearer device token. */
export async function deviceAuth(c: Parameters<Parameters<Hono<AppContext>["use"]>[1]>[0], next: () => Promise<void>) {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const { db, env } = c.get("deps");
  const deviceId = token ? await verifyDeviceToken(env.DEVICE_TOKEN_SECRET, token) : null;
  if (!deviceId) return c.json({ error: "unauthorized" }, 401);
  const device = await db.query.devices.findFirst({ where: eq(schema.devices.id, deviceId) });
  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", device.userId);
  await next();
}
```

In `apps/api/src/app.ts`: extend variables and mount:
```ts
export type AppContext = { Variables: { deps: Deps; userId: string } };
// inside createApp, after the deps middleware:
import { authRoutes } from "./routes/auth";
app.route("/v1/auth", authRoutes);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/src/routes/auth.ts apps/api/src/app.ts apps/api/test/auth.test.ts
git commit -m "feat(api): device token auth (mint, verify, middleware)"
```

---

### Task 10: `GET /v1/round/today`

**Files:**
- Create: `apps/api/src/routes/round.ts`
- Modify: `apps/api/src/app.ts` (mount `app.route("/v1/round", roundRoutes)`)
- Test: `apps/api/test/round.test.ts`

**Interfaces:**
- Consumes: `deviceAuth` middleware (Task 9), `seedRound` (Task 8).
- Produces: `GET /v1/round/today` (auth required) → `{ date, locks_at, player_count, questions: [{ id, slot, is_big_one, text, category, source_name, resolution_criteria }] }` — **never** includes crowd %, outcomes, or the oracle forecast. Questions ordered by slot. 404 when no open round. "Today" = the round whose `status = "open"` (drop transitions are Plan 4's DO alarms; until then rounds are opened by seed/admin).

- [ ] **Step 1: Write failing tests**

`apps/api/test/round.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function authedApp() {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  const authed = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` } });
  return { app, db, authed };
}

describe("GET /v1/round/today", () => {
  it("401s without a token", async () => {
    const { app } = await authedApp();
    expect((await app.request("/v1/round/today")).status).toBe(401);
  });
  it("404s when no open round", async () => {
    const { authed } = await authedApp();
    expect((await authed("/v1/round/today")).status).toBe(404);
  });
  it("returns the open round's questions, slot-ordered, without spoilers", async () => {
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await authed("/v1/round/today");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; questions: Array<Record<string, unknown>> };
    expect(body.date).toBe("2026-08-20");
    expect(body.questions.map((q) => q.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(body.questions[4]!.is_big_one).toBe(true);
    for (const q of body.questions) {
      expect(q).not.toHaveProperty("crowd_yes_pct");
      expect(q).not.toHaveProperty("outcome");
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/api test`
Expected: FAIL — round route missing (401 test may pass early; the others fail).

- [ ] **Step 3: Implement**

`apps/api/src/routes/round.ts`:
```ts
import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

export const roundRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/today", async (c) => {
    const { db } = c.get("deps");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
    if (!round) return c.json({ error: "no open round" }, 404);
    const qs = await db.query.questions.findMany({
      where: eq(schema.questions.roundDate, round.date),
      orderBy: [asc(schema.questions.slot)],
    });
    return c.json({
      date: round.date,
      locks_at: qs[0]?.locksAt ?? null,
      player_count: round.playerCount,
      questions: qs.map((q) => ({
        id: q.id,
        slot: q.slot,
        is_big_one: q.isBigOne,
        text: q.text,
        category: q.category,
        source_name: q.sourceName,
        resolution_criteria: q.resolutionCriteria,
      })),
    });
  });
```

In `apps/api/src/app.ts`: `import { roundRoutes } from "./routes/round"; app.route("/v1/round", roundRoutes);`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/src/app.ts apps/api/test/round.test.ts
git commit -m "feat(api): GET /v1/round/today without spoilers"
```

---

### Task 11: `POST /v1/predictions` — lock enforcement, idempotency, first-hour flag

**Files:**
- Create: `apps/api/src/routes/predictions.ts`
- Modify: `apps/api/src/app.ts` (mount `app.route("/v1/predictions", predictionRoutes)`)
- Test: `apps/api/test/predictions.test.ts`

**Interfaces:**
- Consumes: `PredictionSubmitSchema` from `@oracle/core`, `deviceAuth`, `seedRound`.
- Produces: `POST /v1/predictions` (auth) with `PredictionSubmit` body →
  - 200 `{ id, first_hour }` on insert;
  - resubmission (same user+question) returns the **existing** row with 200 (idempotent — do not error);
  - 409 `{ error: "locked" }` when `now >= locks_at` (checked in the SQL insert predicate);
  - 404 unknown question; 400 invalid body.
  - `first_hour = createdAt <= opensAt + 1h` (boundary-inclusive; adjudicated during execution — Task 12's pinned boundary test governs).

- [ ] **Step 1: Write failing tests**

`apps/api/test/predictions.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function setup(opts?: { opensAt?: Date; locksAt?: Date }) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  const qs = await seedRound(db, {
    date: "2026-08-20",
    opensAt: opts?.opensAt ?? new Date("2026-08-20T16:00:00Z"),
    locksAt: opts?.locksAt ?? new Date("2026-08-21T16:00:00Z"),
  });
  const submit = (body: object) =>
    app.request("/v1/predictions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  return { db, qs, submit };
}

const body = (questionId: string) => ({ question_id: questionId, answer: true, confidence: 75, idempotency_key: "k1" });

afterEach(() => vi.useRealTimers());

describe("POST /v1/predictions", () => {
  it("inserts and flags first hour", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z") });
    const { qs, submit } = await setup();
    const res = await submit(body(qs[0]!.id));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { first_hour: boolean }).first_hour).toBe(true);
  });
  it("is idempotent on resubmission", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T18:00:00Z") });
    const { qs, submit } = await setup();
    const first = (await (await submit(body(qs[0]!.id))).json()) as { id: string; first_hour: boolean };
    expect(first.first_hour).toBe(false);
    const res2 = await submit({ ...body(qs[0]!.id), answer: false, confidence: 95 });
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { id: string }).id).toBe(first.id); // original stands; no edits after submit
  });
  it("409s after lock", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T16:00:01Z") });
    const { qs, submit } = await setup();
    expect((await submit(body(qs[0]!.id))).status).toBe(409);
  });
  it("404s on unknown question, 400s on bad confidence", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z") });
    const { qs, submit } = await setup();
    expect((await submit(body("3f0d8c1e-2b4a-4c6d-9e8f-1a2b3c4d5e6f"))).status).toBe(404);
    expect((await submit({ ...body(qs[0]!.id), confidence: 72 })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/api test`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

`apps/api/src/routes/predictions.ts`:
```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { PredictionSubmitSchema } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

export const predictionRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .post("/", async (c) => {
    const parsed = PredictionSubmitSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, parsed.data.question_id) });
    if (!q) return c.json({ error: "unknown question" }, 404);

    const now = new Date();
    if (now.getTime() >= q.locksAt.getTime()) return c.json({ error: "locked" }, 409);

    const firstHour = now.getTime() < q.opensAt.getTime() + 3_600_000;
    const inserted = await db
      .insert(schema.predictions)
      .values({
        questionId: q.id,
        userId,
        answer: parsed.data.answer,
        confidence: parsed.data.confidence,
        createdAt: now,
        firstHour,
      })
      .onConflictDoNothing({ target: [schema.predictions.questionId, schema.predictions.userId] })
      .returning({ id: schema.predictions.id, firstHour: schema.predictions.firstHour });

    if (inserted.length > 0) return c.json({ id: inserted[0]!.id, first_hour: inserted[0]!.firstHour });
    const existing = await db.query.predictions.findFirst({
      where: and(eq(schema.predictions.questionId, q.id), eq(schema.predictions.userId, userId)),
    });
    return c.json({ id: existing!.id, first_hour: existing!.firstHour });
  });
```

In `apps/api/src/app.ts`: `import { predictionRoutes } from "./routes/predictions"; app.route("/v1/predictions", predictionRoutes);`

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/predictions.ts apps/api/src/app.ts apps/api/test/predictions.test.ts
git commit -m "feat(api): prediction submission with lock enforcement and idempotency"
```

---

### Task 12: Resolution + reveal — the full cycle closes

**Files:**
- Create: `apps/api/src/routes/admin.ts`, `apps/api/src/resolution.ts`
- Modify: `apps/api/src/routes/round.ts` (add `GET /:date/reveal`), `apps/api/src/app.ts` (mount `app.route("/admin", adminRoutes)`)
- Test: `apps/api/test/resolve-reveal.test.ts`

**Interfaces:**
- Consumes: `brier`, `questionPoints` from `@oracle/core`.
- Produces:
  - `resolveQuestion(db, questionId, outcome: "yes" | "no" | "void", evidence: unknown)`: sets question `outcome/status/resolvedAt`, computes final `crowd_yes_pct` from its predictions, then grades every prediction (`brier`, `points` via core functions; void → points 0, brier null).
  - `POST /admin/questions/:id/resolve` `{ outcome, evidence? }`, gated by header `x-admin-secret: <ADMIN_SECRET>`; 401 otherwise.
  - `GET /v1/round/:date/reveal` (device auth): 409 `{ error: "not locked" }` unless every question is locked/resolved/void; else per-question `{ id, slot, text, outcome, crowd_yes_pct, my: { answer, confidence, points, brier } | null }` plus `{ day_points }` using `dayPoints` with the user's first-hour flag (true if ALL their predictions that day were first-hour).

- [ ] **Step 1: Write failing tests**

`apps/api/test/resolve-reveal.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin-secret" };

async function playerOn(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "ios" }),
  });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

afterEach(() => vi.useRealTimers());

describe("resolve + reveal cycle", () => {
  it("grades predictions with contrarian crowd math and reveals them", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z") });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const q1 = qs[0]!.id;

    // three players: A yes@75 (first hour), B no@55, C no@55 → crowd 33% YES, A is contrarian
    const [a, b, cPlayer] = [await playerOn(app), await playerOn(app), await playerOn(app)];
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: true, confidence: 75, idempotency_key: "a" }) });
    await b("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: false, confidence: 55, idempotency_key: "b" }) });
    await cPlayer("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: q1, answer: false, confidence: 55, idempotency_key: "c" }) });

    // lock all questions, resolve q1 YES
    vi.setSystemTime(new Date("2026-08-21T16:05:00Z"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-20"));
    const resolveRes = await app.request(`/admin/questions/${q1}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": env.ADMIN_SECRET },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(resolveRes.status).toBe(200);

    const reveal = await a("/v1/round/2026-08-20/reveal");
    expect(reveal.status).toBe(200);
    const bodyJson = (await reveal.json()) as {
      day_points: number;
      questions: Array<{ id: string; outcome: string | null; crowd_yes_pct: number | null; my: { points: number | null } | null }>;
    };
    const rq = bodyJson.questions.find((x) => x.id === q1)!;
    expect(rq.outcome).toBe("yes");
    expect(rq.crowd_yes_pct).toBe(33);
    // A: correct @75 → base 37.5, contrarian ×2 (33% < 40) → round(75) = 75; first hour: +round(7.5)=8 → day 83
    expect(rq.my!.points).toBe(75);
    expect(bodyJson.day_points).toBe(83);
  });

  it("rejects reveal while any question is still open, and admin without secret", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z") });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await playerOn(app);
    expect((await a("/v1/round/2026-08-20/reveal")).status).toBe(409);
    const res = await app.request(`/admin/questions/${qs[0]!.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "yes" }),
    });
    expect(res.status).toBe(401);
  });

  it("void questions grade to 0 points and null brier", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z") });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await playerOn(app);
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qs[0]!.id, answer: true, confidence: 95, idempotency_key: "a" }) });
    vi.setSystemTime(new Date("2026-08-21T16:05:00Z"));
    await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, "2026-08-20"));
    await app.request(`/admin/questions/${qs[0]!.id}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": env.ADMIN_SECRET },
      body: JSON.stringify({ outcome: "void" }),
    });
    const pred = await db.query.predictions.findFirst();
    expect(pred!.points).toBe(0);
    expect(pred!.brier).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/api test`
Expected: FAIL — `resolution.ts` / admin route / reveal route missing.

- [ ] **Step 3: Implement resolution**

`apps/api/src/resolution.ts`:
```ts
import { eq } from "drizzle-orm";
import { brier, questionPoints } from "@oracle/core";
import { schema, type Db } from "./db/client";

export async function resolveQuestion(db: Db, questionId: string, outcome: "yes" | "no" | "void", evidence: unknown = null) {
  const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");

  const yesCount = preds.filter((p) => p.answer).length;
  const crowdYesPct = preds.length === 0 ? 50 : Math.round((100 * yesCount) / preds.length);

  await db.update(schema.questions)
    .set({ outcome, status: outcome === "void" ? "void" : "resolved", resolvedAt: new Date(), crowdYesPct: String(crowdYesPct), resolutionEvidence: evidence })
    .where(eq(schema.questions.id, questionId));

  for (const p of preds) {
    const points = questionPoints({ answer: p.answer, confidence: p.confidence, outcome, isBigOne: q.isBigOne, crowdYesPct });
    const b = outcome === "void" ? null : String(brier({ answer: p.answer, confidence: p.confidence, outcome }));
    await db.update(schema.predictions).set({ points, brier: b }).where(eq(schema.predictions.id, p.id));
  }
}
```

`apps/api/src/routes/admin.ts`:
```ts
import { Hono } from "hono";
import { z } from "zod";
import type { AppContext } from "../app";
import { resolveQuestion } from "../resolution";

const ResolveSchema = z.object({ outcome: z.enum(["yes", "no", "void"]), evidence: z.unknown().optional() });

export const adminRoutes = new Hono<AppContext>()
  .use("*", async (c, next) => {
    if (c.req.header("x-admin-secret") !== c.get("deps").env.ADMIN_SECRET) return c.json({ error: "unauthorized" }, 401);
    await next();
  })
  .post("/questions/:id/resolve", async (c) => {
    const parsed = ResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    await resolveQuestion(c.get("deps").db, c.req.param("id"), parsed.data.outcome, parsed.data.evidence ?? null);
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Implement reveal**

Append to `apps/api/src/routes/round.ts` (inside `roundRoutes`):
```ts
.get("/:date/reveal", async (c) => {
  const { db } = c.get("deps");
  const userId = c.get("userId");
  const date = c.req.param("date");
  const qs = await db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: [asc(schema.questions.slot)],
  });
  if (qs.length === 0) return c.json({ error: "unknown round" }, 404);
  if (qs.some((q) => q.status === "open" || q.status === "scheduled")) return c.json({ error: "not locked" }, 409);

  const mine = await db.query.predictions.findMany({
    where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
  });
  const byQ = new Map(mine.map((p) => [p.questionId, p]));
  const perQuestionPoints = mine.map((p) => p.points ?? 0);
  const allFirstHour = mine.length > 0 && mine.every((p) => p.firstHour);

  return c.json({
    date,
    day_points: dayPoints(perQuestionPoints, allFirstHour),
    questions: qs.map((q) => {
      const p = byQ.get(q.id);
      return {
        id: q.id,
        slot: q.slot,
        text: q.text,
        outcome: q.outcome,
        crowd_yes_pct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
        my: p ? { answer: p.answer, confidence: p.confidence, points: p.points, brier: p.brier === null ? null : Number(p.brier) } : null,
      };
    }),
  });
})
```
Update imports in `round.ts`: `import { asc, and, eq, inArray } from "drizzle-orm";` and `import { dayPoints } from "@oracle/core";`
In `apps/api/src/app.ts`: `import { adminRoutes } from "./routes/admin"; app.route("/admin", adminRoutes);`

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @oracle/api test`
Expected: PASS (all three cycle tests).

- [ ] **Step 6: Full-repo check**

Run: `pnpm typecheck && pnpm test`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/resolution.ts apps/api/src/routes/admin.ts apps/api/src/routes/round.ts apps/api/src/app.ts apps/api/test/resolve-reveal.test.ts
git commit -m "feat(api): resolution grading and reveal endpoint - full cycle closes"
```

---

### Task 13: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `pnpm typecheck` / `pnpm test` (Task 1).

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 2: Verify locally that the same commands pass**

Run: `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test`
Expected: green (CI itself verifies on first push to a GitHub remote — repo may still be local-only; the workflow is ready for when a remote exists).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "chore: CI workflow (typecheck + tests)"
```

---

## Deferred to later plans (explicit, so nothing looks forgotten)

- **Plan 2 (Mobile core loop):** Expo scaffold, round screen, confidence slider, lock/crowd-reveal UI, TanStack Query client for these endpoints, TestFlight.
- **Plan 3 (Ritual & revenue):** reveal ceremony + Skia share cards, streak surfaces, `POST /v1/auth/merge` (device→Clerk account, transaction), RevenueCat + entitlements webhook + shields, OneSignal pushes, PostHog events, App Review submission.
- **Plan 4 (Launch surfaces):** Durable Object (live counter, SSE, lock/open alarms), Workers cron jobs (drop, resolution poller, aggregates), oracle_forecasts persistence + reveal integration (core math already done in Task 6), Hermes agent, admin UI, Astro site + OG images, leaderboard + titles, edge caching of `/v1/round/today`.

## Self-review notes

- Spec coverage: backend-spec §3 formulas → Tasks 3–5; §4 forecast math → Task 6 (persistence in Plan 4); §1 schema → Task 8 (drafts/forecasts/entitlements tables deferred with their features); §5 endpoints → Tasks 9–12 (merge/leaderboard/live/share deferred as listed); §7 lock-in-SQL + unique index + idempotency → Tasks 8/11.
- Type consistency: `Db` defined Task 8, placeholder in Task 7 explicitly replaced; `deviceAuth` produced Task 9, consumed 10–12; `seedRound` produced Task 8, consumed 10–12; core exports (`brier`, `questionPoints`, `dayPoints`) match call sites in Task 12.
