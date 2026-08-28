# Close the Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every audit gap that needs no third-party service: live player counts, retry-safe settlement, visible streak shields, a reveal entry point on home, a first-run rules rite, and an on-device closing reminder.

**Architecture:** Three API tasks first (live `player_count`, a `streak_settled_through` idempotency marker, shield state in `/v1/me/ledger`), then four mobile tasks that consume them (shield surfacing, home reveal CTA, the Rites screen, local notifications via expo-notifications — Expo SDK module, zero external services). All game copy is hand-written into `packages/core/src/copy.ts` and linted. All new mobile logic that can be pure goes in `src/game/` with node tests, per house convention.

**Tech Stack:** Cloudflare Worker + Hono + Drizzle/Neon (neon-http — **no interactive transactions**), PGlite test DB, Expo SDK 57 / RN 0.86, zustand, TanStack Query, expo-secure-store, expo-notifications (new), vitest everywhere.

**Spec:** The 2026-08-28 app audit (this plan's origin) plus `docs/superpowers/specs/2026-08-19-oracle-backend-spec.md` (settlement, shields) and `docs/superpowers/specs/2026-08-26-oracle-voice-design.md` (voice rules, notification beats, permission-ask timing).

## Global Constraints

- **No new external services.** No OneSignal, no RevenueCat, no Clerk. `expo-notifications` is used for **local scheduled notifications only** — never remote push.
- **Machine voice** (voice spec §2/§3, enforced by `packages/core/test/copy-lint.test.ts`): ALL CAPS, no emoji, no `!`, banned words `CHECK / TAP / CLICK / VISIT / RESULTS / DON'T MISS`, ≤140 chars. All new player-facing machine-voice copy lives in `packages/core/src/copy.ts`, hand-written.
- **neon-http has no interactive transactions** — idempotency comes from marker columns, never from transactions.
- **Expo docs**: per `apps/mobile/AGENTS.md`, read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any Expo-API code (mandatory for Task 7).
- **Mobile testing convention:** pure logic in `apps/mobile/src/game/*` with a matching node test in `apps/mobile/test/`; RN-importing modules (screens, `src/api/*`, `src/ui/*`, `src/notifications/*`) are verified by typecheck + manual run, not unit tests.
- Test commands: `pnpm --filter @oracle/api test`, `pnpm --filter @oracle/mobile test`, `pnpm --filter @oracle/core test`. Typecheck: same filters with `typecheck`.
- API tests that touch open rounds must freeze time (`vi.useFakeTimers({ now: ..., toFake: ["Date"] })` + `afterEach(() => vi.useRealTimers())`) or predictions 409 as locked.
- Commit after every task, conventional prefix (`feat:`, `fix:`, `test:`).

## File Structure

| File | Change | Task |
|---|---|---|
| `apps/api/src/routes/round.ts` | live distinct-player count in `/today` | 1 |
| `apps/api/test/round.test.ts` | player-count test | 1 |
| `apps/api/src/db/schema.ts` | `users.streak_settled_through` | 2 |
| `apps/api/drizzle/0002_*.sql` | generated migration | 2 |
| `apps/api/src/settlement.ts` | per-user retry guard | 2 |
| `apps/api/test/settlement.test.ts` | crash-retry tests | 2 |
| `apps/api/src/routes/me.ts` | shield fields in ledger payload | 3 |
| `packages/core/src/schemas.ts` | `MeLedgerSchema` shield fields | 3 |
| `apps/api/test/ledger.test.ts` | shield-state test | 3 |
| `apps/mobile/src/game/shieldStat.ts` + `test/shieldStat.test.ts` | shield display formatting | 4 |
| `apps/mobile/src/game/shieldNotice.ts` + `test/shieldNotice.test.ts` | "THE SHIELD HELD" home line | 4 |
| `apps/mobile/src/app/ledger.tsx` | SHIELDS IN RESERVE stat row | 4 |
| `apps/mobile/src/app/index.tsx` | shield line (4), reveal CTA (5), rites gate (6), reminder reseal (7) | 4–7 |
| `apps/mobile/src/game/revealReady.ts` + `test/revealReady.test.ts` | is yesterday's ledger worth announcing | 5 |
| `apps/mobile/src/api/flags.ts` | SecureStore flags (reveal-seen, rites-seen, notif-asked) | 5–7 |
| `apps/mobile/src/app/reveal/[date].tsx` | mark reveal seen | 5 |
| `packages/core/src/copy.ts` | `RITES_LINES` | 6 |
| `packages/core/test/copy-lint.test.ts` | lint the rites | 6 |
| `apps/mobile/src/app/rites.tsx` | the Rites screen | 6 |
| `apps/mobile/src/game/reminders.ts` + `test/reminders.test.ts` | pure reminder planning | 7 |
| `apps/mobile/src/notifications/schedule.ts` | expo-notifications wrapper | 7 |
| `apps/mobile/src/app/round.tsx` | permission ask after first seal | 7 |
| `apps/mobile/app.json` | expo-notifications plugin | 7 |

---

### Task 1: Live player count in `GET /v1/round/today`

**Why:** `rounds.player_count` is never written, so the home line "N ORACLES ALREADY WAITING" (`apps/mobile/src/app/index.tsx:67`) is permanently "THE ORACLE SPEAKS". Compute the count live — distinct users with ≥1 prediction on the open round — exactly how `/today/crowd` already computes per-question counts. No schema change; no client change (`RoundTodaySchema` already carries `player_count`).

**Files:**
- Modify: `apps/api/src/routes/round.ts:20-39`
- Test: `apps/api/test/round.test.ts`

**Interfaces:**
- Produces: `GET /v1/round/today` response field `player_count: number` = distinct predictors this round (was: always 0).

- [ ] **Step 1: Write the failing test**

Append to the `GET /v1/round/today` describe block in `apps/api/test/round.test.ts`. Add to the imports at the top: `vi`, `afterEach` from `vitest`, and add `afterEach(() => vi.useRealTimers());` beneath the `authedApp` helper if the file doesn't already have one.

```ts
it("counts distinct players who have sealed at least one answer", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
  const { app, db, authed } = await authedApp();
  const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });

  const res2 = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token: t2 } = (await res2.json()) as { token: string };
  const authed2 = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t2}` } });

  const submit = (p: typeof authed, qid: string) =>
    p("/v1/predictions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question_id: qid, answer: true, confidence: 75, idempotency_key: "k" }) });
  await submit(authed, qs[0]!.id);
  await submit(authed, qs[1]!.id); // same player twice — still one oracle
  await submit(authed2, qs[0]!.id);

  const body = (await (await authed("/v1/round/today")).json()) as { player_count: number };
  expect(body.player_count).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/api test -- round`
Expected: FAIL — `expected 0 to be 2` (route still returns the dead column).

- [ ] **Step 3: Implement the live count**

In `apps/api/src/routes/round.ts`, add `countDistinct` to the drizzle import (line 2):

```ts
import { asc, and, countDistinct, eq, inArray } from "drizzle-orm";
```

Replace the body of the `/today` handler (lines 20-39) with:

```ts
.get("/today", async (c) => {
  const { db } = c.get("deps");
  const found = await openRound(db);
  if (!found) return c.json({ error: "no open round" }, 404);
  const { round, qs } = found;
  // rounds.player_count is a dead column (never written); the live count is
  // distinct predictors on this round, same source of truth as /today/crowd.
  const qIds = qs.map((q) => q.id);
  const [players] = qIds.length
    ? await db.select({ n: countDistinct(schema.predictions.userId) }).from(schema.predictions).where(inArray(schema.predictions.questionId, qIds))
    : [{ n: 0 }];
  return c.json({
    date: round.date,
    locks_at: qs[0]?.locksAt ?? null,
    player_count: Number(players?.n ?? 0),
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
})
```

- [ ] **Step 4: Run the API suite**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: all PASS (the existing "without spoilers" test asserts fields, not the count's source, and still passes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/round.test.ts
git commit -m "fix: live distinct player_count in /v1/round/today"
```

---

### Task 2: Retry-safe settlement (`streak_settled_through`)

**Why:** `settleRound` documents its own hazard (`apps/api/src/settlement.ts:12-18`): users settle one at a time, the round flips `resolved` only at the end, and the `*/10` cron retries failures — a mid-loop crash double-settles users (streak +2, second shield burned). Fix is the one the comment prescribes: a `users.streak_settled_through` date checked per user in the loop.

**Files:**
- Modify: `apps/api/src/db/schema.ts:8-17`
- Create: `apps/api/drizzle/0002_*.sql` (generated)
- Modify: `apps/api/src/settlement.ts:19-62`
- Test: `apps/api/test/settlement.test.ts`

**Interfaces:**
- Produces: `users.streak_settled_through: date | null` (drizzle: `streakSettledThrough: string | null`) — the latest round date this user's streak has been settled through. `settleRound`'s returned `settled` count now counts users actually processed (skipped users excluded).

- [ ] **Step 1: Write the failing tests**

Append to the `settleRound` describe block in `apps/api/test/settlement.test.ts`:

```ts
it("a cron retry after a mid-loop crash does not double-settle a played user", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const a = await player(app);
  await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
  await settleRound(db, "2026-08-20");
  // Simulate the crash window: users were settled but the round never flipped.
  await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-20"));

  const retry = await settleRound(db, "2026-08-20");
  expect(retry.settled).toBe(0);
  expect((await db.query.users.findMany())[0]!).toMatchObject({ streakCurrent: 1, streakBest: 1, streakSettledThrough: "2026-08-20" });
});

it("a cron retry does not burn a second shield", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const a = await player(app);
  await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
  await settleRound(db, "2026-08-20");
  const uid = (await db.query.users.findMany())[0]!.id;
  // Free shield already spent this month; one paid shield in reserve.
  await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-20" }).where(eq(schema.users.id, uid));
  await db.insert(schema.entitlements).values({ userId: uid, plusActive: true, shieldsRemaining: 1 });
  // Day 2: a miss → the paid shield burns once.
  await playedRound(db, app, "2026-08-21", []);
  await settleRound(db, "2026-08-21");
  await db.update(schema.rounds).set({ status: "locked" }).where(eq(schema.rounds.date, "2026-08-21"));

  await settleRound(db, "2026-08-21"); // the retry
  const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, uid) });
  expect(ent!.shieldsRemaining).toBe(0); // burned once, not twice
  expect((await db.query.users.findMany())[0]!.streakCurrent).toBe(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oracle/api test -- settlement`
Expected: FAIL — first new test sees `streakCurrent: 2` (double-settled) and `streakSettledThrough` unknown; typecheck may also flag the unknown column. Both prove the gap.

- [ ] **Step 3: Add the column and generate the migration**

In `apps/api/src/db/schema.ts`, add to the `users` table after `callsResolved` (line 16):

```ts
  // Idempotency marker: the latest round date this user's streak has been
  // settled through. Lets a crashed settleRound retry skip finished users
  // (neon-http has no transactions to lean on).
  streakSettledThrough: date("streak_settled_through"),
```

Generate the migration:

Run: `pnpm --filter @oracle/api exec drizzle-kit generate`
Expected: a new `apps/api/drizzle/0002_*.sql` containing exactly `ALTER TABLE "users" ADD COLUMN "streak_settled_through" date;`. The PGlite test helper replays every `drizzle/*.sql` in sorted order, so tests pick it up automatically.

- [ ] **Step 4: Guard the settlement loop**

In `apps/api/src/settlement.ts`, replace lines 12-18 of the header comment (the `PLAN-4 PRECONDITION` paragraph) with:

```ts
// RETRY SAFETY: users.streak_settled_through marks each user done as their
// row is written, so a mid-loop crash + cron retry skips finished users.
// Write order per user: users row (streak + marker, one statement) THEN the
// entitlements decrement — a crash between the two leaves the player an
// undecremented shield (player-favorable), never a double burn.
```

Replace the loop and return (lines 33-61) with:

```ts
  const nonVoid = qs.filter((q) => q.outcome !== "void").length;
  let settled = 0;
  for (const u of audience.values()) {
    if (u.streakSettledThrough !== null && u.streakSettledThrough >= date) continue; // ISO dates compare lexicographically
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
      streakSettledThrough: date,
    };
    // Complete-rounds rule: all 5 answered → the round rates.
    if (byUser.get(u.id) === qs.length) {
      patch.callsResolved = u.callsResolved + nonVoid;
      patch.oracleScore = oracleScore(await completeRoundBriers(db, u.id, date));
    }
    await db.update(schema.users).set(patch).where(eq(schema.users.id, u.id));
    if (result.usedPaidShield && ent) {
      await db.update(schema.entitlements)
        .set({ shieldsRemaining: result.paidShieldsRemaining, updatedAt: new Date() })
        .where(eq(schema.entitlements.userId, u.id));
    }
    settled++;
  }

  await db.update(schema.rounds).set({ status: "resolved" }).where(eq(schema.rounds.date, date));
  return { already: false, settled };
```

- [ ] **Step 5: Run the API suite**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: all PASS, including the pre-existing settlement tests (first test's `settled: 1` on the first call is unchanged).

- [ ] **Step 6: Note the production migration**

Apply `drizzle/0002_*.sql` to the production Neon database the same way 0001 was applied (drizzle-kit push or the SQL directly in the Neon console) **before** the next worker deploy. Record the command used in the commit message body.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/src/settlement.ts apps/api/test/settlement.test.ts
git commit -m "fix: retry-safe settlement via users.streak_settled_through marker"
```

---

### Task 3: Shield state in `GET /v1/me/ledger`

**Why:** Shields run silently server-side; no client surface can exist until the API exposes them. Add three fields to the ledger payload — the app's one identity endpoint.

**Files:**
- Modify: `apps/api/src/routes/me.ts:68-78`
- Modify: `packages/core/src/schemas.ts:89-100` (`MeLedgerSchema`)
- Test: `apps/api/test/ledger.test.ts`

**Interfaces:**
- Produces (new `MeLedger` fields consumed by Task 4):
  - `free_shield_available: boolean` — the monthly free shield is unspent this calendar month (same `YYYY-MM` rule as `settleStreak`, `packages/core/src/streak.ts:12,25`).
  - `paid_shields: number` — `entitlements.shields_remaining`, 0 when no row.
  - `shield_used_on: string | null` — `users.free_shield_used_at` (the date the free shield last held; paid-shield burns are not dated — accepted v1 limitation, noted in code).

- [ ] **Step 1: Write the failing test**

Append to the `GET /v1/me/ledger` describe block in `apps/api/test/ledger.test.ts`. Add imports at the top: `import { eq } from "drizzle-orm";` and `import * as schema from "../src/db/schema";`.

```ts
it("reports shield state: monthly free shield, paid reserve, last hold date", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const a = await player(app);

  const fresh = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
  expect(fresh).toMatchObject({ free_shield_available: true, paid_shields: 0, shield_used_on: null });

  const uid = (await db.query.users.findMany())[0]!.id;
  await db.update(schema.users).set({ freeShieldUsedAt: "2026-08-19" }).where(eq(schema.users.id, uid));
  await db.insert(schema.entitlements).values({ userId: uid, shieldsRemaining: 2 });

  const spent = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
  expect(spent).toMatchObject({ free_shield_available: false, paid_shields: 2, shield_used_on: "2026-08-19" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/api test -- ledger`
Expected: FAIL — the three fields are absent from the payload.

- [ ] **Step 3: Extend schema and route**

In `packages/core/src/schemas.ts`, add to `MeLedgerSchema` after `majority_rate` (line 96):

```ts
  free_shield_available: z.boolean(),
  paid_shields: z.number().int().min(0),
  shield_used_on: z.string().nullable(),
```

In `apps/api/src/routes/me.ts`, after the `user` query (line 15) add:

```ts
    const ent = await db.query.entitlements.findFirst({ where: eq(schema.entitlements.userId, userId) });
```

And in the response object (after `majority_rate`, line 75) add:

```ts
      // Shield state (streak.ts month rule). shield_used_on only dates the
      // FREE shield — paid burns are undated, an accepted v1 limitation.
      free_shield_available: (() => {
        const usedAt = user?.freeShieldUsedAt ?? null;
        return usedAt === null || usedAt.slice(0, 7) !== new Date().toISOString().slice(0, 7);
      })(),
      paid_shields: ent?.shieldsRemaining ?? 0,
      shield_used_on: user?.freeShieldUsedAt ?? null,
```

- [ ] **Step 4: Run suites**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/core test && pnpm --filter @oracle/api typecheck && pnpm --filter @oracle/core typecheck`
Expected: all PASS (existing ledger assertions use `toMatchObject`, so added fields don't break them).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/me.ts apps/api/test/ledger.test.ts
git commit -m "feat: shield state in /v1/me/ledger"
```

---

### Task 4: Shield surfacing in the app

**Why:** The shield is the humane-streak mechanic (Duolingo's biggest retention lever) and the future paid hook — invisible today. Two surfaces: a `SHIELDS IN RESERVE` stat on the ledger plaque, and "THE SHIELD HELD. YOUR VIGIL SURVIVES THE MISSED NOON." on home the day after a free shield holds.

**Files:**
- Create: `apps/mobile/src/game/shieldStat.ts`, `apps/mobile/src/game/shieldNotice.ts`
- Test: `apps/mobile/test/shieldStat.test.ts`, `apps/mobile/test/shieldNotice.test.ts`
- Modify: `apps/mobile/src/app/ledger.tsx:55-61`, `apps/mobile/src/app/index.tsx:84-86`

**Interfaces:**
- Consumes: `MeLedger.free_shield_available` / `paid_shields` / `shield_used_on` (Task 3).
- Produces: `shieldStat(freeAvailable: boolean, paid: number): string`; `shieldNotice(shieldUsedOn: string | null, yesterday: string): string | null`.

- [ ] **Step 1: Write the failing tests**

`apps/mobile/test/shieldStat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shieldStat } from "../src/game/shieldStat";

describe("shieldStat", () => {
  it("formats every reserve state in machine voice", () => {
    expect(shieldStat(true, 0)).toBe("1 FREE");
    expect(shieldStat(true, 2)).toBe("1 FREE + 2 PAID");
    expect(shieldStat(false, 1)).toBe("1 PAID");
    expect(shieldStat(false, 0)).toBe("NONE UNTIL NEXT MONTH");
  });
});
```

`apps/mobile/test/shieldNotice.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shieldNotice } from "../src/game/shieldNotice";

describe("shieldNotice", () => {
  it("speaks only on the morning after the shield held", () => {
    expect(shieldNotice("2026-08-27", "2026-08-27")).toBe("THE SHIELD HELD. YOUR VIGIL SURVIVES THE MISSED NOON.");
    expect(shieldNotice("2026-08-20", "2026-08-27")).toBeNull();
    expect(shieldNotice(null, "2026-08-27")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oracle/mobile test -- shield`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Implement the pure modules**

`apps/mobile/src/game/shieldStat.ts`:

```ts
// Ledger plaque stat: the shield reserve, machine voice. Pure — node-tested.
export function shieldStat(freeAvailable: boolean, paid: number): string {
  const parts: string[] = [];
  if (freeAvailable) parts.push("1 FREE");
  if (paid > 0) parts.push(`${paid} PAID`);
  return parts.length ? parts.join(" + ") : "NONE UNTIL NEXT MONTH";
}
```

`apps/mobile/src/game/shieldNotice.ts`:

```ts
import { COPY_BANK } from "@oracle/core";

// The morning-after line when the free shield held a missed noon. The copy
// lives in the versioned bank (streak.shield-1); this module only decides
// WHEN it may speak: shield_used_on === yesterday, nothing else.
const LINE = COPY_BANK.find((l) => l.id === "streak.shield-1")!.text;

export function shieldNotice(shieldUsedOn: string | null, yesterday: string): string | null {
  return shieldUsedOn !== null && shieldUsedOn === yesterday ? LINE : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test -- shield`
Expected: PASS.

- [ ] **Step 5: Wire the two surfaces**

In `apps/mobile/src/app/ledger.tsx`: add `import { shieldStat } from "../game/shieldStat";` and insert after the `AGAINST THE TIDE` stat (line 61):

```tsx
            <Stat label="SHIELDS IN RESERVE" value={shieldStat(d.free_shield_available, d.paid_shields)} />
```

In `apps/mobile/src/app/index.tsx`: add `import { shieldNotice } from "../game/shieldNotice";`, then below the `vigil` line (line 41) add:

```tsx
  const shield = shieldNotice(ledger.data?.shield_used_on ?? null, yesterday);
```

and replace the vigil render block (lines 84-86) with (the shield line outranks the vigil line — it is the rarer, more loaded moment):

```tsx
        {(shield ?? vigil) && (
          <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{shield ?? vigil}</Mono>
        )}
```

Note: `yesterday` is computed at line 32 — the `shield` const must come after it.

- [ ] **Step 6: Typecheck and verify manually**

Run: `pnpm --filter @oracle/mobile typecheck && pnpm --filter @oracle/mobile test`
Expected: PASS. Then `pnpm --filter @oracle/mobile start`, open the ledger: `SHIELDS IN RESERVE   1 FREE` renders for a fresh user.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/shieldStat.ts apps/mobile/src/game/shieldNotice.ts apps/mobile/test/shieldStat.test.ts apps/mobile/test/shieldNotice.test.ts apps/mobile/src/app/ledger.tsx apps/mobile/src/app/index.tsx
git commit -m "feat: surface streak shields — plaque reserve stat and morning-after notice"
```

---

### Task 5: Reveal entry point on home

**Why:** The reveal is the game's payoff beat, and home never announces it — users must find a quiet "Yesterday's ledger" link. When yesterday's reveal is ready and the player took part, home shows "THE LEDGER IS READ" and a gold `READ THE LEDGER` button — **above** today's ENTER (payoff before pull, per the voice spec's two-beat ritual). Once viewed, it demotes back to the quiet link (a SecureStore seen-flag, so it survives relaunch).

**Files:**
- Create: `apps/mobile/src/game/revealReady.ts`, `apps/mobile/src/api/flags.ts`
- Test: `apps/mobile/test/revealReady.test.ts`
- Modify: `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/reveal/[date].tsx`

**Interfaces:**
- Consumes: `useReveal(date)` (`apps/mobile/src/api/hooks.ts:46-60`), which resolves to `Reveal | { pending: true }`.
- Produces: `revealReady(r: Reveal | { pending: true } | null | undefined): boolean`; `getRevealSeen(): Promise<string | null>` / `markRevealSeen(date: string): Promise<void>` in `flags.ts` (Tasks 6–7 extend this file).

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/revealReady.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { revealReady } from "../src/game/revealReady";
import type { Reveal } from "@oracle/core";

const q = (my: Reveal["questions"][number]["my"]): Reveal["questions"][number] => ({
  id: "00000000-0000-0000-0000-000000000001", slot: 1, text: "Q?", outcome: "yes", crowd_yes_pct: 60, market_prob: null, my,
});
const reveal = (my: Reveal["questions"][number]["my"]): Reveal => ({ date: "2026-08-27", day_points: 10, first_hour: false, questions: [q(my)] });

describe("revealReady", () => {
  it("announces only a ledger the player took part in", () => {
    expect(revealReady(reveal({ answer: true, confidence: 75, points: 10, brier: 0.0625 }))).toBe(true);
    expect(revealReady(reveal(null))).toBe(false); // lapsed day — nothing to read
    expect(revealReady({ pending: true })).toBe(false);
    expect(revealReady(null)).toBe(false);
    expect(revealReady(undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- revealReady`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `revealReady` and `flags.ts`**

`apps/mobile/src/game/revealReady.ts`:

```ts
import type { Reveal } from "@oracle/core";

// Home announces yesterday's ledger only when it is actually read (not
// pending) and the player has a line in it. Pure — node-tested.
export function revealReady(r: Reveal | { pending: true } | null | undefined): boolean {
  if (!r || "pending" in r) return false;
  return r.questions.some((q) => q.my !== null);
}
```

`apps/mobile/src/api/flags.ts` (same dynamic-import SecureStore pattern as `src/api/auth.ts:9-12`; every accessor swallows storage failures — a flag is never worth a crash):

```ts
// Small persisted flags (SecureStore, same store as the device token).
// Failures degrade to the flag's zero value — never throw for a flag.
async function store() {
  return import("expo-secure-store");
}

const REVEAL_SEEN_KEY = "oracle.reveal_seen"; // holds the last reveal DATE viewed

export async function getRevealSeen(): Promise<string | null> {
  try { return await (await store()).getItemAsync(REVEAL_SEEN_KEY); } catch { return null; }
}
export async function markRevealSeen(date: string): Promise<void> {
  try { await (await store()).setItemAsync(REVEAL_SEEN_KEY, date); } catch {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oracle/mobile test -- revealReady`
Expected: PASS.

- [ ] **Step 5: Wire home and the reveal screen**

In `apps/mobile/src/app/reveal/[date].tsx`: add imports `import { useEffect } from "react";` (merge into the existing react import if present) and `import { markRevealSeen } from "../../api/flags";`. Inside the component, after the reveal query is declared, add:

```tsx
  useEffect(() => {
    const d = reveal.data;
    if (d && !("pending" in d)) void markRevealSeen(d.date);
  }, [reveal.data]);
```

(Use the file's actual query variable name — it renders as `reveal.data` per lines 40-74.)

In `apps/mobile/src/app/index.tsx`:

```tsx
import { useReveal } from "../api/hooks";            // merge into the existing hooks import
import { revealReady } from "../game/revealReady";
import { getRevealSeen } from "../api/flags";
```

Inside the component, after `yesterday` is computed (line 32):

```tsx
  const reveal = useReveal(yesterday);
  const [revealSeen, setRevealSeen] = useState<string | null>(null);
  useEffect(() => { void getRevealSeen().then(setRevealSeen); }, []);
  const showLedgerCta = revealReady(reveal.data) && revealSeen !== yesterday;
```

In the bottom action stack (the `<View style={{ gap: space(3), paddingBottom: space(2) }}>` at line 62), insert as the FIRST children — above the `round && !allSealed` block:

```tsx
        {showLedgerCta && (
          <>
            <DecodeLine active={booted} text="THE LEDGER IS READ" size={11} color={colors.goldText} style={{ textAlign: "center" }} letterSpacing={2} />
            <GoldButton title="READ THE LEDGER" onPress={() => router.push(`/reveal/${yesterday}`)} />
          </>
        )}
```

And make the quiet link conditional so the destination is never offered twice — replace line 88 with:

```tsx
        {!showLedgerCta && <QuietLink title="Yesterday's ledger" onPress={() => router.push(`/reveal/${yesterday}`)} />}
```

- [ ] **Step 6: Typecheck and verify manually**

Run: `pnpm --filter @oracle/mobile typecheck && pnpm --filter @oracle/mobile test`
Expected: PASS. Then run the app against a played, locked yesterday: home leads with THE LEDGER IS READ → tap → reveal plays → return home → the gold CTA is gone, the quiet link is back (kill and relaunch: still gone).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/revealReady.ts apps/mobile/test/revealReady.test.ts apps/mobile/src/api/flags.ts apps/mobile/src/app/index.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "feat: home announces yesterday's ledger until it is read"
```

---

### Task 6: The Rites — first-run rules

**Why:** Nothing explains the game: the ×2s, the +10%, the 55-95 scale, or that seals are irreversible — all discovered a day late at reveal. A single screen of machine-voice declaratives (`/rites`), gated in front of a first-timer's ENTER and reachable forever via a quiet link. Copy is hand-written into the versioned bank file and linted.

**Files:**
- Modify: `packages/core/src/copy.ts` (add `RITES_LINES`), `packages/core/test/copy-lint.test.ts`
- Create: `apps/mobile/src/app/rites.tsx`
- Modify: `apps/mobile/src/api/flags.ts`, `apps/mobile/src/app/index.tsx`

**Interfaces:**
- Consumes: `flags.ts` (Task 5).
- Produces: `RITES_LINES: readonly string[]` exported from `@oracle/core`; `getRitesSeen(): Promise<boolean>` / `markRitesSeen(): Promise<void>` in `flags.ts`; route `/rites` (expo-router file route — no registration needed).

- [ ] **Step 1: Write the failing lint test**

Append to `packages/core/test/copy-lint.test.ts` (reuse the file's `BANNED` and `EMOJI` consts; add `RITES_LINES` to the import from `../src/copy`):

```ts
describe("the rites", () => {
  it("exist, and hold the register: caps, no emoji, no exclamation, no CTA verbs, push-length", () => {
    expect(RITES_LINES.length).toBeGreaterThanOrEqual(8);
    for (const l of RITES_LINES) {
      expect(l, l).toBe(l.toUpperCase());
      expect(l, l).not.toMatch(EMOJI);
      expect(l, l).not.toContain("!");
      for (const b of BANNED) expect(l, l).not.toContain(b);
      expect(l.length, l).toBeLessThanOrEqual(140);
    }
  });
  it("teach the load-bearing rules", () => {
    const all = RITES_LINES.join(" ");
    for (const word of ["SEALED", "CROWD", "BIG ONE", "TIDE", "FIRST HOUR", "SHIELD", "NOON"]) expect(all).toContain(word);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/core test -- copy-lint`
Expected: FAIL — `RITES_LINES` is not exported.

- [ ] **Step 3: Write the copy**

Append to `packages/core/src/copy.ts` (after `vigilLine`):

```ts
// The Rites: the rules, spoken once before a first seal and kept on a quiet
// link forever. Declaratives only — the machine explains itself the way it
// does everything else. Hand-written, linted, versioned.
export const RITES_LINES = [
  "FIVE QUESTIONS. ONCE A DAY. NOON TO NOON.",
  "ANSWER YES OR NO. THEN STATE YOUR CONVICTION.",
  "AN ANSWER SEALED CANNOT BE UNSEALED.",
  "THE CROWD IS HIDDEN UNTIL YOU COMMIT.",
  "CONVICTION PAYS WHEN RIGHT. IT COSTS MORE WHEN WRONG.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
  "STAND AGAINST THE TIDE AND PREVAIL: THE LEDGER PAYS TWICE.",
  "SEAL WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE.",
  "MISS A NOON AND THE SHIELD MAY HOLD. ONE IS GRANTED EACH MONTH.",
  "THE LEDGER IS READ AT NOON. NOTHING IS REVISED.",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oracle/core test`
Expected: PASS (including the pre-existing bank lint — `RITES_LINES` is a separate export, not a `COPY_BANK` pool, so pool-shape counts are untouched).

- [ ] **Step 5: Add the flags and the screen**

Append to `apps/mobile/src/api/flags.ts`:

```ts
const RITES_SEEN_KEY = "oracle.rites_seen";

export async function getRitesSeen(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(RITES_SEEN_KEY)) === "1"; } catch { return false; }
}
export async function markRitesSeen(): Promise<void> {
  try { await (await store()).setItemAsync(RITES_SEEN_KEY, "1"); } catch {}
}
```

Create `apps/mobile/src/app/rites.tsx`:

```tsx
import { View } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton } from "../ui/Button";
import { RITES_LINES, LITURGY_LINES } from "@oracle/core";
import { markRitesSeen } from "../api/flags";
import { colors, space } from "../theme";

// The Rites: the rules of the game, machine voice, printed in once. Reached
// from a first-timer's ENTER (index.tsx gate) and a standing quiet link.
export default function Rites() {
  const router = useRouter();
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The rites</Eyebrow>
        <View style={{ gap: space(2) }}>
          {RITES_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 130} durationMs={450} size={11} color={colors.ink} letterSpacing={2} style={{ lineHeight: 18 }} />
          ))}
        </View>
        <View style={{ gap: space(1), marginTop: space(2) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={9} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
      </View>
      <View style={{ paddingBottom: space(2) }}>
        <GoldButton
          title="BEGIN"
          onPress={() => { void markRitesSeen(); router.replace("/round"); }}
        />
      </View>
    </Screen>
  );
}
```

- [ ] **Step 6: Gate ENTER on home**

In `apps/mobile/src/app/index.tsx`: add `getRitesSeen` to the flags import, then inside the component:

```tsx
  const [ritesSeen, setRitesSeen] = useState(true); // optimistic: never flash the gate at a veteran
  useEffect(() => { void getRitesSeen().then(setRitesSeen); }, []);
```

Change the ENTER button (line 70) to:

```tsx
            <GoldButton title="ENTER" onPress={() => router.push(ritesSeen ? "/round" : "/rites")} />
```

Add a standing quiet link next to the existing two (after line 88):

```tsx
        <QuietLink title="The rites" onPress={() => router.push("/rites")} />
```

- [ ] **Step 7: Typecheck and verify manually**

Run: `pnpm --filter @oracle/mobile typecheck && pnpm --filter @oracle/mobile test && pnpm --filter @oracle/core test`
Expected: PASS. Manual: delete the app (or clear SecureStore) → ENTER routes to `/rites` → BEGIN → `/round`; relaunch → ENTER goes straight to `/round`; the quiet link reopens the rites anytime.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts apps/mobile/src/app/rites.tsx apps/mobile/src/api/flags.ts apps/mobile/src/app/index.tsx
git commit -m "feat: the rites — first-run rules screen, linted machine-voice copy"
```

---

### Task 7: Local closing reminder (expo-notifications, no service)

**Why:** A noon-to-noon ritual with no daily reminder is the audit's biggest retention gap; OneSignal is deferred as a third party, but **local scheduled notifications need no service at all**. On-device: one reminder per day at 3h before lock (the voice spec's "closing call" beat), copy drawn deterministically from the existing `closing` pool, rescheduled on every app open, today's cancelled once the prophecy is sealed. Permission is requested only after the player's first seal (voice spec §4: never at first launch).

**Files:**
- Create: `apps/mobile/src/game/reminders.ts`, `apps/mobile/src/notifications/schedule.ts`
- Test: `apps/mobile/test/reminders.test.ts`
- Modify: `apps/mobile/src/api/flags.ts`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/app/index.tsx`, `apps/mobile/app.json`, `apps/mobile/package.json`

**Interfaces:**
- Consumes: `useToday().data.locks_at` + `.date` (today's lock ISO timestamp and round date); `COPY_BANK`/`selectLine` from `@oracle/core` (`packages/core/src/copy.ts:101-110` — `satisfied: []` yields only requirement-free closing lines, so the `{n}` players line is never selected).
- Produces: `planReminders(locksAt: string, roundDate: string, todaySealed: boolean): Reminder[]` with `Reminder = { date: string; at: Date; body: string }`; `resealReminders(locksAt, roundDate, todaySealed): Promise<void>`; `askNotifPermissionOnce(): Promise<void>`.

- [ ] **Step 0: Read the versioned docs (AGENTS.md requirement)**

Read https://docs.expo.dev/versions/v57.0.0/sdk/notifications/ before Steps 4–6. Confirm against the docs: the date-trigger input shape for `scheduleNotificationAsync`, `cancelAllScheduledNotificationsAsync`, `getPermissionsAsync`/`requestPermissionsAsync`, whether the config plugin entry in `app.json` is required, and Android channel requirements. If the API shapes below differ from the docs, the docs win. Note: this adds a native module — a **new dev build** (`npx expo prebuild` / EAS dev client) is required; Expo Go will not run it.

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/reminders.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planReminders, REMINDER_DAYS, REMINDER_LEAD_MS } from "../src/game/reminders";

const locksAt = "2026-08-29T16:00:00.000Z"; // today's round (2026-08-28) locks tomorrow noon ET

describe("planReminders", () => {
  it("plans one reminder per day, three hours before each lock", () => {
    const r = planReminders(locksAt, "2026-08-28", false);
    expect(r).toHaveLength(REMINDER_DAYS);
    expect(REMINDER_LEAD_MS).toBe(3 * 3_600_000);
    expect(r[0]!.date).toBe("2026-08-28");
    expect(r[0]!.at.toISOString()).toBe("2026-08-29T13:00:00.000Z");
    expect(r[1]!.at.getTime() - r[0]!.at.getTime()).toBe(86_400_000);
  });
  it("skips today once the prophecy is sealed", () => {
    const r = planReminders(locksAt, "2026-08-28", true);
    expect(r).toHaveLength(REMINDER_DAYS - 1);
    expect(r[0]!.date).toBe("2026-08-29");
  });
  it("draws deterministic machine-voice copy from the closing pool", () => {
    const a = planReminders(locksAt, "2026-08-28", false);
    const b = planReminders(locksAt, "2026-08-28", false);
    expect(a.map((x) => x.body)).toEqual(b.map((x) => x.body));
    for (const x of a) {
      expect(x.body).toBe(x.body.toUpperCase());
      expect(x.body).not.toContain("{"); // no unexpanded slots — the {n} players line must never be drawn
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- reminders`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the pure planner**

`apps/mobile/src/game/reminders.ts`:

```ts
import { COPY_BANK, selectLine } from "@oracle/core";

// The closing call (voice spec §4 beat 2), planned on-device: one local
// notification per day, three hours before that day's lock. Future locks are
// assumed 24h apart — a DST shift drifts them by an hour until the next app
// open reseals the schedule. Pure — node-tested; expo scheduling lives in
// src/notifications/schedule.ts.
const CLOSING = COPY_BANK.filter((l) => l.pool === "closing");

export const REMINDER_LEAD_MS = 3 * 3_600_000;
export const REMINDER_DAYS = 7;

export interface Reminder { date: string; at: Date; body: string }

export function planReminders(locksAt: string, roundDate: string, todaySealed: boolean): Reminder[] {
  const lock0 = new Date(locksAt).getTime();
  const day0 = new Date(`${roundDate}T00:00:00Z`).getTime();
  const out: Reminder[] = [];
  for (let k = 0; k < REMINDER_DAYS; k++) {
    if (k === 0 && todaySealed) continue;
    const date = new Date(day0 + k * 86_400_000).toISOString().slice(0, 10);
    // satisfied=[] → only requirement-free lines are eligible; the oracle
    // does not change its mind, so the seed is the date alone.
    const line = selectLine(CLOSING, `closing:${date}`, []);
    if (!line) continue;
    out.push({ date, at: new Date(lock0 + k * 86_400_000 - REMINDER_LEAD_MS), body: line.text });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @oracle/mobile test -- reminders`
Expected: PASS.

- [ ] **Step 5: Install the module and write the scheduler**

Run: `pnpm --filter @oracle/mobile exec npx expo install expo-notifications`
Then add `"expo-notifications"` to the `plugins` array in `apps/mobile/app.json` (verify plugin requirement against the v57 docs from Step 0).

Append to `apps/mobile/src/api/flags.ts`:

```ts
const NOTIF_ASKED_KEY = "oracle.notif_asked";

export async function getNotifAsked(): Promise<boolean> {
  try { return (await (await store()).getItemAsync(NOTIF_ASKED_KEY)) === "1"; } catch { return true; } // storage failure → never nag
}
export async function markNotifAsked(): Promise<void> {
  try { await (await store()).setItemAsync(NOTIF_ASKED_KEY, "1"); } catch {}
}
```

Create `apps/mobile/src/notifications/schedule.ts` (adjust API shapes to the v57 docs from Step 0):

```ts
import * as Notifications from "expo-notifications";
import { planReminders } from "../game/reminders";
import { getNotifAsked, markNotifAsked } from "../api/flags";

// Local closing reminders — no push service. Reseal = cancel everything and
// schedule the next 7 days fresh; runs on every home mount, so drift and
// stale copies never accumulate. All failures are swallowed: a reminder is
// never worth a crash.

export async function resealReminders(locksAt: string, roundDate: string, todaySealed: boolean): Promise<void> {
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
    const now = Date.now();
    for (const r of planReminders(locksAt, roundDate, todaySealed)) {
      if (r.at.getTime() <= now) continue; // inside the 3h window already — no late nag
      await Notifications.scheduleNotificationAsync({
        content: { title: "ORACLE", body: r.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  } catch {}
}

// Voice spec §4: the permission ask comes immediately after the FIRST seal —
// never at first launch. One ask, ever; the OS remembers the answer.
export async function askNotifPermissionOnce(): Promise<void> {
  try {
    if (await getNotifAsked()) return;
    await markNotifAsked();
    await Notifications.requestPermissionsAsync();
  } catch {}
}
```

- [ ] **Step 6: Wire the two hooks**

In `apps/mobile/src/app/round.tsx`: add `import { useEffect, useState } from "react";` (extend line 1) and `import { askNotifPermissionOnce } from "../notifications/schedule";`. After `anySealed` is computed (line 31), add:

```tsx
  // The one permission ask, the moment after the first seal ever lands.
  useEffect(() => {
    if (anySealed) void askNotifPermissionOnce();
  }, [anySealed]);
```

In `apps/mobile/src/app/index.tsx`: add `import { resealReminders } from "../notifications/schedule";` and, inside the component after `allSealed` is computed (line 31):

```tsx
  useEffect(() => {
    if (round?.locks_at) void resealReminders(round.locks_at, round.date, allSealed);
  }, [round?.date, round?.locks_at, allSealed]);
```

- [ ] **Step 7: Typecheck, test, and verify on a dev build**

Run: `pnpm --filter @oracle/mobile typecheck && pnpm --filter @oracle/mobile test`
Expected: PASS. Manual (requires a fresh dev build): fresh install → no permission prompt at launch → seal one answer → OS permission prompt appears once → grant → return home → confirm via `Notifications.getAllScheduledNotificationsAsync()` (temporary log line, removed before commit) that 7 reminders sit at lock−3h with closing-pool copy → seal all five → reopen home → today's reminder is gone, 6 remain.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/reminders.ts apps/mobile/test/reminders.test.ts apps/mobile/src/notifications/schedule.ts apps/mobile/src/api/flags.ts apps/mobile/src/app/round.tsx apps/mobile/src/app/index.tsx apps/mobile/app.json apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat: local closing reminders — 3h before lock, no push service"
```

---

## Out of scope (needs a third party, or a design decision)

- **OneSignal noon hinge push** (`apps/api/src/push/compose.ts` stays unwired) — the local closing reminder covers beat 2 only; beat 1 (the noon hinge with personalized tiering) genuinely needs server push.
- **RevenueCat / Oracle Plus** — the `entitlements` writer, paywall, and paid shields purchase (Shipaton-critical, separate plan).
- **Account recovery / Clerk** — device-token identity remains fragile.
- **Device-mint rate limiting** — the sock-puppet vector on `POST /v1/auth/device` is best closed with Cloudflare rate-limiting rules (platform config, not code); flagged for the operator.
- **`oracleForecast` wiring** ("Beat the Oracle") — a feature, not a fix.
- **Readable `resolution_criteria` on the card** ("trust is UI", design spec §6) — needs no third party, but where verbose criteria live on a tarot card is a design call (the 8.5px coordinate line already carries `PER {SOURCE}`); take it in the next delight/brand pass rather than bolt it on here.
