# Window Integrity Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it structurally impossible for a question to stay answerable after its outcome is publicly determinable, and give the authoring loop the feedback it needs to stay that way.

**Architecture:** The leak is closed by moving the decision from the model to the code. Today the model *optionally* supplies `locks_at` (a policy call it is bad at, defaulting to the maximally-leaky noon D+1). After this pass the model *must* supply `resolves_at` (a factual call it is good at: when does the outcome first become publicly determinable) and the code derives `locksAt = min(noon D+1, resolvesAt)`. Everything else in the pass exists to keep that honest: the authoring prompt stops demanding pre-lock resolvability, the prompt learns from yesterday's outcomes instead of just yesterday's texts, and every settle emits leak telemetry so the next tuning round argues from data.

**Tech Stack:** pnpm monorepo · TypeScript · Zod 4 · Drizzle + Neon (PGlite in tests) · Hono on Cloudflare Workers · Vitest · Expo/React Native.

**Spec:** `docs/superpowers/2026-09-01-window-seeding-story-audit.md` (§1 the window, §2 seeding). Read §1.1–§1.3 and §2.4 before Task 1 — they carry the arithmetic this plan is built on.

## Global Constraints

- **Branch:** work in an isolated git worktree off `main`. `feat/boot-orb-handoff` has 13 unmerged commits and a dirty mobile working tree — never touch it, and never `git add` a broad path.
- **TDD, always.** Failing test → run it and see it fail → minimal implementation → run it and see it pass → commit. Never write implementation before a failing test.
- **API tests run on ONE vitest worker** (PGlite/WASM contention). Do not change `vitest.config.ts` concurrency.
- **Zod 4** — `z.iso.datetime({ offset: true })`, `z.literal()`, `z.union()`. Not Zod 3 idioms.
- **`packages/core/src/copy.ts` is governed by `packages/core/test/copy-lint.test.ts`.** Any copy change must keep the lint green: mono caps, no emoji, no `!`, no CTA verbs (`CHECK TAP CLICK VISIT RESULTS DON'T MISS`), ≤140 chars.
- **Never put non-ASCII in Skia text** — `useFont` has no fallback and renders tofu.
- **Baselines to beat:** core 82, api 221, mobile 120 tests green (verified in this worktree at `30bc753`); `pnpm typecheck` clean in all three packages. Every task ends green and ADDS tests — never fewer than these counts.
- **Commit per task**, conventional-commit style matching the repo (`feat(api):`, `fix(mobile):`, `refactor(core):`).

## Vocabulary

- **`resolves_at`** — the ISO-8601 UTC moment the question's outcome first becomes publicly determinable from its named source, OR the literal string `"after-lock"` meaning "not determinable until after noon ET D+1."
- **The derived lock** — `locksAt = min(noonET(D+1), resolvesAt)`. The lock always moves to the information.
- **Leak** — the interval between a question's outcome becoming determinable and its answers closing. This pass drives it to zero by construction.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/src/pipeline/draft.ts` | `DraftQuestionSchema` (now `resolves_at`), `lockFromResolvesAt`, `upsertDraft` derivation + weather rule | 1 |
| `apps/api/test/helpers/draft.ts` | shared `validDraft` fixture | 1 |
| `docs/superpowers/plans/assets/bank-draft-example.json` | doc asset asserted to parse by `pipeline-draft.test.ts` | 1 |
| `apps/api/src/pipeline/author.ts` | `rerollSlot` derivation, `draftMessage` lock line, both system prompts, `recentQuestionDigest` | 2, 3, 4 |
| `apps/api/src/pipeline/actions.ts` | `publish` early-lock preservation, settle report + leak lines | 2, 5 |
| `apps/api/src/routes/admin.ts` | error-string mapping, bank-draft `resolves_at` rule | 2 |
| `apps/api/src/pipeline/leak.ts` | **new** — pure leak metrics (crowd drift, late edge, early-lock rate) + DB reader + formatter | 5 |
| `packages/core/src/copy.ts` | one new rite explaining staggered locks | 6 |
| `apps/mobile/src/config/links.ts` | **new** — the share URL, env-fed, absent by default | 7 |
| `apps/mobile/src/game/sharePattern.ts` | link in the share message | 7 |

---

### Task 1: `resolves_at` replaces `locks_at`, and the lock is derived

The core fix. After this task a draft cannot express a leaky question.

**Files:**
- Modify: `apps/api/src/pipeline/draft.ts`
- Modify: `apps/api/test/helpers/draft.ts`
- Modify: `docs/superpowers/plans/assets/bank-draft-example.json`
- Test: `apps/api/test/pipeline-draft.test.ts`

**Interfaces:**
- Consumes: `noonET`, `addDays` from `./clock` (already imported).
- Produces, for Tasks 2 and 3:
  - `export const RESOLVES_AFTER_LOCK = "after-lock"`
  - `export function lockFromResolvesAt(resolvesAt: string, opensAt: Date, defaultLocksAt: Date): Date`
  - `DraftQuestionSchema` field `resolves_at: string` (required; ISO-8601 with offset, or `"after-lock"`). The `locks_at` field is **gone**.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/pipeline-draft.test.ts`. Put the `lockFromResolvesAt` block above the existing `describe("DraftSchema")`, and the rest inside/after the existing blocks.

```ts
import { DraftSchema, DraftQuestionSchema, lockFromResolvesAt, RESOLVES_AFTER_LOCK, upsertDraft } from "../src/pipeline/draft";

const OPENS = new Date("2026-08-27T16:00:00Z"); // noon ET D
const LOCKS = new Date("2026-08-28T16:00:00Z"); // noon ET D+1

describe("lockFromResolvesAt", () => {
  it("moves the lock to the moment the answer starts existing", () => {
    expect(lockFromResolvesAt("2026-08-27T22:00:00Z", OPENS, LOCKS).toISOString()).toBe("2026-08-27T22:00:00.000Z");
  });

  it("never pushes the lock past noon D+1", () => {
    expect(lockFromResolvesAt("2026-08-29T09:00:00Z", OPENS, LOCKS).toISOString()).toBe(LOCKS.toISOString());
  });

  it("after-lock means the full window", () => {
    expect(lockFromResolvesAt(RESOLVES_AFTER_LOCK, OPENS, LOCKS).toISOString()).toBe(LOCKS.toISOString());
  });

  it("rejects an outcome already determinable at open", () => {
    expect(() => lockFromResolvesAt("2026-08-27T15:00:00Z", OPENS, LOCKS)).toThrow("resolves_at out of range");
    expect(() => lockFromResolvesAt("2026-08-27T16:00:00Z", OPENS, LOCKS)).toThrow("resolves_at out of range");
  });

  it("rejects an unparseable timestamp", () => {
    expect(() => lockFromResolvesAt("not-a-time", OPENS, LOCKS)).toThrow("resolves_at out of range");
  });
});

describe("DraftQuestionSchema resolves_at", () => {
  const q = () => ({ ...validDraft.questions[0]! });

  it("requires resolves_at", () => {
    const { resolves_at: _omitted, ...without } = q();
    expect(DraftQuestionSchema.safeParse(without).success).toBe(false);
  });

  it("accepts an ISO instant and the after-lock literal", () => {
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: "2026-08-27T22:00:00Z" }).success).toBe(true);
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: RESOLVES_AFTER_LOCK }).success).toBe(true);
  });

  it("rejects any other string", () => {
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: "tomorrow" }).success).toBe(false);
    expect(DraftQuestionSchema.safeParse({ ...q(), resolves_at: null }).success).toBe(false);
  });

  it("forbids weather from claiming after-lock — its drift is what we are closing", () => {
    const weather = { ...q(), category: "weather" as const, resolves_at: RESOLVES_AFTER_LOCK };
    expect(DraftQuestionSchema.safeParse(weather).success).toBe(false);
  });
});

describe("upsertDraft derives the lock", () => {
  it("stamps each question's own lock from its resolves_at", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) =>
      qs.map((q) => (q.slot === 1 ? { ...q, resolves_at: "2026-08-27T22:00:00Z" } : q)),
    );
    await upsertDraft(db, "2026-08-27", draft);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    const slot1 = qs.find((q) => q.slot === 1)!;
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot1.locksAt.toISOString()).toBe("2026-08-27T22:00:00.000Z");
    expect(slot3.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
  });

  it("refuses a weather question that would still lock at noon D+1", async () => {
    const { db } = await makeTestDb();
    const draft = withQuestions((qs) =>
      qs.map((q) => (q.category === "weather" ? { ...q, resolves_at: "2026-08-29T09:00:00Z" } : q)),
    );
    await expect(upsertDraft(db, "2026-08-27", draft)).rejects.toThrow("weather must lock before noon");
  });

  it("writes nothing when one question is out of range", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-27", validDraft);
    const bad = withQuestions((qs) => qs.map((q) => (q.slot === 2 ? { ...q, resolves_at: "2026-08-27T15:00:00Z" } : q)));
    await expect(upsertDraft(db, "2026-08-27", bad)).rejects.toThrow("resolves_at out of range");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs).toHaveLength(5); // the good draft survived
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- pipeline-draft`
Expected: FAIL — `lockFromResolvesAt` is not exported, and `resolves_at` is not a field.

- [ ] **Step 3: Update the shared fixture**

In `apps/api/test/helpers/draft.ts`, replace the `locks_at: null` line with `resolves_at: RESOLVES_AFTER_LOCK` — except the weather slot, which must carry an explicit early instant. `validDraft` uses category index `slot - 1`, so slot 3 is weather.

```ts
import { RESOLVES_AFTER_LOCK } from "../../src/pipeline/draft";

export const validDraft = {
  questions: [1, 2, 3, 4, 5].map((slot) => ({
    slot,
    category: (["markets", "sports", "weather", "culture", "news"] as const)[slot - 1]!,
    text: `Will thing ${slot} happen tomorrow?`,
    resolution_criteria: `Official number per source, page X`,
    source_name: "SRC",
    source_url: "https://example.com/x",
    author_probability: 0.5,
    is_big_one: slot === 5,
    market_prob: null,
    // Weather must lock at the end of its measurement window; everything
    // else in the fixture is deliberately the full-window case.
    resolves_at: slot === 3 ? "2026-08-28T11:00:00Z" : RESOLVES_AFTER_LOCK,
  })),
};
```

- [ ] **Step 4: Implement in `draft.ts`**

Replace the `locks_at` field and the inline range check. Full replacement for the schema + helper region:

```ts
// The outcome's own clock. The model states a FACT — when does this become
// publicly determinable — and the code derives the policy. `locks_at` used to
// be an optional policy call the model made for itself, defaulting to noon
// D+1, which is the maximally-leaky value; that default is why every question
// stayed answerable after its answer existed (audit 2026-09-01 §1.1).
export const RESOLVES_AFTER_LOCK = "after-lock";

export const DraftQuestionSchema = z
  .object({
    slot: z.number().int().min(1).max(5),
    category: z.enum(["markets", "sports", "weather", "culture", "news"]),
    text: z.string().min(10),
    resolution_criteria: z.string().min(10),
    source_name: z.string().min(1),
    source_url: z.string().url(),
    author_probability: z.number().min(0.3).max(0.7),
    is_big_one: z.boolean(),
    // Set when the question was adapted from a live prediction market (feeds.ts);
    // stamped into questions.market_prob for later reveal display.
    market_prob: z.number().min(0).max(1).nullable().default(null),
    // Required. Either the ISO-8601 instant the outcome first becomes
    // publicly determinable, or "after-lock" when nothing about it is
    // knowable before noon ET D+1.
    resolves_at: z.union([z.iso.datetime({ offset: true }), z.literal(RESOLVES_AFTER_LOCK)]),
  })
  .superRefine((q, ctx) => {
    // Weather's information arrives continuously, so "after-lock" is never
    // true of it — a forecast is always partly knowable. Forcing an instant
    // forces the lock to the end of the measurement window.
    if (q.category === "weather" && q.resolves_at === RESOLVES_AFTER_LOCK) {
      ctx.addIssue({ code: "custom", message: "weather must name a resolves_at instant", path: ["resolves_at"] });
    }
  });

// The lock always moves to the information: a question can never remain
// answerable once its outcome exists. Never later than the round's own noon.
export function lockFromResolvesAt(resolvesAt: string, opensAt: Date, defaultLocksAt: Date): Date {
  if (resolvesAt === RESOLVES_AFTER_LOCK) return defaultLocksAt;
  const t = new Date(resolvesAt);
  if (Number.isNaN(t.getTime()) || t.getTime() <= opensAt.getTime()) {
    throw new Error("resolves_at out of range");
  }
  return t.getTime() < defaultLocksAt.getTime() ? t : defaultLocksAt;
}
```

Then in `upsertDraft`, replace the body of the validate-everything-before-writing `map` (the existing comment block above it stays — it is still exactly why this map runs before the delete):

```ts
  const rows = draft.questions.map((q) => {
    const locksAt = lockFromResolvesAt(q.resolves_at, opensAt, locksAtDefault);
    if (q.category === "weather" && locksAt.getTime() >= locksAtDefault.getTime()) {
      throw new Error("weather must lock before noon");
    }
    return {
      roundDate: date,
      slot: q.slot,
      isBigOne: q.is_big_one,
      text: q.text,
      category: q.category,
      resolutionCriteria: q.resolution_criteria,
      sourceName: q.source_name,
      sourceUrl: q.source_url,
      marketProb: q.market_prob == null ? null : String(q.market_prob),
      opensAt,
      locksAt,
      resolveBy,
      status: "scheduled" as const,
    };
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/api test -- pipeline-draft`
Expected: PASS, except the `bank-draft-example.json` assertion, which fails until Step 6.

- [ ] **Step 6: Fix the doc asset**

`docs/superpowers/plans/assets/bank-draft-example.json` is asserted to parse by an existing test. Every question needs `locks_at` replaced by `resolves_at`. Bank drafts are evergreen — used on an unknown future date — so they cannot carry an absolute instant: every question must be `"after-lock"`, which means **a bank draft can contain no weather question** (weather is forbidden from `after-lock`). Two consequences, both intended: the emergency round is leak-free by construction, and its rows will read pending at the noon reveal and resolve on the following day's retries.

Rewrite the asset so slot 1 (currently "Will the S&P 500 close **today**" — determinable at 4pm on the round's own date, a textbook leak) and slot 2 (currently weather) become after-lock questions in other categories, and every question gains `"resolves_at": "after-lock"`. Keep 5 slots, big one at slot 5, ≥4 distinct categories, no weather, `author_probability` in [0.3, 0.7].

- [ ] **Step 7: Run the full API suite**

Run: `pnpm --filter @oracle/api test`
Expected: failures only in `pipeline-author`, `pipeline-tick`, `admin-rounds` (they still speak `locks_at`) — Task 2 fixes those. `pipeline-draft` is green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pipeline/draft.ts apps/api/test/helpers/draft.ts apps/api/test/pipeline-draft.test.ts docs/superpowers/plans/assets/bank-draft-example.json
git commit -m "feat(api): questions declare when their answer starts existing, and the lock moves to it"
```

---

### Task 2: every other write path uses the derived lock

`rerollSlot`, `publish`, and the admin bank route all hand-roll the old `locks_at` range logic. They must share Task 1's helper or they will drift.

**Files:**
- Modify: `apps/api/src/pipeline/author.ts` (`rerollSlot`, `draftMessage`)
- Modify: `apps/api/src/pipeline/actions.ts` (`publish`)
- Modify: `apps/api/src/routes/admin.ts` (error mapping, bank rule)
- Test: `apps/api/test/pipeline-author.test.ts`, `apps/api/test/admin-rounds.test.ts`

**Interfaces:**
- Consumes: `lockFromResolvesAt`, `RESOLVES_AFTER_LOCK` from Task 1.
- Produces: `draftMessage` accepts `resolves_at?: string | null` in place of `locks_at`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/api/test/pipeline-author.test.ts`. The file already has `fakeClaude(responses)` and `fakeDeps(db, claude)` helpers — use them, do not add new ones. You will also need `and` from `drizzle-orm` in the import line.

```ts
const replacement = (resolvesAt: string) => ({
  slot: 1,
  category: "markets" as const,
  text: "Will the replacement thing happen before the close?",
  resolution_criteria: "Per the source page, at the stated deadline",
  source_name: "SRC",
  source_url: "https://example.com/y",
  author_probability: 0.5,
  is_big_one: false,
  market_prob: null,
  resolves_at: resolvesAt,
});

it("reroll derives the slot's lock from resolves_at", async () => {
  const { db } = await makeTestDb();
  await upsertDraft(db, "2026-08-27", validDraft);
  const { claude } = fakeClaude([replacement("2026-08-27T22:00:00Z")]);
  const { deps } = fakeDeps(db, claude);

  await rerollSlot(deps, "2026-08-27", 1, "make it sharper");

  const q = await db.query.questions.findFirst({
    where: and(eq(schema.questions.roundDate, "2026-08-27"), eq(schema.questions.slot, 1)),
  });
  expect(q!.locksAt.toISOString()).toBe("2026-08-27T22:00:00.000Z");
});

it("reroll refuses a resolves_at already past at open instead of silently defaulting", async () => {
  const { db } = await makeTestDb();
  await upsertDraft(db, "2026-08-27", validDraft);
  const { claude } = fakeClaude([replacement("2026-08-27T15:00:00Z")]);
  const { deps } = fakeDeps(db, claude);

  await expect(rerollSlot(deps, "2026-08-27", 1, "guidance")).rejects.toThrow("resolves_at out of range");

  // And the live draft is untouched — a refused reroll must never half-write.
  const q = await db.query.questions.findFirst({
    where: and(eq(schema.questions.roundDate, "2026-08-27"), eq(schema.questions.slot, 1)),
  });
  expect(q!.text).toBe(validDraft.questions[0]!.text);
});
```

Add to `apps/api/test/admin-rounds.test.ts`:

```ts
it("rejects a bank draft whose questions name an absolute resolves_at", async () => {
  // Bank drafts are used on an unknown future date; an absolute instant
  // would be stale by the time it publishes.
  const draft = { questions: validDraft.questions.map((q) => ({ ...q, category: "news" as const, resolves_at: "2026-08-28T11:00:00Z" })) };
  const res = await request("/admin/bank", { method: "POST", body: JSON.stringify(draft) });
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("bank drafts must resolve after the lock");
});
```

Use the file's existing request/auth helper rather than a new one.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- pipeline-author admin-rounds`
Expected: FAIL.

- [ ] **Step 3: Implement `rerollSlot`**

Replace the hand-rolled range block in `apps/api/src/pipeline/author.ts` (currently the `requestedLocksAt` / `locksAtOutOfRange` / clamp trio) with the shared helper. Note the behaviour change: reroll used to *clamp* a bad value and note it in Telegram; it now throws, because a silent clamp to noon D+1 is exactly the leak this pass exists to close.

```ts
  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  // No clamping here any more: a bad resolves_at used to fall back to noon
  // D+1, which is the leaky default. The operator gets an error and reruns.
  const locksAt = lockFromResolvesAt(q.resolves_at, opensAt, locksAtDefault);
  if (q.category === "weather" && locksAt.getTime() >= locksAtDefault.getTime()) {
    throw new Error("weather must lock before noon");
  }
```

Delete `outOfRangeNote` and its use in the Telegram send. Update the import to include `lockFromResolvesAt`.

In the final `draftMessage(...)` call inside `rerollSlot`, replace the `locks_at:` row mapping with:

```ts
        resolves_at: row.locksAt.getTime() < locksAtDefault.getTime() ? row.locksAt.toISOString() : null,
```

- [ ] **Step 4: Implement `draftMessage`**

Rename the field in the parameter type and the rendering so the operator sees the real lock:

```ts
export function draftMessage(
  date: string,
  questions: Array<{
    slot: number;
    category: string;
    text: string;
    resolution_criteria: string;
    is_big_one: boolean;
    author_probability?: number;
    resolves_at?: string | null;
  }>,
): string {
```

and inside the `flatMap`, replace the `locks` const with:

```ts
    const locks = q.resolves_at ? ` · locks ${q.resolves_at}` : " · locks at noon";
```

- [ ] **Step 5: Implement `publish` and the admin route**

`apps/api/src/pipeline/actions.ts` `publish` already preserves an early lock and defaults everything else — that logic is still correct and needs **no change**. Confirm by reading it; do not edit.

`apps/api/src/routes/admin.ts`:
- line ~77: change the error-string match from `"locks_at out of range"` to a set that also passes the new messages through as 400s:

```ts
      const BAD_DRAFT = new Set(["resolves_at out of range", "weather must lock before noon"]);
      if (BAD_DRAFT.has(msg)) return c.json({ error: msg }, 400);
```

- line ~127: replace the bank rule with the after-lock rule:

```ts
    // Bank drafts publish on an unknown future date, so an absolute instant
    // would be stale. Every question must be "after-lock" — which also means
    // no weather in the bank (the schema forbids weather from after-lock).
    if (parsed.data.questions.some((q) => q.resolves_at !== RESOLVES_AFTER_LOCK)) {
      return c.json({ error: "bank drafts must resolve after the lock" }, 400);
    }
```

Import `RESOLVES_AFTER_LOCK` alongside the existing `DraftSchema, upsertDraft`.

- [ ] **Step 6: Run the full API suite**

Run: `pnpm --filter @oracle/api test`
Expected: all green (196 + the new cases). Any remaining `locks_at` reference in a test file is a fixture that needs the same rename — fix it, do not skip it.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @oracle/api typecheck`
Expected: clean. `grep -rn "locks_at" apps/api/src` should return only `questions.locks_at` API-response fields in `routes/round.ts`, which are the *derived* lock and stay named that way.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pipeline/author.ts apps/api/src/routes/admin.ts apps/api/test/pipeline-author.test.ts apps/api/test/admin-rounds.test.ts
git commit -m "feat(api): reroll and the bank route derive the lock the same way the author does"
```

---

### Task 3: the authoring prompt stops demanding a pre-lock answer

The prompt currently requires every question to be "resolvable by 11:00 AM ET on D+1" — one hour before the lock. That clause *guarantees* the leak the schema now prevents; left in place it will just produce drafts that fail validation.

**Files:**
- Modify: `apps/api/src/pipeline/author.ts` (`draftQuestionProperties`, `draftQuestionRequired`, `authorSystemPrompt`, `rerollSystemPrompt`)
- Test: `apps/api/test/pipeline-author.test.ts`

**Interfaces:**
- Consumes: `RESOLVES_AFTER_LOCK` from Task 1.
- Produces: nothing new; this is prompt + JSON-schema surface only.

- [ ] **Step 1: Write the failing test**

The prompt is a string, so lint it like one. `fakeClaude` already records every call in its `calls` array, so no new helper is needed — queue one valid draft and read `calls[0].system`.

Add to `apps/api/test/pipeline-author.test.ts`:

```ts
describe("the authoring contract", () => {
  async function systemPromptFor(date: string): Promise<string> {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    await authorRound(deps, date);
    return calls[0]!.system;
  }

  it("no longer demands an answer that exists before the lock", async () => {
    const system = await systemPromptFor("2026-08-28");
    expect(system).not.toContain("11:00 AM ET");
    expect(system).toContain("resolves_at");
    expect(system).toContain("after-lock");
    expect(system).toContain("noon ET on 2026-08-29");
  });

  it("gives weather a measurement window that starts after the round opens", async () => {
    const system = await systemPromptFor("2026-08-28");
    expect(system.toLowerCase()).toContain("measurement period must begin after the round opens");
  });
});
```

The market-signals bullet cannot be asserted through `authorRound` — `fakeDeps` makes every feed fail, so `marketSignalsBlock` returns `""`. Test it directly instead; export nothing new, just import the module-private helper's output through the block you can reach:

```ts
it("tells the model that market-adapted questions lock at the market's close", async () => {
  const { db } = await makeTestDb();
  const { claude, calls } = fakeClaude([validDraft]);
  const { deps } = fakeDeps(db, claude);
  // One live signal, injected through marketFetch rather than the network.
  // closeTime must sit inside feeds.ts's 36h horizon measured from
  // `deps.now()` (fakeDeps pins it to 2026-08-27T12:00:00Z), NOT from the
  // real clock — a wall-clock closeTime is filtered out and the block stays
  // empty, which is a silently passing-for-the-wrong-reason test.
  const feedNow = new Date("2026-08-27T12:00:00Z").getTime();
  deps.marketFetch = (async (url: string) =>
    new Response(
      String(url).includes("manifold")
        ? JSON.stringify([{ question: "Will X?", probability: 0.5, closeTime: feedNow + 3_600_000, volume: 900, uniqueBettorCount: 9, outcomeType: "BINARY", url: "https://manifold.markets/x" }])
        : "[]",
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

  await authorRound(deps, "2026-08-28");

  expect(calls[0]!.system.toLowerCase()).toContain("market's own close");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- pipeline-author`
Expected: FAIL — the prompt still contains "11:00 AM ET" and no "resolves_at".

- [ ] **Step 3: Update the tool JSON schema**

In `apps/api/src/pipeline/author.ts`, replace the `locks_at` entry in `draftQuestionProperties`:

```ts
  resolves_at: {
    type: "string",
    description:
      'ISO-8601 UTC instant at which this outcome first becomes publicly determinable from the named source, or the literal "after-lock" when nothing about it is knowable before the round locks.',
  },
```

and in `draftQuestionRequired`, replace `"locks_at"` with `"resolves_at"`.

- [ ] **Step 4: Rewrite `authorSystemPrompt`**

```ts
function authorSystemPrompt(date: string, recent: string, signals: MarketSignal[]): string {
  const lockDay = addDays(date, 1);
  return `You author the daily round for ORACLE, a prediction game. Produce exactly 5 yes/no questions for the round dated ${date} (ET). The round opens at noon ET on ${date} and closes at noon ET on ${lockDay}. Rules:
- Slots 1-4: four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the day's most contested story from any category.
- Each question must be binary YES/NO in plain English, resolvable from ONE named public source.
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. For every question, set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. Answers are closed automatically at that instant, so an honest resolves_at costs you nothing and a late one hands the answer to whoever plays last. If nothing about the outcome is determinable before noon ET on ${lockDay}, set resolves_at to "after-lock".
- Prefer questions whose resolves_at lands inside the round's own window, close to noon ET on ${lockDay}: the ledger is read at 12:10 ET on ${lockDay}, and an "after-lock" question will not have an answer by then.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically.
- WEATHER: the measurement period must begin after the round opens — never ask about a period already underway, because half its answer already exists. Set resolves_at to the end of the measurement period. Weather may never use "after-lock".
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
- Here is how your last seven days landed. Do not repeat them, and read the outcomes and crowd splits as feedback on your own question-writing: ${recent}${marketSignalsBlock(signals)}
Search the web for today's actual news before writing. When your draft is final, call the draft_round tool exactly once.`;
}
```

- [ ] **Step 5: Update the market signals block**

In `marketSignalsBlock`, append one bullet after the existing "NEVER cite a prediction market" line:

```ts
- A question adapted from a listed market MUST set resolves_at to that market's own close: the price is public and converges on the answer, so answers have to close with it.
```

- [ ] **Step 6: Rewrite `rerollSystemPrompt`**

Apply the same three substantive edits: drop the "resolvable by 11:00 AM ET" clause, replace the `locks_at` bullet with the `resolves_at` bullet from Step 4 (verbatim, including the "answers are closed automatically" sentence), and add the weather bullet. Keep the existing single-slot framing, the big-one branch, the overlap list, and the operator-guidance line untouched.

- [ ] **Step 7: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-author`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pipeline/author.ts apps/api/test/pipeline-author.test.ts
git commit -m "feat(api): the authoring contract stops requiring an answer that exists before the lock"
```

---

### Task 4: yesterday's outcomes reach the author

`recentQuestionTexts` selects the last 7 days and returns only `r.text`. The author never learns that a question voided, or that the crowd instantly agreed at 91%. Same query, four more columns, and the dedupe list becomes a feedback loop.

**Files:**
- Modify: `apps/api/src/pipeline/author.ts` (`recentQuestionTexts` → `recentQuestionDigest`)
- Test: `apps/api/test/pipeline-author.test.ts`

**Interfaces:**
- Produces: `async function recentQuestionDigest(db: Db, date: string): Promise<string>` — replaces `recentQuestionTexts`. Module-private; `authorRound` is the only caller.

- [ ] **Step 1: Write the failing test**

```ts
describe("recent-question digest", () => {
  it("carries each question's outcome, crowd split, and void reason to the author", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-08-26", status: "resolved" });
    await db.insert(schema.questions).values([
      {
        roundDate: "2026-08-26", slot: 1, isBigOne: false, text: "Will the index close higher?",
        category: "markets", resolutionCriteria: "per src", sourceName: "SRC",
        opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z"),
        resolveBy: new Date("2026-08-27T17:00:00Z"), status: "resolved",
        outcome: "yes", crowdYesPct: "91", crowdCount: 40,
      },
      {
        roundDate: "2026-08-26", slot: 2, isBigOne: false, text: "Will the thing be verifiable?",
        category: "news", resolutionCriteria: "per src", sourceName: "SRC",
        opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z"),
        resolveBy: new Date("2026-08-27T17:00:00Z"), status: "void", outcome: "void",
      },
    ]);

    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    await authorRound(deps, "2026-08-28");

    expect(calls[0]!.system).toContain("Will the index close higher? → YES, crowd 91% yes");
    expect(calls[0]!.system).toContain("Will the thing be verifiable? → VOID");
  });

  it("says so plainly when there is no history", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);
    await authorRound(deps, "2026-08-28");
    expect(calls[0]!.system).toContain("(no history yet)");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-author`
Expected: FAIL — the prompt carries bare texts.

- [ ] **Step 3: Implement**

Replace `recentQuestionTexts` in `apps/api/src/pipeline/author.ts`:

```ts
// The last seven days, WITH how they landed. This used to return bare texts
// as a "don't repeat these" list; carrying the outcome and the crowd split
// turns it into the only feedback the author ever gets — a question the crowd
// agreed on at 91% was not contested, whatever probability the model claimed
// for it (audit 2026-09-01 §2.4).
async function recentQuestionDigest(db: Db, date: string): Promise<string> {
  const since = addDays(date, -7);
  const rows = await db.query.questions.findMany({
    where: and(gte(schema.questions.roundDate, since), lt(schema.questions.roundDate, date)),
    orderBy: (q, { asc }) => [asc(q.roundDate), asc(q.slot)],
  });
  if (rows.length === 0) return "(no history yet)";
  return rows
    .map((r) => {
      if (r.outcome === "void") return `${r.text} → VOID (unresolvable — do not write questions shaped like this)`;
      if (r.outcome === null) return `${r.text} → not yet resolved`;
      const crowd = r.crowdYesPct === null ? "crowd unknown" : `crowd ${Math.round(Number(r.crowdYesPct))}% yes`;
      return `${r.text} → ${r.outcome.toUpperCase()}, ${crowd}`;
    })
    .join("; ");
}
```

Update the call site in `authorRound`: `const recent = await recentQuestionDigest(deps.db, date);` and pass `recent` into `authorSystemPrompt` (Task 3's signature already names the parameter `recent`).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @oracle/api test -- pipeline-author`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/author.ts apps/api/test/pipeline-author.test.ts
git commit -m "feat(api): the author reads how its last seven days actually landed, not just their texts"
```

---

### Task 5: leak telemetry in the settle report

Tasks 1–4 are unverifiable without this. `predictions.created_at` has been stored all along; three numbers per round turn it into the evidence that the leak is closed — or is not.

**Files:**
- Create: `apps/api/src/pipeline/leak.ts`
- Modify: `apps/api/src/pipeline/actions.ts` (`settle`)
- Test: `apps/api/test/pipeline-leak.test.ts` (new)

**Interfaces:**
- Produces:
  - `export interface SealRow { createdAt: Date; answer: boolean; brier: number | null }`
  - `export function crowdDrift(rows: SealRow[]): number | null` — percentage points, `null` below 8 seals.
  - `export function lateEdge(rows: SealRow[]): number | null` — mean Brier of the earlier half minus the later half; **positive means late sealers did better**. `null` below 8 rated rows.
  - `export function earlyLockRate(qs: Array<{ locksAt: Date }>, defaultLocksAt: Date): string` — `"4/5"`.
  - `export function leakReport(lines: Array<{ slot: number; drift: number | null; edge: number | null; locksAt: Date }>, defaultLocksAt: Date): string[]`
  - `export async function loadLeakRows(db: Db, questionId: string): Promise<SealRow[]>`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/pipeline-leak.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { crowdDrift, lateEdge, earlyLockRate, leakReport, type SealRow } from "../src/pipeline/leak";

const at = (min: number, answer: boolean, brier: number | null = null): SealRow => ({
  createdAt: new Date(Date.UTC(2026, 7, 27, 16, min)),
  answer,
  brier,
});

describe("crowdDrift", () => {
  it("is null below eight seals — a quartile of two is not a signal", () => {
    expect(crowdDrift([at(0, true), at(1, false), at(2, true)])).toBeNull();
  });

  it("is zero when the crowd never changed its mind", () => {
    // 12 seals, every third one YES: the first quartile (0,1,2) and the last
    // (9,10,11) both run 1-in-3 YES, so the split never moved.
    const rows = Array.from({ length: 12 }, (_, i) => at(i, i % 3 === 0));
    expect(crowdDrift(rows)).toBe(0);
  });

  it("measures the swing between the first and last quartile of sealers", () => {
    // 12 seals: first 3 all NO, last 3 all YES → 0% vs 100% → 100pp.
    const rows = [
      ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0)),
      ...[9, 10, 11].map((m) => at(m, true)),
    ];
    expect(crowdDrift(rows)).toBe(100);
  });

  it("sorts by seal time, not array order", () => {
    const rows = [...[9, 10, 11].map((m) => at(m, true)), ...[0, 1, 2].map((m) => at(m, false)),
      ...[3, 4, 5, 6, 7, 8].map((m) => at(m, m % 2 === 0))];
    expect(crowdDrift(rows)).toBe(100);
  });
});

describe("lateEdge", () => {
  it("is null below eight rated rows", () => {
    expect(lateEdge([at(0, true, 0.1), at(1, true, 0.1)])).toBeNull();
  });

  it("is positive when the later half scored better (lower brier)", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      ...[4, 5, 6, 7].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });

  it("ignores unrated rows entirely", () => {
    const rows = [
      ...[0, 1, 2, 3].map((m) => at(m, true, 0.25)),
      at(4, true, null),
      ...[5, 6, 7, 8].map((m) => at(m, true, 0.05)),
    ];
    expect(lateEdge(rows)).toBeCloseTo(0.2, 10);
  });
});

describe("earlyLockRate", () => {
  const noon = new Date("2026-08-28T16:00:00Z");
  it("counts questions that closed before the round did", () => {
    expect(earlyLockRate(
      [{ locksAt: new Date("2026-08-27T22:00:00Z") }, { locksAt: noon }, { locksAt: noon }],
      noon,
    )).toBe("1/3");
  });
});

describe("leakReport", () => {
  const noon = new Date("2026-08-28T16:00:00Z");
  it("renders one line per slot plus the rate, and says so when a slot has too few seals", () => {
    const out = leakReport([
      { slot: 1, drift: 12, edge: 0.031, locksAt: new Date("2026-08-27T22:00:00Z") },
      { slot: 2, drift: null, edge: null, locksAt: noon },
    ], noon);
    expect(out[0]).toBe("LEAK WATCH");
    expect(out[1]).toBe("1 drift 12pp · late edge +0.031 · locks 2026-08-27T22:00Z");
    expect(out[2]).toBe("2 too few seals · locks noon");
    expect(out[3]).toBe("early-lock rate 1/2");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-leak`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `leak.ts`**

```ts
// Leak telemetry (audit 2026-09-01 §1.3c). The window fix is unverifiable
// without it: these three numbers are how we find out whether a question
// stayed answerable after its answer existed. predictions.created_at has been
// stored since the beginning; nothing ever read it.
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";

export interface SealRow { createdAt: Date; answer: boolean; brier: number | null }

// Quartiles of three are noise. Below this, every metric reports null.
const MIN_SEALS = 8;

const byTime = (rows: SealRow[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
const yesPct = (rows: SealRow[]) => (100 * rows.filter((r) => r.answer).length) / rows.length;

/**
 * How far the crowd moved across the window: YES% among the first quartile of
 * sealers vs the last. A question whose crowd swung is a question that leaked.
 * Percentage points, rounded.
 */
export function crowdDrift(rows: SealRow[]): number | null {
  if (rows.length < MIN_SEALS) return null;
  const sorted = byTime(rows);
  const q = Math.floor(sorted.length / 4);
  return Math.round(Math.abs(yesPct(sorted.slice(-q)) - yesPct(sorted.slice(0, q))));
}

/**
 * Mean Brier of the earlier half minus the later half, over rated rows only.
 * Positive = the players who sealed late scored better, which is the leak
 * showing up directly in the scoreboard.
 */
export function lateEdge(rows: SealRow[]): number | null {
  const rated = byTime(rows).filter((r) => r.brier !== null);
  if (rated.length < MIN_SEALS) return null;
  const half = Math.floor(rated.length / 2);
  const mean = (xs: SealRow[]) => xs.reduce((a, r) => a + r.brier!, 0) / xs.length;
  return mean(rated.slice(0, half)) - mean(rated.slice(-half));
}

/** How many of the round's questions actually closed before the round did. */
export function earlyLockRate(qs: Array<{ locksAt: Date }>, defaultLocksAt: Date): string {
  const early = qs.filter((q) => q.locksAt.getTime() < defaultLocksAt.getTime()).length;
  return `${early}/${qs.length}`;
}

const signed = (n: number) => (n >= 0 ? `+${n.toFixed(3)}` : n.toFixed(3));
const stamp = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;

export function leakReport(
  lines: Array<{ slot: number; drift: number | null; edge: number | null; locksAt: Date }>,
  defaultLocksAt: Date,
): string[] {
  const body = lines.map((l) => {
    const lock = l.locksAt.getTime() < defaultLocksAt.getTime() ? `locks ${stamp(l.locksAt)}` : "locks noon";
    if (l.drift === null || l.edge === null) return `${l.slot} too few seals · ${lock}`;
    return `${l.slot} drift ${l.drift}pp · late edge ${signed(l.edge)} · ${lock}`;
  });
  return ["LEAK WATCH", ...body, `early-lock rate ${earlyLockRate(lines, defaultLocksAt)}`];
}

export async function loadLeakRows(db: Db, questionId: string): Promise<SealRow[]> {
  const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, questionId) });
  return rows.map((p) => ({ createdAt: p.createdAt, answer: p.answer, brier: p.brier === null ? null : Number(p.brier) }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oracle/api test -- pipeline-leak`
Expected: PASS.

- [ ] **Step 5: Write the failing wiring test**

The metric arithmetic is already covered by `pipeline-leak.test.ts`; this test only proves the report is wired. `pipeline-tick.test.ts` already has a void-then-settle case at ~line 111 that ends with `expect(sent3.some((t) => t.includes("reply if any outcome looks wrong")))` — that round is fully resolved with zero predictions, which is exactly the "too few seals" path. Extend **that existing test** rather than building a new fixture; add these three assertions after the existing one:

```ts
    const report = sent3.find((t) => t.includes("reply if any outcome looks wrong"))!;
    expect(report).toContain("LEAK WATCH");
    // No predictions on this round, so every slot reports honestly rather
    // than inventing a drift from a sample of zero.
    expect(report).toContain("too few seals");
    expect(report).toContain("early-lock rate 0/5");
```

- [ ] **Step 6: Wire it into `settle`**

In `apps/api/src/pipeline/actions.ts`, extend the report composition in `settle` (the `qs` query is already there; do not re-query):

```ts
import { crowdDrift, lateEdge, leakReport, loadLeakRows } from "./leak";
// ...
  const defaultLocksAt = noonET(addDays(date, 1));
  const leakLines = await Promise.all(
    qs.map(async (q) => {
      const rows = await loadLeakRows(deps.db, q.id);
      return { slot: q.slot, drift: crowdDrift(rows), edge: lateEdge(rows), locksAt: q.locksAt };
    }),
  );

  const lines = qs.map((q) => `${q.slot}. ${q.text} → ${q.outcome ? q.outcome.toUpperCase() : "?"}`);
  const report = [
    `Round ${date} settled`,
    ...lines,
    `settled: ${result.settled}`,
    "",
    ...leakReport(leakLines, defaultLocksAt),
    "",
    "reply if any outcome looks wrong",
  ].join("\n");
```

- [ ] **Step 7: Run the full API suite and typecheck**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: all green, clean.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pipeline/leak.ts apps/api/src/pipeline/actions.ts apps/api/test/pipeline-leak.test.ts apps/api/test/pipeline-tick.test.ts
git commit -m "feat(api): every settle reports how far the crowd drifted and whether late sealers scored better"
```

---

### Task 6: the rites explain staggered locks

Early locks stop being the exception in this pass and become the norm. `OracleCard` already prints "closes early" on the card and the numerals row already strikes a missed slot — but nothing anywhere tells a player *why* card III was gone when they opened the app at 9pm. That is now a load-bearing rule and it belongs in the rites.

**Files:**
- Modify: `packages/core/src/copy.ts` (`RITES_LINES`)
- Modify: `packages/core/test/copy-lint.test.ts`
- Modify: `docs/superpowers/specs/2026-08-09-oracle-design.md` (the false compensation claim)

**Interfaces:** none — copy only.

- [ ] **Step 1: Write the failing test**

In `packages/core/test/copy-lint.test.ts`, inside `describe("the rites")`, extend the current-rules case:

```ts
  it("state the current rules: bounty not double, all five for the first hour, the city of noon, partial days, staggered locks", () => {
    const all = RITES_LINES.join(" ");
    expect(all).not.toContain("PAYS TWICE");
    expect(all).toContain("NEW YORK");
    expect(all).toContain("ALL FIVE");
    // Early locks are the norm now: a player who finds a card already closed
    // must have been told this could happen.
    expect(all).toContain("BEFORE NOON");
    expect(RITES_LINES.length).toBe(12);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/core test -- copy-lint`
Expected: FAIL — `RITES_LINES.length` is 11 and nothing contains "BEFORE NOON".

- [ ] **Step 3: Add the rite**

In `packages/core/src/copy.ts`, insert immediately after the first line ("FIVE QUESTIONS. ONCE A DAY. NOON TO NOON, NEW YORK TIME."), so the timing rules sit together:

```ts
  "A QUESTION CLOSES THE MOMENT ITS ANSWER BEGINS TO EXIST. SOME CLOSE BEFORE NOON.",
```

Check it against the lint by hand before running: caps ✓, no emoji ✓, no `!` ✓, contains none of `CHECK TAP CLICK VISIT RESULTS DON'T MISS` ✓, 78 chars ✓.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @oracle/core test`
Expected: PASS, 76+ tests green.

- [ ] **Step 5: Correct the design spec's false claim**

`docs/superpowers/specs/2026-08-09-oracle-design.md` line ~27 currently reads that the first-hour bonus *"compensates early players' information disadvantage (an 11pm answer has strictly more information than a 12:05pm one)."* It does not — it is a percentage of the player's own score, so it can never offset an advantage that acts on the score itself (audit §1.2). Replace the parenthetical with the truth:

> **First hour (until 1pm).** Locking in during the first hour earns the **First Hour Oracle** badge on the share card plus a daily-points bonus. This drives the noon event culture. It does *not* compensate the late player's information advantage — a bonus computed as a percentage of your own score cannot; that is closed structurally by `resolves_at` and the derived per-question lock (see `docs/superpowers/2026-09-01-window-seeding-story-audit.md` §1).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts docs/superpowers/specs/2026-08-09-oracle-design.md
git commit -m "feat(core): a rite for staggered locks, and the spec stops claiming the first hour compensates"
```

---

### Task 7: the share message carries a link

`shareMessage` composes `🔮 ORACLE 2026-09-01 — I✓ II✗ … · +140 · can you outsee me?` and no URL. The challenge is issued and cannot be answered.

There is no App Store record yet, so the URL is configuration, not a constant. The message must degrade to today's exact text when nothing is configured — a broken link on a share is worse than no link.

**Files:**
- Create: `apps/mobile/src/config/links.ts`
- Modify: `apps/mobile/src/game/sharePattern.ts`
- Test: `apps/mobile/test/sharePattern.test.ts`

**Interfaces:**
- Produces: `export const SHARE_URL: string | null` in `config/links.ts`; `shareMessage(d, url?: string | null)` gains an optional second parameter defaulting to `SHARE_URL`.

- [ ] **Step 1: Write the failing test**

Replace the `shareMessage` describe block in `apps/mobile/test/sharePattern.test.ts`:

```ts
describe("shareMessage", () => {
  const day = { date: "2026-08-26", dayPoints: 58, results: ["win", "loss", "win", "win", "win"] as const };

  it("composes date, pattern, signed points, and the taunt", () => {
    expect(shareMessage({ ...day, results: [...day.results] }, null))
      .toBe("🔮 ORACLE 2026-08-26 — I✓ II✗ III✓ IV✓ V✓ · +58 · can you outsee me?");
  });

  it("keeps the minus sign on negative days", () => {
    expect(shareMessage({ date: "2026-08-26", dayPoints: -12, results: ["loss", "none", "none", "none", "none"] }, null))
      .toContain("· -12 ·");
  });

  it("appends the link when one is configured", () => {
    expect(shareMessage({ ...day, results: [...day.results] }, "https://oracle.example/app"))
      .toBe("🔮 ORACLE 2026-08-26 — I✓ II✗ III✓ IV✓ V✓ · +58 · can you outsee me? https://oracle.example/app");
  });

  it("never emits a trailing space when there is no link", () => {
    expect(shareMessage({ ...day, results: [...day.results] }, null).endsWith("?")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- sharePattern`
Expected: FAIL — `shareMessage` takes one argument.

- [ ] **Step 3: Create `config/links.ts`**

Match the pattern in the sibling `apps/mobile/src/config/keys.ts` (every SDK stays dark without its `EXPO_PUBLIC_*` value).

```ts
// The share destination. There is no App Store record yet, so this is
// configuration rather than a constant: set EXPO_PUBLIC_SHARE_URL in
// eas.json once the ASC app id exists. Absent → the share message ships with
// no link at all, which is correct; a dead link on a share is worse than none.
const raw = process.env.EXPO_PUBLIC_SHARE_URL?.trim();
export const SHARE_URL: string | null = raw && raw.length > 0 ? raw : null;
```

- [ ] **Step 4: Implement in `sharePattern.ts`**

```ts
import { SHARE_URL } from "../config/links";

export function shareMessage(
  d: { date: string; dayPoints: number; results: ReadonlyArray<QuestionResult> },
  url: string | null = SHARE_URL,
): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  const body = `🔮 ORACLE ${d.date} — ${patternLine(d.results)} · ${points} · can you outsee me?`;
  return url ? `${body} ${url}` : body;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test -- sharePattern`
Expected: PASS.

- [ ] **Step 6: Register the env var where the others live**

Do **not** edit `apps/mobile/eas.json`. On `main` it carries no `env` blocks at all — every `EXPO_PUBLIC_*` value is set as an EAS dashboard environment variable, and the repo's source of truth for that list is the runbook. (It is also modified in the dirty `feat/boot-orb-handoff` tree, so editing it here buys a merge conflict for nothing.)

Add one bullet to the list under `## 5. EAS env (per build profile)` in `docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md`, after the existing `EXPO_PUBLIC_API_URL` line:

```markdown
- `EXPO_PUBLIC_SHARE_URL=https://apps.apple.com/app/id<APP_STORE_ID>` — the link appended to every shared prophecy. Leave unset until the App Store Connect record exists; unset means the share ships with no link rather than a dead one.
```

This file is also modified in the dirty tree, but it is a docs-only one-line append and the merge is trivial.

- [ ] **Step 7: Run the full mobile suite and typecheck**

Run: `pnpm --filter @oracle/mobile test && pnpm --filter @oracle/mobile typecheck`
Expected: 113+ green, clean.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/config/links.ts apps/mobile/src/game/sharePattern.ts apps/mobile/test/sharePattern.test.ts docs/superpowers/plans/assets/revenue-rites/dashboard-runbook.md
git commit -m "feat(mobile): the share carries a link when one is configured, and nothing when it is not"
```

---

## Final verification

- [ ] `pnpm test` at the repo root — core ≥83, api ≥232, mobile ≥122, all green.
- [ ] `pnpm typecheck` at the repo root — clean in all three packages.
- [ ] `grep -rn "locks_at" apps/api/src packages/core/src` — the only hits should be the derived `locks_at` fields in `routes/round.ts`'s JSON responses. Any hit in `pipeline/` is a miss.
- [ ] `grep -rn "11:00 AM ET" apps/api/src` — no hits.
- [ ] Read `apps/api/src/pipeline/author.ts`'s two system prompts end to end as a human would. The contradiction this pass exists to remove was one sentence; make sure a new one has not replaced it.

## Out of scope — carried forward

- **`plus.tsx:17` still ships `PRIVACY_URL_TBD_TASK_12`.** Erik has no privacy policy URL yet. This is a dead link on the paywall and App Review will reject it. Not fixable in this pass; it must be resolved before submission.
- **Bank drafts are now all-`after-lock`,** so an emergency round's rows read pending at the noon reveal and resolve on the next day's retries. Accepted for the window. A relative offset (`"+PT20H"`) is the eventual fix.
- **Story tier (audit §3):** the 50-call finding ceremony, you-vs-the-Oracle, the archive behind Plus, and new epithet rungs. Deliberately deferred — see the audit's §5 items 9–12.
- **Seeding tier 2 (audit §2.5):** `/hold <slot>` before publish, `topic_key` structural dedupe, 14-day category balance, contestedness aggregates.
- **After one week of live data,** read the LEAK WATCH lines before tuning anything else. If `late edge` is consistently near zero the pass worked; if drift is still large on a category, that category needs a shape rule like weather's.
