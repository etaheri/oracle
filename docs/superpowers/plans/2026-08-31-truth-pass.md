# Truth Pass — Implementation Plan (1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every number the game shows a player mathematically honest — a proper daily-points rule, contrarian credit that can't fire on three people, guarded resolution with a re-settle path, one definition of "complete round", calibrated epithets, and copy that states the real rules.

**Architecture:** Core first (`packages/core` — pure, node-tested), then the API integration points that consume it (`apps/api` — resolution, settlement, ledger, admin, Telegram). One migration (0003) carries every schema change for all three plans so later plans never touch the DB shape. The mobile app is untouched here except where a shared core signature forces a one-line call-site update (kept compiling; behaviour work is Plan 3).

**Tech Stack:** TypeScript, vitest, zod 4, drizzle-orm 0.45 + drizzle-kit 0.31, Hono 4, Neon (neon-http — **no interactive transactions**), PGlite test DB (reads `apps/api/drizzle/*.sql`).

**Spec:** `docs/superpowers/2026-08-31-gameplay-audit.md` §1 (scoring), §2.1 (resolve guard), §1.5–1.6 (epithets, shields, complete-round), plus `docs/superpowers/specs/2026-08-09-oracle-design.md` §3 and `docs/superpowers/specs/2026-08-26-oracle-voice-design.md` §2/§3.

## Global Constraints

- **Proper scoring is non-negotiable.** Daily points must remain an affine transform of Brier plus *additive* constants only. Never a win-only multiplier.
- **Machine voice** (enforced by `packages/core/test/copy-lint.test.ts`): ALL CAPS, no emoji, no `!`, banned words `CHECK / TAP / CLICK / VISIT / RESULTS / DON'T MISS`, ≤140 chars. Noon-pool lines never carry a score (`POINTS`, `SCORE`, `[+-]\d`). Every `{n}`/`{streak}` slot is backed by a requirement.
- **neon-http has no transactions** — idempotency comes from marker columns and status guards, never transactions.
- **Migrations:** generated with drizzle-kit, never hand-written; tests replay `apps/api/drizzle/*.sql` in name order. Apply to dev Neon by hand (`psql`) or via the new `db:migrate` script — record which in the commit message.
- **Test commands:** `pnpm --filter @oracle/core test`, `pnpm --filter @oracle/api test` (single worker, ~60s), `pnpm --filter @oracle/mobile test`. Typecheck: `pnpm -r typecheck`. API tests touching open rounds must freeze time: `vi.useFakeTimers({ now: ..., toFake: ["Date"] })` + `afterEach(() => vi.useRealTimers())`.
- **Commit after every task**, conventional prefix (`feat:`, `fix:`, `test:`, `chore:`). Never `git add` a broad path — stage the files you touched by name.
- Do NOT stage `docs/superpowers/2026-08-31-gameplay-audit.md` — Erik commits docs himself.

## File Structure

| File | Change | Task |
|---|---|---|
| `packages/core/src/constants.ts` | `CONTRARIAN_MULT` → `CONTRARIAN_BONUS`, add `CONTRARIAN_MIN_CROWD`, `SHIELD_MIN_STREAK`, `VERDICT_MIN_CALLS` | 1 |
| `packages/core/src/scoring.ts` | additive contrarian bonus, `crowdCount` input, `contrarianApplies`, `payoff` | 1 |
| `packages/core/test/scoring.test.ts` | new ladders | 1 |
| `packages/core/src/streak.ts` + `test/streak.test.ts` | shields only at `streakCurrent ≥ 3` | 2 |
| `packages/core/src/epithet.ts` + `test/epithet.test.ts` | n-guards, receipts | 3 |
| `packages/core/src/copy.ts` + `test/copy-lint.test.ts` | rites rewrite, `PARTIAL_LINE`, `SUMMONS_LINES`, risk line, `partial` requirement | 4 |
| `packages/core/src/schemas.ts` + `test/round-schemas.test.ts` | every payload field Plans 2–3 will need | 5 |
| `apps/api/drizzle.config.ts`, `apps/api/package.json` | env-driven credentials, `db:generate` / `db:migrate` | 6 |
| `apps/api/src/db/schema.ts` + `apps/api/drizzle/0003_*.sql` | crowd_count, oracle_p_yes, devices.ip_hash/created_at, draft_bank, indexes | 6 |
| `apps/api/src/resolution.ts` + `test/resolution.test.ts` (new) | status guard, `force`, crowd_count stamp, `evidenceSummary` | 7 |
| `apps/api/src/settlement.ts` + `test/settlement.test.ts` | one complete-round definition, `recomputeTruth`, `resettleRound` | 8 |
| `apps/api/src/routes/round.ts` + `test/reveal-first-hour.test.ts` | first-hour = all five early | 8 |
| `apps/api/src/routes/admin.ts` + `test/admin-rounds.test.ts` | `force`, 409 on not resolvable | 9 |
| `apps/api/src/routes/telegram.ts` + `test/telegram-webhook.test.ts` | `/flip <slot> <yes\|no\|void>` | 9 |
| `apps/api/src/routes/me.ts` + `test/ledger.test.ts` | `calls_rated`, `calls_answered`, ET month, crowd-count-aware tide wins, epithet input | 10 |
| `apps/mobile/src/game/crowdVerdict.ts` + `test/crowdVerdict.test.ts`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/ui/CrowdReveal.tsx`, `apps/mobile/src/app/ledger.tsx`, `apps/mobile/src/app/reveal/[date].tsx` | signature-only call-site updates so mobile keeps compiling | 11 |

---

### Task 1: Proper daily points — additive contrarian bonus with a crowd floor

**Why:** `questionPoints` applies ×2 to contrarian *wins only* (`scoring.ts:20-23`), so the expected-points maximizer for belief `p` on a minority side is `2p/(1+p)`, not `p` (audit §1.1). An additive bonus preserves properness. The bonus also currently fires when you're 1-of-3 (audit §1.2) — it needs a crowd floor.

**Files:**
- Modify: `packages/core/src/constants.ts`
- Modify: `packages/core/src/scoring.ts`
- Test: `packages/core/test/scoring.test.ts`

**Interfaces:**
- Produces: `CONSTANTS.CONTRARIAN_BONUS = 20`, `CONSTANTS.CONTRARIAN_MIN_CROWD = 20` (`CONTRARIAN_MULT` is deleted — grep confirms its only consumer is `scoring.ts`).
- Produces: `questionPoints(input: { answer: boolean; confidence: number; outcome: "yes"|"no"|"void"; isBigOne: boolean; crowdYesPct: number; crowdCount: number }): number` — **`crowdCount` is a new required field.**
- Produces: `contrarianApplies(sidePct: number, crowdCount: number): boolean` — the single source of truth for "against the tide pays" (mobile verdict, ledger tide wins, and scoring all call it).
- Produces: `payoff(confidence: number, isBigOne: boolean): { win: number; loss: number }` — points if right / if wrong, no crowd effects (for the card footer in Plan 3).

- [ ] **Step 1: Rewrite the contrarian tests to the new ladder**

Replace the three contrarian `it` blocks in `packages/core/test/scoring.test.ts` (keep `brier`, `correct`, `wrong`, `void`, `big one` blocks; add `crowdCount: 50` to the shared `base`):

```ts
describe("questionPoints", () => {
  const base = { isBigOne: false, crowdYesPct: 50, crowdCount: 50 };
  // ...existing correct/wrong/void/big-one blocks unchanged, they now spread `base` with crowdCount...

  it("contrarian is an ADDITIVE bonus on wins when my side < 40% of a crowd ≥ 20", () => {
    // YES @75, crowd 39% YES, 50 players → 37.5 + 20 = 57.5 → 58
    expect(questionPoints({ ...base, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(58);
    // exactly 40 is NOT contrarian
    expect(questionPoints({ ...base, crowdYesPct: 40, answer: true, confidence: 75, outcome: "yes" })).toBe(38);
    // NO answer: side pct = 100 − crowdYesPct → 61% YES means 39% NO side
    expect(questionPoints({ ...base, crowdYesPct: 61, answer: false, confidence: 75, outcome: "no" })).toBe(58);
  });
  it("the bonus is the same 20 at every conviction — honesty stays optimal", () => {
    // 55 → 9.5+20 = 29.5 → 30 ; 95 → 49.5+20 = 69.5 → 70
    expect(questionPoints({ ...base, crowdYesPct: 39, answer: true, confidence: 55, outcome: "yes" })).toBe(30);
    expect(questionPoints({ ...base, crowdYesPct: 39, answer: true, confidence: 95, outcome: "yes" })).toBe(70);
  });
  it("contrarian never touches losses", () => {
    expect(questionPoints({ ...base, crowdYesPct: 39, answer: true, confidence: 75, outcome: "no" })).toBe(-62);
  });
  it("big one doubles the bonus too: 2×37.5 + 2×20 = 115", () => {
    expect(questionPoints({ ...base, isBigOne: true, crowdYesPct: 39, answer: true, confidence: 75, outcome: "yes" })).toBe(115);
  });
  it("no bonus under the crowd floor — three people are not a tide", () => {
    expect(questionPoints({ ...base, crowdCount: 3, crowdYesPct: 33, answer: true, confidence: 75, outcome: "yes" })).toBe(38);
    expect(questionPoints({ ...base, crowdCount: 19, crowdYesPct: 33, answer: true, confidence: 75, outcome: "yes" })).toBe(38);
    expect(questionPoints({ ...base, crowdCount: 20, crowdYesPct: 33, answer: true, confidence: 75, outcome: "yes" })).toBe(58);
  });
});

describe("contrarianApplies", () => {
  it("is side < 40 AND crowd ≥ 20", () => {
    expect(contrarianApplies(39, 20)).toBe(true);
    expect(contrarianApplies(40, 20)).toBe(false);
    expect(contrarianApplies(39, 19)).toBe(false);
  });
});

describe("payoff", () => {
  it("is the win/loss ladder with no crowd effects", () => {
    expect(payoff(55, false)).toEqual({ win: 10, loss: -10 });
    expect(payoff(75, false)).toEqual({ win: 38, loss: -62 });
    expect(payoff(95, false)).toEqual({ win: 50, loss: -130 });
    expect(payoff(95, true)).toEqual({ win: 99, loss: -261 }); // 2×49.5 = 99 ; 2×−130.5 = −261
  });
});
```

Update the import line: `import { brier, questionPoints, contrarianApplies, payoff } from "../src/scoring";`

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test -- scoring`
Expected: FAIL — `contrarianApplies is not a function`, ladder mismatches (75 vs 58).

- [ ] **Step 3: Implement**

`packages/core/src/constants.ts` — replace the two contrarian lines:

```ts
  CONTRARIAN_BONUS: 20,      // ADDITIVE, wins only, ×BIG_ONE_MULT on the big one — additive keeps the rule proper
  CONTRARIAN_MIN_CROWD: 20,  // no tide under this many players on the question
  CONTRARIAN_CROWD_PCT: 40,  // your side's final crowd % must be strictly below this
  SHIELD_MIN_STREAK: 3,      // shields (free or paid) only defend a vigil this long
  VERDICT_MIN_CALLS: 20,     // calibration verdict / gap epithets need this many resolved calls
```

`packages/core/src/scoring.ts` — replace `questionPoints` and add the helpers:

```ts
export function contrarianApplies(sidePct: number, crowdCount: number): boolean {
  return crowdCount >= C.CONTRARIAN_MIN_CROWD && sidePct < C.CONTRARIAN_CROWD_PCT;
}

export function questionPoints(input: {
  answer: boolean;
  confidence: number;
  outcome: "yes" | "no" | "void";
  isBigOne: boolean;
  crowdYesPct: number;
  crowdCount: number;
}): number {
  if (input.outcome === "void") return 0;
  const b = brier({ answer: input.answer, confidence: input.confidence, outcome: input.outcome });
  const base = C.POINTS_SCALE * (C.POINTS_BASELINE - b); // proper: affine in brier
  const bigMult = input.isBigOne ? C.BIG_ONE_MULT : 1;
  const sidePct = input.answer ? input.crowdYesPct : 100 - input.crowdYesPct;
  // Contrarian credit is ADDITIVE (a constant, never a multiplier on the
  // Brier term) so the expected-points maximizer stays the honest belief.
  const bonus = base > 0 && contrarianApplies(sidePct, input.crowdCount) ? C.CONTRARIAN_BONUS : 0;
  const result = bigMult * base + bigMult * bonus;
  // Round to high precision first to eliminate floating-point noise, then round to integer
  return Math.round(Math.round(result * 1e10) / 1e10);
}

// The card's honest payoff line: what this conviction earns if right / costs
// if wrong, before any crowd credit.
export function payoff(confidence: number, isBigOne: boolean): { win: number; loss: number } {
  const common = { answer: true, confidence, isBigOne, crowdYesPct: 50, crowdCount: 0 };
  return {
    win: questionPoints({ ...common, outcome: "yes" }),
    loss: questionPoints({ ...common, outcome: "no" }),
  };
}
```

- [ ] **Step 4: Run core tests + typecheck the monorepo**

Run: `pnpm --filter @oracle/core test && pnpm -r typecheck`
Expected: core PASS. Typecheck FAILS in `apps/api/src/resolution.ts` (missing `crowdCount`) — expected; fixed in Task 7. To keep the tree compiling between tasks, add the temporary line in `resolution.ts` inside the `for` loop: `crowdCount: preds.length,` in the `questionPoints({...})` call. Re-run `pnpm -r typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constants.ts packages/core/src/scoring.ts packages/core/test/scoring.test.ts apps/api/src/resolution.ts
git commit -m "fix(core): contrarian credit is an additive +20 with a 20-player crowd floor — daily points are proper again"
```

---

### Task 2: Shields defend a vigil, not a first day

**Why:** `settleStreak` burns the month's free shield to protect a 1-day streak (audit §1.6). A shield should only spend itself on something worth keeping.

**Files:**
- Modify: `packages/core/src/streak.ts`
- Test: `packages/core/test/streak.test.ts`

**Interfaces:**
- Consumes: `CONSTANTS.SHIELD_MIN_STREAK` (Task 1).
- Produces: unchanged signature `settleStreak(state, played, roundDate)`; new behaviour: when `!played && state.streakCurrent < SHIELD_MIN_STREAK` → reset to 0, no shield consumed.

- [ ] **Step 1: Add the failing tests**

Append inside `describe("settleStreak")`:

```ts
  it("does not spend any shield on a vigil shorter than SHIELD_MIN_STREAK", () => {
    const r = settleStreak({ ...base, streakCurrent: 2, paidShieldsRemaining: 3 }, false, "2026-08-20");
    expect(r.streakCurrent).toBe(0);
    expect(r.usedFreeShield).toBe(false);
    expect(r.usedPaidShield).toBe(false);
    expect(r.freeShieldUsedAt).toBeNull();
    expect(r.paidShieldsRemaining).toBe(3);
  });
  it("spends the free shield exactly at SHIELD_MIN_STREAK", () => {
    const r = settleStreak({ ...base, streakCurrent: 3 }, false, "2026-08-20");
    expect(r.usedFreeShield).toBe(true);
    expect(r.streakCurrent).toBe(3);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test -- streak`
Expected: FAIL — first new test gets `usedFreeShield: true`.

- [ ] **Step 3: Implement**

In `packages/core/src/streak.ts`, add the import `import { CONSTANTS as C } from "./constants";` and insert after the `if (played) {...}` block:

```ts
  // A shield defends a vigil, not a first day: under the floor the streak
  // simply resets and every shield stays in reserve for when it matters.
  if (state.streakCurrent < C.SHIELD_MIN_STREAK) {
    return { ...state, streakCurrent: 0, usedFreeShield: false, usedPaidShield: false };
  }
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/core test && pnpm --filter @oracle/api test -- settlement`
Expected: core PASS. API `settlement.test.ts` "a miss consumes the free monthly shield…" now FAILS (its streak is 1). Fix that test: before the day-2 miss, play days `2026-08-20`, `2026-08-21`, `2026-08-22` (streak 3) then miss on `08-23`, `08-24`, `08-25` — shift every subsequent date by two days and assertions to `streakCurrent: 3` where they said `1`. Re-run → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/streak.ts packages/core/test/streak.test.ts apps/api/test/settlement.test.ts
git commit -m "fix(core): shields only defend a vigil of three or more days"
```

---

### Task 3: Epithets and the calibration verdict need receipts

**Why:** `calibrationVerdict` fires after one call; HIGH PRIEST crowns a +30 gap; TIDE-FIGHTER's receipt claims a perfect record it can't know (audit §1.5). Voice spec: never blunt without receipts.

**Files:**
- Modify: `packages/core/src/epithet.ts`
- Test: `packages/core/test/epithet.test.ts`

**Interfaces:**
- Produces: `EpithetInput` gains `resolvedCalls: number` (resolved, non-void calls in the window).
- Produces: `calibrationVerdict(avgConfidence: number|null, accuracyPct: number|null, resolvedCalls: number): string | null` — null under `VERDICT_MIN_CALLS`.
- Produces: receipts — UNREAD: `"{completeRounds} OF 5 COMPLETE DAYS WRITTEN."`; TIDE-FIGHTER: `"{n} TIMES RIGHT AGAINST THE CROWD."`.

- [ ] **Step 1: Update tests**

In `packages/core/test/epithet.test.ts`: add `resolvedCalls: 40` to `base`; change the UNREAD receipt expectation to `"4 OF 5 COMPLETE DAYS WRITTEN."`; TIDE-FIGHTER receipt to `"3 TIMES RIGHT AGAINST THE CROWD."`; the KEEPER floor test object gets `resolvedCalls: 0`. Add:

```ts
  it("HIGH PRIEST requires an honest gap — loud AND right AND calibrated", () => {
    expect(assignEpithet({ ...base, avgConfidence: 90, accuracyPct: 65 }).id).not.toBe("high-priest"); // gap +25
    expect(assignEpithet({ ...base, avgConfidence: 88, accuracyPct: 80 }).id).toBe("high-priest");   // gap +8
  });
  it("gap-based epithets need VERDICT_MIN_CALLS resolved calls; otherwise fall through", () => {
    const thin = { ...base, resolvedCalls: 10, avgConfidence: 60, accuracyPct: 80, majorityRate: 0.5, streakCurrent: 0 };
    expect(assignEpithet(thin).id).toBe("keeper"); // not humble-ledger
  });

describe("calibrationVerdict", () => {
  it("is silent under VERDICT_MIN_CALLS", () => {
    expect(calibrationVerdict(80, 50, 19)).toBeNull();
    expect(calibrationVerdict(80, 50, 20)).toBe("YOUR CONFIDENCE OUTRUNS YOUR ACCURACY");
  });
  it("names the gap's direction", () => {
    expect(calibrationVerdict(60, 80, 30)).toBe("YOU KNOW MORE THAN YOU CLAIM");
    expect(calibrationVerdict(70, 68, 30)).toBe("YOUR CONFIDENCE IS HONEST");
    expect(calibrationVerdict(null, 68, 30)).toBeNull();
  });
});
```

(If a `calibrationVerdict` describe already exists, merge into it and add the third argument to every existing call.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test -- epithet`
Expected: FAIL on receipts and the new guards.

- [ ] **Step 3: Implement**

`packages/core/src/epithet.ts`:

```ts
import { CONSTANTS as C } from "./constants";

export interface EpithetInput {
  completeRounds: number;
  tideWins: number;
  avgConfidence: number | null;
  accuracyPct: number | null;
  majorityRate: number | null;
  streakCurrent: number;
  resolvedCalls: number; // resolved, non-void calls in the window — the receipt behind every gap claim
}

export function assignEpithet(s: EpithetInput): Epithet {
  if (s.completeRounds < 5) {
    return { id: "unread", title: "THE UNREAD", receipt: `${s.completeRounds} OF 5 COMPLETE DAYS WRITTEN.` };
  }
  if (s.tideWins >= 3) {
    return { id: "tide-fighter", title: "TIDE-FIGHTER", receipt: `${s.tideWins} TIMES RIGHT AGAINST THE CROWD.` };
  }
  const enough = s.resolvedCalls >= C.VERDICT_MIN_CALLS;
  const gap = enough && s.avgConfidence !== null && s.accuracyPct !== null ? s.avgConfidence - s.accuracyPct : null;
  if (gap !== null && Math.abs(gap) <= 10 && s.avgConfidence! < 70) {
    return { id: "calibrated-skeptic", title: "CALIBRATED SKEPTIC", receipt: "YOU CLAIM LITTLE AND MISS LESS." };
  }
  if (gap !== null && Math.abs(gap) <= 10 && s.avgConfidence! >= 85 && s.accuracyPct! >= 60) {
    return { id: "high-priest", title: "HIGH PRIEST OF CONVICTION", receipt: "YOU SPEAK LOUDLY AND THE LEDGER AGREES." };
  }
  if (gap !== null && gap < -10) {
    return { id: "humble-ledger", title: "THE HUMBLE LEDGER", receipt: "YOU KNOW MORE THAN YOU CLAIM." };
  }
  // ...true-believer, minority-oracle, unshaken, keeper unchanged...
}

export function calibrationVerdict(avgConfidence: number | null, accuracyPct: number | null, resolvedCalls: number): string | null {
  if (avgConfidence === null || accuracyPct === null || resolvedCalls < C.VERDICT_MIN_CALLS) return null;
  const gap = avgConfidence - accuracyPct;
  if (gap > 10) return "YOUR CONFIDENCE OUTRUNS YOUR ACCURACY";
  if (gap < -10) return "YOU KNOW MORE THAN YOU CLAIM";
  return "YOUR CONFIDENCE IS HONEST";
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @oracle/core test && pnpm -r typecheck`
Expected: core PASS. Typecheck fails in `apps/api/src/routes/me.ts` (missing `resolvedCalls`) and `apps/mobile/src/app/ledger.tsx` (verdict arity). Temporary compile fixes, both finalized later: in `me.ts` add `resolvedCalls: resolved.filter((r) => r.inWindow).length,` to the `assignEpithet({...})` call; in `ledger.tsx` pass `0` as the third argument to both `calibrationVerdict(...)` calls (Plan 3 replaces it with `d.calls_answered`). Re-run typecheck → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/epithet.ts packages/core/test/epithet.test.ts apps/api/src/routes/me.ts apps/mobile/src/app/ledger.tsx
git commit -m "fix(core): epithets and the verdict speak only with twenty calls of receipts"
```

---

### Task 4: Copy truth pass — rites, partial line, summons, risk line

**Why:** The rites promise "THE LEDGER PAYS TWICE" (no longer true), say "NOON TO NOON" without naming the city, and omit the two rules players most need: partial days don't rate, and the first-hour bonus needs all five. Plan 3 needs a partial-day line, a streak-at-risk line, a partial-aware closing reminder, and interstitial copy — all of which must live in the linted bank.

**Files:**
- Modify: `packages/core/src/copy.ts`
- Test: `packages/core/test/copy-lint.test.ts`

**Interfaces:**
- Produces: `Requirement` union gains `"partial"`.
- Produces: `RITES_LINES` (11 lines, below), `PARTIAL_LINE`, `SUMMONS_LINES`, bank lines `streak.risk-1`, `closing.partial-1`, `closing.partial-2`, `noon.tide-3` reworded.

- [ ] **Step 1: Extend the lint**

In `copy-lint.test.ts`: import `PARTIAL_LINE, SUMMONS_LINES`; in the slot test, `{n}` lines in the closing pool may require `"players"` **or** `"partial"` — no, keep `{n}` rules as they are (new lines carry no slots). Add to the rites describe:

```ts
  it("state the current rules: bounty not double, all five for the first hour, the city of noon, partial days", () => {
    const all = RITES_LINES.join(" ");
    expect(all).not.toContain("PAYS TWICE");
    expect(all).toContain("NEW YORK");
    expect(all).toContain("ALL FIVE");
    expect(RITES_LINES.length).toBe(11);
  });
  it("partial and summons lines hold the register", () => {
    for (const l of [PARTIAL_LINE, ...SUMMONS_LINES]) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
```

In the bank describe add:

```ts
  it("carries the streak-at-risk and partial-closing lines", () => {
    expect(COPY_BANK.find((l) => l.id === "streak.risk-1")?.requires).toContain("streak");
    const partial = COPY_BANK.filter((l) => (l.requires ?? []).includes("partial"));
    expect(partial.length).toBeGreaterThanOrEqual(2);
    for (const l of partial) expect(l.pool).toBe("closing");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test -- copy-lint`
Expected: FAIL (imports missing, rites assertions).

- [ ] **Step 3: Implement**

In `packages/core/src/copy.ts`:

```ts
export type Requirement = "results" | "tideWin" | "streak" | "players" | "lapsed" | "wrong" | "partial";
```

Reword `noon.tide-3`: `"FEW STOOD WHERE YOU STOOD. THE LEDGER PAID A BOUNTY."`

Add to the closing pool (after `closing.call-20`):

```ts
  { id: "closing.partial-1", pool: "closing", text: "THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED. NOON IS COMING.", requires: ["partial"] },
  { id: "closing.partial-2", pool: "closing", text: "YOUR PROPHECY IS UNFINISHED. THE LEDGER COUNTS ONLY WHOLE DAYS.", requires: ["partial"] },
```

Add to the streak pool (after `streak.begin-1`):

```ts
  { id: "streak.risk-1", pool: "streak", text: "YOUR VIGIL OF {streak} DAYS ENDS AT NOON.", requires: ["streak"] },
```

Replace `RITES_LINES`:

```ts
export const RITES_LINES = [
  "FIVE QUESTIONS. ONCE A DAY. NOON TO NOON, NEW YORK TIME.",
  "PULL TOWARD YES OR NO. THE LONGER THE PULL, THE GREATER THE CONVICTION. TO RELEASE IS TO SEAL.",
  "AN ANSWER SEALED CANNOT BE UNSEALED.",
  "THE CROWD IS HIDDEN UNTIL YOU COMMIT.",
  "CONVICTION PAYS WHEN RIGHT. IT COSTS MORE WHEN WRONG.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
  "STAND AGAINST THE TIDE AND PREVAIL: THE LEDGER ADDS A BOUNTY.",
  "SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE.",
  "SEAL ALL FIVE OR THE DAY DOES NOT RATE. POINTS AND VIGIL STILL COUNT.",
  "MISS A NOON AND THE SHIELD MAY HOLD. ONE IS GRANTED EACH MONTH.",
  "THE LEDGER IS READ AT NOON. NOTHING IS REVISED.",
] as const;

// The partial-day notice (home, when some but not all five are sealed).
export const PARTIAL_LINE = "THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED.";

// The summons: the interstitial before the OS notification prompt (voice
// spec §4). Three declaratives, then the machine asks once.
export const SUMMONS_LINES = [
  "THE ORACLE SPEAKS TWICE A DAY.",
  "ONCE TO ASK. ONCE TO ANSWER.",
  "IT WILL NOT SPEAK MORE THAN THAT.",
] as const;
```

Note: the `VIGIL_LINES` filter (`pool === "streak" && requires streak`) would now include `streak.risk-1`. Exclude it: `const VIGIL_LINES = COPY_BANK.filter((l) => l.pool === "streak" && (l.requires ?? []).includes("streak") && !l.id.startsWith("streak.risk"));`

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/core test`
Expected: PASS (the "at least 60 lines" and pool-shape tests still hold; `copy-select.test.ts` vigil tests still pass because risk is excluded).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts
git commit -m "feat(core): rites state the real rules — bounty, all five, New York noon, partial days; summons + risk lines"
```

---

### Task 5: Schema contracts for everything Plans 2–3 will show

**Why:** Plans 2 and 3 each add reveal/ledger/today fields. Fixing the zod contracts once here (with the fixture test) means every later task compiles against a known shape and the "RevealSchema growth broke the fixture" trap (memory) happens exactly once, now.

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Test: `packages/core/test/round-schemas.test.ts`

**Interfaces (all produced here, consumed by Plans 2–3):**
- `RoundTodaySchema.questions[]` gains `locks_at: string` (ISO). Top-level `locks_at` stays (= latest question lock).
- `RoundNextSchema = z.object({ date: z.string(), opens_at: z.string() })`.
- `RevealSchema.questions[]` gains `source_name: string`, `source_url: string|null`, `evidence_quote: string|null`, `void_reason: string|null`, `oracle_p_yes: number|null`.
- `RevealSchema` gains `ledger: { settled: boolean; streak: number; calls_rated: number; oracle_score: number|null }`.
- `MeLedgerSchema` gains `calls_rated: number` (complete-round calls that feed Oracle Score — `users.calls_resolved`) and `calls_answered: number` (all resolved non-void calls, lifetime).

- [ ] **Step 1: Update the fixtures**

In `round-schemas.test.ts` add `locks_at: "2026-08-21T16:00:00.000Z"` to the today question; add to the reveal question `source_name: "NWS", source_url: null, evidence_quote: null, void_reason: "unverifiable by deadline", oracle_p_yes: null`; add top-level `ledger: { settled: true, streak: 4, calls_rated: 35, oracle_score: null }`. Add a third test:

```ts
  it("parses /round/next", () => {
    const payload = { date: "2026-08-21", opens_at: "2026-08-21T16:00:00.000Z" };
    expect(RoundNextSchema.parse(payload)).toEqual(payload);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test -- round-schemas`
Expected: FAIL (unknown keys are stripped by zod so `toEqual` mismatches; `RoundNextSchema` undefined).

- [ ] **Step 3: Implement**

In `schemas.ts`: add `locks_at: z.string()` inside the today question object; add after `RoundTodaySchema`:

```ts
export const RoundNextSchema = z.object({ date: z.string(), opens_at: z.string() });
export type RoundNext = z.infer<typeof RoundNextSchema>;
```

Reveal question object: add
```ts
      source_name: z.string(),
      source_url: z.string().nullable(),
      evidence_quote: z.string().nullable(),
      void_reason: z.string().nullable(),
      oracle_p_yes: z.number().nullable(),
```
Reveal top level: add
```ts
  ledger: z.object({
    settled: z.boolean(),
    streak: z.number().int(),
    calls_rated: z.number().int(),
    oracle_score: z.number().int().nullable(),
  }),
```
`MeLedgerSchema`: add `calls_rated: z.number().int(),` and `calls_answered: z.number().int(),` after `oracle_score`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @oracle/core test && pnpm -r typecheck`
Expected: core PASS. Mobile typecheck fails where fixtures/types build `Reveal` objects (`apps/mobile/test/revealReady.test.ts` builds a `Reveal`) — add the new fields to that fixture (`source_name: "S", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: null` on the question; `ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }` on the reveal). API tests parse responses loosely (JSON casts), so no API change is needed to compile — the API *serves* these fields in Tasks 8–10 and Plan 2. Re-run → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/test/round-schemas.test.ts apps/mobile/test/revealReady.test.ts
git commit -m "feat(core): payload contracts for sources, evidence, the oracle's forecast, ledger-on-reveal, next round"
```

---

### Task 6: Migration 0003 + a real migrate workflow

**Why:** Later tasks need `questions.crowd_count` (contrarian floor at ledger time), `questions.oracle_p_yes` (Plan 2 forecast), `devices.ip_hash`/`created_at` (Plan 2 mint throttle), a `draft_bank` table (Plan 2 evergreen drafts), and three missing indexes. Migrations 0001/0002 were applied by hand because `drizzle.config.ts` has no credentials (memory gotcha) — fix that too.

**Files:**
- Modify: `apps/api/drizzle.config.ts`, `apps/api/package.json`
- Modify: `apps/api/src/db/schema.ts`
- Create (generated): `apps/api/drizzle/0003_<name>.sql` + `drizzle/meta/*`
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `schema.questions.crowdCount: integer | null`, `schema.questions.oracleProbYes: numeric("oracle_p_yes") | null`, `schema.devices.ipHash: text | null`, `schema.devices.createdAt: timestamptz not null default now`, `schema.draftBank` table `{ id uuid pk, draft jsonb not null, createdAt timestamptz, usedOn date | null }`.
- Produces: scripts `pnpm --filter @oracle/api db:generate -- --name <name>` and `pnpm --filter @oracle/api db:migrate` (needs `DATABASE_URL` in env).

- [ ] **Step 1: Write the failing schema test**

Append to `apps/api/test/schema.test.ts` (read the file first; follow its `makeTestDb` pattern):

```ts
  it("0003: crowd_count, oracle_p_yes, device ip throttle columns, draft bank, indexes", async () => {
    const { pg } = await makeTestDb();
    const cols = async (table: string) =>
      (await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = $1`, [table])).rows.map((r) => r.column_name);
    expect(await cols("questions")).toEqual(expect.arrayContaining(["crowd_count", "oracle_p_yes"]));
    expect(await cols("devices")).toEqual(expect.arrayContaining(["ip_hash", "created_at"]));
    expect(await cols("draft_bank")).toEqual(expect.arrayContaining(["id", "draft", "created_at", "used_on"]));
    const idx = (await pg.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname = 'public'`)).rows.map((r) => r.indexname);
    expect(idx).toEqual(expect.arrayContaining(["predictions_user_idx", "questions_round_date_idx", "users_oracle_score_idx", "devices_ip_hash_idx"]));
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- schema`
Expected: FAIL (columns missing).

- [ ] **Step 3: Schema + config + scripts**

`apps/api/src/db/schema.ts` — add `index` to the drizzle import; apply:

```ts
export const users = pgTable("users", { /* unchanged columns */ }, (t) => [index("users_oracle_score_idx").on(t.oracleScore)]);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  installTokenHash: text("install_token_hash").notNull(),
  platform: text("platform").notNull(),
  // Salted hash of the minting IP — the device-mint throttle's only memory.
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("devices_ip_hash_idx").on(t.ipHash, t.createdAt)]);

// questions: add two columns and an index
  crowdYesPct: numeric("crowd_yes_pct"),
  // Distinct predictors on this question at resolution — the contrarian
  // floor (CONTRARIAN_MIN_CROWD) is judged against this, never re-derived.
  crowdCount: integer("crowd_count"),
  marketProb: numeric("market_prob"),
  // The Oracle's own forecast (skill-weighted aggregate), stamped at lock.
  oracleProbYes: numeric("oracle_p_yes"),
}, (t) => [index("questions_round_date_idx").on(t.roundDate)]);

// predictions: add to the existing index array
}, (t) => [uniqueIndex("predictions_question_user_unique").on(t.questionId, t.userId), index("predictions_user_idx").on(t.userId)]);

// Evergreen draft bank: date-agnostic five-question drafts the noon publish
// falls through to when no round is scheduled for today (design spec §6:
// "the drop must never depend on the agent being alive").
export const draftBank = pgTable("draft_bank", {
  id: uuid("id").primaryKey().defaultRandom(),
  draft: jsonb("draft").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  usedOn: date("used_on"),
});
```

`apps/api/drizzle.config.ts`:

```ts
import { defineConfig } from "drizzle-kit";
// DATABASE_URL is only needed for `db:migrate`/`db:push`; `db:generate` is
// offline. Source it from apps/api/.dev.vars for dev Neon.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL ? { dbCredentials: { url: process.env.DATABASE_URL } } : {}),
});
```

`apps/api/package.json` scripts: add `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`.

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate -- --name gameplay_audit`
Expected: `drizzle/0003_gameplay_audit.sql` created with `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE "draft_bank"`, `CREATE INDEX` statements; `drizzle/meta/0003_snapshot.json` + journal updated. Open the SQL and confirm nothing destructive (no DROP).

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @oracle/api test`
Expected: PASS (all 157 + the new one).

- [ ] **Step 6: Apply to dev Neon**

Run from `apps/api`: `set -a && source .dev.vars && set +a && pnpm db:migrate`. If drizzle-kit's `__drizzle_migrations` table doesn't know 0000–0002 (they were applied by hand) it will try to re-run them and fail on "already exists". In that case apply 0003 by hand: `psql "$DATABASE_URL" -f drizzle/0003_gameplay_audit.sql` (statements are split by `--> statement-breakpoint` comments, which psql ignores), then note in the commit body that dev was applied via psql. Verify: `psql "$DATABASE_URL" -c '\d draft_bank'`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/drizzle.config.ts apps/api/package.json apps/api/test/schema.test.ts
git commit -m "feat(api): migration 0003 — crowd_count, oracle_p_yes, mint-throttle columns, draft bank, indexes; db:generate/db:migrate scripts"
```

---

### Task 7: Guarded resolution — status guard, `force`, crowd_count, evidence summary

**Why:** `resolveQuestion` overwrites any question in any status (audit §2.1). It also needs to stamp `crowd_count` (Task 1's floor must be judged on the final crowd, and `me.ts` must re-judge tide wins from it later), and Plan 3's reveal needs a stable extraction of the evidence quote / void reason from the free-form `resolution_evidence` JSON.

**Files:**
- Modify: `apps/api/src/resolution.ts`
- Create: `apps/api/test/resolution.test.ts`

**Interfaces:**
- Produces: `resolveQuestion(db, questionId, outcome, evidence: unknown = null, opts: { force?: boolean } = {}): Promise<void>` — allowed from status `open` or `locked` (tests seed `open` rounds and resolve directly; the pipeline always locks first); from `resolved`/`void` **only** with `force: true`; otherwise `throw new Error("not resolvable")`.
- Produces: `evidenceSummary(evidence: unknown): { quote: string | null; reason: string | null }` — `quote` = first `quotes[i].quote` string if present; `reason` = `evidence.reason` string if present.
- Stamps `crowdCount = preds.length` alongside `crowdYesPct`; passes `crowdCount` to `questionPoints`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/resolution.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion, evidenceSummary } from "../src/resolution";
import * as schema from "../src/db/schema";

describe("resolveQuestion guard", () => {
  it("resolves an open or locked question and stamps crowd_count", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await resolveQuestion(db, qs[0]!.id, "yes");
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[0]!.id) });
    expect(q!.status).toBe("resolved");
    expect(q!.crowdCount).toBe(0);
  });
  it("refuses to re-resolve a resolved question without force", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await resolveQuestion(db, qs[0]!.id, "yes");
    await expect(resolveQuestion(db, qs[0]!.id, "no")).rejects.toThrow("not resolvable");
    await resolveQuestion(db, qs[0]!.id, "no", null, { force: true });
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[0]!.id) });
    expect(q!.outcome).toBe("no");
  });
  it("refuses a scheduled question", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await db.update(schema.questions).set({ status: "scheduled" }).where(eq(schema.questions.id, qs[0]!.id));
    await expect(resolveQuestion(db, qs[0]!.id, "yes")).rejects.toThrow("not resolvable");
  });
});

describe("evidenceSummary", () => {
  it("lifts the first quote and a reason, tolerating any shape", () => {
    expect(evidenceSummary({ quotes: [{ url: "u", quote: "Final: 3-1" }], reasoning: "r" })).toEqual({ quote: "Final: 3-1", reason: null });
    expect(evidenceSummary({ unverifiable: true, reason: "unverifiable by 13:00 ET" })).toEqual({ quote: null, reason: "unverifiable by 13:00 ET" });
    expect(evidenceSummary(null)).toEqual({ quote: null, reason: null });
    expect(evidenceSummary("junk")).toEqual({ quote: null, reason: null });
    expect(evidenceSummary({ quotes: "nope" })).toEqual({ quote: null, reason: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- resolution`
Expected: FAIL (`evidenceSummary` missing; re-resolve does not throw).

- [ ] **Step 3: Implement**

Replace `apps/api/src/resolution.ts`:

```ts
import { eq } from "drizzle-orm";
import { brier, questionPoints } from "@oracle/core";
import { schema, type Db } from "./db/client";

// Statuses a fresh resolution may write over. `open` is allowed because the
// admin path (and every test) resolves seeded open rounds directly; the
// pipeline always locks first. Anything already judged needs `force`.
const FRESH = new Set(["open", "locked"]);
const JUDGED = new Set(["resolved", "void"]);

export async function resolveQuestion(
  db: Db,
  questionId: string,
  outcome: "yes" | "no" | "void",
  evidence: unknown = null,
  opts: { force?: boolean } = {},
): Promise<void> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");
  const allowed = FRESH.has(q.status) || (opts.force === true && JUDGED.has(q.status));
  if (!allowed) throw new Error("not resolvable");

  const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  const yesCount = preds.filter((p) => p.answer).length;
  const crowdCount = preds.length;
  const crowdYesPct = crowdCount === 0 ? 50 : Math.round((100 * yesCount) / crowdCount);

  await db.update(schema.questions)
    .set({ outcome, status: outcome === "void" ? "void" : "resolved", resolvedAt: new Date(), crowdYesPct: String(crowdYesPct), crowdCount, resolutionEvidence: evidence })
    .where(eq(schema.questions.id, questionId));

  for (const p of preds) {
    const points = questionPoints({ answer: p.answer, confidence: p.confidence, outcome, isBigOne: q.isBigOne, crowdYesPct, crowdCount });
    const b = outcome === "void" ? null : String(brier({ answer: p.answer, confidence: p.confidence, outcome }));
    await db.update(schema.predictions).set({ points, brier: b }).where(eq(schema.predictions.id, p.id));
  }
}

// The reveal's receipt: one quote and/or one reason lifted from whatever
// shape the evidence JSON took (pipeline resolve, pipeline void, admin).
export function evidenceSummary(evidence: unknown): { quote: string | null; reason: string | null } {
  if (!evidence || typeof evidence !== "object") return { quote: null, reason: null };
  const e = evidence as Record<string, unknown>;
  let quote: string | null = null;
  if (Array.isArray(e.quotes)) {
    const first = e.quotes.find((x) => x && typeof x === "object" && typeof (x as Record<string, unknown>).quote === "string") as { quote: string } | undefined;
    quote = first?.quote ?? null;
  }
  const reason = typeof e.reason === "string" ? e.reason : null;
  return { quote, reason };
}
```

- [ ] **Step 4: Run the API suite**

Run: `pnpm --filter @oracle/api test`
Expected: PASS. If `pipeline-tick.test.ts` or `resolve-reveal.test.ts` re-resolve a question in a test, add `{ force: true }` there and say so in the commit body. `resolve-reveal.test.ts` "grades predictions with contrarian crowd math" asserts a ×2 value — update it to the additive ladder from Task 1 (a 1-vs-many seeded crowd is under the 20 floor, so the expected contrarian value is now the plain Brier points; add a comment saying the floor is what's being asserted).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/resolution.ts apps/api/test/resolution.test.ts apps/api/test/resolve-reveal.test.ts
git commit -m "fix(api): resolution is guarded by status, re-judged only with force, and stamps crowd_count"
```

---

### Task 8: One "complete round", truth recompute, first hour = all five

**Why:** "Complete" is `=== qs.length` in settle, `=== 5` in `completeRoundBriers`, `>= 5` in `me.ts` (audit §1.6). After a forced re-resolve the truth economy must be recomputable from scratch (audit §2.1). And the first-hour bonus currently pays a player who sealed one card early and four late (audit §3 minor 18) — make it "all five in the first hour", matching the new rites line.

**Files:**
- Modify: `apps/api/src/settlement.ts`
- Modify: `apps/api/src/routes/round.ts` (reveal `first_hour` only — the rest of the reveal is Plan 2)
- Test: `apps/api/test/settlement.test.ts`, `apps/api/test/reveal-first-hour.test.ts`

**Interfaces:**
- Produces: `completeRoundBriers(db, userId, settlingDate: string | null): Promise<number[]>` — "complete" = the user's prediction count for that round equals that round's question count (per-round map from `questions`); `settlingDate: null` means resolved rounds only.
- Produces: `recomputeTruth(db, userId): Promise<{ callsRated: number; oracleScore: number | null }>` — sets `users.calls_resolved = briers.length`, `users.oracle_score = oracleScore(briers)` from resolved rounds only.
- Produces: `resettleRound(db, date): Promise<{ users: number }>` — for a round with status `resolved`, `recomputeTruth` for every user with a prediction in it (streaks untouched: void/yes/no all count as played).
- Reveal: `first_hour = mine.length === qs.length && mine.every(p => p.firstHour)`.

- [ ] **Step 1: Failing tests**

Append to `settlement.test.ts`:

```ts
  it("a round with four questions still rates when all four are answered", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4] }]);
    await db.delete(schema.predictions).where(eq(schema.predictions.questionId, qs[4]!.id));
    await db.delete(schema.questions).where(eq(schema.questions.id, qs[4]!.id));
    await settleRound(db, "2026-08-20");
    expect((await db.query.users.findMany())[0]!.callsResolved).toBe(4);
  });

  it("recomputeTruth rebuilds calls_resolved and oracle_score after a forced re-resolve", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4, 5] }]);
    await settleRound(db, "2026-08-20");
    const before = (await db.query.users.findMany())[0]!;
    expect(before.callsResolved).toBe(5);
    // flip slot 1 to void → 4 rated calls
    await resolveQuestion(db, qs[0]!.id, "void", null, { force: true });
    const out = await resettleRound(db, "2026-08-20");
    expect(out.users).toBe(1);
    const after = (await db.query.users.findMany())[0]!;
    expect(after.callsResolved).toBe(4);
    expect(after.streakCurrent).toBe(before.streakCurrent);
  });
```

Add `resettleRound` to the settlement import. In `reveal-first-hour.test.ts`, extend the existing test: a player who seals slots 1–4 inside the first hour and slot 5 after it gets `first_hour: false`; a player who seals only slot 1 inside the hour also gets `false` (not all five). Read the file and follow its seeding pattern with `vi.setSystemTime` between submissions.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- settlement reveal-first-hour`
Expected: FAIL (`resettleRound` missing; four-question round rates 0; first-hour true).

- [ ] **Step 3: Implement**

In `settlement.ts`:

```ts
// ...settleRound: replace the complete-rounds block:
    // Complete-rounds rule: every question of the round answered → the round rates.
    if (byUser.get(u.id) === qs.length) {
      const briers = await completeRoundBriers(db, u.id, date);
      patch.callsResolved = briers.length;
      patch.oracleScore = oracleScore(briers);
    }
```

(Note: `callsResolved = briers.length` replaces `u.callsResolved + nonVoid` — identical when settlement is the only writer, and self-healing after a re-settle. Drop the now-unused `nonVoid` variable.)

Replace `completeRoundBriers`:

```ts
export async function completeRoundBriers(db: Db, userId: string, settlingDate: string | null): Promise<number[]> {
  const resolvedRounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "resolved") });
  const eligibleDates = new Set(resolvedRounds.map((r) => r.date));
  if (settlingDate) eligibleDates.add(settlingDate);

  const mine = await db
    .select({ brier: schema.predictions.brier, roundDate: schema.questions.roundDate, locksAt: schema.questions.locksAt, slot: schema.questions.slot })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(eq(schema.predictions.userId, userId));
  const answeredPerRound = new Map<string, number>();
  for (const r of mine) answeredPerRound.set(r.roundDate, (answeredPerRound.get(r.roundDate) ?? 0) + 1);

  // One definition of "complete": answered every question that round asked.
  const dates = [...answeredPerRound.keys()];
  const sizes = dates.length
    ? await db.select({ roundDate: schema.questions.roundDate, n: count() }).from(schema.questions).where(inArray(schema.questions.roundDate, dates)).groupBy(schema.questions.roundDate)
    : [];
  const questionsPerRound = new Map(sizes.map((s) => [s.roundDate, Number(s.n)]));

  return mine
    .filter((r) => r.brier !== null && eligibleDates.has(r.roundDate) && answeredPerRound.get(r.roundDate) === questionsPerRound.get(r.roundDate))
    .sort((x, y) => x.locksAt.getTime() - y.locksAt.getTime() || x.slot - y.slot)
    .map((r) => Number(r.brier));
}

// Rebuild one user's truth economy from the ledger itself (resolved rounds
// only). Used after a forced re-resolve; never touches streaks.
export async function recomputeTruth(db: Db, userId: string): Promise<{ callsRated: number; oracleScore: number | null }> {
  const briers = await completeRoundBriers(db, userId, null);
  const out = { callsRated: briers.length, oracleScore: oracleScore(briers) };
  await db.update(schema.users).set({ callsResolved: out.callsRated, oracleScore: out.oracleScore }).where(eq(schema.users.id, userId));
  return out;
}

export async function resettleRound(db: Db, date: string): Promise<{ users: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) throw new Error("unknown round");
  if (round.status !== "resolved") return { users: 0 }; // an unsettled round will settle normally
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const preds = qs.length ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) }) : [];
  const userIds = [...new Set(preds.map((p) => p.userId))];
  for (const id of userIds) await recomputeTruth(db, id);
  return { users: userIds.length };
}
```

Add `count` to the drizzle-orm import. In `round.ts` reveal: `const allFirstHour = mine.length === qs.length && mine.every((p) => p.firstHour);`

- [ ] **Step 4: Run the API suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: PASS. The existing "oracle score only counts fully resolved rounds" test still passes (eligibility unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/settlement.ts apps/api/src/routes/round.ts apps/api/test/settlement.test.ts apps/api/test/reveal-first-hour.test.ts
git commit -m "fix(api): one definition of a complete round, truth recompute after re-judging, first hour means all five"
```

---

### Task 9: Admin `force` + Telegram `/flip`

**Why:** With the guard in place, the operator needs the one sanctioned way to correct an outcome — and the day report already says "reply if any outcome looks wrong" with nothing to act on (audit §2.1, §2.5).

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/telegram.ts`
- Test: `apps/api/test/admin-rounds.test.ts`, `apps/api/test/telegram-webhook.test.ts`

**Interfaces:**
- Admin `POST /admin/questions/:id/resolve` body: `{ outcome, evidence?, force?: boolean }`; 409 `{ error: "not resolvable" }`; with `force` on a settled round it also calls `resettleRound` and returns `{ ok: true, rescored: n }`.
- Telegram: `parseCommand` gains `{ cmd: "flip"; slot: number; outcome: "yes" | "no" | "void" }` for `/flip <1-5> <yes|no|void>`; target = the locked-unsettled round if any, else the most recent `resolved` round; replies `flipped slot N of DATE → YES · rescored M users` (M = 0 when the round wasn't settled yet).

- [ ] **Step 1: Failing tests**

`admin-rounds.test.ts` — append (follow the file's admin-header helper):

```ts
  it("resolve refuses a judged question without force, re-judges with it, and rescores a settled round", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-27T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-27", opensAt: new Date("2026-08-27T16:00:00Z"), locksAt: new Date("2026-08-28T16:00:00Z") });
    const admin = (path: string, body: unknown) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-admin-secret": "admin" }, body: JSON.stringify(body) });
    expect((await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "yes" })).status).toBe(200);
    expect((await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "no" })).status).toBe(409);
    const forced = await admin(`/admin/questions/${qs[0]!.id}/resolve`, { outcome: "no", force: true });
    expect(forced.status).toBe(200);
    expect(await forced.json()).toEqual({ ok: true, rescored: 0 }); // round not settled yet
  });
```

`telegram-webhook.test.ts` — in the `parseCommand` describe:

```ts
  it("parses /flip <slot> <outcome>", () => {
    expect(parseCommand("/flip 3 no")).toEqual({ cmd: "flip", slot: 3, outcome: "no" });
    expect(parseCommand("/flip 5 VOID")).toEqual({ cmd: "flip", slot: 5, outcome: "void" });
    expect(parseCommand("/flip 3")).toEqual({ cmd: "help" });
    expect(parseCommand("/flip 9 yes")).toEqual({ cmd: "help" });
    expect(parseCommand("/flip 3 maybe")).toEqual({ cmd: "help" });
  });
```

and in the webhook describe (mirror the `/reroll` test's harness — a pipeline with a recording telegram `send`):

```ts
  it("/flip re-judges a slot of the latest round and reports the rescore", async () => {
    // seed an open round, resolve all five yes, settle → resolved
    // POST /flip 1 no → expect last send toMatch(/flipped slot 1 of 2026-08-2\d → NO · rescored \d+ users/)
    // and the question's outcome is now "no"
  });
```

Write the body out fully using the file's existing helpers (`makeTestDb`, `seedRound`, `resolveQuestion`, `settleRound`, and the update-body builder the `/reroll` tests use).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- admin-rounds telegram-webhook`
Expected: FAIL.

- [ ] **Step 3: Implement**

`admin.ts`:

```ts
const ResolveSchema = z.object({ outcome: z.enum(["yes", "no", "void"]), evidence: z.unknown().optional(), force: z.boolean().optional() });
// ...
  .post("/questions/:id/resolve", async (c) => {
    const parsed = ResolveSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    const db = c.get("deps").db;
    try {
      await resolveQuestion(db, c.req.param("id"), parsed.data.outcome, parsed.data.evidence ?? null, { force: parsed.data.force === true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "resolve failed";
      if (msg === "not resolvable") return c.json({ error: msg }, 409);
      if (msg === "question not found") return c.json({ error: msg }, 404);
      return c.json({ error: "resolve failed" }, 500);
    }
    let rescored = 0;
    if (parsed.data.force) {
      const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, c.req.param("id")) });
      if (q) rescored = (await resettleRound(db, q.roundDate)).users;
    }
    return c.json({ ok: true, rescored });
  })
```

Import `resettleRound` from `../settlement`.

`telegram.ts`:

```ts
export type Command =
  | { cmd: "reroll"; slot: number; guidance: string }
  | { cmd: "flip"; slot: number; outcome: "yes" | "no" | "void" }
  | { cmd: "status" }
  | { cmd: "help" };

// in parseCommand, before `return { cmd: "help" }`:
  if (head === "/flip") {
    const slot = Number(parts[1]);
    const outcome = (parts[2] ?? "").toLowerCase();
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) return { cmd: "help" };
    if (outcome !== "yes" && outcome !== "no" && outcome !== "void") return { cmd: "help" };
    return { cmd: "flip", slot, outcome };
  }

const HELP_TEXT = "/reroll <slot> [guidance] · /flip <slot> <yes|no|void> · /status";

// in the switch:
      case "flip": {
        const state = await loadPipelineState(pipeline.db, pipeline.now());
        const date = state.lockedRound?.date
          ?? (await pipeline.db.query.rounds.findFirst({ where: eq(schema.rounds.status, "resolved"), orderBy: (r, { desc }) => [desc(r.date)] }))?.date;
        if (!date) { await send("no round to flip"); break; }
        const q = await pipeline.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, command.slot)) });
        if (!q) { await send(`no slot ${command.slot} on ${date}`); break; }
        await resolveQuestion(pipeline.db, q.id, command.outcome, { flipped_by: "telegram", checked_at: pipeline.now().toISOString() }, { force: true });
        const { users } = await resettleRound(pipeline.db, date);
        await send(`flipped slot ${command.slot} of ${date} → ${command.outcome.toUpperCase()} · rescored ${users} users`);
        break;
      }
```

Imports: `and, eq` from drizzle-orm, `schema` from `../db/client`, `resolveQuestion` from `../resolution`, `resettleRound` from `../settlement`.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/telegram.ts apps/api/test/admin-rounds.test.ts apps/api/test/telegram-webhook.test.ts
git commit -m "feat(api): /flip and admin force — the one sanctioned way to correct a judged outcome, with rescoring"
```

---

### Task 10: Ledger — honest counts, ET month, crowd-aware tide wins

**Why:** `me.ts` judges tide wins without the crowd floor, uses a `>= 5` complete-round test, computes the free-shield month in UTC (audit §1.6 minor), and doesn't expose the two counts the plaque needs (`calls_rated` for "37 OF 50", `calls_answered` for the verdict's receipt).

**Files:**
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/test/ledger.test.ts`

**Interfaces:**
- Consumes: `contrarianApplies` (Task 1), `schema.questions.crowdCount` (Task 6), `EpithetInput.resolvedCalls` (Task 3), `MeLedgerSchema` (Task 5).
- Produces: response fields `calls_rated` (= `users.calls_resolved`), `calls_answered` (resolved non-void rows, lifetime); `tide_wins` now requires `crowd_count ≥ 20`; `free_shield_available` keyed on the current month **in America/New_York**; epithet `completeRounds` = rounds where the user's count equals the round's question count.

- [ ] **Step 1: Failing tests**

Update `ledger.test.ts` "computes stats and a tide win…": its seeded crowd is tiny, so the assertion must become `tide_wins: 0` with a comment naming the floor, and add a second scenario that seeds ≥20 players (loop minting 20 tokens, all NO, the caller YES, outcome yes) asserting `tide_wins: 1`. Also assert `calls_rated` and `calls_answered` appear as integers. Add:

```ts
  it("exposes calls_rated (score-feeding) and calls_answered (all resolved)", async () => {
    // one player answers slots 1..3 of a 5-question round, all resolved yes, round settled
    // expect calls_answered 3 and calls_rated 0 (incomplete round does not rate)
  });
```

Write the body with the file's existing helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- ledger`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `me.ts`:

```ts
import { assignEpithet, contrarianApplies } from "@oracle/core";
// Row gains crowdCount
    interface Row { correct: boolean; confidence: number; sidePct: number | null; crowdCount: number; inWindow: boolean }
// when building rows:
        crowdCount: q.crowdCount ?? 0,
// in stats():
        tideWins: rows.filter((r) => r.correct && r.sidePct !== null && contrarianApplies(r.sidePct, r.crowdCount)).length,
// complete rounds: one definition
    const questionsPerRound = new Map<string, number>();
    for (const q of qs) questionsPerRound.set(q.roundDate, (questionsPerRound.get(q.roundDate) ?? 0) + 1);
    // ^ NOTE: `qs` only holds questions the user answered; fetch the true per-round sizes:
    const roundDates = [...byDate.keys()];
    const sizes = roundDates.length
      ? await db.select({ roundDate: schema.questions.roundDate, n: count() }).from(schema.questions).where(inArray(schema.questions.roundDate, roundDates)).groupBy(schema.questions.roundDate)
      : [];
    const sizeOf = new Map(sizes.map((s) => [s.roundDate, Number(s.n)]));
    const completeRounds = [...byDate.entries()].filter(([date, n]) => {
      const anyQ = qs.find((q) => q.roundDate === date);
      return n === sizeOf.get(date) && anyQ !== undefined && anyQ.locksAt.getTime() >= windowStart;
    }).length;
// epithet input:
      resolvedCalls: resolved.filter((r) => r.inWindow).length,
// ET month helper (top of file):
const etMonth = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).format(d); // "2026-08"
// response:
      calls_rated: user?.callsResolved ?? 0,
      calls_answered: resolved.length,
      free_shield_available: (() => {
        const usedAt = user?.freeShieldUsedAt ?? null;
        return usedAt === null || usedAt.slice(0, 7) !== etMonth(new Date());
      })(),
```

Remove the first (wrong) `questionsPerRound` lines — keep only the `sizes`/`sizeOf` version. Add `count` to the drizzle import.

- [ ] **Step 4: Run the suite**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/test/ledger.test.ts
git commit -m "fix(api): ledger counts are honest — crowd-floored tide wins, one complete-round rule, ET month, rated vs answered calls"
```

---

### Task 11: Mobile call-site alignment (compile-only)

**Why:** `crowdVerdict` must consume `contrarianApplies` so the gold promise on the card footer is never false under the crowd floor; everything else in the app that referenced the ×2 must stop saying ×2. No new UX here — Plan 3 owns behaviour.

**Files:**
- Modify: `apps/mobile/src/game/crowdVerdict.ts`, `apps/mobile/test/crowdVerdict.test.ts`
- Modify: `apps/mobile/src/app/round.tsx` (two `crowdVerdict` calls gain `c.player_count`)
- Modify: `apps/mobile/src/ui/CrowdReveal.tsx` (gold `AGAINST THE TIDE` uses `contrarianApplies(mySidePct, c.player_count)`)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (`contrarianWin` uses the reveal's `crowd_count`? — not in the schema; use `(big.my.points ?? 0) > payoff(big.my.confidence, true).win` i.e. "paid more than the plain win" which is true iff the bonus applied; label `AGAINST THE TIDE` + `+40` instead of `×2`)

**Interfaces:**
- Produces: `crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number): { line: string; against: boolean }` — `playerCount < 5` → `{ line: "THE CROWD IS STILL GATHERING", against: false }`; else tide word as before, `against = contrarianApplies(sidePct, playerCount)`.

- [ ] **Step 1: Update the verdict tests**

Rewrite `crowdVerdict.test.ts` calls to pass a third argument `50` for the existing cases; add:

```ts
  it("holds its tongue under five players", () => {
    expect(crowdVerdict(true, 0, 1)).toEqual({ line: "THE CROWD IS STILL GATHERING", against: false });
    expect(crowdVerdict(true, 25, 4)).toEqual({ line: "THE CROWD IS STILL GATHERING", against: false });
  });
  it("names the tide from five players but promises the bounty only from twenty", () => {
    expect(crowdVerdict(true, 30, 5)).toEqual({ line: "30% SAY YES · AGAINST THE TIDE", against: false });
    expect(crowdVerdict(true, 30, 20)).toEqual({ line: "30% SAY YES · AGAINST THE TIDE", against: true });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- crowdVerdict`
Expected: FAIL.

- [ ] **Step 3: Implement**

`crowdVerdict.ts`:

```ts
import { contrarianApplies } from "@oracle/core";

export const VERDICT_MIN_PLAYERS = 5;

export function crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number): { line: string; against: boolean } {
  if (playerCount < VERDICT_MIN_PLAYERS) return { line: "THE CROWD IS STILL GATHERING", against: false };
  const sidePct = answer ? crowdYesPct : 100 - crowdYesPct;
  const tide = sidePct < 40 ? "AGAINST THE TIDE" : sidePct >= 60 ? "WITH THE TIDE" : "THE CROWD SPLITS";
  // Gold only when the bounty can truly pay: the engine's own rule, crowd floor included.
  return { line: `${crowdYesPct}% SAY YES · ${tide}`, against: contrarianApplies(sidePct, playerCount) };
}
```

`round.tsx`: both `crowdVerdict(entry.answer, c.crowd_yes_pct)` → `crowdVerdict(entry.answer, c.crowd_yes_pct, c.player_count)` and `crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct)` → `crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct, lastCrowd.player_count)`.

`CrowdReveal.tsx`: import `contrarianApplies` from `@oracle/core`; `const against = contrarianApplies(mySidePct, c.player_count);` and use `against` for both the color and the ` · AGAINST THE TIDE` suffix.

`reveal/[date].tsx`: import `payoff` from `@oracle/core`; replace both `contrarianWin`/`tide` computations with `const contrarianWin = !!big?.my && (big.my.points ?? 0) > payoff(big.my.confidence, true).win;` (and the same for `tide` inside the effect). Replace the `×2` Ritual with `+40`.

- [ ] **Step 4: Run mobile tests + full typecheck**

Run: `pnpm --filter @oracle/mobile test && pnpm -r typecheck`
Expected: PASS everywhere.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/crowdVerdict.ts apps/mobile/test/crowdVerdict.test.ts apps/mobile/src/app/round.tsx apps/mobile/src/ui/CrowdReveal.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "fix(mobile): the card's gold promise obeys the crowd floor; the big one says +40, not ×2"
```

---

## Self-review

- **Spec coverage:** audit §1.1 (Task 1), §1.2 (Tasks 1, 7, 10, 11), §1.3 ✅ unchanged, §1.4 ✅ unchanged, §1.5 (Task 3), §1.6 shield/complete-round/first-hour/month (Tasks 2, 8, 10), §2.1 (Tasks 7, 8, 9), copy truth (Task 4), contracts for later plans (Task 5), migration workflow + indexes (Task 6). Audit §1.6's Oracle-Score display scale and points accumulator are deliberately deferred (need a leaderboard to mean anything).
- **Type consistency:** `questionPoints` gains `crowdCount` (Task 1) → used in Task 7 and 11's `payoff`; `contrarianApplies(sidePct, crowdCount)` used in Tasks 10, 11; `completeRoundBriers(db, userId, settlingDate | null)` in Task 8 only; `resettleRound` in Tasks 8, 9; `calibrationVerdict(avg, acc, resolvedCalls)` Task 3 → mobile passes `0` until Plan 3 uses `calls_answered` (Task 5 field); `EpithetInput.resolvedCalls` Task 3 → Task 10.
- **Placeholders:** Task 9's `/flip` webhook test and Task 10's second ledger test are described rather than fully written because they must reuse harness helpers defined in those files (`makeUpdate`, recording telegram, `player`) — the executor reads the file and writes them in that style; the assertions are stated exactly.
