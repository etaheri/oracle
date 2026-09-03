# Vigil, Standing and the Window — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the vigil a real, properness-preserving stake so the shield defends something; tell a player where they stand among sealed records; make the existing leak telemetry answer the one question it currently cannot; and fix two layout/navigation defects.

**Architecture:** The vigil becomes a **symmetric multiplier on the day's total**, stamped once at settlement from the streak the player carried *into* the day. Symmetric and pre-determined is what keeps the scoring rule proper — a wins-only multiplier reintroduces the convex kink the August audit removed from the contrarian bonus. Because `day_points` is computed on read and nothing may revise a past day, the multiplier needs a new `user_rounds` row rather than a live read of `users.streak_current`. Standing ships as a percentile over the Oracle Score — the one number nothing purchasable touches — not as a leaderboard, because an Oracle Score takes ten days to exist. The leak work only pools metrics that already exist.

**Tech Stack:** pnpm monorepo · TypeScript · Zod 4 · Drizzle + Neon (PGlite in tests) · Hono on Cloudflare Workers · Vitest · Expo SDK 57 / React Native.

**Spec:** `docs/superpowers/specs/2026-09-02-vigil-standing-and-window-design.md` — binding authority. **Read §A.3 in full before Task 5.** It carries the properness argument this plan is built on, and getting it wrong silently breaks the game's core guarantee.

## Global Constraints

- **TDD, always.** Failing test → run it → see it fail → minimal implementation → run it → see it pass → commit. Never write implementation before a failing test.
- **Baselines to beat:** core **82**, api **265**, mobile **249** tests green; `pnpm typecheck` clean in all three packages. Every task ends green and **adds** tests — never fewer than these counts.
- **API tests run on ONE vitest worker** (PGlite/WASM contention). Do not change `apps/api/vitest.config.ts` concurrency.
- **Mobile vitest only runs `test/**/*.test.ts`** — pure TS, no React Native renderer. Components (`.tsx`) are verified by `tsc --noEmit` and on device, never by unit test. **Any logic worth testing must be extracted into `src/game/*.ts` first.**
- **`packages/core/src/copy.ts` is governed by `packages/core/test/copy-lint.test.ts`.** Every copy change must keep it green: mono caps, no emoji, no `!`, no CTA verbs (`CHECK TAP CLICK VISIT RESULTS DON'T MISS`), ≤140 chars.
- **⚠ Growing `RevealSchema` breaks `packages/core/test/round-schemas.test.ts`.** This repo has hit that trap twice (ritual-core, then market-authoring phase 2). Task 8 adds a field to `RevealSchema` — **update that fixture in the same commit** or the suite goes red for a reason that looks unrelated.
- **Zod 4** idioms — `z.iso.datetime({ offset: true })`, `z.literal()`, `z.union()`. Not Zod 3.
- **Drizzle `numeric` reads back as a `string`.** Every read site must `Number()` it, as `crowdYesPct` / `brier` / `marketProb` already do.
- **Expo SDK 57:** read https://docs.expo.dev/versions/v57.0.0/ before writing any Expo API call (`apps/mobile/AGENTS.md`).
- **Never put non-ASCII in Skia text** — `useFont` has no fallback and renders tofu. (Affects `ShareCard.tsx` / `PlaqueShareCard.tsx` only.)
- **Every commit stages only the files named in its task.** Never `git add -A` or `git add .`.
- **Commit messages** use the repo's conventional style (`feat(api):`, `fix(mobile):`, `refactor(core):`) and end with the trailer:
  `Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK`
- All paths are relative to repo root `/Users/eriktaheri/Development/oracle`. Run `pnpm` from the package dir (`packages/core`, `apps/api`, `apps/mobile`).

## Vocabulary

- **The vigil** — the player's unbroken run of noons (`users.streak_current`).
- **The incoming vigil** — the streak value read at the top of `settleRound`'s per-user loop, *before* `settleStreak` returns the new one. This is the value that gets stamped, and the reason properness holds.
- **The weighed day** — a day's points after the vigil multiplier has been applied.
- **The truth economy** — Briers and the Oracle Score. Nothing purchasable, and nothing in this plan, may touch it.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/mobile/src/app/ledger.tsx` | one column, plaque interior swaps | 1 |
| `apps/mobile/src/app/rites.tsx` | one return per reading | 2 |
| `apps/api/src/pipeline/leak.ts` | **+** `pooledLeak` over many questions | 3 |
| `apps/api/src/routes/admin.ts` | **+** `GET /analytics/leak` | 4 |
| `packages/core/src/constants.ts` | **+** `VIGIL_MULT_PER_DAY`, `VIGIL_MULT_MAX_DAYS`, `PERCENTILE_MIN_COHORT` | 5, 12 |
| `packages/core/src/scoring.ts` | **+** `vigilMultiplier`, `vigilPoints` | 5 |
| `apps/api/src/db/schema.ts` | **+** `user_rounds` table | 6 |
| `apps/api/drizzle/0005_the_vigil_weighs.sql` | migration | 6 |
| `apps/api/src/settlement.ts` | stamps the incoming vigil | 7 |
| `apps/api/src/routes/round.ts` | reveal serves `vigil_mult` + weighed `day_points` | 8 |
| `packages/core/src/schemas.ts` | `RevealSchema.vigil_mult`, `MeLedgerSchema.percentile`/`cohort_size` | 8, 12 |
| `apps/mobile/src/game/revealRows.ts` | **+** `pointsWithheld`, `vigilWeightLine` | 9 |
| `apps/mobile/src/app/reveal/[date].tsx` | renders the vigil's weight | 9 |
| `packages/core/src/copy.ts` | rites reorder, vigil stake, shield rule, paywall mechanic, gloss | 10, 11 |
| `apps/api/src/routes/me.ts` | percentile over the Oracle Score cohort | 12 |
| `apps/mobile/src/game/standing.ts` | **new** — pure standing line | 13 |
| `apps/mobile/src/app/ledger.tsx` | prints the standing row | 13 |

---

## Task 1: The ledger's column holds still

**Files:**
- Modify: `apps/mobile/src/app/ledger.tsx:122-137` (delete the early-return branch) and `:155-232` (single column)
- Test: none possible — `.tsx`, and mobile vitest runs pure TS only. Verified by `tsc` + device.

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks rely on. Task 13 adds a row to this same file and must be applied *after* this task.

**Why:** the loading branch renders **two** children inside `{ flex: 1, justifyContent: "center" }`; the loaded branch renders **seven**. Loading column ≈ 434pt, loaded ≈ 665pt, both centred — so when the record lands the plaque's top shoves up ~115pt. `PLAQUE_MIN_H` correctly stabilises the plaque's own box; the jump comes from the furniture below it.

- [ ] **Step 1: Delete the early-return loading branch**

Remove this entire block (`ledger.tsx:122-137`):

```tsx
  if (!ledger.data) return (
    <Screen>
      <TopBar />
      ...
    </Screen>
  );

  const d = ledger.data;
```

- [ ] **Step 2: Make the data optional and hoist the derived values**

Replace with:

```tsx
  const d = ledger.data ?? null;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

  async function handleShare() {
    if (!d) return;
    setSharing(true);
    setShareError(null);
    try {
      await shareSnapshot(canvasRef, "oracle-plaque.png", d.epithet.title);
    } catch {
      setShareError("THE PLAQUE WOULD NOT LEAVE. TRY AGAIN.");
    } finally {
      setSharing(false);
    }
  }
```

- [ ] **Step 3: Render one column; swap only the plaque's interior**

The single `return` keeps every child that was previously loaded-only. Only the plaque's *contents* branch:

```tsx
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        {/* One column in both states. The frame used to be the only thing
            held steady while the six children below it did not exist yet —
            so the plaque itself stayed the right size and still jumped
            ~115pt upward, because a centred column half the height centres
            differently. The furniture below is static; only the plaque's
            interior depends on the record. */}
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4), minHeight: PLAQUE_MIN_H, ...(d ? null : { alignItems: "center", justifyContent: "center" }) }}>
          {d ? (
            <>
              {/* MOVE, do not retype: the plaque's existing children are
                  `ledger.tsx:160-207` in the pre-change file — the Eyebrow,
                  the epithet block, the hairline rule, the LeadStat + gloss +
                  six Stats + calibration verdict group, and the claim/claimed
                  block. Lift them verbatim; only `d.` accesses change (they
                  are already `d.`-prefixed, so in practice nothing changes). */}
            </>
          ) : (
            <>
              <AsciiDust />
              <DecodeLine text="THE LEDGER IS CONSULTED" cursor size={10} color={colors.goldText} letterSpacing={4} style={{ textAlign: "center" }} />
            </>
          )}
        </View>
        {!plusActive && <QuietLink title="Oracle plus" onPress={() => router.push("/plus")} />}
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={10} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
        <GoldButton title={sharing ? "PREPARING…" : "DECLARE YOURSELF"} onPress={handleShare} disabled={!d} />
        {shareError && (
          <Mono size={10} color={colors.vermilion} letterSpacing={2} style={{ textAlign: "center" }}>{shareError}</Mono>
        )}
        <QuietLink title="Strike the record" onPress={() => setRite("strike")} />
        {d && <PlaqueShareCanvas canvasRef={canvasRef} data={d} />}
      </View>
      {/* ...both RiteConfirm blocks, unchanged... */}
    </Screen>
  );
```

- [ ] **Step 4: Confirm `GoldButton` accepts `disabled`**

Run: `grep -n "disabled" apps/mobile/src/ui/Button.tsx`
If it does **not** accept `disabled`, add it to `GoldButton`'s props: `disabled?: boolean`, pass to `Pressable`, and render at `opacity: 0.4` when set. Do not invent any other prop.

- [ ] **Step 5: Reserve the Apple claim row**

The claim row (`ledger.tsx:196`) appears after an async `isAvailableAsync()` and adds ~70pt *inside* the plaque — and `PLAQUE_MIN_H` is a floor, not a height. Give the claim/claimed block a fixed container so resolving availability does not resize the plaque:

```tsx
<View style={{ minHeight: 78, justifyContent: "center", marginTop: space(2) }}>
  {/* existing claimed / appleAvailable / null ternary, unchanged */}
</View>
```

- [ ] **Step 6: Typecheck**

Run: `cd apps/mobile && pnpm typecheck`
Expected: clean.

- [ ] **Step 7: Run mobile tests**

Run: `cd apps/mobile && pnpm test`
Expected: 249 passing, 0 failing. (No new tests — this file is untestable under the pure-TS runner.)

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/app/ledger.tsx apps/mobile/src/ui/Button.tsx
git commit -m "$(cat <<'EOF'
fix(mobile): the plaque stops climbing when the record lands

The loading frame held the plaque's own box steady and let the six
children below it not exist, so a column half the height centred half
a screen higher and the plaque rose ~115pt at the moment of the fill.
One column in both states now; only the plaque's interior swaps.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 2: The rites have one way out

**Files:**
- Modify: `apps/mobile/src/app/rites.tsx:100-110` (the fixed footer) and `:31` (the TopBar)
- Modify: `apps/mobile/src/ui/TopBar.tsx` (add an opt-out prop)
- Test: none possible (`.tsx`). Verified by `tsc` + device.

**Interfaces:**
- Consumes: nothing.
- Produces: `TopBar` gains `showReturn?: boolean` (default `true`). No other task uses it.

**Why:** on the `?all=1` reading the screen carries two return controls — TopBar's `‹ RETURN` (a sibling *above* the ScrollView, so it never scrolls away) and a full-width `GoldButton "RETURN"` pinned to the bottom. The GoldButton is the app's highest-emphasis control and everywhere else marks a commitment (BEGIN, DECLARE YOURSELF, KEEP THE VIGIL). Spending it on "go back" makes the loudest element on the rulebook the exit, duplicates a permanently-visible control, and costs ~64pt on a screen that already overflows. Inversely, on the **opening** reading `index.tsx:185` pushes `/rites`, so TopBar's return lets a first-timer walk out of what is meant to be a gate.

- [ ] **Step 1: Give TopBar an opt-out**

In `apps/mobile/src/ui/TopBar.tsx`, change the signature and guard the Pressable:

```tsx
export function TopBar({ label, showReturn = true }: { label?: string; showReturn?: boolean }) {
  const router = useRouter();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 }}>
      {showReturn ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Return"
          hitSlop={8}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Mono size={11} color={colors.goldText} letterSpacing={2}>‹ RETURN</Mono>
        </Pressable>
      ) : (
        // The gate keeps its 44pt bar so the eyebrow below does not ride up
        // when the only way forward is BEGIN.
        <View style={{ minHeight: 44 }} />
      )}
      {label ? <Mono size={10} color={colors.mutedInk} letterSpacing={3}>{label}</Mono> : null}
    </View>
  );
}
```

- [ ] **Step 2: The opening rite is a gate; the full canon is a reference**

In `apps/mobile/src/app/rites.tsx`, change the TopBar call (line ~31):

```tsx
      <TopBar showReturn={!opening} />
```

and replace the whole fixed footer block (lines ~100-110) with:

```tsx
      {/* BEGIN is a commitment and earns the gold. RETURN is not: the full
          canon is a reference, and TopBar's ‹ RETURN is pinned above the
          scroller and never leaves — a second, louder exit made the most
          emphatic element on the rulebook the way out of it. */}
      {opening && (
        <View style={{ paddingTop: space(3), paddingBottom: space(2) }}>
          <GoldButton
            title="BEGIN"
            onPress={() => { void markRitesSeen(); router.replace("/round"); }}
          />
        </View>
      )}
```

- [ ] **Step 3: Drop the now-unused import**

`QuietLink` is still used (the "remaining rites" link). Confirm `GoldButton` is still used (it is — by the `opening` branch). Run:

Run: `cd apps/mobile && pnpm typecheck`
Expected: clean, with no "declared but never read" error. If `router.canGoBack` is now unused in `rites.tsx`, remove it.

- [ ] **Step 4: Run mobile tests**

Run: `cd apps/mobile && pnpm test`
Expected: 249 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/rites.tsx apps/mobile/src/ui/TopBar.tsx
git commit -m "$(cat <<'EOF'
fix(mobile): the rites have one way out, and the gate has none

The full canon carried two returns -- a pinned ‹ RETURN that never
scrolls away and a gold button beneath it, which made the loudest
element on the rulebook the exit. The opening carried the opposite
problem: a gate a first-timer could walk back out of.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 3: The leak is pooled across rounds

**Files:**
- Modify: `apps/api/src/pipeline/leak.ts` (append `pooledLeak`)
- Test: `apps/api/test/pipeline-leak.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `SealRow`, `crowdDrift`, `lateEdge` from `./leak`.
- Produces:
  ```ts
  export interface PooledLeak { drift: number | null; edge: number | null; seals: number; questions: number; rated: number }
  export function pooledLeak(perQuestion: SealRow[][]): PooledLeak
  ```

**Why:** `crowdDrift` / `lateEdge` are per-question with `MIN_SEALS = 8`, so at launch scale nearly every question reports `null` and the settle-time `LEAK WATCH` block says "too few seals" forever. The question that matters — *does the window leak across every round so far* — needs the rows pooled. Pooling also makes the metric computable at all right now.

**Design note:** pooling must normalise **within** each question before combining, not concatenate raw rows. Two questions sealed at different clock times would otherwise interleave by wall-clock and destroy the early/late ordering that both metrics depend on. So: compute each question's own drift/edge, then average the non-null ones.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/pipeline-leak.test.ts`:

```ts
describe("pooledLeak", () => {
  // Build one question's worth of seals: `n` rows marching forward in time,
  // with `lateYes` of the last half answering YES and briers supplied.
  const q = (specs: Array<{ answer: boolean; brier: number | null }>): SealRow[] =>
    specs.map((s, i) => ({ createdAt: new Date(2026, 0, 1, 12, i), answer: s.answer, brier: s.brier }));

  const flat = (n: number) => q(Array.from({ length: n }, () => ({ answer: true, brier: 0.2 })));

  it("returns nulls and counts nothing when every question is under the seal floor", () => {
    const out = pooledLeak([flat(3), flat(4)]);
    expect(out.drift).toBeNull();
    expect(out.edge).toBeNull();
    expect(out.questions).toBe(0);
    expect(out.seals).toBe(7);
  });

  it("pools per-question metrics rather than concatenating rows", () => {
    // Two questions, each internally drifting from NO to YES. Concatenated by
    // wall clock they would interleave and cancel; pooled per question they
    // agree.
    const drifting = q([
      { answer: false, brier: 0.4 }, { answer: false, brier: 0.4 },
      { answer: false, brier: 0.4 }, { answer: false, brier: 0.4 },
      { answer: true, brier: 0.1 }, { answer: true, brier: 0.1 },
      { answer: true, brier: 0.1 }, { answer: true, brier: 0.1 },
    ]);
    const out = pooledLeak([drifting, drifting]);
    expect(out.questions).toBe(2);
    expect(out.drift).toBe(100);
    // Earlier half brier 0.4, later half 0.1 → +0.3, late sealers scored better.
    expect(out.edge).toBeCloseTo(0.3, 6);
  });

  it("counts a question toward drift but not edge when it has no rated rows", () => {
    const unrated = q(Array.from({ length: 8 }, (_, i) => ({ answer: i >= 4, brier: null })));
    const out = pooledLeak([unrated]);
    expect(out.drift).toBe(100);
    expect(out.edge).toBeNull();
    expect(out.rated).toBe(0);
  });
});
```

Add `pooledLeak` and `SealRow` to that file's existing import from `../src/pipeline/leak`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pnpm vitest run test/pipeline-leak.test.ts`
Expected: FAIL — `pooledLeak is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/api/src/pipeline/leak.ts`:

```ts
export interface PooledLeak {
  drift: number | null;
  edge: number | null;
  seals: number;
  questions: number;
  rated: number;
}

/**
 * The same two metrics, across many questions.
 *
 * Each question is measured on its own timeline FIRST and only then averaged.
 * Concatenating raw rows would order seals by wall clock across questions that
 * opened at different times, which destroys the early-vs-late split both
 * metrics are built on — the pooled number would measure nothing.
 *
 * Read it with the same caution as the per-question figures (see this file's
 * header): honest information arrival drifts a crowd too, and the first-hour
 * bonus biases `edge` negative by selecting engaged players into the early
 * half. A quiet pooled report is the absence of a symptom, not an all-clear.
 */
export function pooledLeak(perQuestion: SealRow[][]): PooledLeak {
  const drifts: number[] = [];
  const edges: number[] = [];
  let seals = 0;
  let rated = 0;
  let questions = 0;

  for (const rows of perQuestion) {
    seals += rows.length;
    rated += rows.filter((r) => r.brier !== null).length;
    const d = crowdDrift(rows);
    const e = lateEdge(rows);
    if (d === null && e === null) continue;
    questions++;
    if (d !== null) drifts.push(d);
    if (e !== null) edges.push(e);
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const d = mean(drifts);
  return {
    drift: d === null ? null : Math.round(d),
    edge: mean(edges),
    seals,
    questions,
    rated,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/api && pnpm vitest run test/pipeline-leak.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd apps/api && pnpm test && pnpm typecheck`
Expected: 268 passing (265 + 3), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/pipeline/leak.ts apps/api/test/pipeline-leak.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the leak is measured across rounds, not one question at a time

Eight seals is a high floor for a question and a low one for a month,
so the per-question watch has been reporting "too few seals" and will
keep doing so at launch scale. Pooling measures each question on its
own timeline before averaging -- concatenating the rows would order
seals by wall clock across questions that opened hours apart and
measure nothing at all.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 4: The leak is readable

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (append one route)
- Test: `apps/api/test/admin-rounds.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `pooledLeak`, `loadLeakRows` from `../pipeline/leak`; the admin-secret middleware already applied by `adminRoutes.use("*", …)`.
- Produces: `GET /admin/analytics/leak?since=YYYY-MM-DD` → JSON.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/admin-rounds.test.ts`:

```ts
describe("GET /admin/analytics/leak", () => {
  it("requires the admin secret", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await app.request("/admin/analytics/leak");
    expect(res.status).toBe(401);
  });

  it("pools every resolved round and carries the caveat", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const res = await app.request("/admin/analytics/leak", { headers: { "x-admin-secret": "admin" } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pooled: { seals: number; questions: number }; rounds: unknown[]; caveat: string };
    expect(body.pooled.seals).toBe(0);
    expect(body.pooled.questions).toBe(0);
    expect(Array.isArray(body.rounds)).toBe(true);
    expect(body.caveat.length).toBeGreaterThan(0);
  });

  it("honours ?since", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await seedRound(db, { date: "2026-08-25", opensAt: new Date("2026-08-25T16:00:00Z"), locksAt: new Date("2026-08-26T16:00:00Z") });
    const res = await app.request("/admin/analytics/leak?since=2026-08-25", { headers: { "x-admin-secret": "admin" } });
    const body = (await res.json()) as { rounds: Array<{ date: string }> };
    expect(body.rounds.every((r) => r.date >= "2026-08-25")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pnpm vitest run test/admin-rounds.test.ts`
Expected: FAIL — 404 on the analytics path.

- [ ] **Step 3: Implement**

Add to the imports at the top of `apps/api/src/routes/admin.ts`:

```ts
import { pooledLeak, loadLeakRows, type SealRow } from "../pipeline/leak";
import { asc, gte } from "drizzle-orm";
```
(merge `asc`/`gte` into the existing `drizzle-orm` import rather than adding a second one.)

Append this route to the `adminRoutes` chain:

```ts
  // The window's leak, across every round rather than one at a time. The
  // settle-time LEAK WATCH answers "did this question leak"; this answers
  // "does the window leak", which is the one that decides whether a standing
  // ranks foresight or patience.
  .get("/analytics/leak", async (c) => {
    const db = c.get("deps").db;
    const since = c.req.query("since");
    const rounds = await db.query.rounds.findMany({
      where: since ? gte(schema.rounds.date, since) : undefined,
      orderBy: [asc(schema.rounds.date)],
    });

    const perRound: Array<{ date: string; drift: number | null; edge: number | null; seals: number; questions: number }> = [];
    const everyQuestion: SealRow[][] = [];

    for (const r of rounds) {
      const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, r.date) });
      const rowsPerQuestion = await Promise.all(qs.map((q) => loadLeakRows(db, q.id)));
      everyQuestion.push(...rowsPerQuestion);
      const p = pooledLeak(rowsPerQuestion);
      perRound.push({ date: r.date, drift: p.drift, edge: p.edge, seals: p.seals, questions: p.questions });
    }

    return c.json({
      pooled: pooledLeak(everyQuestion),
      rounds: perRound,
      // Stated in the payload, not only in leak.ts's header, so whoever reads
      // this JSON gets it without reading the source.
      caveat:
        "DRIFT AND EDGE MEASURE DRIFT, NOT PROVEN LEAKAGE. HONEST NEWS CONVERGES A CROWD TOO, " +
        "AND THE FIRST-HOUR BONUS SELECTS ENGAGED PLAYERS INTO THE EARLY HALF, BIASING EDGE NEGATIVE. " +
        "A QUIET REPORT IS THE ABSENCE OF A SYMPTOM, NOT AN ALL-CLEAR.",
    });
  })
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/api && pnpm vitest run test/admin-rounds.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd apps/api && pnpm test && pnpm typecheck`
Expected: 271 passing, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/test/admin-rounds.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the leak watch can be asked about the window, not just the day

Until now the only way to read leak telemetry was to be in the Telegram
channel at noon. The pooled figures now answer the question that
actually gates a leaderboard, and the payload carries the caveat so a
reader of the JSON cannot mistake drift for proof.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 5: The vigil's multiplier — and the property test that keeps it honest

**⚠ Read spec §A.3 in full before writing a line of this task.**

**Files:**
- Modify: `packages/core/src/constants.ts`
- Modify: `packages/core/src/scoring.ts`
- Test: `packages/core/test/scoring-day.test.ts` (append)

**Interfaces:**
- Consumes: `CONSTANTS`, `payoff` from this package.
- Produces:
  ```ts
  export function vigilMultiplier(streak: number): number
  export function vigilPoints(dayTotal: number, streak: number): number
  ```
  Both exported through `src/index.ts` automatically (`export * from "./scoring"`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/scoring-day.test.ts` (add `vigilMultiplier`, `vigilPoints`, `payoff` to its imports from `../src/scoring`, and `CONSTANTS` from `../src/constants`):

```ts
describe("vigilMultiplier", () => {
  it("is 1 with no vigil and rises to its ceiling", () => {
    expect(vigilMultiplier(0)).toBe(1);
    expect(vigilMultiplier(1)).toBeCloseTo(1.05, 10);
    expect(vigilMultiplier(CONSTANTS.SHIELD_MIN_STREAK)).toBeCloseTo(1.15, 10);
    expect(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBeCloseTo(1.5, 10);
  });

  it("holds at the ceiling and never dips below one", () => {
    expect(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS + 1)).toBe(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS));
    expect(vigilMultiplier(400)).toBe(vigilMultiplier(CONSTANTS.VIGIL_MULT_MAX_DAYS));
    expect(vigilMultiplier(-5)).toBe(1);
  });
});

describe("vigilPoints", () => {
  it("weighs a losing day exactly as hard as a winning one", () => {
    // The whole design rests on this. An asymmetric multiplier puts a convex
    // kink at zero and rewards variance -- the bug the additive contrarian
    // bonus was written to remove.
    expect(vigilPoints(100, CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBe(150);
    expect(vigilPoints(-100, CONSTANTS.VIGIL_MULT_MAX_DAYS)).toBe(-150);
  });

  it("leaves a vigil-less day alone", () => {
    expect(vigilPoints(83, 0)).toBe(83);
    expect(vigilPoints(-83, 0)).toBe(-83);
  });
});

describe("the vigil multiplier keeps the scoring rule proper", () => {
  const GRID = [55, 60, 65, 70, 75, 80, 85, 90, 95];

  // Expected points of reporting `c` when the honest belief is `p`, on a
  // one-question day, at a given vigil.
  const ev = (p: number, c: number, streak: number, weigh: (total: number, s: number) => number) => {
    const { win, loss } = payoff(c, false);
    return p * weigh(win, streak) + (1 - p) * weigh(loss, streak);
  };

  const argmax = (p: number, streak: number, weigh: (total: number, s: number) => number) =>
    GRID.reduce((best, c) => (ev(p, c, streak, weigh) > ev(p, best, streak, weigh) ? c : best), GRID[0]!);

  it("leaves the honest report optimal at every vigil length", () => {
    for (const streak of [0, 1, 3, 7, 10, 11, 30, 400]) {
      for (const c of GRID) {
        expect(argmax(c / 100, streak, vigilPoints), `p=${c} streak=${streak}`).toBe(c);
      }
    }
  });

  it("proves the test has teeth: a wins-only multiplier is NOT proper", () => {
    // The intuitive "reward the streak" reading, kept here as a negative
    // control. If this ever starts passing, the property test above has gone
    // blind and the real implementation is no longer protected by it.
    const winsOnly = (total: number, streak: number) =>
      total > 0 ? Math.round(total * vigilMultiplier(streak)) : total;
    const dishonest = GRID.some((c) => argmax(c / 100, CONSTANTS.VIGIL_MULT_MAX_DAYS, winsOnly) !== c);
    expect(dishonest).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/core && pnpm vitest run test/scoring-day.test.ts`
Expected: FAIL — `vigilMultiplier is not a function`.

- [ ] **Step 3: Add the constants**

In `packages/core/src/constants.ts`, inside the `CONSTANTS` object, after `FIRST_HOUR_BONUS`:

```ts
  // The vigil weighs the day. ⚙ tunable.
  // SYMMETRIC BY LAW: applied to losing days exactly as to winning ones. The
  // multiplier is fixed by the streak carried INTO the day, so it is a
  // positive constant with respect to today's reports and E[M·S] = M·E[S] --
  // the honest report stays optimal. A wins-only variant puts a convex kink
  // at zero and rewards overconfidence; see scoring-day.test.ts's negative
  // control, which exists to keep that variant from ever passing.
  VIGIL_MULT_PER_DAY: 0.05,
  VIGIL_MULT_MAX_DAYS: 10,
```

- [ ] **Step 4: Implement**

Append to `packages/core/src/scoring.ts`:

```ts
/**
 * How heavily the ledger weighs a day, given the vigil carried into it.
 * 1.00 with no vigil, rising to 1.50 at VIGIL_MULT_MAX_DAYS and holding.
 */
export function vigilMultiplier(streak: number): number {
  const days = Math.min(Math.max(streak, 0), C.VIGIL_MULT_MAX_DAYS);
  return 1 + C.VIGIL_MULT_PER_DAY * days;
}

/**
 * The weighed day. Applied to the day's TOTAL, after the first-hour bonus,
 * and to negative totals exactly as to positive ones -- a long vigil
 * amplifies a bad day as much as a good one. That symmetry is what keeps the
 * rule proper (see vigilMultiplier's note in constants.ts); it is also the
 * stake that makes a vigil worth defending.
 */
export function vigilPoints(dayTotal: number, streak: number): number {
  return Math.round(dayTotal * vigilMultiplier(streak));
}
```

- [ ] **Step 5: Run them and watch them pass**

Run: `cd packages/core && pnpm vitest run test/scoring-day.test.ts`
Expected: PASS, including the negative control.

- [ ] **Step 6: Full suite + typecheck**

Run: `cd packages/core && pnpm test && pnpm typecheck`
Expected: 87 passing (82 + 5), typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/constants.ts packages/core/src/scoring.ts packages/core/test/scoring-day.test.ts
git commit -m "$(cat <<'EOF'
feat(core): the vigil weighs the day, in both directions

A streak that protects nothing cannot justify a shield, so the vigil now
scales the day's total. It scales a losing day exactly as hard as a
winning one: the multiplier is fixed by the streak carried into the day,
so it is a constant with respect to today's reports and the honest
report stays optimal. The wins-only reading -- the intuitive one -- puts
a convex kink at zero and pays for overconfidence, which is the bug the
additive contrarian bonus was written to remove. It is kept in the suite
as a negative control that must always fail.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 6: The table that remembers the vigil

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0005_the_vigil_weighs.sql`
- Test: `apps/api/test/schema.test.ts` (append)

**Interfaces:**
- Produces: `schema.userRounds` with columns `userId`, `date`, `vigilMult` and composite PK `(userId, date)`.

**Why a table:** `day_points` is computed on read (`routes/round.ts:117`) and there is no per-user-per-round row. Reading `users.streak_current` live would rewrite every past reveal each time the streak moved, breaking *"NOTHING IS REVISED. NOTHING IS FORGOTTEN."*

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/schema.test.ts`:

```ts
describe("user_rounds", () => {
  it("stamps one vigil per user per round and refuses a second", async () => {
    const { db } = await makeTestDb();
    const [u] = await db.insert(schema.users).values({}).returning();
    await db.insert(schema.userRounds).values({ userId: u!.id, date: "2026-08-20", vigilMult: "1.15" });

    const rows = await db.query.userRounds.findMany();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.vigilMult)).toBeCloseTo(1.15, 10);

    // The stamp is made once. A retry must not revise it.
    await db.insert(schema.userRounds)
      .values({ userId: u!.id, date: "2026-08-20", vigilMult: "1.50" })
      .onConflictDoNothing();
    const after = await db.query.userRounds.findMany();
    expect(after).toHaveLength(1);
    expect(Number(after[0]!.vigilMult)).toBeCloseTo(1.15, 10);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pnpm vitest run test/schema.test.ts`
Expected: FAIL — `schema.userRounds` is undefined.

- [ ] **Step 3: Add the table**

In `apps/api/src/db/schema.ts`, ensure `primaryKey` is in the `drizzle-orm/pg-core` import, then append:

```ts
// One row per user per round: how heavily the ledger weighed that day.
//
// Stamped once by settleRound from the vigil the player carried INTO the day,
// and never revised -- the reveal computes day_points on read, so a live read
// of users.streak_current would silently rewrite every past day each time the
// streak moved. "NOTHING IS REVISED" is a promise the schema has to keep.
export const userRounds = pgTable("user_rounds", {
  userId: uuid("user_id").notNull().references(() => users.id),
  date: date("date").notNull(),
  vigilMult: numeric("vigil_mult").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.date] })]);
```

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate`
Expected: a new `apps/api/drizzle/0005_*.sql`. Rename the file to `0005_the_vigil_weighs.sql` **and** update its entry in `apps/api/drizzle/meta/_journal.json` to match, so the journal and the filename agree.

Verify it contains, in the `0004`-matching format:

```sql
CREATE TABLE "user_rounds" (
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"vigil_mult" numeric NOT NULL,
	CONSTRAINT "user_rounds_user_id_date_pk" PRIMARY KEY("user_id","date")
);
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd apps/api && pnpm vitest run test/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `cd apps/api && pnpm test && pnpm typecheck`
Expected: 272 passing, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/schema.test.ts
git commit -m "$(cat <<'EOF'
feat(api): a day remembers the vigil that weighed it

day_points is computed on read, so weighing it by the live streak would
have quietly rewritten every past reveal each time the vigil moved. One
row per user per round, stamped once, never revised.

Migration 0005 still needs applying by hand to dev and prod Neon.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 7: Settlement stamps the incoming vigil

**Files:**
- Modify: `apps/api/src/settlement.ts:31-66` (inside `settleRound`'s per-user loop)
- Test: `apps/api/test/settlement.test.ts` (append)

**Interfaces:**
- Consumes: `schema.userRounds` (Task 6), `vigilMultiplier` (Task 5).
- Produces: a `user_rounds` row per **played** user per settled round.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/settlement.test.ts`:

```ts
describe("settleRound stamps the vigil", () => {
  it("stamps the vigil carried INTO the day, not the one earned by it", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");

    const users = await db.query.users.findMany();
    // The day was played, so the streak LEAVES at 1...
    expect(users[0]!.streakCurrent).toBe(1);
    // ...but it ARRIVED at 0, and 0 is what weighed it.
    const stamped = await db.query.userRounds.findMany();
    expect(stamped).toHaveLength(1);
    expect(Number(stamped[0]!.vigilMult)).toBe(1);
  });

  it("does not stamp a user who did not play", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const b = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    // b exists and was in the audience only if they held a streak; either way
    // a user with no predictions has no day to weigh.
    expect(await db.query.userRounds.findMany()).toHaveLength(1);
    void b;
  });

  it("is idempotent — a re-settle never revises the stamp", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T16:30:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    await playedRound(db, app, "2026-08-20", [{ p: a, slots: [1] }]);
    await settleRound(db, "2026-08-20");
    await resettleRound(db, "2026-08-20");
    const stamped = await db.query.userRounds.findMany();
    expect(stamped).toHaveLength(1);
    expect(Number(stamped[0]!.vigilMult)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pnpm vitest run test/settlement.test.ts`
Expected: FAIL — 0 rows in `user_rounds`.

- [ ] **Step 3: Implement**

In `apps/api/src/settlement.ts`, add `vigilMultiplier` to the `@oracle/core` import. Inside `settleRound`'s per-user loop, immediately **after** `const played = (byUser.get(u.id) ?? 0) > 0;` and **before** the `settleStreak` call:

```ts
    // Stamp the vigil that weighed this day BEFORE settleStreak advances it.
    // `u.streakCurrent` here is the vigil carried INTO the round -- fixed
    // before any of today's outcomes existed, which is exactly why weighing
    // by it leaves the scoring rule proper (spec §A.3). Do-nothing on
    // conflict: a crash-retry or a resettle must never revise a stamped day.
    if (played) {
      await db.insert(schema.userRounds)
        .values({ userId: u.id, date, vigilMult: String(vigilMultiplier(u.streakCurrent)) })
        .onConflictDoNothing();
    }
```

Leave `resettleRound` untouched — it recomputes truth and must not touch the stamp.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/api && pnpm vitest run test/settlement.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd apps/api && pnpm test && pnpm typecheck`
Expected: 275 passing, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/settlement.ts apps/api/test/settlement.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the day is stamped with the vigil it arrived with

Not the one it leaves with. A day played on a seven-day vigil is weighed
by seven, and the eighth is earned by surviving it -- which is also the
value that was fixed before any of the day's outcomes existed, and so
the value that leaves the scoring rule proper.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 8: The reveal serves the weighed day

**Files:**
- Modify: `packages/core/src/schemas.ts:66` (`RevealSchema`)
- Modify: `packages/core/test/round-schemas.test.ts` — **the fixture; see Global Constraints**
- Modify: `apps/api/src/routes/round.ts:106-118`
- Test: `apps/api/test/resolve-reveal.test.ts` (append)

**Interfaces:**
- Consumes: `schema.userRounds` (Task 6), `vigilPoints` (Task 5).
- Produces: `RevealSchema` gains `vigil_mult: z.number().nullable()`. `day_points` becomes the **weighed** total when `vigil_mult` is non-null, and the raw total when it is null (in which case the client must withhold it — Task 9).

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/resolve-reveal.test.ts`:

```ts
describe("the reveal serves the weighed day", () => {
  it("returns a null multiplier and the raw total before settlement stamps it", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qs[0]!.id, answer: true, confidence: 85, idempotency_key: "k" }) });
    for (const q of qs) await resolveQuestion(db, q.id, "yes");

    const res = await a("/v1/round/2026-08-20/reveal");
    const body = (await res.json()) as { vigil_mult: number | null; day_points: number };
    expect(body.vigil_mult).toBeNull();
    expect(body.day_points).toBeGreaterThan(0);
  });

  it("weighs the day once the vigil is stamped", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    await a("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qs[0]!.id, answer: true, confidence: 85, idempotency_key: "k" }) });
    for (const q of qs) await resolveQuestion(db, q.id, "yes");

    const before = (await (await a("/v1/round/2026-08-20/reveal")).json()) as { day_points: number };
    const raw = before.day_points;

    const [u] = await db.query.users.findMany();
    await db.insert(schema.userRounds).values({ userId: u!.id, date: "2026-08-20", vigilMult: "1.5" });

    const after = (await (await a("/v1/round/2026-08-20/reveal")).json()) as { vigil_mult: number | null; day_points: number };
    expect(after.vigil_mult).toBeCloseTo(1.5, 10);
    expect(after.day_points).toBe(Math.round(raw * 1.5));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/api && pnpm vitest run test/resolve-reveal.test.ts`
Expected: FAIL — `vigil_mult` is undefined.

- [ ] **Step 3: Grow the schema, and fix the fixture in the same breath**

In `packages/core/src/schemas.ts`, inside `RevealSchema`, directly under `day_points`:

```ts
  // How heavily the vigil weighed this day, stamped at settlement. Null means
  // the day has not been weighed yet -- the client must withhold the number
  // rather than print a total that will change (see revealRows.pointsWithheld).
  vigil_mult: z.number().nullable(),
```

Then **immediately** run the core suite and repair `packages/core/test/round-schemas.test.ts`'s fixture — growing `RevealSchema` has broken it twice before:

Run: `cd packages/core && pnpm test`
Expected: FAIL in `round-schemas.test.ts` until you add `vigil_mult: null` to the fixture. Add it, re-run, expect PASS.

- [ ] **Step 4: Implement the route change**

In `apps/api/src/routes/round.ts`, add `vigilPoints` to the `@oracle/core` import and `and` to the drizzle import if absent. Replace the `perQuestionPoints` / `allFirstHour` block and the `day_points` line:

```ts
    const perQuestionPoints = mine.map((p) => p.points ?? 0);
    const allFirstHour = mine.length === qs.length && mine.every((p) => p.firstHour);
    const raw = dayPoints(perQuestionPoints, allFirstHour);
    // The vigil that weighed this day, stamped at settlement. Absent means
    // unweighed, not weightless: the client withholds the number entirely
    // rather than print one that would climb on the next refresh.
    const stamped = await db.query.userRounds.findFirst({
      where: and(eq(schema.userRounds.userId, userId), eq(schema.userRounds.date, date)),
    });
    const vigilMult = stamped ? Number(stamped.vigilMult) : null;
```

and in the JSON body:

```ts
      day_points: vigilMult === null ? raw : Math.round(raw * vigilMult),
      vigil_mult: vigilMult,
```

**Note:** the route multiplies directly rather than calling `vigilPoints(raw, streak)`, because the *stamped multiplier* is the authority here, not a streak re-derived at read time. `vigilPoints` remains the single definition used at every site that starts from a streak.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd apps/api && pnpm vitest run test/resolve-reveal.test.ts`
Expected: PASS.

- [ ] **Step 6: All three suites + typecheck**

Run: `cd packages/core && pnpm test && cd ../../apps/api && pnpm test && pnpm typecheck && cd ../mobile && pnpm typecheck`
Expected: core 87, api 277, all typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/test/round-schemas.test.ts apps/api/src/routes/round.ts apps/api/test/resolve-reveal.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the reveal serves the day at the weight it was given

An unstamped day reports a null multiplier rather than a silent one, so
the client can withhold the total instead of printing a number that
would climb the moment settlement caught up -- the same trade the
withheld-until-read slot already makes for a half-resolved day.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 9: The reveal shows the vigil's weight

**Files:**
- Modify: `apps/mobile/src/game/revealRows.ts` (append two pure functions)
- Modify: `apps/mobile/src/app/reveal/[date].tsx:230-245`
- Test: `apps/mobile/test/revealRows.test.ts` (append; create if absent)

**Interfaces:**
- Consumes: `Reveal` from `@oracle/core` (now carrying `vigil_mult`).
- Produces:
  ```ts
  export function pointsWithheld(d: Reveal): boolean
  export function vigilWeightLine(d: Reveal): string | null
  ```

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/revealRows.test.ts` already has a `question(overrides)` helper but no whole-`Reveal` helper. Add one beside it, then append the tests. Extend the file's existing import from `../src/game/revealRows` with `pointsWithheld, vigilWeightLine`.

```ts
function reveal({ vigil_mult, outcomes }: { vigil_mult: number | null; outcomes: Array<"yes" | "no" | null> }): Reveal {
  return {
    date: "2026-08-20",
    day_points: 120,
    first_hour: false,
    vigil_mult,
    questions: outcomes.map((outcome, i) => question({ slot: i + 1, outcome })),
    ledger: { settled: true, streak: 3, calls_rated: 12, oracle_score: null },
  };
}

describe("pointsWithheld", () => {
  it("withholds while any row is unread", () => {
    const d = reveal({ vigil_mult: 1.2, outcomes: ["yes", null] });
    expect(pointsWithheld(d)).toBe(true);
  });

  it("withholds a fully-read day that has not been weighed yet", () => {
    // Every row resolved but settlement has not stamped the vigil. Printing
    // the raw total here is the provisional-number bug in a new costume.
    const d = reveal({ vigil_mult: null, outcomes: ["yes", "no"] });
    expect(pointsWithheld(d)).toBe(true);
  });

  it("releases the number once the day is both read and weighed", () => {
    const d = reveal({ vigil_mult: 1.0, outcomes: ["yes", "no"] });
    expect(pointsWithheld(d)).toBe(false);
  });
});

describe("vigilWeightLine", () => {
  it("says nothing at a weight of one", () => {
    expect(vigilWeightLine(reveal({ vigil_mult: 1, outcomes: ["yes"] }))).toBeNull();
  });

  it("says nothing before the day is weighed", () => {
    expect(vigilWeightLine(reveal({ vigil_mult: null, outcomes: ["yes"] }))).toBeNull();
  });

  it("names the weight when the vigil earned one", () => {
    expect(vigilWeightLine(reveal({ vigil_mult: 1.35, outcomes: ["yes"] }))).toBe("THE VIGIL WEIGHS THIS DAY ×1.35");
  });

  it("trims a trailing zero rather than printing 1.50", () => {
    expect(vigilWeightLine(reveal({ vigil_mult: 1.5, outcomes: ["yes"] }))).toBe("THE VIGIL WEIGHS THIS DAY ×1.5");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/mobile && pnpm vitest run test/revealRows.test.ts`
Expected: FAIL — `pointsWithheld is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/mobile/src/game/revealRows.ts`:

```ts
// The day's number is released only when it is both fully read AND weighed.
// The first condition was already enforced by the ceremony; the second is
// new, and it is the same principle: a total that changes after it has been
// shown is the revision the liturgy promises never happens.
export function pointsWithheld(d: Reveal): boolean {
  const anyPending = d.questions.some((q) => q.outcome === null);
  return anyPending || d.vigil_mult === null;
}

// Said once, for the day, never per question -- the per-row points still
// match the payoff the card promised at seal time, and they must, or the
// promise was a lie.
export function vigilWeightLine(d: Reveal): string | null {
  if (d.vigil_mult === null || d.vigil_mult <= 1) return null;
  const weight = String(Number(d.vigil_mult.toFixed(2)));
  return `THE VIGIL WEIGHS THIS DAY ×${weight}`;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd apps/mobile && pnpm vitest run test/revealRows.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the render**

In `apps/mobile/src/app/reveal/[date].tsx`, import `pointsWithheld` and `vigilWeightLine` from `../../game/revealRows`, and replace the `anyPending ? … : …` ternary's condition with `pointsWithheld(d)`. Add the weight line beside the first-hour badge:

```tsx
              <RollingPoints value={d.day_points} delayMs={POINTS_DELAY} />
              <Mono size={10} color={colors.mutedInk} letterSpacing={5} style={{ marginRight: -5 }}>DAY POINTS</Mono>
              {d.first_hour && d.day_points > 0 && (
                <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>FIRST HOUR +10%</Mono>
              )}
              {vigilWeightLine(d) && (
                <Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>{vigilWeightLine(d)}</Mono>
              )}
```

Leave `anyPending` in place wherever else it is used (e.g. the `allSpectator && !anyPending` lapsed line) — only the points slot changes.

**Also:** the share button is withheld with the number (existing behaviour, audit 2026-09-02 §9.9). Confirm whatever guards it now reads `pointsWithheld(d)` too, so a provisional card still cannot leave the app.

- [ ] **Step 6: Typecheck + full mobile suite**

Run: `cd apps/mobile && pnpm typecheck && pnpm test`
Expected: typecheck clean, 256 passing (249 + 7).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/revealRows.ts apps/mobile/src/app/reveal/[date].tsx apps/mobile/test/revealRows.test.ts
git commit -m "$(cat <<'EOF'
fix(mobile): the day's number waits to be weighed as well as read

The slot already refused to print a half-read day. An unweighed one is
the same bug wearing different clothes -- the total is real and it will
still change. The weight is said once, for the day; the per-row points
stay exactly what the card promised when it was pulled.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 10: The rites name the vigil's stake and the shield's rule

**Files:**
- Modify: `packages/core/src/copy.ts` (`RITES_LINES` reorder + two new lines, `OPENING_RITES`)
- Test: `packages/core/test/copy-lint.test.ts` (extend the tripwire block)

**Interfaces:**
- Consumes: `CONSTANTS.SHIELD_MIN_STREAK`, `CONSTANTS.VIGIL_MULT_MAX_DAYS`.
- Produces: `OPENING_RITES` rises from 7 to 9. `RITES_LINES` grows from 14 to 15.

**⚠ This is a reorder, not an insertion.** `OPENING_RITES_LINES` is literally `RITES_LINES.slice(0, OPENING_RITES)` and `copy-lint.test.ts` asserts that identity. A rule's numeral must mean the same thing on both screens.

**Why:** the shield rule is currently rite XIII — the last of the seven deferred rules, behind a QuietLink — so a player walking the intended path never reads it, while `SHIELDS IN RESERVE` is a permanent plaque row and `RAISE THE SHIELD` is a real-money purchase on Home.

- [ ] **Step 1: Write the failing tripwires**

In `packages/core/test/copy-lint.test.ts`, extend the existing tripwire test (the one asserting `SHIELD_MIN_STREAK`/`CONTRARIAN_MIN_CROWD`/`ORACLE_SCORE_MIN_CALLS`) with:

```ts
    // The vigil's stake, pinned to the engine that pays it. A player is told
    // the day is weighed in BOTH directions -- if that ever stops being true
    // in scoring.ts, this line becomes a lie and this assertion the alarm.
    expect(CONSTANTS.VIGIL_MULT_MAX_DAYS).toBe(10);
    expect(all).toContain("TEN DAYS");
    expect(all).toContain("IN BOTH DIRECTIONS");
```

and add a new test:

```ts
  it("teaches the shield before it is ever sold", () => {
    // The shield is a real-money purchase surfaced on Home and a permanent
    // plaque row. A player who reads only the opening must still meet it.
    const opening = OPENING_RITES_LINES.join(" ");
    expect(opening).toContain("SHIELD");
    expect(opening).toContain("THREE DAYS OR MORE");
    // ...and the stake the shield exists to defend.
    expect(opening).toContain("WEIGHS");
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd packages/core && pnpm vitest run test/copy-lint.test.ts`
Expected: FAIL — the opening contains no SHIELD.

- [ ] **Step 3: Reorder the canon**

Replace `RITES_LINES` in `packages/core/src/copy.ts` with this exact list, and set `OPENING_RITES = 9`:

```ts
export const RITES_LINES = [
  // ── the opening: everything the first card depends on ──
  "FIVE QUESTIONS. ONCE A DAY. NOON TO NOON, NEW YORK TIME.",
  "PULL TOWARD YES OR NO. THE LONGER THE PULL, THE GREATER THE CONVICTION. TO RELEASE IS TO SEAL.",
  "AN ANSWER SEALED CANNOT BE UNSEALED. THE CROWD IS HIDDEN UNTIL YOU COMMIT.",
  "CONVICTION PAYS WHEN RIGHT. IT COSTS MORE WHEN WRONG.",
  "EVERY ANSWER YOU SEAL IS A CALL. THE LEDGER RATES IT AGAINST WHAT HAPPENED.",
  "FIFTY RATED CALLS WRITE YOUR ORACLE SCORE. FIVE A DAY, SO TEN DAYS AT THE LEAST.",
  "A DAY'S CALLS RATE ONLY IF ALL FIVE WERE SEALED. POINTS AND VIGIL COUNT EITHER WAY.",
  "A VIGIL IS A RUN OF UNBROKEN NOONS. IT WEIGHS EVERY DAY YOU KEEP IT, IN BOTH DIRECTIONS.",
  "MISS A NOON AND A SHIELD MAY HOLD A VIGIL OF THREE DAYS OR MORE. ONE IS GRANTED EACH MONTH.",
  // ── the rest: met in play, kept on the standing link ──
  "THE VIGIL'S WEIGHT RISES FOR TEN DAYS AND THEN HOLDS. NOTHING BOUGHT CHANGES YOUR ORACLE SCORE.",
  "A QUESTION CLOSES THE MOMENT ITS ANSWER BEGINS TO EXIST. SOME CLOSE BEFORE NOON.",
  "THE BIG ONE COUNTS DOUBLE. IN BOTH DIRECTIONS.",
  "STAND AGAINST THE TIDE AND PREVAIL: THE LEDGER ADDS A BOUNTY. TWENTY MUST HAVE SPOKEN.",
  "SEAL ALL FIVE WITHIN THE FIRST HOUR. THE DAY PAYS TEN PERCENT MORE.",
  "THE LEDGER IS READ AT NOON. NOTHING IS REVISED.",
] as const;
```

Then: `export const OPENING_RITES = 9;`

- [ ] **Step 4: Run the core suite**

Run: `cd packages/core && pnpm test`
Expected: PASS. If `copy-select.test.ts` or `schemas.test.ts` asserts a rite count, update it. Every line must still satisfy caps / no-`!` / no-CTA / ≤140 chars — check the two new lines against that by eye if the lint is silent about length.

- [ ] **Step 5: Confirm the mobile numeral gutter still fits**

`rites.tsx` sizes its numeral gutter for the widest numeral; the canon now runs to XV. Run:

Run: `cd apps/mobile && pnpm typecheck`
Expected: clean. Note for the device pass: **verify XIII/XIV/XV do not wrap the gutter** — `gutter` is `40 * useChromeScale()` and was sized when the canon ended at XIV.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts
git commit -m "$(cat <<'EOF'
feat(core): the vigil's stake is stated, and the shield is taught before it is sold

The shield lived at rite XIII, behind a link a player following the
intended path never opens -- while the plaque counted shields in reserve
and Home offered to sell one. It joins the opening, alongside the rule
that now gives it something to defend. Both numbers are pinned to their
constants by tripwire.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 11: The paywall states the mechanic

**Files:**
- Modify: `packages/core/src/copy.ts` (`paywall.creed-*`)
- Test: `packages/core/test/copy-lint.test.ts` (extend)

**Interfaces:**
- Consumes: `CONSTANTS.SHIELD_MIN_STREAK`. `plus.tsx` already renders every `paywall.creed*` line in order — **no mobile change is needed.**

**Why:** the creed argues poetically ("THE VIGIL IS FRAGILE. THE SHIELD IS NOT.") and never says what a shield does, when it fires, or what a subscription grants. A player is asked for real money against a promise with no mechanism attached.

- [ ] **Step 1: Write the failing tripwire**

Add to `packages/core/test/copy-lint.test.ts`:

```ts
  it("the paywall states the mechanic it charges for", () => {
    const creed = COPY_BANK.filter((l) => l.pool === "paywall" && l.id.startsWith("paywall.creed")).map((l) => l.text).join(" ");
    expect(CONSTANTS.SHIELD_MIN_STREAK).toBe(3);
    expect(creed).toContain("THREE DAYS OR MORE");
    // What the subscription actually grants, in the player's words.
    expect(creed).toContain("THREE SHIELDS");
    // The wall that makes the whole economy honest, said at the till.
    expect(creed).toContain("ORACLE SCORE");
  });
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd packages/core && pnpm vitest run test/copy-lint.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the creed**

Replace the four `paywall.creed`/`paywall.terms` lines in `COPY_BANK` with:

```ts
  { id: "paywall.creed-1", pool: "paywall", text: "A SHIELD HOLDS A VIGIL OF THREE DAYS OR MORE THROUGH ONE MISSED NOON." },
  { id: "paywall.creed-2", pool: "paywall", text: "THE ORACLE GRANTS ONE EACH MONTH. PLUS ADDS THREE SHIELDS A PERIOD, TO A RESERVE OF FIVE." },
  { id: "paywall.creed-3", pool: "paywall", text: "A KEPT VIGIL WEIGHS EVERY DAY YOU PLAY, IN BOTH DIRECTIONS." },
  { id: "paywall.creed-4", pool: "paywall", text: "NOTHING HERE TOUCHES YOUR ORACLE SCORE. THAT NUMBER IS EARNED OR IT IS NOTHING." },
```

Keep `paywall.rescue-1` unchanged. Delete `paywall.terms-1` only if nothing renders it — check with:

Run: `grep -rn "paywall.terms" apps/mobile/src apps/api/src packages/core/src`
If anything references it, keep it.

- [ ] **Step 4: Run and watch it pass**

Run: `cd packages/core && pnpm vitest run test/copy-lint.test.ts`
Expected: PASS. Every line must be ≤140 chars and free of banned CTA verbs — the lint enforces both.

- [ ] **Step 5: Full core suite + mobile typecheck**

Run: `cd packages/core && pnpm test && cd ../../apps/mobile && pnpm typecheck`
Expected: core green, mobile typecheck clean (`plus.tsx` filters by `id.startsWith("paywall.creed")`, so a fourth line renders with no code change).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-lint.test.ts
git commit -m "$(cat <<'EOF'
feat(core): the paywall says what it sells

Four lines of poetry about a fragile vigil, and not one of them said
what a shield does, when it fires, or what a subscription grants. The
creed now states the three-day floor, the grant and the reserve cap --
and, at the till where it matters most, that none of it touches the
Oracle Score.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 12: Standing among sealed records

**Files:**
- Modify: `packages/core/src/constants.ts` (`PERCENTILE_MIN_COHORT`)
- Modify: `packages/core/src/schemas.ts` (`MeLedgerSchema`)
- Modify: `apps/api/src/routes/me.ts`
- Test: `apps/api/test/ledger.test.ts` (append)

**Interfaces:**
- Produces: `MeLedgerSchema` gains `percentile: z.number().int().nullable()` and `cohort_size: z.number().int()`.

**Why Oracle Score and not day points:** day points now carry the vigil multiplier, which is purchasable-adjacent via the shield. The Oracle Score is raw Briers and nothing purchasable touches it. Ranking standing on it *because* of that makes the truth wall load-bearing rather than decorative.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/ledger.test.ts`:

```ts
describe("standing", () => {
  const withScore = async (db: Awaited<ReturnType<typeof makeTestDb>>["db"], score: number | null) =>
    (await db.insert(schema.users).values({ oracleScore: score, callsResolved: score === null ? 0 : 50 }).returning())[0]!;

  it("is null for a player whose score is unwritten", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const res = await a("/v1/me/ledger");
    const body = (await res.json()) as { percentile: number | null };
    expect(body.percentile).toBeNull();
  });

  it("is null while the cohort is too small to mean anything", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 700, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    for (let i = 0; i < 5; i++) await withScore(db, 600);
    const body = (await (await a("/v1/me/ledger")).json()) as { percentile: number | null; cohort_size: number };
    expect(body.cohort_size).toBe(6);
    expect(body.percentile).toBeNull();
  });

  it("reports the share of the cohort standing below, once the cohort is large enough", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 900, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    // 19 others, all below → 19 of 20 below → 95th.
    for (let i = 0; i < 19; i++) await withScore(db, 500);
    const body = (await (await a("/v1/me/ledger")).json()) as { percentile: number | null; cohort_size: number };
    expect(body.cohort_size).toBe(20);
    expect(body.percentile).toBe(95);
  });

  it("does not count unwritten scores in the cohort", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const a = await player(app);
    const [me] = await db.query.users.findMany();
    await db.update(schema.users).set({ oracleScore: 900, callsResolved: 50 }).where(eq(schema.users.id, me!.id));
    for (let i = 0; i < 19; i++) await withScore(db, 500);
    for (let i = 0; i < 30; i++) await withScore(db, null);
    const body = (await (await a("/v1/me/ledger")).json()) as { cohort_size: number };
    expect(body.cohort_size).toBe(20);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd apps/api && pnpm vitest run test/ledger.test.ts`
Expected: FAIL — `percentile` is undefined.

- [ ] **Step 3: Add the constant and the schema fields**

In `packages/core/src/constants.ts`, inside `CONSTANTS`:

```ts
  PERCENTILE_MIN_COHORT: 20,  // a percentile over eleven people is mostly the reader
```

In `packages/core/src/schemas.ts`, inside `MeLedgerSchema` after `oracle_score`:

```ts
  // Where this record stands among every written Oracle Score. Null until the
  // caller's own score exists AND the cohort is worth comparing against.
  percentile: z.number().int().nullable(),
  cohort_size: z.number().int(),
```

- [ ] **Step 4: Implement the route**

In `apps/api/src/routes/me.ts`, add `isNotNull, lt, and` to the drizzle import and `CONSTANTS` to the `@oracle/core` import. Before the `return c.json({`:

```ts
    // Standing is read against the Oracle Score and nothing else. Day points
    // now carry the vigil's weight, which a shield can be bought to defend --
    // the score is the only number no purchase can reach, which is exactly
    // what makes it the honest thing to rank.
    const score = user?.oracleScore ?? null;
    const [{ n: cohortSize }] = await db
      .select({ n: count() })
      .from(schema.users)
      .where(isNotNull(schema.users.oracleScore));
    let percentile: number | null = null;
    if (score !== null && Number(cohortSize) >= CONSTANTS.PERCENTILE_MIN_COHORT) {
      const [{ n: below }] = await db
        .select({ n: count() })
        .from(schema.users)
        .where(and(isNotNull(schema.users.oracleScore), lt(schema.users.oracleScore, score)));
      percentile = Math.round((100 * Number(below)) / Number(cohortSize));
    }
```

and in the response body, next to `oracle_score`:

```ts
      percentile,
      cohort_size: Number(cohortSize),
```

- [ ] **Step 5: Run and watch it pass**

Run: `cd apps/api && pnpm vitest run test/ledger.test.ts`
Expected: PASS.

- [ ] **Step 6: All suites + typecheck**

Run: `cd packages/core && pnpm test && cd ../../apps/api && pnpm test && pnpm typecheck`
Expected: core green, api 281 passing, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/constants.ts packages/core/src/schemas.ts apps/api/src/routes/me.ts apps/api/test/ledger.test.ts
git commit -m "$(cat <<'EOF'
feat(api): the ledger can say where a record stands

Against the Oracle Score and nothing else. Day points now carry the
vigil's weight and a shield can be bought to defend it; the score is the
one number no purchase reaches, which is what makes it the only honest
thing to rank. Silent below twenty written scores -- a percentile over
eleven people is mostly the reader.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Task 13: The plaque prints your standing

**Files:**
- Create: `apps/mobile/src/game/standing.ts`
- Create: `apps/mobile/test/standing.test.ts`
- Modify: `apps/mobile/src/app/ledger.tsx` (one row under the score gloss)

**Interfaces:**
- Consumes: `MeLedger` (now carrying `percentile`, `cohort_size`).
- Produces: `export function standingLine(percentile: number | null, cohortSize: number): string | null`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/standing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { standingLine } from "../src/game/standing";

describe("standingLine", () => {
  it("says nothing before a standing exists", () => {
    expect(standingLine(null, 0)).toBeNull();
    expect(standingLine(null, 4)).toBeNull();
  });

  it("names the share of records standing below", () => {
    expect(standingLine(94, 312)).toBe("SHARPER THAN 94% OF 312 SEALED RECORDS");
  });

  it("does not boast at the bottom of the cohort", () => {
    // 0% below is a true statement and a cruel headline. Say the cohort
    // instead; the score itself is already on the plaque above.
    expect(standingLine(0, 40)).toBe("ONE OF 40 SEALED RECORDS");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd apps/mobile && pnpm vitest run test/standing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/game/standing.ts`:

```ts
// Where this record stands among every written Oracle Score. The API withholds
// the percentile until the caller has a score AND the cohort is worth
// comparing against, so a null here means "not yet", never "last".
export function standingLine(percentile: number | null, cohortSize: number): string | null {
  if (percentile === null) return null;
  // Zero below is true and unkind, and it is also the least informative thing
  // the plaque could say. The number itself is already carved above this row.
  if (percentile <= 0) return `ONE OF ${cohortSize} SEALED RECORDS`;
  return `SHARPER THAN ${percentile}% OF ${cohortSize} SEALED RECORDS`;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `cd apps/mobile && pnpm vitest run test/standing.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the row**

In `apps/mobile/src/app/ledger.tsx`, import `standingLine`, and immediately after the `SCORE_GLOSS` `<Mono>` block add:

```tsx
            {standingLine(d.percentile, d.cohort_size) && (
              <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ lineHeight: 15 }}>
                {standingLine(d.percentile, d.cohort_size)}
              </Mono>
            )}
```

The plaque's `PLAQUE_MIN_H` is a floor and this row is one line — but Task 1 made the column stable, so confirm on device that the plaque does not grow past its reserved height when a standing appears.

- [ ] **Step 6: The vigil row states its own stake** (spec §A.6.4)

The plaque's `CURRENT VIGIL` row prints a bare day count for a thing that now weighs every day played. It needs to say so — but the plaque already carries `SCORE_GLOSS` and the new standing line, so this goes **in the row's value**, not in a third paragraph of gloss.

Write the failing test first. Append to `apps/mobile/test/standing.test.ts`:

```ts
import { vigilStat } from "../src/game/standing";

describe("vigilStat", () => {
  it("is a plain count while the vigil carries no weight", () => {
    expect(vigilStat(0)).toBe("0 DAYS");
    expect(vigilStat(1)).toBe("1 DAY");
  });

  it("names the weight the vigil has earned", () => {
    expect(vigilStat(3)).toBe("3 DAYS · ×1.15");
    expect(vigilStat(10)).toBe("10 DAYS · ×1.5");
  });

  it("holds at the ceiling", () => {
    expect(vigilStat(40)).toBe("40 DAYS · ×1.5");
  });
});
```

Run: `cd apps/mobile && pnpm vitest run test/standing.test.ts` → FAIL.

Append to `apps/mobile/src/game/standing.ts`:

```ts
import { vigilMultiplier } from "@oracle/core";

// The vigil's row says what the vigil now does. A bare day count was honest
// when the streak was a pride number; it is not, now that it weighs the day.
export function vigilStat(streak: number): string {
  const days = `${streak} ${streak === 1 ? "DAY" : "DAYS"}`;
  const m = vigilMultiplier(streak);
  return m <= 1 ? days : `${days} · ×${String(Number(m.toFixed(2)))}`;
}
```

Run again → PASS. Then in `ledger.tsx` replace the vigil Stat's value:

```tsx
            <Stat label="CURRENT VIGIL" value={vigilStat(d.streak)} />
```

- [ ] **Step 7: Typecheck + full suites**

Run: `cd apps/mobile && pnpm typecheck && pnpm test`
Expected: typecheck clean, 262 passing (256 + 3 standing + 3 vigilStat).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/standing.ts apps/mobile/test/standing.test.ts apps/mobile/src/app/ledger.tsx
git commit -m "$(cat <<'EOF'
feat(mobile): the plaque says where the record stands

One line under the score, and none at all until there is a cohort worth
standing in. At the bottom of that cohort it names the cohort rather
than the rank -- zero percent below is true, uninformative and cruel,
and the number it would be explaining is already carved above it.

Claude-Session: https://claude.ai/code/session_0127gcBZ6eFpJDwFfySVS4zK
EOF
)"
```

---

## Final verification

- [ ] **All three suites green from a clean state**

```bash
cd /Users/eriktaheri/Development/oracle && pnpm test && pnpm typecheck
```
Expected: core 90+, api 281+, mobile 259+, typecheck clean in all three.

- [ ] **The truth wall is intact**

```bash
grep -rn "vigil" packages/core/src/scoring.ts | grep -i "brier\|oracleScore"
```
Expected: **no matches.** `oracleScore` and `brier` must never reference the vigil. If this greps anything, the truth economy has been contaminated and the change must be reverted.

- [ ] **The negative control still fails as designed**

```bash
cd packages/core && pnpm vitest run test/scoring-day.test.ts -t "negative control"
```
Expected: PASS (the test asserts the wins-only variant *is* improper). If it ever fails, the property test has gone blind.

## Hand-off to Erik — needs hands, not code

1. **Apply migration 0005** to dev **and** prod Neon by hand (`psql`). Prod still has not had **0004** applied; 0005 depends on nothing from 0004, but both are outstanding.
2. **Device pass** on: the ledger's first load (no jump), the rites' single return in both readings, numerals XIII–XV not wrapping the gutter, and the reveal's vigil-weight line.
3. **Tune or accept** `VIGIL_MULT_PER_DAY` (0.05) and `VIGIL_MULT_MAX_DAYS` (10) after feeling a weighed day.
4. **Run the leak report** once there is real data: `curl -H "x-admin-secret: $ADMIN_SECRET" $API/admin/analytics/leak` — and read the caveat before acting on it.
