# The Night Shift, Plan 2 of 3: Build 14 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship everything the player sees of the night shift: AGREE and DISAGREE on the card, the channel after the seal and on the reveal, Home's shift clock and last-night line, the share card's log excerpt, the record's room rows, and the copy sweep from questions to statements.

**Architecture:** Plan 1 built the channel as data (`buildLog`, `GET /v1/round/today/log`, the reveal's `reactions` and `lessons`). This plan renders it. Every string and every ordering decision lives in a pure module under `apps/mobile/src/game/`, tested in Node by Vitest; screens and components only render what those modules return. Three small additive API changes ride along (three reveal fields and the ledger's `room` block) because the screens cannot be built without them.

**Tech Stack:** TypeScript, Expo SDK 57, React Native 0.86, Reanimated 4, Skia 2.6, TanStack Query 5, Zustand 5, Zod 4, Vitest 4; Hono, Drizzle and PGlite on the API side.

**Spec:** `docs/superpowers/specs/2026-09-25-nightshift-design.md`. Read it first; §6, §7, §12, §13 are this plan, and §17 records what plan 1 changed. The spec calls this release "build 13"; build 13 was spent on the plan 1 merge (it carries no night-shift UI), so this release is **build 14**.

## Global Constraints

- Rules stay at version 3. Storage words are `yes` and `no` (`predictions.answer` true is agree). The player never sees YES or NO on a crowd question.
- Every crowd-round string keys on the question's `crowd` flag. Nothing keys on `source_name`.
- Nothing about the room or the machines shows before the seal. The channel for a take is read only from `GET /v1/round/today/log`, which serves sealed questions only. Build 14 never reads `line_p_yes` from `GET /v1/round/today`.
- Persona text inside the channel is model output, shown as written, never linted, never uppercased. Everything the app itself says is linted.
- Two registers (`apps/mobile/test/typeRegister.test.ts`): tracked caps for what is recognised, sentence case for what is read. Never write `<Mono size={n}>` without `letterSpacing`; spread a `role` from `ui/Text` instead. Never put a caps literal inside `role.supporting` or `role.reading`.
- The vocabulary lint (`apps/mobile/test/vocabulary.test.ts`) scans every string literal and template literal that contains a space, and every JSX text node, for the retired words `vigil`, `shield`, `exhibition`, `rite`, `ledger`, `crowd`, `conviction`, `epithet`, `confidence`, `calibration`, `rung`, `ladder`. **A template literal that interpolates `q.crowd` fails it.** In mobile code, read the flag into a local named `room` (`const room = q.crowd;`) before any template literal, and never write the word in a player-facing or accessibility string. Say "the room" or "the players".
- Skia text has no font fallback. Text drawn on the share card is printable ASCII plus the middle dot `·`, nothing else.
- Mobile tests are Node tests of pure modules (`apps/mobile/vitest.config.ts` includes `test/**/*.test.ts` only). There are no component tests. Logic goes in `src/game/*.ts` with a test; components stay thin and are verified by `pnpm typecheck`, the lints, and the simulator pass in Task 13.
- Before writing any Expo or React Native code, read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ (`apps/mobile/AGENTS.md`).
- Never stage a broad path. `apps/site/app.json` is untracked in the working tree and is not part of this plan; `git add` only the files each task names.
- The API suite takes about 6.5 minutes on one worker. A bare 5000ms timeout in it is contention, not a defect; re-run the file alone. Run single files while iterating and the whole suite once per API task, in the foreground.
- Commit after every task. End every commit message with the line `Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske`.
- Work on a branch named `nightshift-build-14`, cut from `main`.

---

## File Structure

**Core (`packages/core`)**
- `src/schemas.ts` — the reveal question gains `crowd`, `resolved_at`; the reveal's `my` gains `sealed_at`; `MeLedgerSchema` gains `room` (Task 1).
- `src/council.ts` — `roomRecord`, `ROOM_WINDOW_DAYS` (Task 1).
- `src/copy.ts`, `src/gameCopy.ts` — intro lines, "The game" claims, the opponent challenge (Task 3).
- `test/council.test.ts`, `test/schemas-nightshift.test.ts`, `test/rites-terms.test.ts`, `test/reading-register.test.ts` — extended.

**API (`apps/api`)**
- `src/routes/round.ts` — the three reveal fields (Task 2); `line_p_yes` leaves `/today` (Task 15, gated).
- `src/routes/me.ts` — the `room` block (Task 2).
- `test/reveal-nightshift.test.ts` — new. `test/ledger.test.ts` — extended.

**Mobile (`apps/mobile/src`)**
- `game/sideWords.ts` — new. The one place a side becomes a word (Task 4).
- `game/stakeText.ts`, `game/crowdVerdict.ts`, `game/crowdMovement.ts`, `game/revealFortune.ts`, `game/shareLines.ts`, `game/practiceResult.ts` — take a `room` flag (Task 4).
- `game/cardCaption.ts` — new. The card's coordinate line and modifiers (Task 5).
- `ui/OracleCard.tsx` — buttons, caption, UNHINGED, no line (Task 5).
- `game/channel.ts` — new. The core builder re-exported, plus everything the channel prints: the ET clock, nicks, print lines, the summary row, the reveal's log (Task 6).
- `game/todayLog.ts` — new. Indexes the log route's payload by question (Task 6).
- `ui/ChannelLog.tsx` — new. The mono block (Task 6).
- `ui/DecodeText.tsx` — `DecodeLine` gains `prefix` (Task 6).
- `api/hooks.ts` — `useTodayLog` (Task 6).
- `game/doubleTray.ts`, `ui/DoubleTray.tsx`, `ui/CrowdReveal.tsx`, `app/round.tsx` — the log after the seal, the tray priced from the log, the finale's summary rows (Task 7).
- `app/reveal/[date].tsx` — the channel replaces the Council split on crowd questions (Task 8).
- `game/shiftLine.ts`, `game/lastNight.ts` — new. `app/index.tsx` — shift clock, last night, house line out. `game/houseLine.ts` and its test — deleted (Task 9).
- `game/shareExcerpt.ts` — new. `ui/ShareCard.tsx` — the excerpt (Task 10).
- `game/roomRecord.ts` — new. `app/ledger.tsx` — the room rows (Task 11).
- `ui/PracticeCard.tsx` — the channel after the result (Task 12).
- `analytics/analytics.ts` — `log_opened`, `channel_expanded` in; `house_headline_viewed` out (Tasks 6, 9).

**Out of this plan (plan 3):** `GET /v1/board/room`, the money screen's board, `useAllTimeBoard`'s retirement, the rules' "all-time board" claim, the site and standings page copy, `room_board_viewed`. The reveal's board block is untouched here.

---

### Task 1: Core — the wire additions and the room record

**Files:**
- Modify: `packages/core/src/schemas.ts` (the `RevealSchema` question object and its `my`; `MeLedgerSchema`)
- Modify: `packages/core/src/council.ts` (append after `readRate`)
- Test: `packages/core/test/schemas-nightshift.test.ts`, `packages/core/test/council.test.ts`

**Interfaces:**
- Consumes: `onRightSide(p: number, outcome: Outcome | null): boolean | null` and `readRate(calls)` from `council.ts`.
- Produces:
  - `Reveal["questions"][number]` gains `crowd: boolean`, `resolved_at: string | null`; its `my` gains `sealed_at: string | null`.
  - `MeLedger["room"]: { days: number; days_read: number; days_machines_missed: number; read_rate_30d: number | null; calls_30d: number } | null`.
  - `roomRecord(calls: ReadonlyArray<RoomCall>, now: number): RoomRecord`, `interface RoomCall { date: string; answer: boolean; line: number | null; outcome: "yes" | "no"; lockedAt: number }`, `ROOM_WINDOW_DAYS = 30`.

- [ ] **Step 1: Write the failing schema tests**

Append inside the `describe` in `packages/core/test/schemas-nightshift.test.ts`, and add `MeLedgerSchema` to the import from `"../src"`:

```ts
  it("a reveal question says whether it was a hot take, when it resolved, and when the caller sealed", () => {
    const Question = RevealSchema.shape.questions.element;
    const bare = { id: qid, slot: 1, text: "cereal is a soup", outcome: null, crowd_yes_pct: null, crowd_count: null, market_prob: null, source_name: "THE PLAYERS", source_url: null, evidence_quote: null, void_reason: null, oracle_p_yes: null };
    const my = { answer: true, confidence: 75, points: null, brier: null };
    expect(Question.parse({ ...bare, my: null })).toMatchObject({ crowd: false, resolved_at: null });
    expect(Question.parse({ ...bare, my }).my!.sealed_at).toBeNull();
    const full = Question.parse({ ...bare, crowd: true, resolved_at: "2026-09-26T16:01:00.000Z", my: { ...my, sealed_at: "2026-09-25T16:14:00.000Z" } });
    expect(full).toMatchObject({ crowd: true, resolved_at: "2026-09-26T16:01:00.000Z" });
    expect(full.my!.sealed_at).toBe("2026-09-25T16:14:00.000Z");
  });
  it("the record's room block defaults to null for an older server", () => {
    const Room = MeLedgerSchema.shape.room;
    expect(Room.parse(undefined)).toBeNull();
    expect(Room.parse({ days: 9, days_read: 6, days_machines_missed: 3, read_rate_30d: null, calls_30d: 12 })).toMatchObject({ days: 9, read_rate_30d: null });
    expect(() => Room.parse({ days: 9, days_read: 6, days_machines_missed: 3, read_rate_30d: 1.2, calls_30d: 12 })).toThrow();
  });
```

- [ ] **Step 2: Write the failing room record tests**

Append to `packages/core/test/council.test.ts`, adding `roomRecord, ROOM_WINDOW_DAYS` to the import from `"../src/council"`:

```ts
describe("the room record (design 2026-09-25 §6.4)", () => {
  const NOW = Date.parse("2026-09-28T16:00:00Z");
  const DAY = 86_400_000;
  const call = (date: string, answer: boolean, line: number | null, outcome: "yes" | "no", daysAgo = 1) => ({ date, answer, line, outcome, lockedAt: NOW - daysAgo * DAY });

  it("is empty with no settled calls", () => {
    expect(roomRecord([], NOW)).toEqual({ days: 0, days_read: 0, days_machines_missed: 0, read_rate_30d: null, calls_30d: 0 });
  });
  it("counts a day as read when the caller was with the room on more calls than against", () => {
    const r = roomRecord([
      call("2026-09-25", true, 0.7, "yes"), call("2026-09-25", true, 0.7, "yes"), call("2026-09-25", true, 0.7, "no"),
      call("2026-09-26", true, 0.7, "no"), call("2026-09-26", false, 0.7, "yes"),
      // Level is not read: one with, one against.
      call("2026-09-27", true, 0.7, "yes"), call("2026-09-27", true, 0.7, "no"),
    ], NOW);
    expect(r).toMatchObject({ days: 3, days_read: 1 });
  });
  it("counts a day the machines missed when the line was on the wrong side more often than the right", () => {
    const r = roomRecord([
      call("2026-09-25", true, 0.3, "yes"), call("2026-09-25", true, 0.3, "yes"), call("2026-09-25", true, 0.7, "yes"),
      call("2026-09-26", true, 0.7, "yes"),
      // A 0.5 line and a missing line are on neither side.
      call("2026-09-27", true, 0.5, "yes"), call("2026-09-27", true, null, "yes"),
    ], NOW);
    expect(r).toMatchObject({ days: 3, days_machines_missed: 1 });
  });
  it("rates the last thirty days only, and only from twenty-five calls", () => {
    expect(ROOM_WINDOW_DAYS).toBe(30);
    const recent = Array.from({ length: 25 }, (_, i) => call(`2026-09-${String(1 + (i % 25)).padStart(2, "0")}`, true, 0.7, i < 20 ? "yes" : "no", 5));
    const old = Array.from({ length: 10 }, () => call("2026-08-01", true, 0.7, "no", 45));
    const r = roomRecord([...recent, ...old], NOW);
    expect(r.calls_30d).toBe(25);
    expect(r.read_rate_30d).toBeCloseTo(20 / 25, 6);
    expect(roomRecord(recent.slice(0, 24), NOW).read_rate_30d).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/core && pnpm vitest run test/schemas-nightshift.test.ts test/council.test.ts`
Expected: FAIL. The schema test fails on `crowd` being undefined and `MeLedgerSchema.shape.room` being undefined; the council test fails with `roomRecord is not a function`.

- [ ] **Step 4: Add the schema fields**

In `packages/core/src/schemas.ts`, inside `RevealSchema`'s question object, add after `unhinged: z.boolean().default(false),`:

```ts
      // A hot take (design 2026-09-25 §7): the reveal keys agree and disagree
      // on this, never on source_name. Defaulted for an older server.
      crowd: z.boolean().default(false),
      // When the room's verdict landed; the channel's system line prints at it.
      resolved_at: z.string().nullable().default(null),
```

Inside the same question's `my` object, add after `doubled: z.boolean().default(false),`:

```ts
          // When the caller sealed (design 2026-09-25 §6.6): the share card's
          // `<you>` line carries it.
          sealed_at: z.string().nullable().default(null),
```

In `MeLedgerSchema`, add after the `house` field:

```ts
  // Reading the room (design 2026-09-25 §6.4), over the caller's settled hot
  // takes. `days` is the denominator both counts are out of. Null from a
  // server that predates it.
  room: z
    .object({
      days: z.number().int().min(0),
      days_read: z.number().int().min(0),
      days_machines_missed: z.number().int().min(0),
      read_rate_30d: z.number().min(0).max(1).nullable(),
      calls_30d: z.number().int().min(0),
    })
    .nullable()
    .default(null),
```

- [ ] **Step 5: Add `roomRecord`**

Append to `packages/core/src/council.ts`:

```ts
// The record's room rows (design 2026-09-25 §6.4). A day is read when the
// caller landed with the room on more calls than against; the machines missed
// a day when the line sat on the wrong side of the majority more often than
// the right, over the same days. A 0.5 line, and a call with no line, are on
// neither side. The rate is the read rate over the last thirty days.
export const ROOM_WINDOW_DAYS = 30;

export interface RoomCall { date: string; answer: boolean; line: number | null; outcome: "yes" | "no"; lockedAt: number }
export interface RoomRecord { days: number; days_read: number; days_machines_missed: number; read_rate_30d: number | null; calls_30d: number }

export function roomRecord(calls: ReadonlyArray<RoomCall>, now: number): RoomRecord {
  const byDate = new Map<string, RoomCall[]>();
  for (const c of calls) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  let daysRead = 0;
  let daysMissed = 0;
  for (const day of byDate.values()) {
    const withRoom = day.filter((c) => c.answer === (c.outcome === "yes")).length;
    if (withRoom > day.length - withRoom) daysRead += 1;
    const sides = day.map((c) => (c.line === null ? null : onRightSide(c.line, c.outcome)));
    if (sides.filter((s) => s === false).length > sides.filter((s) => s === true).length) daysMissed += 1;
  }
  const since = now - ROOM_WINDOW_DAYS * 86_400_000;
  const recent = calls.filter((c) => c.lockedAt >= since);
  return {
    days: byDate.size,
    days_read: daysRead,
    days_machines_missed: daysMissed,
    read_rate_30d: readRate(recent.map((c) => ({ p: c.answer ? 1 : 0, outcome: c.outcome }))),
    calls_30d: recent.length,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/core && pnpm vitest run && pnpm typecheck`
Expected: PASS, whole core suite green.

- [ ] **Step 7: Fix the mobile fixtures the new fields break**

The mobile tests build `Reveal` questions by hand, and `crowd`, `resolved_at` and `sealed_at` are now required on the inferred type. Run `cd apps/mobile && pnpm typecheck` and add the three fields to each fixture it names. The known ones:

- `apps/mobile/test/revealFortune.test.ts`: in `q`, add `crowd: false, resolved_at: null,` after `seen_on: null, unhinged: false,`; in the `my` default add `sealed_at: null,`.
- `apps/mobile/test/council.test.ts`: in `reveal`'s question add `crowd: false, resolved_at: null`.
- `apps/mobile/test/revealRows.test.ts`: in `question`, add `crowd: false, resolved_at: null,` after `unhinged: false,`, and `sealed_at: null` to the default `my` and to every `my` literal the file's tests pass as an override.
- Any other fixture `pnpm typecheck` reports (`revealSummary.test.ts`, `rivalryMoment.test.ts`, `dailyBoard.test.ts`, `revealLearning.test.ts`): the same two question fields and, where `my` is an object, `sealed_at: null`.

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/council.ts packages/core/test/schemas-nightshift.test.ts packages/core/test/council.test.ts apps/mobile/test
git commit -m "feat(core): the reveal's room fields and the room record

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 2: API — the reveal's three fields and the ledger's room block

**Files:**
- Modify: `apps/api/src/routes/round.ts` (the `/:date/reveal` handler's `questions` map)
- Modify: `apps/api/src/routes/me.ts`
- Create: `apps/api/test/reveal-nightshift.test.ts`
- Test: `apps/api/test/ledger.test.ts`

**Interfaces:**
- Consumes: `roomRecord`, `RoomCall` from `@oracle/core` (Task 1).
- Produces: `GET /v1/round/:date/reveal` questions carry `crowd`, `resolved_at`, `my.sealed_at`; `GET /v1/me/ledger` carries `room`.

- [ ] **Step 1: Write the failing reveal test**

Create `apps/api/test/reveal-nightshift.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { RevealSchema } from "@oracle/core";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-25";
afterEach(() => vi.useRealTimers());

async function world() {
  vi.useFakeTimers({ now: new Date("2026-09-25T17:00:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
  // Slot 1 is a hot take; the rest stay market questions.
  await db.update(schema.questions).set({ marketSource: "crowd", sourceName: "THE PLAYERS", linePYes: "0.38" }).where(eq(schema.questions.id, qs[0]!.id));
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const as = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const seal = (qid: string, answer: boolean) => as("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence: 75, idempotency_key: `k-${qid}` }) });
  return { db, qs, as, seal };
}

describe("the reveal's room fields (design 2026-09-25 §6.3, §6.6)", () => {
  it("marks a hot take, stamps when the room answered, and stamps when the caller sealed", async () => {
    const { db, qs, as, seal } = await world();
    expect((await seal(qs[0]!.id, true)).status).toBe(200);
    vi.setSystemTime(new Date("2026-09-26T16:05:00Z"));
    await db.update(schema.questions).set({ status: "resolved", outcome: "yes", resolvedAt: new Date("2026-09-26T16:01:00Z"), crowdYesPct: "62", crowdCount: 41 }).where(eq(schema.questions.id, qs[0]!.id));
    const r = RevealSchema.parse(await (await as(`/v1/round/${DATE}/reveal`)).json());
    const first = r.questions.find((q) => q.slot === 1)!;
    expect(first).toMatchObject({ crowd: true, resolved_at: "2026-09-26T16:01:00.000Z" });
    // created_at is the database's own clock, which fake timers do not move,
    // so the assertion is on the shape rather than the instant.
    expect(first.my!.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const second = r.questions.find((q) => q.slot === 2)!;
    expect(second).toMatchObject({ crowd: false, resolved_at: null, my: null });
  });
});
```

- [ ] **Step 2: Write the failing ledger test**

Append inside the `describe("GET /v1/me/ledger", ...)` in `apps/api/test/ledger.test.ts`:

```ts
  it("reports the room block over the caller's settled hot takes (design 2026-09-25 §6.4)", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    // Slots 1 to 3 are hot takes with the line at 30%; slot 4 stays a market question.
    for (const q of qs.slice(0, 3)) await db.update(schema.questions).set({ marketSource: "crowd", sourceName: "THE PLAYERS", linePYes: "0.30" }).where(eq(schema.questions.id, q.id));
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await a("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await a("/v1/predictions", { method: "POST", body: body(qs[2]!.id, false) });
    await a("/v1/predictions", { method: "POST", body: body(qs[3]!.id, true) });
    for (const q of qs.slice(0, 4)) await resolveQuestion(db, q.id, "yes");

    const out = MeLedgerSchema.parse(await (await a("/v1/me/ledger")).json());
    // With the room on two of three; the 30% line was on the wrong side of
    // all three; the market question counts toward neither.
    expect(out.room).toEqual({ days: 1, days_read: 1, days_machines_missed: 1, read_rate_30d: null, calls_30d: 3 });

    const b = await player(app);
    expect(MeLedgerSchema.parse(await (await b("/v1/me/ledger")).json()).room).toEqual({ days: 0, days_read: 0, days_machines_missed: 0, read_rate_30d: null, calls_30d: 0 });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run test/reveal-nightshift.test.ts test/ledger.test.ts`
Expected: FAIL. The reveal test fails with `crowd: false` received where `true` was expected; the ledger test fails with `room` received as `null`.

- [ ] **Step 4: Serve the reveal fields**

In `apps/api/src/routes/round.ts`, in the `/:date/reveal` handler's `questions: qs.map((q) => { ... })`, add to the `my` object after `doubled: p.doubled,`:

```ts
                // When the caller sealed (design 2026-09-25 §6.6).
                sealed_at: p.createdAt.toISOString(),
```

and add to the question object after `unhinged: q.unhinged,`:

```ts
          crowd: q.marketSource === "crowd",
          resolved_at: q.resolvedAt === null ? null : q.resolvedAt.toISOString(),
```

- [ ] **Step 5: Serve the room block**

In `apps/api/src/routes/me.ts`, add `roomRecord` to the import from `@oracle/core`. After the `const win = stats(resolved.filter((r) => r.inWindow));` line, add:

```ts
    // Reading the room (design 2026-09-25 §6.4): the caller's settled hot
    // takes, against the line the machines posted on each.
    const roomCalls = preds.flatMap((p) => {
      const q = qById.get(p.questionId);
      if (!q || q.marketSource !== "crowd" || (q.outcome !== "yes" && q.outcome !== "no")) return [];
      return [{ date: q.roundDate, answer: p.answer, line: q.linePYes === null ? null : Number(q.linePYes), outcome: q.outcome as "yes" | "no", lockedAt: q.locksAt.getTime() }];
    });
```

In the `c.json({ ... })` at the end, add after `house,`:

```ts
      room: roomRecord(roomCalls, Date.now()),
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd apps/api && pnpm vitest run test/reveal-nightshift.test.ts test/ledger.test.ts test/reveal-council.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole API suite and typecheck, in the foreground**

Run: `cd apps/api && pnpm typecheck && pnpm vitest run`
Expected: PASS, about 6.5 minutes. Record the count (818 before this task, 820 after).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/src/routes/me.ts apps/api/test/reveal-nightshift.test.ts apps/api/test/ledger.test.ts
git commit -m "feat(api): the reveal's room fields and the record's room block

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 3: Core copy — statements, not questions

**Files:**
- Modify: `packages/core/src/copy.ts` (`INTRO_LINES`, the first rite in `RITES_V2_SECTIONS`)
- Modify: `packages/core/src/gameCopy.ts` (`opponentChallenge`)
- Test: `packages/core/test/rites-terms.test.ts`, `packages/core/test/reading-register.test.ts`

**Interfaces:**
- Produces: the same exports with new text. `INTRO_LINES` stays three lines; "The game" grows from seven claims to eight.

- [ ] **Step 1: Rewrite the pinned expectations**

In `packages/core/test/rites-terms.test.ts`, replace the body of `it("opens on the room, and settles on the players' majority", ...)` with:

```ts
    expect(INTRO_LINES).toEqual([
      "Five hot takes a day. Three machines have already guessed what the room will say.",
      "Swipe right to agree, left to disagree. Nothing about the room shows until you seal.",
      "You win when you land with the majority. After your fifth seal, read the channel and place your double.",
    ]);
    const game = RITES_V2_SECTIONS.find((s) => s.title === "The game")!;
    expect(game.claims).toHaveLength(8);
    expect(game.claims[0]).toBe("Five hot takes a day. Each is a statement, and the answer is whatever most of the players say.");
    expect(game.claims[1]).toBe("On every take the Oracle posts its line: the share of the room it expects to agree. You see it once you seal.");
    expect(game.claims[2]).toBe("Swipe right to agree or left to disagree; the swipe is the seal.");
    expect(game.claims[3]).toBe("After each seal you can read what the machines guessed and why. They cannot read you.");
    expect(game.claims[5]).toBe("A call with the majority wins the stake at the Oracle's odds; a call against it loses the stake.");
    const results = RITES_V2_SECTIONS.find((s) => s.title === "Results and the board")!;
    expect(results.claims[0]).toBe("Questions settle on the players' majority at lock.");
    const timing = RITES_V2_SECTIONS.find((s) => s.title === "Timing and fairness")!;
    expect(timing.claims[1]).toBe("Results land at the next noon, when the round locks.");
    expect(CURRENT_GAME_COPY.opponentChallenge).toBe("Can you read the room before they do?");
```

In `packages/core/test/reading-register.test.ts`, change the acronym list to:

```ts
const ACRONYMS = ["AI", "YES", "NO", "AGREE", "DISAGREE"];
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/core && pnpm vitest run test/rites-terms.test.ts`
Expected: FAIL on the first `INTRO_LINES` line.

- [ ] **Step 3: Rewrite the copy**

In `packages/core/src/copy.ts`, replace `INTRO_LINES` with:

```ts
export const INTRO_LINES = [
  "Five hot takes a day. Three machines have already guessed what the room will say.",
  "Swipe right to agree, left to disagree. Nothing about the room shows until you seal.",
  "You win when you land with the majority. After your fifth seal, read the channel and place your double.",
] as const;
```

In `RITES_V2_SECTIONS`, replace the first three claims of `rite("The game", ...)` and insert the fourth, leaving the rest as they are:

```ts
    "Five hot takes a day. Each is a statement, and the answer is whatever most of the players say.",
    "On every take the Oracle posts its line: the share of the room it expects to agree. You see it once you seal.",
    "Swipe right to agree or left to disagree; the swipe is the seal.",
    "After each seal you can read what the machines guessed and why. They cannot read you.",
```

In `packages/core/src/gameCopy.ts`:

```ts
  opponentChallenge: 'Can you read the room before they do?',
```

- [ ] **Step 4: Run the core suite**

Run: `cd packages/core && pnpm vitest run && pnpm typecheck`
Expected: PASS. `vocabulary.test.ts`'s "names the money words" still finds `line`, `stake`, `fortune`, `big one` and `double` in the rules; `reading-register.test.ts`'s "teaches the swipe, the seal, the room and the double" still finds all four in the intro. If `copy-lint.test.ts` pins an intro or rite string, update the pin to the new text; do not loosen a rule.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/copy.ts packages/core/src/gameCopy.ts packages/core/test/rites-terms.test.ts packages/core/test/reading-register.test.ts
git commit -m "feat(core): the rules speak in statements, agree and disagree

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 4: Mobile — the side words

**Files:**
- Create: `apps/mobile/src/game/sideWords.ts`
- Modify: `apps/mobile/src/game/stakeText.ts`, `apps/mobile/src/game/crowdVerdict.ts`, `apps/mobile/src/game/crowdMovement.ts`, `apps/mobile/src/game/revealFortune.ts`, `apps/mobile/src/game/shareLines.ts`, `apps/mobile/src/game/practiceResult.ts`
- Create: `apps/mobile/test/sideWords.test.ts`
- Test: `apps/mobile/test/stakeText.test.ts`, `crowdVerdict.test.ts`, `crowdMovement.test.ts`, `revealFortune.test.ts`, `shareLines.test.ts`, `practiceResult.test.ts`

**Interfaces:**
- Produces (every `room` parameter defaults to `false`, so every existing call site and test keeps its meaning):
  - `sideWord(answer: boolean, room: boolean): string` — `AGREE` / `DISAGREE` / `YES` / `NO`
  - `outcomeWord(outcome: "yes" | "no", room: boolean): string` — `AGREED` / `DISAGREED` / `YES` / `NO`
  - `shareSoFar(pct: number, room: boolean): string` — `62% AGREE` / `62% SAY YES`
  - `lineLabel(line: number | null, room?: boolean): string | null`
  - `SWIPE_HINT_ROOM`, `sealHint(reducedMotion: boolean, room?: boolean): string`
  - `receiptLine(input: { answer: boolean; line: number | null; doubled?: boolean; room?: boolean }): string`
  - `crowdCallLine(input: { answer: boolean; line: number | null; doubled: boolean; room?: boolean }): string`
  - `crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number, room?: boolean): { line: string; against: boolean }`
  - `crowdMovement(atSeal, now, final: boolean, room?: boolean): string | null`
  - `roomVerdict(q: Reveal["questions"][number]): string | null` in `revealFortune.ts`
  - `shareBigOneLine(input: { line; answer; stake; delta; room?: boolean }): string | null`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/sideWords.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sideWord, outcomeWord, shareSoFar } from "../src/game/sideWords";

describe("the side words (design 2026-09-25 N1, §7)", () => {
  it("agrees and disagrees on a hot take, and keeps yes and no on a market question", () => {
    expect(sideWord(true, true)).toBe("AGREE");
    expect(sideWord(false, true)).toBe("DISAGREE");
    expect(sideWord(true, false)).toBe("YES");
    expect(sideWord(false, false)).toBe("NO");
  });
  it("names the outcome in the past tense on a hot take", () => {
    expect(outcomeWord("yes", true)).toBe("AGREED");
    expect(outcomeWord("no", true)).toBe("DISAGREED");
    expect(outcomeWord("yes", false)).toBe("YES");
    expect(outcomeWord("no", false)).toBe("NO");
  });
  it("prints the share so far", () => {
    expect(shareSoFar(62, true)).toBe("62% AGREE");
    expect(shareSoFar(62, false)).toBe("62% SAY YES");
  });
});
```

Append to `apps/mobile/test/stakeText.test.ts` (add `SWIPE_HINT_ROOM` to the import):

```ts
describe("the card's text on a hot take (design 2026-09-25 §7)", () => {
  it("expects a share to agree", () => {
    expect(lineLabel(0.38, true)).toBe("THE ORACLE EXPECTED 38% TO AGREE");
    expect(lineLabel(null, true)).toBeNull();
  });
  it("writes the receipt in agree and disagree", () => {
    expect(receiptLine({ answer: true, line: 0.38, room: true })).toBe("AGREE · THE ORACLE EXPECTED 38% TO AGREE");
    expect(receiptLine({ answer: false, line: 0.38, doubled: true, room: true })).toBe("DISAGREE · THE ORACLE EXPECTED 38% TO AGREE · DOUBLED");
    expect(receiptLine({ answer: false, line: null, room: true })).toBe("DISAGREE");
    expect(crowdCallLine({ answer: true, line: null, doubled: false, room: true })).toBe("YOU: AGREE");
  });
  it("teaches the swipe in the same length as the market hint, so it still fits one line", () => {
    expect(SWIPE_HINT_ROOM).toBe("RIGHT TO AGREE, LEFT TO DISAGREE");
    expect(SWIPE_HINT_ROOM.length).toBeLessThanOrEqual(SWIPE_HINT.length);
    expect(sealHint(false, true)).toBe(SWIPE_HINT_ROOM);
    expect(sealHint(true, true)).toBe(TAP_HINT);
  });
});
```

Append to `apps/mobile/test/crowdVerdict.test.ts`:

```ts
describe("the room's verdict after a seal (design 2026-09-25 §7)", () => {
  it("reads with, against and split in the room's words", () => {
    expect(crowdVerdict(true, 62, 50, true)).toEqual({ line: "62% AGREE · WITH THE ROOM", against: false });
    expect(crowdVerdict(true, 28, 50, true)).toEqual({ line: "28% AGREE · AGAINST THE ROOM", against: true });
    expect(crowdVerdict(false, 72, 50, true)).toEqual({ line: "72% AGREE · AGAINST THE ROOM", against: true });
    expect(crowdVerdict(true, 41, 50, true)).toEqual({ line: "41% AGREE · THE PLAYERS SPLIT", against: false });
  });
  it("still holds its tongue under five players", () => {
    expect(crowdVerdict(true, 100, 4, true)).toEqual({ line: GATHERING_LINE, against: false });
  });
});
```

Append to `apps/mobile/test/crowdMovement.test.ts`, inside its `describe`:

```ts
  it("says agreed on a hot take", () => {
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, true, true)).toBe("WHEN YOU SEALED 40% AGREED · IT ENDED AT 55%");
  });
```

Append to `apps/mobile/test/revealFortune.test.ts`, inside its `describe` (add `roomVerdict` to the import):

```ts
  it("reads a hot take back in agree and disagree", () => {
    expect(stakeReceipt(q({ crowd: true }))).toBe("AGREE · STAKED 50 · PAID 143");
    expect(stakeReceipt(q({ crowd: true, outcome: "no", my: { answer: false, payout: 143, delta: 93 } }))).toBe("DISAGREE · STAKED 50 · PAID 143");
    expect(stakeReceipt(q({ crowd: true, my: { stake: null, payout: null, delta: null } }))).toBe("AGREE");
    expect(lineContext(q({ crowd: true }))).toBe("THE ORACLE EXPECTED 35% TO AGREE");
    expect(fortuneRowRight(q({ crowd: true, my: null }))).toBe("AGREED");
    expect(fortuneRowRight(q({ crowd: true, outcome: "no", my: null }))).toBe("DISAGREED");
  });
  it("prints the room's verdict on a settled hot take and nothing otherwise", () => {
    expect(roomVerdict(q({ crowd: true, crowd_yes_pct: 62 }))).toBe("THE ROOM AGREED · 62%");
    expect(roomVerdict(q({ crowd: true, outcome: "no", crowd_yes_pct: 38 }))).toBe("THE ROOM DISAGREED · 38% AGREED");
    expect(roomVerdict(q({ crowd: true, outcome: null }))).toBeNull();
    expect(roomVerdict(q({ crowd: true, outcome: "void" }))).toBeNull();
    expect(roomVerdict(q({ crowd: true, crowd_yes_pct: null }))).toBeNull();
    expect(roomVerdict(q({ crowd: false }))).toBeNull();
  });
```

Append to `apps/mobile/test/shareLines.test.ts`, inside its `describe`:

```ts
  it("says the Big One in agree and disagree on a hot take", () => {
    expect(shareBigOneLine({ line: 0.35, answer: true, stake: 100, delta: 186, room: true })).toBe("THE ORACLE EXPECTED 35% TO AGREE · YOU AGREED FOR 100 · +186");
    expect(shareBigOneLine({ line: 0.35, answer: false, stake: 100, delta: -100, room: true })).toBe("THE ORACLE EXPECTED 35% TO AGREE · YOU DISAGREED FOR 100 · −100");
    expect(shareBigOneLine({ line: 0.35, answer: null, stake: null, delta: null, room: true })).toBe("THE ORACLE EXPECTED 35% TO AGREE · YOU SAT IT OUT");
  });
```

Append to `apps/mobile/test/practiceResult.test.ts`, inside its `describe`:

```ts
  it("speaks a past hot take in agree and disagree (design 2026-09-25 §7)", () => {
    const take = { ...ex, kind: "historical" as const, roundDate: "2026-09-23", crowd: true, crowdYesPct: 62 };
    const r = practiceResult({ answer: true }, take);
    expect(r.receipt).toBe("AGREE · THE ORACLE EXPECTED 70% TO AGREE");
    expect(r.oracleLine).toBe("THE ORACLE EXPECTED 70% TO AGREE");
    expect(r.roomLine).toBe("The room agreed, 62%.");
    expect(r.counterfactual).toBe("Had the room disagreed, the same call would have lost 50.");
    expect(practiceResult({ answer: true }, { ...take, outcome: "no", crowdYesPct: 31 }).roomLine).toBe("The room disagreed, 69%.");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && pnpm vitest run test/sideWords.test.ts test/stakeText.test.ts test/crowdVerdict.test.ts test/crowdMovement.test.ts test/revealFortune.test.ts test/shareLines.test.ts test/practiceResult.test.ts`
Expected: FAIL. `sideWords.test.ts` cannot resolve its import; the others fail on the new assertions.

- [ ] **Step 3: Write `sideWords.ts`**

Create `apps/mobile/src/game/sideWords.ts`:

```ts
// Storage says yes and no; a hot take is agreed or disagreed with (design
// 2026-09-25 N1). Every side word a player reads comes through here, keyed on
// the question's own flag and never on its source name. `room` is that flag,
// renamed at the call site so no player string ever interpolates the wire's
// own word for it.
export function sideWord(answer: boolean, room: boolean): string {
  if (room) return answer ? "AGREE" : "DISAGREE";
  return answer ? "YES" : "NO";
}

export function outcomeWord(outcome: "yes" | "no", room: boolean): string {
  if (room) return outcome === "yes" ? "AGREED" : "DISAGREED";
  return outcome === "yes" ? "YES" : "NO";
}

export function shareSoFar(pct: number, room: boolean): string {
  return room ? `${pct}% AGREE` : `${pct}% SAY YES`;
}
```

- [ ] **Step 4: Rewrite `stakeText.ts`**

Replace the functions in `apps/mobile/src/game/stakeText.ts` (keep the file's comments above each; add the room hint beside the existing two):

```ts
import { sideWord } from "./sideWords";

export function lineLabel(line: number | null, room = false): string | null {
  if (line === null) return null;
  return `THE ORACLE EXPECTED ${Math.round(line * 100)}% ${room ? "TO AGREE" : "YES"}`;
}

export const SWIPE_HINT = "SWIPE RIGHT FOR YES, LEFT FOR NO";
// The hot take's hint. It drops "SWIPE" to stay the length of the line above:
// that one already fills the card's measure at iPhone width, and a longer one
// wraps under the buttons.
export const SWIPE_HINT_ROOM = "RIGHT TO AGREE, LEFT TO DISAGREE";
export const TAP_HINT = "TAP A SIDE TO SEAL";

export function sealHint(reducedMotion: boolean, room = false): string {
  if (reducedMotion) return TAP_HINT;
  return room ? SWIPE_HINT_ROOM : SWIPE_HINT;
}

export function receiptLine(input: { answer: boolean; line: number | null; doubled?: boolean; room?: boolean }): string {
  const room = input.room ?? false;
  const side = sideWord(input.answer, room);
  const label = lineLabel(input.line, room);
  if (label === null) return side;
  const body = `${side} · ${label}`;
  return input.doubled ? `${body} · DOUBLED` : body;
}

export function crowdCallLine(input: { answer: boolean; line: number | null; doubled: boolean; room?: boolean }): string {
  const room = input.room ?? false;
  if (input.line === null) return `YOU: ${sideWord(input.answer, room)}`;
  return receiptLine({ answer: input.answer, line: input.line, doubled: input.doubled, room });
}
```

- [ ] **Step 5: Rewrite `crowdVerdict` and `crowdMovement`**

In `apps/mobile/src/game/crowdVerdict.ts`, replace the `crowdVerdict` function:

```ts
export function crowdVerdict(answer: boolean, crowdYesPct: number, playerCount: number, room = false): { line: string; against: boolean } {
  if (playerCount < VERDICT_MIN_PLAYERS) return { line: GATHERING_LINE, against: false };
  const sidePct = answer ? crowdYesPct : 100 - crowdYesPct;
  if (room) {
    // A hot take has no bounty (design 2026-09-10 D8): the odds already pay
    // for standing against the room, so the words carry no promise to keep
    // and need no second floor.
    const minority = sidePct < C.CONTRARIAN_CROWD_PCT;
    const tide = minority ? "AGAINST THE ROOM" : sidePct >= 100 - C.CONTRARIAN_CROWD_PCT ? "WITH THE ROOM" : "THE PLAYERS SPLIT";
    return { line: `${shareSoFar(crowdYesPct, true)} · ${tide}`, against: minority };
  }
  // The engine's own rule, crowd floor included — gold only when the bounty
  // can truly pay, and now the words only when it can too.
  const against = contrarianApplies(sidePct, playerCount);
  const tide =
    sidePct < C.CONTRARIAN_CROWD_PCT
      ? against
        ? "AGAINST THE TIDE"
        : UNCOUNTED_TIDE
      : sidePct >= 100 - C.CONTRARIAN_CROWD_PCT
        ? "WITH THE TIDE"
        : "THE PLAYERS SPLIT";
  return { line: `${shareSoFar(crowdYesPct, false)} · ${tide}`, against };
}
```

Add `import { shareSoFar } from "./sideWords";` at the top.

In `apps/mobile/src/game/crowdMovement.ts`, add the fourth parameter and change the return:

```ts
export function crowdMovement(
  atSeal: { pct: number; count: number } | null | undefined,
  now: { pct: number; count: number } | null | undefined,
  final: boolean,
  room = false,
): string | null {
  if (!atSeal || !now) return null;
  if (atSeal.count < VERDICT_MIN_PLAYERS || now.count < VERDICT_MIN_PLAYERS) return null;
  if (Math.abs(now.pct - atSeal.pct) < MOVEMENT_MIN_DELTA) return null;
  return `WHEN YOU SEALED ${atSeal.pct}% ${room ? "AGREED" : "SAID YES"} · ${final ? "IT ENDED AT" : "NOW"} ${now.pct}%`;
}
```

- [ ] **Step 6: Rewrite the reveal, share and practice helpers**

In `apps/mobile/src/game/revealFortune.ts`, add `import { sideWord, outcomeWord } from "./sideWords";`, then change `stakeReceipt`, `lineContext` and `fortuneRowRight`, and add `roomVerdict`:

```ts
export function stakeReceipt(q: Question): string | null {
  if (!q.my) return null;
  const room = q.crowd;
  const side = sideWord(q.my.answer, room);
  if (q.my.stake === null) return receiptLine({ answer: q.my.answer, line: null, room });
  const head = `${side} · STAKED ${formatFortune(q.my.stake)}`;
  const body =
    q.outcome === null || q.my.payout === null ? `${head} · PENDING`
    : q.outcome === "void" ? `${head} · STAKE RETURNED`
    : q.my.payout > 0 ? `${head} · PAID ${formatFortune(q.my.payout)}`
    : `${head} · LOST ${formatFortune(q.my.stake)}`;
  return q.my.doubled ? `${body} · DOUBLED` : body;
}

// The room's own verdict on a settled hot take (design 2026-09-25 §7). It
// rides the gauge on the reveal; a market question, a void and an unread
// question have none.
export function roomVerdict(q: Question): string | null {
  if (!q.crowd || (q.outcome !== "yes" && q.outcome !== "no") || q.crowd_yes_pct === null) return null;
  const pct = Math.round(q.crowd_yes_pct);
  return q.outcome === "yes" ? `THE ROOM AGREED · ${pct}%` : `THE ROOM DISAGREED · ${pct}% AGREED`;
}

export function lineContext(q: Question): string | null {
  if (q.line_p_yes === null) return null;
  // On a hot take the room's share rides the gauge row above, so the line
  // stands alone here.
  if (q.crowd) return lineLabel(q.line_p_yes, true);
  const expected = `THE ORACLE EXPECTED ${Math.round(q.line_p_yes * 100)}% YES`;
  return q.crowd_yes_pct === null ? expected : `${expected} · THE ROOM SAID ${Math.round(q.crowd_yes_pct)}%`;
}

export function fortuneRowRight(q: Question): string {
  if (!q.my) return q.outcome === "yes" || q.outcome === "no" ? outcomeWord(q.outcome, q.crowd) : q.outcome === "void" ? "VOID" : "—";
  if (q.my.delta === null) return "—";
  return signedFortune(q.my.delta);
}
```

Change the import from `./stakeText` to `import { lineLabel, receiptLine } from "./stakeText";`.

In `apps/mobile/src/game/shareLines.ts`, replace `shareBigOneLine`:

```ts
export function shareBigOneLine(input: { line: number | null; answer: boolean | null; stake: number | null; delta: number | null; room?: boolean }): string | null {
  if (input.line === null) return null;
  const room = input.room ?? false;
  const pct = Math.round(input.line * 100);
  const said = room ? `THE ORACLE EXPECTED ${pct}% TO AGREE` : `THE ORACLE SAID ${pct}% YES`;
  if (input.answer === null || input.stake === null) return `${said} · YOU SAT IT OUT`;
  const took = room
    ? `YOU ${input.answer ? "AGREED" : "DISAGREED"} FOR ${formatFortune(input.stake)}`
    : `YOU TOOK ${input.answer ? "YES" : "NO"} FOR ${formatFortune(input.stake)}`;
  return input.delta === null ? `${said} · ${took}` : `${said} · ${took} · ${signedFortune(input.delta)}`;
}
```

In `apps/mobile/src/game/practiceResult.ts`, replace the function body:

```ts
export function practiceResult(prediction: PracticePrediction, exhibition: Exhibition) {
  const out = practiceOutcome(prediction, exhibition);
  const room = exhibition.crowd;
  const verdict = out.delta > 0 ? `You took the Oracle for ${formatFortune(out.delta)}.` : `The Oracle took ${formatFortune(-out.delta)}.`;
  const lost = out.oppositeDelta >= 0 ? `won ${formatFortune(out.oppositeDelta)}` : `lost ${formatFortune(-out.oppositeDelta)}`;
  const otherWay = exhibition.outcome !== "yes";
  const counterfactual = room
    ? `Had the room ${otherWay ? "agreed" : "disagreed"}, the same call would have ${lost}.`
    : `Had it gone ${otherWay ? "YES" : "NO"}, the same call would have ${lost}.`;
  // The room's result on a past hot take: the majority's side and its share.
  // A market question keeps the plain outcome.
  const agreed = exhibition.outcome === "yes";
  const roomPct = exhibition.crowdYesPct;
  const roomSidePct = roomPct === null ? null : agreed ? roomPct : 100 - roomPct;
  const roomLine = roomSidePct === null
    ? `Actual outcome: ${agreed ? "YES" : "NO"}.`
    : room
      ? `The room ${agreed ? "agreed" : "disagreed"}, ${roomSidePct}%.`
      : `The room said ${agreed ? "YES" : "NO"}, ${roomSidePct}%.`;
  return {
    ...out,
    receipt: receiptLine({ answer: prediction.answer, line: out.line, room }),
    verdict,
    counterfactual,
    roomLine,
    oracleLine: lineLabel(out.line, room)!,
  };
}
```

`const room = exhibition.crowd;` sits outside every template literal on purpose (Global Constraints).

- [ ] **Step 7: Run the mobile suite**

Run: `cd apps/mobile && pnpm vitest run && pnpm typecheck`
Expected: PASS, including `vocabulary.test.ts` and `typeRegister.test.ts`. Every pre-existing assertion in the six touched test files still passes unchanged: the defaults keep the market wording.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/sideWords.ts apps/mobile/src/game/stakeText.ts apps/mobile/src/game/crowdVerdict.ts apps/mobile/src/game/crowdMovement.ts apps/mobile/src/game/revealFortune.ts apps/mobile/src/game/shareLines.ts apps/mobile/src/game/practiceResult.ts apps/mobile/test/sideWords.test.ts apps/mobile/test/stakeText.test.ts apps/mobile/test/crowdVerdict.test.ts apps/mobile/test/crowdMovement.test.ts apps/mobile/test/revealFortune.test.ts apps/mobile/test/shareLines.test.ts apps/mobile/test/practiceResult.test.ts
git commit -m "feat(mobile): the side words, agree and disagree on a hot take

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 5: The card — AGREE and DISAGREE, the caption, UNHINGED

**Files:**
- Create: `apps/mobile/src/game/cardCaption.ts`
- Modify: `apps/mobile/src/ui/OracleCard.tsx`
- Modify: `apps/mobile/src/app/round.tsx` (the `onSealed` call only), `apps/mobile/src/ui/PracticeCard.tsx` (the `OracleCard` props and the hint)
- Create: `apps/mobile/test/cardCaption.test.ts`

**Interfaces:**
- Consumes: `sideWord`, `sealHint(reducedMotion, room)`, `receiptLine` (Task 4).
- Produces:
  - `cardCoordinate(q: Pick<Q, "slot" | "source_name" | "crowd" | "seen_on">): string`
  - `cardModifiers(q: Pick<Q, "is_big_one" | "unhinged">, closesEarly: boolean): string`
  - `OracleCard` props become `{ q, roundLocksAt, onSealed: (answer: boolean) => void, practice?, height? }`. **`fortune` is removed and `onSealed` now hands back the side, not a receipt string.** The card no longer reads `q.line_p_yes`.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/cardCaption.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cardCoordinate, cardModifiers } from "../src/game/cardCaption";

const base = { slot: 3, source_name: "Kalshi", crowd: false, seen_on: null };

describe("the card's caption (design 2026-09-25 §4.3)", () => {
  it("says where a hot take was seen", () => {
    expect(cardCoordinate({ ...base, crowd: true, source_name: "THE PLAYERS", seen_on: { label: "r/AmItheAsshole", url: "https://r/x" } })).toBe(":: III / SEEN ON R/AMITHEASSHOLE");
  });
  it("says the night shift wrote it when it came from the day's mood", () => {
    expect(cardCoordinate({ ...base, crowd: true, source_name: "THE PLAYERS" })).toBe(":: III / THE NIGHT SHIFT");
  });
  it("keeps the source on a market question", () => {
    expect(cardCoordinate(base)).toBe(":: III / PER KALSHI");
  });
  it("stacks the modifiers in one order", () => {
    expect(cardModifiers({ is_big_one: false, unhinged: false }, false)).toBe("");
    expect(cardModifiers({ is_big_one: false, unhinged: true }, false)).toBe("UNHINGED");
    expect(cardModifiers({ is_big_one: true, unhinged: true }, true)).toBe("STAKES DOUBLE · UNHINGED · CLOSES EARLY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run test/cardCaption.test.ts`
Expected: FAIL, cannot resolve `../src/game/cardCaption`.

- [ ] **Step 3: Write `cardCaption.ts`**

Create `apps/mobile/src/game/cardCaption.ts`:

```ts
import type { RoundToday } from "@oracle/core";
import { numeral } from "./numerals";

type Q = RoundToday["questions"][number];

// The card's coordinate line (design 2026-09-25 §4.3): slot and provenance. A
// hot take says where the argument was seen, or that the night shift wrote it
// from the day's mood; a market question keeps its source. PER THE PLAYERS
// stays the resolution stamp on the reveal and never prints here.
export function cardCoordinate(q: Pick<Q, "slot" | "source_name" | "crowd" | "seen_on">): string {
  const head = `:: ${numeral(q.slot)} /`;
  if (!q.crowd) return `${head} PER ${q.source_name.toUpperCase()}`;
  return q.seen_on ? `${head} SEEN ON ${q.seen_on.label.toUpperCase()}` : `${head} THE NIGHT SHIFT`;
}

// The modifiers under the title, in the Big One's chrome: what the stake
// does, what kind of take it is, and whether it closes ahead of the round.
export function cardModifiers(q: Pick<Q, "is_big_one" | "unhinged">, closesEarly: boolean): string {
  return [q.is_big_one ? "STAKES DOUBLE" : null, q.unhinged ? "UNHINGED" : null, closesEarly ? "CLOSES EARLY" : null].filter(Boolean).join(" · ");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && pnpm vitest run test/cardCaption.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the card**

In `apps/mobile/src/ui/OracleCard.tsx`:

1. Imports. Replace `import { lineLabel, receiptLine, sealHint } from "../game/stakeText";` with:

```ts
import { sealHint } from "../game/stakeText";
import { sideWord } from "../game/sideWords";
import { cardCoordinate, cardModifiers } from "../game/cardCaption";
```

Replace `import { sidePreview, type RoundToday } from "@oracle/core";` with `import type { RoundToday } from "@oracle/core";`. Remove `CardChrome`'s `numeral` from the import if nothing else in the file uses it (`import { CardChrome } from "./CardChrome";`).

2. Props. Replace the component's signature and prop comments with:

```tsx
export function OracleCard({ q, roundLocksAt, onSealed, practice, height }: {
  q: RoundToday["questions"][number];
  // The round's overall lock (if any): a question whose own lock differs
  // from it closes ahead of the round, and the title says so.
  roundLocksAt: string | null;
  // Fires when the seal ceremony completes, with the side that was taken.
  // The round prints the receipt: it holds the line, which arrives from the
  // channel after the seal and is never on the card.
  onSealed: (answer: boolean) => void;
  practice?: { onSeal: (answer: boolean) => void; context?: string; stamp: string };
  height?: number;
}) {
```

3. Delete the four lines that compute `line`, `staked`, `yesPreview` and `noPreview`. Add in their place:

```ts
  const room = q.crowd;
```

4. Replace `finishSeal`:

```ts
  function finishSeal(answer: boolean, serverStake: number | null) {
    markSealed(q.id, serverStake);
    // No `line` here (design 2026-09-25 §13): the estimate is not on the
    // client at seal time. `log_opened` carries it, joined on question_id.
    capture("question_answered", { question_id: q.id, is_big_one: q.is_big_one, side: answer ? "yes" : "no", stake: serverStake });
    // Habitual-hour history (design 2026-09-09 §4.2): fire-and-forget --
    // withSealHour already no-ops repeat seals on the same local day.
    void recordSealHour(new Date());
    onSealed(answer);
  }
```

5. Replace the `coordinate`, `title`, `modifiers` and `lineText` block with:

```ts
  const coordinate = cardCoordinate(q);
  const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;
  const title = q.is_big_one ? "✶ THE BIG ONE" : q.category;
  const modifiers = cardModifiers(q, closesEarly);
```

6. In the JSX, delete the `{sealed && lineText && <Mono ...>{lineText}</Mono>}` line and the comment block above it, leaving `<QuestionFace text={q.text} seed={q.id} />` followed directly by the `practice?.context` line.

7. Replace the buttons' comment and the two `Pressable` bodies:

```tsx
              {/* The side is the seal: tapping a side throws the card the
                  same way a swipe does. Sleeve semantics from the art: the
                  right-hand side wears the ultramarine sleeve, the left the
                  vermilion. A hot take agrees and disagrees; a market
                  question keeps its two storage words. */}
              <View style={{ flexDirection: "row", gap: space(2) }}>
                {([true, false] as const).map((v) => {
                  const tone = v ? colors.ultramarine : colors.vermilion;
                  const word = sideWord(v, room);
                  return (
                    <Pressable key={String(v)} accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => { void seal(v); }}
                      accessibilityLabel={word.charAt(0) + word.slice(1).toLowerCase()}
                      accessibilityHint="Seals your call."
                      style={{ flex: 1, borderWidth: 1, borderColor: tone, minHeight: 48, justifyContent: "center", alignItems: "center", gap: 2 }}>
                      <Mono size={12} color={tone} letterSpacing={room ? 3 : 5} style={{ marginRight: room ? -3 : -5 }}>{word}</Mono>
                    </Pressable>
                  );
                })}
              </View>
```

`DISAGREE` is eight characters in half the card's width; tracking drops from 5 to 3 on a hot take so it cannot clip at 320pt.

8. Replace the hint: `sealHint(reducedMotion)` becomes `sealHint(reducedMotion, room)`.

- [ ] **Step 6: Update the two callers**

In `apps/mobile/src/app/round.tsx`, add `import { receiptLine } from "../game/stakeText";` and change the `OracleCard` element to:

```tsx
              <OracleCard
                height={height}
                q={current}
                roundLocksAt={today.data?.locks_at ?? null}
                onSealed={(answer) => { setLastSealedId(current.id); setLastReceipt(receiptLine({ answer, line: null, room: current.crowd })); }}
              />
```

(Task 7 replaces this with the line from the channel.)

In `apps/mobile/src/ui/PracticeCard.tsx`, remove `fortune={PRACTICE_FORTUNE}` from the `OracleCard` element, remove `PRACTICE_FORTUNE` from the `@oracle/core` import, and change the caption's `sealHint(reducedMotion)` to `sealHint(reducedMotion, exhibition.crowd)`.

- [ ] **Step 7: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS. `typecheck` proves no caller still passes `fortune` or reads a receipt from `onSealed`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/cardCaption.ts apps/mobile/test/cardCaption.test.ts apps/mobile/src/ui/OracleCard.tsx apps/mobile/src/app/round.tsx apps/mobile/src/ui/PracticeCard.tsx
git commit -m "feat(mobile): agree and disagree on the card, seen on, unhinged

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 6: The channel — its helpers, its hook, and `ChannelLog`

**Files:**
- Create: `apps/mobile/src/game/channel.ts`, `apps/mobile/src/game/todayLog.ts`, `apps/mobile/src/ui/ChannelLog.tsx`
- Modify: `apps/mobile/src/ui/DecodeText.tsx`, `apps/mobile/src/api/hooks.ts`, `apps/mobile/src/analytics/analytics.ts`
- Create: `apps/mobile/test/channel.test.ts`, `apps/mobile/test/todayLog.test.ts`

**Interfaces:**
- Consumes: `buildLog`, `LogLine`, `TodayLog`, `TodayLogSchema`, `MODEL_MEMBER_IDS`, `ModelMemberId`, `Reveal` from `@oracle/core`; the reveal's `crowd`, `resolved_at` (Task 1).
- Produces:
  - `game/channel.ts`: `buildLog` (re-export), `CHANNEL_NAME = "#nightshift"`, `DARK_FLOOR = "THE FLOOR WAS DARK"`, `NOTE_PREFIX = "note to self: "`, `etClock(iso: string): string`, `channelHeader(date: string): string`, `nick(member: LogLine["member"]): string`, `sharePct(p: number): string`, `interface PrintLine { key: string; stamp: string; nick: string; body: string; tone: LogLine["tone"]; kind: LogLine["kind"] }`, `printLines(log: ReadonlyArray<LogLine>): PrintLine[]`, `summaryRow(log: ReadonlyArray<LogLine>): string | null`, `channelCounts(log: ReadonlyArray<LogLine>): { member_count: number; reaction_count: number }`, `revealLog(d: Reveal, q: Reveal["questions"][number]): LogLine[]`
  - `game/todayLog.ts`: `interface SealedLog { line: number | null; log: LogLine[] }`, `logIndex(data: TodayLog | null | undefined): Map<string, SealedLog>`
  - `ui/ChannelLog.tsx`: `ChannelLog({ date, log, defaultOpen, collapsible?, onOpen? }: { date: string; log: ReadonlyArray<LogLine>; defaultOpen: boolean; collapsible?: boolean; onOpen?: () => void })`
  - `DecodeLine` gains `prefix?: React.ReactNode`.
  - `useTodayLog(enabled: boolean)` — query key `["round", "log"]`, `null` on 404; `useSubmit` invalidates it.
  - `AnalyticsEvent` gains `"log_opened"` and `"channel_expanded"`.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LogLine, Reveal } from "@oracle/core";
import { etClock, channelHeader, nick, printLines, summaryRow, channelCounts, revealLog, DARK_FLOOR, CHANNEL_NAME } from "../src/game/channel";

const QID = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const say = (member: "haiku" | "sonnet" | "opus", p: number | null, text: string, at = "2026-09-25T13:00:00.000Z", tone: LogLine["tone"] = "mute"): LogLine => ({ at, kind: "say", member, text, p_yes: p, tone });
const LOG: LogLine[] = [
  say("haiku", 0.31, "no chance", "2026-09-25T13:00:00.000Z", "loss"),
  say("sonnet", 0.44, "Close, but the room likes a villain.", "2026-09-25T13:00:01.000Z", "loss"),
  say("opus", 0.62, "", "2026-09-25T13:00:02.000Z", "win"),
  { at: "2026-09-26T16:00:00.000Z", kind: "system", member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null, tone: "mute" },
  say("haiku", null, "ok the room is wrong", "2026-09-26T16:01:00.000Z", "loss"),
  { at: "2026-09-26T16:02:00.000Z", kind: "note", member: "sonnet", text: "weigh the villain.", p_yes: null, tone: "mute" },
];

describe("the channel's clock (design 2026-09-25 §6.3)", () => {
  it("prints eastern time on a twenty-four hour clock, in summer and in winter", () => {
    expect(etClock("2026-09-25T13:00:00.000Z")).toBe("09:00");
    expect(etClock("2026-09-26T16:14:00.000Z")).toBe("12:14");
    expect(etClock("2026-12-01T14:00:00.000Z")).toBe("09:00");
    expect(etClock("2026-09-26T04:05:00.000Z")).toBe("00:05");
  });
  it("prints a blank clock for an instant it cannot read", () => {
    expect(etClock("not a date")).toBe("--:--");
  });
});

describe("the channel's lines", () => {
  it("heads the block with the channel and the day", () => {
    expect(CHANNEL_NAME).toBe("#nightshift");
    expect(channelHeader("2026-09-25")).toBe("#nightshift · 09-25");
    expect(channelHeader("")).toBe("#nightshift");
  });
  it("brackets a member and stars the room", () => {
    expect(nick("haiku")).toBe("<haiku>");
    expect(nick(null)).toBe("***");
  });
  it("prints each line in order, the share before the words, notes prefixed", () => {
    const out = printLines(LOG);
    expect(out.map((l) => `${l.stamp} ${l.nick} ${l.body}`)).toEqual([
      "09:00 <haiku> 31  no chance",
      "09:00 <sonnet> 44  Close, but the room likes a villain.",
      "09:00 <opus> 62",
      "12:00 *** THE ROOM AGREED · 62% · 41 PLAYERS",
      "12:01 <haiku> ok the room is wrong",
      "12:02 <sonnet> note to self: weigh the villain.",
    ]);
    expect(out.map((l) => l.tone)).toEqual(["loss", "loss", "win", "mute", "loss", "mute"]);
    expect(new Set(out.map((l) => l.key)).size).toBe(out.length);
  });
  it("keeps the member's words as written", () => {
    expect(printLines([say("haiku", 0.31, "lol. no")])[0]!.body).toBe("31  lol. no");
  });
  it("collapses to one row of shares, and to nothing when no machine spoke", () => {
    expect(summaryRow(LOG)).toBe("<haiku> 31 · <sonnet> 44 · <opus> 62");
    expect(summaryRow([])).toBeNull();
    expect(summaryRow([LOG[3]!])).toBeNull();
  });
  it("counts members and reactions for the analytics event", () => {
    expect(channelCounts(LOG)).toEqual({ member_count: 3, reaction_count: 1 });
    expect(channelCounts([])).toEqual({ member_count: 0, reaction_count: 0 });
  });
  it("names the empty floor", () => {
    expect(DARK_FLOOR).toBe("THE FLOOR WAS DARK");
  });
});

describe("the reveal's log (design 2026-09-25 §6.3)", () => {
  const question = (over: Partial<Reveal["questions"][number]> = {}): Reveal["questions"][number] => ({
    id: QID, slot: 5, text: "cereal is a soup", outcome: "yes", crowd_yes_pct: 62, crowd_count: 41, market_prob: null, line_p_yes: 0.44, my: null,
    source_name: "THE PLAYERS", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: null,
    seen_on: null, unhinged: false, crowd: true, resolved_at: "2026-09-26T16:00:00.000Z", ...over,
  });
  const entry = (member: "haiku" | "sonnet" | "market", p: number, committed_at: string | null) => ({ question_id: QID, member, p_yes: p, on_right_side: null, reasoning: member === "market" ? null : `${member} says`, cited: [], lessons_received: 0, committed_at });
  const reveal = (q: Reveal["questions"][number], over: Partial<Reveal> = {}): Reveal => ({
    rules_version: 3, bonus_points: 0, date: "2026-09-25", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
    delta: 0, return: 0, fortune_after: 1000, house_delta: 0, bust_fortune: null, evidence: [],
    council: [entry("sonnet", 0.44, "2026-09-25T13:00:01.000Z"), entry("haiku", 0.31, "2026-09-25T13:00:00.000Z"), entry("market", 0.4, "2026-09-25T13:00:00.000Z")],
    reactions: [{ question_id: QID, member: "haiku", text: "ok the room is wrong", created_at: "2026-09-26T16:01:00.000Z" }],
    lessons: [{ question_id: QID, member: "sonnet", text: "weigh the villain.", created_at: "2026-09-26T16:02:00.000Z" }],
    questions: [q], ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
  });

  it("orders the machines, the room, the reactions and the notes, and leaves the market out", () => {
    const q = question();
    const log = revealLog(reveal(q), q);
    expect(log.map((l) => `${l.kind}:${l.member ?? "room"}`)).toEqual(["say:haiku", "say:sonnet", "system:room", "say:haiku", "note:sonnet"]);
    expect(log[0]).toMatchObject({ p_yes: 0.31, tone: "loss", text: "haiku says" });
    expect(log[2]!.text).toBe("THE ROOM AGREED · 62% · 41 PLAYERS");
  });
  it("prints the void reason as the room's line", () => {
    const q = question({ outcome: "void", void_reason: "TOO FEW PLAYERS ANSWERED", crowd_yes_pct: null, crowd_count: null });
    expect(revealLog(reveal(q), q).find((l) => l.kind === "system")!.text).toBe("TOO FEW PLAYERS ANSWERED");
  });
  it("is empty when no machine clocked in on the question", () => {
    const q = question();
    expect(revealLog(reveal(q, { council: [] }), q)).toEqual([]);
  });
  it("takes only this question's remarks", () => {
    const q = question();
    const other = "6e4f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
    const d = reveal(q, { reactions: [{ question_id: other, member: "opus", text: "elsewhere", created_at: "2026-09-26T16:01:00.000Z" }], lessons: [] });
    expect(revealLog(d, q).some((l) => l.text === "elsewhere")).toBe(false);
  });
});
```

Create `apps/mobile/test/todayLog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { logIndex } from "../src/game/todayLog";

const A = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const line = { at: "2026-09-25T13:00:00.000Z", kind: "say" as const, member: "haiku" as const, text: "no chance", p_yes: 0.31, tone: "mute" as const };

describe("the log after the seal (design 2026-09-25 §6.2)", () => {
  it("indexes the sealed questions by id", () => {
    const index = logIndex({ questions: [{ question_id: A, line_p_yes: 0.38, log: [line] }] });
    expect(index.get(A)).toEqual({ line: 0.38, log: [line] });
    expect(index.get("unsealed")).toBeUndefined();
  });
  it("is empty before the first seal, and when there is no open round", () => {
    expect(logIndex(undefined).size).toBe(0);
    expect(logIndex(null).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && pnpm vitest run test/channel.test.ts test/todayLog.test.ts`
Expected: FAIL, neither module resolves.

- [ ] **Step 3: Write `channel.ts`**

Create `apps/mobile/src/game/channel.ts`:

```ts
// #nightshift on the client (design 2026-09-25 §6). The log is built by the
// core builder the API also uses; this module decides how it prints. Pure:
// ChannelLog and the share card render what these return.
import { buildLog, MODEL_MEMBER_IDS, type LogLine, type ModelMemberId, type Reveal } from "@oracle/core";

export { buildLog };

export const CHANNEL_NAME = "#nightshift";
// The renderer's line for a question no machine clocked in on.
export const DARK_FLOOR = "THE FLOOR WAS DARK";
// Prefixed at render, never stored (design §6.1).
export const NOTE_PREFIX = "note to self: ";

// The channel keeps eastern time: the round opens and locks at noon ET and
// the machines clock in at 09:00 ET, wherever the reader is. `h23` because
// `hour12: false` prints midnight as 24 on some engines.
const ET_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function etClock(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "--:--";
  const parts = ET_CLOCK.formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

export function channelHeader(date: string): string {
  return date ? `${CHANNEL_NAME} · ${date.slice(5)}` : CHANNEL_NAME;
}

export function nick(member: LogLine["member"]): string {
  return member === null ? "***" : `<${member}>`;
}

export function sharePct(p: number): string {
  return String(Math.round(p * 100));
}

export interface PrintLine { key: string; stamp: string; nick: string; body: string; tone: LogLine["tone"]; kind: LogLine["kind"] }

function bodyOf(l: LogLine): string {
  if (l.kind === "note") return `${NOTE_PREFIX}${l.text}`;
  if (l.kind === "say" && l.p_yes !== null) return [sharePct(l.p_yes), l.text].filter(Boolean).join("  ");
  return l.text;
}

export function printLines(log: ReadonlyArray<LogLine>): PrintLine[] {
  return log.map((l, i) => ({ key: `${i}-${l.at}`, stamp: etClock(l.at), nick: nick(l.member), body: bodyOf(l), tone: l.tone, kind: l.kind }));
}

const guesses = (log: ReadonlyArray<LogLine>) => log.filter((l) => l.kind === "say" && l.member !== null && l.p_yes !== null);

// The collapsed row: every machine's share and nothing else.
export function summaryRow(log: ReadonlyArray<LogLine>): string | null {
  const rows = guesses(log);
  if (rows.length === 0) return null;
  return rows.map((l) => `${nick(l.member)} ${sharePct(l.p_yes!)}`).join(" · ");
}

export function channelCounts(log: ReadonlyArray<LogLine>): { member_count: number; reaction_count: number } {
  return {
    member_count: new Set(guesses(log).map((l) => l.member)).size,
    reaction_count: log.filter((l) => l.kind === "say" && l.p_yes === null).length,
  };
}

const isModel = (m: string): m is ModelMemberId => (MODEL_MEMBER_IDS as readonly string[]).includes(m);

// One question's log from the reveal payload (design §6.3). The market member
// never posts; a Council row with no commit instant cannot be placed in time
// and is left out.
export function revealLog(d: Reveal, q: Reveal["questions"][number]): LogLine[] {
  return buildLog({
    lines: d.council.flatMap((e) =>
      e.question_id === q.id && isModel(e.member) && e.committed_at !== null
        ? [{ member: e.member, pYes: e.p_yes, reasoning: e.reasoning, committedAt: e.committed_at }]
        : [],
    ),
    outcome: q.outcome,
    crowd: { yesPct: q.crowd_yes_pct === null ? null : Math.round(q.crowd_yes_pct), count: q.crowd_count, resolvedAt: q.resolved_at, voidReason: q.void_reason },
    reactions: d.reactions.filter((r) => r.question_id === q.id).map((r) => ({ member: r.member, text: r.text, createdAt: r.created_at })),
    lessons: d.lessons.filter((l) => l.question_id === q.id).map((l) => ({ member: l.member, text: l.text, createdAt: l.created_at })),
  });
}
```

- [ ] **Step 4: Write `todayLog.ts`**

Create `apps/mobile/src/game/todayLog.ts`:

```ts
import type { LogLine, TodayLog } from "@oracle/core";

// The log route's payload, by question (design 2026-09-25 §6.2). A question
// the caller has not sealed is absent from the payload, so it is absent here:
// the round screen cannot print a channel, or price a double, for a take that
// has not been sealed.
export interface SealedLog { line: number | null; log: LogLine[] }

export function logIndex(data: TodayLog | null | undefined): Map<string, SealedLog> {
  return new Map((data?.questions ?? []).map((q) => [q.question_id, { line: q.line_p_yes, log: q.log }]));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/mobile && pnpm vitest run test/channel.test.ts test/todayLog.test.ts`
Expected: PASS.

- [ ] **Step 6: Give `DecodeLine` a prefix**

In `apps/mobile/src/ui/DecodeText.tsx`, add `prefix,` to the destructured props after `dimColor,`, add to the prop types after the `dimColor?: string;` line:

```ts
  // Rendered ahead of the printed text and never decoded: a stamp and a nick
  // hold still while the words after them resolve.
  prefix?: React.ReactNode;
```

and render it first inside `<Face>`:

```tsx
    <Face size={size} color={color} accessibilityLabel={text} {...(serif ? {} : { letterSpacing })} style={style} {...rest}>
      {prefix}
      {dimColor ? shown.slice(0, revealed) : shown}
```

- [ ] **Step 7: Write `ChannelLog.tsx`**

Create `apps/mobile/src/ui/ChannelLog.tsx`:

```tsx
// The channel (design 2026-09-25 §6.3): a mono block with a one-line header
// and the log under it. Each line is `HH:MM <nick> text`, the stamp in
// eastern time, the nick in its tone colour, the words as the member wrote
// them. The header and the room's lines are machine voice; what a member
// says is read, so it takes the reading register and keeps its own case.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LogLine } from "@oracle/core";
import { Mono, role } from "./Text";
import { DecodeLine } from "./DecodeText";
import { channelHeader, printLines, summaryRow, DARK_FLOOR, type PrintLine } from "../game/channel";
import { colors, space } from "../theme";

const LINE_STAGGER_MS = 120;
const LINE_PRINT_MS = 400;
const LEFT = { textAlign: "left" as const };

const toneColor = (tone: LogLine["tone"]) => (tone === "win" ? colors.goldText : tone === "loss" ? colors.vermilion : colors.mutedInk);

function ChannelLine({ line, index }: { line: PrintLine; index: number }) {
  const room = line.kind === "system";
  const base = room ? role.meta : role.supporting;
  return (
    <DecodeLine
      {...base}
      text={line.body}
      seed={line.key}
      delayMs={index * LINE_STAGGER_MS}
      durationMs={LINE_PRINT_MS}
      color={line.kind === "say" ? colors.ink : colors.mutedInk}
      accessibilityLabel={`${line.nick} ${line.body}`}
      style={[base.style, LEFT, line.kind === "note" ? { opacity: 0.7 } : null]}
      prefix={
        <>
          <Text style={{ color: colors.mutedInk }}>{`${line.stamp} `}</Text>
          <Text style={{ color: toneColor(line.tone) }}>{`${line.nick} `}</Text>
        </>
      }
    />
  );
}

export function ChannelLog({ date, log, defaultOpen, collapsible = true, onOpen }: {
  // The round's date; the header prints its month and day.
  date: string;
  log: ReadonlyArray<LogLine>;
  defaultOpen: boolean;
  // False where the block is the whole panel and has nothing to fold into.
  collapsible?: boolean;
  // Fires each time the reader opens a closed block.
  onOpen?: () => void;
}) {
  // Remembers nothing between visits (design §6.3): the state dies with the mount.
  const [open, setOpen] = useState(defaultOpen);
  const header = channelHeader(date);
  const lines = printLines(log);
  const summary = summaryRow(log);
  const head = <Mono {...role.meta} color={colors.goldText} style={[role.meta.style, LEFT]}>{header}</Mono>;

  if (lines.length === 0) {
    return (
      <View style={{ gap: space(1) }}>
        {head}
        <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, LEFT]}>{DARK_FLOOR}</Mono>
      </View>
    );
  }

  const shown = open || !collapsible;
  return (
    <View style={{ gap: space(1) }}>
      {collapsible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? "Close the channel" : "Open the channel"}
          onPress={() => { if (!open) onOpen?.(); setOpen((v) => !v); }}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", gap: space(1), opacity: pressed ? 0.5 : 1 })}
        >
          {head}
          {!open && summary && <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, LEFT]}>{summary}</Mono>}
        </Pressable>
      ) : head}
      {shown && lines.map((line, i) => <ChannelLine key={line.key} line={line} index={i} />)}
    </View>
  );
}
```

- [ ] **Step 8: Add the hook and the events**

In `apps/mobile/src/api/hooks.ts`, add `TodayLogSchema` to the import from `@oracle/core`, and add after `useMineToday`:

```ts
// The channel after the seal (design 2026-09-25 §6.2): the log, and the line
// the tray prices the double from, for the caller's sealed questions only.
// The server checks the seal, so nothing here can leak a take that is still
// on the table.
export function useTodayLog(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "log"],
    enabled,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/today/log", TodayLogSchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}
```

In `useSubmit`'s `onSuccess`, add after the `["round", "mine"]` line:

```ts
      // The seal opens the channel on this take.
      qc.invalidateQueries({ queryKey: ["round", "log"] });
```

In `apps/mobile/src/analytics/analytics.ts`, add to the `AnalyticsEvent` union after `| "reading_opened"`:

```ts
  | "log_opened"
  | "channel_expanded"
```

- [ ] **Step 9: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS. `typeRegister.test.ts` passes because `ChannelLog.tsx` spreads roles and never names a bare size; `decodeAccessibility.test.ts` passes because `DecodeLine` still sets `accessibilityLabel={text}` before the rest spread.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/game/channel.ts apps/mobile/src/game/todayLog.ts apps/mobile/src/ui/ChannelLog.tsx apps/mobile/src/ui/DecodeText.tsx apps/mobile/src/api/hooks.ts apps/mobile/src/analytics/analytics.ts apps/mobile/test/channel.test.ts apps/mobile/test/todayLog.test.ts
git commit -m "feat(mobile): the channel, its clock and its log

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 7: The round — the log after the seal, the tray from the log, the finale

**Files:**
- Modify: `apps/mobile/src/game/doubleTray.ts`, `apps/mobile/src/ui/DoubleTray.tsx`, `apps/mobile/src/ui/CrowdReveal.tsx`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/app/index.tsx` (the `trayState` call only)
- Test: `apps/mobile/test/doubleTray.test.ts`

**Interfaces:**
- Consumes: `useTodayLog`, `logIndex`, `SealedLog`, `ChannelLog`, `summaryRow` (Task 6); `sideWord`, `shareSoFar`, `receiptLine`, `crowdCallLine`, `crowdVerdict(..., room)`, `crowdMovement(..., room)` (Task 4); `OracleCard`'s `onSealed(answer)` (Task 5).
- Produces:
  - `type LineOf = (questionId: string) => number | null`
  - `trayTiles(questions, mine, lineOf: LineOf, now: number): TrayTile[]` — **`lineOf` is a new third parameter**
  - `trayState(questions, mine, doubleQuestionId: string | null, lineOf: LineOf, now: number): TrayState` — **`lineOf` is a new fourth parameter**
  - `TrayTile` gains `room: boolean`
  - `CrowdReveal({ round, logs }: { round: RoundToday; logs: Map<string, SealedLog> })`

- [ ] **Step 1: Rewrite the tray tests for the new signature and add the failing ones**

In `apps/mobile/test/doubleTray.test.ts`, add under the `five` constant:

```ts
// The line arrives from the channel after the seal (design 2026-09-25 §6.2),
// never from the round payload. Every question here plays at 35%.
const lineOf = () => 0.35;
```

Thread it through every existing call: `trayTiles(a, b, NOW)` becomes `trayTiles(a, b, lineOf, NOW)` and `trayState(a, b, c, NOW)` becomes `trayState(a, b, c, lineOf, NOW)`. Then append inside the `describe`:

```ts
  it("prices from the channel's line and ignores the round payload's", () => {
    const stale = [q(1, { line_p_yes: 0.9 })];
    expect(trayTiles(stale, [p(1)], () => 0.35, NOW)[0]).toMatchObject({ wins: 93, doubledWins: 186 });
  });
  it("has no tile for a sealed call whose line has not arrived", () => {
    const only = (id: string) => (id === "q1" ? 0.35 : null);
    expect(trayTiles(five, [p(1), p(2)], only, NOW).map((t) => t.id)).toEqual(["q1"]);
    expect(trayState([q(1)], [p(1)], null, () => null, NOW)).toBe("hidden");
  });
  it("marks a hot take's tile so the tray can say agree and disagree", () => {
    expect(trayTiles([q(1, { crowd: true }), q(2)], [p(1), p(2)], lineOf, NOW).map((t) => t.room)).toEqual([true, false]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run test/doubleTray.test.ts`
Expected: FAIL. The stale-line test reads the payload's 0.9 and prices `wins` at 6; `room` is undefined.

- [ ] **Step 3: Change the tray**

In `apps/mobile/src/game/doubleTray.ts`:

```ts
export type LineOf = (questionId: string) => number | null;

export type TrayTile = {
  id: string; slot: number; text: string; isBigOne: boolean; answer: boolean;
  stake: number; doubledStake: number; wins: number; doubledWins: number; locked: boolean;
  // A hot take: the tile says agree and disagree.
  room: boolean;
};
```

Replace `trayTiles` and `trayState`:

```ts
export function trayTiles(questions: RoundToday["questions"], mine: MineToday["predictions"], lineOf: LineOf, now: number): TrayTile[] {
  const byId = new Map(mine.map((p) => [p.question_id, p]));
  return [...questions]
    .sort((a, b) => a.slot - b.slot)
    .flatMap((q) => {
      const p = byId.get(q.id);
      // The line is read from the channel, which serves it only for a sealed
      // question (design 2026-09-25 N5). An unstaked call (no line committed,
      // design 2026-09-10 §5.5) has nothing to double either way.
      const line = lineOf(q.id);
      if (!p || p.stake === null || line === null) return [];
      // The server's double route stores `stake * 2` on the row it doubles, so
      // a placed call comes back from /today/mine ALREADY doubled. Price from
      // the base either way, or the beat between the tap and the hand-off
      // reads the stake doubled twice.
      const stake = p.doubled ? p.stake / FORTUNE.DOUBLE_MULT : p.stake;
      const rate = odds(p.answer, line);
      const dbl = doubledStake(stake);
      return [{
        id: q.id, slot: q.slot, text: q.text, isBigOne: q.is_big_one, answer: p.answer,
        stake, doubledStake: dbl, wins: Math.round(stake * rate), doubledWins: Math.round(dbl * rate),
        locked: isClosed(q, now), room: q.crowd,
      }];
    });
}

export function trayState(questions: RoundToday["questions"], mine: MineToday["predictions"], doubleQuestionId: string | null, lineOf: LineOf, now: number): TrayState {
  if (doubleQuestionId !== null) return "placed";
  const sealed = new Set(mine.map((p) => p.question_id));
  if (nextOpenQuestion(questions, (id) => sealed.has(id), now)) return "hidden";
  return trayTiles(questions, mine, lineOf, now).some((t) => !t.locked) ? "open" : "hidden";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && pnpm vitest run test/doubleTray.test.ts`
Expected: PASS.

- [ ] **Step 5: The tray's words**

In `apps/mobile/src/ui/DoubleTray.tsx`, add `import { sideWord } from "../game/sideWords";`. Inside the `tiles.map`, add `const word = sideWord(t.answer, t.room);` beside `const tone = ...`, then change the label and the side mark:

```tsx
                accessibilityLabel={`${t.isBigOne ? "The Big One, " : ""}question ${t.slot}. ${t.text} You said ${word.toLowerCase()}, stake ${t.stake}, doubled ${t.doubledStake}${t.locked ? ", locked" : ""}`}
```

```tsx
                  <Mono size={10} color={tone} letterSpacing={3} style={{ marginLeft: "auto" }}>{word}</Mono>
```

- [ ] **Step 6: The finale**

In `apps/mobile/src/ui/CrowdReveal.tsx`:

1. Imports: add `import { ChannelLog } from "./ChannelLog";`, `import type { SealedLog } from "../game/todayLog";`, `import { shareSoFar } from "../game/sideWords";`.

2. Signature: `export function CrowdReveal({ round, logs }: { round: RoundToday; logs: Map<string, SealedLog> }) {`.

3. Inside `sealed.map((q) => { ... })`, add at the top of the body:

```ts
              const room = q.crowd;
              const sealedLog = logs.get(q.id);
```

change the bounty flag so a hot take never promises one:

```ts
              const against = !room && contrarianApplies(mySidePct, c?.player_count ?? 0);
```

and pass the flag to the movement line: `crowdMovement(mine.atSeal, c ? { pct: c.crowd_yes_pct, count: c.player_count } : null, false, room)`.

4. Replace the row that prints the share and the call:

```tsx
                  <View style={{ flexDirection: "row", justifyContent: gathering ? "flex-end" : "space-between" }}>
                    {!gathering && <Mono {...role.caption} color={colors.goldText} style={[role.caption.style, { textAlign: "left" }]}>{shareSoFar(c!.crowd_yes_pct, room)}</Mono>}
                    <Mono {...role.caption} color={against ? colors.goldText : colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>
                      {crowdCallLine({ answer: mine.answer, line: sealedLog?.line ?? null, doubled: mine.doubled, room })}{against ? " · AGAINST THE TIDE" : ""}
                    </Mono>
                  </View>
```

5. After the `{movement && (...)}` block, add the channel, collapsed to its summary row (design §6.2):

```tsx
                  {room && sealedLog && (
                    <ChannelLog date={round.date} log={sealedLog.log} defaultOpen={false} onOpen={() => capture("log_opened", { question_id: q.id, line: sealedLog.line })} />
                  )}
```

and add `import { capture } from "../analytics/analytics";`.

- [ ] **Step 7: The round screen**

In `apps/mobile/src/app/round.tsx`:

1. Imports. Change the React import to `import { useEffect, useMemo, useRef, useState } from "react";`, the React Native import to `import { AccessibilityInfo, Pressable, ScrollView, StyleSheet, View } from "react-native";`, and the hooks import to `import { useToday, useCrowdSoFar, useMineToday, useDouble, useTodayLog } from "../api/hooks";`. Add:

```ts
import { ChannelLog } from "../ui/ChannelLog";
import { QuietLink } from "../ui/Button";
import { logIndex } from "../game/todayLog";
import { summaryRow } from "../game/channel";
```

2. State. Replace the `lastSealedId` and `lastReceipt` state and their comments with:

```ts
  // The last thrown card and the side it was thrown to. Its channel opens over
  // the next card, its receipt and the room's verdict print in the footer.
  const [lastSealed, setLastSealed] = useState<{ id: string; answer: boolean } | null>(null);
  const lastSealedId = lastSealed?.id ?? null;
  // The channel on the just-sealed take (design 2026-09-25 §6.2). It opens
  // when the log lands and closes on a tap or on the next seal.
  const [logOpen, setLogOpen] = useState(false);
```

3. The log. After `const mine = useMineToday(!!today.data);` add:

```ts
  // The channel for every take the player has sealed, and the line the tray
  // prices the double from. Refetched by every seal (useSubmit).
  const log = useTodayLog(anySealed);
  const logs = useMemo(() => logIndex(log.data), [log.data]);
  const lineOf = (id: string) => logs.get(id)?.line ?? null;
  const lastLog = lastSealedId ? logs.get(lastSealedId) : undefined;
  const lastRoom = (lastSealedId ? qs.find((q) => q.id === lastSealedId)?.crowd : false) ?? false;
  const openedLogFor = useRef<string | null>(null);
  useEffect(() => {
    if (!lastSealedId || !lastLog || !lastRoom || openedLogFor.current === lastSealedId) return;
    openedLogFor.current = lastSealedId;
    setLogOpen(true);
    capture("log_opened", { question_id: lastSealedId, line: lastLog.line });
  }, [lastSealedId, lastLog, lastRoom]);
```

4. The spoken verdict. In the `announcedFor` effect, change the announcement to the room's words on a hot take:

```ts
    const room = qs.find((q) => q.id === lastSealedId)?.crowd ?? false;
    AccessibilityInfo.announceForAccessibility(`The players: ${crowdVerdict(entry.answer, c.crowd_yes_pct, c.player_count, room).line}`);
```

5. The tray. Replace the `tray`, `tiles` and `stage` computations:

```ts
  // The hand is known once both the player's rows and their lines have
  // landed. The line rides the channel, which the fifth seal refetches, so the
  // tray waits on it the way it already waits on /today/mine -- otherwise it
  // opens with four tiles and grows a fifth.
  const handKnown = !mine.isFetching && !mine.isPending && (!anySealed || (!log.isFetching && !log.isPending));
  const tray = trayDone ? "placed" : doubleId !== null || handKnown ? trayState(qs, minePreds, doubleId, lineOf, now) : "hidden";
  const tiles = trayTiles(qs, minePreds, lineOf, now);
  const current = nextOpenQuestion(qs, (id) => !!answers[id]?.sealed, now);
  // Card, tray, an empty beat, or the finale — see trayStage for why the
  // empty beat exists.
  const stage = trayStage({ hasOpenCard: !!current, tray, mineSettled: handKnown, holdPlaced: !trayDone && placedId !== null });
```

6. The verdict for the footer. Replace the `verdict` line below the early returns:

```ts
  const verdict = lastEntry && lastCrowd ? crowdVerdict(lastEntry.answer, lastCrowd.crowd_yes_pct, lastCrowd.player_count, lastRoom) : null;
  const lastReceipt = lastSealed ? receiptLine({ answer: lastSealed.answer, line: lastLog?.line ?? null, room: lastRoom }) : null;
  const lastSummary = lastRoom && lastLog ? summaryRow(lastLog.log) : null;
```

7. The card. Replace the `onSealed` prop from Task 5:

```tsx
                onSealed={(answer) => { setLastSealed({ id: current.id, answer }); setLogOpen(false); }}
```

8. The finale. `<CrowdReveal round={today.data} />` becomes `<CrowdReveal round={today.data} logs={logs} />`.

9. The channel over the stage. Inside the stage container (`<View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>`), after the closing of the `current ? ... : ...` expression and before the container's closing tag, add:

```tsx
        {/* The channel on the take just sealed (design 2026-09-25 §6.2). It
            lies over the lower stage rather than resizing it: the next card is
            already dealt beneath, and a card that changed height as the log
            opened and closed would move under the player's thumb. A tap on the
            stage above it, or the link, closes it. */}
        {current && logOpen && lastLog && lastSealedId && (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Close the channel" onPress={() => setLogOpen(false)} style={StyleSheet.absoluteFill} />
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "62%", backgroundColor: colors.museumWhite, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space(3), gap: space(2) }}>
              <ScrollView contentContainerStyle={{ paddingBottom: space(2) }} contentInsetAdjustmentBehavior="never" alwaysBounceVertical={false} showsVerticalScrollIndicator={false}>
                <ChannelLog key={lastSealedId} date={today.data.date} log={lastLog.log} defaultOpen collapsible={false} />
              </ScrollView>
              <QuietLink title="DRAW THE NEXT CARD" onPress={() => setLogOpen(false)} />
            </View>
          </>
        )}
```

10. The footer. Change its reserved height from `scaledRow(56, chromeScale)` to `scaledRow(72, chromeScale)`, and inside the `current && lastSealedId && lastEntry ?` branch add a third row after the verdict's `)}`:

```tsx
            {lastSummary && !logOpen && (
              <Pressable accessibilityRole="button" accessibilityLabel="Open the channel" hitSlop={{ top: 12, bottom: 12, left: 24, right: 24 }} onPress={() => setLogOpen(true)}>
                <Mono {...role.meta} color={colors.mutedInk} style={[role.meta.style, { textDecorationLine: "underline" }]}>{lastSummary}</Mono>
              </Pressable>
            )}
```

Replace the unsealed hint so it says what a hot take hides:

```tsx
          <Mono {...role.supporting} color={colors.mutedInk} style={[role.supporting.style, { textAlign: "center" }]}>
            {current.crowd ? "Nothing about the room shows until you seal." : "The players' leaning is hidden until you seal."}
          </Mono>
```

- [ ] **Step 8: Home's tray call**

In `apps/mobile/src/app/index.tsx`, change the React import to include `useMemo`, add `useTodayLog` to the hooks import and `import { logIndex } from "../game/todayLog";`. After `const mine = useMineToday(!!round);` and the `sealedIds` line, add:

```ts
  // The tray is priced from the channel's line (design 2026-09-25 N5), so the
  // unplaced-double notice below needs it too.
  const log = useTodayLog(!!round && sealedIds.size > 0);
  const logs = useMemo(() => logIndex(log.data), [log.data]);
```

and change the `tray` line:

```ts
  const tray = round ? trayState(round.questions, mine.data?.predictions ?? [], mine.data?.double_question_id ?? null, (id) => logs.get(id)?.line ?? null, now) : "hidden";
```

- [ ] **Step 9: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/game/doubleTray.ts apps/mobile/test/doubleTray.test.ts apps/mobile/src/ui/DoubleTray.tsx apps/mobile/src/ui/CrowdReveal.tsx apps/mobile/src/app/round.tsx apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): the log after the seal, the tray priced from the channel

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 8: The reveal — the channel under every take

**Files:**
- Modify: `apps/mobile/src/app/reveal/[date].tsx`, `apps/mobile/src/game/revealRows.ts` (`movementLine`)
- Test: `apps/mobile/test/revealRows.test.ts`

**Interfaces:**
- Consumes: `ChannelLog`, `revealLog`, `channelCounts` (Task 6); `roomVerdict`, `lineLabel(line, room)`, `shareBigOneLine({ room })` (Task 4); `CrowdBar` from `ui/CrowdReveal`.
- Produces: `movementLine(q)` passes the question's flag to `crowdMovement`. `CouncilSplit`, `CouncilReading` and `splitRows` stay for version 3 market rounds and are not rendered on a hot take.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/test/revealRows.test.ts`, inside `describe("movementLine (design 2026-09-09 §4.1)", ...)`. The file's fixture helper is `question(overrides)`, and `my` is replaced whole, not merged:

```ts
    it("says agreed when the tide moved on a hot take", () => {
      expect(
        movementLine(
          question({
            crowd: true,
            outcome: "yes",
            crowd_yes_pct: 55,
            crowd_count: 40,
            my: { answer: true, confidence: 75, points: null, brier: null, crowd_yes_pct_at_seal: 40, crowd_count_at_seal: 12, stake: 50, payout: 143, delta: 93, doubled: false, sealed_at: null },
          }),
        ),
      ).toBe("WHEN YOU SEALED 40% AGREED · IT ENDED AT 55%");
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run test/revealRows.test.ts`
Expected: FAIL, received `WHEN YOU SEALED 40% SAID YES · IT ENDED AT 55%`.

- [ ] **Step 3: Pass the flag**

In `apps/mobile/src/game/revealRows.ts`, in `movementLine`, add the fourth argument to the `crowdMovement` call:

```ts
    q.outcome !== null,
    q.crowd,
  );
```

Run: `cd apps/mobile && pnpm vitest run test/revealRows.test.ts`
Expected: PASS.

- [ ] **Step 4: The reveal screen**

In `apps/mobile/src/app/reveal/[date].tsx`:

1. Imports. Add `roomVerdict` to the import from `../../game/revealFortune`, and add:

```ts
import { ChannelLog } from "../../ui/ChannelLog";
import { CrowdBar } from "../../ui/CrowdReveal";
import { revealLog, channelCounts } from "../../game/channel";
```

2. Under the `CouncilSplit` function, add:

```tsx
// The channel on one take (design 2026-09-25 §6.3): open on the Big One,
// collapsed to its row of shares on the others. It replaces the Council split
// and the readings on a hot take; a market round keeps both.
function RevealChannel({ d, q, open }: { d: Reveal; q: Reveal["questions"][number]; open: boolean }) {
  const log = revealLog(d, q);
  return (
    <ChannelLog date={d.date} log={log} defaultOpen={open} onOpen={() => capture("channel_expanded", { question_id: q.id, ...channelCounts(log) })} />
  );
}

// The room's gauge and its verdict, on one row.
function RoomRow({ q }: { q: Reveal["questions"][number] }) {
  const verdict = roomVerdict(q);
  if (verdict === null || q.crowd_yes_pct === null) return null;
  return (
    <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
      <CrowdBar pct={Math.round(q.crowd_yes_pct)} />
      <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{verdict}</Mono>
    </View>
  );
}
```

3. In the component body, after `const bigState = big ? rowState(big) : null;`, add:

```ts
  const bigRoom = big?.crowd ?? false;
```

and in `cardData`'s `shareBigOneLine({ ... })` call add `room: bigRoom,`.

4. The ordinary rows. In `d.questions.filter((q) => q.slot !== 5).map((q, i) => { ... })` add `const room = q.crowd;` beside the other row constants. In the row's JSX, directly after the `<Serif ...>{q.text}</Serif>` line, add:

```tsx
                  {room && <RoomRow q={q} />}
```

Move the `{movement ? (...) : null}` block and its comment up so it sits directly above the Council line, then replace `{money && <CouncilSplit d={d} questionId={q.id} linePYes={q.line_p_yes} fontScale={fontScale} />}` with:

```tsx
                  {room ? <RevealChannel d={d} q={q} open={false} /> : money && <CouncilSplit d={d} questionId={q.id} linePYes={q.line_p_yes} fontScale={fontScale} />}
```

The row now reads, top to bottom: the take, the room's gauge and verdict, the stake receipt, with or against the room, what the Oracle expected, the tide's move, the channel, `[ WHY THIS RESOLVED ]`, the source.

5. The Big One. Replace the `PLAYERS SAID` line:

```tsx
                  {bigRoom
                    ? <RoomRow q={big} />
                    : <Mono {...role.caption} color={colors.mutedInk} style={[role.caption.style, { textAlign: "left" }]}>{crowdReadable(big) ? `PLAYERS SAID ${big.crowd_yes_pct}% YES` : TOO_FEW_LINE}</Mono>}
```

Change `{lineLabel(big.line_p_yes)}{" "}` to `{lineLabel(big.line_p_yes, bigRoom)}{" "}`, and replace `{fortuneRound && <CouncilSplit d={d} questionId={big.id} linePYes={big.line_p_yes} fontScale={fontScale} />}` with:

```tsx
                  {bigRoom ? <RevealChannel d={d} q={big} open /> : fortuneRound && <CouncilSplit d={d} questionId={big.id} linePYes={big.line_p_yes} fontScale={fontScale} />}
```

- [ ] **Step 5: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/mobile/src/app/reveal/[date].tsx" apps/mobile/src/game/revealRows.ts apps/mobile/test/revealRows.test.ts
git commit -m "feat(mobile): the channel on the reveal

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 9: Home — the shift clock, last night, the house line out

**Files:**
- Create: `apps/mobile/src/game/shiftLine.ts`, `apps/mobile/src/game/lastNight.ts`
- Create: `apps/mobile/test/shiftLine.test.ts`, `apps/mobile/test/lastNight.test.ts`
- Modify: `apps/mobile/src/app/index.tsx`, `apps/mobile/src/analytics/analytics.ts`
- Delete: `apps/mobile/src/game/houseLine.ts`, `apps/mobile/test/houseLine.test.ts`

**Interfaces:**
- Consumes: `etClock` (Task 6); `signedFortune`; `MODEL_MEMBER_IDS`; the round's `council_committed_at`; the reveal's `crowd` (Task 1).
- Produces:
  - `shiftLine(input: { open: boolean; allSealed: boolean; room: boolean; councilCommittedAt: string | null }): string | null`, `FLOOR_DARK`
  - `lastNightLine(d: Reveal | { pending: true } | null | undefined): string | null`
  - `AnalyticsEvent` loses `"house_headline_viewed"`. The `house` block stays on the ledger payload and on the reveal's night line (`houseNightLine`); only Home stops printing it.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/shiftLine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shiftLine, FLOOR_DARK } from "../src/game/shiftLine";

const live = { open: true, allSealed: false, room: true, councilCommittedAt: "2026-09-28T13:00:00.000Z" };

describe("Home's shift clock (design 2026-09-25 §6.5)", () => {
  it("says the machines are online and when they clocked in, in eastern time", () => {
    expect(shiftLine(live)).toBe("3 MACHINES ONLINE · CLOCKED IN 09:00");
    expect(shiftLine({ ...live, councilCommittedAt: "2026-09-28T13:07:00.000Z" })).toBe("3 MACHINES ONLINE · CLOCKED IN 09:07");
  });
  it("says the floor is dark when the round opened without them", () => {
    expect(FLOOR_DARK).toBe("THE FLOOR IS DARK · THE MACHINES DID NOT CLOCK IN");
    expect(shiftLine({ ...live, councilCommittedAt: null })).toBe(FLOOR_DARK);
  });
  it("says nothing between rounds, once every take is sealed, or on a market round", () => {
    expect(shiftLine({ ...live, open: false })).toBeNull();
    expect(shiftLine({ ...live, allSealed: true })).toBeNull();
    expect(shiftLine({ ...live, room: false })).toBeNull();
  });
});
```

Create `apps/mobile/test/lastNight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Reveal } from "@oracle/core";
import { lastNightLine } from "../src/game/lastNight";

type Q = Reveal["questions"][number];
const q = (slot: number, outcome: Q["outcome"], answer: boolean | null, over: Partial<Q> = {}): Q => ({
  id: `5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5${slot}`, slot, text: `take ${slot}`, outcome, crowd_yes_pct: 60, crowd_count: 30, market_prob: null, line_p_yes: 0.4,
  my: answer === null ? null : { answer, confidence: 75, points: null, brier: null, crowd_yes_pct_at_seal: null, crowd_count_at_seal: null, stake: 50, payout: 0, delta: 0, doubled: false, sealed_at: null },
  source_name: "THE PLAYERS", source_url: null, evidence_quote: null, evidence_url: null, void_reason: null, oracle_p_yes: null,
  seen_on: null, unhinged: false, crowd: true, resolved_at: "2026-09-27T16:00:00.000Z", ...over,
});
const reveal = (questions: Q[], over: Partial<Reveal> = {}): Reveal => ({
  rules_version: 3, bonus_points: 0, date: "2026-09-26", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: 1,
  delta: 140, return: 0.14, fortune_after: 1140, house_delta: -140, bust_fortune: null, council: [], evidence: [], reactions: [], lessons: [],
  questions, ledger: { settled: true, streak: 1, calls_rated: 5, oracle_score: null }, ...over,
});

describe("last night on Home (design 2026-09-25 §6.5)", () => {
  it("pairs the night's money with how often the caller read the room", () => {
    const d = reveal([q(1, "yes", true), q(2, "no", false), q(3, "yes", true), q(4, "no", true), q(5, "yes", true)]);
    expect(lastNightLine(d)).toBe("LAST NIGHT · +140 · YOU READ THE ROOM ON 4 OF 5");
  });
  it("prints a loss with a true minus sign, and counts only the takes that settled and were answered", () => {
    const d = reveal([q(1, "yes", false), q(2, "void", true), q(3, "no", null), q(4, "no", false)], { delta: -60 });
    expect(lastNightLine(d)).toBe("LAST NIGHT · −60 · YOU READ THE ROOM ON 1 OF 2");
  });
  it("says nothing while the night is unsettled, unplayed, or was not a night of hot takes", () => {
    expect(lastNightLine(null)).toBeNull();
    expect(lastNightLine(undefined)).toBeNull();
    expect(lastNightLine({ pending: true })).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", true)], { delta: null }))).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", null)]))).toBeNull();
    expect(lastNightLine(reveal([q(1, "yes", true, { crowd: false })]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && pnpm vitest run test/shiftLine.test.ts test/lastNight.test.ts`
Expected: FAIL, neither module resolves.

- [ ] **Step 3: Write the two modules**

Create `apps/mobile/src/game/shiftLine.ts`:

```ts
import { MODEL_MEMBER_IDS } from "@oracle/core";
import { etClock } from "./channel";

// Home's status line while a round is open and there is still a take to seal
// (design 2026-09-25 §6.5): the machines clocked in at 09:00 and have already
// guessed. It names how many and when, and nothing about what they said.
export const FLOOR_DARK = "THE FLOOR IS DARK · THE MACHINES DID NOT CLOCK IN";

export function shiftLine(input: { open: boolean; allSealed: boolean; room: boolean; councilCommittedAt: string | null }): string | null {
  if (!input.open || input.allSealed || !input.room) return null;
  if (input.councilCommittedAt === null) return FLOOR_DARK;
  return `${MODEL_MEMBER_IDS.length} MACHINES ONLINE · CLOCKED IN ${etClock(input.councilCommittedAt)}`;
}
```

Create `apps/mobile/src/game/lastNight.ts`:

```ts
import type { Reveal } from "@oracle/core";
import { signedFortune } from "./fortuneText";

// Last night's result, paired with today's five (design 2026-09-25 §6.5, audit
// E4). The only place Home mentions yesterday. It waits for the round's delta,
// which the route withholds until every take is decided, so the figure never
// climbs after it has been shown.
export function lastNightLine(d: Reveal | { pending: true } | null | undefined): string | null {
  if (!d || "pending" in d || d.delta === null) return null;
  const mine = d.questions.filter((q) => q.crowd && q.my !== null && (q.outcome === "yes" || q.outcome === "no"));
  if (mine.length === 0) return null;
  const read = mine.filter((q) => q.my!.answer === (q.outcome === "yes")).length;
  return `LAST NIGHT · ${signedFortune(d.delta)} · YOU READ THE ROOM ON ${read} OF ${mine.length}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/mobile && pnpm vitest run test/shiftLine.test.ts test/lastNight.test.ts`
Expected: PASS.

- [ ] **Step 5: Home**

In `apps/mobile/src/app/index.tsx`:

1. Imports. Delete `import { houseLines } from "../game/houseLine";`. Add:

```ts
import { shiftLine } from "../game/shiftLine";
import { lastNightLine } from "../game/lastNight";
```

2. Delete the `houseSeenFor` ref and the effect under it that captures `house_headline_viewed`.

3. After `const allSealed = arrival.kind === "submitted";` add:

```ts
  // Last night, from the reading round once it has settled: the latest round
  // this player answered, whatever its date (homeDates.ts explains why that
  // is not calendar yesterday). React Query shares the fetch with the
  // `reveal` above when the two dates coincide.
  const reading = ledger.data?.reading ?? null;
  const lastReveal = useReveal(reading?.settled ? reading.date : null);
  const lastNight = lastNightLine(lastReveal.data);
  const shift = shiftLine({
    open: !!round && arrival.kind !== "waiting",
    allSealed,
    room: round?.questions.some((q) => q.crowd) ?? false,
    councilCommittedAt: round?.council_committed_at ?? null,
  });
```

4. In the JSX, directly above the `{/* The live line: ... */}` comment and the `<OracleClock ... />`, add:

```tsx
        {/* Last night, above the countdown (design 2026-09-25 §6.5). Two
            reserved rows: the line wraps at iPhone width, and it rides the
            record and a reveal, both of which land after first paint. */}
        <View style={{ minHeight: scaledRow(ROW_H.meta, chromeScale) * 2, alignItems: "center", justifyContent: "center" }}>
          {lastNight && reading && (
            <Pressable accessibilityRole="button" hitSlop={{ top: 15, bottom: 15, left: 24, right: 24 }} onPress={() => leaveHome(() => router.push(`/reveal/${reading.date}`))}>
              <Mono {...role.meta} color={colors.goldText} style={[role.meta.style, { textDecorationLine: "underline" }]}>{lastNight}</Mono>
            </Pressable>
          )}
        </View>
```

5. Replace the house block under the clock (the `<View>` that maps `houseLines(ledger.data?.house)`) with:

```tsx
        {/* The shift clock, under the countdown. The slot keeps the two rows
            the house line reserved, so the temple does not move. */}
        <View style={{ minHeight: scaledRow(ROW_H.meta, chromeScale) * 2, alignItems: "center", justifyContent: "center" }}>
          {shift && <Mono {...role.meta} color={colors.mutedInk}>{shift}</Mono>}
        </View>
```

6. In the call slot, last night is the only place Home mentions yesterday, so the settled line yields to it and the button stays:

```tsx
          {slot.kind !== "none" && (
            <>
              {!(slot.kind === "settled" && lastNight) && <DecodeLine active={booted} text={slot.line} {...role.line} color={colors.goldText} />}
              <GoldButton title={slot.cta} onPress={() => leaveHome(() => router.push(`/reveal/${slot.date}`))} />
            </>
          )}
```

- [ ] **Step 6: Retire the house line**

```bash
git rm apps/mobile/src/game/houseLine.ts apps/mobile/test/houseLine.test.ts
```

In `apps/mobile/src/analytics/analytics.ts`, delete `| "house_headline_viewed"` from the union.

- [ ] **Step 7: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS. `typecheck` proves nothing still imports `houseLine` or captures the retired event.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/shiftLine.ts apps/mobile/src/game/lastNight.ts apps/mobile/test/shiftLine.test.ts apps/mobile/test/lastNight.test.ts apps/mobile/src/app/index.tsx apps/mobile/src/analytics/analytics.ts
git commit -m "feat(mobile): home's shift clock and last night; the house line leaves home

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 10: The share card — the log excerpt

**Files:**
- Create: `apps/mobile/src/game/shareExcerpt.ts`, `apps/mobile/test/shareExcerpt.test.ts`
- Modify: `apps/mobile/src/game/shareLines.ts` (`fortuneShareMessage`), `apps/mobile/src/ui/ShareCard.tsx`, `apps/mobile/src/app/reveal/[date].tsx`
- Test: `apps/mobile/test/shareLines.test.ts`

**Interfaces:**
- Consumes: `etClock`, `nick`, `sharePct`, `channelHeader`, `revealLog` (Task 6); `sideWord` (Task 4); the reveal's `my.sealed_at` (Task 1).
- Produces:
  - `EXCERPT_COLS = 46`
  - `interface ExcerptLine { text: string; tone: "head" | "win" | "loss" | "mute" | "you" }`
  - `asciiOnly(s: string): string`
  - `shareExcerpt(input: { date: string; log: ReadonlyArray<LogLine>; my: { answer: boolean; sealedAt: string | null } | null }): ExcerptLine[]`
  - `excerptEnds(lines: ReadonlyArray<ExcerptLine>): [string, string] | null`
  - `fortuneShareMessage(d: { date; delta; fortuneAfter; results; excerpt?: [string, string] | null }, url?)`
  - `ShareCardData.excerpt?: ReadonlyArray<ExcerptLine>`

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/shareExcerpt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { LogLine } from "@oracle/core";
import { shareExcerpt, excerptEnds, asciiOnly, EXCERPT_COLS } from "../src/game/shareExcerpt";

const say = (member: "haiku" | "sonnet" | "opus", p: number | null, text: string, at: string, tone: LogLine["tone"]): LogLine => ({ at, kind: "say", member, text, p_yes: p, tone });
const LOG: LogLine[] = [
  say("haiku", 0.31, "no chance", "2026-09-25T13:00:00.000Z", "loss"),
  say("sonnet", 0.44, "", "2026-09-25T13:00:01.000Z", "loss"),
  say("opus", 0.4, "On reflection — and I said this about “cereal” on the 19th — the room will not go for it 🙃", "2026-09-25T13:00:02.000Z", "loss"),
  { at: "2026-09-26T16:00:00.000Z", kind: "system", member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null, tone: "mute" },
  say("haiku", null, "ok the room is wrong", "2026-09-26T16:01:00.000Z", "loss"),
  { at: "2026-09-26T16:02:00.000Z", kind: "note", member: "sonnet", text: "weigh the villain.", p_yes: null, tone: "mute" },
];
const mine = { answer: true, sealedAt: "2026-09-25T16:14:00.000Z" };

describe("the share card's excerpt (design 2026-09-25 §6.6)", () => {
  it("prints the header, one line per machine, the caller, the room, then the reactions", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: mine });
    expect(out.map((l) => l.text)).toEqual([
      "#nightshift · 09-25",
      "09:00 <haiku>   31  no chance",
      "09:00 <sonnet>  44",
      "09:00 <opus>    40  On reflection - and I s...",
      "12:14 <you>     AGREE",
      "12:00 *** THE ROOM AGREED · 62%",
      "12:01 <haiku>   ok the room is wrong",
    ]);
    expect(out.map((l) => l.tone)).toEqual(["head", "loss", "loss", "loss", "you", "mute", "loss"]);
  });
  it("keeps every line inside the card's measure and inside the font", () => {
    for (const l of shareExcerpt({ date: "2026-09-25", log: LOG, my: mine })) {
      expect(l.text.length, l.text).toBeLessThanOrEqual(EXCERPT_COLS);
      expect(l.text, l.text).toMatch(/^[\x20-\x7E·]*$/);
    }
  });
  it("leaves the notes to self off the card, and the caller off when they sat it out", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: null });
    expect(out.some((l) => l.text.includes("note to self"))).toBe(false);
    expect(out.some((l) => l.text.includes("<you>"))).toBe(false);
  });
  it("prints a blank clock when the seal time is unknown, and disagree in full", () => {
    const out = shareExcerpt({ date: "2026-09-25", log: LOG, my: { answer: false, sealedAt: null } });
    expect(out[4]!.text).toBe("--:-- <you>     DISAGREE");
  });
  it("is empty when no machine clocked in", () => {
    expect(shareExcerpt({ date: "2026-09-25", log: [], my: mine })).toEqual([]);
  });
  it("strips what the card's font cannot draw", () => {
    expect(asciiOnly("“quoted” — it’s… fine 🙃")).toBe("\"quoted\" - it's... fine");
    expect(asciiOnly("a\n  b")).toBe("a b");
  });
  it("hands the share message its first and last lines, single-spaced", () => {
    expect(excerptEnds(shareExcerpt({ date: "2026-09-25", log: LOG, my: mine }))).toEqual(["#nightshift · 09-25", "12:01 <haiku> ok the room is wrong"]);
    expect(excerptEnds([])).toBeNull();
  });
});
```

Append to `apps/mobile/test/shareLines.test.ts`, inside its `describe`:

```ts
  it("carries the excerpt's first and last lines, each on its own line, ahead of the link", () => {
    const d = { date: "2026-09-25", delta: 140, fortuneAfter: 1140, results: ["win", "loss", "win", "win", "void"] as const, excerpt: ["#nightshift · 09-25", "12:01 <haiku> ok the room is wrong"] as [string, string] };
    expect(fortuneShareMessage(d, "https://x.y")).toBe("🔮 OUTSEEN 2026-09-25 — I✓ II✗ III✓ IV✓ V∅ · +140 · FORTUNE 1,140 · can you beat the house?\n#nightshift · 09-25\n12:01 <haiku> ok the room is wrong\nhttps://x.y");
    expect(fortuneShareMessage(d, null).endsWith("12:01 <haiku> ok the room is wrong")).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/mobile && pnpm vitest run test/shareExcerpt.test.ts test/shareLines.test.ts`
Expected: FAIL. `shareExcerpt` does not resolve; the message test receives the message without the excerpt.

- [ ] **Step 3: Write `shareExcerpt.ts`**

Create `apps/mobile/src/game/shareExcerpt.ts`:

```ts
import type { LogLine } from "@oracle/core";
import { channelHeader, etClock, nick, sharePct } from "./channel";
import { sideWord } from "./sideWords";

// The night card's middle block (design 2026-09-25 §6.6): the Big One's
// channel, cut to what fits. Skia text does not wrap and has no font fallback,
// so every line is one row of the mono face, inside the card's measure, in
// printable ASCII and the middle dot. Pure; ShareCard draws what this returns.
//
// 46 columns: IBM Plex Mono advances 0.6em, so at the card's 18px each column
// is 10.8px and the 500px between the card's inner margins holds 46.
export const EXCERPT_COLS = 46;
// The widest nick, `<sonnet>`, and two spaces after it.
const NICK_COLS = 10;

export interface ExcerptLine { text: string; tone: "head" | "win" | "loss" | "mute" | "you" }

// What a member wrote is model output: curly quotes, dashes, emoji. The quotes
// and dashes are translated; anything else the face cannot draw is dropped.
export function asciiOnly(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E·\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fit(text: string): string {
  const flat = text.trimEnd();
  return flat.length <= EXCERPT_COLS ? flat : `${flat.slice(0, EXCERPT_COLS - 3).trimEnd()}...`;
}

const row = (stamp: string, who: string, rest: string) => fit(`${stamp} ${who.padEnd(NICK_COLS)}${rest}`);

export function shareExcerpt(input: { date: string; log: ReadonlyArray<LogLine>; my: { answer: boolean; sealedAt: string | null } | null }): ExcerptLine[] {
  const guesses = input.log.filter((l) => l.kind === "say" && l.p_yes !== null);
  if (guesses.length === 0) return [];
  const out: ExcerptLine[] = [{ text: channelHeader(input.date), tone: "head" }];
  for (const l of guesses) {
    out.push({ text: row(etClock(l.at), nick(l.member), [sharePct(l.p_yes!), asciiOnly(l.text)].filter(Boolean).join("  ")), tone: l.tone });
  }
  if (input.my) {
    out.push({ text: row(input.my.sealedAt === null ? "--:--" : etClock(input.my.sealedAt), "<you>", sideWord(input.my.answer, true)), tone: "you" });
  }
  const verdict = input.log.find((l) => l.kind === "system");
  // The card is a screenshot of a result, not a census: the head count the
  // channel prints on the reveal stays there.
  if (verdict) out.push({ text: fit(`${etClock(verdict.at)} *** ${asciiOnly(verdict.text.replace(/ · \d+ PLAYERS?$/, ""))}`), tone: "mute" });
  for (const l of input.log.filter((r) => r.kind === "say" && r.p_yes === null)) {
    out.push({ text: row(etClock(l.at), nick(l.member), asciiOnly(l.text)), tone: "loss" });
  }
  return out;
}

// The share message carries the excerpt's first and last lines (design §6.6).
// The card pads its columns; a message does not.
export function excerptEnds(lines: ReadonlyArray<ExcerptLine>): [string, string] | null {
  if (lines.length < 2) return null;
  const flat = (s: string) => s.replace(/\s+/g, " ");
  return [flat(lines[0]!.text), flat(lines[lines.length - 1]!.text)];
}
```

- [ ] **Step 4: Carry the excerpt in the share message**

In `apps/mobile/src/game/shareLines.ts`, replace `fortuneShareMessage`:

```ts
export function fortuneShareMessage(
  d: { date: string; delta: number; fortuneAfter: number; results: ReadonlyArray<QuestionResult>; excerpt?: [string, string] | null },
  url: string | null = SHARE_URL,
): string {
  const body = `🔮 OUTSEEN ${d.date} — ${patternLine(d.results)} · ${signedFortune(d.delta)} · FORTUNE ${formatFortune(d.fortuneAfter)} · can you beat the house?`;
  // With the channel on the card, the message quotes it: each on its own
  // line, so the link still ends the message where a client can find it.
  if (d.excerpt) return [body, d.excerpt[0], d.excerpt[1], ...(url ? [url] : [])].join("\n");
  return url ? `${body} ${url}` : body;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/mobile && pnpm vitest run test/shareExcerpt.test.ts test/shareLines.test.ts`
Expected: PASS.

- [ ] **Step 6: Draw the excerpt**

In `apps/mobile/src/ui/ShareCard.tsx`:

1. Add `import type { ExcerptLine } from "../game/shareExcerpt";` and, in `ShareCardData`, after `bigOneLine?: string | null;`:

```ts
  // The Big One's channel (design 2026-09-25 §6.6). PRESENCE is the switch,
  // as with `fortuneDelta`: a caller with a log sets it and the canvas prints
  // the excerpt where the orb stood; a market round omits the key.
  excerpt?: ReadonlyArray<ExcerptLine>;
```

2. Add beside the other module constants:

```ts
const EXCERPT_X = INSET + 40;
const EXCERPT_Y = 268;
const EXCERPT_ROW = 32;
const EXCERPT_TONE: Record<ExcerptLine["tone"], string> = { head: colors.agedGold, win: colors.warmCenter, loss: NIGHT_LOSS, mute: NIGHT_DIM, you: colors.museumWhite };
```

Nine rows at most (the header, three machines, the caller, the room, three reactions) end at y 524, clear of the pattern row at 672.

3. In `ShareCardCanvas`, add `const excerpt = data.excerpt && data.excerpt.length > 0 ? data.excerpt : null;` beside `const fortune = ...`. Change the middle block's condition from `{duelScores && portrait ? <> ... </> : <> ... </>}` to a three-way: the duel portrait first, then the excerpt, then the orb:

```tsx
      {duelScores && portrait ? <>
        {/* unchanged: the duel portrait, its labels and its scores */}
      </> : excerpt ? <>
        {/* The card keeps its frame, numeral and wordmark; the middle block
            is the channel (design 2026-09-25 §6.6). Left-aligned on the
            card's inner margin, because a log is read down its columns. */}
        {mono && excerpt.map((l, i) => (
          <SkText key={i} font={mono} text={l.text} x={EXCERPT_X} y={EXCERPT_Y + i * EXCERPT_ROW} color={EXCERPT_TONE[l.tone]} />
        ))}
      </> : <>
        {/* unchanged: the glow, the patina halo and the orb */}
      </>}
```

Keep the two existing branches' contents exactly as they are; only the middle branch is new.

- [ ] **Step 7: Hand the reveal's excerpt to the card**

In `apps/mobile/src/app/reveal/[date].tsx`, add:

```ts
import { shareExcerpt, excerptEnds } from "../../game/shareExcerpt";
```

Above `const cardData`, add:

```ts
  const excerpt = bigRoom && big
    ? shareExcerpt({ date: d.date, log: revealLog(d, big), my: big.my ? { answer: big.my.answer, sealedAt: big.my.sealed_at } : null })
    : [];
```

Inside `cardData`, after the `...(fortuneRound ? { ... } : {})` spread, add:

```ts
    ...(excerpt.length > 0 ? { excerpt } : {}),
```

In `onShare`, pass the excerpt to the message:

```ts
        ? shareSnapshot(canvasRef, `oracle-${d.date}.png`, fortuneShareMessage({ date: d.date, delta: d.delta!, fortuneAfter: d.fortune_after!, results, excerpt: excerptEnds(excerpt) }))
```

- [ ] **Step 8: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/game/shareExcerpt.ts apps/mobile/test/shareExcerpt.test.ts apps/mobile/src/game/shareLines.ts apps/mobile/test/shareLines.test.ts apps/mobile/src/ui/ShareCard.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "feat(mobile): the channel on the share card

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 11: The record — reading the room

**Files:**
- Create: `apps/mobile/src/game/roomRecord.ts`, `apps/mobile/test/roomRecord.test.ts`
- Modify: `apps/mobile/src/app/ledger.tsx`

**Interfaces:**
- Consumes: `MeLedger["room"]` (Tasks 1, 2).
- Produces: `roomRows(room: MeLedger["room"] | undefined): { read: string; missed: string; verdict: string | null; gold: boolean } | null`, `ROOM_READ_LABEL = "READ THE ROOM"`, `ROOM_MISSED_LABEL = "THE MACHINES MISSED"`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/roomRecord.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { roomRows, ROOM_READ_LABEL, ROOM_MISSED_LABEL } from "../src/game/roomRecord";

const room = (days: number, read: number, missed: number) => ({ days, days_read: read, days_machines_missed: missed, read_rate_30d: null, calls_30d: 0 });

describe("the record's room rows (design 2026-09-25 §6.4)", () => {
  it("names the two rows", () => {
    expect(ROOM_READ_LABEL).toBe("READ THE ROOM");
    expect(ROOM_MISSED_LABEL).toBe("THE MACHINES MISSED");
  });
  it("counts both out of the same days", () => {
    expect(roomRows(room(9, 6, 3))).toEqual({ read: "6 OF 9 DAYS", missed: "3 OF 9", verdict: "YOU READ THE ROOM BETTER THAN THE MACHINES", gold: true });
    expect(roomRows(room(1, 1, 0))!.read).toBe("1 OF 1 DAY");
  });
  it("gives the machines the line when they missed more days than the caller read", () => {
    expect(roomRows(room(9, 2, 5))).toMatchObject({ verdict: "THE MACHINES READ IT BETTER", gold: false });
  });
  it("says nothing when the two are level", () => {
    expect(roomRows(room(9, 4, 4))).toMatchObject({ verdict: null, gold: false });
  });
  it("has no rows before the first settled hot take, or from an older server", () => {
    expect(roomRows(room(0, 0, 0))).toBeNull();
    expect(roomRows(null)).toBeNull();
    expect(roomRows(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/mobile && pnpm vitest run test/roomRecord.test.ts`
Expected: FAIL, cannot resolve `../src/game/roomRecord`.

- [ ] **Step 3: Write `roomRecord.ts`**

Create `apps/mobile/src/game/roomRecord.ts`:

```ts
import type { MeLedger } from "@oracle/core";

// The record's two room rows and the verdict under them (design 2026-09-25
// §6.4). The comparison is the design's own: the days the caller read against
// the days the machines missed. Level says nothing.
export const ROOM_READ_LABEL = "READ THE ROOM";
export const ROOM_MISSED_LABEL = "THE MACHINES MISSED";

export function roomRows(room: MeLedger["room"] | undefined): { read: string; missed: string; verdict: string | null; gold: boolean } | null {
  if (!room || room.days === 0) return null;
  const ahead = room.days_read > room.days_machines_missed;
  const behind = room.days_read < room.days_machines_missed;
  return {
    read: `${room.days_read} OF ${room.days} ${room.days === 1 ? "DAY" : "DAYS"}`,
    missed: `${room.days_machines_missed} OF ${room.days}`,
    verdict: ahead ? "YOU READ THE ROOM BETTER THAN THE MACHINES" : behind ? "THE MACHINES READ IT BETTER" : null,
    gold: ahead,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/mobile && pnpm vitest run test/roomRecord.test.ts`
Expected: PASS.

- [ ] **Step 5: The record screen**

In `apps/mobile/src/app/ledger.tsx`:

1. Add `import { roomRows, ROOM_READ_LABEL, ROOM_MISSED_LABEL } from "../game/roomRecord";`.

2. Under `const d = ledger.data ?? null;` add `const room = roomRows(d?.room);`.

3. After the `<Stat label="STREAK" ... />` line and before the streak's gloss, add:

```tsx
                {/* Reading the room (design 2026-09-25 §6.4), under the two
                    counts it belongs with. Absent until the first hot take
                    settles, so a new record shows no empty rows. */}
                {room && (
                  <>
                    <Stat label={ROOM_READ_LABEL} value={room.read} />
                    <Stat label={ROOM_MISSED_LABEL} value={room.missed} />
                    {room.verdict && (
                      <Mono {...role.line} color={room.gold ? colors.goldText : colors.mutedInk} style={[role.line.style, { textAlign: "left" }]}>{room.verdict}</Mono>
                    )}
                  </>
                )}
```

4. The subtitle under the eyebrow names what the record holds. Change `Your fortune, your best, your streak` to `Your fortune, your best, your streak, the room`.

`PLAQUE_MIN_H` stays 300. It is the floor the loading frame shares with the plaque; the room rows arrive with the record itself, in the same paint as every other row, and a player with no settled hot take has none.

- [ ] **Step 6: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/roomRecord.ts apps/mobile/test/roomRecord.test.ts apps/mobile/src/app/ledger.tsx
git commit -m "feat(mobile): the record reads the room

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 12: Practice — the channel after the result

**Files:**
- Modify: `apps/mobile/src/ui/PracticeCard.tsx`

**Interfaces:**
- Consumes: `ChannelLog` (Task 6); `Exhibition["log"]`, `Exhibition["crowd"]`, `Exhibition["roundDate"]` (plan 1); `practiceResult`'s room wording (Task 4).
- Produces: nothing new. `GET /v1/round/exhibition` already serves the log on a past hot take, built server-side with its outcome, so the tones are already win and loss.

- [ ] **Step 1: Print the channel under the result**

In `apps/mobile/src/ui/PracticeCard.tsx`, add `import { ChannelLog } from "./ChannelLog";`. In `PracticeResult`, after the `<Mono ...>{result.counterfactual}</Mono>` line, add:

```tsx
    {/* Practice ends where a real round does: with what the machines guessed
        and what they said when the room proved them wrong (design 2026-09-25
        §11). A market question and the made-up example have no channel. */}
    {exhibition.crowd && exhibition.log.length > 0 && (
      <ChannelLog date={roundDate ?? ""} log={exhibition.log} defaultOpen collapsible={false} />
    )}
```

- [ ] **Step 2: Run everything mobile**

Run: `cd apps/mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/PracticeCard.tsx
git commit -m "feat(mobile): practice ends with the channel

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 13: Verification — the suites, the simulator, the record of what was built

**Files:**
- Create: `docs/superpowers/plans/assets/nightshift-build-14/` (screenshots)
- Modify: `docs/superpowers/specs/2026-09-25-nightshift-design.md` (append §18), `docs/launch-playbook.md` (§4, a new 4.8)

- [ ] **Step 1: Run everything**

Run, in the foreground: `pnpm -r typecheck && (cd packages/core && pnpm vitest run) && (cd apps/mobile && pnpm vitest run) && (cd apps/api && pnpm vitest run && pnpm test:workflows)`
Expected: all green. Record the three counts. Before this plan: core 261, mobile 455, api 818 plus workflows 5.

- [ ] **Step 2: Sweep for the old words**

Run: `grep -rnE '"(YES|NO)"|SAY YES|SAID YES|% YES' apps/mobile/src --include='*.ts' --include='*.tsx'`
Expected: every hit is inside `game/sideWords.ts`, behind a `room` branch whose other arm is the agree wording, in a points-era path a hot take never reaches (`revealRows.callLine`, `revealRows.rowRight`, `RevealSummary.tsx`, the reveal's `YOU: ... @` and `THE ORACLE FORESAW` lines, all gated on `!fortuneRound`), or in the market line (`THE MARKET SAID`). Any other hit is a string a player can read on a hot take: route it through `sideWord`, `outcomeWord` or `shareSoFar` and add the case to that helper's test.

- [ ] **Step 3: The simulator pass**

Use the `run-oracle-mobile` skill to build and launch the app against the dev API (`apps/api`, `nohup npx wrangler dev &`, wait for a 401 on `/v1/round/today`). The dev database needs an open round of hot takes with Council lines; seed one with `POST /admin/rounds/<today>/author?kind=opinion`, publish it, and run `POST /admin/rounds/<today>/council`. Capture each of these to `docs/superpowers/plans/assets/nightshift-build-14/`:

| File | What it must show |
| --- | --- |
| `card-agree.png` | A hot take with AGREE and DISAGREE, `SEEN ON ...` or `THE NIGHT SHIFT` in the margin, the hint `RIGHT TO AGREE, LEFT TO DISAGREE`, nothing about the room |
| `card-unhinged.png` | The unhinged take with `UNHINGED` under its title |
| `log-after-seal.png` | The channel over the lower stage after a seal, three `say` lines, muted nicks, the footer's receipt reading `AGREE · THE ORACLE EXPECTED n% TO AGREE` |
| `tray.png` | Five tiles priced, the side marks in agree and disagree |
| `finale.png` | The sealed calls with each channel collapsed to its row of shares |
| `home-shift.png` | `3 MACHINES ONLINE · CLOCKED IN 09:00` under the countdown, no house line |
| `home-last-night.png` | `LAST NIGHT · ...` above the countdown (needs a settled round the device played) |
| `reveal-channel.png` | The Big One's channel open: tone colours on the nicks, the `***` room line, a reaction, a dimmed note |
| `share-card.png` | The night card with the excerpt where the orb stood (render it on screen the way the delight pass did: temporarily `left: 0` and a scale on the canvas, then revert) |
| `record-room.png` | `READ THE ROOM` and `THE MACHINES MISSED` under the streak |

Check by eye, and fix before moving on: no line of the channel is clipped at the right edge; `DISAGREE` fits its button at the smallest simulator width; the log panel never covers the TopBar; with Reduce Motion on, the channel's lines appear at once and the buttons are the only way to seal.

- [ ] **Step 4: As built**

Append to `docs/superpowers/specs/2026-09-25-nightshift-design.md`:

```markdown
## 18. As built, plan 2 (build 14)

- **The build number.** This document calls the release build 13. Build 13 was cut from the plan 1 merge and carries no night-shift interface; everything in §12 shipped as build 14.
- **§6.2 the log after the seal.** The channel opens as a panel over the lower stage, with the next card already dealt beneath it, and closes on a tap above it or on `DRAW THE NEXT CARD`. It does not resize the stage: a card that changed height as the log opened would move under the thumb. Collapsed, the footer prints the summary row as the way back in.
- **§6.2 the line.** Build 14 never reads `line_p_yes` from `GET /v1/round/today`. The field is removed from the route in a later deploy, once build 14 is the oldest build in use (N5 as amended in §17).
- **§6.3 three reveal fields.** The reveal's questions gained `crowd`, `resolved_at` and `my.sealed_at`. The client could not build the room's line, key its strings, or stamp `<you>` on the share card without them.
- **§6.4 the denominator.** The ledger's `room` block gained `days`, the number both counts are out of. The day counts run over the whole record; the rate over thirty days.
- **§6.5 last night.** The line reads the record's reading round, not calendar yesterday, so it tracks the round that last settled whatever the clock says. When it prints, the call slot's `THE NIGHT IS SETTLED` yields to it and the button stays.
- **§6.6 the excerpt.** Notes to self stay off the card. The room's line drops its head count. Each line is cut to 46 columns with three full stops, because the card's mono face has no fallback for anything else.
- **§7 the hint.** `RIGHT TO AGREE, LEFT TO DISAGREE`: the hint drops "swipe" to stay the length of the market hint, which already fills the card's measure.
- **§13 analytics.** `log_opened` and `channel_expanded` ship; `room_board_viewed` is plan 3's. `house_headline_viewed` is retired with the line it counted.
- Suites at merge: core N, mobile N, api N (fill in from Task 13 Step 1).
```

Add to `docs/launch-playbook.md`, after §4.7:

```markdown
### 4.8 Build 14 — the night shift

1. Deploy the API first. It is additive: three reveal fields and the ledger's `room` block. Builds 12 and 13 ignore all of it.
2. Build and submit: `cd apps/mobile && eas build --profile production --platform ios --auto-submit`.
3. Device pass on the TestFlight install, on top of §4.6: seal a hot take and read the channel; place the double from the tray; open the reveal after noon and expand a channel; share the night card and read the excerpt in Messages.
4. `line_p_yes` leaves `GET /v1/round/today` only after every tester is on build 14. Builds 12 and 13 price the tray from it; removing it early hides their tray. The change is plan 2's Task 15.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/assets/nightshift-build-14 docs/superpowers/specs/2026-09-25-nightshift-design.md docs/launch-playbook.md
git commit -m "docs: night shift plan 2, as built and rollout

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 14: Release — merge, deploy, build 14

Every step here reaches production or the App Store. **Stop and get Erik's go before each one.**

- [ ] **Step 1: Final review and merge**

Use superpowers:requesting-code-review on the branch, fix what it finds, then superpowers:finishing-a-development-branch to merge `nightshift-build-14` to `main` and push.

- [ ] **Step 2: Deploy the API**

Run: `cd apps/api && npx wrangler deploy`
Then smoke it with a device token: `GET /v1/me/ledger` carries `room`; `GET /v1/round/<a settled date>/reveal` carries `crowd` and `resolved_at` on each question. There is no migration.

- [ ] **Step 3: Build and submit**

Run: `cd apps/mobile && eas build --profile production --platform ios --auto-submit`
Record the build and submission ids in the playbook's §0.

- [ ] **Step 4: Device pass**

Playbook §4.8 step 3, on the TestFlight install.

---

### Task 15: `line_p_yes` leaves `/today` (gated on build 14's adoption)

**Do not start this task until every tester is on build 14.** Builds 12 and 13 price the tray from this field.

**Files:**
- Modify: `apps/api/src/routes/round.ts` (the `/today` handler)
- Test: `apps/api/test/today-log.test.ts`

**Interfaces:**
- Produces: `GET /v1/round/today` no longer serves `line_p_yes`. `RoundTodaySchema.line_p_yes` stays optional and nullable for one more release, so it parses as `null`.

- [ ] **Step 1: Rewrite the expectation**

In `apps/api/test/today-log.test.ts`, in the first test, replace the two assertions after `await seal(qs[0]!.id, true);` with:

```ts
    const after = RoundTodaySchema.parse(await (await as("/v1/round/today")).json());
    // The line left this route (design 2026-09-25 N5). A sealed question
    // reads it from /today/log and from nowhere else.
    expect(after.questions.every((q) => q.line_p_yes === null)).toBe(true);
    const log = TodayLogSchema.parse(await (await as("/v1/round/today/log")).json());
    expect(log.questions.find((q) => q.question_id === qs[0]!.id)!.line_p_yes).toBe(0.38);
```

and rename the test to `"carries the shift clock and each take's provenance, and never the line"`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/today-log.test.ts`
Expected: FAIL, slot 1 carries 0.38.

- [ ] **Step 3: Remove the field**

In `apps/api/src/routes/round.ts`, in the `/today` handler: delete the `line_p_yes: ...` property from the question map; delete the third entry of the `Promise.all` (the `predictions.findMany` that reads the caller's sealed rows) and `sealedRows` from its destructuring; delete `const sealed = new Set(...)`; and replace the comment about the line above the `Promise.all` with:

```ts
    // The line is not served here (design 2026-09-25 N5). It is a common
    // signal before the seal, and after it the channel carries it.
```

- [ ] **Step 4: Run the suite**

Run: `cd apps/api && pnpm typecheck && pnpm vitest run`
Expected: PASS. If `round-v3.test.ts` or `predictions-stake.test.ts` asserts a line on `/today`, move the assertion to `/today/log`.

- [ ] **Step 5: Commit, then deploy on Erik's go**

```bash
git add apps/api/src/routes/round.ts apps/api/test/today-log.test.ts
git commit -m "feat(api): the line leaves /today; the channel carries it

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

Deploy with `cd apps/api && npx wrangler deploy` once Erik confirms.

---

## Self-Review

**Spec coverage.** §6.1 is plan 1's. §6.2: Tasks 6, 7, 15. §6.3: Tasks 1, 2, 6, 8. §6.4: Tasks 1, 2, 11. §6.5: Task 9; the hinge push's deep link is unchanged here because the push trigger is still unwired (`apps/api/src/push/compose.ts`). §6.6: Task 10. §7: buttons, receipt, verdict, reveal and practice strings in Tasks 4, 5, 8; intro, rules and `opponentChallenge` in Task 3; the site lede, store subtitle and standings page are plan 3's and a hand edit in App Store Connect. §12: every bullet has a task except the money screen's board, which is plan 3's. §13: Tasks 5, 6, 7, 8, 9. §14's mobile line: each named test exists in Tasks 4 to 11.

**Types.** `room: boolean` is the one name for the flag in every mobile signature. `lineOf: LineOf` sits before `now` in both tray functions. `onSealed(answer: boolean)` in Task 5 is what Task 7 consumes. `SealedLog.line` is what `lineOf` and the receipt read. `ExcerptLine` is defined in Task 10 and used only there. `sealed_at`, `resolved_at` and `crowd` are defined in Task 1, served in Task 2, read in Tasks 6, 8, 9, 10.

