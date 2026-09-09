# Phase B — Staggered Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the one late, batched verdict with a trickle: each question announces itself to its players the moment it resolves, home shows a locked round as IN PLAY with decided/pending counts, and home always surfaces the player's most recent reading instead of "date minus one".

**Architecture:** A per-question push composes and sends from `resolveOne` (the one unit both resolution runners call), claiming predictions with a single atomic `UPDATE … WHERE resolve_pushed_at IS NULL RETURNING` so the hourly cron's re-dispatch can never double-send and a crashed step can never silently skip. Copy lives in a new `resolve` pool with three new slot tokens so the copy lint keeps governing it. The server names the player's *reading round* (latest locked-or-settled round they answered, with decided/total counts) on the ledger response; home reads that one field to drive both the IN PLAY line and the "ledger is read" CTA, linking into the existing partial-reveal screen, which needs no change.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle ORM (Neon HTTP in prod, PGlite in tests), Zod, Vitest, pnpm workspaces. Mobile: Expo SDK 57 / React Native, TanStack Query, Vitest (pure-function tests only).

**Spec:** `docs/superpowers/specs/2026-09-09-engagement-and-integrity-design.md` (Section 2, Section 3.1). This plan implements those only.

## Global Constraints

- iOS first; existing Expo/React Native and Hono/Workers/Drizzle stacks only. No new third-party services.
- Every server write stays idempotent: neon-http has no transactions and the hourly cron re-dispatches. A retried tick must not double-send a push or double-score.
- Tests never touch the network: fetch and Claude are injected; `sendPushes` no-ops without OneSignal keys and must be observed through an injected `PushEnv`/fake in tests.
- Player-facing copy holds the register: tracked caps, no emoji, no exclamation, ≤140 chars after worst-case slot expansion (enforced by `packages/core/test/copy-lint.test.ts`). Banned CTA words: CHECK, TAP, CLICK, VISIT, RESULTS, DON'T MISS.
- No crowd, market, or Oracle probabilities before a player's answer is sealed. A resolution push is sent only to players who answered that question.
- Migrations are additive; existing rows default to null.
- Rules changes apply prospectively; v1 rounds keep their contract (the push and the reading round apply to every round; nothing here changes scoring).
- Run tests from the package directory: `cd apps/api && pnpm vitest run <file>`; core: `cd packages/core && pnpm vitest run <file>`; mobile: `cd apps/mobile && pnpm vitest run <file>`. Typecheck: `pnpm typecheck` in the package.
- Commit after every task. Commit messages end with `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## Vocabulary

- **Resolution push**: one push per (player, question) the moment a question resolves yes/no through the pipeline. Never for void, never for admin resolves, never for withdrawals.
- **Reading round**: for a player, the latest round with `rounds.status ∈ {locked, resolved}` in which they have at least one prediction. `settled` = `rounds.status === "resolved"`. `decided` = that round's questions with a non-null outcome (void counts as decided). `total` = its question count.
- **IN PLAY**: the reading round is not settled and `decided ≥ 1`.

## File map

| File | Responsibility in this plan |
|---|---|
| `packages/core/src/copy.ts` | `resolve` pool, `{outcome}`/`{call}`/`{points}` slots in `fillSlots`, `Requirement` additions, `READING_LINES` |
| `packages/core/test/copy-lint.test.ts` | worst-case expansion for new slots, pool floor, the new slots' backing rule |
| `packages/core/src/schemas.ts` | `MeLedgerSchema.reading` |
| `apps/api/src/db/schema.ts` + `drizzle/0012_*.sql` | `predictions.resolve_pushed_at` |
| `apps/api/src/push/compose.ts` | `claimResolutionPushes`, `composeResolutionPushes` |
| `apps/api/src/pipeline/resolve.ts` | `resolveOne` sends resolution pushes (state-based, after any resolve attempt) |
| `apps/api/src/routes/me.ts` | `reading` on `/v1/me/ledger` |
| `apps/api/src/reading.ts` (new) | `readingRoundFor(db, userId)` query |
| `apps/mobile/src/game/readingSlot.ts` (new) | pure: which line/CTA the home call slot shows for the reading round |
| `apps/mobile/src/app/index.tsx` | consume `ledger.reading` for the CTA, the rail, and the IN PLAY line |

---

### Task 1: Core — the `resolve` copy pool, new slots, `reading` on the ledger schema

**Files:**
- Modify: `packages/core/src/copy.ts` (`Requirement`, `CopyLine.pool`, `fillSlots`, `COPY_BANK` additions, `READING_LINES`)
- Modify: `packages/core/test/copy-lint.test.ts` (`worst`, slot-backing rule, pool floor, curiosity-gap scope)
- Modify: `packages/core/src/schemas.ts` (`MeLedgerSchema`)
- Test: `packages/core/test/copy-lint.test.ts`, `packages/core/test/copy-select.test.ts`

**Interfaces:**
- Produces: `fillSlots(text, { n?, streak?, outcome?, call?, points? })` — `outcome` is a string (`"YES"`/`"NO"`), `call` a string (`"YES AT 75%"`), `points` a signed string (`"+38"`, `"-12"`, `"0"`).
- Produces: `Requirement` gains `"outcome" | "call" | "points"`; `CopyLine.pool` gains `"resolve"`.
- Produces: `COPY_BANK` gains ≥ 8 `resolve.*` lines, each using all three slots and requiring `["outcome","call","points"]`.
- Produces: `READING_LINES = { inPlay: "IN PLAY · {decided} DECIDED · {pending} PENDING", inPlayCta: "SEE WHAT IS DECIDED", settled: "THE LEDGER IS READ", settledCta: "READ THE LEDGER", rail: "LEDGER" }` (frozen object of strings; `{decided}`/`{pending}` are filled by the client with `fillSlots`? No — keep these outside `fillSlots`: export a helper `inPlayLine(decided: number, pending: number): string`).
- Produces: `MeLedgerSchema.reading: z.object({ date: z.string(), settled: z.boolean(), decided: z.number().int(), total: z.number().int() }).nullable().default(null)`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/copy-lint.test.ts` (inside the file's top-level scope, after the existing describes):

```ts
import { inPlayLine, READING_LINES } from "../src/copy";

describe("the resolve pool (design 2026-09-09 §2.1)", () => {
  const RESOLVE = COPY_BANK.filter((l) => l.pool === "resolve");
  it("has at least eight lines, every one carrying all three slots and requiring them", () => {
    expect(RESOLVE.length).toBeGreaterThanOrEqual(8);
    for (const l of RESOLVE) {
      expect(l.text, l.id).toContain("{outcome}");
      expect(l.text, l.id).toContain("{call}");
      expect(l.text, l.id).toContain("{points}");
      expect(l.requires ?? [], l.id).toEqual(expect.arrayContaining(["outcome", "call", "points"]));
    }
  });
  it("expands cleanly and fits a push at worst case", () => {
    for (const l of RESOLVE) {
      const filled = fillSlots(l.text, { outcome: "NO", call: "YES AT 95%", points: "-261" });
      expect(filled, l.id).not.toMatch(/[{}]/);
      expect(filled.length, l.id).toBeLessThanOrEqual(140);
    }
  });
  it("holds the register", () => {
    for (const l of RESOLVE) {
      expect(l.text, l.id).toBe(l.text.toUpperCase());
      expect(l.text, l.id).not.toContain("!");
      for (const b of BANNED) expect(l.text, l.id).not.toContain(b);
    }
  });
});

describe("the reading lines (design 2026-09-09 §2.2, §3.1)", () => {
  it("inPlayLine prints both counts", () => {
    expect(inPlayLine(3, 2)).toBe("IN PLAY · 3 DECIDED · 2 PENDING");
    expect(inPlayLine(1, 4)).toBe("IN PLAY · 1 DECIDED · 4 PENDING");
  });
  it("every reading line holds the register and fits the home slot", () => {
    for (const l of [inPlayLine(5, 0), ...Object.values(READING_LINES)]) {
      expect(l).toBe(l.toUpperCase());
      expect(l).not.toContain("!");
      expect(l.length).toBeLessThanOrEqual(40);
    }
  });
});
```

Also, in the existing `worst` helper at the top of the file, change it to:

```ts
const worst = (l: CopyLine) => fillSlots(l.text, { n: 99, streak: 999, outcome: "YES", call: "YES AT 95%", points: "-261" });
```

and in the "every slot is backed by a requirement" test, add inside the loop:

```ts
      if (l.text.includes("{outcome}")) expect(l.requires ?? [], l.id).toContain("outcome");
      if (l.text.includes("{call}")) expect(l.requires ?? [], l.id).toContain("call");
      if (l.text.includes("{points}")) expect(l.requires ?? [], l.id).toContain("points");
```

In "has the spec'd pool shape" add `expect(count("resolve")).toBeGreaterThanOrEqual(8);`.

`BANNED` is already a top-level const in this file; if it is declared inside a describe, hoist it to module scope.

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/core && pnpm vitest run test/copy-lint.test.ts`
Expected: FAIL — `inPlayLine`/`READING_LINES` not exported; resolve pool empty.

- [ ] **Step 3: Implement in `copy.ts`**

```ts
export type Requirement = "results" | "tideWin" | "streak" | "players" | "lapsed" | "wrong" | "partial" | "outcome" | "call" | "points";

export interface CopyLine {
  id: string;
  pool: "noon" | "closing" | "streak" | "system" | "paywall" | "resolve";
  text: string;
  requires?: ReadonlyArray<Requirement>;
}

export function fillSlots(
  text: string,
  slots: { n?: number; streak?: number; outcome?: string; call?: string; points?: string },
): string {
  return text
    .replace(/\{n\}/g, slots.n === undefined ? "{n}" : String(slots.n))
    .replace(/\{streak\}/g, slots.streak === undefined ? "{streak}" : String(slots.streak))
    .replace(/\{outcome\}/g, slots.outcome === undefined ? "{outcome}" : slots.outcome)
    .replace(/\{call\}/g, slots.call === undefined ? "{call}" : slots.call)
    .replace(/\{points\}/g, slots.points === undefined ? "{points}" : slots.points);
}
```

Add to `COPY_BANK` (inside the existing array, after the last `noon.*` entry — the resolution push is the trickle that replaces the batched result, design §2.1; every line carries the outcome, the call, and the signed points):

```ts
  { id: "resolve.plain-1", pool: "resolve", text: "IT CAME {outcome}. YOU CALLED {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-2", pool: "resolve", text: "THE ANSWER WAS {outcome}. YOUR CALL: {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-3", pool: "resolve", text: "{outcome}, AS IT HAPPENED. YOU SAID {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-4", pool: "resolve", text: "ONE IS DECIDED: {outcome}. YOU STOOD AT {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-5", pool: "resolve", text: "THE LEDGER READS {outcome}. YOU CALLED {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-6", pool: "resolve", text: "DECIDED: {outcome}. YOUR SEAL SAID {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-7", pool: "resolve", text: "{outcome} IT IS. YOU HELD {call}. {points}.", requires: ["outcome", "call", "points"] },
  { id: "resolve.plain-8", pool: "resolve", text: "THE WORLD ANSWERED {outcome}. YOU ANSWERED {call}. {points}.", requires: ["outcome", "call", "points"] },
```

Add after `PIPELINE_LINES`:

```ts
// The home call slot's lines for the reading round (design 2026-09-09 §2.2,
// §3.1). Short by law: they share the single-row slot with the day's CTA.
export const READING_LINES = Object.freeze({
  inPlayCta: "SEE WHAT IS DECIDED",
  settled: "THE LEDGER IS READ",
  settledCta: "READ THE LEDGER",
  rail: "LEDGER",
} as const);

export function inPlayLine(decided: number, pending: number): string {
  return `IN PLAY · ${decided} DECIDED · ${pending} PENDING`;
}
```

- [ ] **Step 4: `MeLedgerSchema.reading`**

In `packages/core/src/schemas.ts`, inside `MeLedgerSchema`, after `milestones`, add:

```ts
  // The player's reading round (design 2026-09-09 §2.2, §3.1): the latest
  // locked-or-settled round they answered, with how much of it is decided.
  // Null until they have answered a round that has locked. Defaulted so a
  // client ahead of the server still parses.
  reading: z
    .object({ date: z.string(), settled: z.boolean(), decided: z.number().int().min(0), total: z.number().int().min(0) })
    .nullable()
    .default(null),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/core && pnpm vitest run && pnpm typecheck`
Expected: PASS (copy-select and reading-register suites still green; the `noon` curiosity-gap rule is untouched because it filters on `pool === "noon"`).

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): resolve copy pool with outcome/call/points slots, reading lines, ledger reading field

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 2: Schema — `predictions.resolve_pushed_at` + migration 0012

**Files:**
- Modify: `apps/api/src/db/schema.ts` (`predictions`, after `points`)
- Create: `apps/api/drizzle/0012_<generated>.sql` via `pnpm db:generate`
- Test: `apps/api/test/schema.test.ts`

**Interfaces:**
- Produces: `schema.predictions.resolvePushedAt: timestamp | null`.

- [ ] **Step 1: Failing test** — in `apps/api/test/schema.test.ts`, next to the migration-0011 test:

```ts
  it("leaves resolve_pushed_at null on a fresh prediction (design 2026-09-09 §2.1)", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-09-12" });
    const [q] = await db.insert(schema.questions).values({
      roundDate: "2026-09-12", slot: 1, text: "Will it?", category: "news",
      resolutionCriteria: "per test", sourceName: "SRC",
      opensAt: new Date("2026-09-12T16:00:00Z"), locksAt: new Date("2026-09-13T16:00:00Z"), resolveBy: new Date("2026-09-13T17:00:00Z"),
    }).returning();
    const [u] = await db.insert(schema.users).values({}).returning();
    const [p] = await db.insert(schema.predictions).values({ questionId: q!.id, userId: u!.id, answer: true, confidence: 70 }).returning();
    expect(p!.resolvePushedAt).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/api && pnpm vitest run test/schema.test.ts` → FAIL (column missing).

- [ ] **Step 3: Add the column**

```ts
  // When this prediction's resolution push was claimed (design 2026-09-09
  // §2.1). Claimed by ONE atomic UPDATE … WHERE resolve_pushed_at IS NULL
  // RETURNING, so a retried tick composes nothing for rows already claimed.
  // Null forever for predictions on void questions and on rounds that
  // predate the column.
  resolvePushedAt: timestamp("resolve_pushed_at", { withTimezone: true }),
```

- [ ] **Step 4: `pnpm db:generate`** — expected SQL exactly:

```sql
ALTER TABLE "predictions" ADD COLUMN "resolve_pushed_at" timestamp with time zone;
```

If it differs, stop and inspect.

- [ ] **Step 5: Run to verify it passes** — `pnpm vitest run test/schema.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/schema.test.ts
git commit -m "feat(db): predictions.resolve_pushed_at

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 3: `claimResolutionPushes` + `composeResolutionPushes`

**Files:**
- Modify: `apps/api/src/push/compose.ts`
- Test: `apps/api/test/compose.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ResolutionPush { userId: string; predictionId: string; externalIds: string[]; lineId: string; text: string }
  /** One atomic claim: stamps resolve_pushed_at on every unclaimed prediction of a yes/no-resolved question and returns those rows. Empty when the question is unresolved, void, or already claimed. */
  export async function claimResolutionPushes(db: Db, questionId: string, now: Date): Promise<ResolutionPush[]>
  ```
  Internally: read the question; if `outcome` is null or `"void"`, return `[]`. Then
  ```ts
  const claimed = await db.update(schema.predictions)
    .set({ resolvePushedAt: now })
    .where(and(eq(schema.predictions.questionId, questionId), isNull(schema.predictions.resolvePushedAt)))
    .returning();
  ```
  and compose one push per claimed row: `outcome` = `"YES"`/`"NO"`; `call` = `${p.answer ? "YES" : "NO"} AT ${p.confidence}%`; `points` = `p.points === null ? "0" : p.points > 0 ? \`+${p.points}\` : String(p.points)`; line = `selectLine(RESOLVE, \`${p.userId}:${questionId}\`, ["outcome","call","points"])`; text = `${headline(q.text)} ${fillSlots(line.text, {...})}` where `headline(t)` trims to 70 chars with `…` and uppercases nothing (question text is sentence case by design — see the two-registers memory; the line after it is caps). Aliases from `devices` exactly as `composeHingePushes` does. Rows whose user has no devices still count as claimed (the push is simply undeliverable), matching the hinge push's `externalIds: []` handling.
- The claim is the idempotency: `resolvePushedAt` is set in the same statement that selects the rows, so two concurrent ticks cannot both return the same row (Postgres row-level write locks serialize the two UPDATEs; the second sees `resolve_pushed_at IS NOT NULL`).

- [ ] **Step 1: Failing tests** — append to `apps/api/test/compose.test.ts` (reuse its `player(app)`, `seedRound`, `makeTestDb`, `createApp` helpers; import `claimResolutionPushes` from `../src/push/compose` and `resolveQuestion` from `../src/resolution`):

```ts
describe("claimResolutionPushes (design 2026-09-09 §2.1)", () => {
  async function seeded() {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const b = await player(app);
    const qs = await seedRound(db, { date: "2026-09-12", opensAt: new Date("2026-09-12T16:00:00Z"), locksAt: new Date("2026-09-13T16:00:00Z") });
    await db.insert(schema.predictions).values([
      { questionId: qs[0]!.id, userId: a.userId, answer: true, confidence: 75 },
      { questionId: qs[0]!.id, userId: b.userId, answer: false, confidence: 60 },
      { questionId: qs[1]!.id, userId: a.userId, answer: true, confidence: 55 },
    ]);
    return { db, qs, a, b };
  }

  it("returns nothing for an unresolved question and claims nothing", async () => {
    const { db, qs } = await seeded();
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt === null)).toBe(true);
  });

  it("composes one push per answering player with outcome, call and signed points, and stamps the claim", async () => {
    const { db, qs, a, b } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    const now = new Date("2026-09-13T20:00:00Z");
    const pushes = await claimResolutionPushes(db, qs[0]!.id, now);
    expect(pushes).toHaveLength(2);
    const mine = pushes.find((p) => p.userId === a.userId)!;
    expect(mine.text).toContain("YES");
    expect(mine.text).toContain("YES AT 75%");
    expect(mine.text).toMatch(/\+\d+\./);
    expect(mine.externalIds).toEqual([a.deviceId]);
    expect(mine.lineId.startsWith("resolve.")).toBe(true);
    expect(mine.text).not.toMatch(/[{}]/);
    const theirs = pushes.find((p) => p.userId === b.userId)!;
    expect(theirs.text).toContain("NO AT 60%");
    expect(theirs.text).toMatch(/-\d+\./);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt?.toISOString() === now.toISOString())).toBe(true);
  });

  it("is idempotent: a second claim returns nothing", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toHaveLength(2);
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
  });

  it("never pushes a void, and leaves the claim unset so nothing later mistakes it for sent", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "void", { reason: "test" });
    expect(await claimResolutionPushes(db, qs[0]!.id, new Date())).toEqual([]);
    const rows = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, qs[0]!.id) });
    expect(rows.every((r) => r.resolvePushedAt === null)).toBe(true);
  });

  it("truncates a long question to a 70-char headline and keeps the whole text under 160", async () => {
    const { db, qs } = await seeded();
    await db.update(schema.questions).set({ text: "Will the S&P 500 close higher on Thursday, September 10 than it closed on Wednesday, September 9, per S&P Dow Jones Indices?" }).where(eq(schema.questions.id, qs[0]!.id));
    await resolveQuestion(db, qs[0]!.id, "no");
    const [p] = await claimResolutionPushes(db, qs[0]!.id, new Date());
    expect(p!.text.length).toBeLessThanOrEqual(160);
    expect(p!.text).toContain("…");
  });

  it("selects the line deterministically per user and question", async () => {
    const { db, qs } = await seeded();
    await resolveQuestion(db, qs[0]!.id, "yes");
    const first = await claimResolutionPushes(db, qs[0]!.id, new Date());
    await db.update(schema.predictions).set({ resolvePushedAt: null }).where(eq(schema.predictions.questionId, qs[0]!.id));
    const second = await claimResolutionPushes(db, qs[0]!.id, new Date());
    expect(second.map((p) => p.lineId)).toEqual(first.map((p) => p.lineId));
  });
});
```

(`player()` in this file returns `{ userId, deviceId }` alongside the request function; check its exact shape and adapt the property access.)

- [ ] **Step 2: Run to verify it fails** — `cd apps/api && pnpm vitest run test/compose.test.ts` → FAIL (not exported).

- [ ] **Step 3: Implement** — append to `apps/api/src/push/compose.ts`:

```ts
import { isNull } from "drizzle-orm";
import { fillSlots as fill, selectLine as pick } from "@oracle/core"; // if already imported, reuse the existing imports

const RESOLVE = COPY_BANK.filter((l) => l.pool === "resolve");
const HEADLINE_MAX = 70;

export interface ResolutionPush {
  userId: string;
  predictionId: string;
  externalIds: string[];
  lineId: string;
  text: string;
}

// The question, in the reader's register (sentence case, as authored), cut
// to a headline. The caps line that follows is the push's own voice.
export function headline(text: string): string {
  const t = text.trim();
  return t.length <= HEADLINE_MAX ? t : `${t.slice(0, HEADLINE_MAX - 1).trimEnd()}…`;
}

function signed(points: number | null): string {
  if (points === null || points === 0) return "0";
  return points > 0 ? `+${points}` : String(points);
}

// The trickle (design 2026-09-09 §2.1): one push per (player, question) the
// moment a question resolves yes/no. THE CLAIM IS THE IDEMPOTENCY — one UPDATE
// stamps resolve_pushed_at on every unclaimed row and returns exactly those,
// so the hourly re-dispatch, a crashed step's replay, and two ticks racing
// on the same question all compose each push at most once. State-based on
// purpose: it reads the question's outcome, not a caller's "I just resolved
// it" flag, so a resolve whose step never checkpointed still gets its push
// on the next pass.
export async function claimResolutionPushes(db: Db, questionId: string, now: Date): Promise<ResolutionPush[]> {
  const q = await db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q || q.outcome === null || q.outcome === "void") return [];

  const claimed = await db
    .update(schema.predictions)
    .set({ resolvePushedAt: now })
    .where(and(eq(schema.predictions.questionId, questionId), isNull(schema.predictions.resolvePushedAt)))
    .returning();
  if (claimed.length === 0) return [];

  const userIds = [...new Set(claimed.map((p) => p.userId))];
  const devices = await db.query.devices.findMany({ where: inArray(schema.devices.userId, userIds) });
  const aliasesOf = new Map<string, string[]>();
  for (const d of devices) aliasesOf.set(d.userId, [...(aliasesOf.get(d.userId) ?? []), d.id]);

  const outcome = q.outcome === "yes" ? "YES" : "NO";
  const head = headline(q.text);
  return claimed.map((p) => {
    const line = selectLine(RESOLVE, `${p.userId}:${questionId}`, ["outcome", "call", "points"])!;
    const call = `${p.answer ? "YES" : "NO"} AT ${p.confidence}%`;
    return {
      userId: p.userId,
      predictionId: p.id,
      externalIds: aliasesOf.get(p.userId) ?? [],
      lineId: line.id,
      text: `${head} ${fillSlots(line.text, { outcome, call, points: signed(p.points) })}`,
    };
  });
}
```

Use the file's existing imports of `COPY_BANK`, `selectLine`, `fillSlots`, `and`, `eq`, `inArray`; add `isNull`.

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/compose.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/push/compose.ts apps/api/test/compose.test.ts
git commit -m "feat(push): claimResolutionPushes — one atomic claim, one push per answering player

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: `resolveOne` sends resolution pushes (both runners)

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts` (`resolveOne`, `ResolveOutcome`)
- Test: `apps/api/test/pipeline-resolve.test.ts`

**Interfaces:**
- `ResolveOutcome` gains `pushed?: number` (pushes composed) and `pushError?: string`.
- `resolveOne(deps, questionId)`: after `resolveWithClaude` returns (true OR false — state-based), call `claimResolutionPushes(deps.db, questionId, deps.now())`, then `sendPushes(deps.push ?? {}, pushes)`; any error is captured into `pushError`, never thrown (except `BudgetExhausted`, which is rethrown as today). Admin resolves and withdrawals never pass through `resolveOne`, so they never push (spec).

- [ ] **Step 1: Failing tests** — in `apps/api/test/pipeline-resolve.test.ts`, using the file's `fakeClaude`/`fakeDeps`/`seedOneLockedQuestion` helpers (read them first; extend `fakeDeps` to accept an optional `push: PushEnv`). Because `sendPushes` no-ops without keys, observe the CLAIM (`resolvePushedAt`) and the outcome's `pushed` count rather than network:

```ts
describe("resolveOne sends the resolution push (design 2026-09-09 §2.1)", () => {
  it("claims and composes one push per answering player after a successful resolve", async () => {
    const { db } = await makeTestDb();
    const q = await seedOneLockedQuestion(db);           // whatever the file's helper is named
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ questionId: q.id, userId: u!.id, answer: true, confidence: 70 });
    const deps = fakeDeps(db, fakeClaude(/* both resolvers agree YES — copy the agreeing fixture the file already uses */));
    const out = await resolveOne(deps, q.id);
    expect(out.resolved).toBe(true);
    expect(out.pushed).toBe(1);
    const p = await db.query.predictions.findFirst({ where: eq(schema.predictions.questionId, q.id) });
    expect(p!.resolvePushedAt).not.toBeNull();
  });

  it("still pushes when the question was resolved by an earlier, un-checkpointed attempt (state-based, not flag-based)", async () => {
    const { db } = await makeTestDb();
    const q = await seedOneLockedQuestion(db);
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ questionId: q.id, userId: u!.id, answer: false, confidence: 60 });
    await resolveQuestion(db, q.id, "no"); // simulate the earlier attempt's write
    const deps = fakeDeps(db, fakeClaude(/* any fixture — resolveWithClaude will find status !== locked and return false */));
    const out = await resolveOne(deps, q.id);
    expect(out.resolved).toBe(false);
    expect(out.pushed).toBe(1);
  });

  it("composes nothing on a second pass", async () => {
    const { db } = await makeTestDb();
    const q = await seedOneLockedQuestion(db);
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ questionId: q.id, userId: u!.id, answer: true, confidence: 70 });
    const deps = fakeDeps(db, fakeClaude(/* agreeing YES fixture */));
    await resolveOne(deps, q.id);
    const again = await resolveOne(deps, q.id);
    expect(again.pushed).toBe(0);
  });

  it("a push failure never fails the resolve", async () => {
    const { db } = await makeTestDb();
    const q = await seedOneLockedQuestion(db);
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.predictions).values({ questionId: q.id, userId: u!.id, answer: true, confidence: 70 });
    const deps = fakeDeps(db, fakeClaude(/* agreeing YES fixture */), { push: { ONESIGNAL_APP_ID: "x", ONESIGNAL_API_KEY: "y" } });
    // sendPushes will try fetch — stub global fetch to throw for this test
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
    try {
      const out = await resolveOne(deps, q.id);
      expect(out.resolved).toBe(true);
      expect(out.error).toBeUndefined();
    } finally { globalThis.fetch = realFetch; }
  });
});
```

(`sendPushes` catches per-push network errors as skips, so the last test may pass without `pushError`; keep the assertion to `resolved === true` and `error === undefined`.)

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/pipeline-resolve.test.ts` → FAIL (`pushed` undefined / claim not stamped).

- [ ] **Step 3: Implement** in `resolve.ts`:

```ts
import { claimResolutionPushes } from "../push/compose";
import { sendPushes } from "../push/onesignal";

export interface ResolveOutcome {
  questionId: string;
  resolved: boolean;
  error?: string;
  /** Resolution pushes composed on this pass (design 2026-09-09 §2.1). */
  pushed?: number;
  pushError?: string;
}

export async function resolveOne(deps: PipelineDeps, questionId: string): Promise<ResolveOutcome> {
  let resolved = false;
  try {
    resolved = await resolveWithClaude(deps, questionId);
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return { questionId, resolved: false, error: err instanceof Error ? err.message : String(err) };
  }
  // The trickle. State-based and after EVERY attempt, not only a successful
  // one: an attempt whose write landed but whose step never checkpointed
  // returns resolved=false on replay, and its players still deserve their
  // push. The claim inside makes this safe to run on every pass.
  let pushed = 0;
  let pushError: string | undefined;
  try {
    const pushes = await claimResolutionPushes(deps.db, questionId, deps.now());
    pushed = pushes.length;
    if (pushed > 0) await sendPushes(deps.push ?? {}, pushes);
  } catch (err) {
    pushError = err instanceof Error ? err.message : String(err);
  }
  return { questionId, resolved, pushed, ...(pushError ? { pushError } : {}) };
}
```

Also extend `narrateResolution` to mention pushes: after the failed-resolve line, if any outcome has `pushError`, send `⚠ resolution push failed (${date}): …`. And in the ResolutionWorkflow's terminal narration (already calls `narrateResolution`) nothing else changes.

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/pipeline-resolve.test.ts test/pipeline-workflows.test.ts && pnpm test:workflows && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/resolve.ts apps/api/test/pipeline-resolve.test.ts
git commit -m "feat(pipeline): each resolved question pushes its players the moment it decides

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 5: `readingRoundFor` + `reading` on `/v1/me/ledger`

**Files:**
- Create: `apps/api/src/reading.ts`
- Modify: `apps/api/src/routes/me.ts` (add `reading` to the ledger response)
- Test: `apps/api/test/reading.test.ts` (new), `apps/api/test/ledger.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReadingRound { date: string; settled: boolean; decided: number; total: number }
  export async function readingRoundFor(db: Db, userId: string): Promise<ReadingRound | null>
  ```
  Query: the user's predictions → their questions' `roundDate`s → rounds with `status IN ('locked','resolved')`, pick the max date; then count that round's questions and those with `outcome IS NOT NULL`. Null if none.

- [ ] **Step 1: Failing tests** — create `apps/api/test/reading.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import * as schema from "../src/db/schema";
import { readingRoundFor } from "../src/reading";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";

async function user(db: Awaited<ReturnType<typeof makeTestDb>>["db"]) {
  const [u] = await db.insert(schema.users).values({}).returning();
  return u!.id;
}
async function lock(db: Awaited<ReturnType<typeof makeTestDb>>["db"], date: string) {
  await db.update(schema.questions).set({ status: "locked" }).where(eq(schema.questions.roundDate, date));
  await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, date));
}
const win = (d: string) => ({ date: d, opensAt: new Date(`${d}T16:00:00Z`), locksAt: new Date(`${d}T16:00:00Z`) });

describe("readingRoundFor (design 2026-09-09 §2.2, §3.1)", () => {
  it("is null for a player with no locked round", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[0]!.id, userId: u, answer: true, confidence: 60 });
    expect(await readingRoundFor(db, u)).toBeNull(); // round still open
  });

  it("names a locked round as in play with decided/total counts", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[0]!.id, userId: u, answer: true, confidence: 60 });
    await lock(db, "2026-09-10");
    await resolveQuestion(db, qs[0]!.id, "yes");
    await resolveQuestion(db, qs[1]!.id, "void", { reason: "test" });
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-10", settled: false, decided: 2, total: 5 });
  });

  it("prefers the latest locked-or-settled round the player answered, skipping rounds they did not play", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const a = await seedRound(db, win("2026-09-08"));
    const b = await seedRound(db, win("2026-09-09"));
    await db.insert(schema.predictions).values({ questionId: a[0]!.id, userId: u, answer: true, confidence: 60 });
    await lock(db, "2026-09-08"); await lock(db, "2026-09-09");
    for (const q of a) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, "2026-09-08");
    for (const q of b) await resolveQuestion(db, q.id, "no");
    await settleRound(db, "2026-09-09");
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-08", settled: true, decided: 5, total: 5 });
  });

  it("reports settled once the round resolves", async () => {
    const { db } = await makeTestDb();
    const u = await user(db);
    const qs = await seedRound(db, win("2026-09-10"));
    await db.insert(schema.predictions).values({ questionId: qs[2]!.id, userId: u, answer: false, confidence: 80 });
    await lock(db, "2026-09-10");
    for (const q of qs) await resolveQuestion(db, q.id, "yes");
    await settleRound(db, "2026-09-10");
    expect(await readingRoundFor(db, u)).toEqual({ date: "2026-09-10", settled: true, decided: 5, total: 5 });
  });
});
```

Then in `apps/api/test/ledger.test.ts`, add one route-level assertion inside an existing ledger test that seeds a played + settled round: `expect(body.reading).toEqual({ date: <that date>, settled: true, decided: 5, total: 5 })`, and in a test with no rounds `expect(body.reading).toBeNull()`.

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run test/reading.test.ts test/ledger.test.ts` → FAIL.

- [ ] **Step 3: Implement** `apps/api/src/reading.ts`:

```ts
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { schema, type Db } from "./db/client";

export interface ReadingRound { date: string; settled: boolean; decided: number; total: number }

// The player's reading round (design 2026-09-09 §2.2, §3.1): the latest
// round that has locked or settled in which they hold at least one call.
// Home used to look at "the round date minus one", which a round settling
// two days later simply falls off. This is the one field home needs.
export async function readingRoundFor(db: Db, userId: string): Promise<ReadingRound | null> {
  const mine = await db.query.predictions.findMany({ where: eq(schema.predictions.userId, userId), columns: { questionId: true } });
  if (mine.length === 0) return null;
  const qs = await db.query.questions.findMany({
    where: inArray(schema.questions.id, mine.map((p) => p.questionId)),
    columns: { roundDate: true },
  });
  const dates = [...new Set(qs.map((q) => q.roundDate))];
  if (dates.length === 0) return null;
  const round = await db.query.rounds.findFirst({
    where: and(inArray(schema.rounds.date, dates), inArray(schema.rounds.status, ["locked", "resolved"])),
    orderBy: [desc(schema.rounds.date)],
  });
  if (!round) return null;
  const all = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date), columns: { outcome: true } });
  return {
    date: round.date,
    settled: round.status === "resolved",
    decided: all.filter((q) => q.outcome !== null).length,
    total: all.length,
  };
}
```

(Drop unused imports.) In `me.ts`, before the `return c.json({...})`, `const reading = await readingRoundFor(db, userId);` and add `reading,` to the object (import from `../reading`).

- [ ] **Step 4: Run to verify it passes** — `pnpm vitest run test/reading.test.ts test/ledger.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/reading.ts apps/api/src/routes/me.ts apps/api/test/reading.test.ts apps/api/test/ledger.test.ts
git commit -m "feat(api): the ledger names the player's reading round

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 6: Mobile — `readingSlot` and home wiring (IN PLAY + the ledger CTA)

**Files:**
- Create: `apps/mobile/src/game/readingSlot.ts`
- Test: `apps/mobile/test/readingSlot.test.ts`
- Modify: `apps/mobile/src/app/index.tsx` (`yesterday`, `showLedgerCta`, the call-slot block, the rail item)

**Interfaces:**
- Produces:
  ```ts
  import type { MeLedger } from "@oracle/core";
  export type Reading = NonNullable<MeLedger["reading"]>;
  export type ReadingSlot =
    | { kind: "none" }
    | { kind: "inPlay"; date: string; line: string; cta: string }
    | { kind: "settled"; date: string; line: string; cta: string };
  export function readingSlot(reading: Reading | null | undefined, revealSeen: string | null): ReadingSlot
  ```
  Rules: no reading → none. `!settled && decided >= 1` → inPlay with `inPlayLine(decided, total - decided)` and `READING_LINES.inPlayCta`. `!settled && decided === 0` → none (nothing to see yet; the rail still links). `settled && revealSeen !== date` → settled with `READING_LINES.settled`/`settledCta`. `settled && revealSeen === date` → none.

- [ ] **Step 1: Failing tests** — `apps/mobile/test/readingSlot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readingSlot } from "../src/game/readingSlot";

describe("readingSlot (design 2026-09-09 §2.2, §3.1)", () => {
  it("is none without a reading round", () => {
    expect(readingSlot(null, null)).toEqual({ kind: "none" });
    expect(readingSlot(undefined, "2026-09-09")).toEqual({ kind: "none" });
  });
  it("is in play once at least one question is decided in a locked round", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 3, total: 5 }, null)).toEqual({
      kind: "inPlay", date: "2026-09-09", line: "IN PLAY · 3 DECIDED · 2 PENDING", cta: "SEE WHAT IS DECIDED",
    });
  });
  it("is none for a locked round with nothing decided yet", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 0, total: 5 }, null)).toEqual({ kind: "none" });
  });
  it("is settled until the reveal has been seen", () => {
    expect(readingSlot({ date: "2026-09-09", settled: true, decided: 5, total: 5 }, "2026-09-08")).toEqual({
      kind: "settled", date: "2026-09-09", line: "THE LEDGER IS READ", cta: "READ THE LEDGER",
    });
    expect(readingSlot({ date: "2026-09-09", settled: true, decided: 5, total: 5 }, "2026-09-09")).toEqual({ kind: "none" });
  });
  it("keeps the in-play state visible even after a partial reveal was seen (seen is a settled concept)", () => {
    expect(readingSlot({ date: "2026-09-09", settled: false, decided: 4, total: 5 }, "2026-09-09").kind).toBe("inPlay");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/mobile && pnpm vitest run test/readingSlot.test.ts` → FAIL.

- [ ] **Step 3: Implement** `apps/mobile/src/game/readingSlot.ts`:

```ts
import { inPlayLine, READING_LINES, type MeLedger } from "@oracle/core";

export type Reading = NonNullable<MeLedger["reading"]>;

export type ReadingSlot =
  | { kind: "none" }
  | { kind: "inPlay"; date: string; line: string; cta: string }
  | { kind: "settled"; date: string; line: string; cta: string };

// What the home call slot says about the reading round (design 2026-09-09
// §2.2, §3.1). Pure, so the home screen stays a renderer.
export function readingSlot(reading: Reading | null | undefined, revealSeen: string | null): ReadingSlot {
  if (!reading) return { kind: "none" };
  if (!reading.settled) {
    if (reading.decided < 1) return { kind: "none" };
    return { kind: "inPlay", date: reading.date, line: inPlayLine(reading.decided, reading.total - reading.decided), cta: READING_LINES.inPlayCta };
  }
  if (revealSeen === reading.date) return { kind: "none" };
  return { kind: "settled", date: reading.date, line: READING_LINES.settled, cta: READING_LINES.settledCta };
}
```

- [ ] **Step 4: Wire home** (`apps/mobile/src/app/index.tsx`):
- Replace `const yesterday = yesterdayOf(round?.date);` with `const yesterday = ledger.data?.reading?.date ?? yesterdayOf(round?.date);` — note `ledger` (`useMeLedger()`) is declared later in the file (line ~166); move that declaration above this line.
- Compute `const slot = readingSlot(ledger.data?.reading, revealSeen);`.
- Replace `showLedgerCta` with `const showLedgerCta = slot.kind !== "none";` (keep the name so `HomeChallenge secondary={showLedgerCta}` and the rail logic stay).
- In the call-slot block replace the `DecodeLine`/`GoldButton` pair with:
  ```tsx
  {slot.kind !== "none" && (
    <>
      <DecodeLine active={booted} text={slot.line} {...role.line} color={colors.goldText} />
      <GoldButton title={slot.cta} onPress={() => leaveHome(() => router.push(`/reveal/${slot.date}`))} />
    </>
  )}
  ```
- The rail item label `"YESTERDAY"` → `READING_LINES.rail` (`"LEDGER"`), a11y label "Your latest ledger"; keep it pointing at `` `/reveal/${yesterday}` ``.
- Remove the now-unused `playedYesterday`/`useReveal(yesterday)` on home ONLY if nothing else in the file reads `reveal.data` (search first; `shieldNotice`/`lapseNotice` take `yesterday` but not `reveal`). If `useReveal` is still needed elsewhere, leave it.
- Keep `getRevealSeen` as is (the reveal screen marks seen only when fully resolved, which is exactly the "settled" semantics).

- [ ] **Step 5: Run to verify it passes** — `cd apps/mobile && pnpm vitest run && pnpm typecheck` → PASS. Grep that no test or screen still hardcodes `"YESTERDAY'S LEDGER IS READ"` (update `apps/mobile/test/*` fixtures if any reference it).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/game/readingSlot.ts apps/mobile/test/readingSlot.test.ts apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): home reads the reading round — IN PLAY counts and the ledger CTA

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 7: Full suite and docs

**Files:**
- Modify: `docs/launch-playbook.md` (one paragraph under the push section: per-question resolution pushes, the `resolve_pushed_at` claim, and that admin resolves/withdrawals never push)

- [ ] **Step 1:** `pnpm -r typecheck && pnpm -r test` from the repo root → all green (API ~7 min; a bare 5000ms timeout is contention — re-run the file).
- [ ] **Step 2:** Add the paragraph to `docs/launch-playbook.md` next to the existing OneSignal/hinge-push notes.
- [ ] **Step 3: Commit**

```bash
git add docs/launch-playbook.md
git commit -m "docs: resolution pushes and the reading round

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

- [ ] **Step 4: Deploy checklist (operator):** apply migration 0012 to oracle-dev and oracle-prod (`DATABASE_URL=… pnpm db:migrate` in `apps/api`); `npx wrangler deploy` from `apps/api`; push main. Mobile ships with the next EAS build. Watch Telegram's resolve narration for `pushed` counts on the first evening.

---

## Self-review

**Spec coverage:** §2.1 per-question push → Tasks 1–4 (copy, column, claim/compose, hook). §2.1's idempotency marker → Task 2/3 (atomic claim). §2.1's "hinge push copy shifts to closure" → deliberately NOT done: the noon pool's curiosity-gap lines still read correctly after a trickle ("YOUR RESULT IS READY" → the settled verdict, day points, and streak are still only on the reveal); revisit after real data. §2.2 IN PLAY → Tasks 1, 5, 6 (server field, pure slot, home). §3.1 yesterday → Tasks 5, 6. No new endpoint (spec's preference honored: a field on the ledger).

**Placeholder scan:** Task 4's tests reference "the agreeing fixture the file already uses" for `fakeClaude` — the implementer must read `pipeline-resolve.test.ts`'s existing agreeing-resolver fixture and reuse it; that is a pointer to concrete existing code, not a gap. Task 3's `player()` shape note likewise.

**Type consistency:** `ResolutionPush` (Task 3) consumed by `sendPushes` (needs `{externalIds, text}` — satisfied). `ReadingRound` (Task 5) matches `MeLedgerSchema.reading` (Task 1) field for field. `readingSlot` (Task 6) reads `MeLedger["reading"]` from Task 1's schema. `inPlayLine`/`READING_LINES` names consistent across Tasks 1 and 6.
