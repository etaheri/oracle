# The House — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A version 3 round that is dealt from Kalshi and Polymarket markets, carries a committed Oracle line on every card, takes stakes from a player's fortune at seal, settles from the exchange, and pays the fortune, end to end through the API.

**Architecture:** Pure fortune arithmetic lives in `@oracle/core` beside the existing scoring. The nightly pipeline gains an exchange-fed authoring path (`pipeline/exchanges/*`, `pipeline/market-round.ts`) that writes a version 3 draft through the existing `upsertDraft`, and a line commit (`pipeline/line.ts`) that derives `questions.line_p_yes` from the existing forecast commit. Settlement gains an exchange reader in place of the model resolver for market-backed questions and a fortune pass that pays each prediction exactly once. Routes carry the line, the stake and the fortune. The Council, evidence packs, memory, the standings page and every mobile change are separate plans that build on the signatures fixed here.

**Tech Stack:** TypeScript, pnpm workspaces, Hono on Cloudflare Workers with Workflows, Drizzle ORM on Neon Postgres (PGlite in tests), Zod, Vitest, Anthropic SDK via the existing `claude.ts` client.

**Spec:** `docs/superpowers/specs/2026-09-10-the-house-design.md` — sections 4, 5, 6, 7 and 11. Sections 13 and 14 (Council, memory, evidence) and section 8 (mobile) are out of this plan.

## Global Constraints

- `FORTUNE_FOUNDING = 1000`, `STAKE_FRACTION_MAX = 0.10`, `LINE_MARKET_BAND = 0.15`, `LINE_MIN = 0.05`, `LINE_MAX = 0.95`, `HOUSE_FOUNDING = 0` (spec §4.1). Values marked ⚙ in the spec are tunable but these are the shipped defaults.
- Confidence grid is unchanged: `CONFIDENCE_MIN = 55`, `CONFIDENCE_MAX = 95`, `CONFIDENCE_STEP = 5`.
- Stake is computed from the fortune at the instant of the seal and frozen on the prediction; nothing is debited at seal (spec §4.2).
- Fortune changes only at settlement, and each prediction is paid at most once (spec §5.6).
- Fortune carries no vigil, first-hour or contrarian multiplier; the Big One doubles the stake fraction only (spec D8).
- Fortune is never sold, granted or protected by Oracle Plus (spec D7). No task in any plan may add a path that writes `users.fortune` outside settlement.
- Eligibility window: market close in `[lock + 2h, lock + 30h]`, price in `[0.20, 0.80]`, volume ≥ 5000, one market per event, no "Spread" or "O/U" titles (spec §5.2).
- Fewer than five eligible candidates publishes a bank round with an alert; no hybrid rounds (spec D9).
- Rounds at `rulesVersion` 3 use this design; versions 1 and 2 are untouched. `CURRENT_RULES_VERSION` becomes 3.
- The nightly market authoring runs once, at 17:00 ET. No hourly retry.
- Every network read of an exchange goes through an injectable `fetch` (`deps.sourceFetch ?? fetch`); tests never touch the network.
- Copy follows the Outsee register: ordinary words for actions and numbers. Telegram narration lines in this plan are plain.
- The next migration number is `0014` (the repo is at `0013_aromatic_rogue.sql`; the spec's "0010" is superseded).
- Commit after every task with the trailer `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/core/src/fortune.ts` (create) | Constants and pure functions: `stakeFraction`, `stake`, `odds`, `payout`, `delta`, `clampLine`, `dayReturn`, `stakePreview`. No I/O. |
| `packages/core/test/fortune.test.ts` (create) | Ladder, payout, clamp, return, negative controls. |
| `packages/core/src/roundRules.ts` (modify) | `CURRENT_RULES_VERSION = 3`. |
| `packages/core/src/schemas.ts` (modify) | Optional `line_p_yes`, `market_prob`, `stake`, `payout`, `delta`, `fortune`, `house` fields on the round, reveal, board and ledger schemas. |
| `packages/core/src/index.ts` (modify) | Export `fortune`. |
| `apps/api/src/db/schema.ts` (modify) | New columns from spec §6 on `users`, `predictions`, `questions`, `rounds`, `userRounds`. |
| `apps/api/drizzle/0014_*.sql` (generate) | The migration. |
| `apps/api/src/pipeline/exchanges/types.ts` (create) | `MarketCandidate`, `ExchangeFeed`, `SettlementRead`. |
| `apps/api/src/pipeline/exchanges/kalshi.ts` (create) | Kalshi list + read + category map. |
| `apps/api/src/pipeline/exchanges/polymarket.ts` (create) | Polymarket list + read + category map. |
| `apps/api/src/pipeline/exchanges/select.ts` (create) | Eligibility window, one-per-event, greedy spread, Big One. Pure. |
| `apps/api/src/pipeline/voice.ts` (create) | One structured call: five titles + rules → five `text` + `context`. |
| `apps/api/src/pipeline/market-round.ts` (create) | Orchestrates fetch → select → voice → taste → `upsertDraft(…, 3)`; narrates; returns a result value. |
| `apps/api/src/pipeline/line.ts` (create) | `commitLine`: clamp `oracle_p_yes` to the market band, write `questions.line_p_yes`. |
| `apps/api/src/pipeline/state.ts` (modify) | `author` fires once at 17:00 for v3; `probe` never fires for a v3 open round. |
| `apps/api/src/pipeline/index.ts` (modify) | `author` action routes to `market-round` for v3; `forecast` action calls `commitLine` after the existing stamp. |
| `apps/api/src/pipeline/resolve.ts` (modify) | Market-backed question → exchange read instead of `askResolver`. |
| `apps/api/src/settlement.ts` (modify) | Fortune pass: stake/payout/delta per prediction, `users.fortune`, `rounds.house_delta`. |
| `apps/api/src/routes/predictions.ts` (modify) | Compute and store `fortune_at_seal`, `stake`, `line_p_yes`; write `user_rounds.fortune_at_open` on first seal; reject a stake on a lineless v3 question. |
| `apps/api/src/routes/round.ts` (modify) | `/today` carries `line_p_yes`, `fortune`, `house`; `/reveal` carries stake, payout, delta, line, market price, round delta, return, fortune after, house delta; `/board` gains return ranking and an all-time mode. |
| `apps/api/src/routes/me.ts` (modify) | `fortune` and `fortune_history` on the ledger. |
| `apps/api/src/routes/admin.ts` (modify) | `POST /rounds/:date/author` runs market authoring for v3; `POST /rounds/:date/line` commits the line. |
| `apps/api/test/fixtures/exchanges/*.json` (create) | Recorded Kalshi and Polymarket responses, captured 2026-09-10. |
| `apps/api/test/exchanges-*.test.ts`, `market-round.test.ts`, `line.test.ts`, `settlement-fortune.test.ts`, `predictions-stake.test.ts`, `round-v3.test.ts` (create) | Per task. |

---

### Task 1: Fortune arithmetic in core

**Files:**
- Create: `packages/core/src/fortune.ts`
- Create: `packages/core/test/fortune.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./fortune";`)

**Interfaces:**
- Consumes: `CONSTANTS.CONFIDENCE_MIN/MAX/STEP` from `packages/core/src/constants.ts`.
- Produces:
  ```ts
  export const FORTUNE = { FOUNDING: 1000, STAKE_FRACTION_MAX: 0.10, LINE_MARKET_BAND: 0.15, LINE_MIN: 0.05, LINE_MAX: 0.95, HOUSE_FOUNDING: 0, FLOOR_FROM: 10 } as const;
  export function stakeFraction(confidence: number, isBigOne: boolean): number;
  export function stake(fortune: number, confidence: number, isBigOne: boolean): number;
  export function odds(answer: boolean, line: number): number;
  export function payout(input: { stake: number; answer: boolean; line: number; outcome: "yes" | "no" | "void" }): number;
  export function delta(input: { stake: number; answer: boolean; line: number; outcome: "yes" | "no" | "void" }): number;
  export function clampLine(oracleP: number, marketP: number | null): number;
  export function dayReturn(deltas: number[], fortuneAtOpen: number): number;
  export function stakePreview(input: { fortune: number; confidence: number; isBigOne: boolean; line: number; answer: boolean }): { stake: number; pays: number };
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/fortune.test.ts
import { describe, it, expect } from "vitest";
import {
  FORTUNE, stakeFraction, stake, odds, payout, delta, clampLine, dayReturn, stakePreview,
} from "../src/fortune";

describe("stakeFraction", () => {
  // ((c − 50) / 50) × 0.10 → 55: 0.01, 75: 0.05, 95: 0.09; Big One doubles.
  it("runs 1% to 9% across the grid", () => {
    expect(stakeFraction(55, false)).toBeCloseTo(0.01, 10);
    expect(stakeFraction(75, false)).toBeCloseTo(0.05, 10);
    expect(stakeFraction(95, false)).toBeCloseTo(0.09, 10);
  });
  it("doubles for the Big One", () => {
    expect(stakeFraction(95, true)).toBeCloseTo(0.18, 10);
  });
  it("throws off-grid", () => {
    expect(() => stakeFraction(50, false)).toThrow();
    expect(() => stakeFraction(96, false)).toThrow();
    expect(() => stakeFraction(72, false)).toThrow();
  });
});

describe("stake", () => {
  it("is fortune × fraction, rounded, floor 1 from a fortune of 10", () => {
    expect(stake(1000, 55, false)).toBe(10);
    expect(stake(1000, 95, false)).toBe(90);
    expect(stake(1000, 95, true)).toBe(180);
    expect(stake(10, 55, false)).toBe(1);  // round(0.1) = 0 → floor 1
  });
  it("stakes zero rather than the floor when the fortune is under 10", () => {
    expect(stake(7, 55, false)).toBe(0);
    expect(stake(9, 95, true)).toBe(2);    // round(1.62)
    expect(stake(1, 95, true)).toBe(0);
  });
});

describe("odds", () => {
  it("YES pays (1 − line)/line, NO pays line/(1 − line)", () => {
    expect(odds(true, 0.35)).toBeCloseTo(0.65 / 0.35, 10);
    expect(odds(false, 0.35)).toBeCloseTo(0.35 / 0.65, 10);
    expect(odds(true, 0.5)).toBeCloseTo(1, 10);
  });
});

describe("payout and delta", () => {
  const yesAt35 = { stake: 100, answer: true, line: 0.35 };
  it("right call returns stake plus stake × odds, rounded", () => {
    expect(payout({ ...yesAt35, outcome: "yes" })).toBe(286); // 100 + round(185.71)
    expect(delta({ ...yesAt35, outcome: "yes" })).toBe(186);
  });
  it("wrong call loses the stake", () => {
    expect(payout({ ...yesAt35, outcome: "no" })).toBe(0);
    expect(delta({ ...yesAt35, outcome: "no" })).toBe(-100);
  });
  it("void returns the stake", () => {
    expect(payout({ ...yesAt35, outcome: "void" })).toBe(100);
    expect(delta({ ...yesAt35, outcome: "void" })).toBe(0);
  });
  it("NO at the same line pays less", () => {
    expect(payout({ stake: 100, answer: false, line: 0.35, outcome: "no" })).toBe(154); // 100 + round(53.85)
  });
  it("at the clamp bounds the largest multiple is 19", () => {
    expect(delta({ stake: 100, answer: true, line: 0.05, outcome: "yes" })).toBe(1900);
    expect(delta({ stake: 100, answer: false, line: 0.95, outcome: "no" })).toBe(1900);
  });
});

describe("clampLine", () => {
  it("keeps a line inside the market band", () => {
    expect(clampLine(0.40, 0.35)).toBeCloseTo(0.40, 10);
    expect(clampLine(0.10, 0.35)).toBeCloseTo(0.20, 10); // band floor 0.35 − 0.15
    expect(clampLine(0.70, 0.35)).toBeCloseTo(0.50, 10); // band ceiling
  });
  it("never leaves [LINE_MIN, LINE_MAX] even when the band would", () => {
    expect(clampLine(0.01, 0.10)).toBeCloseTo(FORTUNE.LINE_MIN, 10);
    expect(clampLine(0.99, 0.90)).toBeCloseTo(FORTUNE.LINE_MAX, 10);
  });
  it("with no market price clamps to [LINE_MIN, LINE_MAX] only", () => {
    expect(clampLine(0.02, null)).toBeCloseTo(FORTUNE.LINE_MIN, 10);
    expect(clampLine(0.60, null)).toBeCloseTo(0.60, 10);
  });
});

describe("dayReturn", () => {
  it("is Σ delta over fortune at open", () => {
    expect(dayReturn([186, -100, 0], 1000)).toBeCloseTo(0.086, 10);
  });
  it("is 0 with no deltas and never divides by zero", () => {
    expect(dayReturn([], 1000)).toBe(0);
    expect(dayReturn([50], 0)).toBe(0);
  });
});

describe("stakePreview", () => {
  it("returns the stake and what a right call pays on top", () => {
    expect(stakePreview({ fortune: 1000, confidence: 70, isBigOne: false, line: 0.35, answer: true }))
      .toEqual({ stake: 40, pays: 74 }); // round(40 × 1.857)
  });
});

describe("fortune never reaches zero (negative control)", () => {
  const worstRound = (f: number) =>
    [95, 95, 95, 95].map((c) => stake(f, c, false)).concat([stake(f, 95, true)]).reduce((a, s) => a + s, 0);
  it("a fully wrong, fully confident round loses 54% of 1000", () => {
    expect(worstRound(1000)).toBe(540);
  });
  it("from any fortune ≥ 1, one round cannot take it to zero", () => {
    for (const f of [1, 2, 5, 9, 10, 11, 100, 1000]) {
      expect(f - worstRound(f)).toBeGreaterThan(0);
    }
  });
});
```

The floor rule is why the last test holds: from a fortune of 10 upward every stake is at least 1, but under 10 the floor is dropped, so five stakes can never sum to the whole fortune.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/core test -- fortune`
Expected: FAIL with "Cannot find module '../src/fortune'".

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/fortune.ts
// Fortune arithmetic (design 2026-09-10 §4). Pure, no I/O, integer fortune.
import { CONSTANTS as C } from "./constants";

export const FORTUNE = {
  FOUNDING: 1000,
  STAKE_FRACTION_MAX: 0.10,   // ⚙ fraction of fortune at confidence 100
  LINE_MARKET_BAND: 0.15,     // ⚙ the line may sit this far from the market price
  LINE_MIN: 0.05,
  LINE_MAX: 0.95,
  HOUSE_FOUNDING: 0,
  // Under this fortune the per-stake floor of 1 is dropped, so five stakes can
  // never sum to the whole fortune. This is what makes "never reaches zero" true.
  FLOOR_FROM: 10,
} as const;

export type Outcome = "yes" | "no" | "void";

function assertOnGrid(confidence: number): void {
  const ok =
    Number.isInteger(confidence) &&
    confidence >= C.CONFIDENCE_MIN &&
    confidence <= C.CONFIDENCE_MAX &&
    (confidence - C.CONFIDENCE_MIN) % C.CONFIDENCE_STEP === 0;
  if (!ok) throw new Error(`fortune: confidence ${confidence} is off the grid`);
}

/** ((c − 50) / 50) × STAKE_FRACTION_MAX, doubled for the Big One. */
export function stakeFraction(confidence: number, isBigOne: boolean): number {
  assertOnGrid(confidence);
  return ((confidence - 50) / 50) * FORTUNE.STAKE_FRACTION_MAX * (isBigOne ? 2 : 1);
}

/** The stake frozen at seal. Floor 1 from FLOOR_FROM upward; below, a zero stake is a valid unpaid call. */
export function stake(fortune: number, confidence: number, isBigOne: boolean): number {
  const raw = Math.round(fortune * stakeFraction(confidence, isBigOne));
  if (fortune >= FORTUNE.FLOOR_FROM) return Math.max(1, raw);
  return Math.max(0, raw);
}

/** What a right call pays per unit staked, on top of the stake. */
export function odds(answer: boolean, line: number): number {
  return answer ? (1 - line) / line : line / (1 - line);
}

export function payout(input: { stake: number; answer: boolean; line: number; outcome: Outcome }): number {
  if (input.outcome === "void") return input.stake;
  const won = (input.outcome === "yes") === input.answer;
  if (!won) return 0;
  return input.stake + Math.round(input.stake * odds(input.answer, input.line));
}

export function delta(input: { stake: number; answer: boolean; line: number; outcome: Outcome }): number {
  return payout(input) - input.stake;
}

/** The house line: the Oracle's probability held inside the market band and the absolute bounds. */
export function clampLine(oracleP: number, marketP: number | null): number {
  let lo = FORTUNE.LINE_MIN;
  let hi = FORTUNE.LINE_MAX;
  if (marketP !== null) {
    lo = Math.max(lo, marketP - FORTUNE.LINE_MARKET_BAND);
    hi = Math.min(hi, marketP + FORTUNE.LINE_MARKET_BAND);
  }
  return Math.min(hi, Math.max(lo, oracleP));
}

/** Σ delta / fortune at the first seal. 0 when there is nothing to divide. */
export function dayReturn(deltas: number[], fortuneAtOpen: number): number {
  if (fortuneAtOpen <= 0 || deltas.length === 0) return 0;
  return deltas.reduce((a, b) => a + b, 0) / fortuneAtOpen;
}

/** The card's readout: this stake, and what a right call pays on top of it. */
export function stakePreview(input: { fortune: number; confidence: number; isBigOne: boolean; line: number; answer: boolean }): { stake: number; pays: number } {
  const s = stake(input.fortune, input.confidence, input.isBigOne);
  return { stake: s, pays: Math.round(s * odds(input.answer, input.line)) };
}
```

Add to `packages/core/src/index.ts`:
```ts
export * from "./fortune";
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/core test -- fortune`
Expected: PASS, all describe blocks green. Then `pnpm --filter @oracle/core typecheck` (or the workspace `pnpm typecheck`) passes.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fortune.ts packages/core/test/fortune.test.ts packages/core/src/index.ts
git commit -m "feat(core): fortune arithmetic — stake ladder, odds, payout, line clamp

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

### Task 2: Rules version 3 and the response schemas

**Files:**
- Modify: `packages/core/src/roundRules.ts`
- Modify: `packages/core/src/schemas.ts` (`RoundTodaySchema`, `RevealSchema`, `RoundBoardSchema`, `MeLedgerSchema`, `SubmitResSchema`)
- Test: `packages/core/test/roundRules.test.ts` (create), `packages/core/test/schemas-v3.test.ts` (create)

**Interfaces:**
- Produces: `CURRENT_RULES_VERSION = 3`; `ratingEligible(3, …)` behaves exactly as version 2; every schema below accepts the new optional fields and still parses today's payloads unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/roundRules.test.ts
import { describe, it, expect } from "vitest";
import { CURRENT_RULES_VERSION, ratingEligible } from "../src/roundRules";

describe("rules version 3", () => {
  it("is current", () => {
    expect(CURRENT_RULES_VERSION).toBe(3);
  });
  it("rates like version 2: every non-void answered, at least three scored", () => {
    const qs = [
      { id: "a", outcome: "yes" as const }, { id: "b", outcome: "no" as const }, { id: "c", outcome: "void" as const },
      { id: "d", outcome: "yes" as const }, { id: "e", outcome: "no" as const },
    ];
    expect(ratingEligible(3, qs, new Set(["a", "b", "d", "e"]))).toBe(true);
    expect(ratingEligible(3, qs, new Set(["a", "b", "d"]))).toBe(false);
    expect(ratingEligible(3, qs.map(q => ({ ...q, outcome: "void" as const })), new Set())).toBe(false);
  });
});
```

```ts
// packages/core/test/schemas-v3.test.ts
import { describe, it, expect } from "vitest";
import { RoundTodaySchema, RevealSchema, RoundBoardSchema, MeLedgerSchema, SubmitResSchema } from "../src/schemas";

const q = {
  id: "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e", slot: 1, is_big_one: false, text: "Will it rain?", category: "weather",
  source_name: "Kalshi", resolution_criteria: "rules", locks_at: "2026-09-11T16:00:00.000Z", lock_healed: false,
};

describe("v3 response fields are optional and typed", () => {
  it("RoundToday accepts rules_version 3, line_p_yes, fortune and house", () => {
    const r = RoundTodaySchema.parse({
      rules_version: 3, date: "2026-09-10", locks_at: null, player_count: 0,
      fortune: 1000, house: { total: -120, last_delta: -120 },
      questions: [{ ...q, line_p_yes: 0.35 }],
    });
    expect(r.questions[0]!.line_p_yes).toBe(0.35);
    expect(r.fortune).toBe(1000);
  });
  it("RoundToday still parses a v2 payload with none of them", () => {
    const r = RoundTodaySchema.parse({ rules_version: 2, date: "2026-09-10", locks_at: null, player_count: 0, questions: [q] });
    expect(r.questions[0]!.line_p_yes).toBeNull();
    expect(r.fortune).toBeNull();
  });
  it("Reveal carries stake, payout, delta and the round's fortune figures", () => {
    const r = RevealSchema.parse({
      rules_version: 3, date: "2026-09-10", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null,
      delta: 86, return: 0.086, fortune_after: 1086, house_delta: -86,
      questions: [{
        id: q.id, slot: 1, text: q.text, outcome: "yes", crowd_yes_pct: 60, crowd_count: 12, market_prob: 0.40, line_p_yes: 0.35,
        my: { answer: true, confidence: 70, points: 30, brier: 0.09, stake: 40, payout: 114, delta: 74 },
        source_name: "Kalshi", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: 0.35,
      }],
      ledger: { settled: true, streak: 1, calls_rated: 0, oracle_score: null },
    });
    expect(r.questions[0]!.my!.stake).toBe(40);
    expect(r.fortune_after).toBe(1086);
  });
  it("Board accepts the return metric", () => {
    const b = RoundBoardSchema.parse({
      date: "2026-09-10", metric: "return", field_size: 6, your_points: null, your_rank: 2, best_points: null, median_points: null,
      your_return_bp: 860, best_return_bp: 1240, median_return_bp: 120,
      rows: [{ name: "THE PATIENT", points: 0, return_bp: 1240, rank: 1, is_you: false, is_oracle: false }],
    });
    expect(b.metric).toBe("return");
    expect(b.rows[0]!.return_bp).toBe(1240);
  });
  it("Ledger carries fortune and fortune_history", () => {
    const l = MeLedgerSchema.parse({
      milestones: [], oracle_score: null, percentile: null, cohort_size: 0, calls_rated: 0, calls_answered: 0, days_consulted: 0,
      streak: 0, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null, free_shield_available: true,
      paid_shields: 0, shield_used_on: null, claimed: false, epithet: { id: "novice", title: "THE NOVICE", receipt: "first calls" }, computed_through: "2026-09-10",
      oracle: { score: null, calls_rated: 0, days_outseen: 0, days_compared: 0 },
      fortune: 1086, fortune_history: [{ date: "2026-09-10", delta: 86, fortune_after: 1086 }],
    });
    expect(l.fortune_history[0]!.delta).toBe(86);
  });
  it("SubmitRes carries the frozen stake", () => {
    expect(SubmitResSchema.parse({ id: q.id, first_hour: false, stake: 40 }).stake).toBe(40);
    expect(SubmitResSchema.parse({ id: q.id, first_hour: false }).stake).toBeNull();
  });
});
```

If `MeLedgerSchema` has required fields not listed above (check `packages/core/src/schemas.ts:189` onward), add them to the fixture with neutral values rather than loosening the schema.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/core test -- roundRules schemas-v3`
Expected: FAIL — `CURRENT_RULES_VERSION` is 2; unknown keys are stripped so `line_p_yes` is undefined, not 0.35.

- [ ] **Step 3: Implement**

`packages/core/src/roundRules.ts`:
```ts
export type RoundRulesVersion = 1 | 2 | 3;
export const CURRENT_RULES_VERSION: RoundRulesVersion = 3;
```
The body of `ratingEligible` is unchanged: its `version >= 2` branches already cover 3.

`packages/core/src/schemas.ts` — every addition is optional with a null default so old clients and old payloads keep parsing:

```ts
// RoundTodaySchema: rules_version max → 3; add at the object's top level:
  fortune: z.number().int().nullable().default(null),
  house: z.object({ total: z.number().int(), last_delta: z.number().int().nullable() }).nullable().default(null),
// and inside each question:
      line_p_yes: z.number().min(0).max(1).nullable().default(null),

// RevealSchema: rules_version max → 3; add at top level:
  delta: z.number().int().nullable().default(null),
  return: z.number().nullable().default(null),
  fortune_after: z.number().int().nullable().default(null),
  house_delta: z.number().int().nullable().default(null),
// inside each question:
      line_p_yes: z.number().nullable().default(null),
// inside `my`:
          stake: z.number().int().nullable().default(null),
          payout: z.number().int().nullable().default(null),
          delta: z.number().int().nullable().default(null),

// RoundBoardSchema: add
  metric: z.enum(["points", "return"]).default("points"),
  your_return_bp: z.number().int().nullable().default(null),
  best_return_bp: z.number().int().nullable().default(null),
  median_return_bp: z.number().int().nullable().default(null),
// and inside rows:
      return_bp: z.number().int().nullable().default(null),

// MeLedgerSchema: add
  fortune: z.number().int().nullable().default(null),
  fortune_history: z.array(z.object({ date: z.string(), delta: z.number().int(), fortune_after: z.number().int() })).default([]),

// SubmitResSchema:
export const SubmitResSchema = z.object({ id: z.string().uuid(), first_hour: z.boolean(), stake: z.number().int().nullable().default(null) });
```

`return_bp` is the day's return in basis points, an integer, so the board keeps integer arithmetic and the mobile client renders `8.6%` from 860.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/core test` — all green, including the existing `round-schemas` fixture tests (if a fixture snapshot fails because a new defaulted key appears, update the fixture; that trap is documented in memory as "RevealSchema growth broke the core round-schemas fixture").
Run: `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): rules version 3; fortune, line and stake fields on the response schemas

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 3: Schema columns and migration 0014

**Files:**
- Modify: `apps/api/src/db/schema.ts` (`users`, `predictions`, `questions`, `rounds`, `userRounds`)
- Generate: `apps/api/drizzle/0014_<name>.sql`
- Test: `apps/api/test/schema-v3.test.ts` (create)

**Interfaces:**
- Produces the columns every later task reads and writes:
  - `users.fortune: integer not null default 1000`
  - `predictions.fortuneAtSeal: integer | null`, `predictions.stake: integer | null`, `predictions.linePYes: numeric | null`, `predictions.payout: integer | null`, `predictions.settledAt: timestamptz | null`
  - `questions.linePYes: numeric | null`, `questions.marketSource: text | null`, `questions.marketId: text | null`, `questions.marketEventKey: text | null`, `questions.marketClosesAt: timestamptz | null`
  - `rounds.houseDelta: integer | null`
  - `userRounds.fortuneAtOpen: integer | null`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/schema-v3.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";

describe("migration 0014", () => {
  it("gives every user a founding fortune of 1000", async () => {
    const { db } = await makeTestDb();
    const [u] = await db.insert(schema.users).values({}).returning();
    expect(u!.fortune).toBe(1000);
  });
  it("carries the line and market columns on questions, the stake columns on predictions, and house_delta on rounds", async () => {
    const { db } = await makeTestDb();
    const date = "2026-09-10";
    const rows = await seedRound(db, { date, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.questions).set({
      linePYes: "0.35", marketSource: "kalshi", marketId: "KXHIGHNY-26SEP11-B87", marketEventKey: "KXHIGHNY-26SEP11",
      marketClosesAt: new Date("2026-09-12T05:00:00Z"),
    }).where(eq(schema.questions.id, rows[0]!.id));
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(Number(q!.linePYes)).toBe(0.35);
    expect(q!.marketSource).toBe("kalshi");

    const [u] = await db.insert(schema.users).values({}).returning();
    const [p] = await db.insert(schema.predictions).values({
      questionId: rows[0]!.id, userId: u!.id, answer: true, confidence: 70, fortuneAtSeal: 1000, stake: 40, linePYes: "0.35",
    }).returning();
    expect(p!.stake).toBe(40);
    expect(p!.payout).toBeNull();
    expect(p!.settledAt).toBeNull();

    await db.update(schema.rounds).set({ houseDelta: -86 }).where(eq(schema.rounds.date, date));
    const r = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    expect(r!.houseDelta).toBe(-86);

    await db.insert(schema.userRounds).values({ userId: u!.id, date, vigilMult: "1", fortuneAtOpen: 1000 });
    const ur = await db.query.userRounds.findFirst({ where: eq(schema.userRounds.userId, u!.id) });
    expect(ur!.fortuneAtOpen).toBe(1000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- schema-v3`
Expected: FAIL — TypeScript rejects `fortune`/`linePYes`/etc., or PGlite reports `column "fortune" does not exist`.

- [ ] **Step 3: Add the columns**

In `apps/api/src/db/schema.ts`:

```ts
// users — after streakSettledThrough:
  // The player's fortune (design 2026-09-10 §4.4). Written ONLY by settlement
  // (resolution.ts payFortune). Never by a purchase, a grant or a shield.
  fortune: integer("fortune").notNull().default(1000),

// predictions — after crowdCountAtSeal:
  // Frozen at seal (design 2026-09-10 §4.2): the fortune the stake was cut
  // from, the stake, and the line it was taken at. Null on rounds before v3.
  fortuneAtSeal: integer("fortune_at_seal"),
  stake: integer("stake"),
  linePYes: numeric("line_p_yes"),
  // Written once by settlement, claimed WHERE settled_at IS NULL so a retried
  // resolve pays nobody twice. payout includes the returned stake.
  payout: integer("payout"),
  settledAt: timestamp("settled_at", { withTimezone: true }),

// questions — after topicKey:
  // The house line (design 2026-09-10 §5.5): oracle_p_yes clamped to the
  // market band. Written once at commit; immutable.
  linePYes: numeric("line_p_yes"),
  // The exchange market this question IS (design 2026-09-10 §5.1). Null on
  // authored and bank questions, which keep the model resolver.
  marketSource: text("market_source"),
  marketId: text("market_id"),
  marketEventKey: text("market_event_key"),
  marketClosesAt: timestamp("market_closes_at", { withTimezone: true }),

// rounds — after candidatesRejected:
  // Σ(stake − payout) over the round's settled predictions, written when the
  // round settles (design 2026-09-10 §4.4). Null until then and on v1/v2.
  houseDelta: integer("house_delta"),

// userRounds — after vigilMult:
  // The fortune at this player's FIRST accepted seal of the round, the
  // denominator of the day's return (design 2026-09-10 §4.5). Never rewritten.
  fortuneAtOpen: integer("fortune_at_open"),
```

`userRounds` rows are today inserted only at settlement. Task 14 inserts them at the first seal instead (with `vigilMult` "1" for v3) and settlement's `onConflictDoNothing` keeps that row.

- [ ] **Step 4: Generate the migration, then append the line guard**

Run: `pnpm --filter @oracle/api db:generate`
Expected: a new file `apps/api/drizzle/0014_<adjective_noun>.sql` containing only `ALTER TABLE … ADD COLUMN …` statements for the ten columns above, and `meta/_journal.json` updated. Open it and confirm there are no DROP statements.

Then append, by hand, to the end of that same file (drizzle-kit does not generate trigger changes; the PGlite test helper replays the file verbatim, so hand-written SQL here is exercised by every test):

```sql
--> statement-breakpoint
-- The house line is written once and never rewritten (design 2026-09-10
-- §5.5). Same posture as oracle_p_yes in guard_oracle_question_commitment
-- (0009), enforced here as its own trigger so that function stays untouched.
CREATE FUNCTION guard_house_line() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.line_p_yes IS NOT NULL AND NEW.line_p_yes IS DISTINCT FROM OLD.line_p_yes THEN
    RAISE EXCEPTION 'line: the house line is immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER house_line_guard BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION guard_house_line();
```

Note for the reader: the 0009 commitment guard compares an explicit column list (`id, round_date, slot, is_big_one, text, category, resolution_criteria, source_name, source_url, context, opens_at, oracle_p_yes`). `line_p_yes` and the `market_*` columns are not in it, so writing the line after the forecast commit is permitted; this new trigger is what makes the written line immutable.

Add to the test file:
```ts
  it("refuses to rewrite a house line once set", async () => {
    const { db } = await makeTestDb();
    const rows = await seedRound(db, { date: "2026-09-10", opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.questions).set({ linePYes: "0.35" }).where(eq(schema.questions.id, rows[0]!.id));
    await expect(db.update(schema.questions).set({ linePYes: "0.40" }).where(eq(schema.questions.id, rows[0]!.id))).rejects.toThrow(/house line is immutable/);
    // unrelated updates still pass
    await expect(db.update(schema.questions).set({ crowdCount: 3 }).where(eq(schema.questions.id, rows[0]!.id))).resolves.toBeDefined();
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @oracle/api test -- schema-v3`
Expected: PASS. Then `pnpm --filter @oracle/api test -- schema` (the existing schema test) still passes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/schema-v3.test.ts
git commit -m "feat(api): fortune, stake, line and market columns (migration 0014)

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: Exchange types and the Kalshi feed

**Files:**
- Create: `apps/api/src/pipeline/exchanges/types.ts`
- Create: `apps/api/src/pipeline/exchanges/kalshi.ts`
- Create: `apps/api/test/fixtures/exchanges/kalshi-markets-page1.json`, `kalshi-markets-page2.json`, `kalshi-market-settled-yes.json`, `kalshi-market-settled-no.json`, `kalshi-market-open.json`, `kalshi-event.json`
- Test: `apps/api/test/exchanges-kalshi.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type Category = "markets" | "sports" | "weather" | "culture" | "news";
  export type ExchangeSource = "kalshi" | "polymarket";
  export interface MarketCandidate {
    source: ExchangeSource;
    marketId: string;      // Kalshi ticker; Polymarket market id
    eventKey: string;      // Kalshi event_ticker; Polymarket event slug
    seriesKey: string;     // Kalshi series_ticker; Polymarket first tag slug or event slug
    title: string;
    rules: string;
    url: string;
    category: Category;
    prob: number;          // P(YES) in [0,1]
    volume: number;
    closesAt: string;      // ISO
  }
  export interface SettlementRead { settled: boolean; outcome: "yes" | "no" | "void" | null; raw: unknown }
  export interface ExchangeFeed {
    source: ExchangeSource;
    list(fetchFn: typeof fetch, window: { from: Date; to: Date }): Promise<MarketCandidate[]>;
    read(fetchFn: typeof fetch, marketId: string): Promise<SettlementRead>;
  }
  // kalshi.ts
  export const KALSHI_FEED: ExchangeFeed;
  export function kalshiCategory(seriesTicker: string, eventCategory?: string | null): Category;
  ```

- [ ] **Step 1: Record the fixtures**

Run this once from the repo root and commit the output. It captures real responses from 2026-09-10 and trims them so the fixtures stay small.

```bash
mkdir -p apps/api/test/fixtures/exchanges && cd apps/api/test/fixtures/exchanges && python3 - <<'PY'
import json, urllib.request
H={'User-Agent':'Mozilla/5.0','Accept':'application/json'}
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=H)))
KEEP=("ticker","event_ticker","status","result","close_time","expiration_time","settlement_ts","title","yes_sub_title",
      "rules_primary","yes_bid_dollars","yes_ask_dollars","last_price_dollars","volume_fp","liquidity_dollars","market_type","mve_collection_ticker")
def trim(m): return {k:m.get(k) for k in KEEP}
p1=get("https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=1000")
ms=[trim(m) for m in p1["markets"]]
# keep a mix: 40 with prices, and every exotic (mve) row so the exclusion is exercised
priced=[m for m in ms if float(m["yes_bid_dollars"] or 0)>0][:40]
exotic=[m for m in ms if m.get("mve_collection_ticker")][:3]
json.dump({"markets":priced+exotic,"cursor":"PAGE2"},open("kalshi-markets-page1.json","w"),indent=1)
json.dump({"markets":priced[:5],"cursor":""},open("kalshi-markets-page2.json","w"),indent=1)
s=get("https://api.elections.kalshi.com/trade-api/v2/markets?status=settled&limit=20")["markets"]
yes=next(m for m in s if m.get("result")=="yes"); no=next(m for m in s if m.get("result")=="no")
json.dump({"market":trim(yes)},open("kalshi-market-settled-yes.json","w"),indent=1)
json.dump({"market":trim(no)},open("kalshi-market-settled-no.json","w"),indent=1)
json.dump({"market":trim(priced[0])},open("kalshi-market-open.json","w"),indent=1)
ev=get(f"https://api.elections.kalshi.com/trade-api/v2/events/{priced[0]['event_ticker']}")["event"]
json.dump({"event":{k:ev.get(k) for k in ("event_ticker","series_ticker","category","title","settlement_sources")}},open("kalshi-event.json","w"),indent=1)
print("ok")
PY
```

If the settled page has no `no` result on the day you run it, add `&limit=200`. Never edit values by hand; re-run the script instead.

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/test/exchanges-kalshi.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KALSHI_FEED, kalshiCategory } from "../src/pipeline/exchanges/kalshi";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures/exchanges", name), "utf8");

// A fetch stub keyed on URL substrings. Unmatched URLs throw, so a test that
// reaches an endpoint it did not expect fails loudly instead of returning [].
function fetchFrom(routes: Array<[string, string]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return new Response(hit[1], { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("KALSHI_FEED.list", () => {
  const window = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };
  it("pages by cursor, reads dollar prices, drops exotics and unpriced rows", async () => {
    const calls: string[] = [];
    const f = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return fetchFrom([["cursor=PAGE2", fx("kalshi-markets-page2.json")], ["/markets?", fx("kalshi-markets-page1.json")]])(input);
    }) as typeof fetch;
    const out = await KALSHI_FEED.list(f, window);
    expect(calls.length).toBe(2);
    expect(calls[0]).toContain("min_close_ts=");
    expect(calls[0]).toContain("max_close_ts=");
    expect(out.every((m) => m.source === "kalshi")).toBe(true);
    expect(out.every((m) => m.prob > 0 && m.prob < 1)).toBe(true);
    expect(out.some((m) => m.marketId.startsWith("KXMVE"))).toBe(false);
    // page 2 repeats five rows from page 1; de-duplicated by ticker
    const ids = out.map((m) => m.marketId);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("maps each row's fields", async () => {
    const out = await KALSHI_FEED.list(fetchFrom([["cursor=PAGE2", fx("kalshi-markets-page2.json")], ["/markets?", fx("kalshi-markets-page1.json")]]), window);
    const m = out[0]!;
    expect(m.eventKey).toMatch(/^KX/);
    expect(m.seriesKey).toBe(m.eventKey.split("-")[0]);
    expect(m.url).toBe(`https://kalshi.com/markets/${m.seriesKey.toLowerCase()}`);
    expect(typeof m.rules).toBe("string");
    expect(Date.parse(m.closesAt)).not.toBeNaN();
  });
});

describe("KALSHI_FEED.read", () => {
  it("reads a finalized yes", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-settled-yes.json")]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("reads a finalized no", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-settled-no.json")]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "no" });
  });
  it("an open market is not settled", async () => {
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", fx("kalshi-market-open.json")]]), "ANY");
    expect(r).toMatchObject({ settled: false, outcome: null });
  });
  it("a determined-but-not-finalized market with a result counts as settled", async () => {
    const body = JSON.parse(fx("kalshi-market-settled-yes.json"));
    body.market.status = "determined";
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", JSON.stringify(body)]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("a finalized market with an unknown result is a void", async () => {
    const body = JSON.parse(fx("kalshi-market-settled-yes.json"));
    body.market.result = "scratch";
    const r = await KALSHI_FEED.read(fetchFrom([["/markets/", JSON.stringify(body)]]), "ANY");
    expect(r).toMatchObject({ settled: true, outcome: "void" });
  });
  it("a non-200 throws", async () => {
    const f = (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await expect(KALSHI_FEED.read(f, "ANY")).rejects.toThrow(/503/);
  });
});

describe("kalshiCategory", () => {
  it("prefers the event category when given", () => {
    expect(kalshiCategory("KXHIGHNY", "Climate and Weather")).toBe("weather");
    expect(kalshiCategory("KXNFLGAME", "Sports")).toBe("sports");
    expect(kalshiCategory("KXBIGBROTHERELIMINATION", "Entertainment")).toBe("culture");
    expect(kalshiCategory("KXBTCD", "Financials")).toBe("markets");
    expect(kalshiCategory("KXCPI", "Economics")).toBe("news");
    expect(kalshiCategory("KXAPRPOTUS", "Politics")).toBe("news");
  });
  it("falls back to the series prefix table, then to news", () => {
    expect(kalshiCategory("KXHIGHCHI")).toBe("weather");
    expect(kalshiCategory("KXRAIN")).toBe("weather");
    expect(kalshiCategory("KXETHD")).toBe("markets");
    expect(kalshiCategory("KXNASDAQ100U")).toBe("markets");
    expect(kalshiCategory("KXKBOGAME")).toBe("sports");
    expect(kalshiCategory("KXWFIBASPREAD")).toBe("sports");
    expect(kalshiCategory("KXSOMETHINGNEW")).toBe("news");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- exchanges-kalshi`
Expected: FAIL with "Cannot find module '../src/pipeline/exchanges/kalshi'".

- [ ] **Step 4: Implement**

```ts
// apps/api/src/pipeline/exchanges/types.ts
// The exchange boundary (design 2026-09-10 §5.1, §5.6). Two feeds, one shape.
export type Category = "markets" | "sports" | "weather" | "culture" | "news";
export type ExchangeSource = "kalshi" | "polymarket";

export interface MarketCandidate {
  source: ExchangeSource;
  marketId: string;
  eventKey: string;
  seriesKey: string;
  title: string;
  rules: string;
  url: string;
  category: Category;
  prob: number;
  volume: number;
  closesAt: string;
}

export interface SettlementRead {
  settled: boolean;
  outcome: "yes" | "no" | "void" | null;
  raw: unknown;
}

export interface ExchangeFeed {
  source: ExchangeSource;
  list(fetchFn: typeof fetch, window: { from: Date; to: Date }): Promise<MarketCandidate[]>;
  read(fetchFn: typeof fetch, marketId: string): Promise<SettlementRead>;
}

export const BROWSER_HEADERS = { "User-Agent": "Mozilla/5.0 (oracle-pipeline)", Accept: "application/json" };

export async function getJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`exchange: ${res.status} from ${url}`);
  return (await res.json()) as T;
}
```

```ts
// apps/api/src/pipeline/exchanges/kalshi.ts
// Kalshi public market data (verified 2026-09-10): no key needed for reads,
// prices live in the *_dollars fields, statuses run initialized → active →
// determined → finalized, and `result` is set from determined onward.
import { getJson, type Category, type ExchangeFeed, type MarketCandidate, type SettlementRead } from "./types";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const PAGE = 1000;
const MAX_PAGES = 15;

interface KalshiMarket {
  ticker: string; event_ticker: string; status: string; result?: string | null;
  close_time: string; title: string; yes_sub_title?: string | null; rules_primary?: string | null;
  yes_bid_dollars?: string | null; yes_ask_dollars?: string | null; volume_fp?: string | null;
  market_type?: string | null; mve_collection_ticker?: string | null;
}

// Event categories as Kalshi names them → the app's five.
const EVENT_CATEGORY: Record<string, Category> = {
  "Sports": "sports",
  "Climate and Weather": "weather",
  "Entertainment": "culture",
  "Financials": "markets",
  "Companies": "markets",
  "Economics": "news",
  "Elections": "news",
  "Politics": "news",
  "World": "news",
  "Social": "news",
  "Health": "news",
  "Science and Technology": "news",
};

// Series-prefix table for when no event record is at hand. Order matters:
// the first matching prefix wins. Unknown series are news, never rejected.
const SERIES_PREFIX: Array<[RegExp, Category]> = [
  [/^KX(HIGH|LOW|RAIN|SNOW|TEMP)/, "weather"],
  [/^KX(BTC|ETH|SOL|DOGE|XRP|NASDAQ|SP500|INX|DJI|GOLD|SILVER|WTI|BRENT|OIL|TSLA|NVDA|AAPL)/, "markets"],
  [/^KX(BIGBROTHER|RT|OSCAR|EMMY|GRAMMY|BILLBOARD|SPOTIFY|BOXOFFICE|SURVIVOR|BACHELOR)/, "culture"],
  [/(GAME|SPREAD|TOTAL|MATCH|MAP|WINNER|SERIES)$/, "sports"],
  [/^KX(NFL|NBA|MLB|NHL|UFC|KBO|NPB|CS2|DOTA2|LOL|WFIBA|FIBA|EPL|UCL|MLS|PGA|ATP|WTA|F1|NASCAR)/, "sports"],
];

export function kalshiCategory(seriesTicker: string, eventCategory?: string | null): Category {
  if (eventCategory && EVENT_CATEGORY[eventCategory]) return EVENT_CATEGORY[eventCategory]!;
  for (const [re, cat] of SERIES_PREFIX) if (re.test(seriesTicker)) return cat;
  return "news";
}

function seriesOf(eventTicker: string): string {
  return eventTicker.split("-")[0]!;
}

function toCandidate(m: KalshiMarket): MarketCandidate | null {
  if (m.mve_collection_ticker || m.ticker.startsWith("KXMVE")) return null;      // multi-leg exotics
  if (m.market_type && m.market_type !== "binary") return null;
  const bid = Number(m.yes_bid_dollars ?? 0);
  const ask = Number(m.yes_ask_dollars ?? 0);
  if (!(bid > 0) || !(ask > 0)) return null;                                     // no two-sided price
  const series = seriesOf(m.event_ticker);
  return {
    source: "kalshi",
    marketId: m.ticker,
    eventKey: m.event_ticker,
    seriesKey: series,
    title: m.yes_sub_title ? `${m.title} — ${m.yes_sub_title}` : m.title,
    rules: m.rules_primary ?? "",
    url: `https://kalshi.com/markets/${series.toLowerCase()}`,
    category: kalshiCategory(series),
    prob: (bid + ask) / 2,
    volume: Number(m.volume_fp ?? 0),
    closesAt: new Date(m.close_time).toISOString(),
  };
}

export const KALSHI_FEED: ExchangeFeed = {
  source: "kalshi",
  async list(fetchFn, window) {
    const min = Math.floor(window.from.getTime() / 1000);
    const max = Math.floor(window.to.getTime() / 1000);
    const seen = new Set<string>();
    const out: MarketCandidate[] = [];
    let cursor = "";
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${BASE}/markets?status=open&limit=${PAGE}&min_close_ts=${min}&max_close_ts=${max}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const body = await getJson<{ markets: KalshiMarket[]; cursor?: string }>(fetchFn, url);
      for (const m of body.markets ?? []) {
        if (seen.has(m.ticker)) continue;
        seen.add(m.ticker);
        const c = toCandidate(m);
        if (c) out.push(c);
      }
      cursor = body.cursor ?? "";
      if (!cursor) break;
    }
    return out;
  },
  async read(fetchFn, marketId) {
    const body = await getJson<{ market: KalshiMarket }>(fetchFn, `${BASE}/markets/${encodeURIComponent(marketId)}`);
    const m = body.market;
    const decided = m.status === "determined" || m.status === "finalized";
    if (!decided) return { settled: false, outcome: null, raw: m };
    const outcome = m.result === "yes" ? "yes" : m.result === "no" ? "no" : "void";
    return { settled: true, outcome, raw: m };
  },
};

/** One event record, for the five selected markets only (category + settlement sources). */
export async function kalshiEvent(fetchFn: typeof fetch, eventTicker: string): Promise<{ category: string | null; settlementSources: Array<{ name?: string; url?: string }> }> {
  const body = await getJson<{ event: { category?: string | null; settlement_sources?: Array<{ name?: string; url?: string }> } }>(
    fetchFn, `${BASE}/events/${encodeURIComponent(eventTicker)}`,
  );
  return { category: body.event.category ?? null, settlementSources: body.event.settlement_sources ?? [] };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @oracle/api test -- exchanges-kalshi`
Expected: PASS. If the prefix tests disagree with the fixture's real tickers (a series that matched the wrong rule), fix the table, not the test.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/exchanges apps/api/test/exchanges-kalshi.test.ts apps/api/test/fixtures/exchanges
git commit -m "feat(pipeline): exchange types and the Kalshi feed with recorded fixtures

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 5: The Polymarket feed

**Files:**
- Create: `apps/api/src/pipeline/exchanges/polymarket.ts`
- Create fixtures: `apps/api/test/fixtures/exchanges/polymarket-markets-page1.json`, `polymarket-markets-page2.json`, `polymarket-market-resolved-yes.json`, `polymarket-market-resolved-no.json`, `polymarket-market-open.json`
- Test: `apps/api/test/exchanges-polymarket.test.ts`

**Interfaces:**
- Consumes: `types.ts` from Task 4.
- Produces: `export const POLYMARKET_FEED: ExchangeFeed; export function polymarketCategory(tagSlugs: string[]): Category;`

- [ ] **Step 1: Record the fixtures**

```bash
cd apps/api/test/fixtures/exchanges && python3 - <<'PY'
import json, urllib.request, datetime as dt
H={'User-Agent':'Mozilla/5.0','Accept':'application/json'}
def get(u): return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=H)))
KEEP=("id","question","description","slug","outcomes","outcomePrices","closed","active","umaResolutionStatus","endDate","volumeNum","events")
def trim(m):
    d={k:m.get(k) for k in KEEP}
    d["events"]=[{"slug":e.get("slug"),"title":e.get("title"),"tags":[{"slug":t.get("slug"),"label":t.get("label")} for t in (e.get("tags") or [])]} for e in (m.get("events") or [])][:1]
    return d
now=dt.datetime.now(dt.UTC); mn=now.strftime('%Y-%m-%dT%H:%M:%SZ'); mx=(now+dt.timedelta(hours=48)).strftime('%Y-%m-%dT%H:%M:%SZ')
p1=get(f"https://gamma-api.polymarket.com/markets?closed=false&active=true&volume_num_min=3000&end_date_min={mn}&end_date_max={mx}&limit=100&offset=0")
json.dump([trim(m) for m in p1][:40],open("polymarket-markets-page1.json","w"),indent=1)
json.dump([],open("polymarket-markets-page2.json","w"))
c=get("https://gamma-api.polymarket.com/markets?closed=true&limit=50&order=endDate&ascending=false")
yes=next(m for m in c if m.get("umaResolutionStatus")=="resolved" and json.loads(m["outcomePrices"])[0]=="1")
no=next(m for m in c if m.get("umaResolutionStatus")=="resolved" and json.loads(m["outcomePrices"])[0]=="0")
json.dump(trim(yes),open("polymarket-market-resolved-yes.json","w"),indent=1)
json.dump(trim(no),open("polymarket-market-resolved-no.json","w"),indent=1)
json.dump(trim(p1[0]),open("polymarket-market-open.json","w"),indent=1)
print("ok")
PY
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/api/test/exchanges-polymarket.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POLYMARKET_FEED, polymarketCategory } from "../src/pipeline/exchanges/polymarket";

const fx = (name: string) => readFileSync(join(__dirname, "fixtures/exchanges", name), "utf8");
function fetchFrom(routes: Array<[string, string]>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = routes.find(([needle]) => url.includes(needle));
    if (!hit) throw new Error(`unexpected fetch: ${url}`);
    return new Response(hit[1], { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("POLYMARKET_FEED.list", () => {
  const window = { from: new Date("2026-09-11T18:00:00Z"), to: new Date("2026-09-12T22:00:00Z") };
  it("stops at a short page, sends a browser user agent, maps fields", async () => {
    const calls: Array<{ url: string; ua: string | undefined }> = [];
    const f = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, ua: (init?.headers as Record<string, string> | undefined)?.["User-Agent"] });
      return fetchFrom([["offset=100", fx("polymarket-markets-page2.json")], ["offset=0", fx("polymarket-markets-page1.json")]])(input, init);
    }) as typeof fetch;
    const out = await POLYMARKET_FEED.list(f, window);
    expect(calls.length).toBe(1); // the fixture page holds 40 rows, under PAGE, so paging stops
    expect(calls[0]!.ua).toMatch(/Mozilla/);
    expect(calls[0]!.url).toContain("end_date_min=2026-09-11T18:00:00Z");
    expect(calls[0]!.url).toContain("volume_num_min=");
    expect(out.length).toBeGreaterThan(0);
    const m = out[0]!;
    expect(m.source).toBe("polymarket");
    expect(m.prob).toBeGreaterThan(0);
    expect(m.prob).toBeLessThan(1);
    expect(m.url).toMatch(/^https:\/\/polymarket\.com\/event\//);
    expect(m.eventKey.length).toBeGreaterThan(0);
    expect(Date.parse(m.closesAt)).not.toBeNaN();
  });
  it("skips rows whose prices do not parse", async () => {
    const page = JSON.parse(fx("polymarket-markets-page1.json"));
    page[0].outcomePrices = "not json";
    const out = await POLYMARKET_FEED.list(fetchFrom([["offset=100", "[]"], ["offset=0", JSON.stringify(page)]]), window);
    expect(out.find((m) => m.marketId === String(page[0].id))).toBeUndefined();
  });
});

describe("POLYMARKET_FEED.read", () => {
  it("resolved yes", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-resolved-yes.json")]]), "1")).toMatchObject({ settled: true, outcome: "yes" });
  });
  it("resolved no", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-resolved-no.json")]]), "1")).toMatchObject({ settled: true, outcome: "no" });
  });
  it("open is not settled", async () => {
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", fx("polymarket-market-open.json")]]), "1")).toMatchObject({ settled: false, outcome: null });
  });
  it("closed but not yet resolved by UMA is not settled", async () => {
    const m = JSON.parse(fx("polymarket-market-resolved-yes.json"));
    m.umaResolutionStatus = "proposed";
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", JSON.stringify(m)]]), "1")).toMatchObject({ settled: false, outcome: null });
  });
  it("resolved with split prices is a void", async () => {
    const m = JSON.parse(fx("polymarket-market-resolved-yes.json"));
    m.outcomePrices = JSON.stringify(["0.5", "0.5"]);
    expect(await POLYMARKET_FEED.read(fetchFrom([["/markets/", JSON.stringify(m)]]), "1")).toMatchObject({ settled: true, outcome: "void" });
  });
});

describe("polymarketCategory", () => {
  it("maps tag slugs", () => {
    expect(polymarketCategory(["sports", "nfl"])).toBe("sports");
    expect(polymarketCategory(["crypto"])).toBe("markets");
    expect(polymarketCategory(["business", "economy"])).toBe("markets");
    expect(polymarketCategory(["pop-culture"])).toBe("culture");
    expect(polymarketCategory(["weather"])).toBe("weather");
    expect(polymarketCategory(["politics"])).toBe("news");
    expect(polymarketCategory([])).toBe("news");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- exchanges-polymarket`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement**

```ts
// apps/api/src/pipeline/exchanges/polymarket.ts
// Polymarket's gamma API (verified 2026-09-10): 403s without a browser user
// agent, paginates at 100 by offset, and reports settlement as closed +
// umaResolutionStatus "resolved" with final outcomePrices.
import { getJson, type Category, type ExchangeFeed, type MarketCandidate, type SettlementRead } from "./types";

const BASE = "https://gamma-api.polymarket.com";
const PAGE = 100;
const MAX_PAGES = 20;
const VOLUME_FLOOR = 3000; // the API-side pre-filter; select.ts applies the real floor

interface PolyTag { slug?: string; label?: string }
interface PolyEvent { slug?: string; title?: string; tags?: PolyTag[] }
interface PolyMarket {
  id: string | number; question?: string; description?: string; slug?: string;
  outcomes?: string; outcomePrices?: string; closed?: boolean; active?: boolean;
  umaResolutionStatus?: string; endDate?: string; volumeNum?: number; volume?: string; events?: PolyEvent[];
}

const TAG_CATEGORY: Array<[RegExp, Category]> = [
  [/^(sports|nfl|nba|mlb|nhl|soccer|tennis|ufc|mma|golf|f1|esports)$/, "sports"],
  [/^(crypto|bitcoin|ethereum|business|economy|stocks|finance|fed|earnings)$/, "markets"],
  [/^(weather|climate)$/, "weather"],
  [/^(pop-culture|entertainment|music|movies|tv|awards|celebrities)$/, "culture"],
];

export function polymarketCategory(tagSlugs: string[]): Category {
  for (const slug of tagSlugs) for (const [re, cat] of TAG_CATEGORY) if (re.test(slug)) return cat;
  return "news";
}

function priceYes(m: PolyMarket): number | null {
  try {
    const prices = JSON.parse(m.outcomePrices ?? "[]") as string[];
    const p = Number(prices[0]);
    return Number.isFinite(p) ? p : null;
  } catch {
    return null;
  }
}

function toCandidate(m: PolyMarket): MarketCandidate | null {
  const p = priceYes(m);
  if (p === null || !m.endDate) return null;
  const event = m.events?.[0];
  const eventSlug = event?.slug ?? m.slug ?? String(m.id);
  const tags = (event?.tags ?? []).map((t) => t.slug ?? "").filter(Boolean);
  return {
    source: "polymarket",
    marketId: String(m.id),
    eventKey: eventSlug,
    seriesKey: tags[0] ?? eventSlug,
    title: m.question ?? "",
    rules: m.description ?? "",
    url: `https://polymarket.com/event/${eventSlug}`,
    category: polymarketCategory(tags),
    prob: p,
    volume: Number(m.volumeNum ?? m.volume ?? 0),
    closesAt: new Date(m.endDate).toISOString(),
  };
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export const POLYMARKET_FEED: ExchangeFeed = {
  source: "polymarket",
  async list(fetchFn, window) {
    const out: MarketCandidate[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${BASE}/markets?closed=false&active=true&volume_num_min=${VOLUME_FLOOR}&end_date_min=${iso(window.from)}&end_date_max=${iso(window.to)}&limit=${PAGE}&offset=${page * PAGE}`;
      const body = await getJson<PolyMarket[]>(fetchFn, url);
      if (!Array.isArray(body) || body.length === 0) break;
      for (const m of body) {
        const c = toCandidate(m);
        if (c) out.push(c);
      }
      if (body.length < PAGE) break;
    }
    return out;
  },
  async read(fetchFn, marketId) {
    const m = await getJson<PolyMarket>(fetchFn, `${BASE}/markets/${encodeURIComponent(marketId)}`);
    const resolved = m.closed === true && m.umaResolutionStatus === "resolved";
    if (!resolved) return { settled: false, outcome: null, raw: m };
    const p = priceYes(m);
    const outcome = p === 1 ? "yes" : p === 0 ? "no" : "void";
    return { settled: true, outcome, raw: m };
  },
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @oracle/api test -- exchanges-polymarket`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/exchanges/polymarket.ts apps/api/test/exchanges-polymarket.test.ts apps/api/test/fixtures/exchanges
git commit -m "feat(pipeline): the Polymarket feed with recorded fixtures

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 6: Selection

**Files:**
- Create: `apps/api/src/pipeline/exchanges/select.ts`
- Test: `apps/api/test/exchanges-select.test.ts`

**Interfaces:**
- Consumes: `MarketCandidate`, `Category` from Task 4.
- Produces:
  ```ts
  export const SELECT = { CLOSE_AFTER_LOCK_MIN_H: 2, CLOSE_AFTER_LOCK_MAX_H: 30, PROB_MIN: 0.20, PROB_MAX: 0.80, VOLUME_MIN: 5000, ROUND_SIZE: 5, MIN_DISTINCT_CATEGORIES: 4 } as const;
  export function eligibilityWindow(locksAt: Date): { from: Date; to: Date };
  export function eligible(candidates: MarketCandidate[], locksAt: Date): MarketCandidate[];   // window + band + volume + title + one per event
  export function selectFive(candidates: MarketCandidate[]): MarketCandidate[] | null;         // greedy spread; index 4 is the Big One
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/exchanges-select.test.ts
import { describe, it, expect } from "vitest";
import { SELECT, eligibilityWindow, eligible, selectFive } from "../src/pipeline/exchanges/select";
import type { MarketCandidate } from "../src/pipeline/exchanges/types";

const LOCK = new Date("2026-09-11T16:00:00Z"); // noon ET on Sept 11
const h = (n: number) => new Date(LOCK.getTime() + n * 3_600_000).toISOString();

function cand(over: Partial<MarketCandidate> & { marketId: string }): MarketCandidate {
  return {
    source: "kalshi", eventKey: over.marketId, seriesKey: "KXTEST", title: `Will ${over.marketId}?`, rules: "r",
    url: "https://kalshi.com/markets/kxtest", category: "news", prob: 0.5, volume: 10_000, closesAt: h(10),
    ...over,
  };
}

describe("eligibilityWindow", () => {
  it("runs from lock + 2h to lock + 30h", () => {
    const w = eligibilityWindow(LOCK);
    expect(w.from.toISOString()).toBe(h(2));
    expect(w.to.toISOString()).toBe(h(30));
  });
});

describe("eligible", () => {
  it("keeps only markets closing inside the window", () => {
    const out = eligible([cand({ marketId: "early", closesAt: h(1.5) }), cand({ marketId: "in", closesAt: h(2) }), cand({ marketId: "late", closesAt: h(30.1) })], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["in"]);
  });
  it("keeps only contested prices and real volume", () => {
    const out = eligible([
      cand({ marketId: "cheap", prob: 0.19 }), cand({ marketId: "dear", prob: 0.81 }),
      cand({ marketId: "thin", volume: 4999 }), cand({ marketId: "ok", prob: 0.2, volume: 5000 }),
    ], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["ok"]);
  });
  it("drops spread and over/under titles", () => {
    const out = eligible([
      cand({ marketId: "s", title: "Spread: Rams (-3.5)" }), cand({ marketId: "ou", title: "49ers vs. Rams: O/U 48.5" }), cand({ marketId: "ml", title: "49ers vs. Rams" }),
    ], LOCK);
    expect(out.map((c) => c.marketId)).toEqual(["ml"]);
  });
  it("keeps one market per event: the highest volume", () => {
    const out = eligible([
      cand({ marketId: "a", eventKey: "E", volume: 8000 }), cand({ marketId: "b", eventKey: "E", volume: 9000 }), cand({ marketId: "c", eventKey: "F" }),
    ], LOCK);
    expect(out.map((c) => c.marketId).sort()).toEqual(["b", "c"]);
  });
});

describe("selectFive", () => {
  it("returns null under five candidates", () => {
    expect(selectFive([cand({ marketId: "1" }), cand({ marketId: "2" })])).toBeNull();
  });
  it("returns null under four distinct categories", () => {
    expect(selectFive([1, 2, 3, 4, 5].map((i) => cand({ marketId: String(i), category: i < 3 ? "sports" : "news" })))).toBeNull();
  });
  it("spreads categories first, fills by volume, and makes the most traded the Big One", () => {
    const cs = [
      cand({ marketId: "nfl", category: "sports", volume: 240_000 }),
      cand({ marketId: "cpi", category: "news", volume: 35_000 }),
      cand({ marketId: "btc", category: "markets", volume: 200_000 }),
      cand({ marketId: "nyc", category: "weather", volume: 8_400 }),
      cand({ marketId: "bb", category: "culture", volume: 41_000 }),
      cand({ marketId: "eth", category: "markets", volume: 11_000 }),
      cand({ marketId: "kbo", category: "sports", volume: 107_000 }),
    ];
    const five = selectFive(cs)!;
    // By volume: nfl, btc, kbo, bb, cpi, eth, nyc. One per category first takes
    // nfl (sports), btc (markets), bb (culture), cpi (news), nyc (weather) — five,
    // so kbo and eth never enter. The Big One is the most traded, nfl; slots
    // 1-4 are the rest in volume order.
    expect(five.map((c) => c.marketId)).toEqual(["btc", "bb", "cpi", "nyc", "nfl"]);
  });
  it("fills from the same category once every category is represented", () => {
    const cs = [
      cand({ marketId: "a", category: "sports", volume: 90 }), cand({ marketId: "b", category: "markets", volume: 80 }),
      cand({ marketId: "c", category: "news", volume: 70 }), cand({ marketId: "d", category: "weather", volume: 60 }),
      cand({ marketId: "e", category: "sports", volume: 50 }),
    ];
    expect(selectFive(cs)!.map((c) => c.marketId)).toEqual(["b", "c", "d", "e", "a"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- exchanges-select`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/pipeline/exchanges/select.ts
// Eligibility and selection (design 2026-09-10 §5.2, §5.3). Pure.
//
// The window's lower bound is the leak rule: a market whose trading closes at
// least two hours after the lock concerns an event that begins after the
// lock. It is what keeps the game the afternoon before a kickoff from
// carrying that kickoff. The upper bound keeps settlement inside the
// following evening.
import type { Category, MarketCandidate } from "./types";

export const SELECT = {
  CLOSE_AFTER_LOCK_MIN_H: 2,
  CLOSE_AFTER_LOCK_MAX_H: 30,
  PROB_MIN: 0.20,
  PROB_MAX: 0.80,
  VOLUME_MIN: 5000,            // ⚙ tunable
  ROUND_SIZE: 5,
  MIN_DISTINCT_CATEGORIES: 4,  // DraftSchema requires four; a thinner night is the bank's
} as const;

const H = 3_600_000;
const EXCLUDED_TITLE = /^spread\b|\bo\/u\b|\bover\/under\b/i;

export function eligibilityWindow(locksAt: Date): { from: Date; to: Date } {
  return {
    from: new Date(locksAt.getTime() + SELECT.CLOSE_AFTER_LOCK_MIN_H * H),
    to: new Date(locksAt.getTime() + SELECT.CLOSE_AFTER_LOCK_MAX_H * H),
  };
}

export function eligible(candidates: MarketCandidate[], locksAt: Date): MarketCandidate[] {
  const { from, to } = eligibilityWindow(locksAt);
  const inRules = candidates.filter((c) => {
    const t = Date.parse(c.closesAt);
    return (
      t >= from.getTime() && t <= to.getTime() &&
      c.prob >= SELECT.PROB_MIN && c.prob <= SELECT.PROB_MAX &&
      c.volume >= SELECT.VOLUME_MIN &&
      !EXCLUDED_TITLE.test(c.title)
    );
  });
  const byEvent = new Map<string, MarketCandidate>();
  for (const c of inRules) {
    const key = `${c.source}:${c.eventKey}`;
    const prev = byEvent.get(key);
    if (!prev || c.volume > prev.volume) byEvent.set(key, c);
  }
  return [...byEvent.values()];
}

/** Greedy spread by volume: one per category first, then fill. Index 4 is the Big One. */
export function selectFive(candidates: MarketCandidate[]): MarketCandidate[] | null {
  if (candidates.length < SELECT.ROUND_SIZE) return null;
  const ranked = [...candidates].sort((a, b) => b.volume - a.volume);
  const chosen: MarketCandidate[] = [];
  const used = new Set<Category>();
  for (const c of ranked) {
    if (chosen.length === SELECT.ROUND_SIZE) break;
    if (used.has(c.category)) continue;
    chosen.push(c); used.add(c.category);
  }
  for (const c of ranked) {
    if (chosen.length === SELECT.ROUND_SIZE) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  if (chosen.length < SELECT.ROUND_SIZE) return null;
  if (new Set(chosen.map((c) => c.category)).size < SELECT.MIN_DISTINCT_CATEGORIES) return null;
  const big = chosen.reduce((m, c) => (c.volume > m.volume ? c : m), chosen[0]!);
  const rest = chosen.filter((c) => c !== big).sort((a, b) => b.volume - a.volume);
  return [...rest, big];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oracle/api test -- exchanges-select`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/exchanges/select.ts apps/api/test/exchanges-select.test.ts
git commit -m "feat(pipeline): exchange eligibility window and five-market selection

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 7: A version 3 draft

**Files:**
- Modify: `apps/api/src/pipeline/draft.ts` (`DraftQuestionSchema`, `upsertDraft`)
- Test: `apps/api/test/pipeline-draft-v3.test.ts` (create)

**Interfaces:**
- Produces: `DraftQuestionSchema` gains an optional `market` object; `upsertDraft(db, date, draft, 3)` stamps `questions.market_*` and skips the fast-round rule, checking the market window instead.
  ```ts
  market: z.object({
    source: z.enum(["kalshi", "polymarket"]),
    id: z.string().min(1),
    event_key: z.string().min(1),
    closes_at: z.iso.datetime({ offset: true }),
  }).optional(),
  ```

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/pipeline-draft-v3.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { schema } from "../src/db/client";
import { upsertDraft, DraftSchema } from "../src/pipeline/draft";
import { noonET, addDays } from "../src/pipeline/clock";

const DATE = "2026-09-10";
const lock = noonET(addDays(DATE, 1));
const h = (n: number) => new Date(lock.getTime() + n * 3_600_000).toISOString();

function marketDraft(closes: (slot: number) => string) {
  return DraftSchema.parse({
    questions: validDraft.questions.map((q) => ({
      ...q,
      resolves_at: closes(q.slot),
      market_prob: 0.4,
      market: { source: "kalshi", id: `KXT-${q.slot}`, event_key: `KXT-E${q.slot}`, closes_at: closes(q.slot) },
    })),
  });
}

describe("upsertDraft at rules version 3", () => {
  it("stamps the market columns and keeps the common lock", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, DATE, marketDraft(() => h(10)), 3);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.roundDate, DATE) });
    expect(q!.marketSource).toBe("kalshi");
    expect(q!.marketId).toBe(`KXT-${q!.slot}`);
    expect(q!.marketClosesAt!.toISOString()).toBe(h(10));
    expect(q!.locksAt.toISOString()).toBe(lock.toISOString());
    expect(q!.resolvesAt!.toISOString()).toBe(h(10));
  });
  it("does not apply the version 2 fast-round rule: every market may close the next morning", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft(() => h(13)), 3)).resolves.toBeUndefined();
  });
  it("refuses a market closing inside the answering window", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft((s) => (s === 2 ? h(1) : h(10))), 3)).rejects.toThrow(/market closes before lock \+ 2h/);
  });
  it("refuses a market closing later than lock + 30h", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, marketDraft((s) => (s === 4 ? h(31) : h(10))), 3)).rejects.toThrow(/later than lock \+ 30h/);
  });
  it("refuses a version 3 question without a market", async () => {
    const { db } = await makeTestDb();
    const d = marketDraft(() => h(10));
    delete (d.questions[0] as { market?: unknown }).market;
    await expect(upsertDraft(db, DATE, d, 3)).rejects.toThrow(/every version 3 question names its market/);
  });
  it("version 2 drafts are untouched by the market field", async () => {
    const { db } = await makeTestDb();
    await expect(upsertDraft(db, DATE, DraftSchema.parse(validDraft), 2)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-draft-v3`
Expected: FAIL — `market` is stripped by the schema; the first test's `marketSource` is null.

- [ ] **Step 3: Implement**

In `DraftQuestionSchema` (after `topic_key`):
```ts
    // The exchange market this question IS (design 2026-09-10 §5). Required
    // at rules version 3, refused by upsertDraft when absent there; ignored
    // at 1 and 2.
    market: z.object({
      source: z.enum(["kalshi", "polymarket"]),
      id: z.string().min(1),
      event_key: z.string().min(1),
      closes_at: z.iso.datetime({ offset: true }),
    }).optional(),
```

In `upsertDraft`, replace the version 2 fast-round block and extend the row map:
```ts
  if (rulesVersion === 2) {
    const fast = checkFastRound(draft.questions, { fastBy: fastResolveBy(date), voidAt: voidDeadline(date) });
    if (fast) throw new Error(fast);
  }
  if (rulesVersion >= 3) {
    // The market window (design 2026-09-10 §5.2) replaces the fast-round
    // rule: every question closes between lock + 2h and lock + 30h.
    const minClose = locksAtDefault.getTime() + 2 * 3_600_000;
    const maxClose = locksAtDefault.getTime() + 30 * 3_600_000;
    for (const q of draft.questions) {
      if (!q.market) throw new Error(`slot ${q.slot}: every version 3 question names its market`);
      const t = Date.parse(q.market.closes_at);
      if (t < minClose) throw new Error(`slot ${q.slot}: market closes before lock + 2h`);
      if (t > maxClose) throw new Error(`slot ${q.slot}: market closes later than lock + 30h`);
    }
  }
```
and in the returned row object add:
```ts
      marketSource: q.market?.source ?? null,
      marketId: q.market?.id ?? null,
      marketEventKey: q.market?.event_key ?? null,
      marketClosesAt: q.market ? new Date(q.market.closes_at) : null,
```
`resolveBy` for version 3 rows becomes the market close plus six hours, so the existing "resolve by" semantics point at a real instant:
```ts
      resolveBy: q.market ? new Date(Date.parse(q.market.closes_at) + 6 * 3_600_000) : resolveBy,
```

`lockFromResolvesAt` already leaves the lock at `locksAtDefault` when `resolves_at` is later than it, which every version 3 close is, so the common-window check passes unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-draft`
Expected: the new file and the existing `pipeline-draft.test.ts` both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/draft.ts apps/api/test/pipeline-draft-v3.test.ts
git commit -m "feat(pipeline): version 3 drafts carry their market and use the market window

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 8: The voice call and a text-only taste gate

**Files:**
- Create: `apps/api/src/pipeline/voice.ts`
- Modify: `apps/api/src/pipeline/gauntlet/taste.ts` (extract `tasteTexts`)
- Test: `apps/api/test/pipeline-voice.test.ts` (create), `apps/api/test/gauntlet-taste.test.ts` (add one case)

**Interfaces:**
- Produces:
  ```ts
  // voice.ts
  export interface VoiceInput { slot: number; title: string; rules: string; category: Category; isBigOne: boolean }
  export interface Voiced { slot: number; text: string; context: string }
  export const VOICE_PROMPT_VERSION = "voice-v1";
  export async function voiceQuestions(deps: PipelineDeps, date: string, inputs: VoiceInput[]): Promise<Voiced[]>;  // throws on a bad response
  // taste.ts
  export async function tasteTexts(deps: PipelineDeps, texts: string[]): Promise<{ allowed: boolean[]; detail: string | null }>;
  ```
  `tasteCheck` keeps its signature and is reimplemented over `tasteTexts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/api/test/pipeline-voice.test.ts
import { describe, it, expect } from "vitest";
import { voiceQuestions, VOICE_PROMPT_VERSION } from "../src/pipeline/voice";
import type { PipelineDeps } from "../src/pipeline";

function depsWith(structured: NonNullable<PipelineDeps["claude"]>["structured"]): PipelineDeps {
  return {
    db: null as unknown as PipelineDeps["db"],
    telegram: { send: async () => {} },
    claude: { structured },
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", critic: "c", preflight: "p", probe: "pr", taste: "t", voice: "claude-sonnet-5" },
    now: () => new Date("2026-09-10T21:00:00Z"),
    workflows: { start: async () => {} },
  };
}

const inputs = [1, 2, 3, 4, 5].map((slot) => ({
  slot, title: `Will the maximum temperature be 87-88° on Sep 11, 2026? — NYC ${slot}`, rules: "Per the NWS daily climate report for Central Park.",
  category: "weather" as const, isBigOne: slot === 5,
}));

describe("voiceQuestions", () => {
  it("sends every title and rule, no web search, low effort, and returns five voiced rows by slot", async () => {
    let seen: Record<string, unknown> = {};
    const deps = depsWith(async (call) => {
      seen = call as unknown as Record<string, unknown>;
      return { questions: inputs.map((i) => ({ slot: i.slot, text: `Will Central Park reach 87°F on Thursday? (${i.slot})`, context: "The forecast high is 86." })) };
    });
    const out = await voiceQuestions(deps, "2026-09-10", inputs);
    expect(seen.model).toBe("claude-sonnet-5");
    expect(seen.webSearch).toBeUndefined();
    expect(seen.effort).toBe("low");
    expect(String(seen.user)).toContain("NYC 3");
    expect(String(seen.user)).toContain("NWS daily climate report");
    expect(out.map((v) => v.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0]!.text).toMatch(/\?$/);
  });
  it("throws when a slot is missing or a text is too short", async () => {
    const deps = depsWith(async () => ({ questions: inputs.slice(0, 4).map((i) => ({ slot: i.slot, text: "Will it?", context: "" })) }));
    await expect(voiceQuestions(deps, "2026-09-10", inputs)).rejects.toThrow(/voice/);
  });
  it("has a prompt version", () => {
    expect(VOICE_PROMPT_VERSION).toBe("voice-v1");
  });
});
```

Add to `apps/api/test/gauntlet-taste.test.ts` (import `tasteTexts` beside `tasteCheck`; follow the file's existing `deps` construction):
```ts
  it("tasteTexts judges plain strings and fails closed on an unreadable reply", async () => {
    const good = await tasteTexts(depsReturning({ verdicts: [{ index: 0, allowed: true, reason: "" }, { index: 1, allowed: false, reason: "private individual" }] }), ["Will it rain?", "Will my neighbour move?"]);
    expect(good).toEqual({ allowed: [true, false], detail: null });
    const bad = await tasteTexts(depsReturning({ nope: true }), ["Will it rain?"]);
    expect(bad.allowed).toEqual([false]);
    expect(bad.detail).toMatch(/could not be read/);
  });
```
`depsReturning` is whatever helper the file already uses to build deps around a canned `structured` response; if it has none, add one at the top of the file mirroring `depsWith` above.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- pipeline-voice gauntlet-taste`
Expected: FAIL — `voice` module missing; `tasteTexts` is not exported. (The `models.voice` field also fails typecheck until Step 3 adds it.)

- [ ] **Step 3: Implement**

Add `voice: string;` to `PipelineDeps.models` in `apps/api/src/pipeline/index.ts` (comment: `// Sonnet 5, no search — rewrites exchange titles in the app's voice`), read it in `apps/api/src/worker.ts` as `voice: env.PIPELINE_VOICE_MODEL ?? "claude-sonnet-5"`, add `PIPELINE_VOICE_MODEL?: string` to `WorkerEnv`, and add `"PIPELINE_VOICE_MODEL": "claude-sonnet-5"` to `apps/api/wrangler.jsonc` vars. Grep the test tree for object literals that build `models:` (`grep -rn "taste: \"" apps/api/test`) and add `voice: "v"` to each so typecheck passes.

```ts
// apps/api/src/pipeline/voice.ts
// The voice call (design 2026-09-10 §5.4): five exchange titles in, five
// questions in the app's register out. It may not change what is asked.
import { z } from "zod";
import type { PipelineDeps } from "./index";
import type { Category } from "./exchanges/types";

export const VOICE_PROMPT_VERSION = "voice-v1";

export interface VoiceInput { slot: number; title: string; rules: string; category: Category; isBigOne: boolean }
export interface Voiced { slot: number; text: string; context: string }

const VoiceSchema = z.object({
  questions: z.array(z.object({
    slot: z.number().int().min(1).max(5),
    text: z.string().min(10).max(160).regex(/\?$/, "a question ends with a question mark"),
    context: z.string().max(240),
  })).length(5).refine((rows) => new Set(rows.map((r) => r.slot)).size === 5, "slots must be exactly 1..5"),
});

const voiceJsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object",
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 5 },
          text: { type: "string", description: "The question, plain English, one sentence, ending in a question mark, at most 160 characters." },
          context: { type: "string", description: "One neutral sentence of background a player could use, at most 240 characters. Empty if nothing is worth saying." },
        },
        required: ["slot", "text", "context"], additionalProperties: false,
      },
    },
  },
  required: ["questions"], additionalProperties: false,
};

function systemPrompt(date: string): string {
  return `You write the daily round for ORACLE, a prediction game. Tonight's five questions are live real-money markets. For each one, rewrite the exchange's title as a single plain-English yes/no question a stranger would understand, and add one neutral sentence of context.
Rules:
- Ask EXACTLY what the market asks. Keep every number, date, team, threshold and unit. Do not widen, narrow or reinterpret.
- Name the day in words when the market names a date (the round is dated ${date} ET and closes at noon ET the following day).
- Plain words. No inscriptions, no flourishes, no exclamation marks. Ending in a question mark.
- Context is one sentence of fact, never a hint about the answer.
Call the oracle_voice tool exactly once with one entry per slot 1 through 5.`;
}

export async function voiceQuestions(deps: PipelineDeps, date: string, inputs: VoiceInput[]): Promise<Voiced[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const user = inputs
    .map((i) => `[slot ${i.slot}${i.isBigOne ? " · THE BIG ONE" : ""} · ${i.category}]\nTITLE: ${i.title}\nRULES: ${i.rules.slice(0, 1200)}`)
    .join("\n\n");
  const response = await deps.claude.structured({
    model: deps.models.voice,
    system: systemPrompt(date),
    user,
    schemaName: "oracle_voice",
    schema: voiceJsonSchema,
    effort: "low",
  });
  const parsed = VoiceSchema.safeParse(response);
  if (!parsed.success) throw new Error(`voice: response failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return [...parsed.data.questions].sort((a, b) => a.slot - b.slot);
}
```

In `apps/api/src/pipeline/gauntlet/taste.ts`, extract the model call and verdict parsing into `tasteTexts` and make `tasteCheck` a wrapper:

```ts
export async function tasteTexts(deps: PipelineDeps, texts: string[]): Promise<{ allowed: boolean[]; detail: string | null }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  if (texts.length === 0) return { allowed: [], detail: null };
  const refuse = (detail: string) => ({ allowed: texts.map(() => false), detail });
  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: deps.models.taste, system: SYSTEM,
      user: `${texts.map((t, i) => `[${i}] ${t}`).join("\n")}\n\nReturn one verdict per candidate now.`,
      schemaName: "taste_verdicts", schema: tasteJsonSchema,
    });
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return refuse(`the taste gate could not be reached, so the batch was refused: ${err instanceof Error ? err.message : String(err)}`);
  }
  const parsed = TasteSchema.safeParse(response);
  if (!parsed.success) return refuse("the taste gate's response could not be read, so the batch was refused");
  const byIndex = new Map(parsed.data.verdicts.map((v) => [v.index, v]));
  if (texts.some((_, i) => !byIndex.has(i))) return refuse("the taste gate did not judge every candidate, so the batch was refused");
  return { allowed: texts.map((_, i) => byIndex.get(i)!.allowed), detail: null };
}

export async function tasteCheck(deps: PipelineDeps, judged: Judged[]): Promise<{ passed: Judged[]; rejected: Rejection[] }> {
  const { allowed, detail } = await tasteTexts(deps, judged.map((j) => j.candidate.text));
  if (detail !== null) return rejectAll(judged, detail);
  const passed: Judged[] = [];
  const rejected: Rejection[] = [];
  judged.forEach((j, i) => {
    if (allowed[i]) passed.push(j);
    else rejected.push({ text: j.candidate.text, reason: "taste", detail: "refused by the taste gate" });
  });
  return { passed, rejected };
}
```
The per-candidate `reason` string from the model is no longer surfaced on a rejection (it was `v.reason || "refused by the taste gate"`); if an existing taste test asserts on a model-supplied reason, keep the reasons in `tasteTexts`'s return as `reasons: string[]` and thread them through.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-voice gauntlet-taste` then `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/voice.ts apps/api/src/pipeline/gauntlet/taste.ts apps/api/src/pipeline/index.ts apps/api/src/worker.ts apps/api/wrangler.jsonc apps/api/test
git commit -m "feat(pipeline): the voice call, and a text-only taste gate

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 9: The market round — orchestration, workflow and narration

**Files:**
- Create: `apps/api/src/pipeline/market-round.ts`
- Modify: `apps/api/src/pipeline/workflows.ts` (`inlineStarter`: `author` → `runMarketRound`)
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts` (`AuthoringWorkflow.run` body)
- Modify: `apps/api/src/pipeline/index.ts` (`PipelineDeps.exchangeFeeds?`)
- Test: `apps/api/test/market-round.test.ts` (create)

**Interfaces:**
- Consumes: `KALSHI_FEED`, `kalshiEvent` (Task 4), `POLYMARKET_FEED` (Task 5), `eligible`, `selectFive` (Task 6), `upsertDraft`, `DraftSchema` (Task 7), `voiceQuestions`, `tasteTexts` (Task 8).
- Produces:
  ```ts
  export const DEFAULT_EXCHANGES: ExchangeFeed[];                         // [KALSHI_FEED, POLYMARKET_FEED]
  export interface MarketRoundResult { published: boolean; fetched: number; eligible: number; reason: string | null }
  export async function fetchCandidates(deps: PipelineDeps, date: string): Promise<MarketCandidate[]>;   // both feeds, eligibility applied, sorted by volume desc
  export async function buildMarketDraft(deps: PipelineDeps, date: string, pool: MarketCandidate[]): Promise<{ draft: Draft | null; reason: string | null }>;
  export async function commitMarketDraft(deps: PipelineDeps, date: string, draft: Draft): Promise<void>;
  export async function narrateMarketRound(deps: PipelineDeps, date: string, r: MarketRoundResult): Promise<void>;
  export async function runMarketRound(deps: PipelineDeps, date: string): Promise<MarketRoundResult>;
  ```
  `PipelineDeps` gains `exchangeFeeds?: ExchangeFeed[]` (defaults to `DEFAULT_EXCHANGES`) and reads the network through `deps.marketFetch ?? fetch`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/market-round.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { schema } from "../src/db/client";
import { runMarketRound, fetchCandidates, buildMarketDraft } from "../src/pipeline/market-round";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { ExchangeFeed, MarketCandidate } from "../src/pipeline/exchanges/types";
import { noonET, addDays } from "../src/pipeline/clock";

// Authoring runs the evening BEFORE the round date (now is Sept 10, 21:05Z; the
// round is Sept 11), so a context stamped "now" predates the round's opening.
const DATE = "2026-09-11";
const lock = noonET(addDays(DATE, 1));
const h = (n: number) => new Date(lock.getTime() + n * 3_600_000).toISOString();

function cand(id: string, category: MarketCandidate["category"], volume: number, over: Partial<MarketCandidate> = {}): MarketCandidate {
  return {
    source: "kalshi", marketId: id, eventKey: `E-${id}`, seriesKey: "KXT", title: `Will ${id} happen on Friday?`,
    rules: "Resolves per the exchange rules for this market.", url: "https://kalshi.com/markets/kxt", category, prob: 0.4, volume, closesAt: h(10), ...over,
  };
}
const feedOf = (rows: MarketCandidate[], source: ExchangeFeed["source"] = "kalshi"): ExchangeFeed => ({
  source, list: async () => rows, read: async () => ({ settled: false, outcome: null, raw: null }),
});

const SEVEN = [
  cand("nfl", "sports", 240_000), cand("btc", "markets", 200_000), cand("kbo", "sports", 107_000), cand("bb", "culture", 41_000),
  cand("cpi", "news", 35_000), cand("eth", "markets", 11_000), cand("nyc", "weather", 8_400),
];

// A canned Claude: the voice call echoes titles as questions; the taste call allows everything unless told otherwise.
function claudeWith(opts: { refuse?: string[]; calls: string[] }): NonNullable<PipelineDeps["claude"]> {
  return {
    async structured(call) {
      opts.calls.push(call.schemaName);
      if (call.schemaName === "oracle_voice") {
        const slots = [...call.user.matchAll(/\[slot (\d)[^\]]*\]\nTITLE: (.+)/g)];
        return { questions: slots.map((m) => ({ slot: Number(m[1]), text: m[2]!.trim(), context: "Some background." })) };
      }
      if (call.schemaName === "taste_verdicts") {
        const lines = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l));
        return { verdicts: lines.map((l, i) => ({ index: i, allowed: !(opts.refuse ?? []).some((r) => l.includes(r)), reason: "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function depsWith(feeds: ExchangeFeed[], claude: PipelineDeps["claude"], sent: string[]): Promise<PipelineDeps> {
  const { db } = await makeTestDb();
  return {
    db, telegram: { send: async (t) => { sent.push(t); } }, claude,
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", critic: "c", preflight: "p", probe: "pr", taste: "t", voice: "v" },
    now: () => new Date("2026-09-10T21:05:00Z"),
    workflows: inlineStarter(),
    exchangeFeeds: feeds,
    marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
  };
}

describe("fetchCandidates", () => {
  it("pools every feed and applies eligibility against tomorrow's lock", async () => {
    const deps = await depsWith([feedOf(SEVEN), feedOf([cand("poly", "news", 50_000, { source: "polymarket", closesAt: h(1) })], "polymarket")], claudeWith({ calls: [] }), []);
    const out = await fetchCandidates(deps, DATE);
    expect(out.map((c) => c.marketId)).toEqual(["nfl", "btc", "kbo", "bb", "cpi", "eth", "nyc"]); // poly closes inside the window
  });
});

describe("runMarketRound", () => {
  it("publishes a version 3 draft: five questions, voiced, market columns stamped, narrated once", async () => {
    const calls: string[] = []; const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r).toMatchObject({ published: true, fetched: 7, eligible: 7, reason: null });
    expect(calls).toEqual(["oracle_voice", "taste_verdicts"]);
    const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    expect(round!.status).toBe("scheduled");
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => q.marketId)).toEqual(["btc", "bb", "cpi", "nyc", "nfl"]);
    expect(qs[4]!.isBigOne).toBe(true);
    expect(qs.every((q) => q.marketSource === "kalshi" && q.linePYes === null && Number(q.marketProb) === 0.4)).toBe(true);
    expect(qs[0]!.text).toBe("Will btc happen on Friday?");
    expect(qs[0]!.resolutionCriteria).toContain("exchange rules");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("2026-09-11");
    expect(sent[0]).toContain("5 published");
  });
  it("drops a market the taste gate refuses, re-selects once, and publishes", async () => {
    const calls: string[] = []; const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls, refuse: ["bb happen"] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls).toEqual(["oracle_voice", "taste_verdicts", "oracle_voice", "taste_verdicts"]);
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    expect(qs.map((q) => q.marketId)).not.toContain("bb");
  });
  it("falls to the bank (publishes nothing) under five eligible markets, and says so", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN.slice(0, 4))], claudeWith({ calls: [] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r).toMatchObject({ published: false, eligible: 4 });
    expect(r.reason).toMatch(/4 eligible/);
    expect(await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) })).toBeUndefined();
    expect(sent[0]).toContain("bank covers noon");
  });
  it("publishes nothing when a second taste refusal empties the round", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls: [], refuse: ["happen"] }), sent);
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toMatch(/taste/);
  });
  it("does not touch a round that is already committed", async () => {
    const sent: string[] = [];
    const deps = await depsWith([feedOf(SEVEN)], claudeWith({ calls: [] }), sent);
    await runMarketRound(deps, DATE);
    await deps.db.update(schema.rounds).set({ oracleCommittedAt: new Date() }).where(eq(schema.rounds.date, DATE));
    const r = await runMarketRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toMatch(/not editable/);
  });
});

describe("buildMarketDraft", () => {
  it("clamps the author probability into the draft's band and carries the market", async () => {
    const deps = await depsWith([], claudeWith({ calls: [] }), []);
    const { draft } = await buildMarketDraft(deps, DATE, SEVEN.map((c) => ({ ...c, prob: 0.22 })));
    expect(draft!.questions.every((q) => q.author_probability === 0.3 && q.market_prob === 0.22 && q.market?.source === "kalshi")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- market-round`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Add to `PipelineDeps` in `apps/api/src/pipeline/index.ts`:
```ts
  // The exchanges the market round is dealt from (design 2026-09-10 §5.1).
  // Defaults to DEFAULT_EXCHANGES; tests inject canned feeds.
  exchangeFeeds?: ExchangeFeed[];
```
(import the type from `./exchanges/types`).

```ts
// apps/api/src/pipeline/market-round.ts
// The market round (design 2026-09-10 §5): fetch → eligibility → select →
// voice → taste → commit → narrate. One run a night. No model resolver, no
// probe, no retry loop: a night that cannot deal five markets is the bank's.
import { eq } from "drizzle-orm";
import { schema } from "../db/client";
import type { PipelineDeps } from "./index";
import { addDays, noonET } from "./clock";
import { DraftSchema, upsertDraft, type Draft } from "./draft";
import { KALSHI_FEED, kalshiEvent, kalshiCategory } from "./exchanges/kalshi";
import { POLYMARKET_FEED } from "./exchanges/polymarket";
import { eligible, eligibilityWindow, selectFive, SELECT } from "./exchanges/select";
import type { ExchangeFeed, MarketCandidate } from "./exchanges/types";
import { voiceQuestions } from "./voice";
import { tasteTexts } from "./gauntlet/taste";

export const DEFAULT_EXCHANGES: ExchangeFeed[] = [KALSHI_FEED, POLYMARKET_FEED];

export interface MarketRoundResult { published: boolean; fetched: number; eligible: number; reason: string | null }

const SOURCE_NAME = { kalshi: "Kalshi", polymarket: "Polymarket" } as const;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export async function fetchCandidates(deps: PipelineDeps, date: string): Promise<MarketCandidate[]> {
  const locksAt = noonET(addDays(date, 1));
  const fetchFn = deps.marketFetch ?? fetch;
  const feeds = deps.exchangeFeeds ?? DEFAULT_EXCHANGES;
  const window = eligibilityWindow(locksAt);
  const pooled: MarketCandidate[] = [];
  for (const feed of feeds) pooled.push(...(await feed.list(fetchFn, window)));
  return eligible(pooled, locksAt).sort((a, b) => b.volume - a.volume);
}

async function enrich(deps: PipelineDeps, c: MarketCandidate): Promise<MarketCandidate> {
  // Five event reads at most, for the category the series table could not
  // know and the exchange's own settlement source. Best-effort: a failed read
  // keeps the candidate as it was.
  if (c.source !== "kalshi") return c;
  try {
    const ev = await kalshiEvent(deps.marketFetch ?? fetch, c.eventKey);
    const url = ev.settlementSources.find((s) => s.url)?.url;
    return { ...c, category: kalshiCategory(c.seriesKey, ev.category), url: url ?? c.url };
  } catch {
    return c;
  }
}

function toDraft(five: MarketCandidate[], voiced: Array<{ slot: number; text: string; context: string }>, now: Date): Draft {
  return DraftSchema.parse({
    questions: five.map((c, i) => {
      const slot = i + 1;
      const v = voiced.find((x) => x.slot === slot)!;
      return {
        slot,
        category: c.category,
        text: v.text,
        resolution_criteria: `${c.title}\n\n${c.rules || "Resolves per the exchange's rules for this market."}`,
        source_name: SOURCE_NAME[c.source],
        source_url: c.url,
        // Vestigial at version 3: the band is the draft schema's, the number is the market's.
        author_probability: clamp(c.prob, 0.3, 0.7),
        is_big_one: slot === SELECT.ROUND_SIZE,
        market_prob: c.prob,
        resolves_at: c.closesAt,
        ...(v.context.trim() ? { context: { text: v.context.trim(), asOf: now.toISOString(), sourceUrl: c.url } } : {}),
        market: { source: c.source, id: c.marketId, event_key: c.eventKey, closes_at: c.closesAt },
      };
    }),
  });
}

export async function buildMarketDraft(deps: PipelineDeps, date: string, pool: MarketCandidate[]): Promise<{ draft: Draft | null; reason: string | null }> {
  let remaining = pool;
  let refusedSoFar = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const five = selectFive(remaining);
    if (!five) {
      return {
        draft: null,
        reason: refusedSoFar > 0
          ? `the taste gate refused ${refusedSoFar} market${refusedSoFar === 1 ? "" : "s"} and ${remaining.length} remained`
          : `${remaining.length} eligible market${remaining.length === 1 ? "" : "s"} across too few categories`,
      };
    }
    const enriched: MarketCandidate[] = [];
    for (const c of five) enriched.push(await enrich(deps, c));
    const voiced = await voiceQuestions(deps, date, enriched.map((c, i) => ({ slot: i + 1, title: c.title, rules: c.rules, category: c.category, isBigOne: i === 4 })));
    const taste = await tasteTexts(deps, voiced.map((v) => v.text));
    if (taste.detail !== null) return { draft: null, reason: taste.detail };
    const refused = enriched.filter((_, i) => !taste.allowed[i]);
    if (refused.length === 0) return { draft: toDraft(enriched, voiced, deps.now()), reason: null };
    const refusedIds = new Set(refused.map((c) => c.marketId));
    refusedSoFar += refused.length;
    remaining = remaining.filter((c) => !refusedIds.has(c.marketId));
  }
  return { draft: null, reason: "the taste gate refused a market on both passes" };
}

export async function commitMarketDraft(deps: PipelineDeps, date: string, draft: Draft): Promise<void> {
  await upsertDraft(deps.db, date, draft, 3);
}

export async function narrateMarketRound(deps: PipelineDeps, date: string, r: MarketRoundResult): Promise<void> {
  if (r.published) {
    await deps.telegram.send(`${date}: ${r.fetched} markets fetched, ${r.eligible} eligible, 5 published`);
  } else {
    await deps.telegram.send(`⚠ ${date}: no market round — ${r.reason ?? "unknown"} (${r.fetched} fetched, ${r.eligible} eligible); the bank covers noon`);
  }
}

export async function runMarketRound(deps: PipelineDeps, date: string): Promise<MarketRoundResult> {
  const existing = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (existing && (existing.status !== "scheduled" || existing.oracleCommittedAt !== null)) {
    const r = { published: false, fetched: 0, eligible: 0, reason: "round not editable" };
    return r;
  }
  const candidates = await fetchCandidates(deps, date);
  const fetched = candidates.length;
  let result: MarketRoundResult;
  if (candidates.length < SELECT.ROUND_SIZE) {
    result = { published: false, fetched, eligible: candidates.length, reason: `${candidates.length} eligible market${candidates.length === 1 ? "" : "s"}, five needed` };
  } else {
    const { draft, reason } = await buildMarketDraft(deps, date, candidates);
    if (draft) {
      await commitMarketDraft(deps, date, draft);
      result = { published: true, fetched, eligible: candidates.length, reason: null };
    } else {
      result = { published: false, fetched, eligible: candidates.length, reason };
    }
  }
  await narrateMarketRound(deps, date, result);
  return result;
}
```

`fetched` counts eligible candidates after the window filter, which is what the narration needs; the raw pooled count is not kept.

`workflows.ts` — `inlineStarter`'s `author` branch:
```ts
      if (kind === "author") {
        const { runMarketRound } = await import("./market-round");
        await runMarketRound(deps, params.date);
      }
```

`workflow-entrypoints.ts` — replace the body of `AuthoringWorkflow.run` with the market steps (the gauntlet imports it used become unused; Task 17 deletes them):
```ts
export class AuthoringWorkflow extends WorkflowEntrypoint<WorkerEnv, Params> {
  async run(event: Readonly<WorkflowEvent<Params>>, step: WorkflowStep) {
    const deps = metered(this.env);
    if (!deps) return;
    const { date } = event.payload;
    const editable = await durableStep(step, "editable", POLICY.db, deps, async () => {
      const r = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
      return !(r && (r.status !== "scheduled" || r.oracleCommittedAt !== null));
    });
    if (!editable) return;
    const candidates = await durableStep(step, "candidates", POLICY.sourceFetch, deps, () => fetchCandidates(deps, date));
    const built = await durableStep(step, "draft", POLICY.model, deps, async () => {
      if (candidates.length < 5) return { draft: null, reason: `${candidates.length} eligible markets, five needed` };
      return buildMarketDraft(deps, date, candidates);
    });
    const result = await durableStep(step, "commit", POLICY.db, deps, async () => {
      if (!built.draft) return { published: false, fetched: candidates.length, eligible: candidates.length, reason: built.reason };
      await commitMarketDraft(deps, date, built.draft);
      return { published: true, fetched: candidates.length, eligible: candidates.length, reason: null };
    });
    await durableStep(step, "narrate", POLICY.narrate, deps, () => narrateMarketRound(deps, date, result));
  }
}
```
Import `fetchCandidates`, `buildMarketDraft`, `commitMarketDraft`, `narrateMarketRound` from `./market-round`, and `eq`/`schema` as the file's other classes do. `Draft` is JSON-serialisable, so the `draft` step's return is a valid `Rpc.Serializable`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- market-round pipeline-workflows admin-workflows` then `pnpm typecheck`.
Expected: PASS. If `admin-workflows.test.ts` or `pipeline-workflows.test.ts` assert that the `author` kind runs the gauntlet, update those assertions to the market round (they should now see `oracle_voice` and `taste_verdicts` calls, not `generate`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/market-round.ts apps/api/src/pipeline/workflows.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/src/pipeline/index.ts apps/api/test
git commit -m "feat(pipeline): the market round — dealt from exchanges, voiced, tasted, committed

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 10: One authoring run a night; no probe on a version 3 round

**Files:**
- Modify: `apps/api/src/pipeline/state.ts` (`loadPipelineState`, `decideActions`)
- Test: `apps/api/test/pipeline-decide.test.ts` (modify), `apps/api/test/pipeline-tick.test.ts` (modify if it asserts hourly authoring)

**Interfaces:**
- Produces: `PipelineState.openRound.rulesVersion: number`; `decideActions` emits `author` only when `hour === 17 && minute < 10`; emits `probe` only when `openRound.rulesVersion < 3`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/pipeline-decide.test.ts`, using the file's existing state-builder helper (it constructs a `PipelineState`; add `rulesVersion` to its `openRound` shape):
```ts
describe("authoring at version 3", () => {
  it("fires once, at 17:00, and not at 18:00", () => {
    const state = baseState({ scheduledDates: [] });
    expect(decideActions({ date: "2026-09-10", hour: 17, minute: 3 }, state).some((a) => a.kind === "author")).toBe(true);
    expect(decideActions({ date: "2026-09-10", hour: 18, minute: 3 }, state).some((a) => a.kind === "author")).toBe(false);
    expect(decideActions({ date: "2026-09-10", hour: 17, minute: 12 }, state).some((a) => a.kind === "author")).toBe(false);
  });
});
describe("probe at version 3", () => {
  it("never fires on a version 3 open round", () => {
    const state = baseState({ openRound: { date: "2026-09-10", lockPassed: false, needsForecast: false, probeIds: ["q1"], rulesVersion: 3 } });
    expect(decideActions({ date: "2026-09-10", hour: 16, minute: 3 }, state).some((a) => a.kind === "probe")).toBe(false);
  });
  it("still fires on a version 2 open round", () => {
    const state = baseState({ openRound: { date: "2026-09-10", lockPassed: false, needsForecast: false, probeIds: ["q1"], rulesVersion: 2 } });
    expect(decideActions({ date: "2026-09-10", hour: 16, minute: 3 }, state).some((a) => a.kind === "probe")).toBe(true);
  });
});
```
If the file has no `baseState` helper, add one that returns `{ openRound: null, lockedRound: null, scheduledDates: [], bankCount: 5, claudeAvailable: true, ...over }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- pipeline-decide`
Expected: FAIL — author fires at 18:00; `rulesVersion` is not a known field.

- [ ] **Step 3: Implement**

In `state.ts`:
```ts
// PipelineState.openRound gains:
    rulesVersion: number;
// loadPipelineState, when building openRound:
      rulesVersion: openRoundRow.rulesVersion,
// decideActions — the probe condition gains one clause:
    state.openRound.rulesVersion < 3 &&
// decideActions — the author block becomes:
  // AUTHOR tomorrow — ONCE, at 17:00 (design 2026-09-10 §5). A failed night
  // is narrated by the run itself and by the 23:00 alert; the bank covers noon.
  if (!state.scheduledDates.includes(tomorrow) && hour === 17 && minute < 10) {
    actions.push({ kind: "author", date: tomorrow });
  }
```
Update the comment above `PROBE_INTERVAL_HOURS` to say the probe is a version 1 and 2 mechanism.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-decide pipeline-tick`
Expected: PASS. Any existing test that expected an `author` action at 18:00–23:00 is asserting the retired behaviour; change its hour to 17.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/state.ts apps/api/test
git commit -m "feat(pipeline): author once a night at 17:00; no probe on version 3 rounds

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 11: The line

**Files:**
- Create: `apps/api/src/pipeline/line.ts`
- Modify: `apps/api/src/pipeline/index.ts` (`forecast` action)
- Modify: `apps/api/src/routes/admin.ts` (add `POST /rounds/:date/line`)
- Test: `apps/api/test/pipeline-line.test.ts` (create)

**Interfaces:**
- Consumes: `clampLine` from `@oracle/core` (Task 1).
- Produces: `export async function commitLine(db: Db, date: string): Promise<{ written: number }>` — idempotent; writes `questions.line_p_yes` for every version 3 question of the round whose `oracle_p_yes` is set and whose line is still null.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/pipeline-line.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { commitLine } from "../src/pipeline/line";

const DATE = "2026-09-10";
// Migration 0009's commitment guard makes oracle_p_yes immutable once the
// round carries oracle_committed_at, so every fixture writes the
// probabilities FIRST and marks the round committed LAST.
type Probs = ReadonlyArray<readonly [oracle: number | null, market: number | null]>;
async function seeded(rulesVersion: number, probs: Probs) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  for (const [i, [oracle, market]] of probs.entries()) {
    await db.update(schema.questions)
      .set({ oracleProbYes: oracle === null ? null : String(oracle), marketProb: market === null ? null : String(market) })
      .where(eq(schema.questions.id, rows[i]!.id));
  }
  await db.update(schema.rounds).set({ rulesVersion, status: "scheduled", oracleCommittedAt: new Date("2026-09-10T14:00:00Z") }).where(eq(schema.rounds.date, DATE));
  return { db, rows };
}
const FIVE: Probs = [[0.40, 0.35], [0.10, 0.35], [0.70, 0.35], [0.60, null], [0.02, 0.10]];
const EXPECTED_LINES = [0.40, 0.20, 0.50, 0.60, 0.05];

describe("commitLine", () => {
  it("writes the clamped line for every committed version 3 question", async () => {
    const { db } = await seeded(3, FIVE);
    expect(await commitLine(db, DATE)).toEqual({ written: 5 });
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.map((q) => Number(q.linePYes))).toEqual(EXPECTED_LINES);
  });
  it("is idempotent: a second run writes nothing and changes nothing", async () => {
    const { db, rows } = await seeded(3, FIVE);
    await commitLine(db, DATE);
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, rows[0]!.id) });
    expect(Number(q!.linePYes)).toBe(0.40);
  });
  it("skips questions without a forecast", async () => {
    const { db } = await seeded(3, [[0.5, 0.5], [null, 0.5], [null, 0.5], [null, 0.5], [null, 0.5]]);
    expect(await commitLine(db, DATE)).toEqual({ written: 1 });
  });
  it("skips version 2 rounds entirely", async () => {
    const { db } = await seeded(2, FIVE);
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
  });
  it("skips a round that is not yet committed", async () => {
    const { db } = await makeTestDb();
    const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
    for (const r of rows) await db.update(schema.questions).set({ oracleProbYes: "0.5", marketProb: "0.5" }).where(eq(schema.questions.id, r.id));
    expect(await commitLine(db, DATE)).toEqual({ written: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-line`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/api/src/pipeline/line.ts
// The house line (design 2026-09-10 §5.5): oracle_p_yes held inside the
// market band. Runs after the forecast commit and on every forecast tick
// until every question has one; a line is written once and never rewritten.
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { clampLine } from "@oracle/core";
import { schema, type Db } from "../db/client";

export async function commitLine(db: Db, date: string): Promise<{ written: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round || round.rulesVersion < 3 || round.oracleCommittedAt === null) return { written: 0 };
  const pending = await db.query.questions.findMany({
    where: and(eq(schema.questions.roundDate, date), isNull(schema.questions.linePYes), isNotNull(schema.questions.oracleProbYes)),
  });
  let written = 0;
  for (const q of pending) {
    const line = clampLine(Number(q.oracleProbYes), q.marketProb === null ? null : Number(q.marketProb));
    const rows = await db.update(schema.questions)
      .set({ linePYes: String(line) })
      .where(and(eq(schema.questions.id, q.id), isNull(schema.questions.linePYes)))
      .returning({ id: schema.questions.id });
    written += rows.length;
  }
  return { written };
}
```

In `apps/api/src/pipeline/index.ts`, the `forecast` case:
```ts
        case "forecast":
          await stampOracleForecast(metered, action.date);
          // The line follows the commit on the same tick (design 2026-09-10 §5.5)
          // and on every later forecast tick until every question carries one.
          await commitLine(deps.db, action.date);
          done.push(`forecast:${action.date}`);
          break;
```

In `apps/api/src/routes/admin.ts`, beside `POST /rounds/:date/forecast`:
```ts
  .post("/rounds/:date/line", async (c) => {
    const { db } = c.get("deps");
    const r = await commitLine(db, c.req.param("date"));
    return c.json(r);
  })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-line pipeline-tick admin-rounds` and `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/line.ts apps/api/src/pipeline/index.ts apps/api/src/routes/admin.ts apps/api/test/pipeline-line.test.ts
git commit -m "feat(pipeline): commit the house line after the forecast

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 12: Settle market questions from the exchange

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts` (`resolveOne` branches on `market_source`)
- Test: `apps/api/test/pipeline-resolve-exchange.test.ts` (create)

**Interfaces:**
- Consumes: `ExchangeFeed.read` (Tasks 4, 5), `resolveQuestion` (`../resolution`).
- Produces: `export async function resolveFromExchange(deps: PipelineDeps, questionId: string): Promise<boolean>` — true when the question was resolved on this pass. `resolveOne` calls it for questions with `market_source` set and `resolveWithClaude` otherwise. Evidence written: `{ source, market_id, read_at, outcome, raw }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/pipeline-resolve-exchange.test.ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveOne, resolveFromExchange } from "../src/pipeline/resolve";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { ExchangeFeed, SettlementRead } from "../src/pipeline/exchanges/types";

const DATE = "2026-09-10";
async function depsWith(read: (id: string) => Promise<SettlementRead>, claudeCalls: string[]): Promise<{ deps: PipelineDeps; qId: string }> {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, status: "locked" }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, DATE));
  await db.update(schema.questions).set({ marketSource: "kalshi", marketId: "KXT-1", marketEventKey: "KXT", linePYes: "0.4" }).where(eq(schema.questions.id, rows[0]!.id));
  const feed: ExchangeFeed = { source: "kalshi", list: async () => [], read: (_f, id) => read(id) };
  const deps: PipelineDeps = {
    db, telegram: { send: async () => {} },
    claude: { structured: async (call) => { claudeCalls.push(call.schemaName); return { outcome: "unverifiable", quotes: [], reasoning: "" }; } },
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", critic: "c", preflight: "p", probe: "pr", taste: "t", voice: "v" },
    now: () => new Date("2026-09-12T01:00:00Z"), workflows: inlineStarter(), exchangeFeeds: [feed],
    marketFetch: (async () => { throw new Error("no network"); }) as unknown as typeof fetch,
  };
  return { deps, qId: rows[0]!.id };
}

describe("resolveFromExchange", () => {
  it("resolves a settled yes and stores the exchange record as evidence", async () => {
    const { deps, qId } = await depsWith(async (id) => ({ settled: true, outcome: "yes", raw: { ticker: id, status: "finalized", result: "yes" } }), []);
    expect(await resolveFromExchange(deps, qId)).toBe(true);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("resolved");
    expect(q!.outcome).toBe("yes");
    expect(q!.resolutionEvidence).toMatchObject({ source: "kalshi", market_id: "KXT-1", outcome: "yes", raw: { result: "yes" } });
  });
  it("leaves an unsettled market locked", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: false, outcome: null, raw: {} }), []);
    expect(await resolveFromExchange(deps, qId)).toBe(false);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("locked");
  });
  it("voids what the exchange voided", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "void", raw: {} }), []);
    await resolveFromExchange(deps, qId);
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, qId) });
    expect(q!.status).toBe("void");
  });
  it("throws when the question's source has no feed", async () => {
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "yes", raw: {} }), []);
    await deps.db.update(schema.questions).set({ marketSource: "polymarket" }).where(eq(schema.questions.id, qId));
    await expect(resolveFromExchange(deps, qId)).rejects.toThrow(/no feed for polymarket/);
  });
});

describe("resolveOne", () => {
  it("routes a market question to the exchange and never calls a model", async () => {
    const calls: string[] = [];
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "no", raw: {} }), calls);
    const r = await resolveOne(deps, qId);
    expect(r.resolved).toBe(true);
    expect(calls).toEqual([]);
  });
  it("captures a read failure into the outcome instead of throwing", async () => {
    const { deps, qId } = await depsWith(async () => { throw new Error("503 from kalshi"); }, []);
    const r = await resolveOne(deps, qId);
    expect(r.resolved).toBe(false);
    expect(r.error).toMatch(/503/);
  });
  it("still routes an authored question to the model resolver", async () => {
    const calls: string[] = [];
    const { deps, qId } = await depsWith(async () => ({ settled: true, outcome: "no", raw: {} }), calls);
    await deps.db.update(schema.questions).set({ marketSource: null, marketId: null }).where(eq(schema.questions.id, qId));
    await resolveOne(deps, qId);
    expect(calls).toEqual(["resolution", "resolution"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-resolve-exchange`
Expected: FAIL — `resolveFromExchange` is not exported.

- [ ] **Step 3: Implement**

In `apps/api/src/pipeline/resolve.ts`:
```ts
import { DEFAULT_EXCHANGES } from "./market-round";
import type { ExchangeSource } from "./exchanges/types";

/**
 * Exchange settlement (design 2026-09-10 §5.6). No model: the market this
 * question IS reports its own result. Unsettled stays locked and is retried
 * hourly by the same action that retries the model resolver.
 */
export async function resolveFromExchange(deps: PipelineDeps, questionId: string): Promise<boolean> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);
  if (!q.marketSource || !q.marketId) throw new Error(`resolve: ${questionId} is not a market question`);
  const feeds = deps.exchangeFeeds ?? DEFAULT_EXCHANGES;
  const feed = feeds.find((f) => f.source === (q.marketSource as ExchangeSource));
  if (!feed) throw new Error(`resolve: no feed for ${q.marketSource}`);
  const read = await feed.read(deps.marketFetch ?? fetch, q.marketId);
  if (!read.settled || read.outcome === null) return false;
  // Same late-write guard as the model path: a void may have landed meanwhile.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;
  await resolveQuestion(deps.db, questionId, read.outcome, {
    source: q.marketSource, market_id: q.marketId, read_at: deps.now().toISOString(), outcome: read.outcome, raw: read.raw,
  });
  return true;
}
```
and in `resolveOne`, replace the single call:
```ts
  try {
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId), columns: { marketSource: true } });
    resolved = q?.marketSource ? await resolveFromExchange(deps, questionId) : await resolveWithClaude(deps, questionId);
  } catch (err) {
```
`market-round.ts` must not import from `resolve.ts` (it does not), so the import above creates no cycle. If a cycle does appear at typecheck, move `DEFAULT_EXCHANGES` into `exchanges/index.ts` and import it from there in both files.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-resolve` (both files) and `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/resolve.ts apps/api/test/pipeline-resolve-exchange.test.ts
git commit -m "feat(pipeline): settle market questions from the exchange, not a model

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---
### Task 13: Pay the fortune at resolution; the house delta at settlement

**Files:**
- Modify: `apps/api/src/resolution.ts` (`resolveQuestion` pays each staked prediction once)
- Modify: `apps/api/src/settlement.ts` (`settleRound` writes `rounds.house_delta`)
- Test: `apps/api/test/settlement-fortune.test.ts` (create)

**Interfaces:**
- Consumes: `payout` from `@oracle/core` (Task 1); columns from Task 3.
- Produces: `export async function payFortune(db: Db, questionId: string, outcome: "yes" | "no" | "void", now: Date): Promise<{ paid: number }>` in `resolution.ts`, called by `resolveQuestion` after points are written. Every prediction with a non-null `stake` is claimed `WHERE settled_at IS NULL`, given `payout` and `settled_at`, and its `delta` added to `users.fortune`. `settleRound` writes `rounds.house_delta = Σ(stake − payout)` once, guarded on null.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/settlement-fortune.test.ts
import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { resolveQuestion, payFortune } from "../src/resolution";
import { settleRound } from "../src/settlement";

const DATE = "2026-09-10";

async function stagedRound() {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  for (const r of rows) await db.update(schema.questions).set({ linePYes: "0.35" }).where(eq(schema.questions.id, r.id));
  const [alice] = await db.insert(schema.users).values({}).returning();
  const [bob] = await db.insert(schema.users).values({}).returning();
  // alice: YES at 70 on every card (stake 40 from 1000, 80 on the Big One); bob: NO at 55 (stake 10 / 20)
  for (const r of rows) {
    await db.insert(schema.predictions).values([
      { questionId: r.id, userId: alice!.id, answer: true, confidence: 70, fortuneAtSeal: 1000, stake: r.slot === 5 ? 80 : 40, linePYes: "0.35" },
      { questionId: r.id, userId: bob!.id, answer: false, confidence: 55, fortuneAtSeal: 1000, stake: r.slot === 5 ? 20 : 10, linePYes: "0.35" },
    ]);
  }
  return { db, rows, alice: alice!, bob: bob! };
}

describe("payFortune via resolveQuestion", () => {
  it("pays a YES outcome: alice wins at 1.857× on top, bob loses his stake", async () => {
    const { db, rows, alice, bob } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    const a = await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) });
    const b = await db.query.users.findFirst({ where: eq(schema.users.id, bob.id) });
    expect(a!.fortune).toBe(1074); // +round(40 × 0.65/0.35) = +74
    expect(b!.fortune).toBe(990);
    const pa = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)) });
    expect(pa!.payout).toBe(114);
    expect(pa!.settledAt).not.toBeNull();
  });
  it("pays a NO outcome: bob wins at 0.538× on top, alice loses", async () => {
    const { db, rows, alice, bob } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "no");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(960);
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, bob.id) }))!.fortune).toBe(1005); // +round(10 × 0.35/0.65) = +5
  });
  it("returns the stake on a void", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "void");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1000);
    const pa = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, rows[0]!.id), eq(schema.predictions.userId, alice.id)) });
    expect(pa!.payout).toBe(40);
  });
  it("never pays twice: a second payFortune claims nothing", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    expect(await payFortune(db, rows[0]!.id, "yes", new Date())).toEqual({ paid: 0 });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1074);
  });
  it("a forced re-resolution leaves the fortune untouched", async () => {
    const { db, rows, alice } = await stagedRound();
    await resolveQuestion(db, rows[0]!.id, "yes");
    await resolveQuestion(db, rows[0]!.id, "no", null, { force: true });
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1074);
  });
  it("ignores unstaked predictions (version 2 rows, or a lineless round)", async () => {
    const { db, rows, alice } = await stagedRound();
    await db.update(schema.predictions).set({ stake: null, linePYes: null }).where(eq(schema.predictions.questionId, rows[0]!.id));
    await resolveQuestion(db, rows[0]!.id, "yes");
    expect((await db.query.users.findFirst({ where: eq(schema.users.id, alice.id) }))!.fortune).toBe(1000);
  });
});

describe("settleRound writes the house delta", () => {
  it("is Σ(stake − payout) over the round, written once", async () => {
    const { db, rows } = await stagedRound();
    for (const r of rows) await resolveQuestion(db, r.id, r.slot === 5 ? "no" : "yes");
    // slots 1-4 YES: alice +74 each, bob −10 each → house −64 × 4 = −256
    // slot 5 NO: alice −80, bob +round(20 × 0.538) = +11 → house +69
    await settleRound(db, DATE);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.houseDelta).toBe(-187);
    await settleRound(db, DATE); // idempotent
    expect((await db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) }))!.houseDelta).toBe(-187);
  });
  it("keeps a version 3 user_rounds row written at the first seal", async () => {
    const { db, rows, alice } = await stagedRound();
    await db.insert(schema.userRounds).values({ userId: alice.id, date: DATE, vigilMult: "1", fortuneAtOpen: 1000 });
    for (const r of rows) await resolveQuestion(db, r.id, "yes");
    await settleRound(db, DATE);
    const ur = await db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, alice.id), eq(schema.userRounds.date, DATE)) });
    expect(ur!.fortuneAtOpen).toBe(1000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- settlement-fortune`
Expected: FAIL — `payFortune` is not exported; fortunes stay at 1000.

- [ ] **Step 3: Implement**

In `apps/api/src/resolution.ts`:
```ts
import { and, eq, isNull, sql } from "drizzle-orm";
import { brier, questionPoints, payout as fortunePayout, PIPELINE_LINES } from "@oracle/core";

/**
 * The fortune pass (design 2026-09-10 §5.6). Each staked prediction is
 * claimed WHERE settled_at IS NULL, so a retried resolve, a forced
 * re-resolution or an overlapping tick pays nobody twice. users.fortune is
 * written here and nowhere else.
 */
export async function payFortune(db: Db, questionId: string, outcome: "yes" | "no" | "void", now: Date): Promise<{ paid: number }> {
  const staked = await db.query.predictions.findMany({
    where: and(eq(schema.predictions.questionId, questionId), isNull(schema.predictions.settledAt)),
  });
  let paid = 0;
  for (const p of staked) {
    if (p.stake === null || p.linePYes === null) continue;
    const pay = fortunePayout({ stake: p.stake, answer: p.answer, line: Number(p.linePYes), outcome });
    const claimed = await db.update(schema.predictions)
      .set({ payout: pay, settledAt: now })
      .where(and(eq(schema.predictions.id, p.id), isNull(schema.predictions.settledAt)))
      .returning({ id: schema.predictions.id });
    if (claimed.length === 0) continue;
    await db.update(schema.users)
      .set({ fortune: sql`${schema.users.fortune} + ${pay - p.stake}` })
      .where(eq(schema.users.id, p.userId));
    paid++;
  }
  return { paid };
}
```
and at the end of `resolveQuestion`, after the points loop:
```ts
  await payFortune(db, questionId, outcome, new Date());
```
Because `payFortune` only ever claims rows whose `settled_at` is null, a forced re-resolution that flips an outcome changes points (as today) but never the fortune. That is deliberate: reversing a paid fortune is out of scope, and an operator who needs it uses the admin route to void and re-run by hand.

In `apps/api/src/settlement.ts`, `settleRound`, before the round flips to `resolved`:
```ts
  // The house delta (design 2026-09-10 §4.4): Σ(stake − payout) over the
  // round's staked predictions. Written once; a resettle never revises it.
  if (round.houseDelta === null) {
    const [agg] = await db
      .select({ delta: sql<number>`coalesce(sum(${schema.predictions.stake} - ${schema.predictions.payout}), 0)` })
      .from(schema.predictions)
      .where(and(inArray(schema.predictions.questionId, qs.map((q) => q.id)), isNotNull(schema.predictions.payout)));
    await db.update(schema.rounds).set({ houseDelta: Number(agg?.delta ?? 0) }).where(and(eq(schema.rounds.date, date), isNull(schema.rounds.houseDelta)));
  }
```
(add `and`, `isNull`, `isNotNull` to the drizzle import). The existing `userRounds` insert uses `onConflictDoNothing`, so a row written at the first seal (Task 14) survives settlement unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- settlement resolution` and `pnpm typecheck`.
Expected: PASS, including the existing settlement and resolution suites.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/resolution.ts apps/api/src/settlement.ts apps/api/test/settlement-fortune.test.ts
git commit -m "feat(api): pay the fortune once at resolution; write the house delta at settlement

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 14: The stake at seal

**Files:**
- Modify: `apps/api/src/routes/predictions.ts`
- Test: `apps/api/test/predictions-stake.test.ts` (create)

**Interfaces:**
- Consumes: `stake` from `@oracle/core` (Task 1); columns from Task 3.
- Produces: on a version 3 round whose question carries a line, the seal stores `fortune_at_seal`, `stake` and `line_p_yes`, writes `user_rounds (user_id, date, vigil_mult '1', fortune_at_open)` with `onConflictDoNothing`, and returns `{ id, first_hour, stake }`. On a lineless version 3 question, or any version 1 or 2 round, the seal is unchanged and `stake` is null.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/predictions-stake.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-10";

async function setup(opts: { rulesVersion: number; line: string | null }) {
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-10T16:00:00Z"), locksAt: new Date("2026-09-11T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: opts.rulesVersion }).where(eq(schema.rounds.date, DATE));
  if (opts.line !== null) await db.update(schema.questions).set({ linePYes: opts.line }).where(eq(schema.questions.roundDate, DATE));
  const submit = (body: object) => app.request("/v1/predictions", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  const me = async () => (await db.query.users.findMany())[0]!;
  return { db, qs, submit, me };
}
const body = (questionId: string, confidence = 70, answer = true) => ({ question_id: questionId, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("the stake at seal (version 3)", () => {
  it("freezes fortune, stake and line on the prediction and returns the stake", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const res = await submit(body(qs[0]!.id, 70));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { id: string; stake: number };
    expect(json.stake).toBe(40);
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, json.id) });
    expect(p).toMatchObject({ fortuneAtSeal: 1000, stake: 40 });
    expect(Number(p!.linePYes)).toBe(0.35);
  });
  it("doubles the stake fraction on the Big One", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const big = qs.find((q) => q.slot === 5)!;
    expect(((await (await submit(body(big.id, 95))).json()) as { stake: number }).stake).toBe(180);
  });
  it("writes fortune_at_open on the first seal only, and does not debit the fortune", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit, me } = await setup({ rulesVersion: 3, line: "0.35" });
    await submit(body(qs[0]!.id, 70));
    const u = await me();
    expect(u.fortune).toBe(1000);
    await db.update(schema.users).set({ fortune: 1500 }).where(eq(schema.users.id, u.id)); // an earlier round settling mid-window
    await submit(body(qs[1]!.id, 70));
    const ur = await db.query.userRounds.findFirst({ where: and(eq(schema.userRounds.userId, u.id), eq(schema.userRounds.date, DATE)) });
    expect(ur!.fortuneAtOpen).toBe(1000);
    const second = await db.query.predictions.findFirst({ where: and(eq(schema.predictions.questionId, qs[1]!.id), eq(schema.predictions.userId, u.id)) });
    expect(second!.stake).toBe(60); // cut from the fortune at THIS seal
  });
  it("a duplicate seal returns the original stake, not a recomputed one", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, submit } = await setup({ rulesVersion: 3, line: "0.35" });
    const first = (await (await submit(body(qs[0]!.id, 70))).json()) as { stake: number };
    const again = (await (await submit(body(qs[0]!.id, 95))).json()) as { stake: number };
    expect(again.stake).toBe(first.stake);
  });
  it("a lineless version 3 question seals unstaked", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 3, line: null });
    const json = (await (await submit(body(qs[0]!.id, 70))).json()) as { id: string; stake: number | null };
    expect(json.stake).toBeNull();
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.id, json.id) });
    expect(p!.stake).toBeNull();
    expect(p!.fortuneAtSeal).toBeNull();
  });
  it("version 2 rounds are unchanged", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, submit } = await setup({ rulesVersion: 2, line: "0.35" });
    const json = (await (await submit(body(qs[0]!.id, 70))).json()) as { id: string; stake: number | null };
    expect(json.stake).toBeNull();
    expect(await db.query.userRounds.findFirst()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- predictions-stake`
Expected: FAIL — `stake` is undefined on the response; columns null.

- [ ] **Step 3: Implement**

In `apps/api/src/routes/predictions.ts`, after the lock check and before the insert:
```ts
    // The stake (design 2026-09-10 §4.2): cut from the fortune at THIS seal
    // and frozen on the row. Nothing is debited here; settlement pays.
    // A lineless version 3 question, and every earlier version, seals unstaked.
    const staked = (round.rulesVersion ?? 1) >= 3 && q.linePYes !== null;
    let stakeCols: { fortuneAtSeal: number; stake: number; linePYes: string } | null = null;
    if (staked) {
      const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
      const fortune = user?.fortune ?? FORTUNE.FOUNDING;
      stakeCols = { fortuneAtSeal: fortune, stake: stake(fortune, parsed.data.confidence, q.isBigOne), linePYes: String(q.linePYes) };
    }
```
Extend the insert's `values({...})` with `...(stakeCols ?? {})` and its `.returning` with `stake: schema.predictions.stake`. After a successful insert (inside `if (inserted.length > 0)`), before the crowd snapshot:
```ts
      if (stakeCols) {
        // The day's denominator, written at the FIRST accepted seal and never again.
        await db.insert(schema.userRounds)
          .values({ userId, date: q.roundDate, vigilMult: "1", fortuneAtOpen: stakeCols.fortuneAtSeal })
          .onConflictDoNothing();
      }
```
Return `{ id, first_hour, stake: inserted[0]!.stake ?? null }` on the insert path and `{ id, first_hour, stake: existing!.stake ?? null }` on the duplicate path. Import `FORTUNE, stake` from `@oracle/core`.

`round.rulesVersion` is already loaded by the existing `round` lookup in this handler.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- predictions` (both files) and `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/predictions.ts apps/api/test/predictions-stake.test.ts
git commit -m "feat(api): cut the stake from the fortune at seal

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 15: The line, the fortune and the house on the wire

**Files:**
- Modify: `apps/api/src/routes/round.ts` (`/today`, `/:date/reveal`, `/:date/board`)
- Modify: `apps/api/src/routes/me.ts` (`/ledger`)
- Test: `apps/api/test/round-v3.test.ts` (create)

**Interfaces:**
- Consumes: `dayReturn` from `@oracle/core`; columns from Task 3; schemas from Task 2.
- Produces, per spec §7:
  - `/today`: each question carries `line_p_yes`; top level carries `fortune` (caller's) and `house: { total, last_delta }`.
  - `/:date/reveal`: each question carries `line_p_yes`; `my` carries `stake`, `payout`, `delta`; top level carries `delta`, `return`, `fortune_after`, `house_delta`.
  - `/:date/board`: on a version 3 round, `metric: "return"`, rows ranked by `return_bp`, no Oracle row, `your_return_bp`, `best_return_bp`, `median_return_bp`; the `points` fields are 0 / null.
  - `/me/ledger`: `fortune`, `fortune_history`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/test/round-v3.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import { RoundTodaySchema, RevealSchema, RoundBoardSchema, MeLedgerSchema } from "@oracle/core";

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

describe("GET /v1/round/today at version 3", () => {
  it("carries the line, the caller's fortune and the house", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { as } = await world(1);
    const json = RoundTodaySchema.parse(await (await as(0)("/v1/round/today")).json());
    expect(json.rules_version).toBe(3);
    expect(json.fortune).toBe(1000);
    expect(json.house).toEqual({ total: 0, last_delta: null });
    expect(json.questions.every((q) => q.line_p_yes === 0.35)).toBe(true);
  });
});

describe("GET /v1/round/:date/reveal at version 3", () => {
  it("shows stake, payout, delta per card and the round's fortune figures", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, true, 70);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, q.slot === 5 ? "no" : "yes");
    await settleRound(db, DATE);
    const json = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    const first = json.questions.find((q) => q.slot === 1)!;
    expect(first.line_p_yes).toBe(0.35);
    expect(first.market_prob).toBe(0.40);
    expect(first.my).toMatchObject({ stake: 40, payout: 114, delta: 74 });
    const big = json.questions.find((q) => q.slot === 5)!;
    expect(big.my).toMatchObject({ stake: 80, payout: 0, delta: -80 });
    expect(json.delta).toBe(74 * 4 - 80);
    expect(json.return).toBeCloseTo(0.216, 6);
    expect(json.fortune_after).toBe(1216);
    expect(json.house_delta).toBe(-216);
  });
  it("reports null fortune figures on a version 2 round", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T02:00:00Z"), toFake: ["Date"] });
    const { db, as } = await world(1);
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, DATE));
    const json = RevealSchema.parse(await (await as(0)(`/v1/round/${DATE}/reveal`)).json());
    expect(json.delta).toBeNull();
    expect(json.fortune_after).toBeNull();
  });
});

describe("GET /v1/round/:date/board at version 3", () => {
  it("ranks the field by return in basis points with no Oracle row", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(6);
    // player 0 goes YES at 95 everywhere; players 1-5 go NO at 55 everywhere
    for (const q of qs) {
      await seal(0, q.id, true, 95);
      for (let i = 1; i < 6; i++) await seal(i, q.id, false, 55);
    }
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = RoundBoardSchema.parse(await (await as(0)(`/v1/round/${DATE}/board`)).json());
    expect(json.metric).toBe("return");
    expect(json.field_size).toBe(6);
    expect(json.your_rank).toBe(1);
    // player 0: stakes 90×4 + 180 = 540, all right at 1.857× → delta round(90×1.857)×4 + round(180×1.857) = 167×4 + 334 = 1002 → 10020 bp
    expect(json.your_return_bp).toBe(10020);
    expect(json.best_return_bp).toBe(10020);
    // players 1-5: −(10×4 + 20) = −60 → −600 bp
    expect(json.median_return_bp).toBe(-600);
    expect(json.rows.some((r) => r.is_oracle)).toBe(false);
    expect(json.rows.find((r) => r.is_you)!.return_bp).toBe(10020);
  });
});

describe("GET /v1/me/ledger", () => {
  it("carries fortune and a per-round history", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { db, qs, as, seal } = await world(1);
    for (const q of qs) await seal(0, q.id, true, 70);
    vi.setSystemTime(new Date("2026-09-12T02:00:00Z"));
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, DATE);
    const json = MeLedgerSchema.parse(await (await as(0)("/v1/me/ledger")).json());
    // slots 1-4 at 70: stake 40, +74 each; the Big One at 70: stake 80, +round(80 × 0.65/0.35) = +149
    expect(json.fortune).toBe(1000 + 74 * 4 + 149);
    expect(json.fortune_history).toEqual([{ date: DATE, delta: 74 * 4 + 149, fortune_after: 1000 + 74 * 4 + 149 }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- round-v3`
Expected: FAIL — `fortune` undefined on `/today`; `my.stake` undefined on the reveal; board `metric` undefined.

- [ ] **Step 3: Implement**

`routes/round.ts`, `/today`: load the caller's user row and the house figures, then add to the response:
```ts
    const userId = c.get("userId");
    const [user, houseRows] = await Promise.all([
      db.query.users.findFirst({ where: eq(schema.users.id, userId) }),
      db.select({ date: schema.rounds.date, delta: schema.rounds.houseDelta }).from(schema.rounds).where(isNotNull(schema.rounds.houseDelta)).orderBy(desc(schema.rounds.date)),
    ]);
    const house = { total: houseRows.reduce((s, r) => s + (r.delta ?? 0), 0), last_delta: houseRows[0]?.delta ?? null };
    // … in the JSON:
      fortune: user?.fortune ?? null,
      house,
      questions: qs.map((q) => ({ …existing fields…, line_p_yes: q.linePYes === null ? null : Number(q.linePYes) })),
```
(import `desc`, `isNotNull` from drizzle-orm.)

`/:date/reveal`: per question add `line_p_yes`; in `my` add `stake: p.stake`, `payout: p.payout`, `delta: p.payout === null || p.stake === null ? null : p.payout - p.stake`. At the top level, for `round.rulesVersion >= 3`:
```ts
    const staked = mine.filter((p) => p.stake !== null && p.payout !== null);
    const deltas = staked.map((p) => p.payout! - p.stake!);
    const v3 = (round?.rulesVersion ?? 1) >= 3;
    const roundDelta = v3 && staked.length > 0 ? deltas.reduce((a, b) => a + b, 0) : null;
    // stamped is the userRounds row already loaded for vigil_mult
      delta: roundDelta,
      return: v3 && stamped?.fortuneAtOpen ? dayReturn(deltas, stamped.fortuneAtOpen) : null,
      fortune_after: v3 ? (user?.fortune ?? null) : null,
      house_delta: v3 ? (round?.houseDelta ?? null) : null,
```
`fortune_after` is the caller's current fortune, which equals the post-round fortune until a later round settles; the ledger's history carries the exact per-round value.

`/:date/board`: after the existing `rows` computation, branch on version 3 before the field/median/oracle logic:
```ts
    if ((boardRound?.rulesVersion ?? 1) >= 3) {
      const predictions = await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) });
      const opens = await db.query.userRounds.findMany({ where: eq(schema.userRounds.date, date) });
      const openBy = new Map(opens.map((u) => [u.userId, u.fortuneAtOpen]));
      const returns = [...new Set(predictions.map((p) => p.userId))].flatMap((uid) => {
        const played = predictions.filter((p) => p.userId === uid);
        if (!ratingEligible(3, qs, new Set(played.map((p) => p.questionId)))) return [];
        const base = openBy.get(uid);
        if (!base) return [];
        const deltas = played.filter((p) => p.stake !== null && p.payout !== null).map((p) => p.payout! - p.stake!);
        return [{ userId: uid, bp: Math.round(dayReturn(deltas, base) * 10_000) }];
      });
      const field = returns.map((r) => r.bp);
      const mineBp = returns.find((r) => r.userId === userId)?.bp ?? null;
      const empty = { date, metric: "return" as const, field_size: field.length, your_points: null, your_rank: null, best_points: null, median_points: null, your_return_bp: mineBp, best_return_bp: null, median_return_bp: null, rows: [] as Array<{ name: string; points: number; return_bp: number; rank: number; is_you: boolean; is_oracle: boolean }> };
      if (field.length < CONSTANTS.BOARD_MIN_FIELD) return c.json(empty);
      const sorted = [...field].sort((a, b) => b - a);
      const mid = sorted.length >> 1;
      const median = sorted.length % 2 === 1 ? sorted[mid]! : Math.sign((sorted[mid - 1]! + sorted[mid]!) / 2) * Math.round(Math.abs((sorted[mid - 1]! + sorted[mid]!) / 2));
      const rankIn = (bp: number) => 1 + field.filter((x) => x > bp).length;
      const ranked = returns.map((r) => ({ ...r, rank: rankIn(r.bp), is_you: r.userId === userId })).sort((a, b) => b.bp - a.bp);
      const meIdx = ranked.findIndex((r) => r.is_you);
      const keep = new Set<number>();
      for (let i = 0; i < Math.min(CONSTANTS.BOARD_TOP_ROWS, ranked.length); i++) keep.add(i);
      if (meIdx >= 0) for (let i = meIdx - CONSTANTS.BOARD_NEIGHBOURS; i <= meIdx + CONSTANTS.BOARD_NEIGHBOURS; i++) if (i >= 0 && i < ranked.length) keep.add(i);
      const shown = [...keep].sort((a, b) => a - b).map((i) => ranked[i]!);
      const names = disambiguate(shown.map((r) => designation(r.userId)));
      return c.json({
        ...empty,
        your_rank: mineBp === null ? null : rankIn(mineBp),
        best_return_bp: sorted[0]!,
        median_return_bp: median,
        rows: shown.map((r, i) => ({ name: names[i]!, points: 0, return_bp: r.bp, rank: r.rank, is_you: r.is_you, is_oracle: false })),
      });
    }
```
The version 1 and 2 path below it is unchanged and now also emits `metric: "points"` (add the key to its two `c.json` calls).

`routes/me.ts`, `/ledger`: the handler already loads the caller's predictions and their questions. Add:
```ts
    // Fortune history (design 2026-09-10 §7): one entry per settled round,
    // in date order, with the running total rebuilt from founding.
    const byRound = new Map<string, number>();
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (!q || p.stake === null || p.payout === null) continue;
      byRound.set(q.roundDate, (byRound.get(q.roundDate) ?? 0) + (p.payout - p.stake));
    }
    const settledDates = new Set(playedRounds.filter((r) => r.status === "resolved").map((r) => r.date));
    let running = FORTUNE.FOUNDING;
    const fortuneHistory = [...byRound.entries()]
      .filter(([d]) => settledDates.has(d))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, delta]) => { running += delta; return { date, delta, fortune_after: running }; });
    // … in the JSON:
      fortune: user?.fortune ?? null,
      fortune_history: fortuneHistory,
```
`playedRounds` is the array the handler already builds for milestones; if its name differs, use that one. Import `FORTUNE` from `@oracle/core`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- round-v3 round ledger resolve-reveal` and `pnpm typecheck`.
Expected: PASS, including the existing round and ledger suites (they exercise versions 1 and 2 and must not change).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/src/routes/me.ts apps/api/test/round-v3.test.ts
git commit -m "feat(api): the line, stake, fortune and house on today, reveal, board and ledger

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 16: Admin authoring for version 3, and the rollout notes

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`POST /rounds/:date/author`)
- Modify: `docs/launch-playbook.md` (migration count, the version 3 cutover steps)
- Test: `apps/api/test/admin-rounds.test.ts` (adjust the author test)

**Interfaces:**
- Produces: `POST /admin/rounds/:date/author` dispatches the `author` workflow exactly as before; with the Task 9 routing that is now the market round. No new route is needed beyond Task 11's `/rounds/:date/line`. This task is verification plus the operator notes.

- [ ] **Step 1: Confirm the admin author route runs the market round in tests**

Add to `apps/api/test/admin-rounds.test.ts`, following its existing pattern for building `deps.pipeline` with `inlineStarter()` and a canned Claude:
```ts
  it("POST /rounds/:date/author deals a version 3 round from the injected exchanges", async () => {
    // build pipeline deps with exchangeFeeds: [feedOf(SEVEN)] and the claudeWith() helper from market-round.test.ts (copy both helpers into this file)
    const res = await admin("/admin/rounds/2026-09-10/author");
    expect(res.status).toBe(200);
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-09-10") });
    expect(round?.rulesVersion).toBe(3);
  });
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @oracle/api test -- admin-rounds`
Expected: PASS without code changes. If it fails because the admin route's 409 `round already exists` check fires on a re-run, that is correct behaviour; the test seeds nothing beforehand.

- [ ] **Step 3: Update the launch playbook**

In `docs/launch-playbook.md`, section 2.2: replace the stale migration count with "Migrations 0000 through 0014 exist" and add the cutover procedure, verbatim from spec §11:

```markdown
### 2.3 Version 3 cutover (the House)

1. Apply `0014` to production: `cd apps/api && DATABASE_URL='<prod>' pnpm db:migrate`.
2. Deploy the API with `PIPELINE_ENABLED` still `false`.
3. Deal tomorrow's round by hand and inspect it in Telegram:
   `curl -X POST -H 'x-admin-secret: …' https://<api>/admin/rounds/<tomorrow>/author`
   Then commit the forecast and the line:
   `curl -X POST … /admin/rounds/<tomorrow>/forecast` and `curl -X POST … /admin/rounds/<tomorrow>/line`
   Check `GET /admin/rounds/<tomorrow>` shows five questions with `market_source`, `market_id`, `line_p_yes`.
4. Set `PIPELINE_ENABLED` to `true`: `echo -n true | npx wrangler secret put PIPELINE_ENABLED`.
5. The round publishes at the next noon ET. The 17:00 ET tick deals the following day's round without help.
6. Ship the mobile build only after the API is live; the response schemas default every new field, so the old build keeps parsing in the meantime.
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/admin-rounds.test.ts docs/launch-playbook.md
git commit -m "docs(launch-playbook): version 3 cutover; admin author test covers the market round

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 17: Retire the probe and the authoring gauntlet

**Files:**
- Delete: `apps/api/src/pipeline/probe.ts`, `apps/api/src/pipeline/leak.ts`, `apps/api/src/pipeline/gauntlet/generate.ts`, `critic.ts`, `preflight.ts`, `sources.ts`, `forecast.ts`, `select.ts`, `index.ts`
- Move: `apps/api/src/pipeline/gauntlet/taste.ts` → `apps/api/src/pipeline/taste.ts` (update the two imports: `market-round.ts`, and `author.ts` if it imports it)
- Modify: `apps/api/src/pipeline/state.ts` (drop the `probe` action and `PROBE_INTERVAL_HOURS`), `apps/api/src/pipeline/index.ts` (drop the `probe` case), `apps/api/src/pipeline/workflows.ts` (`WorkflowKind` becomes `"author" | "resolve"`; drop `PROBE_WORKFLOW`), `apps/api/src/pipeline/workflow-entrypoints.ts` (delete `ProbeWorkflow` and the gauntlet imports), `apps/api/src/worker.ts` (drop `PROBE_WORKFLOW` from `WorkerEnv` and the bindings check), `apps/api/wrangler.jsonc` (remove the `oracle-probe` workflow entry and the `PIPELINE_PREFLIGHT_MODEL`, `PIPELINE_PROBE_MODEL`, `PIPELINE_CRITIC_MODEL`, `PIPELINE_AUTHOR_MODEL` vars), `PipelineDeps.models` (drop `author`, `critic`, `preflight`, `probe`)
- Delete tests: `apps/api/test/pipeline-probe.test.ts`, `pipeline-leak.test.ts`, `gauntlet-critic.test.ts`, `gauntlet-generate.test.ts`, `gauntlet-preflight.test.ts`, `gauntlet-run.test.ts`, `gauntlet-select.test.ts`, `gauntlet-sources.test.ts`, `gauntlet-forecast.test.ts`; move `gauntlet-taste.test.ts` → `pipeline-taste.test.ts`
- Modify: `apps/api/src/routes/admin.ts` (`GET /analytics/leak` and anything else importing `leak.ts` — delete the route)

**Interfaces:**
- Produces: a codebase where `pnpm typecheck` and `pnpm test` pass with none of the retired modules present. Bank authoring (`author.ts`: `authorBankEntry`, `rerollSlot`, `authorRound`) and its `candidate.ts`, `editorial.ts`, `quality.ts` dependencies stay if anything still imports them.

- [ ] **Step 1: Delete, then let the compiler list the survivors**

```bash
cd apps/api
git rm src/pipeline/probe.ts src/pipeline/leak.ts src/pipeline/gauntlet/generate.ts src/pipeline/gauntlet/critic.ts src/pipeline/gauntlet/preflight.ts src/pipeline/gauntlet/sources.ts src/pipeline/gauntlet/forecast.ts src/pipeline/gauntlet/select.ts src/pipeline/gauntlet/index.ts
git mv src/pipeline/gauntlet/taste.ts src/pipeline/taste.ts
git rm test/pipeline-probe.test.ts test/pipeline-leak.test.ts test/gauntlet-critic.test.ts test/gauntlet-generate.test.ts test/gauntlet-preflight.test.ts test/gauntlet-run.test.ts test/gauntlet-select.test.ts test/gauntlet-sources.test.ts test/gauntlet-forecast.test.ts
git mv test/gauntlet-taste.test.ts test/pipeline-taste.test.ts
pnpm typecheck 2>&1 | head -80
```

- [ ] **Step 2: Fix every error the compiler reports, in this order**

1. `taste.ts` imported `Judged` from `./critic` and `Rejection` from `../candidate`. `tasteCheck` (the `Judged` wrapper) has no callers left: delete it and the `Judged` import; keep `tasteTexts`. `Rejection` is no longer needed either.
2. `market-round.ts`: change `import { tasteTexts } from "./gauntlet/taste"` to `"./taste"`.
3. `state.ts`: remove the `probe` member of `Action`, the `probeIds` field on `openRound`, `PROBE_INTERVAL_HOURS`, and the PROBE block in `decideActions`.
4. `index.ts`: remove the `case "probe"` and the `probe`, `preflight`, `critic`, `author` entries from `PipelineDeps.models` (keep `resolve`, `resolveB`, `forecast`, `taste`, `voice`). Check `author.ts` first: if `authorBankEntry`/`rerollSlot` use `deps.models.author`, keep `author` in the models and in `wrangler.jsonc`.
5. `workflows.ts`: `WorkflowKind = "author" | "resolve"`; drop `PROBE_WORKFLOW` from `WorkflowBindings`/`WorkflowInstanceBindings` and the `of` record; drop the `else` branch of `inlineStarter`.
6. `workflow-entrypoints.ts`: delete `ProbeWorkflow` and every import that now resolves to a deleted module.
7. `worker.ts` and `wrangler.jsonc`: drop the probe binding and the retired model vars. Note in the commit message that `wrangler deploy` will report the `oracle-probe` workflow as removed; that is intended.
8. `routes/admin.ts`: delete `GET /analytics/leak` and its imports. If `admin-rounds.test.ts` or `admin-workflows.test.ts` reference `probe`, remove those cases.
9. Any test that builds a `models:` literal: remove the deleted keys.

Re-run `pnpm typecheck` until clean.

- [ ] **Step 3: Run the whole suite**

Run: `pnpm test` (all workspaces) — expect the API suite around six and a half minutes; bare 5,000 ms timeouts are contention, re-run the file alone before treating one as a failure.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A apps/api
git commit -m "chore(pipeline): retire the probe and the authoring gauntlet; the market round replaces both

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

## Self-review against the spec

**Coverage.** §4.1–4.5 → Task 1 (arithmetic) and Tasks 13–15 (where it is applied). §4.6 → Task 2 keeps Brier untouched. §5.1 → Tasks 4, 5. §5.2 → Task 6 (`eligible`) and Task 7 (`upsertDraft` re-checks the window). §5.3 → Task 6 (`selectFive`; the spec's "three accepted" is superseded by the draft schema's four, recorded in the plan's constraints). §5.4 → Task 8 (voice, taste) and Task 9 (re-select once). §5.5 → Task 11, with the immutability trigger in Task 3. §5.6 → Task 12 (exchange read) and Task 13 (fortune, house delta). §5.7 → Task 17; the resolver date-anchoring fix for bank questions is **not** in this plan and belongs to the Council plan, where the evidence pack replaces the resolver's web search entirely. §6 → Task 3. §7 → Tasks 14, 15, 11 (admin line). §11 → Task 16. §8, §12, §13, §14 → other plans.

**Not covered, on purpose.** An all-time board ranked by fortune (§7 "adds an all-time mode") is a mobile-facing read with no consumer until the mobile plan; it ships with that plan as a one-query route. The exhibition's practice fortune (§7 last row) likewise.

**Type consistency.** `stake(fortune, confidence, isBigOne)` is used with that argument order in Tasks 1 and 14. `payout({ stake, answer, line, outcome })` in Tasks 1 and 13. `MarketCandidate.closesAt` is an ISO string in Tasks 4–9; `upsertDraft` receives it as `market.closes_at` and stores `marketClosesAt` as a Date (Task 7). `ExchangeFeed.read(fetchFn, marketId)` in Tasks 4, 5, 12. `PipelineDeps.exchangeFeeds` is introduced in Task 9 and consumed in Task 12; `PipelineDeps.models.voice` is introduced in Task 8 and every later test's `models` literal includes it. `tasteTexts(deps, texts)` in Tasks 8, 9, 17. `commitLine(db, date)` in Tasks 11, 16. `RoundBoardSchema.rows[].return_bp` in Tasks 2 and 15.

**Placeholders.** None: every step carries its code or its exact command. Where a test asserts an arithmetic result, the derivation sits beside it as a comment (Task 6's selection order, Task 13's house delta, Task 15's payouts).
