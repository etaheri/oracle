# Ritual Core Implementation Plan (Plan 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Plan 3's autonomously-buildable core: round settlement (streaks + shields + Oracle Score + calls_resolved, with a real entitlements table), the first-hour badge through the reveal API, the home vigil line, and the Plan-2 follow-up hardening batch.

**Architecture:** Settlement is a shared function (`settleRound(db, date)`) triggered by a new admin endpoint today and by Plan 4's DO alarm later — the same pattern resolution already uses. Streak math is already TDD'd in `@oracle/core` (`settleStreak`); this plan wires it to storage, adds the `entitlements` table so the paid-shield branch is real (RevenueCat later just writes rows), and surfaces streaks through the existing `/v1/me/ledger`. The reveal payload gains the already-computed-but-unexposed `first_hour` flag. Copy comes from the machine-voice bank — never new inline strings.

**Tech Stack:** Drizzle (+ drizzle-kit for the migration), Hono, PGlite test DB, zod, @tanstack/react-query, vitest.

**Spec:** `docs/superpowers/specs/2026-08-19-oracle-backend-spec.md` (streak rule L79: played = ≥1 lock per round date; free monthly shield → paid shield → reset; settlement server-side at drop time for the prior round. Complete-rounds rule L73: only all-5-answered rounds feed Oracle Score and calls_resolved; void ⇒ brier null, excluded from score, streak credit still granted. Entitlements L55). Voice rules: `2026-08-26-oracle-voice-design.md` §2 (copy only from the bank).

## Global Constraints

- No new npm dependencies (drizzle-kit is already a devDependency of @oracle/api — verify, don't add).
- All user-facing copy comes from `COPY_BANK` / existing strings — never invent new lines outside the bank.
- Settlement MUST be idempotent: a second `settleRound` for the same date is a no-op (round status is the guard). Double-settling a streak is corruption.
- Workers never touch the production DB — API tests use `makeTestDb()`/`seedRound()`; the migration must be picked up automatically by `makeTestDb` (it replays `apps/api/drizzle/*.sql` in sorted order).
- Verification commands (repo root): `pnpm --filter @oracle/core test` (58 now), `pnpm --filter @oracle/core typecheck`, `pnpm --filter @oracle/api test` (27 now), `pnpm --filter @oracle/api typecheck`, `pnpm --filter @oracle/mobile exec tsc --noEmit`, `pnpm --filter @oracle/mobile test` (33 now). Totals grow; all green before each commit.
- Simulator workflow: Metro from `apps/mobile` on :8081, wrangler on :8787 from `apps/api` (`lsof -nP -iTCP:8081 -sTCP:LISTEN` etc.). UDID via `xcrun simctl list devices booted`. Fast Refresh from nohup'd Metro silently fails — for EVERY visual check: `xcrun simctl terminate <UDID> host.exp.Exponent; xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/<path>"; sleep 22; xcrun simctl io <UDID> screenshot <file>`, then Read it.
- Temp debug edits for verification MUST be reverted before commit; `git diff` shows only intended changes.
- `.npmrc` uses node-linker=hoisted — phantom-dependency risk. After any dependency removal, cold-start verification is mandatory.

---

### Task 1: Entitlements table (API, migration)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (append table)
- Create (generated): `apps/api/drizzle/0001_*.sql` via drizzle-kit
- Test: covered by Task 2's settlement tests (the table's consumer); this task only needs typecheck + existing suites green

**Interfaces:**
- Produces: `schema.entitlements` — `userId` (uuid pk, fk users.id), `plusActive` (bool, default false), `shieldsRemaining` (int, default 0), `expiresAt` (timestamptz null), `updatedAt` (timestamptz, defaultNow). Task 2 reads `shieldsRemaining` and decrements it.

- [ ] **Step 1: Append to `apps/api/src/db/schema.ts`**

```ts
// Oracle Plus entitlements (backend spec L55). Written by the RevenueCat
// webhook (Plan 3b); read by streak settlement for paid shields.
export const entitlements = pgTable("entitlements", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  plusActive: boolean("plus_active").notNull().default(false),
  shieldsRemaining: integer("shields_remaining").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Generate the migration**

From `apps/api`: `npx drizzle-kit generate` (check `drizzle.config.ts` for the exact command shape if it errors). Expected: a new `drizzle/0001_*.sql` containing only the `entitlements` CREATE TABLE. Inspect it — it must not touch existing tables.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: 27/27 still green (makeTestDb replays the new migration; nothing consumes the table yet).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle/
git commit -m "feat(api): entitlements table — plus flag + paid shields"
```

---

### Task 2: Round settlement (API, TDD)

**Files:**
- Create: `apps/api/src/settlement.ts`
- Modify: `apps/api/src/routes/admin.ts` (new route)
- Test: `apps/api/test/settlement.test.ts` (create)

**Interfaces:**
- Consumes: `settleStreak`, `oracleScore` from `@oracle/core`; `schema.entitlements` (Task 1); `resolveQuestion` (tests).
- Produces: `settleRound(db: Db, date: string): Promise<{ already: boolean; settled: number }>`; `POST /admin/rounds/:date/settle` → 200 `{ ok: true, already, settled }`, 404 unknown round, 409 when any question is still unresolved. Plan 4's DO alarm will call `settleRound` directly.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/settlement.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { settleRound } from "../src/settlement";
import * as schema from "../src/db/schema";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

// Seed an open round on `date`, optionally place predictions, resolve every
// question, return question rows.
async function playedRound(db: Awaited<ReturnType<typeof makeTestDb>>["db"], app: ReturnType<typeof createApp>, date: string, plays: Array<{ p: (path: string, init?: RequestInit) => Promise<Response>; slots: number[] }>, outcomes: Array<"yes" | "no" | "void"> = ["yes", "yes", "yes", "yes", "yes"]) {
  const qs = await seedRound(db, { date, opensAt: new Date(`${date}T16:00:00Z`), locksAt: new Date(`${date}T17:00:00Z`) });
  for (const { p, slots } of plays) for (const s of slots) await p("/v1/predictions", { method: "POST", body: body(qs.find((q) => q.slot === s)!.id, true) });
  for (const q of qs) await resolveQuestion(db, q.id, outcomes[q.slot - 1]!);
  return qs;
}

afterEach(() => vi.useRealTimers());

describe("settleRound", () => {
  it("increments a played user's streak, is idempotent, marks the round resolved", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);

    const first = await settleRound(db, "2026-08-20");
    expect(first.already).toBe(false);
    expect(first.settled).toBe(1);
    const users = await db.query.users.findMany();
    expect(users[0]).toMatchObject({ streakCurrent: 1, streakBest: 1 });
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-20") });
    expect(round!.status).toBe("resolved");

    const second = await settleRound(db, "2026-08-20");
    expect(second.already).toBe(true);
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(1); // not double-settled
  });

  it("a miss consumes the free monthly shield, then a paid shield, then resets", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    // day 1: played, streak 1
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    const uid = (await db.query.users.findMany())[0]!.id;
    // day 2: miss → free shield holds the streak
    await playedRound(db, app, "2026-08-21", []);
    await settleRound(db, "2026-08-21");
    let u = (await db.query.users.findMany())[0]!;
    expect(u).toMatchObject({ streakCurrent: 1, freeShieldUsedAt: "2026-08-21" });
    // day 3: miss, free shield spent this month, one paid shield available
    await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
    await playedRound(db, app, "2026-08-22", []);
    await settleRound(db, "2026-08-22");
    u = (await db.query.users.findMany())[0]!;
    expect(u.streakCurrent).toBe(1);
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
    expect(ent!.shieldsRemaining).toBe(0);
    // day 4: miss, no shields left → reset
    await playedRound(db, app, "2026-08-23", []);
    await settleRound(db, "2026-08-23");
    expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(0);
  });

  it("a complete round feeds calls_resolved (non-void count); score stays null under the minimum; a void slot still credits the streak", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2, 3, 4, 5] }], ["yes", "yes", "yes", "yes", "void"]);
    await settleRound(db, "2026-08-20");
    const u = (await db.query.users.findMany())[0]!;
    expect(u).toMatchObject({ streakCurrent: 1, callsResolved: 4, oracleScore: null });
  });

  it("a partial round grants streak but not calls_resolved", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1, 2] }]);
    await settleRound(db, "2026-08-20");
    expect((await db.query.users.findMany())[0]!).toMatchObject({ streakCurrent: 1, callsResolved: 0 });
  });
});

describe("POST /admin/rounds/:date/settle", () => {
  it("guards on secret, unknown round, and unresolved questions", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const admin = (path: string) => app.request(path, { method: "POST", headers: { "x-admin-secret": "admin" } });
    expect((await app.request("/admin/rounds/2026-08-20/settle", { method: "POST" })).status).toBe(401);
    expect((await admin("/admin/rounds/2026-08-20/settle")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-20T17:00:00Z") });
    expect((await admin("/admin/rounds/2026-08-20/settle")).status).toBe(409); // questions still open
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @oracle/api test` — Expected: settlement.test.ts FAILS (module not found); others pass.

- [ ] **Step 3: Implement**

Create `apps/api/src/settlement.ts`:

```ts
import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { oracleScore, settleStreak } from "@oracle/core";
import { schema, type Db } from "./db/client";

// Round settlement (backend spec L73/L79/L119): streak + shield settlement for
// every affected user, complete-round scoring, then the round flips to
// "resolved" — which is also the idempotency guard. Called by the admin
// endpoint today and by Plan 4's DO lock alarm later.
// PLAN-4 NOTE: the audience is users-with-streak ∪ users-who-played; both
// queries are unbounded and per-user scoring is N queries — fine at current
// scale, revisit with the DO alarm.
export async function settleRound(db: Db, date: string): Promise<{ already: boolean; settled: number }> {
  const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) throw new Error("unknown round");
  if (round.status === "resolved") return { already: true, settled: 0 };
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  if (!qs.every((q) => q.status === "resolved" || q.status === "void")) throw new Error("not fully resolved");

  const preds = await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) });
  const byUser = new Map<string, number>();
  for (const p of preds) byUser.set(p.userId, (byUser.get(p.userId) ?? 0) + 1);
  const streakHolders = await db.query.users.findMany({ where: gt(schema.users.streakCurrent, 0) });
  const playedUsers = byUser.size ? await db.query.users.findMany({ where: inArray(schema.users.id, [...byUser.keys()]) }) : [];
  const audience = new Map([...streakHolders, ...playedUsers].map((u) => [u.id, u]));

  const nonVoid = qs.filter((q) => q.outcome !== "void").length;
  for (const u of audience.values()) {
    const played = (byUser.get(u.id) ?? 0) > 0;
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, u.id) });
    const result = settleStreak(
      { streakCurrent: u.streakCurrent, streakBest: u.streakBest, freeShieldUsedAt: u.freeShieldUsedAt, paidShieldsRemaining: ent?.shieldsRemaining ?? 0 },
      played,
      date,
    );
    const patch: Partial<typeof schema.users.$inferInsert> = {
      streakCurrent: result.streakCurrent,
      streakBest: result.streakBest,
      freeShieldUsedAt: result.freeShieldUsedAt,
    };
    // Complete-rounds rule: all 5 answered → the round rates.
    if (byUser.get(u.id) === qs.length) {
      patch.callsResolved = u.callsResolved + nonVoid;
      patch.oracleScore = await recomputeOracleScore(db, u.id);
    }
    await db.update(schema.users).set(patch).where(eq(schema.users.id, u.id));
    if (result.usedPaidShield && ent) {
      await db.update(schema.entitlements)
        .set({ shieldsRemaining: result.paidShieldsRemaining, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, u.id));
    }
  }

  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  return { already: false, settled: audience.size };
}

// Oracle Score over the user's complete rounds only, in round/slot order.
async function recomputeOracleScore(db: Db, userId: string): Promise<number | null> {
  const rows = await db
    .select({ brier: schema.predictions.brier, roundDate: schema.questions.roundDate, locksAt: schema.questions.locksAt, slot: schema.questions.slot })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(and(eq(schema.predictions.userId, userId), isNotNull(schema.predictions.brier)));
  const perRound = new Map<string, number>();
  const all = await db
    .select({ roundDate: schema.questions.roundDate })
    .from(schema.predictions)
    .innerJoin(schema.questions, eq(schema.predictions.questionId, schema.questions.id))
    .where(eq(schema.predictions.userId, userId));
  for (const r of all) perRound.set(r.roundDate, (perRound.get(r.roundDate) ?? 0) + 1);
  const briers = rows
    .filter((r) => perRound.get(r.roundDate) === 5)
    .sort((x, y) => x.locksAt.getTime() - y.locksAt.getTime() || x.slot - y.slot)
    .map((r) => Number(r.brier));
  return oracleScore(briers);
}
```

In `apps/api/src/routes/admin.ts`: add `import { settleRound } from "../settlement";` and, after the resolve route:

```ts
  .post("/rounds/:date/settle", async (c) => {
    try {
      const out = await settleRound(c.get("deps").db, c.req.param("date"));
      return c.json({ ok: true, ...out });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "settle failed";
      return c.json({ error: msg }, msg === "unknown round" ? 404 : 409);
    }
  });
```

If `entitlements` is missing from the `schema` re-export in `apps/api/src/db/client.ts`, check how that file exports the schema (likely `export * as schema` or a namespace import) and ensure the new table is included.

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck` — Expected: all pass (27 + 6 new).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/settlement.ts apps/api/src/routes/admin.ts apps/api/test/settlement.test.ts
git commit -m "feat(api): round settlement — streaks, shields, oracle score"
```

---

### Task 3: First-hour badge through the reveal (API + core + mobile, TDD)

**Files:**
- Modify: `packages/core/src/schemas.ts` (RevealSchema)
- Modify: `apps/api/src/routes/round.ts` (reveal payload)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (badge line)
- Test: `apps/api/test/reveal-first-hour.test.ts` (create)

**Interfaces:**
- Consumes: existing `allFirstHour` computation at `round.ts:82` (already feeds `dayPoints`, never exposed).
- Produces: `RevealSchema` gains `first_hour: z.boolean()`; reveal JSON gains `first_hour: allFirstHour`.

- [ ] **Step 1: Failing test**

Create `apps/api/test/reveal-first-hour.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string) => JSON.stringify({ question_id: q, answer: true, confidence: 85, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("reveal first_hour", () => {
  it("is true when every prediction landed in the first hour, false otherwise", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id) }); // 30min in — first hour
    const b = await player(app);
    vi.setSystemTime(new Date("2026-08-20T19:00:00Z"));
    await b("/v1/predictions", { method: "POST", body: body(qs[1]!.id) }); // 3h in — not
    for (const q of qs) await resolveQuestion(db, q.id, "yes");

    const ra = (await (await a("/v1/round/2026-08-20/reveal")).json()) as { first_hour: boolean };
    const rb = (await (await b("/v1/round/2026-08-20/reveal")).json()) as { first_hour: boolean };
    expect(ra.first_hour).toBe(true);
    expect(rb.first_hour).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @oracle/api test`: new test FAILS (`first_hour` undefined).

- [ ] **Step 3: Implement**

In `packages/core/src/schemas.ts`, inside `RevealSchema` after `day_points`: add `first_hour: z.boolean(),`.
In `apps/api/src/routes/round.ts`, in the reveal `c.json({...})` after `day_points`: add `first_hour: allFirstHour,`.
In `apps/mobile/src/app/reveal/[date].tsx`, directly below the `<RollingPoints ... />` element (inside the same day-points `Animated.View`), add:

```tsx
            {d.first_hour && d.day_points > 0 && (
              <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>FIRST HOUR +10%</Mono>
            )}
```

- [ ] **Step 4: Verify green** — `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck && pnpm --filter @oracle/core typecheck && pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/round.ts "apps/mobile/src/app/reveal/[date].tsx" apps/api/test/reveal-first-hour.test.ts
git commit -m "feat(api+mobile): first-hour badge through the reveal"
```

---

### Task 4: Home vigil line (core TDD + mobile)

**Files:**
- Modify: `packages/core/src/copy.ts` (append `vigilLine`)
- Test: `packages/core/test/copy-select.test.ts` (append)
- Modify: `apps/mobile/src/app/index.tsx`

**Interfaces:**
- Produces: `vigilLine(streak: number, seedKey: string): string | null` — null below streak 2; otherwise a filled line drawn ONLY from streak-pool lines that `require` "streak" (lapse/shield/begin lines must never appear while a streak holds).

- [ ] **Step 1: Failing tests** — append to `packages/core/test/copy-select.test.ts`:

```ts
import { vigilLine } from "../src/copy";

describe("vigilLine", () => {
  it("is null below a 2-day streak", () => {
    expect(vigilLine(0, "k")).toBeNull();
    expect(vigilLine(1, "k")).toBeNull();
  });
  it("fills the streak into a vigil line and never draws a lapse line", () => {
    for (let i = 0; i < 30; i++) {
      const line = vigilLine(7, `seed-${i}`);
      expect(line).not.toBeNull();
      expect(line).toContain("7");
      expect(line).not.toMatch(/UNCONSULTED|GAP|STREAKS END|SHIELD|BEGIN AGAIN/);
    }
  });
  it("is deterministic per seed", () => {
    expect(vigilLine(4, "home:2026-08-27:4")).toBe(vigilLine(4, "home:2026-08-27:4"));
  });
});
```

- [ ] **Step 2: Run to verify failure** — core test FAILS (not exported).

- [ ] **Step 3: Implement** — append to `packages/core/src/copy.ts`:

```ts
// The home vigil: one quiet line while a streak holds. Only streak-pool lines
// that REQUIRE a streak are eligible — the lapse/shield lines are for other
// moments. Streak 1 is every first day; the oracle starts counting at 2.
const VIGIL_LINES = COPY_BANK.filter((l) => l.pool === "streak" && (l.requires ?? []).includes("streak"));

export function vigilLine(streak: number, seedKey: string): string | null {
  if (streak < 2) return null;
  const line = selectLine(VIGIL_LINES, seedKey, ["streak"]);
  return line ? fillSlots(line.text, { streak }) : null;
}
```

- [ ] **Step 4: Verify green** — `pnpm --filter @oracle/core test && pnpm --filter @oracle/core typecheck`.

- [ ] **Step 5: Home integration** — in `apps/mobile/src/app/index.tsx`:
- Imports: `import { vigilLine } from "@oracle/core";` and extend the hooks import with `useMeLedger` from `"../api/hooks"`.
- After the `epigraph` line: `const ledger = useMeLedger();` then `const vigil = vigilLine(ledger.data?.streak ?? 0, \`home:${round?.date ?? ""}\`);`
- Render directly ABOVE the `<QuietLink title="The forecaster's ledger" ...>` line:

```tsx
        {vigil && (
          <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{vigil}</Mono>
        )}
```

- [ ] **Step 6: Verify** — `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`. Visual check deferred to Task 7 (this device's streak is 0-1 until settlement runs).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-select.test.ts apps/mobile/src/app/index.tsx
git commit -m "feat(core+mobile): home vigil line from the streak pool"
```

---

### Task 5: Plan-2 follow-up hardening batch (mobile + api)

**Files:**
- Modify: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/api/client.ts`, `apps/mobile/src/api/hooks.ts`, `apps/mobile/src/app/round.tsx`
- Modify: `packages/core/src/schemas.ts`, `apps/api/src/routes/round.ts`
- Test: `apps/mobile/test/client.test.ts` (append)

Each item is independent; implement all, one commit.

- [ ] **Item a — React Query focus wiring.** In `_layout.tsx`: `import { AppState } from "react-native";`, `import { focusManager } from "@tanstack/react-query";`, and inside `RootLayout`:

```tsx
  // React Query's refetch-on-focus assumes web visibility events; RN needs
  // AppState wired in explicitly.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => focusManager.setFocused(s === "active"));
    return () => sub.remove();
  }, []);
```

- [ ] **Item b — reveal error unmasking.** In `reveal/[date].tsx`, ADD before the `if (!reveal.data || "pending" in reveal.data)` branch (a thrown non-409 currently falls into "Return at noon"):

```tsx
  if (reveal.isError) return (
    <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center", gap: space(3) }}>
      <Mono size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>THE ORB IS BEYOND REACH. IT WILL RETURN.</Mono>
    </View></Screen>
  );
```

(The string is `system.offline-1` from the bank, verbatim.)

- [ ] **Item c — SubmitResSchema into core.** Find the inline submit-response parsing in `apps/mobile/src/api/hooks.ts` (`useSubmit`'s schema — an object with `id` and `first_hour`). Add to `packages/core/src/schemas.ts`:

```ts
export const SubmitResSchema = z.object({ id: z.string().uuid(), first_hour: z.boolean() });
export type SubmitRes = z.infer<typeof SubmitResSchema>;
```

and import/use it in hooks.ts, deleting the local definition. If the local shape differs from this, match the ACTUAL route response (`apps/api/src/routes/predictions.ts:35`) and say so in your report.

- [ ] **Item d — ApiError polish + non-JSON guard.** In `apps/mobile/src/api/client.ts`: in the `ApiError` constructor add `this.name = "ApiError";`. Where the response body is parsed, guard non-JSON: wrap the `res.json()` call so a parse failure throws `new ApiError(res.status, "invalid response body")` instead of a raw SyntaxError (apply to both the error and success paths if both parse JSON).
- [ ] **Item e — dedupe the open-round query (API).** In `apps/api/src/routes/round.ts`, the `/today`, `/today/crowd`, and `/today/mine` handlers each repeat "find open round → 404 → load its questions". Extract a file-local helper `async function openRound(db) { ... returns { round, qs } | null }` and use it in all three. No behavior change — all API tests must stay green.
- [ ] **Item f — round.tsx force-counter.** Grep `apps/mobile/src/app/round.tsx` for a force/tick state counter flagged by Plan 2's review as redundant; delete it if present and confirm the screen logic doesn't reference it. If it's already gone, note that in the report.
- [ ] **Item g — client test for the non-JSON guard.** Append to `apps/mobile/test/client.test.ts` (follow its existing stub-fetch pattern): a fetch stub returning 200 with non-JSON body → expect `api(...)` to reject with `ApiError` whose `status` is 200 and `name` is "ApiError".

- [ ] **Verify:** `pnpm --filter @oracle/core typecheck && pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck && pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test` — all green.

- [ ] **Commit**

```bash
git add apps/mobile/src/app/_layout.tsx "apps/mobile/src/app/reveal/[date].tsx" apps/mobile/src/api/client.ts apps/mobile/src/api/hooks.ts apps/mobile/src/app/round.tsx packages/core/src/schemas.ts apps/api/src/routes/round.ts apps/mobile/test/client.test.ts
git commit -m "chore(mobile+api): plan-2 follow-up hardening batch"
```

---

### Task 6: Template dependency prune (mobile)

**Files:**
- Modify: `apps/mobile/package.json` (+ lockfile via pnpm)

- [ ] **Step 1: Verify each candidate.** For each of: `expo-glass-effect`, `expo-symbols`, `expo-web-browser`, `expo-device`, `expo-status-bar`, `expo-system-ui`, `react-native-web` — grep `apps/mobile/src`, `apps/mobile/app.json`, and any root `apps/mobile/*.tsx|ts|js` files for imports/references. A dep with zero references is removable. DO NOT touch: `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context` (expo-router runtime deps), `expo-image` (hero loop), `expo-constants`, or anything with a hit. `react-native-web` removal also requires deleting any `web` platform config in app.json if present (report what you find).

- [ ] **Step 2: Remove + reinstall.** Delete the verified-unused entries from `package.json`, run `pnpm install` at repo root.

- [ ] **Step 3: Full verification.** `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`, then cold-start ALL THREE routes in the simulator (home ``, `round`, `reveal/2026-08-20`) per the Global Constraints recipe and Read each screenshot — every screen must render exactly as before (`.npmrc` hoisting means only a runtime check proves a dep was truly unused). If any screen breaks, restore that dep, `pnpm install`, re-verify, and report which.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "chore(mobile): prune unused template dependencies"
```

---

### Task 7: Live settlement + full-pass verification + evidence

**Files:**
- Create: `docs/superpowers/plans/assets/ritual-core/` (screenshots)

- [ ] **Step 1: Full suites.** Run the complete verification chain from Global Constraints; all green; record exact totals.

- [ ] **Step 2: Live settlement e2e on the dev stack.** With wrangler + Metro up: resolve the dev round's five questions and settle it through the real admin API (get the admin secret from `apps/api/.dev.vars`):

```bash
SECRET=$(grep ADMIN_SECRET apps/api/.dev.vars | cut -d'"' -f2 || grep ADMIN_SECRET apps/api/.dev.vars | cut -d= -f2)
# list question ids for the open round date (2026-08-21) via psql-less route: use the reveal/today API or query via a tiny node script — the round /today endpoint returns ids
curl -s http://127.0.0.1:8787/v1/round/today -H "authorization: Bearer $(curl -s -X POST http://127.0.0.1:8787/v1/auth/device -H 'content-type: application/json' -d '{"platform":"ios"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')"
# then for each question id:
curl -s -X POST http://127.0.0.1:8787/admin/questions/<id>/resolve -H "x-admin-secret: $SECRET" -H 'content-type: application/json' -d '{"outcome":"yes"}'
# finally:
curl -s -X POST http://127.0.0.1:8787/admin/rounds/2026-08-21/settle -H "x-admin-secret: $SECRET"
```

Adapt the exact date to whatever round is open. Expected: settle returns `{"ok":true,"already":false,"settled":N}` with N ≥ 1 (this simulator's device played). Record the responses in your report. NOTE: this intentionally mutates the dev DB — the round is stale and this is the settlement feature's real e2e; after settling, `/v1/me/ledger` must show `streak: 1` for the device (curl it with the device's flow or verify via the plaque screen).

- [ ] **Step 3: Evidence captures** into `docs/superpowers/plans/assets/ritual-core/` (mkdir -p), temp edits reverted after each:
- `home-vigil.png` — home with the vigil line: temp-force in index.tsx `vigilLine(7, ...)` (literal 7), cold-start home, capture, REVERT.
- `first-hour.png` — reveal with the badge: temp-force `d.first_hour && d.day_points > 0` to `true` in [date].tsx, cold-start `reveal/2026-08-20`, capture, REVERT.
- `orb-beyond-reach.png` — kill wrangler (`kill $(lsof -t -iTCP:8787)`), cold-start `reveal/2026-08-20`, capture the error state, then RESTART wrangler (`cd apps/api && nohup npx wrangler dev --port 8787 > /tmp/wrangler.log 2>&1 &`) and confirm it serves again.
- `plaque-vigil.png` — the real (unforced) plaque screen post-settlement showing CURRENT VIGIL ≥ 1 DAYS.
After reverts: `git status --porcelain` shows ONLY the new PNGs.

- [ ] **Step 4: Commit evidence**

```bash
git add docs/superpowers/plans/assets/ritual-core/
git commit -m "chore(mobile): ritual-core evidence"
```

- [ ] **Step 5: Hand-test handoff.** Report what remains gated: RevenueCat (account + products + react-native-purchases + dev build) writing `entitlements`; OneSignal keys + SDK + permission interstitial; PostHog/Sentry keys + SDKs; EAS build profiles + Apple Developer enrollment; App Review submission; Apple account merge (design + real-device verification); Plan-4 automation calling `settleRound` + `composeHingePushes` from the DO alarm.

---

## Self-Review Notes

- **Spec coverage:** streak rule incl. shields + monthly reset (T2, settleStreak already encodes month logic), complete-rounds scoring + void handling (T2), entitlements (T1), settlement-at-drop trigger deferred to Plan 4 exactly as the spec's DO-alarm design says (admin endpoint = today's trigger, same as resolution); first-hour exposure (T3) closes Plan 2's deferred item; vigil surfaces use the voice bank only (T4).
- **Type consistency:** `settleRound` signature matches admin route + T7 curl; `first_hour` name identical in schema/route/mobile; `vigilLine` consumed by name in index.tsx.
- **Placeholder scan:** T5 items c/f and T6 involve verify-then-act on current code by design (follow-up cleanups against possibly-drifted code) — each names the file, the search target, and the required report-back; no TBDs.
- **Idempotency:** settlement guarded by round status; tests prove second call no-ops.
