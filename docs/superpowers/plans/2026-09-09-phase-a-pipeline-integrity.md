# Phase A — Pipeline Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every published question resolve honestly and fast inside the round's window, and give the operator a truthful way to strike a mis-authored question from a live round.

**Architecture:** Four guards land in the one write path every authoring route shares (`upsertDraft`), so hand-seeded, bank, reroll and gauntlet rounds all obey them. The gauntlet additionally learns to *select* a fast slate and to prosecute weather with the public forecast in hand, so drafts arrive already compliant instead of being rejected at commit. Withdrawal is a new status-preserving void with its own marker column, distinct from the leak-heal path, exposed to the client as a general `struck` flag with a printable reason.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle ORM (Neon HTTP in prod, PGlite in tests), Zod, Vitest, pnpm workspaces. Mobile: Expo SDK 57 / React Native, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-engagement-and-integrity-design.md` (Section 1). This plan implements Section 1 only. Sections 2–4 get their own plans after this lands.

## Global Constraints

- iOS first; existing Expo/React Native and Hono/Workers/Drizzle stacks only. No new third-party services. (NWS `api.weather.gov` is a keyless public source, same class as the existing Manifold/Polymarket feeds — allowed.)
- Rules changes apply prospectively under the stored round `rulesVersion`; v1 rounds keep their contract. Every new guard is gated on `rulesVersion >= 2`.
- Every server write stays idempotent: neon-http has no transactions and the hourly cron re-dispatches.
- Tests never touch the network: fetches are injected (`deps.sourceFetch`), Claude is injected (`deps.claude`).
- Player-facing copy holds the register: tracked caps, no emoji, no exclamation, ≤140 chars (enforced by `packages/core/test/copy-lint.test.ts`).
- Migrations are additive; existing rows default to null.
- Run tests from the package directory: `cd apps/api && pnpm vitest run <file>`; core: `cd packages/core && pnpm vitest run <file>`; mobile: `cd apps/mobile && pnpm vitest run <file>`. Typecheck: `pnpm typecheck` in the package.
- Commit after every task. Commit messages end with `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## Timing vocabulary (used throughout)

For a round dated `D` (all ET, computed via `noonET` in `apps/api/src/pipeline/clock.ts`):

| Name | Instant | Helper |
|---|---|---|
| open | noon D | `noonET(D)` |
| lock | noon D+1 | `noonET(addDays(D,1))` |
| fast-by | lock + `EVENING_RESOLVE_LAG_HOURS` | `fastResolveBy(D)` (new) |
| void deadline | noon D+2 | `voidDeadline(D)` (new) |

**The fast-round rule (v2):** every concrete `resolves_at` must be ≤ void deadline; at most one question may have a concrete `resolves_at` later than fast-by, and if one does it must be the Big One (slot 5). `"after-lock"` counts as fast (it claims nothing is knowable before lock; the gauntlet no longer accepts it, see Task 6, but the evergreen bank and hand-seeded drafts still may).

## File map

| File | Responsibility in this plan |
|---|---|
| `packages/core/src/constants.ts` | `EVENING_RESOLVE_LAG_HOURS` |
| `packages/core/src/copy.ts` | `PIPELINE_LINES.withdrawnMisauthored`, `.withdrawnUnresolvable` |
| `packages/core/src/schemas.ts` | `RoundTodaySchema` gains `struck`, `struck_reason` |
| `apps/api/src/pipeline/clock.ts` | `fastResolveBy`, `voidDeadline` |
| `apps/api/src/db/schema.ts` + `drizzle/0011_*.sql` | `questions.resolves_at`, `questions.withdrawn_at` |
| `apps/api/src/pipeline/draft.ts` | `checkFastRound`, `upsertDraft` enforces it and stores `resolvesAt` |
| `apps/api/src/pipeline/author.ts` | `rerollSlot` re-checks the merged round |
| `apps/api/src/pipeline/candidate.ts` | tier-0: v2 requires an instant; `"slow"` reject reason; `forecast_point` |
| `apps/api/src/pipeline/gauntlet/generate.ts` | prompt + tool schema for instants and `forecast_point` |
| `apps/api/src/pipeline/gauntlet/forecast.ts` (new) | `gatherForecasts` from NWS |
| `apps/api/src/pipeline/gauntlet/critic.ts` | forecast-grounded critic |
| `apps/api/src/pipeline/gauntlet/select.ts` | fast-slate selection |
| `apps/api/src/pipeline/gauntlet/index.ts`, `workflow-entrypoints.ts` | wire the forecast step + select window |
| `apps/api/src/resolution.ts` | `withdrawQuestion` |
| `apps/api/src/routes/admin.ts` | `POST /admin/questions/:id/withdraw`; new BAD_DRAFT messages |
| `apps/api/src/routes/round.ts` | `/today` emits `struck`, `struck_reason` |
| `apps/api/src/exhibition.ts` | skip withdrawn questions |
| `apps/mobile/src/game/roundAvailability.ts`, `arrivalState.ts`, `src/app/index.tsx`, `round.tsx`, `src/ui/PracticeCard.tsx` | gate on `struck`; banner prints `struck_reason` |

---

### Task 1: Core constants, withdrawal copy, and the `struck` wire fields

**Files:**
- Modify: `packages/core/src/constants.ts` (inside the `CONSTANTS` object, after `VERDICT_MIN_CALLS`)
- Modify: `packages/core/src/copy.ts:268-271` (`PIPELINE_LINES`)
- Modify: `packages/core/src/schemas.ts:34-56` (`RoundTodaySchema`)
- Test: `packages/core/test/copy-lint.test.ts` (existing test covers the new lines automatically)

**Interfaces:**
- Produces: `CONSTANTS.EVENING_RESOLVE_LAG_HOURS: 4`
- Produces: `PIPELINE_LINES.withdrawnMisauthored`, `PIPELINE_LINES.withdrawnUnresolvable` (strings)
- Produces: `RoundTodaySchema.questions[].struck: boolean`, `.struck_reason: string | null`

- [ ] **Step 1: Add the constant**

In `packages/core/src/constants.ts`, after the `VERDICT_MIN_CALLS: 20,` line add:

```ts
  // The fast-round rule (design 2026-09-09 §1.2). A v2 round may carry at
  // most one question that resolves later than this many hours after the
  // lock, and that one must be the Big One. Everything else decides the
  // same evening, so the verdict trickles in tonight instead of arriving
  // batched two days later. ⚙ tunable.
  EVENING_RESOLVE_LAG_HOURS: 4,
```

- [ ] **Step 2: Add the withdrawal lines**

In `packages/core/src/copy.ts`, replace the `PIPELINE_LINES` block with:

```ts
export const PIPELINE_LINES = Object.freeze({
  lockHealed: "THE ANSWER EXISTS. THIS ONE IS CLOSED.",
  voidDisagreement: "THE READERS DID NOT AGREE. THIS ONE IS STRUCK.",
  // Editorial withdrawal (design 2026-09-09 §1.4): the operator struck a
  // question that should never have run. Distinct from the leak line above,
  // because "we mis-wrote it" and "the answer leaked" are different facts and
  // the reveal prints whichever one is true.
  withdrawnMisauthored: "THIS QUESTION WAS WITHDRAWN. IT COUNTS FOR NO ONE.",
  withdrawnUnresolvable: "THIS QUESTION CANNOT BE SETTLED IN TIME. IT COUNTS FOR NO ONE.",
} as const);
```

- [ ] **Step 3: Add the wire fields**

In `packages/core/src/schemas.ts`, inside `RoundTodaySchema.questions` item object, after the `lock_healed: z.boolean(),` line add:

```ts
      // Struck from the round for everyone (v2): either the probe healed a
      // leaked lock or the operator withdrew it. The client gates the
      // required set on THIS, not on lock_healed, which stays probe-only.
      struck: z.boolean().default(false),
      // The printable reason when struck; null otherwise. Rendered verbatim.
      struck_reason: z.string().nullable().default(null),
```

- [ ] **Step 4: Run core tests and typecheck**

Run: `cd packages/core && pnpm vitest run test/copy-lint.test.ts && pnpm typecheck`
Expected: PASS (the pipeline-lines register test walks `Object.values(PIPELINE_LINES)` and the two new lines are caps, no emoji, ≤140 chars).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constants.ts packages/core/src/copy.ts packages/core/src/schemas.ts
git commit -m "feat(core): fast-round lag constant, withdrawal lines, struck wire fields

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 2: Clock helpers `fastResolveBy` and `voidDeadline`

**Files:**
- Modify: `apps/api/src/pipeline/clock.ts`
- Test: `apps/api/test/pipeline-clock.test.ts`

**Interfaces:**
- Produces: `fastResolveBy(date: string): Date` — lock (noon ET D+1) plus `CONSTANTS.EVENING_RESOLVE_LAG_HOURS`.
- Produces: `voidDeadline(date: string): Date` — noon ET D+2, the same instant `decideActions` voids at.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-clock.test.ts`:

```ts
import { fastResolveBy, voidDeadline } from "../src/pipeline/clock";
import { CONSTANTS } from "@oracle/core";

describe("fastResolveBy / voidDeadline (design 2026-09-09 §1)", () => {
  it("fast-by is the lock plus the evening lag", () => {
    // lock for 2026-08-27 is noon ET 2026-08-28 = 16:00Z (EDT)
    const expected = new Date("2026-08-28T16:00:00Z").getTime() + CONSTANTS.EVENING_RESOLVE_LAG_HOURS * 3_600_000;
    expect(fastResolveBy("2026-08-27").getTime()).toBe(expected);
  });
  it("void deadline is noon ET two days after the round date", () => {
    expect(voidDeadline("2026-08-27").toISOString()).toBe("2026-08-29T16:00:00.000Z");
  });
  it("void deadline respects standard time", () => {
    expect(voidDeadline("2026-01-15").toISOString()).toBe("2026-01-17T17:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/pipeline-clock.test.ts`
Expected: FAIL — `fastResolveBy` is not exported.

- [ ] **Step 3: Implement**

Append to `apps/api/src/pipeline/clock.ts`:

```ts
import { CONSTANTS } from "@oracle/core";

// The fast-round rule's threshold (design 2026-09-09 §1.2): the lock plus the
// evening lag. At most one question in a v2 round may resolve after this.
export function fastResolveBy(date: string): Date {
  return new Date(noonET(addDays(date, 1)).getTime() + CONSTANTS.EVENING_RESOLVE_LAG_HOURS * 3_600_000);
}

// The void deadline: noon ET two days after the round date. This is the same
// instant decideActions (state.ts) voids unresolved questions at; it lives
// here so authoring can refuse a question that would void unseen.
export function voidDeadline(date: string): Date {
  return noonET(addDays(date, 2));
}
```

Move the `import` to the top of the file with the other imports (there are none today; place it on line 1 above the `const ET` line).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/pipeline-clock.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/clock.ts apps/api/test/pipeline-clock.test.ts
git commit -m "feat(api): fastResolveBy and voidDeadline clock helpers

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 3: Schema columns `resolves_at` and `withdrawn_at` + migration

**Files:**
- Modify: `apps/api/src/db/schema.ts` (questions table, after `lockHealedAt`)
- Create: `apps/api/drizzle/0011_<generated-name>.sql` (via `pnpm db:generate`)
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `schema.questions.resolvesAt: timestamp | null` — the author's honest resolution instant; null for `"after-lock"`.
- Produces: `schema.questions.withdrawnAt: timestamp | null` — set only by `withdrawQuestion` (Task 10).

- [ ] **Step 1: Write the failing test**

In `apps/api/test/schema.test.ts`, inside the same `describe` that holds "leaves lock_healed_at and topic_key null on an ordinary question", add:

```ts
  it("leaves resolves_at and withdrawn_at null on an ordinary question (design 2026-09-09 §1)", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-10" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-10", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-10T16:00:00Z"),
      locksAt: new Date("2026-09-11T16:00:00Z"),
      resolveBy: new Date("2026-09-11T17:00:00Z"),
    }).returning();
    expect(q!.resolvesAt).toBeNull();
    expect(q!.withdrawnAt).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/schema.test.ts`
Expected: FAIL — `resolvesAt` does not exist on the row type (typecheck) / column missing.

- [ ] **Step 3: Add the columns**

In `apps/api/src/db/schema.ts`, after the `lockHealedAt` column definition (line ~91), add:

```ts
  // The author's own honest instant: when the outcome first becomes publicly
  // determinable (design 2026-09-09 §1.1). Null when the draft said
  // "after-lock". Unlike resolve_by above, this IS read: the fast-round rule
  // validates against it, and the in-play surface will print it.
  resolvesAt: timestamp("resolves_at", { withTimezone: true }),
  // Editorial withdrawal (design 2026-09-09 §1.4): the operator struck this
  // question from a live round with an honest reason. Distinct from
  // lock_healed_at, which only the probe writes when an answer leaked.
  withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: a new file `drizzle/0011_<name>.sql` containing exactly:

```sql
ALTER TABLE "questions" ADD COLUMN "resolves_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "withdrawn_at" timestamp with time zone;
```

and an updated `drizzle/meta/_journal.json` + `drizzle/meta/0011_snapshot.json`. If the generated SQL differs from the above, stop and inspect the schema diff.

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/schema.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle
git commit -m "feat(db): questions.resolves_at and questions.withdrawn_at

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: `checkFastRound` and enforcement in `upsertDraft`

**Files:**
- Modify: `apps/api/src/pipeline/draft.ts`
- Modify: `apps/api/src/routes/admin.ts:117-121` (`BAD_DRAFT` set)
- Test: `apps/api/test/pipeline-draft.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FastRoundWindow { lockAt: Date; fastBy: Date; voidAt: Date }
  export function checkFastRound(
    questions: ReadonlyArray<{ slot: number; is_big_one: boolean; resolves_at: string }>,
    window: FastRoundWindow,
  ): string | null  // null = ok; otherwise the error message
  ```
  Error messages (exact strings, reused by admin and tests):
  - `"resolves_at is past the void deadline"`
  - `"only the big one may resolve after the evening"`
- `upsertDraft` unchanged signature; for `rulesVersion >= 2` it throws those messages and stores `resolvesAt`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-draft.test.ts`:

```ts
import { checkFastRound, type FastRoundWindow } from "../src/pipeline/draft";
import { fastResolveBy, voidDeadline } from "../src/pipeline/clock";

// Round 2026-08-27: lock 08-28 16:00Z, fast-by 20:00Z, void 08-29 16:00Z.
const WINDOW: FastRoundWindow = { lockAt: LOCKS, fastBy: fastResolveBy("2026-08-27"), voidAt: voidDeadline("2026-08-27") };
const q = (slot: number, resolves_at: string) => ({ slot, is_big_one: slot === 5, resolves_at });

describe("checkFastRound (design 2026-09-09 §1.1-1.2)", () => {
  it("accepts five after-lock questions", () => {
    expect(checkFastRound([1, 2, 3, 4, 5].map((s) => q(s, RESOLVES_AFTER_LOCK)), WINDOW)).toBeNull();
  });
  it("accepts five same-evening instants", () => {
    expect(checkFastRound([1, 2, 3, 4, 5].map((s) => q(s, "2026-08-28T19:00:00Z")), WINDOW)).toBeNull();
  });
  it("accepts a slow Big One when the other four are fast", () => {
    const qs = [q(1, "2026-08-28T18:00:00Z"), q(2, RESOLVES_AFTER_LOCK), q(3, "2026-08-28T19:59:00Z"), q(4, "2026-08-28T20:00:00Z"), q(5, "2026-08-29T12:30:00Z")];
    expect(checkFastRound(qs, WINDOW)).toBeNull();
  });
  it("rejects a slow question that is not the Big One", () => {
    const qs = [q(1, "2026-08-28T18:00:00Z"), q(2, "2026-08-29T12:30:00Z"), q(3, RESOLVES_AFTER_LOCK), q(4, RESOLVES_AFTER_LOCK), q(5, RESOLVES_AFTER_LOCK)];
    expect(checkFastRound(qs, WINDOW)).toBe("only the big one may resolve after the evening");
  });
  it("rejects two slow questions even when one is the Big One", () => {
    const qs = [q(1, "2026-08-28T18:00:00Z"), q(2, "2026-08-29T01:00:00Z"), q(3, RESOLVES_AFTER_LOCK), q(4, RESOLVES_AFTER_LOCK), q(5, "2026-08-29T12:30:00Z")];
    expect(checkFastRound(qs, WINDOW)).toBe("only the big one may resolve after the evening");
  });
  it("rejects any instant past the void deadline, Big One included", () => {
    const qs = [q(1, RESOLVES_AFTER_LOCK), q(2, RESOLVES_AFTER_LOCK), q(3, RESOLVES_AFTER_LOCK), q(4, RESOLVES_AFTER_LOCK), q(5, "2026-08-30T16:00:00Z")];
    expect(checkFastRound(qs, WINDOW)).toBe("resolves_at is past the void deadline");
  });
});

describe("upsertDraft enforces the fast-round rule at v2", () => {
  it("stores the honest instant in resolves_at and null for after-lock", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) => { qs[0]!.resolves_at = "2026-08-28T19:00:00Z"; return qs; });
    await upsertDraft(db, "2026-08-27", draft, 2);
    const rows = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const one = rows.find((r) => r.slot === 1)!;
    expect(one.resolvesAt?.toISOString()).toBe("2026-08-28T19:00:00.000Z");
    expect(rows.find((r) => r.slot === 2)!.resolvesAt).toBeNull();
  });
  it("refuses a v2 draft with a non-Big-One that resolves after the evening", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) => { qs[1]!.resolves_at = "2026-08-29T12:30:00Z"; return qs; });
    await expect(upsertDraft(db, "2026-08-27", draft, 2)).rejects.toThrow("only the big one may resolve after the evening");
  });
  it("refuses a v2 draft whose Big One resolves past the void deadline", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) => { qs[4]!.resolves_at = "2026-08-30T16:00:00Z"; return qs; });
    await expect(upsertDraft(db, "2026-08-27", draft, 2)).rejects.toThrow("resolves_at is past the void deadline");
  });
  it("leaves v1 drafts alone (prospective rule)", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) => { qs[1]!.resolves_at = "2026-08-28T15:00:00Z"; return qs; }); // an early lock, legal at v1
    await expect(upsertDraft(db, "2026-08-27", draft, 1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/pipeline-draft.test.ts`
Expected: FAIL — `checkFastRound` is not exported.

- [ ] **Step 3: Implement `checkFastRound`**

In `apps/api/src/pipeline/draft.ts`, after `lockFromResolvesAt`, add:

```ts
export interface FastRoundWindow { lockAt: Date; fastBy: Date; voidAt: Date }

// The fast-round rule (design 2026-09-09 §1.1-1.2). A v2 round settles only
// when its slowest question does, so one Sunday question holds the whole
// verdict two days. Every concrete instant must land before the void
// deadline, and at most one may land after the evening — and that one must be
// the Big One. "after-lock" carries no instant and counts as fast: it is a
// claim that nothing is knowable before the lock, not a claim of lateness.
export function checkFastRound(
  questions: ReadonlyArray<{ slot: number; is_big_one: boolean; resolves_at: string }>,
  window: FastRoundWindow,
): string | null {
  let slow = 0;
  for (const q of questions) {
    if (q.resolves_at === RESOLVES_AFTER_LOCK) continue;
    const t = new Date(q.resolves_at).getTime();
    if (t > window.voidAt.getTime()) return "resolves_at is past the void deadline";
    if (t > window.fastBy.getTime()) {
      slow += 1;
      if (!q.is_big_one || slow > 1) return "only the big one may resolve after the evening";
    }
  }
  return null;
}
```

- [ ] **Step 4: Enforce in `upsertDraft` and store `resolvesAt`**

In `upsertDraft`, import `fastResolveBy, voidDeadline` from `./clock` (extend the existing import line to `import { addDays, fastResolveBy, noonET, voidDeadline } from "./clock";`).

Immediately after `const resolveBy = new Date(locksAtDefault.getTime() + 3_600_000);` add:

```ts
  if (rulesVersion >= 2) {
    const fast = checkFastRound(draft.questions, { lockAt: locksAtDefault, fastBy: fastResolveBy(date), voidAt: voidDeadline(date) });
    if (fast) throw new Error(fast);
  }
```

In the `rows = draft.questions.map(...)` return object, after `locksAt,` add:

```ts
      resolvesAt: q.resolves_at === RESOLVES_AFTER_LOCK ? null : new Date(q.resolves_at),
```

- [ ] **Step 5: Teach the admin route the new messages**

In `apps/api/src/routes/admin.ts`, extend `BAD_DRAFT`:

```ts
      const BAD_DRAFT = new Set([
        "resolves_at out of range",
        "weather must lock before noon",
        "new rounds require the full common answering window",
        "resolves_at is past the void deadline",
        "only the big one may resolve after the evening",
      ]);
```

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/pipeline-draft.test.ts test/admin-rounds.test.ts test/pipeline-bank.test.ts test/gameplay-v2.test.ts`
Expected: PASS. (The bank and gameplay-v2 suites upsert `validDraft` at v2 with all-`after-lock` questions, which the rule accepts.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pipeline/draft.ts apps/api/src/routes/admin.ts apps/api/test/pipeline-draft.test.ts
git commit -m "feat(pipeline): fast-round rule and void-deadline guard in upsertDraft

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 5: `rerollSlot` re-checks the merged round

**Files:**
- Modify: `apps/api/src/pipeline/author.ts:255-264` (the validation block inside `rerollSlot`)
- Test: `apps/api/test/pipeline-author.test.ts`

**Interfaces:**
- Consumes: `checkFastRound`, `fastResolveBy`, `voidDeadline`.
- `rerollSlot` throws `reroll: <checkFastRound message>` when the replacement would break the rule for the round.

- [ ] **Step 1: Write the failing test**

Find the existing `rerollSlot` tests in `apps/api/test/pipeline-author.test.ts` and copy their `deps` construction (a `PipelineDeps` with an injected `claude.structured` returning one question). Add:

```ts
  it("refuses a reroll whose replacement would make a non-Big-One slow (design 2026-09-09 §1.2)", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft, 2);
    const replacement = {
      ...validDraft.questions[1],
      text: "Will the weekend gross leader be a sequel?",
      resolves_at: "2026-08-29T12:30:00Z", // after fast-by (08-28 20:00Z), before void (08-29 16:00Z)
    };
    const d = deps(db, replacement); // the same helper the sibling reroll tests use
    await expect(rerollSlot(d, "2026-08-27", 2, "")).rejects.toThrow("only the big one may resolve after the evening");
  });
```

If the sibling tests name their helper differently, use that name; the shape is "deps whose `claude.structured` resolves to the replacement question object".

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/pipeline-author.test.ts -t "refuses a reroll"`
Expected: FAIL — reroll succeeds.

- [ ] **Step 3: Implement**

In `apps/api/src/pipeline/author.ts`, extend the `./clock` import to include `fastResolveBy, voidDeadline`, and import `checkFastRound` from `./draft` (add to the existing `./draft` import list).

After the existing weather check inside `rerollSlot` (the `if (... < 2 && q.category === "weather" ...) throw` block), add:

```ts
  if ((roundRules?.rulesVersion ?? 1) >= 2) {
    // The rule is round-level: check the round as it would stand with this
    // replacement in place, not the replacement alone.
    const siblings = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
    const merged = siblings.map((s) =>
      s.slot === slot
        ? { slot, is_big_one: q.is_big_one, resolves_at: q.resolves_at }
        : { slot: s.slot, is_big_one: s.isBigOne, resolves_at: s.resolvesAt ? s.resolvesAt.toISOString() : RESOLVES_AFTER_LOCK },
    );
    const fast = checkFastRound(merged, { lockAt: locksAtDefault, fastBy: fastResolveBy(date), voidAt: voidDeadline(date) });
    if (fast) throw new Error(`reroll: ${fast}`);
  }
```

Also, where `rerollSlot` writes the replacement row (the `.set({...})` on `schema.questions` a few lines below), add `resolvesAt: q.resolves_at === RESOLVES_AFTER_LOCK ? null : new Date(q.resolves_at),` alongside `locksAt`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/pipeline-author.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/author.ts apps/api/test/pipeline-author.test.ts
git commit -m "feat(pipeline): reroll re-checks the fast-round rule on the merged round

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 6: Tier-0 screen — v2 requires an instant, rejects slow candidates, accepts `forecast_point`

**Files:**
- Modify: `apps/api/src/pipeline/candidate.ts` (`REJECT_REASONS`, `CandidateSchema`, `screenCandidates`)
- Modify: `apps/api/src/pipeline/gauntlet/generate.ts:28-45` (tool schema) and the prompt at `:81-100`
- Modify: `apps/api/src/pipeline/gauntlet/index.ts:100` and `apps/api/src/pipeline/workflow-entrypoints.ts:139-146` (pass `voidAt`)
- Test: `apps/api/test/pipeline-candidate.test.ts`, `apps/api/test/gauntlet-generate.test.ts`

**Interfaces:**
- Produces: `REJECT_REASONS` gains `"slow"`.
- Produces: `CandidateSchema` gains optional `forecast_point: { lat: number; lon: number }`, required when `category === "weather"`.
- `screenCandidates(raw, opts)` — `opts` gains `voidAt?: Date`. At `rulesVersion >= 2`: `"after-lock"` is rejected (`structural`, detail `"v2 candidates must state a resolution instant"`); an instant past `voidAt` is rejected (`slow`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-candidate.test.ts`:

```ts
describe("tier-0 at v2 — instants and the void deadline (design 2026-09-09 §1)", () => {
  const voidAt = new Date("2026-09-06T16:00:00Z");
  const v2 = { opensAt, locksAtDefault, rulesVersion: 2, voidAt, recentTopicKeys: none };

  it("rejects after-lock at v2: the gauntlet must state the instant", () => {
    const r = screenCandidates([cand({ resolves_at: RESOLVES_AFTER_LOCK, category: "news" })], v2);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("structural");
    expect(r.rejected[0]!.detail).toContain("instant");
  });
  it("rejects an instant past the void deadline as slow", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-07T12:00:00Z" })], v2);
    expect(r.rejected[0]!.reason).toBe("slow");
  });
  it("passes an instant between the lock and the void deadline", () => {
    const r = screenCandidates([cand({ resolves_at: "2026-09-05T20:00:00Z" })], v2);
    expect(r.passed).toHaveLength(1);
  });
  it("requires forecast_point on weather and accepts it", () => {
    const noPoint = screenCandidates([cand({ category: "weather", resolves_at: "2026-09-06T00:00:00Z", topic_key: "nyc-high" })], v2);
    expect(noPoint.rejected[0]!.reason).toBe("structural");
    const withPoint = screenCandidates([cand({ category: "weather", resolves_at: "2026-09-06T00:00:00Z", topic_key: "nyc-high-2", forecast_point: { lat: 40.78, lon: -73.97 } })], v2);
    expect(withPoint.passed).toHaveLength(1);
    expect(withPoint.passed[0]!.forecast_point).toEqual({ lat: 40.78, lon: -73.97 });
  });
  it("ignores forecast_point on a non-weather candidate without rejecting it", () => {
    const r = screenCandidates([cand({ forecast_point: { lat: 1, lon: 1 }, resolves_at: "2026-09-05T20:00:00Z" })], v2);
    expect(r.passed).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/pipeline-candidate.test.ts`
Expected: FAIL on all five new tests.

- [ ] **Step 3: Implement in `candidate.ts`**

Add `"slow"` to `REJECT_REASONS` (after `"already-resolvable"`):

```ts
export const REJECT_REASONS = [
  "structural",
  "duplicate-topic",
  "compound",
  "dead-source",
  "ambiguous",
  "uncontested",
  "already-resolvable",
  "slow",
  "taste",
  "editorial",
] as const;
```

In `CandidateSchema`, add after `topic_key`:

```ts
    // Where to fetch the public forecast for a weather candidate (design
    // 2026-09-09 §1.3). The critic is shown that forecast, because a line a
    // forecast already clears by six degrees is not contested however the
    // sentence reads. Required for weather; ignored elsewhere.
    forecast_point: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
```

and a `.superRefine` on the object (chain it after the existing object definition; if one already exists, add to it):

```ts
  .superRefine((c, ctx) => {
    if (c.category === "weather" && !c.forecast_point) {
      ctx.addIssue({ code: "custom", message: "weather candidates must carry forecast_point", path: ["forecast_point"] });
    }
  })
```

In `screenCandidates`, change the `opts` type to add `voidAt?: Date`, and replace the two `resolves_at` blocks with:

```ts
    const v2 = (opts.rulesVersion ?? 1) >= 2;
    if (c.resolves_at === RESOLVES_AFTER_LOCK) {
      if (v2) {
        rejected.push({ text: c.text, reason: "structural", detail: "v2 candidates must state a resolution instant" });
        continue;
      }
    } else {
      const t = new Date(c.resolves_at);
      if (Number.isNaN(t.getTime()) || t.getTime() <= opts.opensAt.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at is at or before the round opens" });
        continue;
      }
      if (!v2 && t.getTime() > opts.locksAtDefault.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "resolves_at runs past the round's own close" });
        continue;
      }
      if (v2 && t.getTime() < opts.locksAtDefault.getTime()) {
        rejected.push({ text: c.text, reason: "structural", detail: "the common answering window must stay open" });
        continue;
      }
      if (v2 && opts.voidAt && t.getTime() > opts.voidAt.getTime()) {
        rejected.push({ text: c.text, reason: "slow", detail: "resolves after the void deadline; it would void unseen" });
        continue;
      }
    }
```

- [ ] **Step 4: Update the generator's tool schema and prompt**

In `apps/api/src/pipeline/gauntlet/generate.ts`, change the `resolves_at` property description to:

```ts
  resolves_at: {
    type: "string",
    description:
      "ISO-8601 UTC instant at which this outcome first becomes publicly determinable from the named source: the final whistle, the close, the release time. Always an instant. Never the word after-lock.",
  },
```

Add a `forecast_point` property after `topic_key`:

```ts
  forecast_point: {
    type: ["object", "null"],
    description: "WEATHER ONLY: the latitude/longitude of the measuring station, so the public forecast can be fetched. Null for every other category.",
    properties: { lat: { type: "number" }, lon: { type: "number" } },
    required: ["lat", "lon"],
    additionalProperties: false,
  },
```

Because `required: Object.keys(candidateProperties)` lists every property, the model must send `forecast_point: null` for non-weather. In `candidate.ts` make the Zod field tolerate that: change `.optional()` to `.nullable().optional()` and in the `superRefine` treat `null` as absent (`!c.forecast_point`) — already true with `!`.

In the prompt string, replace the two bullets beginning `- THE ANSWER MUST NOT EXIST…` and `- Every question must remain unknowable…` with:

```text
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. Set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. Always give the instant; "after-lock" is not accepted. A resolver will be run against your named source TONIGHT, and any candidate it can already answer is rejected.
- Every question must remain unknowable until noon ET on ${lockDay}, and then DECIDE FAST. At least four of the five chosen will be questions that resolve by ${fastByLabel} — the same evening as the lock. Only the Big One may run to the next morning, and nothing may resolve later than noon ET on ${voidDayLabel}: a question that decides on Sunday voids unseen. Tonight's games, today's close, tomorrow morning's release. Never a weekend total on a Wednesday.
```

and replace the `- WEATHER:` bullet with:

```text
- WEATHER: the measurement period must begin after noon ET on ${lockDay} and end the same evening. Set resolves_at to the end of the measurement period, and set forecast_point to the station's latitude and longitude. The public forecast will be fetched and shown to the reader who judges whether the question is contested — so set the line where the forecast is genuinely uncertain, never at a number today's forecast already clears.
```

Define the labels next to `lockDay` at the top of the prompt function:

```ts
  const fastByLabel = `${fastResolveBy(date).toISOString().slice(11, 16)}Z on ${lockDay}`;
  const voidDayLabel = addDays(date, 2);
```

importing `fastResolveBy` from `../clock` (the file already imports `addDays`; extend that import).

- [ ] **Step 5: Pass `voidAt` from both gauntlet runners**

In `apps/api/src/pipeline/gauntlet/index.ts` `runAuthoringGauntlet`, change the `screenCandidates` call to include `voidAt: voidDeadline(date)` (import `voidDeadline` from `../clock`).

In `apps/api/src/pipeline/workflow-entrypoints.ts` `AuthoringWorkflow`, add `voidAt: voidDeadline(date)` to the `screenCandidates` opts inside the `"screen"` step (import `voidDeadline` from `./clock`).

- [ ] **Step 6: Fix the generate tests' fixtures if they assert the prompt text**

Run: `cd apps/api && pnpm vitest run test/gauntlet-generate.test.ts`
If a test asserts the old bullet wording (`"after-lock"` in the prompt), update its expectation to the new wording (e.g. assert the prompt contains `"DECIDE FAST"` and `"forecast_point"`).

- [ ] **Step 7: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/pipeline-candidate.test.ts test/gauntlet-generate.test.ts test/gauntlet-run.test.ts test/pipeline-workflows.test.ts && pnpm typecheck`
Expected: PASS. If `gauntlet-run.test.ts` fixtures use `after-lock` candidates at v2, give them instants inside the window (e.g. `"<lockDay>T19:00:00Z"`).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pipeline/candidate.ts apps/api/src/pipeline/gauntlet/generate.ts apps/api/src/pipeline/gauntlet/index.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/test
git commit -m "feat(gauntlet): v2 candidates state an instant, slow ones are put down, weather carries forecast_point

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 7: `gatherForecasts` — fetch the public NWS forecast for weather candidates

**Files:**
- Create: `apps/api/src/pipeline/gauntlet/forecast.ts`
- Test: `apps/api/test/gauntlet-forecast.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const FORECAST_TIMEOUT_MS = 5000;
  export type ForecastsByIndex = Record<string, string>; // candidate index → compact forecast text
  export async function gatherForecasts(fetchFn: typeof fetch, candidates: Candidate[]): Promise<ForecastsByIndex>
  ```
  Only weather candidates with a `forecast_point` are fetched. A failed fetch leaves that index absent (the critic rejects it — Task 8). The return is a plain object so a durable step can checkpoint it.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/gauntlet-forecast.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gatherForecasts } from "../src/pipeline/gauntlet/forecast";
import type { Candidate } from "../src/pipeline/candidate";

const weather = (o: Partial<Candidate> = {}): Candidate => ({
  category: "weather", text: "Will Central Park reach 80F Thursday?", resolution_criteria: "NWS daily climate report",
  source_name: "NWS", source_url: "https://www.weather.gov/", author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-11T00:00:00Z", topic_key: "nyc-high", forecast_point: { lat: 40.78, lon: -73.97 }, ...o,
});
const news = (): Candidate => ({ ...weather(), category: "news", forecast_point: undefined, topic_key: "news-1" });

const points = { properties: { forecast: "https://api.weather.gov/gridpoints/OKX/33,37/forecast" } };
const forecast = { properties: { periods: [
  { name: "Thursday", temperature: 86, temperatureUnit: "F", shortForecast: "Partly sunny", probabilityOfPrecipitation: { value: 20 } },
  { name: "Thursday Night", temperature: 70, temperatureUnit: "F", shortForecast: "Clear", probabilityOfPrecipitation: { value: null } },
] } };

function fakeFetch(map: Record<string, unknown>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const hit = Object.entries(map).find(([k]) => url.startsWith(k));
    if (!hit) return new Response("nope", { status: 404 });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("gatherForecasts (design 2026-09-09 §1.3)", () => {
  it("fetches points then forecast for a weather candidate and returns compact text keyed by index", async () => {
    const calls: string[] = [];
    const f = fakeFetch({ "https://api.weather.gov/points/40.78,-73.97": points, "https://api.weather.gov/gridpoints/OKX/33,37/forecast": forecast }, calls);
    const out = await gatherForecasts(f, [news(), weather()]);
    expect(Object.keys(out)).toEqual(["1"]);
    expect(out["1"]).toContain("Thursday: 86F, Partly sunny, precip 20%");
    expect(out["1"]).toContain("Thursday Night: 70F, Clear");
    expect(calls[0]).toContain("/points/40.78,-73.97");
  });
  it("sends a User-Agent, which api.weather.gov requires", async () => {
    let ua: string | null = null;
    const f = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      ua = new Headers(init?.headers).get("user-agent");
      return new Response(JSON.stringify(points), { status: 200 });
    }) as typeof fetch;
    await gatherForecasts(f, [weather()]).catch(() => {});
    expect(ua).toContain("oracle");
  });
  it("leaves the index absent when the fetch fails, and never throws", async () => {
    const out = await gatherForecasts(fakeFetch({}), [weather()]);
    expect(out).toEqual({});
  });
  it("skips non-weather candidates entirely", async () => {
    const calls: string[] = [];
    await gatherForecasts(fakeFetch({}, calls), [news()]);
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/gauntlet-forecast.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/pipeline/gauntlet/forecast.ts`:

```ts
// The public forecast (design 2026-09-09 §1.3). A weather line the forecast
// already clears by six degrees is not contested however the sentence reads,
// and a critic that has not seen the forecast cannot know that. One keyless
// GET pair per weather candidate against api.weather.gov, fetched here and
// shown to the critic beside the candidate. Fetch is injected so tests never
// touch the network; a failure leaves the index absent and the critic puts
// the candidate down rather than judging it blind.
import type { Candidate } from "../candidate";

export const FORECAST_TIMEOUT_MS = 5000;
export type ForecastsByIndex = Record<string, string>;

const HEADERS = { "user-agent": "oracle-pipeline (outseen)", accept: "application/geo+json" };

interface Period {
  name: string;
  temperature: number;
  temperatureUnit: string;
  shortForecast: string;
  probabilityOfPrecipitation?: { value: number | null };
}

function compact(periods: Period[]): string {
  return periods
    .slice(0, 6)
    .map((p) => {
      const pop = p.probabilityOfPrecipitation?.value;
      return `${p.name}: ${p.temperature}${p.temperatureUnit}, ${p.shortForecast}${typeof pop === "number" ? `, precip ${pop}%` : ""}`;
    })
    .join(" · ");
}

async function fetchForecast(fetchFn: typeof fetch, lat: number, lon: number): Promise<string> {
  const pointsRes = await fetchFn(`https://api.weather.gov/points/${lat},${lon}`, { headers: HEADERS, signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!pointsRes.ok) throw new Error(`points ${pointsRes.status}`);
  const points = (await pointsRes.json()) as { properties?: { forecast?: string } };
  const url = points.properties?.forecast;
  if (!url) throw new Error("no forecast url");
  const fRes = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) });
  if (!fRes.ok) throw new Error(`forecast ${fRes.status}`);
  const f = (await fRes.json()) as { properties?: { periods?: Period[] } };
  const periods = f.properties?.periods ?? [];
  if (periods.length === 0) throw new Error("no periods");
  return compact(periods);
}

export async function gatherForecasts(fetchFn: typeof fetch, candidates: Candidate[]): Promise<ForecastsByIndex> {
  const out: ForecastsByIndex = {};
  await Promise.all(
    candidates.map(async (c, i) => {
      if (c.category !== "weather" || !c.forecast_point) return;
      try {
        out[String(i)] = await fetchForecast(fetchFn, c.forecast_point.lat, c.forecast_point.lon);
      } catch {
        // Absent index = the critic rejects it. Never throw: one dead
        // forecast must not abort the night.
      }
    }),
  );
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/gauntlet-forecast.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/gauntlet/forecast.ts apps/api/test/gauntlet-forecast.test.ts
git commit -m "feat(gauntlet): gatherForecasts fetches the public NWS forecast for weather candidates

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 8: The critic reads the forecast; wire the step in both runners

**Files:**
- Modify: `apps/api/src/pipeline/gauntlet/critic.ts` (`SYSTEM`, `candidateBlock`, `criticize` signature)
- Modify: `apps/api/src/pipeline/gauntlet/index.ts:103-110` (inline runner)
- Modify: `apps/api/src/pipeline/workflow-entrypoints.ts:150-158` (Workflow runner)
- Test: `apps/api/test/gauntlet-critic.test.ts`

**Interfaces:**
- `criticize(deps, candidates, forecasts: ForecastsByIndex = {})`. A weather candidate with no forecast at its index is rejected `uncontested` with detail `"no public forecast could be fetched"` before the model is called. A weather candidate with a forecast has `PUBLIC FORECAST (fetched tonight): …` appended to its block.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/gauntlet-critic.test.ts`:

```ts
describe("criticize reads the public forecast (design 2026-09-09 §1.3)", () => {
  const weather = (o: Partial<Candidate> = {}): Candidate =>
    cand({ category: "weather", forecast_point: { lat: 40.78, lon: -73.97 }, topic_key: "nyc-high", ...o });

  it("shows the critic the forecast beside a weather candidate", async () => {
    const { db } = await makeTestDb();
    const seen: { user?: string } = {};
    await criticize(deps(db, { verdicts: [verdict(0)] }, seen), [weather()], { "0": "Thursday: 86F, Partly sunny" });
    expect(seen.user).toContain("PUBLIC FORECAST");
    expect(seen.user).toContain("86F");
  });
  it("rejects a weather candidate whose forecast could not be fetched, without calling the model", async () => {
    const { db } = await makeTestDb();
    let called = false;
    const d = deps(db, { verdicts: [] });
    d.claude = { structured: async () => { called = true; return { verdicts: [] }; } };
    const r = await criticize(d, [weather()], {});
    expect(called).toBe(false);
    expect(r.rejected[0]).toMatchObject({ reason: "uncontested" });
    expect(r.rejected[0]!.detail).toContain("forecast");
  });
  it("does not require a forecast for a non-weather candidate", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0)] }), [cand()], {});
    expect(r.passed).toHaveLength(1);
  });
  it("still rejects the lopsided read the forecast produces", async () => {
    const { db } = await makeTestDb();
    const r = await criticize(deps(db, { verdicts: [verdict(0, { critic_probability: 0.92 })] }), [weather()], { "0": "Thursday: 86F" });
    expect(r.rejected[0]!.reason).toBe("uncontested");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/gauntlet-critic.test.ts`
Expected: FAIL — `criticize` takes two arguments / no `PUBLIC FORECAST` in prompt.

- [ ] **Step 3: Implement in `critic.ts`**

Import the type: `import type { ForecastsByIndex } from "./forecast";`

Add to `SYSTEM` (before the `Return exactly one verdict…` line):

```text
Some candidates carry a PUBLIC FORECAST fetched tonight. That forecast is public information every player will have. Your critic_probability must account for it: a threshold the forecast already clears by a wide margin is not contested, and you should say so with a probability near 0 or 1.
```

Change `candidateBlock` to:

```ts
function candidateBlock(candidates: Candidate[], forecasts: ForecastsByIndex): string {
  return candidates
    .map((c, i) => {
      const f = forecasts[String(i)];
      return `[${i}] (${c.category}) ${c.text}\n  CRITERIA: ${c.resolution_criteria}\n  SOURCE: ${c.source_name} <${c.source_url}>\n  RESOLVES AT: ${c.resolves_at}${f ? `\n  PUBLIC FORECAST (fetched tonight): ${f}` : ""}`;
    })
    .join("\n\n");
}
```

Change the `criticize` signature and add the pre-model reject:

```ts
export async function criticize(
  deps: PipelineDeps,
  candidates: Candidate[],
  forecasts: ForecastsByIndex = {},
): Promise<Screened & { judged: Judged[] }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  // A weather candidate whose forecast did not arrive is judged by no one:
  // the critic would be reading it blind, which is the exact failure §1.3
  // exists to close.
  const blindRejected: Rejection[] = [];
  const judgeable: Candidate[] = [];
  const judgeableIndex: number[] = [];
  candidates.forEach((c, i) => {
    if (c.category === "weather" && !forecasts[String(i)]) {
      blindRejected.push({ text: c.text, reason: "uncontested", detail: "no public forecast could be fetched, so contestedness cannot be judged" });
    } else {
      judgeable.push(c);
      judgeableIndex.push(i);
    }
  });
  if (judgeable.length === 0) return { passed: [], rejected: blindRejected, judged: [] };

  // Re-key forecasts to the judgeable list's own indices, which is what the
  // model is shown and what its verdict indices refer to.
  const shown: ForecastsByIndex = {};
  judgeableIndex.forEach((orig, j) => { const f = forecasts[String(orig)]; if (f) shown[String(j)] = f; });

  const response = await deps.claude.structured({
    model: deps.models.critic,
    system: SYSTEM,
    user: `${candidateBlock(judgeable, shown)}\n\nReturn one verdict per candidate now.`,
    schemaName: "critic_verdicts",
    schema: criticJsonSchema,
  });
```

Then replace every later use of `candidates` inside `criticize` with `judgeable`, and when returning, prepend `blindRejected` to `rejected`: `return { passed, rejected: [...blindRejected, ...rejected], judged };` (and in the parse-failure early return, `rejected: [...blindRejected, ...judgeable.map(...)]`).

- [ ] **Step 4: Wire the inline runner**

In `apps/api/src/pipeline/gauntlet/index.ts` `runAuthoringGauntlet`, replace the tier-2 lines with:

```ts
  // Tier 2 — the public forecast for weather, then one model call, plus §7.
  const forecasts = await gatherForecasts(deps.sourceFetch ?? fetch, tier1.passed);
  const tier2 = await criticize(deps, tier1.passed, forecasts);
  count(tier2.rejected);
```

importing `gatherForecasts` from `./forecast`.

- [ ] **Step 5: Wire the Workflow runner**

In `apps/api/src/pipeline/workflow-entrypoints.ts` `AuthoringWorkflow`, replace the tier-2 block with:

```ts
    // Tier 2 — the public forecast (its own step: a fetch, checkpointed as a
    // plain object), then one model call, plus §7's contestedness gate.
    const forecasts = await durableStep(step, "forecasts", POLICY.sourceFetch, deps, () =>
      gatherForecasts(deps.sourceFetch ?? fetch, tier1.passed),
    );
    const tier2 = await durableStep(step, "critic", POLICY.model, deps, () =>
      criticize(deps, tier1.passed, forecasts),
    );
    count(tier2.rejected);
```

importing `gatherForecasts` from `./gauntlet/forecast`.

- [ ] **Step 6: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/gauntlet-critic.test.ts test/gauntlet-run.test.ts test/pipeline-workflows.test.ts && pnpm test:workflows && pnpm typecheck`
Expected: PASS. If a workflows test enumerates step names in order, add `"forecasts"` between `"sources"` and `"critic"`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pipeline/gauntlet/critic.ts apps/api/src/pipeline/gauntlet/index.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/test
git commit -m "feat(gauntlet): the critic prosecutes weather with the public forecast in hand

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 9: Selection composes a fast slate

**Files:**
- Modify: `apps/api/src/pipeline/gauntlet/select.ts`
- Modify: `apps/api/src/pipeline/gauntlet/index.ts` (the `selectRound` call inside `commitRound`)
- Test: `apps/api/test/gauntlet-select.test.ts`

**Interfaces:**
- `selectRound(judged: Judged[], window?: { fastBy: Date }): Selection | null`. With a window: at most one chosen candidate may have `resolves_at` later than `fastBy`, and if one is chosen it becomes the Big One regardless of contest ranking. Without a window (tests, legacy callers) behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/gauntlet-select.test.ts`:

```ts
describe("selectRound composes a fast slate (design 2026-09-09 §1.2)", () => {
  const fastBy = new Date("2026-09-05T20:00:00Z");
  const at = (n: number, category: Candidate["category"], p: number, resolves_at: string): Judged => ({ ...j(category, p, n), candidate: { ...j(category, p, n).candidate, resolves_at } });

  it("with only fast candidates, behaves as before", () => {
    const s = selectRound(five, { fastBy })!;
    expect(s.draft.questions).toHaveLength(5);
  });
  it("takes at most one slow candidate and makes it the Big One", () => {
    const pool = [
      at(1, "markets", 0.55, "2026-09-05T18:00:00Z"),
      at(2, "sports", 0.45, "2026-09-05T19:00:00Z"),
      at(3, "culture", 0.60, "2026-09-05T19:30:00Z"),
      at(4, "news", 0.50, "2026-09-06T12:30:00Z"),   // slow, and the most contested
      at(5, "news", 0.52, "2026-09-06T13:00:00Z"),   // slow, second most contested — must NOT be chosen
      at(6, "weather", 0.40, "2026-09-05T18:30:00Z"),
    ];
    const s = selectRound(pool, { fastBy })!;
    const texts = s.draft.questions.map((q) => q.text);
    expect(texts).not.toContain("Will thing 5 happen?");
    const big = s.draft.questions.find((q) => q.is_big_one)!;
    expect(big.text).toBe("Will thing 4 happen?");
  });
  it("returns null when fewer than four fast candidates survive", () => {
    const pool = [
      at(1, "markets", 0.55, "2026-09-05T18:00:00Z"),
      at(2, "sports", 0.45, "2026-09-05T19:00:00Z"),
      at(3, "culture", 0.60, "2026-09-06T12:00:00Z"),
      at(4, "news", 0.50, "2026-09-06T12:30:00Z"),
      at(5, "weather", 0.52, "2026-09-06T13:00:00Z"),
    ];
    expect(selectRound(pool, { fastBy })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/gauntlet-select.test.ts`
Expected: FAIL — slow candidate 5 chosen / Big One not forced.

- [ ] **Step 3: Implement**

In `select.ts`:

```ts
export interface SelectWindow { fastBy: Date }

const isSlow = (j: Judged, w?: SelectWindow) =>
  !!w && j.candidate.resolves_at !== "after-lock" && new Date(j.candidate.resolves_at).getTime() > w.fastBy.getTime();

function pickFive(ranked: Judged[], w?: SelectWindow): Judged[] | null {
  if (ranked.length < ROUND_SIZE) return null;
  const chosen: Judged[] = [];
  const usedCategories = new Set<string>();
  let slowTaken = false;
  const take = (j: Judged) => { chosen.push(j); usedCategories.add(j.candidate.category); if (isSlow(j, w)) slowTaken = true; };
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (usedCategories.has(j.candidate.category)) continue;
    if (isSlow(j, w) && slowTaken) continue;
    take(j);
  }
  for (const j of ranked) {
    if (chosen.length === ROUND_SIZE) break;
    if (chosen.includes(j)) continue;
    if (isSlow(j, w) && slowTaken) continue;
    take(j);
  }
  return chosen.length === ROUND_SIZE ? chosen : null;
}

function toDraft(chosen: Judged[], w?: SelectWindow): Draft {
  const ranked = [...chosen].sort(byContest);
  // A slow candidate, if one was taken, is the Big One by law (§1.2) — it is
  // the only slot allowed to run past the evening.
  const slow = ranked.find((j) => isSlow(j, w));
  const nominated = ranked.filter(j => j.editorial?.bigOne);
  const big = slow ?? (nominated.length ? [...nominated].sort((a, b) => b.editorial!.interest - a.editorial!.interest || b.editorial!.reasonability - a.editorial!.reasonability)[0]! : ranked[0]!);
  const rest = ranked.filter(j => j !== big);
  // (unchanged from here: the editorial sort of `rest`, the `question` mapper, the return)
```

and `selectRound`:

```ts
export function selectRound(judged: Judged[], window?: SelectWindow): Selection | null {
  const ranked = [...judged].filter(/* unchanged */).sort(/* unchanged */);
  const chosen = pickFive(ranked, window);
  if (!chosen) return null;
  const distinct = new Set(chosen.map((j) => j.candidate.category)).size;
  if (distinct >= MIN_DISTINCT_CATEGORIES) return { draft: toDraft(chosen, window), relaxed: false };
  if (distinct >= RELAXED_DISTINCT_CATEGORIES) return { draft: toDraft(chosen, window), relaxed: true };
  return null;
}
```

- [ ] **Step 4: Pass the window from `commitRound`**

In `apps/api/src/pipeline/gauntlet/index.ts` `commitRound`, change the `selectRound(...)` call to `selectRound(edited, { fastBy: fastResolveBy(date) })` (the exact first argument name is whatever the function already passes; import `fastResolveBy` from `../clock`).

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/gauntlet-select.test.ts test/gauntlet-run.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/gauntlet/select.ts apps/api/src/pipeline/gauntlet/index.ts apps/api/test/gauntlet-select.test.ts
git commit -m "feat(gauntlet): selection composes a fast slate; a slow pick is the Big One by law

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 10: Honest withdrawal — `withdrawQuestion`, admin route, `/today` `struck` fields, exhibition skip

**Files:**
- Modify: `apps/api/src/resolution.ts` (add `withdrawQuestion`)
- Modify: `apps/api/src/routes/admin.ts` (new route after `/questions/:id/resolve`)
- Modify: `apps/api/src/routes/round.ts:41-53` (`/today` mapper)
- Modify: `apps/api/src/exhibition.ts:28`
- Test: `apps/api/test/resolution.test.ts`, `apps/api/test/admin-rounds.test.ts`, `apps/api/test/round.test.ts`, `apps/api/test/exhibition.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type WithdrawalReason = "misauthored" | "unresolvable";
  export async function withdrawQuestion(db: Db, questionId: string, reason: WithdrawalReason, now: Date): Promise<{ remaining: number }>
  ```
  Throws `"question not found"`, `"not withdrawable"` (status not open/locked), `"already withdrawn"`. Sets `locksAt = min(locksAt, now)`, `withdrawnAt = now`, then voids through `resolveQuestion` with `{ reason: PIPELINE_LINES.withdrawnMisauthored | withdrawnUnresolvable, withdrawn: true }`. Returns the count of the round's questions that are neither void nor withdrawn afterwards.
- `POST /admin/questions/:id/withdraw` body `{ reason: "misauthored" | "unresolvable" }` → `200 { ok: true, remaining }`, `400` bad body, `404`, `409` not withdrawable / already withdrawn.
- `/today` questions gain `struck: boolean` (`lockHealedAt !== null || withdrawnAt !== null`) and `struck_reason: string | null` (the stored evidence reason for a withdrawn question; `PIPELINE_LINES.lockHealed`-style v2 leak text for a healed one — use the exact string `"THE ANSWER APPEARED EARLY. THIS QUESTION IS VOID FOR EVERYONE."` that `probe.ts` stores, read from `resolutionEvidence.reason` via `evidenceSummary`).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/resolution.test.ts`:

```ts
import { withdrawQuestion } from "../src/resolution";
import { PIPELINE_LINES } from "@oracle/core";

describe("withdrawQuestion (design 2026-09-09 §1.4)", () => {
  it("closes the lock, marks withdrawn, voids with the honest reason, zeroes predictions", async () => {
    const { db } = await makeTestDb();
    await db.update(schema.rounds).set({ rulesVersion: 2 }); // no-op if none yet; seedRound below inserts fresh
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await db.update(schema.rounds).set({ rulesVersion: 2 }).where(eq(schema.rounds.date, "2026-09-09"));
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ userId: u!.id, questionId: qs[2]!.id, answer: true, confidence: 70 });
    const now = new Date("2026-09-09T20:00:00Z");
    const { remaining } = await withdrawQuestion(db, qs[2]!.id, "misauthored", now);
    expect(remaining).toBe(4);
    const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, qs[2]!.id) });
    expect(q!.status).toBe("void");
    expect(q!.outcome).toBe("void");
    expect(q!.withdrawnAt?.toISOString()).toBe(now.toISOString());
    expect(q!.locksAt.toISOString()).toBe(now.toISOString());
    expect(q!.lockHealedAt).toBeNull();
    expect((q!.resolutionEvidence as { reason: string }).reason).toBe(PIPELINE_LINES.withdrawnMisauthored);
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, qs[2]!.id) });
    expect(p!.points).toBe(0);
    expect(p!.brier).toBeNull();
  });
  it("refuses a second withdrawal and a resolved question", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    await withdrawQuestion(db, qs[0]!.id, "unresolvable", new Date("2026-09-09T20:00:00Z"));
    await expect(withdrawQuestion(db, qs[0]!.id, "unresolvable", new Date())).rejects.toThrow("already withdrawn");
    await resolveQuestion(db, qs[1]!.id, "yes");
    await expect(withdrawQuestion(db, qs[1]!.id, "misauthored", new Date())).rejects.toThrow("not withdrawable");
  });
});
```

(Adjust the `users` insert to whatever minimal columns `schema.users` requires; look at how `test/resolution.test.ts` already creates a user and copy that.)

Append to `apps/api/test/round.test.ts` inside the existing `describe("/today says which locks were healed …")`:

```ts
  it("reports struck + struck_reason for a withdrawn question, with lock_healed still false", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await withdrawQuestion(db, qs[1]!.id, "misauthored", new Date());
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; lock_healed: boolean; struck: boolean; struck_reason: string | null }> };
    const w = body.questions.find((q) => q.id === qs[1]!.id)!;
    expect(w.lock_healed).toBe(false);
    expect(w.struck).toBe(true);
    expect(w.struck_reason).toBe(PIPELINE_LINES.withdrawnMisauthored);
    expect(body.questions.filter((q) => q.id !== w.id).every((q) => q.struck === false && q.struck_reason === null)).toBe(true);
  });
  it("reports struck for a probe-healed question too", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const call = await player(app);
    const qs = await seedOpenRoundNow(db);
    await db.update(schema.questions).set({ lockHealedAt: new Date() }).where(eq(schema.questions.id, qs[0]!.id));
    const body = (await (await call("/v1/round/today")).json()) as { questions: Array<{ id: string; struck: boolean }> };
    expect(body.questions.find((q) => q.id === qs[0]!.id)!.struck).toBe(true);
  });
```

(import `withdrawQuestion` from `../src/resolution` and `PIPELINE_LINES` from `@oracle/core` at the top.)

Append to `apps/api/test/admin-rounds.test.ts`:

```ts
describe("POST /admin/questions/:id/withdraw (design 2026-09-09 §1.4)", () => {
  it("withdraws with the admin secret and returns the remaining count", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const res = await app.request(`/admin/questions/${qs[3]!.id}/withdraw`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-secret": "admin" },
      body: JSON.stringify({ reason: "unresolvable" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, remaining: 4 });
  });
  it("400s a bad reason, 404s an unknown id, 409s a second withdrawal", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-09-09", opensAt: new Date("2026-09-09T16:00:00Z"), locksAt: new Date("2026-09-10T16:00:00Z") });
    const post = (id: string, body: unknown) => app.request(`/admin/questions/${id}/withdraw`, { method: "POST", headers: { "content-type": "application/json", "x-admin-secret": "admin" }, body: JSON.stringify(body) });
    expect((await post(qs[0]!.id, { reason: "because" })).status).toBe(400);
    expect((await post("00000000-0000-0000-0000-000000000000", { reason: "misauthored" })).status).toBe(404);
    expect((await post(qs[0]!.id, { reason: "misauthored" })).status).toBe(200);
    expect((await post(qs[0]!.id, { reason: "misauthored" })).status).toBe(409);
  });
});
```

Append to `apps/api/test/exhibition.test.ts` (mirror the existing "skips a healed lock" test that sets `lockHealedAt`):

```ts
  it("never exhibits a withdrawn question", async () => {
    // Copy the setup of the sibling test that sets lockHealedAt on a resolved
    // question and asserts it is not selected; set withdrawnAt instead.
  });
```

Write the body by copying that sibling test verbatim and replacing `lockHealedAt: new Date(...)` with `withdrawnAt: new Date(...)`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && pnpm vitest run test/resolution.test.ts test/round.test.ts test/admin-rounds.test.ts test/exhibition.test.ts`
Expected: FAIL — `withdrawQuestion` not exported, route 404, `struck` undefined.

- [ ] **Step 3: Implement `withdrawQuestion`**

Append to `apps/api/src/resolution.ts`:

```ts
import { PIPELINE_LINES } from "@oracle/core";

export type WithdrawalReason = "misauthored" | "unresolvable";

const WITHDRAWAL_LINE: Record<WithdrawalReason, string> = {
  misauthored: PIPELINE_LINES.withdrawnMisauthored,
  unresolvable: PIPELINE_LINES.withdrawnUnresolvable,
};

// Editorial withdrawal (design 2026-09-09 §1.4). The operator strikes a live
// question with a TRUE reason. The lock moves to now so no further seal can
// land, withdrawn_at marks it (distinct from lock_healed_at, which only the
// probe writes when an answer leaked), and the void goes through
// resolveQuestion so every prediction is zeroed exactly the way any other
// void is. Idempotent by the status guard: a retry after the write sees
// "already withdrawn".
export async function withdrawQuestion(db: Db, questionId: string, reason: WithdrawalReason, now: Date): Promise<{ remaining: number }> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error("question not found");
  if (q.withdrawnAt) throw new Error("already withdrawn");
  if (!FRESH.has(q.status)) throw new Error("not withdrawable");

  await db.update(schema.questions)
    .set({ locksAt: q.locksAt.getTime() < now.getTime() ? q.locksAt : now, withdrawnAt: now })
    .where(eq(schema.questions.id, questionId));
  await resolveQuestion(db, questionId, "void", { reason: WITHDRAWAL_LINE[reason], withdrawn: true, checked_at: now.toISOString() });

  const siblings = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, q.roundDate) });
  const remaining = siblings.filter((s) => s.id !== questionId && s.status !== "void" && !s.withdrawnAt).length;
  return { remaining };
}
```

(Place the `PIPELINE_LINES` import with the other imports at the top of the file.)

- [ ] **Step 4: Add the admin route**

In `apps/api/src/routes/admin.ts`, after the `.post("/questions/:id/resolve", …)` handler add:

```ts
  .post("/questions/:id/withdraw", async (c) => {
    const parsed = z.object({ reason: z.enum(["misauthored", "unresolvable"]) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    try {
      const out = await withdrawQuestion(c.get("deps").db, c.req.param("id"), parsed.data.reason, new Date());
      return c.json({ ok: true, remaining: out.remaining });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "withdraw failed";
      if (msg === "question not found") return c.json({ error: msg }, 404);
      if (msg === "already withdrawn" || msg === "not withdrawable") return c.json({ error: msg }, 409);
      return c.json({ error: "withdraw failed" }, 500);
    }
  })
```

importing `withdrawQuestion` from `../resolution` (extend the existing import that brings `resolveQuestion`).

- [ ] **Step 5: Emit `struck` from `/today`**

In `apps/api/src/routes/round.ts` `/today` mapper, after `lock_healed: q.lockHealedAt !== null,` add:

```ts
        // Struck for everyone (v2): healed by the probe OR withdrawn by the
        // operator. The client gates the required set on this; lock_healed
        // above stays probe-only so the leak analytics keep their meaning.
        struck: q.lockHealedAt !== null || q.withdrawnAt !== null,
        struck_reason: q.lockHealedAt !== null || q.withdrawnAt !== null ? (evidenceSummary(q.resolutionEvidence).reason ?? null) : null,
```

(`evidenceSummary` is already imported in this file for the reveal.)

- [ ] **Step 6: Exhibition skip**

In `apps/api/src/exhibition.ts` change `if (question.lockHealedAt !== null) continue;` to `if (question.lockHealedAt !== null || question.withdrawnAt !== null) continue;`.

- [ ] **Step 7: Run to verify it passes**

Run: `cd apps/api && pnpm vitest run test/resolution.test.ts test/round.test.ts test/admin-rounds.test.ts test/exhibition.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/resolution.ts apps/api/src/routes/admin.ts apps/api/src/routes/round.ts apps/api/src/exhibition.ts apps/api/test
git commit -m "feat(api): honest question withdrawal, struck fields on /today

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 11: Mobile gates on `struck` and prints the honest reason

**Files:**
- Modify: `apps/mobile/src/game/roundAvailability.ts`
- Modify: `apps/mobile/src/game/arrivalState.ts:24,58`
- Modify: `apps/mobile/src/app/index.tsx:101`
- Modify: `apps/mobile/src/app/round.tsx:174-178`
- Modify: `apps/mobile/src/ui/PracticeCard.tsx:22`
- Test: `apps/mobile/test/roundAvailability.test.ts`, `apps/mobile/test/arrivalState.test.ts`

**Interfaces:**
- Consumes: `RoundToday.questions[].struck`, `.struck_reason` (Task 1).
- All v2 required-set / void-count logic keys on `struck`. `lock_healed` is no longer read by the client.

- [ ] **Step 1: Update the tests to the new field**

In `apps/mobile/test/roundAvailability.test.ts` and `apps/mobile/test/arrivalState.test.ts`, rename every `lock_healed:` key in fixtures to `struck:`. Add one new case to `roundAvailability.test.ts`:

```ts
  it("counts a withdrawn (struck) question as void at v2 and never as missed", () => {
    const qs = [
      { id: "a", locks_at: "2026-09-07T14:00:00Z", struck: true },
      { id: "b", locks_at: "2026-09-07T16:00:00Z", struck: false },
      { id: "c", locks_at: "2026-09-07T16:00:00Z", struck: false },
      { id: "d", locks_at: "2026-09-07T16:00:00Z", struck: false },
      { id: "e", locks_at: "2026-09-07T16:00:00Z", struck: false },
    ];
    const r = roundAvailability(qs, new Set(), Date.parse("2026-09-07T15:00:00Z"), 2);
    expect(r.voidCount).toBe(1);
    expect(r.missedCount).toBe(0);
    expect(r.completeStillPossible).toBe(true);
  });
```

(Match the exact return field names `roundAvailability` already exposes — read the function first; `voidCount`, `missedCount`, `completeStillPossible` are the ones it returns today.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/mobile && pnpm vitest run test/roundAvailability.test.ts test/arrivalState.test.ts`
Expected: FAIL — `struck` is not read.

- [ ] **Step 3: Implement**

`apps/mobile/src/game/roundAvailability.ts`: replace every `lock_healed` with `struck` (type and body).

`apps/mobile/src/game/arrivalState.ts`: line 24 `lock_healed?: boolean;` → `struck?: boolean;`; line 58 `question.lock_healed` → `question.struck`.

`apps/mobile/src/app/index.tsx:101`: `question.lock_healed` → `question.struck`.

`apps/mobile/src/ui/PracticeCard.tsx:22`: `lock_healed: false,` → `lock_healed: false, struck: false, struck_reason: null,`.

`apps/mobile/src/app/round.tsx:174-178`: replace the banner block with:

```tsx
        {(() => {
          const struckQ = qs.find((q) => q.struck && ((today.data?.rules_version ?? 1) >= 2 || !answers[q.id]?.sealed));
          if (!struckQ) return null;
          const line = (today.data?.rules_version ?? 1) >= 2
            ? (struckQ.struck_reason ?? "STRUCK · VOID FOR EVERYONE")
            : PIPELINE_LINES.lockHealed;
          return (
            <Mono {...role.meta} color={colors.mutedInk} style={{ textAlign: "center" }}>
              {line}
            </Mono>
          );
        })()}
```

Also update the comment above it: it now explains that the reason printed is whatever the server stored — a leak reads as a leak, a withdrawal reads as a withdrawal.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/mobile && pnpm vitest run && pnpm typecheck`
Expected: PASS. Fix any remaining `lock_healed` references the typecheck reports (the grep list above is complete as of writing).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src apps/mobile/test
git commit -m "feat(mobile): gate the required set on struck; the banner prints the honest reason

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 12: Full suite, docs, and the deploy checklist

**Files:**
- Modify: `docs/launch-playbook.md` (add the withdraw command next to the existing admin curl examples, ~line 140)
- Modify: `docs/gameplay/question-review.md` (add the fast-round rule and forecast grounding to the rubric table)

- [ ] **Step 1: Run everything**

Run: `pnpm -r typecheck && pnpm -r test`
Expected: all green (core, api, mobile). Note the API suite takes ~6 minutes; bare 5000ms timeouts under load are contention, not defects — rerun the single file if one flakes.

- [ ] **Step 2: Document the operator action**

In `docs/launch-playbook.md`, after the existing `curl … /admin/rounds/$(date +%F)` example, add:

```bash
# Strike a mis-authored question from a live round with an honest reason.
# reason: "misauthored" | "unresolvable". Day still rates on the remaining
# non-void questions if at least three remain.
curl -s -X POST -H "x-admin-secret: $ADMIN_SECRET" -H "content-type: application/json" \
  -d '{"reason":"misauthored"}' https://<worker-url>/admin/questions/<question-id>/withdraw
```

In `docs/gameplay/question-review.md`, add two rows to the rubric table:

```markdown
| Fast resolution | At most one question resolves after the evening of the lock, and that one is the Big One. Nothing resolves after noon ET two days out. |
| Forecast-grounded | A weather line sits where tonight's public forecast is genuinely uncertain, not at a number it already clears. |
```

- [ ] **Step 3: Commit**

```bash
git add docs/launch-playbook.md docs/gameplay/question-review.md
git commit -m "docs: withdraw command and fast-round rubric rows

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

- [ ] **Step 4: Deploy checklist (operator, not automated by this plan)**

1. Apply migration 0011 to `oracle-prod` (`lively-river-29150895`): `cd apps/api && DATABASE_URL=<prod direct url> pnpm db:migrate`.
2. `cd apps/api && pnpm deploy`.
3. Verify the next gauntlet night (17:0x ET) narrates a `forecasts` step and a `slow` tally in Telegram, and that the published draft's `resolves_at` column is populated.
4. Mobile: the `struck` fields are additive and default false/null in the Zod schema, so the current build keeps working; the banner change ships with the next EAS build (bundle with Phase B).

---

## Self-review

**Spec coverage (Section 1):**
- 1.1 void-deadline guard → Tasks 2, 4 (`checkFastRound` "past the void deadline"), 6 (tier-0 `slow`).
- 1.2 fast-round rule → Tasks 1 (constant), 4 (validation), 5 (reroll), 6 (prompt), 9 (selection).
- 1.3 contestedness / forecast sanity → Tasks 6 (`forecast_point`), 7 (fetch), 8 (critic). The existing 0.25–0.75 critic band is retained as the gate; the plan grounds it rather than adding a second band, because the audit showed the band was never the problem — the critic's blindness was.
- 1.4 honest withdrawal → Tasks 1 (copy, wire fields), 3 (column), 10 (server), 11 (client).
- 1.5 today's round → no action, by decision.
- Data changes: `resolves_at`, `withdrawn_at` → Task 3. Constants and copy → Task 1.

**Placeholder scan:** Task 10's exhibition test asks the implementer to copy a named sibling test and change one field; Task 5's test references the sibling reroll tests' `deps` helper by shape. Both point at concrete existing code rather than leaving a gap. No TBDs.

**Type consistency:** `checkFastRound` / `FastRoundWindow` (Task 4) consumed by Task 5 with the same shape. `ForecastsByIndex` (Task 7) consumed by Task 8. `SelectWindow { fastBy }` (Task 9) fed from `fastResolveBy` (Task 2). `withdrawQuestion(db, id, reason, now)` (Task 10) called with that arity in the round, admin and resolution tests. `struck` / `struck_reason` names match across core schema (Task 1), `/today` (Task 10) and mobile (Task 11).
