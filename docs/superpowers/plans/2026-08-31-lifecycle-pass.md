# Lifecycle Pass — Implementation Plan (2 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Requires Plan 1 (`2026-08-31-truth-pass.md`) merged first** — it owns migration 0003 and every schema contract used here.

**Goal:** The daily loop keeps its promises without a human or an agent being awake: `/today` never serves a dead round, the drop falls through to an evergreen bank, unresolved questions get 24 hours before voiding, leaky questions lock early, device minting is throttled, the Oracle stamps its own forecast at lock, and the reveal carries sources, evidence, void reasons and the player's ledger.

**Architecture:** All work is in `apps/api`. The pipeline's pure decision core (`decideActions`) grows two inputs (`bankCount`, the locked round's date is already there) and one action (`publish-bank`); executors stay single-purpose. Public routes gain `/v1/round/next` and richer `/today` + reveal payloads matching the contracts Plan 1 put in `@oracle/core`. No schema changes (0003 already added `crowd_count`, `oracle_p_yes`, `devices.ip_hash/created_at`, `draft_bank`).

**Tech Stack:** Hono 4, drizzle-orm 0.45, Neon (neon-http — no interactive transactions), PGlite tests, vitest (single worker), zod 4, `Intl` ET clock helpers in `src/pipeline/clock.ts`.

**Spec:** `docs/superpowers/2026-08-31-gameplay-audit.md` §2 (all), §3.4 "SLEEPS hole", §3.3 receipts; `docs/superpowers/specs/2026-08-27-hermes-pipeline-design.md`; `docs/superpowers/specs/2026-08-09-oracle-design.md` §2a, §6, §8.

## Global Constraints

- Canonical rhythm (unchanged): round D opens noon ET D, locks noon ET D+1; cron `*/10`; noon tick = lock → publish → resolve → settle; author 17:00 hourly.
- **New void policy:** a locked question voids only at noon ET D+2 (24h after lock); resolution retries every tick in the noon hour, then hourly at minute < 10.
- `decideActions` stays pure (ET wall-clock + snapshot, no I/O, no `Date.now`).
- Every executor write is a standalone, retry-safe statement (neon-http has no transactions).
- API tests that touch open rounds freeze time (`vi.useFakeTimers({ now, toFake: ["Date"] })`, `afterEach(() => vi.useRealTimers())`).
- Test/typecheck: `pnpm --filter @oracle/api test`, `pnpm --filter @oracle/api typecheck`, `pnpm -r typecheck` at the end of every task (the mobile app consumes these payloads).
- Commit after every task; stage files by name.

## File Structure

| File | Change | Task |
|---|---|---|
| `apps/api/src/routes/round.ts` | ordered, self-locking `openRound`; per-question `locks_at`; `GET /next`; reveal readable once lock has passed | 1 |
| `apps/api/test/round.test.ts`, `test/resolve-reveal.test.ts` | tests | 1 |
| `apps/api/src/routes/auth.ts`, `test/auth.test.ts` | mint throttle by salted IP hash | 2 |
| `apps/api/src/pipeline/draft.ts`, `src/pipeline/actions.ts` (`publish`), `src/pipeline/author.ts`, `src/routes/admin.ts`, `test/helpers/draft.ts`, `test/pipeline-draft.test.ts`, `test/pipeline-tick.test.ts` | per-question early `locks_at` | 3 |
| `apps/api/src/pipeline/actions.ts` (`lock`, new `stampForecasts`), `test/pipeline-tick.test.ts` | Oracle forecast at lock | 4 |
| `apps/api/src/routes/round.ts` (reveal), `test/resolve-reveal.test.ts` | sources, evidence, void reason, `oracle_p_yes`, `ledger` block | 5 |
| `apps/api/src/pipeline/state.ts`, `src/pipeline/actions.ts`, `src/pipeline/index.ts`, `src/routes/admin.ts`, `src/routes/telegram.ts`, tests | evergreen draft bank + `publish-bank` | 6 |
| `apps/api/src/pipeline/state.ts`, `src/pipeline/actions.ts` (`voidQuestions` reason), `test/pipeline-decide.test.ts`, `test/pipeline-tick.test.ts` | 24h void grace + resolve throttle | 7 |

---

### Task 1: `/today` never serves a dead round; `/next` announces the next one

**Why:** `openRound` is `findFirst(status=open)` with no ordering and no lock check (`round.ts:8-9`), so with the cron off — or in the ≤10 min between lock time and the lock tick — the app shows an "open" round that 409s every seal (audit §2.4). The app also has nothing to count down to between rounds (audit §3.4 "SLEEPS hole"). And the reveal 409s until the *status* flips, though nothing can change after `locks_at` (predictions are rejected by the server clock).

**Files:**
- Modify: `apps/api/src/routes/round.ts`
- Test: `apps/api/test/round.test.ts`, `apps/api/test/resolve-reveal.test.ts`

**Interfaces:**
- Consumes: `RoundTodaySchema.questions[].locks_at`, `RoundNextSchema` (Plan 1 Task 5); `noonET` from `../pipeline/clock`.
- Produces: `openRound(db, now: Date)` → the earliest `status=open` round whose latest question `locks_at` is still in the future, else `null` (used by `/today`, `/today/crowd`, `/today/mine`).
- Produces: `GET /v1/round/next` → `{ date, opens_at }` for the earliest `status=scheduled` round (`opens_at = noonET(date).toISOString()`), 404 `{ error: "no round scheduled" }` otherwise.
- `/today` questions gain `locks_at` (ISO); top-level `locks_at` = the latest question lock.
- Reveal guard becomes: every question is `locked|resolved|void` **or** `now >= q.locksAt`.

- [ ] **Step 1: Failing tests**

`round.test.ts`, inside `describe("GET /v1/round/today")`:

```ts
  it("does not serve a round whose lock time has passed, even if the cron has not flipped it", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T16:05:00Z"), toFake: ["Date"] });
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    expect((await authed("/v1/round/today")).status).toBe(404);
    expect((await authed("/v1/round/today/crowd")).status).toBe(404);
  });
  it("serves the earliest live round when two are open, and carries per-question locks_at", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-21T12:00:00Z"), toFake: ["Date"] });
    const { db, authed } = await authedApp();
    await seedRound(db, { date: "2026-08-21", opensAt: new Date("2026-08-21T16:00:00Z"), locksAt: new Date("2026-08-22T16:00:00Z") });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const body = (await (await authed("/v1/round/today")).json()) as { date: string; locks_at: string; questions: Array<{ locks_at: string }> };
    expect(body.date).toBe("2026-08-20");
    expect(body.locks_at).toBe("2026-08-21T16:00:00.000Z");
    expect(body.questions.every((q) => q.locks_at === "2026-08-21T16:00:00.000Z")).toBe(true);
  });
```

New describe:

```ts
describe("GET /v1/round/next", () => {
  it("404s with nothing scheduled", async () => {
    const { authed } = await authedApp();
    expect((await authed("/v1/round/next")).status).toBe(404);
  });
  it("returns the earliest scheduled round's noon ET", async () => {
    const { db, authed } = await authedApp();
    await db.insert(schema.rounds).values([{ date: "2026-08-23", status: "scheduled" }, { date: "2026-08-22", status: "scheduled" }]);
    expect(await (await authed("/v1/round/next")).json()).toEqual({ date: "2026-08-22", opens_at: "2026-08-22T16:00:00.000Z" });
  });
});
```

(add `import * as schema from "../src/db/schema";` to the file.)

`resolve-reveal.test.ts` — add: a round seeded open with `locksAt` in the past and no status change → reveal returns 200 with `outcome: null` rows (comment: "the server clock, not the cron, decides when nothing can change").

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- round resolve-reveal`
Expected: FAIL.

- [ ] **Step 3: Implement**

`round.ts`:

```ts
import { noonET } from "../pipeline/clock";

// The live round: earliest open round whose latest question lock is still
// ahead of the server clock. The cron flips statuses on a 10-minute tick;
// the clock is authoritative in between (predictions.ts already enforces it).
async function openRound(db: Db, now: Date) {
  const rounds = await db.query.rounds.findMany({ where: eq(schema.rounds.status, "open"), orderBy: [asc(schema.rounds.date)] });
  for (const round of rounds) {
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date), orderBy: [asc(schema.questions.slot)] });
    const lastLock = qs.reduce((m, q) => Math.max(m, q.locksAt.getTime()), 0);
    if (qs.length > 0 && now.getTime() < lastLock) return { round, qs, lastLock: new Date(lastLock) };
  }
  return null;
}
```

Every `openRound(db)` call → `openRound(db, new Date())`. In `/today`: `locks_at: found.lastLock.toISOString()`, and per question `locks_at: q.locksAt.toISOString()`.

Add before `/:date/reveal`:

```ts
  .get("/next", async (c) => {
    const { db } = c.get("deps");
    const next = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "scheduled"), orderBy: [asc(schema.rounds.date)] });
    if (!next) return c.json({ error: "no round scheduled" }, 404);
    return c.json({ date: next.date, opens_at: noonET(next.date).toISOString() });
  })
```

Reveal guard:

```ts
    const now = Date.now();
    const settledEnough = qs.every((q) => q.status === "locked" || q.status === "resolved" || q.status === "void" || now >= q.locksAt.getTime());
    if (!settledEnough) return c.json({ error: "not locked" }, 409);
```

- [ ] **Step 4: Run suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS. (`crowd.test.ts`/`mine.test.ts` seed future locks — unaffected.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/round.test.ts apps/api/test/resolve-reveal.test.ts
git commit -m "fix(api): the server clock decides what is open — ordered self-locking /today, per-question locks_at, /round/next"
```

---

### Task 2: Device-mint throttle

**Why:** `POST /v1/auth/device` mints an unlimited number of users with no credential (audit §2.2): free crowd manipulation, inflatable player counts, zero-cost crowd peeking. A salted IP hash with a short window is the no-third-party fix; a Cloudflare WAF rule can layer on top later.

**Files:**
- Modify: `apps/api/src/routes/auth.ts`
- Test: `apps/api/test/auth.test.ts`

**Interfaces:**
- Consumes: `schema.devices.ipHash`, `schema.devices.createdAt` (Plan 1 Task 6), `sha256Hex` from `../auth/deviceToken`.
- Produces: `MINT_LIMIT = 5` per `MINT_WINDOW_MS = 3_600_000` per `cf-connecting-ip`; 429 `{ error: "too many devices" }`. **No header → no throttle** (tests, local dev; Cloudflare always sets it in production).

- [ ] **Step 1: Failing tests**

Append to `auth.test.ts` (read it first for the app/env harness):

```ts
describe("mint throttle", () => {
  const mint = (app: ReturnType<typeof createApp>, ip?: string) =>
    app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) }, body: JSON.stringify({ platform: "ios" }) });
  it("allows five devices per IP per hour, then 429s; other IPs unaffected", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    for (let i = 0; i < 5; i++) expect((await mint(app, "1.2.3.4")).status).toBe(200);
    expect((await mint(app, "1.2.3.4")).status).toBe(429);
    expect((await mint(app, "5.6.7.8")).status).toBe(200);
  });
  it("does not throttle when no client IP header is present", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    for (let i = 0; i < 7; i++) expect((await mint(app)).status).toBe(200);
  });
  it("stores only a salted hash, never the IP", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await mint(app, "1.2.3.4");
    const d = (await db.query.devices.findMany())[0]!;
    expect(d.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.ipHash).not.toContain("1.2.3.4");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- auth`
Expected: FAIL (6th mint is 200; `ipHash` null).

- [ ] **Step 3: Implement**

`auth.ts`:

```ts
import { and, count, eq, gt } from "drizzle-orm";

export const MINT_LIMIT = 5;
export const MINT_WINDOW_MS = 3_600_000;

export const authRoutes = new Hono<AppContext>().post("/device", async (c) => {
  const parsed = BodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid body" }, 400);
  const { db, env } = c.get("deps");

  // Sybil brake: a salted hash of the minting IP, MINT_LIMIT per hour. The
  // salt is the token secret so the hash is useless outside this deployment.
  // No header (tests, local wrangler) → no throttle; Cloudflare always sets it.
  const ip = c.req.header("cf-connecting-ip");
  const ipHash = ip ? await sha256Hex(`${ip}:${env.DEVICE_TOKEN_SECRET}`) : null;
  if (ipHash) {
    const since = new Date(Date.now() - MINT_WINDOW_MS);
    const [row] = await db.select({ n: count() }).from(schema.devices).where(and(eq(schema.devices.ipHash, ipHash), gt(schema.devices.createdAt, since)));
    if (Number(row?.n ?? 0) >= MINT_LIMIT) return c.json({ error: "too many devices" }, 429);
  }

  const deviceId = crypto.randomUUID();
  const token = await mintDeviceToken(env.DEVICE_TOKEN_SECRET, deviceId, Date.now());
  const [user] = await db.insert(schema.users).values({}).returning({ id: schema.users.id });
  await db.insert(schema.devices).values({ id: deviceId, userId: user!.id, installTokenHash: await sha256Hex(token), platform: parsed.data.platform, ipHash });
  return c.json({ token, user_id: user!.id });
});
```

- [ ] **Step 4: Run suite**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/auth.ts apps/api/test/auth.test.ts
git commit -m "feat(api): device minting is throttled — five per IP per hour, salted hash only"
```

---

### Task 3: Leaky questions lock early

**Why:** Spec §6: "market questions lock at market close, game questions at tip-off." Submission already enforces per-question `locks_at` (`predictions.ts:19`) but authoring stamps noon D+1 on all five (audit §2.7), so a 7pm tip-off is answerable at 11pm with the score known.

**Files:**
- Modify: `apps/api/src/pipeline/draft.ts`, `apps/api/src/pipeline/actions.ts` (`publish`), `apps/api/src/pipeline/author.ts`, `apps/api/src/routes/admin.ts`, `apps/api/test/helpers/draft.ts`
- Test: `apps/api/test/pipeline-draft.test.ts`, `apps/api/test/pipeline-tick.test.ts`, `apps/api/test/pipeline-author.test.ts` (if it asserts the JSON-schema `required` list)

**Interfaces:**
- Produces: `DraftQuestionSchema.locks_at: string | null` (ISO-8601, `z.iso.datetime({ offset: true })`, default `null`).
- `upsertDraft(db, date, draft)`: `locksAt = q.locks_at ? new Date(q.locks_at) : noonET(D+1)`; throws `Error("locks_at out of range")` unless `noonET(date) < locksAt <= noonET(D+1)`. Admin `POST /admin/rounds/:date` maps that to 400 `{ error: "locks_at out of range" }`.
- `publish(db, telegram, date)`: sets `opensAt = noonET(date)`, `status = open`, and `locksAt = authored` when `opensAt < authored < noonET(D+1)`, else `noonET(D+1)` (per-question updates).
- Author: JSON-schema mirror gains `locks_at: { type: ["string", "null"] }` in properties **and** in the required list; the editorial contract gains the bullet below in both places it is stated.

- [ ] **Step 1: Failing tests**

`pipeline-draft.test.ts`:

```ts
  it("an authored early locks_at is kept; null defaults to noon D+1; out of range throws", async () => {
    const { db } = await makeTestDb();
    const early = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-28T00:00:00Z" } : q)) };
    await upsertDraft(db, "2026-08-27", DraftSchema.parse(early));
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27"), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs[1]!.locksAt.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
    const late = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-29T00:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(late))).rejects.toThrow("locks_at out of range");
    const before = { ...validDraft, questions: validDraft.questions.map((q) => (q.slot === 2 ? { ...q, locks_at: "2026-08-27T15:00:00Z" } : q)) };
    await expect(upsertDraft(db, "2026-08-27", DraftSchema.parse(before))).rejects.toThrow("locks_at out of range");
  });
```

`pipeline-tick.test.ts`, next to the existing publish test (line ~44): a scheduled question whose `locksAt` was authored to `2026-08-28T00:00:00Z` keeps it through publish, while a sibling with `locksAt: new Date(0)` gets `2026-08-28T16:00:00.000Z`.

Update `test/helpers/draft.ts` `validDraft` questions with `locks_at: null`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-draft pipeline-tick`
Expected: FAIL.

- [ ] **Step 3: Implement**

`draft.ts` — schema:

```ts
  // Leaky questions lock early (design spec §6): the instant the outcome
  // starts to become knowable (tip-off, market close). null → noon D+1.
  locks_at: z.iso.datetime({ offset: true }).nullable().default(null),
```

`upsertDraft` — replace the insert's timing fields:

```ts
  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  const rows = draft.questions.map((q) => {
    const locksAt = q.locks_at ? new Date(q.locks_at) : locksAtDefault;
    if (locksAt.getTime() <= opensAt.getTime() || locksAt.getTime() > locksAtDefault.getTime()) throw new Error("locks_at out of range");
    return { /* existing fields */, opensAt, locksAt, resolveBy: new Date(locksAtDefault.getTime() + 3_600_000), status: "scheduled" as const };
  });
  // (validate ALL rows before any write — the map above throws before the inserts)
  await db.insert(schema.rounds).values({ date, status: "scheduled" });
  await db.insert(schema.questions).values(rows);
```

`actions.ts` `publish` — replace the single questions update:

```ts
  const opensAt = noonET(date);
  const locksAtDefault = noonET(addDays(date, 1));
  const scheduled = await db.query.questions.findMany({ where: and(eq(schema.questions.roundDate, date), eq(schema.questions.status, "scheduled")) });
  for (const q of scheduled) {
    // Keep an authored early lock; anything else (incl. seeds with epoch) gets the default.
    const early = q.locksAt.getTime() > opensAt.getTime() && q.locksAt.getTime() < locksAtDefault.getTime();
    await db.update(schema.questions).set({ opensAt, locksAt: early ? q.locksAt : locksAtDefault, status: "open" }).where(eq(schema.questions.id, q.id));
  }
```

`admin.ts` `POST /rounds/:date` catch: add `if (msg === "locks_at out of range") return c.json({ error: msg }, 400);`.

`author.ts`: add `locks_at: { type: ["string", "null"] }` to the JSON-schema properties and `"locks_at"` to `draftQuestionRequired`; add to both editorial-contract lists:

```
- locks_at: if the outcome begins to become knowable before 11:00 AM ET on ${addDays(date, 1)} (a game tips off, a market closes, a scheduled release lands), set locks_at to that moment as an ISO-8601 UTC timestamp so answers lock before the information leaks. Otherwise null.
```

If `rerollSlot`/draft-to-telegram formatting prints a question summary, append ` · locks ${q.locks_at}` when non-null.

- [ ] **Step 4: Run suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS (`pipeline-author.test.ts` may pin the `required` array — update it).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/draft.ts apps/api/src/pipeline/actions.ts apps/api/src/pipeline/author.ts apps/api/src/routes/admin.ts apps/api/test/helpers/draft.ts apps/api/test/pipeline-draft.test.ts apps/api/test/pipeline-tick.test.ts apps/api/test/pipeline-author.test.ts
git commit -m "feat(api): leaky questions lock early — authored locks_at survives publish, validated against the round window"
```

---

### Task 4: The Oracle stamps its own forecast at lock

**Why:** `packages/core/src/forecast.ts` (skill-weighted, extremized aggregate) is tested and never called (audit §2.8). Stamping it at lock — when the crowd is final and nothing can change — gives the machine a graded track record from day one (design §2a) and gives Plan 3 the third character on the reveal.

**Files:**
- Modify: `apps/api/src/pipeline/actions.ts`
- Test: `apps/api/test/pipeline-tick.test.ts`

**Interfaces:**
- Consumes: `oracleForecast` from `@oracle/core`, `schema.questions.oracleProbYes`.
- Produces: `stampForecasts(db, date): Promise<void>` — for each question of the round: `pYes` per prediction (`answer ? confidence/100 : 1 − confidence/100`) joined with the predictor's `oracleScore`; `ratedPlayerCount` = users with non-null `oracleScore`; writes `oracle_p_yes` (null when no predictions). `lock()` calls it first.

- [ ] **Step 1: Failing test**

`pipeline-tick.test.ts`:

```ts
  it("lock stamps the oracle's forecast: the plain mean of p_yes under the rated-player floor", async () => {
    // seed open round 2026-08-26 locking 2026-08-27T16:00Z; three players on slot 1: YES@75, YES@55, NO@65 → mean(0.75, 0.55, 0.35) = 0.55
    // tick at 2026-08-27T16:00Z → questions[0].oracleProbYes ≈ "0.55" (Number(...) toBeCloseTo 0.55, 6); questions[1].oracleProbYes null
  });
```

Write it with the file's `player`/submit helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-tick`
Expected: FAIL (`oracleProbYes` null).

- [ ] **Step 3: Implement**

`actions.ts`:

```ts
import { count, isNotNull } from "drizzle-orm";
import { oracleForecast } from "@oracle/core";

// The Oracle takes its position (design §2a) the instant the crowd is final.
// Raw mean at cold start, skill-weighted + extremized once FORECAST_MIN_RATED
// players carry a score — all of that lives in core; this just feeds it.
export async function stampForecasts(db: Db, date: string): Promise<void> {
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const [rated] = await db.select({ n: count() }).from(schema.users).where(isNotNull(schema.users.oracleScore));
  const ratedCount = Number(rated?.n ?? 0);
  for (const q of qs) {
    const rows = await db
      .select({ answer: schema.predictions.answer, confidence: schema.predictions.confidence, oracleScore: schema.users.oracleScore })
      .from(schema.predictions)
      .innerJoin(schema.users, eq(schema.predictions.userId, schema.users.id))
      .where(eq(schema.predictions.questionId, q.id));
    const p = oracleForecast(rows.map((r) => ({ pYes: r.answer ? r.confidence / 100 : 1 - r.confidence / 100, oracleScore: r.oracleScore })), ratedCount);
    await db.update(schema.questions).set({ oracleProbYes: p === null ? null : String(p) }).where(eq(schema.questions.id, q.id));
  }
}

export async function lock(db: Db, date: string): Promise<void> {
  await stampForecasts(db, date);
  // ...existing two updates unchanged...
}
```

- [ ] **Step 4: Run suite**

Run: `pnpm --filter @oracle/api test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/actions.ts apps/api/test/pipeline-tick.test.ts
git commit -m "feat(api): the oracle foresees — skill-weighted forecast stamped on every question at lock"
```

---

### Task 5: The reveal carries receipts and the player's ledger

**Why:** "Trust is UI" (spec §6): the result receipt shows the source and the actual evidence; voids carry a one-line reason (spec §8). And the reveal must show streak + Oracle Score movement (spec §2 step 3) — the contract is in `RevealSchema` since Plan 1; this task serves it (audit §3.2, §3.3).

**Files:**
- Modify: `apps/api/src/routes/round.ts` (`/:date/reveal`)
- Test: `apps/api/test/resolve-reveal.test.ts`

**Interfaces:**
- Consumes: `evidenceSummary` (Plan 1 Task 7), `RevealSchema` (Plan 1 Task 5).
- Produces per question: `source_name`, `source_url`, `evidence_quote` (first quote or null), `void_reason` (`reason` or `"UNVERIFIABLE"` when outcome is void; null otherwise), `oracle_p_yes` (number|null). Top level: `ledger: { settled: round.status === "resolved", streak: users.streakCurrent, calls_rated: users.callsResolved, oracle_score: users.oracleScore }`.

- [ ] **Step 1: Failing tests**

`resolve-reveal.test.ts`:

```ts
  it("carries the source, the evidence quote, a void reason, the oracle's forecast, and the player's ledger", async () => {
    // seed + one player seals slot 1; resolve slot 1 yes with { quotes: [{ url: "u", quote: "Final 3-1" }] }; resolve slot 2 void with { reason: "postponed" }; resolve 3-5 yes; set questions[0].oracleProbYes = "0.61"
    // reveal (as the player) → q[0]: source_name "test", evidence_quote "Final 3-1", void_reason null, oracle_p_yes 0.61 ; q[1]: void_reason "postponed", evidence_quote null
    // ledger.settled false; then settleRound → ledger.settled true, ledger.streak 1, ledger.calls_rated 0 (incomplete), ledger.oracle_score null
  });
```

Write it fully with the file's helpers.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- resolve-reveal`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the reveal handler after `byQ`:

```ts
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    // ...
    return c.json({
      date,
      day_points: dayPoints(perQuestionPoints, allFirstHour),
      first_hour: allFirstHour,
      ledger: {
        settled: round?.status === "resolved",
        streak: user?.streakCurrent ?? 0,
        calls_rated: user?.callsResolved ?? 0,
        oracle_score: user?.oracleScore ?? null,
      },
      questions: qs.map((q) => {
        const p = byQ.get(q.id);
        const ev = evidenceSummary(q.resolutionEvidence);
        return {
          id: q.id, slot: q.slot, text: q.text, outcome: q.outcome,
          crowd_yes_pct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
          market_prob: q.marketProb === null ? null : Number(q.marketProb),
          oracle_p_yes: q.oracleProbYes === null ? null : Number(q.oracleProbYes),
          source_name: q.sourceName,
          source_url: q.sourceUrl,
          evidence_quote: ev.quote,
          void_reason: q.outcome === "void" ? (ev.reason ?? "UNVERIFIABLE") : null,
          my: p ? { answer: p.answer, confidence: p.confidence, points: p.points, brier: p.brier === null ? null : Number(p.brier) } : null,
        };
      }),
    });
```

Import `evidenceSummary` from `../resolution`.

- [ ] **Step 4: Run suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/resolve-reveal.test.ts
git commit -m "feat(api): the reveal shows its receipts — source, evidence, void reason, the oracle's forecast, and the player's ledger"
```

---

### Task 6: Evergreen draft bank — the drop never depends on the agent

**Why:** Tomorrow is authored at 17:00; if Claude is down from 17:00–23:00 you get a Telegram and must hand-author; if you're asleep, noon has no round and every streak lapses at the next settle (audit §2.3). Spec §6: "the drop must never depend on the agent being alive."

**Files:**
- Modify: `apps/api/src/pipeline/state.ts`, `src/pipeline/actions.ts`, `src/pipeline/index.ts`, `src/routes/admin.ts`, `src/routes/telegram.ts`
- Test: `apps/api/test/pipeline-decide.test.ts`, `test/pipeline-tick.test.ts`, `test/admin-rounds.test.ts`, `test/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `schema.draftBank` (Plan 1 Task 6), `DraftSchema`/`upsertDraft`, `publish`.
- Produces: `PipelineState.bankCount: number` (unused bank drafts); `Action` gains `{ kind: "publish-bank"; date: string }`.
- `decideActions`: emits `publish-bank` when `hour >= 12 && !scheduledDates.includes(today) && !openBlocksPublish && openRound?.date !== today && bankCount > 0`. The 12:10 "no round published" critical fires only when `bankCount === 0`. The 23:00 alert is `warn` "no draft for tomorrow — the bank covers noon (N left)" when `bankCount > 0`, `critical` (existing text) when 0.
- `publishFromBank(db, telegram, date): Promise<boolean>` — oldest unused bank entry → `upsertDraft` → mark `used_on = date` → `publish` → telegram `⚠ round ${date} published from the evergreen bank (${remaining} left)`. An entry failing `DraftSchema` is marked used (poisoned) with a telegram note and the next is tried on the next tick.
- Admin: `POST /admin/bank` (DraftSchema body; every `locks_at` must be null → else 400 `{ error: "bank drafts must not set locks_at" }`) → 201 `{ id }`; `GET /admin/bank` → `{ available: n, drafts: [{ id, created_at, used_on }] }`.
- Telegram `/status` adds a line `bank: N`.

- [ ] **Step 1: Failing tests**

`pipeline-decide.test.ts` — add `bankCount: 0` to `empty`; add:

```ts
  it("falls through to the bank at noon when nothing is scheduled for today", () => {
    expect(decideActions(at(12), { ...empty, bankCount: 2 })).toEqual([{ kind: "publish-bank", date: "2026-08-27" }]);
    expect(decideActions(at(12), { ...empty, bankCount: 2, scheduledDates: ["2026-08-27"] }).map((a) => a.kind)).toEqual(["publish"]);
    expect(decideActions(at(12), { ...empty, bankCount: 2, openRound: { date: "2026-08-27", lockPassed: false } })).toEqual([]);
    expect(decideActions(at(11, 50), { ...empty, bankCount: 2 })).toEqual([]);
  });
  it("the 12:10 critical only fires with an empty bank; 23:00 downgrades to warn with a bank", () => {
    expect(decideActions(at(12, 10), { ...empty, bankCount: 1 }).some((a) => a.kind === "alert")).toBe(false);
    const warn = decideActions(at(23, 0), { ...empty, bankCount: 3 }).find((a) => a.kind === "alert");
    expect(warn).toMatchObject({ level: "warn" });
    expect((warn as { message: string }).message).toContain("3 left");
  });
```

`pipeline-tick.test.ts`:

```ts
  it("noon with no draft publishes the oldest bank entry and marks it used", async () => {
    // insert two draftBank rows (validDraft) with createdAt 2026-08-20 and 2026-08-21
    // tick at 2026-08-27T16:00Z (no scheduled round) → executed contains "publish-bank:2026-08-27"
    // rounds 2026-08-27 status open with 5 open questions; the older bank row usedOn "2026-08-27", the newer still null
    // telegram sends include a string matching /published from the evergreen bank \(1 left\)/
  });
```

`admin-rounds.test.ts`: POST /admin/bank 201 with id; GET lists it with `available: 1`; POST with a non-null `locks_at` → 400.

`telegram-webhook.test.ts`: `/status` reply contains `bank: 0`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-decide pipeline-tick admin-rounds telegram-webhook`
Expected: FAIL.

- [ ] **Step 3: Implement**

`state.ts`:

```ts
export type Action =
  | { kind: "lock"; date: string }
  | { kind: "publish"; date: string }
  | { kind: "publish-bank"; date: string }
  // ...rest unchanged

export interface PipelineState {
  openRound: { date: string; lockPassed: boolean } | null;
  lockedRound: { date: string; unresolvedIds: string[] } | null;
  scheduledDates: string[];
  bankCount: number; // unused evergreen drafts (draft_bank.used_on IS NULL)
}

// loadPipelineState: add to the Promise.all
    db.select({ n: count() }).from(schema.draftBank).where(isNull(schema.draftBank.usedOn)),
// and return bankCount: Number(bankRow[0]?.n ?? 0)

// decideActions, after PUBLISH:
  // PUBLISH FROM THE BANK — noon with nothing scheduled for today: the drop
  // must never depend on the author having been awake (design spec §6).
  if (hour >= 12 && !state.scheduledDates.includes(today) && !openBlocksPublish && state.openRound?.date !== today && state.bankCount > 0) {
    actions.push({ kind: "publish-bank", date: today });
  }

// 23:00 alert:
  if (hour >= 23 && minute < 10 && !state.scheduledDates.includes(tomorrow)) {
    actions.push(state.bankCount > 0
      ? { kind: "alert", level: "warn", message: `no draft for tomorrow — the bank covers noon (${state.bankCount} left)` }
      : { kind: "alert", level: "critical", message: `no draft for tomorrow — seed manually: POST /admin/rounds/${tomorrow}` });
  }

// 12:10 alert: add `&& state.bankCount === 0` to its condition.
```

`actions.ts`:

```ts
import { asc, isNull } from "drizzle-orm";
import { DraftSchema, upsertDraft } from "./draft";

export async function publishFromBank(db: Db, telegram: TelegramClient, date: string): Promise<boolean> {
  const entry = await db.query.draftBank.findFirst({ where: isNull(schema.draftBank.usedOn), orderBy: [asc(schema.draftBank.createdAt)] });
  if (!entry) return false;
  const parsed = DraftSchema.safeParse(entry.draft);
  if (!parsed.success) {
    await db.update(schema.draftBank).set({ usedOn: date }).where(eq(schema.draftBank.id, entry.id)); // poison it, try the next one next tick
    await telegram.send(`⚠ bank draft ${entry.id} failed validation and was skipped`);
    return false;
  }
  await upsertDraft(db, date, parsed.data);
  await db.update(schema.draftBank).set({ usedOn: date }).where(eq(schema.draftBank.id, entry.id));
  const ok = await publish(db, telegram, date);
  const [left] = await db.select({ n: count() }).from(schema.draftBank).where(isNull(schema.draftBank.usedOn));
  await telegram.send(`⚠ round ${date} published from the evergreen bank (${Number(left?.n ?? 0)} left)`);
  return ok;
}
```

`index.ts` `runTick` switch:

```ts
        case "publish-bank": {
          const published = await publishFromBank(deps.db, deps.telegram, action.date);
          if (published) done.push(`publish-bank:${action.date}`);
          break;
        }
```

`admin.ts`:

```ts
  .post("/bank", async (c) => {
    const parsed = DraftSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid body" }, 400);
    if (parsed.data.questions.some((q) => q.locks_at !== null)) return c.json({ error: "bank drafts must not set locks_at" }, 400);
    const [row] = await c.get("deps").db.insert(schema.draftBank).values({ draft: parsed.data }).returning({ id: schema.draftBank.id });
    return c.json({ id: row!.id }, 201);
  })
  .get("/bank", async (c) => {
    const rows = await c.get("deps").db.query.draftBank.findMany({ orderBy: (b, { asc }) => [asc(b.createdAt)] });
    return c.json({
      available: rows.filter((r) => r.usedOn === null).length,
      drafts: rows.map((r) => ({ id: r.id, created_at: r.createdAt.toISOString(), used_on: r.usedOn })),
    });
  })
```

`telegram.ts` `/status`: add `` `bank: ${state.bankCount}` `` to `lines`.

- [ ] **Step 4: Run suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: PASS (every test that builds a `PipelineState` literal needs `bankCount: 0`).

- [ ] **Step 5: Seed the dev bank**

From `apps/api` with wrangler dev running: `curl -s -X POST localhost:8787/admin/bank -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' -d @../../docs/superpowers/plans/assets/bank-draft-example.json` — write that JSON file first: five date-agnostic questions (e.g. "Will the S&P 500 close higher tomorrow than today, per WSJ?", "Will Central Park's high tomorrow exceed its NWS forecast high?", …), `locks_at: null`, 4+ categories, Big One at slot 5, `author_probability` 0.4–0.6. Confirm `GET /admin/bank` → `available: 1`. Commit the example JSON under `docs/superpowers/plans/assets/`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/state.ts apps/api/src/pipeline/actions.ts apps/api/src/pipeline/index.ts apps/api/src/routes/admin.ts apps/api/src/routes/telegram.ts apps/api/test/pipeline-decide.test.ts apps/api/test/pipeline-tick.test.ts apps/api/test/admin-rounds.test.ts apps/api/test/telegram-webhook.test.ts docs/superpowers/plans/assets/bank-draft-example.json
git commit -m "feat(api): evergreen draft bank — noon falls through to a banked round when nothing is scheduled"
```

---

### Task 7: Twenty-four hours before a void; hourly retries

**Why:** Anything unresolved 60 minutes after lock is voided (audit §2.6). Spec §8: "reveal can be late but never wrong." A rate-limited source now zeroes a slot; a voided Big One wipes the day's headline. Give resolution a day, retrying hourly, and say so in the void reason.

**Files:**
- Modify: `apps/api/src/pipeline/state.ts` (`decideActions`), `src/pipeline/actions.ts` (`voidQuestions` reason text)
- Test: `apps/api/test/pipeline-decide.test.ts`, `test/pipeline-tick.test.ts`

**Interfaces:**
- `decideActions` for a locked round with unresolved questions: `voidDay = addDays(lockedRound.date, 2)`; **void** when `today > voidDay || (today === voidDay && hour >= 12)`; otherwise **resolve** when `hour === 12 || minute < 10` (every tick in the noon hour, hourly after); otherwise nothing.
- The "locked but unsettled" alert becomes `warn`, message `round ${date} still has unresolved questions — retrying hourly, voids at noon ${voidDay}`; throttle unchanged (minute 30–40, hour ≥ 13).
- `voidQuestions` reason: `"unverifiable within 24 hours of lock"`; telegram text updated to match.

- [ ] **Step 1: Failing tests**

Replace "resolves unresolved questions before 13:00 and voids after" in `pipeline-decide.test.ts`:

```ts
  it("retries resolution every tick in the noon hour, hourly after, and voids at noon the next day", () => {
    const st: PipelineState = { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a", "b"] } };
    const resolve = { kind: "resolve", date: "2026-08-26", questionIds: ["a", "b"] };
    expect(decideActions(at(12, 20), st)).toEqual([resolve]);          // noon hour: every tick
    expect(decideActions(at(13, 0), st)).toEqual([resolve]);           // hourly at :00
    expect(decideActions(at(13, 20), st)).toEqual([]);                 // throttled
    expect(decideActions(at(15, 5), st)).toEqual([resolve]);
    expect(decideActions({ date: "2026-08-28", hour: 11, minute: 50 }, st)).toEqual([]);
    expect(decideActions({ date: "2026-08-28", hour: 12, minute: 0 }, st)).toEqual([{ kind: "void", date: "2026-08-26", questionIds: ["a", "b"] }]);
  });
  it("warns (not criticals) hourly while a round is unresolved past the noon hour", () => {
    const acts = decideActions(at(13, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a"] } });
    expect(acts.filter((a) => a.kind === "alert")).toEqual([expect.objectContaining({ level: "warn" })]);
  });
```

`pipeline-tick.test.ts`: any test that expects a void at 13:00 D+1 moves to 12:00 D+2 and asserts the evidence `reason` is `"unverifiable within 24 hours of lock"`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test -- pipeline-decide pipeline-tick`
Expected: FAIL.

- [ ] **Step 3: Implement**

`state.ts` — replace the RESOLVE/VOID/SETTLE block:

```ts
  // RESOLVE / VOID / SETTLE on the locked round. Late, never wrong (design
  // §8): a question gets a full day of hourly retries before it voids.
  if (state.lockedRound) {
    const { date: lockedDate, unresolvedIds } = state.lockedRound;
    if (unresolvedIds.length > 0) {
      const voidDay = addDays(lockedDate, 2); // locked at noon D+1 → voids at noon D+2
      const pastGrace = today > voidDay || (today === voidDay && hour >= 12);
      if (pastGrace) {
        actions.push({ kind: "void", date: lockedDate, questionIds: unresolvedIds });
      } else if (hour === 12 || minute < 10) {
        actions.push({ kind: "resolve", date: lockedDate, questionIds: unresolvedIds });
      }
    } else {
      actions.push({ kind: "settle", date: lockedDate });
    }
  }

  // alert (replace the 13:30 critical):
  if (state.lockedRound && state.lockedRound.unresolvedIds.length > 0 && hour >= 13 && minute >= 30 && minute < 40) {
    actions.push({ kind: "alert", level: "warn", message: `round ${state.lockedRound.date} still has unresolved questions — retrying hourly, voids at noon ${addDays(state.lockedRound.date, 2)}` });
  }
```

Note the old alert also fired for a locked round with zero unresolved (settle pending) — that case now settles on the same tick, so the alert is scoped to unresolved only.

`actions.ts` `voidQuestions`: reason `"unverifiable within 24 hours of lock"`; telegram `⚠ voided unresolved questions (unverifiable within 24 hours of lock):`.

- [ ] **Step 4: Run suite + typecheck**

Run: `pnpm --filter @oracle/api test && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/state.ts apps/api/src/pipeline/actions.ts apps/api/test/pipeline-decide.test.ts apps/api/test/pipeline-tick.test.ts
git commit -m "feat(api): late but never wrong — a day of hourly resolution retries before a void"
```

---

## Self-review

- **Spec coverage:** audit §2.1 ✅ Plan 1; §2.2 (Task 2); §2.3 (Task 6); §2.4 (Task 1); §2.5 partially — `/flip` shipped in Plan 1, a pre-publish `/hold` is deliberately not built (the bank + reroll cover the pre-noon window; a hold flag adds state for little gain); §2.6 (Task 7); §2.7 (Task 3); §2.8 forecast (Task 4), entitlements/identity are third-party-gated (out of scope), indexes ✅ Plan 1; §3.3/§3.2 server half (Task 5); §3.4 SLEEPS hole server half (Task 1 `/next`).
- **Type consistency:** `openRound(db, now)` internal only; `stampForecasts(db, date)` Task 4 only; `publishFromBank(db, telegram, date)` Task 6 → `runTick`; `PipelineState.bankCount` Task 6 → every state literal in tests; `Action "publish-bank"` Task 6; `DraftQuestionSchema.locks_at` Task 3 → Task 6's bank validation; `evidenceSummary` from Plan 1 → Task 5.
- **Placeholders:** Tasks 4, 5, 6 describe two tests in prose because they must reuse per-file harness helpers (`player`, submit builders, recording telegram); every assertion and fixture value is stated exactly so the executor writes them in the file's style.
