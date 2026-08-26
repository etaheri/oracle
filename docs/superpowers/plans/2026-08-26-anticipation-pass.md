# Anticipation Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the deferred tier-2 delight items plus the first Plan-3 correctness item: played-state hydrated from the server, a ticking lock countdown on home, day points that roll up before the haptic, and a proper celebration for the against-the-tide ×2 win.

**Architecture:** One tiny API addition (`GET /v1/round/today/mine` — the caller's own predictions for the open round; anti-herding unaffected since it returns only the caller's data) feeds a `hydrate` action on the zustand round store (server wins on collision). The countdown ticks against the existing `locks_at` field (the reveal endpoint 409s until questions lock, so lock time IS when the ledger becomes readable — no new timestamp needed). Ceremony upgrades are client-only: a JS-driven rolling number (Reanimated can't animate Text content without a TextInput bridge; a 700ms one-shot doesn't warrant one) and a Keyframe wash-flash + double haptic + Cinzel ×2 for the contrarian win. All pure logic (`msUntil`/`formatCountdown`, `hydrate`) is TDD'd in the existing node vitest suites.

**Tech Stack:** Hono + Drizzle (API), zod (@oracle/core schemas), @tanstack/react-query, zustand, react-native-reanimated 4.5.1, expo-haptics, vitest.

**Spec:** `docs/superpowers/plans/2026-08-20-oracle-mobile-core-loop.md` §"Follow-ups carried out of Plan 2's final review" (hydration is the named first Plan-3 item: "Client must treat server as source of truth on collision") + the approved delight ideation tier 2 (parent conversation, 2026-08-26) + brand brief §7 (machine-voice chrome) in `docs/superpowers/specs/2026-08-26-oracle-brand-brief.md`.

## Global Constraints

- No new npm dependencies anywhere in the monorepo.
- House easing is `Easing.out(Easing.poly(4))` (Reanimated) / `1 - Math.pow(1 - p, 4)` (JS-side equivalent).
- Every animation has a `useReducedMotion` fallback: countdown may tick (it is text, not motion), the points roll snaps to the final value, the tide flash and extra haptics are skipped.
- The anti-herding wall is inviolable: `/today/mine` must return ONLY the caller's own predictions; no crowd data leaks pre-seal.
- Server is the source of truth on hydration collisions: a server-known prediction overwrites any local draft or divergent replay, and is always `sealed: true`.
- Sleeve/palette rules: countdown and captions are machine-voice `Mono` in `mutedInk`; celebration uses `goldText`/`agedGold`; never introduce new colors.
- Workers are NEVER run against the production DB — API tests use `makeTestDb()` (in-memory) exactly like the existing suites.
- Verification commands (repo root): `pnpm --filter @oracle/api test` (currently 7 suites), `pnpm --filter @oracle/api typecheck`, `pnpm --filter @oracle/mobile exec tsc --noEmit`, `pnpm --filter @oracle/mobile test` (currently 21 tests — totals grow with this plan; all must be green).
- Mobile tests live in `apps/mobile/test/*.test.ts`, import from `../src/...`, and must not transitively import Skia/Expo/react-native modules — pure logic goes in `src/game/`.
- Simulator workflow: Metro runs from `apps/mobile` on :8081; wrangler dev on :8787 from `apps/api`; booted simulator UDID `87FDFF2C-2B44-481C-B5C0-2ECE9FB75F00`. Fast Refresh from the nohup'd Metro silently fails — for EVERY visual check: `xcrun simctl terminate <UDID> host.exp.Exponent; xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/<path>"; sleep 22; xcrun simctl io <UDID> screenshot <file>`, then Read the screenshot.
- The dev DB's open round is stale (2026-08-21, `locks_at` in the past) — countdown verification therefore uses a temp future timestamp and the fallback path, with every temp edit reverted before commit (`git diff` must show only intended changes).

---

### Task 1: API — GET /v1/round/today/mine (TDD)

**Files:**
- Modify: `packages/core/src/schemas.ts` (append after `RoundTodaySchema`)
- Modify: `apps/api/src/routes/round.ts` (new route after `/today/crowd`)
- Test: `apps/api/test/mine.test.ts` (create)

**Interfaces:**
- Produces: `GET /v1/round/today/mine` → 200 `{ predictions: [{ question_id: uuid, answer: boolean, confidence: int }] }` for the open round (empty array if none sealed); 404 when no open round. Core exports `MineTodaySchema` and `type MineToday`. Task 2 consumes both.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/mine.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/round/today/mine", () => {
  it("returns only the caller's own predictions for the open round", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b] = [await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[1]!.id, false) }); // another player — must not leak

    const res = await a("/v1/round/today/mine");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { predictions: Array<{ question_id: string; answer: boolean; confidence: number }> };
    expect(out.predictions).toEqual([{ question_id: qs[0]!.id, answer: true, confidence: 85 }]);
  });

  it("empty when the caller sealed nothing; 404 with no open round", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    expect((await a("/v1/round/today/mine")).status).toBe(404);
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await a("/v1/round/today/mine");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { predictions: unknown[] }).predictions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/api test`
Expected: mine.test.ts FAILS (404 route not found → status expectations fail); all pre-existing suites still pass.

- [ ] **Step 3: Implement**

Append to `packages/core/src/schemas.ts`:

```ts
export const MineTodaySchema = z.object({
  predictions: z.array(
    z.object({
      question_id: z.string().uuid(),
      answer: z.boolean(),
      confidence: z.number().int(),
    }),
  ),
});
export type MineToday = z.infer<typeof MineTodaySchema>;
```

In `apps/api/src/routes/round.ts`, add after the `/today/crowd` handler (before `/:date/reveal` — route order matters so `today` isn't captured as a `:date` param):

```ts
  .get("/today/mine", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.status, "open") });
    if (!round) return c.json({ error: "no open round" }, 404);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, round.date) });
    const mine = qs.length
      ? await db.query.predictions.findMany({
          where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))),
        })
      : [];
    return c.json({
      predictions: mine.map((p) => ({ question_id: p.questionId, answer: p.answer, confidence: p.confidence })),
    });
  })
```

(`and`, `eq`, `inArray` are already imported at the top of round.ts.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: all suites pass including mine.test.ts; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/round.ts apps/api/test/mine.test.ts
git commit -m "feat(api): GET /v1/round/today/mine — caller's own predictions"
```

---

### Task 2: Hydrate played-state from the server (TDD)

**Files:**
- Modify: `apps/mobile/src/game/roundStore.ts` (add `hydrate` action)
- Modify: `apps/mobile/src/api/hooks.ts` (add `useMineToday`; invalidate `["round","mine"]` in `useSubmit`)
- Create: `apps/mobile/src/game/useHydratePlayedState.ts`
- Modify: `apps/mobile/src/app/index.tsx`, `apps/mobile/src/app/round.tsx` (call the hook)
- Test: `apps/mobile/test/roundStore.test.ts` (append)

**Interfaces:**
- Consumes: `MineTodaySchema` from @oracle/core (Task 1); existing `api`/`ApiError`/`getDeviceToken`.
- Produces: `useRoundStore.hydrate(predictions: ReadonlyArray<{ question_id: string; answer: boolean; confidence: number }>): void`; `useMineToday(enabled: boolean)` (queryKey `["round","mine"]`, 404 → null); `useHydratePlayedState(enabled: boolean): void`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/mobile/test/roundStore.test.ts`:

```ts
describe("hydrate", () => {
  it("marks server predictions sealed and overwrites divergent local state", () => {
    const s = useRoundStore.getState();
    s.setAnswer("q1", false); // local draft disagreeing with server truth
    useRoundStore.getState().setConfidence("q1", 95);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, confidence: 70 }]);
    expect(useRoundStore.getState().answers["q1"]).toMatchObject({ answer: true, confidence: 70, sealed: true });
  });
  it("creates sealed entries for unknown questions and leaves others untouched", () => {
    useRoundStore.getState().setAnswer("q2", true);
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: false, confidence: 55 }]);
    const st = useRoundStore.getState().answers;
    expect(st["q1"]).toMatchObject({ answer: false, confidence: 55, sealed: true });
    expect(st["q2"]).toMatchObject({ answer: true, sealed: false });
  });
  it("keeps an existing idempotency key on hydrate", () => {
    useRoundStore.getState().setAnswer("q1", true);
    const key = useRoundStore.getState().answers["q1"]!.idempotencyKey;
    useRoundStore.getState().hydrate([{ question_id: "q1", answer: true, confidence: 75 }]);
    expect(useRoundStore.getState().answers["q1"]!.idempotencyKey).toBe(key);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oracle/mobile test`
Expected: hydrate tests FAIL (`hydrate` is not a function); pre-existing tests pass.

- [ ] **Step 3: Implement the store action**

In `apps/mobile/src/game/roundStore.ts`, add to the `RoundState` interface:

```ts
  hydrate(predictions: ReadonlyArray<{ question_id: string; answer: boolean; confidence: number }>): void;
```

and to the store implementation (alongside the other actions):

```ts
  hydrate: (predictions) => set((s) => {
    const answers = { ...s.answers };
    for (const p of predictions) {
      const existing = answers[p.question_id];
      // Server is the source of truth (Plan-3 carry-over): a server-known
      // prediction is sealed, and its answer/confidence overwrite any local
      // draft or divergent replay.
      answers[p.question_id] = {
        answer: p.answer,
        confidence: p.confidence,
        sealed: true,
        idempotencyKey: existing?.idempotencyKey ?? makeIdempotencyKey(p.question_id),
      };
    }
    return { answers };
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test` — Expected: all pass (24 total).

- [ ] **Step 5: Hook + wiring**

In `apps/mobile/src/api/hooks.ts`:
- Extend the core import: `import { RoundTodaySchema, RevealSchema, CrowdSoFarSchema, MineTodaySchema, type PredictionSubmit } from "@oracle/core";`
- Add:

```ts
export function useMineToday(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "mine"],
    enabled,
    queryFn: async () => {
      const token = await getDeviceToken();
      try {
        return await api("/v1/round/today/mine", MineTodaySchema, { token });
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
}
```

- In `useSubmit`'s `onSuccess`, add `qc.invalidateQueries({ queryKey: ["round", "mine"] });` below the crowd invalidation.

Create `apps/mobile/src/game/useHydratePlayedState.ts`:

```ts
import { useEffect } from "react";
import { useMineToday } from "../api/hooks";
import { useRoundStore } from "./roundStore";

// Plan-3 carry-over: the in-memory store resets on relaunch, so the server is
// the source of truth for what this player has sealed today. Anti-herding is
// unaffected — /today/mine returns only the caller's own predictions.
export function useHydratePlayedState(enabled: boolean) {
  const mine = useMineToday(enabled);
  const hydrate = useRoundStore((s) => s.hydrate);
  useEffect(() => {
    if (mine.data && mine.data.predictions.length > 0) hydrate(mine.data.predictions);
  }, [mine.data, hydrate]);
}
```

Wire it:
- `apps/mobile/src/app/index.tsx`: add `import { useHydratePlayedState } from "../game/useHydratePlayedState";` and call `useHydratePlayedState(!!round);` directly after the `const lean = ...` line.
- `apps/mobile/src/app/round.tsx`: add `import { useHydratePlayedState } from "../game/useHydratePlayedState";` and call `useHydratePlayedState(!!today.data);` directly after `const crowd = useCrowdSoFar(anySealed);`.

(Hooks must be called unconditionally — both call sites are above any early returns; verify that stays true.)

- [ ] **Step 6: Typecheck + full tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: clean; all pass.

- [ ] **Step 7: Live verification**

With wrangler + Metro up: cold-start to `exp://127.0.0.1:8081/--/round` and screenshot — the round screen must render normally (this device has no sealed predictions, so hydration is a no-op; the check is that nothing regressed and no query error shows). Then confirm hydration end-to-end: `curl -s -X POST http://127.0.0.1:8787/v1/auth/device -H 'content-type: application/json' -d '{"platform":"ios"}'` → take the token, `curl -s http://127.0.0.1:8787/v1/round/today/mine -H "authorization: Bearer <token>"` → expect `{"predictions":[]}` (fresh device) proving the endpoint serves through the dev stack.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/roundStore.ts apps/mobile/src/game/useHydratePlayedState.ts apps/mobile/src/api/hooks.ts apps/mobile/src/app/index.tsx apps/mobile/src/app/round.tsx apps/mobile/test/roundStore.test.ts
git commit -m "feat(mobile): hydrate played-state from the server"
```

---

### Task 3: Lock countdown on home (TDD)

**Files:**
- Create: `apps/mobile/src/game/countdown.ts`
- Test: `apps/mobile/test/countdown.test.ts` (create)
- Create: `apps/mobile/src/ui/Countdown.tsx`
- Modify: `apps/mobile/src/app/index.tsx`

**Interfaces:**
- Consumes: `RoundToday.locks_at: string | null` (already in the today payload).
- Produces: `msUntil(iso: string | null, now: number): number | null`; `formatCountdown(ms: number): string`; `Countdown({ until, prefix, fallback? })` — Mono line that ticks 1/s, renders the fallback (or nothing) when the target is missing/past.

- [ ] **Step 1: Write the failing tests**

Create `apps/mobile/test/countdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatCountdown, msUntil } from "../src/game/countdown";

describe("msUntil", () => {
  it("is null for null, invalid, or past timestamps", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    expect(msUntil(null, now)).toBeNull();
    expect(msUntil("not-a-date", now)).toBeNull();
    expect(msUntil("2026-08-26T11:59:59Z", now)).toBeNull();
  });
  it("returns remaining ms for future timestamps", () => {
    const now = Date.parse("2026-08-26T12:00:00Z");
    expect(msUntil("2026-08-26T13:30:05Z", now)).toBe((90 * 60 + 5) * 1000);
  });
});

describe("formatCountdown", () => {
  it("formats h:mm:ss", () => {
    expect(formatCountdown((2 * 3600 + 14 * 60 + 9) * 1000)).toBe("2:14:09");
  });
  it("drops the hour field under an hour", () => {
    expect(formatCountdown((14 * 60 + 9) * 1000)).toBe("14:09");
    expect(formatCountdown(5000)).toBe("00:05");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @oracle/mobile test` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement the pure module**

Create `apps/mobile/src/game/countdown.ts`:

```ts
// Time until the round locks — the moment the ledger becomes readable
// (the reveal endpoint 409s until every question is locked).
export function msUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const ms = t - now;
  return ms > 0 ? ms : null;
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test` — Expected: all pass.

- [ ] **Step 5: Component + home integration**

Create `apps/mobile/src/ui/Countdown.tsx`:

```tsx
import { useEffect, useState } from "react";
import { colors } from "../theme";
import { Mono } from "./Text";
import { formatCountdown, msUntil } from "../game/countdown";

// A quiet machine-voice countdown. Ticks once a second; shows the fallback
// line (or nothing) when the target is missing or already past. Ticking text
// is not "motion" — no reduced-motion branch (brand brief §11 keeps text as
// the accessible signal).
export function Countdown({ until, prefix, fallback }: { until: string | null; prefix: string; fallback?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const ms = msUntil(until, now);
  if (ms === null) {
    if (!fallback) return null;
    return (
      <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>{fallback}</Mono>
    );
  }
  return (
    <Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>
      {prefix} {formatCountdown(ms)}
    </Mono>
  );
}
```

In `apps/mobile/src/app/index.tsx`:
- Add `import { Countdown } from "../ui/Countdown";`
- In the `round && allSealed` block, REPLACE the static line
  `<Mono size={10} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2}>THE LEDGER IS READ AT NOON</Mono>`
  with
  `<Countdown until={round.locks_at} prefix="THE LEDGER IS READ IN" fallback="THE LEDGER IS READ AT NOON" />`
- In the `round && !allSealed` block, ADD after the `<GoldButton title="ENTER" ... />` line:
  `<Countdown until={round.locks_at} prefix="THE ORACLE CLOSES IN" />`

- [ ] **Step 6: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test` — Expected: clean, all pass.

- [ ] **Step 7: Visual verification**

The dev round's `locks_at` is in the past, so the live app shows: unsealed home → no countdown line (correct hide behavior). Verify the ticking state with a temp edit: in index.tsx temporarily replace `round.locks_at` in the UNSEALED block with a literal `{new Date(Date.now() + 2 * 3600 * 1000 + 14 * 60 * 1000).toISOString()}`, cold-start home, take TWO screenshots ~2s apart: the line reads `THE ORACLE CLOSES IN 2:13:XX` and the seconds differ between shots. REVERT the temp edit. Also confirm the normal state shows no stray line.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/countdown.ts apps/mobile/test/countdown.test.ts apps/mobile/src/ui/Countdown.tsx apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): lock countdown on home"
```

---

### Task 4: Reveal ceremony — rolling points + against-the-tide celebration

**Files:**
- Create: `apps/mobile/src/ui/RollingPoints.tsx`
- Modify: `apps/mobile/src/app/reveal/[date].tsx`

**Interfaces:**
- Consumes: `Reveal` payload (`d.day_points`, big-one `crowd_yes_pct`/`my`); existing `POINTS_DELAY`/`BIG_ONE_DELAY` constants; `Ritual` from `../../ui/Text`.
- Produces: `RollingPoints({ value: number, delayMs: number })`; module-scope `ROLL_MS = 700` exported for the haptic offset.

- [ ] **Step 1: RollingPoints component**

Create `apps/mobile/src/ui/RollingPoints.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useReducedMotion } from "react-native-reanimated";
import { colors } from "../theme";
import { Ritual } from "./Text";

// Day points roll up to their final value before the haptic lands. JS-driven
// one-shot at ~30fps: Reanimated cannot animate Text content without a
// TextInput bridge, which a 700ms ceremony beat doesn't warrant.
export const ROLL_MS = 700;
const STEP_MS = 33;

export function RollingPoints({ value, delayMs }: { value: number; delayMs: number }) {
  const reducedMotion = useReducedMotion();
  const [shown, setShown] = useState(reducedMotion ? value : 0);

  useEffect(() => {
    if (reducedMotion) { setShown(value); return; }
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      const t0 = Date.now();
      id = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / ROLL_MS);
        const eased = 1 - Math.pow(1 - p, 4); // house easing, poly(4) out
        setShown(Math.round(value * eased));
        if (p >= 1 && id) clearInterval(id);
      }, STEP_MS);
    }, delayMs);
    return () => { clearTimeout(start); if (id) clearInterval(id); };
  }, [value, delayMs, reducedMotion]);

  const pos = value >= 0;
  return (
    <Ritual bold size={54} color={pos ? colors.goldText : colors.vermilion} letterSpacing={2}>
      {pos ? `+${shown}` : String(shown)}
    </Ritual>
  );
}
```

- [ ] **Step 2: Wire the ceremony in `apps/mobile/src/app/reveal/[date].tsx`**

1. Imports: add `import { RollingPoints, ROLL_MS } from "../../ui/RollingPoints";`, add `Keyframe` to the reanimated import, and `StyleSheet` to the react-native import.
2. Lift the contrarian computation above the return (after `const results = ...`):

```tsx
  const bigSide = big?.my && big.crowd_yes_pct !== null ? (big.my.answer ? big.crowd_yes_pct : 100 - big.crowd_yes_pct) : null;
  const contrarianWin = bigSide !== null && bigSide < 40 && (big?.my?.points ?? 0) > 0;
```

NOTE: `big` and `results` are currently computed AFTER the loading/pending early returns — this lift stays in that same position (below the early returns), so hooks are unaffected; but the haptic `useEffect` (step 4) is ABOVE the early returns and cannot reference `contrarianWin` directly. Solve it by deriving inside the effect:

3. Day-points block — replace the `<Ritual bold size={54} ...>{pos ? ... : ...}</Ritual>` line with `<RollingPoints value={d.day_points} delayMs={0} />` (the wrapping `Animated.View` already FadeIns at `POINTS_DELAY`; pass `delayMs={POINTS_DELAY}`? No — the component mounts at screen render, not at fade-in, so the roll must own the full delay: use `<RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />`). Delete the now-unused `const pos = d.day_points >= 0;` line.
4. Haptic timing — the existing effect currently fires success at `POINTS_DELAY`. Replace the whole effect with:

```tsx
  // The day-points landing is the ceremony's beat — the number finishes its
  // roll, THEN the haptic lands. A contrarian big-one win gets a double
  // heavy strike at the Big One's entrance.
  useEffect(() => {
    if (!loaded) return;
    const d2 = reveal.data;
    const big2 = d2 && !("pending" in d2) ? d2.questions.find((q) => q.slot === 5) : undefined;
    const side = big2?.my && big2.crowd_yes_pct !== null ? (big2.my.answer ? big2.crowd_yes_pct : 100 - big2.crowd_yes_pct) : null;
    const tide = side !== null && side < 40 && (big2?.my?.points ?? 0) > 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), reducedMotion ? 0 : POINTS_DELAY + ROLL_MS));
    if (tide && !reducedMotion) {
      timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 650));
      timers.push(setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), BIG_ONE_DELAY + 800));
    }
    return () => timers.forEach(clearTimeout);
  }, [loaded, reducedMotion, reveal.data]);
```

5. Celebration visuals — define at module scope (below the delay constants):

```tsx
// One golden surge through the Big One frame when the player beat the tide.
const TideFlash = new Keyframe({
  0: { opacity: 0 },
  40: { opacity: 1 },
  100: { opacity: 0, easing: Easing.out(Easing.poly(4)) },
}).duration(900).delay(BIG_ONE_DELAY + 500);
```

Inside the `<GoldFrame ...>` as its FIRST child (before the art-band `<View style={{ height: 110 ... }}>`), add:

```tsx
            {contrarianWin && !reducedMotion && (
              <Animated.View pointerEvents="none" entering={TideFlash} style={[StyleSheet.absoluteFill, { backgroundColor: colors.goldWash }]} />
            )}
```

6. In the big-one stats IIFE: change the crowd mono line to drop the suffix — `CROWD SAID {big.crowd_yes_pct}% YES` only (delete the `{contrarianWin ? " · AGAINST THE TIDE ×2" : ""}` expression and the IIFE's local `sidePct`/`contrarianWin` — use the lifted values) — and add below it, still inside that block:

```tsx
                    {contrarianWin && (
                      <Animated.View entering={FadeIn.delay(BIG_ONE_DELAY + 600).duration(400).easing(easeOut)} style={{ flexDirection: "row", alignItems: "baseline", gap: space(2), justifyContent: "center" }}>
                        <Ritual bold size={14} letterSpacing={3}>AGAINST THE TIDE</Ritual>
                        <Ritual bold size={22} color={colors.agedGold} letterSpacing={1}>×2</Ritual>
                      </Animated.View>
                    )}
```

(Reduced motion: the row still renders — `entering` animations under reduced motion resolve instantly or fade; the flash and extra haptics are explicitly gated off.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test` — Expected: clean, all pass.

- [ ] **Step 4: Visual verification**

This device has no plays on the dev round, so use temp debug values, then revert:
1. Roll: temporarily change `<RollingPoints value={d.day_points} ...>` to `value={58}`; cold-start `exp://127.0.0.1:8081/--/reveal/2026-08-20`, record ~4s video (`xcrun simctl io <UDID> recordVideo --codec h264 --force /tmp/roll.mov` backgrounded, kill -INT after 4s), extract 3 frames (`ffmpeg -i /tmp/roll.mov -vf "select='not(mod(n\,25))',scale=300:-2,tile=3x1" -frames:v 1 /tmp/rollframes.png`), Read them: the number must differ across frames and end at `+58`.
2. Tide: temporarily force `const contrarianWin = true;` (keep the real line commented beside it); cold-start the same reveal, screenshot at ~3s: the `AGAINST THE TIDE ×2` Cinzel row renders under the crowd line inside the gold frame (flash may already have faded — the row is the still-frame evidence).
3. REVERT both temp edits; `git diff` shows only the intended integration; cold-start once more to confirm the real `+0` state renders sanely.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/RollingPoints.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "feat(mobile): rolling day points + against-the-tide celebration"
```

---

### Task 5: Full-pass verification + evidence

**Files:**
- Create: `docs/superpowers/plans/assets/anticipation-pass/` (screenshots)

- [ ] **Step 1: Clean state**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck && pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test && git status --porcelain`
Expected: all green (api suites incl. mine; mobile 26 tests), no stray temp edits (ignore `.superpowers/` paths).

- [ ] **Step 2: Capture evidence**

Into `docs/superpowers/plans/assets/anticipation-pass/` (mkdir -p), re-using the Task 3/4 temp-force recipes with mandatory reverts afterward:
- `countdown.png` — home with the temp future `locks_at` showing `THE ORACLE CLOSES IN 2:13:XX`
- `roll-frames.png` — the 3-frame tile of the rolling `+58`
- `tide.png` — the forced `AGAINST THE TIDE ×2` row in the Big One frame
After reverts: `git status --porcelain` shows ONLY the new PNGs; cold-start home once to leave the simulator in the real state.

- [ ] **Step 3: Commit evidence**

```bash
git add docs/superpowers/plans/assets/anticipation-pass/
git commit -m "chore(mobile): anticipation-pass evidence"
```

- [ ] **Step 4: Hand-test handoff**

Report what needs a human hand: (1) hydration end-to-end — seal a card, kill and relaunch the app, confirm home shows THE PROPHECY IS SEALED and the round screen doesn't re-offer sealed cards; (2) the roll + haptic beat feel on a real device; (3) a real contrarian-win reveal when one occurs.

---

## Self-Review Notes

- **Spec coverage:** hydration (T1+T2 — the named first Plan-3 item, server-wins rule implemented and tested), countdown (T3 — uses locks_at, honest because reveal unlocks at lock), count-up (T4), against-the-tide celebration (T4). Sibyl medallions deliberately excluded (depend on streak infra, Plan 3 proper).
- **Type consistency:** `MineTodaySchema` shape matches the route's JSON and `hydrate`'s parameter type; `ROLL_MS` exported from RollingPoints and consumed by the haptic effect; `Countdown` props used identically at both call sites.
- **Hooks discipline:** `useHydratePlayedState` called unconditionally above early returns in both screens; reveal's lifted `contrarianWin` stays below early returns (non-hook), while the haptic effect derives its own copy above them.
- **Placeholder scan:** none — all code inline.
