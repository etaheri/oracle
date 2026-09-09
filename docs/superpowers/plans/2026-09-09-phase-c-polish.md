# Phase C — Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the share actually carry the challenge and a link, show players how the crowd moved after they committed, and time the daily reminder to when this device actually plays.

**Architecture:** Three independent slices. **Share:** the share sheet sends text and image together (today the text is passed as the dialog title, which iOS drops), the card gets an optional rendered handle, and the public site gains a `/play` smart link so an https URL is tappable anywhere and opens the app when installed. **Crowd movement:** the server snapshots the crowd at the instant of each seal (two columns on `predictions`, computed inside the seal handler so it is precise and never shown before the seal); the client compares it to the live or final crowd through one pure helper, respecting both existing floors. **Habitual hour:** the first seal of each day records the device's local hour; a pure planner shifts the closing reminder to that hour once three days of history exist.

**Tech Stack:** TypeScript, Hono on Cloudflare Workers, Drizzle ORM (Neon HTTP in prod, PGlite in tests), Zod, Vitest, pnpm workspaces. Mobile: Expo SDK 57 / React Native, Skia, expo-secure-store, Vitest (pure-function tests only; UI verified on device via the `run-oracle-mobile` skill). Site: Cloudflare Worker static assets.

**Spec:** `docs/superpowers/specs/2026-09-09-engagement-and-integrity-design.md` (Sections 3.2, 4.1, 4.2).

## Global Constraints

- iOS first; existing stacks only. No new third-party services. No new npm dependencies (React Native's built-in `Share` is already available).
- No crowd, market, or Oracle probabilities before a player's answer is sealed. The crowd-at-seal snapshot is written at seal time and is never returned by any endpoint before the player has sealed that question.
- Respect both crowd floors: `VERDICT_MIN_PLAYERS = 5` (display, `apps/mobile/src/game/crowdVerdict.ts`) and `CONTRARIAN_MIN_CROWD = 20` (bounty, `packages/core`). A movement line never claims a bounty and prints nothing when either snapshot is under the display floor.
- Player-facing copy holds the register: tracked caps, no emoji, no exclamation. Skia's Plex Mono has no glyph fallback: card text is ASCII only.
- Every server write stays idempotent; tests never touch the network.
- Migrations are additive; existing rows default to null.
- Reminder planning stays pure (`apps/mobile/src/game/reminders.ts` is node-tested); Expo scheduling stays in `src/notifications/schedule.ts`.
- Run tests from the package directory; typecheck with `pnpm typecheck`. Commit after every task; messages end with `Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc`.

## File map

| File | Responsibility |
|---|---|
| `apps/mobile/src/ui/ShareCard.tsx` | `shareSnapshot` sends text + image via RN `Share` on iOS; `ShareFooter` renders the handle on both cards |
| `apps/mobile/src/ui/PlaqueShareCard.tsx` | uses `ShareFooter` |
| `apps/mobile/src/game/sharePattern.ts` | `plaqueMessage` |
| `apps/mobile/src/config/links.ts` | `SHARE_HANDLE` |
| `apps/mobile/src/app/ledger.tsx` | plaque share carries a message |
| `apps/site/public/play.html` | smart link page |
| `apps/api/src/db/schema.ts` + `drizzle/0013_*.sql` | `predictions.crowd_yes_pct_at_seal`, `crowd_count_at_seal` |
| `apps/api/src/routes/predictions.ts` | snapshot at seal |
| `apps/api/src/routes/round.ts` | expose the snapshot on `/today/mine` and the reveal's `my` |
| `packages/core/src/schemas.ts` | `MineTodaySchema`, `RevealSchema.my` gain the two fields |
| `apps/mobile/src/game/crowdMovement.ts` (new) | pure movement line |
| `apps/mobile/src/game/roundStore.ts`, `useHydratePlayedState.ts` | carry the at-seal snapshot |
| `apps/mobile/src/ui/CrowdReveal.tsx`, `src/game/revealRows.ts`, `src/app/reveal/[date].tsx` | show the movement |
| `apps/mobile/src/api/flags.ts` | `recordSealHour`, `getSealHours` |
| `apps/mobile/src/game/habit.ts` (new) | `habitualHour` |
| `apps/mobile/src/game/reminders.ts`, `src/notifications/schedule.ts`, `src/ui/OracleCard.tsx` | habitual-hour planning and recording |

---

### Task 1: The share carries text and image; the cards render a handle; the site gets `/play`

**Files:**
- Modify: `apps/mobile/src/ui/ShareCard.tsx` (`shareSnapshot`, new `ShareFooter`, footer usage)
- Modify: `apps/mobile/src/ui/PlaqueShareCard.tsx` (use `ShareFooter`)
- Modify: `apps/mobile/src/game/sharePattern.ts` (`plaqueMessage`)
- Modify: `apps/mobile/src/config/links.ts` (`SHARE_HANDLE`)
- Modify: `apps/mobile/src/app/ledger.tsx` (`handleShare` passes a message)
- Create: `apps/site/public/play.html`
- Test: `apps/mobile/test/sharePattern.test.ts`

**Interfaces:**
- Produces: `SHARE_HANDLE: string | null` from `process.env.EXPO_PUBLIC_SHARE_HANDLE` (a short display string for the card, e.g. `outseen.app`; unset today).
- Produces: `plaqueMessage(epithetTitle: string, url = SHARE_URL): string` → `🔮 OUTSEEN — ${title} · can you outsee me?` + url.
- `shareSnapshot(ref, filename, message)`: third parameter is now the share MESSAGE (was the dialog title). On iOS uses `Share.share({ url: file.uri, message }, { dialogTitle: message })` from `react-native`; on other platforms keeps `Sharing.shareAsync(file.uri, { mimeType, dialogTitle: message })`.
- `ShareFooter({ mono, monoSmall, y, width })`: renders "CAN YOU OUTSEE ME?", the two liturgy lines, and — when `SHARE_HANDLE` is set — a fourth line with the handle in `mono` gold, at `y + 62`. Both cards call it with their current y-offsets (938 / 926) so nothing moves when the handle is unset.

- [ ] **Step 1: Failing test** — append to `apps/mobile/test/sharePattern.test.ts`:

```ts
import { plaqueMessage } from "../src/game/sharePattern";
describe("plaqueMessage (design 2026-09-09 §3.2)", () => {
  it("carries the epithet, the challenge and the link", () => {
    expect(plaqueMessage("THE STEADY HAND", "https://x.test/play")).toBe("🔮 OUTSEEN — THE STEADY HAND · can you outsee me? https://x.test/play");
  });
  it("omits the link when none is configured", () => {
    expect(plaqueMessage("THE STEADY HAND", null)).toBe("🔮 OUTSEEN — THE STEADY HAND · can you outsee me?");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd apps/mobile && pnpm vitest run test/sharePattern.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`sharePattern.ts`:
```ts
export function plaqueMessage(epithetTitle: string, url: string | null = SHARE_URL): string {
  const body = `🔮 OUTSEEN — ${epithetTitle} · can you outsee me?`;
  return url ? `${body} ${url}` : body;
}
```

`links.ts` (same shape as `SHARE_URL`):
```ts
// The handle printed on the share cards themselves (design 2026-09-09
// §3.2) — a screenshot loses the share text, the pixels do not. A short
// display string, never a full URL: set EXPO_PUBLIC_SHARE_HANDLE once a
// registered domain exists. Absent → the card prints nothing extra.
const rawHandle = process.env.EXPO_PUBLIC_SHARE_HANDLE?.trim();
export const SHARE_HANDLE: string | null = rawHandle && rawHandle.length > 0 ? rawHandle.toUpperCase() : null;
```

`ShareCard.tsx` — `shareSnapshot`:
```ts
import { Platform, Share } from "react-native";
// ...
export async function shareSnapshot(ref: RefObject<any>, filename: string, message: string): Promise<void> {
  const image = ref.current?.makeImageSnapshot();
  // (existing encode + expo-file-system write, unchanged)
  capture("share_sheet_opened", { filename });
  if (Platform.OS === "ios") {
    // expo-sharing puts only the file in activityItems and maps its
    // dialogTitle to UIActivityViewController.title, which Messages and
    // the social targets ignore — so the challenge line and the link never
    // travelled (design 2026-09-09 §3.2). React Native's Share sends both.
    await Share.share({ url: file.uri, message }, { dialogTitle: message });
    return;
  }
  await Sharing.shareAsync(file.uri, { mimeType: "image/png", dialogTitle: message });
}
```
Keep `shareCard(ref, data)` calling `shareSnapshot(ref, \`oracle-${data.date}.png\`, shareMessage(data))`.

`ShareCard.tsx` — export `ShareFooter` and replace the three footer `SkText`s in both cards:
```tsx
export function ShareFooter({ mono, monoSmall, y, width }: { mono: SkFont | null; monoSmall: SkFont | null; y: number; width: number }) {
  const centeredIn = (font: SkFont, text: string) => (width - font.measureText(text).width) / 2; // reuse the file's existing `centered` if it is width-aware
  return (
    <>
      {mono && <SkText font={mono} text="CAN YOU OUTSEE ME?" x={centeredIn(mono, "CAN YOU OUTSEE ME?")} y={y} color={colors.agedGold} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[0]} x={centeredIn(monoSmall, LITURGY_LINES[0])} y={y + 30} color={NIGHT_DIM} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[1]} x={centeredIn(monoSmall, LITURGY_LINES[1])} y={y + 48} color={NIGHT_DIM} />}
      {mono && SHARE_HANDLE && <SkText font={mono} text={SHARE_HANDLE} x={centeredIn(mono, SHARE_HANDLE)} y={y + 78} color={colors.agedGold} />}
    </>
  );
}
```
Check `CARD_H`/`PLAQUE_H` leave room for `y + 78` (ShareCard: 938+78 = 1016 < 1024 − INSET? INSET is 30 → 994; move the whole footer up by 24px on ShareCard when the handle is set, or reduce the handle offset to `y + 66`; choose the value that keeps every line inside `CARD_H − INSET` and record it). The existing `centered(font, text)` helper is card-width-specific — pass `width` so the plaque (narrower) centers correctly.

`ledger.tsx`: `await shareSnapshot(canvasRef, "oracle-plaque.png", plaqueMessage(d.epithet.title));`

`apps/site/public/play.html` (static; the site Worker serves `/play` because Cloudflare canonicalizes `.html`):
```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OUTSEEN</title><link rel="stylesheet" href="/style.css">
<meta name="robots" content="noindex">
</head><body>
<main>
  <h1>OUTSEEN</h1>
  <p>Five questions about tomorrow. Choose your answer and how sure you are. Return to see whether you beat the Oracle.</p>
  <p id="open"><a href="oracle://round">Open in the app</a></p>
  <p id="store" hidden><a id="storeLink" href="/">Get OUTSEEN on the App Store</a></p>
</main>
<script>
  // Smart link: try the app's scheme; if we are still here after a beat,
  // offer the store. APP_STORE_URL is empty until the listing is live.
  var APP_STORE_URL = "";
  var t = setTimeout(function () {
    if (APP_STORE_URL) { document.getElementById("storeLink").href = APP_STORE_URL; }
    document.getElementById("store").hidden = false;
  }, 1200);
  window.addEventListener("pagehide", function () { clearTimeout(t); });
  location.href = "oracle://round";
</script>
</body></html>
```

- [ ] **Step 4: Verify** — `cd apps/mobile && pnpm vitest run && pnpm typecheck`; `cd apps/site && npx wrangler dev` is not required — validate the HTML by reading it. Optionally, on device via the `run-oracle-mobile` skill: open a reveal, tap share, confirm Messages shows the text and the image (do not send).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src apps/mobile/test/sharePattern.test.ts apps/site/public/play.html
git commit -m "feat(share): the share carries its text and link; cards can print a handle; site gains /play

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

Operator follow-ups recorded in Task 6's docs: set `EXPO_PUBLIC_SHARE_URL=https://outseen-site.etaheri.workers.dev/play` on EAS (works today), set `EXPO_PUBLIC_SHARE_HANDLE` and swap the URL when a domain exists, fill `APP_STORE_URL` once listed, and deploy `apps/site`.

---

### Task 2: Server — crowd snapshot at seal (schema, seal handler, exposure)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (`predictions`), generate `drizzle/0013_*.sql`
- Modify: `apps/api/src/routes/predictions.ts`
- Modify: `apps/api/src/routes/round.ts` (`/today/mine`, reveal `my`)
- Modify: `packages/core/src/schemas.ts` (`MineTodaySchema`, `RevealSchema.my`)
- Test: `apps/api/test/predictions.test.ts`, `apps/api/test/mine.test.ts`, `apps/api/test/round.test.ts`

**Interfaces:**
- Produces columns `crowdYesPctAtSeal: numeric | null`, `crowdCountAtSeal: integer | null` on `predictions`.
- After a successful insert, the seal handler counts every prediction on the question (including the new row) and writes both fields on the new row. A duplicate seal (conflict) leaves the existing row untouched.
- `/v1/round/today/mine` predictions gain `crowd_yes_pct_at_seal: number | null`, `crowd_count_at_seal: number | null`. Reveal `my` gains the same two fields. Zod: `.nullable().default(null)`.

- [ ] **Step 1: Failing tests**

In `apps/api/test/predictions.test.ts` (reuse its seal helper / `player`):
```ts
  it("snapshots the crowd at the instant of the seal, including the sealer (design 2026-09-09 §4.1)", async () => {
    // seed an open round now; player A seals YES on q1; player B seals NO on q1; player C seals YES on q1
    // assert A's row: crowd_yes_pct_at_seal 100, crowd_count_at_seal 1
    //        B's row: 50, 2
    //        C's row: 67, 3
    // (round(100*yes/count) with the sealer included)
  });
  it("does not rewrite the snapshot on a duplicate seal", async () => { /* seal twice as A after B sealed; A's snapshot still 100 / 1 */ });
```
Write these out fully using the file's existing helpers (read the file first; it already has a seal helper that POSTs `/v1/predictions` with a device token).

In `apps/api/test/mine.test.ts`: assert the two fields appear on `/today/mine` for a sealed question. In `apps/api/test/round.test.ts`: on a settled round's reveal, `my.crowd_yes_pct_at_seal` and `my.crowd_count_at_seal` are present (null for rows predating the column — seed one row directly without the fields and assert null).

- [ ] **Step 2: Run to verify it fails** — `cd apps/api && pnpm vitest run test/predictions.test.ts test/mine.test.ts test/round.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Schema (after `resolvePushedAt`):
```ts
  // The crowd at the instant this player sealed, sealer included (design
  // 2026-09-09 §4.1). Written once by the seal handler, never before the
  // seal is accepted, never rewritten. Null on rows that predate the column.
  crowdYesPctAtSeal: numeric("crowd_yes_pct_at_seal"),
  crowdCountAtSeal: integer("crowd_count_at_seal"),
```
`pnpm db:generate` → expected two `ALTER TABLE "predictions" ADD COLUMN …` statements.

`predictions.ts`, after `if (inserted.length > 0)` succeeds and before returning:
```ts
    if (inserted.length > 0) {
      const all = await db.query.predictions.findMany({ where: eq(schema.predictions.questionId, q.id), columns: { answer: true } });
      const count = all.length;
      const yes = all.filter((p) => p.answer).length;
      await db.update(schema.predictions)
        .set({ crowdYesPctAtSeal: String(Math.round((100 * yes) / count)), crowdCountAtSeal: count })
        .where(eq(schema.predictions.id, inserted[0]!.id));
      return c.json({ id: inserted[0]!.id, first_hour: inserted[0]!.firstHour });
    }
```
(`count ≥ 1` always, since the new row exists.)

`round.ts` `/today/mine` mapper: add `crowd_yes_pct_at_seal: p.crowdYesPctAtSeal === null ? null : Number(p.crowdYesPctAtSeal), crowd_count_at_seal: p.crowdCountAtSeal`. Reveal `my`: same two fields.

`schemas.ts`: add to `MineTodaySchema.predictions[]` and `RevealSchema.questions[].my`: `crowd_yes_pct_at_seal: z.number().int().min(0).max(100).nullable().default(null), crowd_count_at_seal: z.number().int().min(0).nullable().default(null)`.

- [ ] **Step 4: Verify** — `pnpm vitest run test/predictions.test.ts test/mine.test.ts test/round.test.ts test/schema.test.ts && pnpm typecheck`; core: `cd packages/core && pnpm vitest run test/round-schemas.test.ts` (fix the structural-equality fixture in `round-schemas.test.ts` to carry the defaulted fields — same trap as Phase A).

- [ ] **Step 5: Commit**

```bash
git add apps/api packages/core
git commit -m "feat(api): snapshot the crowd at the seal and expose it to the sealer

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 3: Mobile — `crowdMovement` and where it shows

**Files:**
- Create: `apps/mobile/src/game/crowdMovement.ts`
- Test: `apps/mobile/test/crowdMovement.test.ts`
- Modify: `apps/mobile/src/game/roundStore.ts` (`Entry` gains `atSeal?: { pct: number; count: number }`, `setAtSeal(id, snap)` action), `apps/mobile/src/game/useHydratePlayedState.ts` (hydrate `atSeal` from `/today/mine`), `apps/mobile/src/ui/CrowdReveal.tsx` (movement line per question), `apps/mobile/src/game/revealRows.ts` (`movementLine(q)`), `apps/mobile/src/app/reveal/[date].tsx` (render it under `callLine`)

**Interfaces:**
```ts
export const MOVEMENT_MIN_DELTA = 5;
/** null when either snapshot is under VERDICT_MIN_PLAYERS or the move is under MOVEMENT_MIN_DELTA. */
export function crowdMovement(
  atSeal: { pct: number; count: number } | null | undefined,
  now: { pct: number; count: number } | null | undefined,
  final: boolean,
): string | null
```
Lines: live → `WHEN YOU SEALED {a}% SAID YES · NOW {b}%`; final → `WHEN YOU SEALED {a}% SAID YES · IT ENDED AT {b}%`. Both ≤ 60 chars, caps, no "!". Never mentions bounty, tide, or points.

- [ ] **Step 1: Failing tests** — `apps/mobile/test/crowdMovement.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { crowdMovement, MOVEMENT_MIN_DELTA } from "../src/game/crowdMovement";
import { VERDICT_MIN_PLAYERS } from "../src/game/crowdVerdict";

describe("crowdMovement (design 2026-09-09 §4.1)", () => {
  it("prints the move once both snapshots clear the display floor and the tide moved", () => {
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, false)).toBe("WHEN YOU SEALED 40% SAID YES · NOW 55%");
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, true)).toBe("WHEN YOU SEALED 40% SAID YES · IT ENDED AT 55%");
  });
  it("says nothing under the display floor at either end", () => {
    expect(crowdMovement({ pct: 100, count: VERDICT_MIN_PLAYERS - 1 }, { pct: 55, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: VERDICT_MIN_PLAYERS - 1 }, false)).toBeNull();
  });
  it("says nothing for a move under the threshold", () => {
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 40 + MOVEMENT_MIN_DELTA - 1, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, { pct: 40 + MOVEMENT_MIN_DELTA, count: 40 }, false)).not.toBeNull();
  });
  it("says nothing without a snapshot", () => {
    expect(crowdMovement(null, { pct: 55, count: 40 }, false)).toBeNull();
    expect(crowdMovement({ pct: 40, count: 12 }, undefined, true)).toBeNull();
  });
  it("holds the register", () => {
    const l = crowdMovement({ pct: 40, count: 12 }, { pct: 55, count: 40 }, true)!;
    expect(l).toBe(l.toUpperCase()); expect(l).not.toContain("!"); expect(l.length).toBeLessThanOrEqual(60);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement** `crowdMovement.ts`:
```ts
import { VERDICT_MIN_PLAYERS } from "./crowdVerdict";

export const MOVEMENT_MIN_DELTA = 5;

// How the tide moved after you committed (design 2026-09-09 §4.1). Pure.
// Both floors are display floors: under VERDICT_MIN_PLAYERS at either end a
// percentage is mostly the reader, so the line stays silent. It never
// mentions the bounty — that is crowdVerdict's job and it has its own floor.
export function crowdMovement(
  atSeal: { pct: number; count: number } | null | undefined,
  now: { pct: number; count: number } | null | undefined,
  final: boolean,
): string | null {
  if (!atSeal || !now) return null;
  if (atSeal.count < VERDICT_MIN_PLAYERS || now.count < VERDICT_MIN_PLAYERS) return null;
  if (Math.abs(now.pct - atSeal.pct) < MOVEMENT_MIN_DELTA) return null;
  return `WHEN YOU SEALED ${atSeal.pct}% SAID YES · ${final ? "IT ENDED AT" : "NOW"} ${now.pct}%`;
}
```

Store: `Entry` gains `atSeal?: { pct: number; count: number }`; add action `setAtSeal(id: string, snap: { pct: number; count: number })`. `useHydratePlayedState`: when hydrating from `/today/mine`, call `setAtSeal` for rows with non-null `crowd_yes_pct_at_seal`. `CrowdReveal.tsx`: under each question's verdict line render `crowdMovement(answers[q.id]?.atSeal, c ? { pct: c.crowd_yes_pct, count: c.player_count } : null, false)` in `role.meta` muted ink when non-null. Note: right after the local seal the store has no `atSeal` until the next `/today/mine` hydration — invalidate `["round","mine"]` already happens on submit success; ensure `useHydratePlayedState` re-applies on refetch (read it; if it applies only once on mount, make it apply on every data change but never overwrite a `sealed` flag).

`revealRows.ts`: `export function movementLine(q: Question): string | null` → `crowdMovement(q.my?.crowd_yes_pct_at_seal != null && q.my.crowd_count_at_seal != null ? { pct: q.my.crowd_yes_pct_at_seal, count: q.my.crowd_count_at_seal } : null, q.crowd_yes_pct != null && q.crowd_count != null ? { pct: q.crowd_yes_pct, count: q.crowd_count } : null, q.outcome !== null)`. `[date].tsx`: render it under `callLine(q)` in the same `role.meta` style, only when non-null (no layout reservation needed: rows are variable height already).

Add a `movementLine` case to `apps/mobile/test/revealRows.test.ts` (present-and-final, and null under floor).

- [ ] **Step 4: Verify** — `cd apps/mobile && pnpm vitest run && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): show how the tide moved after you sealed

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 4: Habitual-hour reminders

**Files:**
- Create: `apps/mobile/src/game/habit.ts`
- Test: `apps/mobile/test/habit.test.ts`, `apps/mobile/test/reminders.test.ts`
- Modify: `apps/mobile/src/game/reminders.ts` (`planReminders` gains an optional `habit` parameter), `apps/mobile/src/api/flags.ts` (`recordSealHour`, `getSealHours`), `apps/mobile/src/notifications/schedule.ts` (`resealReminders` reads the habit), `apps/mobile/src/ui/OracleCard.tsx` (`finishSeal` records the hour)

**Interfaces:**
```ts
// habit.ts
export interface SealHour { date: string; hour: number }   // local calendar date, local hour 0–23
export const HABIT_MIN_DAYS = 3;
export const HABIT_KEEP = 14;
/** Median local hour over distinct days; null until HABIT_MIN_DAYS. */
export function habitualHour(history: ReadonlyArray<SealHour>): number | null
/** Append (date, hour) once per date (first seal wins), keep the newest HABIT_KEEP. */
export function withSealHour(history: ReadonlyArray<SealHour>, entry: SealHour): SealHour[]

// reminders.ts
export interface Habit { hour: number; localHourOf: (ms: number) => number }
export function planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5, habit?: Habit | null): Reminder[]
```
Rule: for each closing reminder day `k`, the default instant is `lock_k − REMINDER_LEAD_MS`. With a habit, scan `t` from `lock_k − 24h` in one-hour steps up to `lock_k − 30min`; the first `t` with `habit.localHourOf(t) === habit.hour` (snapped to the top of that hour) replaces the default; if none, the default stands. The noon reminder is unchanged.

- [ ] **Step 1: Failing tests**

`apps/mobile/test/habit.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { habitualHour, withSealHour, HABIT_MIN_DAYS, HABIT_KEEP } from "../src/game/habit";

describe("habit (design 2026-09-09 §4.2)", () => {
  it("is null until enough distinct days", () => {
    const h = [{ date: "2026-09-01", hour: 8 }, { date: "2026-09-02", hour: 9 }];
    expect(habitualHour(h)).toBeNull();
    expect(habitualHour([...h, { date: "2026-09-03", hour: 21 }])).toBe(9);
  });
  it("takes the median (even count → lower middle)", () => {
    expect(habitualHour([{ date: "a", hour: 7 }, { date: "b", hour: 8 }, { date: "c", hour: 20 }, { date: "d", hour: 21 }])).toBe(8);
  });
  it("records once per date and keeps the newest HABIT_KEEP", () => {
    let h: ReturnType<typeof withSealHour> = [];
    h = withSealHour(h, { date: "2026-09-01", hour: 8 });
    h = withSealHour(h, { date: "2026-09-01", hour: 22 }); // same day: first seal wins
    expect(h).toEqual([{ date: "2026-09-01", hour: 8 }]);
    for (let i = 2; i <= HABIT_KEEP + 3; i++) h = withSealHour(h, { date: `2026-09-${String(i).padStart(2, "0")}`, hour: 9 });
    expect(h).toHaveLength(HABIT_KEEP);
    expect(h[0]!.date).toBe("2026-09-04");
  });
});
```

Append to `apps/mobile/test/reminders.test.ts` (read the file's existing fixtures: `LOCKS`, dates, how it asserts `at`):
```ts
describe("planReminders with a habitual hour (design 2026-09-09 §4.2)", () => {
  // Pretend the device is in UTC so localHourOf is the UTC hour.
  const utcHour = (ms: number) => new Date(ms).getUTCHours();
  const lock = "2026-09-11T16:00:00Z"; // noon ET
  it("moves each closing reminder to the habitual hour inside that round's window", () => {
    const out = planReminders(lock, "2026-09-10", 0, 5, { hour: 20, localHourOf: utcHour });
    const closing = out.filter((r) => r.kind === "closing");
    expect(closing[0]!.at.toISOString()).toBe("2026-09-10T20:00:00.000Z"); // day 0's window is 09-10 16:00Z → 09-11 15:30Z
    expect(closing[1]!.at.toISOString()).toBe("2026-09-11T20:00:00.000Z");
  });
  it("falls back to the default lead when the habitual hour lands inside the last 30 minutes", () => {
    const out = planReminders(lock, "2026-09-10", 0, 5, { hour: 15, localHourOf: (ms) => new Date(ms).getUTCHours() });
    // 15:00Z is inside the window (16:00 previous day → 15:30) as 09-11T15:00Z, so it IS used; use hour 16 to hit the edge:
    const edge = planReminders(lock, "2026-09-10", 0, 5, { hour: 16, localHourOf: utcHour });
    expect(edge.filter((r) => r.kind === "closing")[0]!.at.toISOString()).toBe("2026-09-10T16:00:00.000Z"); // first instant of the window at hour 16
    expect(out.filter((r) => r.kind === "closing")[0]!.at.toISOString()).toBe("2026-09-11T15:00:00.000Z");
  });
  it("is byte-identical to the default plan when habit is null", () => {
    expect(planReminders(lock, "2026-09-10", 2, 5, null)).toEqual(planReminders(lock, "2026-09-10", 2));
  });
  it("never moves the noon reminder", () => {
    const withHabit = planReminders(lock, "2026-09-10", 1, 5, { hour: 20, localHourOf: utcHour }).find((r) => r.kind === "noon")!;
    const without = planReminders(lock, "2026-09-10", 1).find((r) => r.kind === "noon")!;
    expect(withHabit.at.toISOString()).toBe(without.at.toISOString());
  });
});
```
(Adjust the second test's expectations after implementing if the window arithmetic differs; the invariant is: the chosen instant lies in `[lock_k − 24h, lock_k − 30min]` and has the habitual local hour.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**

`habit.ts`:
```ts
export interface SealHour { date: string; hour: number }
export const HABIT_MIN_DAYS = 3;
export const HABIT_KEEP = 14;

// When this device shows up (design 2026-09-09 §4.2): the median local hour
// of the first seal on each of the last HABIT_KEEP days. Pure; the store is
// flags.ts, the scheduler is notifications/schedule.ts.
export function habitualHour(history: ReadonlyArray<SealHour>): number | null {
  const byDate = new Map<string, number>();
  for (const e of history) if (!byDate.has(e.date)) byDate.set(e.date, e.hour);
  if (byDate.size < HABIT_MIN_DAYS) return null;
  const hours = [...byDate.values()].sort((a, b) => a - b);
  return hours[Math.floor((hours.length - 1) / 2)]!;
}

export function withSealHour(history: ReadonlyArray<SealHour>, entry: SealHour): SealHour[] {
  if (history.some((e) => e.date === entry.date)) return [...history];
  return [...history, entry].slice(-HABIT_KEEP);
}
```

`flags.ts` (same shape as the milestones helpers):
```ts
const SEAL_HOURS_KEY = "oracle.seal_hours";
export async function getSealHours(): Promise<SealHour[]> {
  try {
    const value: unknown = JSON.parse((await (await store()).getItemAsync(SEAL_HOURS_KEY)) ?? "[]");
    return Array.isArray(value) ? value.filter((x): x is SealHour => !!x && typeof x === "object" && typeof (x as SealHour).date === "string" && typeof (x as SealHour).hour === "number") : [];
  } catch { return []; }
}
export async function recordSealHour(now: Date): Promise<void> {
  try {
    const local = { date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`, hour: now.getHours() };
    await (await store()).setItemAsync(SEAL_HOURS_KEY, JSON.stringify(withSealHour(await getSealHours(), local)));
  } catch {}
}
```

`reminders.ts`:
```ts
export interface Habit { hour: number; localHourOf: (ms: number) => number }
const HABIT_TAIL_MS = 30 * 60_000;

function habitualInstant(lockMs: number, habit: Habit): Date | null {
  const start = lockMs - 86_400_000;
  const end = lockMs - HABIT_TAIL_MS;
  for (let t = start; t <= end; t += 3_600_000) {
    if (habit.localHourOf(t) === habit.hour) {
      const d = new Date(t); d.setMinutes(0, 0, 0);
      return d.getTime() >= start && d.getTime() <= end ? d : new Date(t);
    }
  }
  return null;
}

export function planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5, habit?: Habit | null): Reminder[] {
  // ... existing body; where the closing `at` is computed:
  const lockK = lock0 + k * 86_400_000;
  const at = (habit && habitualInstant(lockK, habit)) ?? new Date(lockK - REMINDER_LEAD_MS);
  out.push({ kind: "closing", date, at, body: line.text });
```
(The default `new Date(lock0 + k*86_400_000 − REMINDER_LEAD_MS)` is preserved exactly when `habit` is null/undefined, so the existing tests keep passing.)

`schedule.ts`: in `resealReminders`, `const habit = habitualHour(await getSealHours()); const h = habit === null ? null : { hour: habit, localHourOf: (ms: number) => new Date(ms).getHours() };` and pass `h` as the fifth argument.

`OracleCard.tsx` `finishSeal`: add `void recordSealHour(new Date());` (fire-and-forget; `withSealHour` makes repeat seals on one day a no-op).

- [ ] **Step 4: Verify** — `cd apps/mobile && pnpm vitest run && pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): the closing reminder learns when this device plays

Claude-Session: https://claude.ai/code/session_01SkQjDm3cKGfE1pcvbB95Gc"
```

---

### Task 5: Full suite, docs, operator notes

- [ ] **Step 1:** `pnpm -r typecheck && pnpm -r test` → all green.
- [ ] **Step 2:** `docs/launch-playbook.md`: add an "Share links" subsection: `EXPO_PUBLIC_SHARE_URL` → `https://outseen-site.etaheri.workers.dev/play` now; `EXPO_PUBLIC_SHARE_HANDLE` + a real domain later; `APP_STORE_URL` in `apps/site/public/play.html` once listed; deploy `apps/site` with `npx wrangler deploy` from `apps/site`. Note the crowd-at-seal columns (migration 0013) and that reminders now follow the device's habitual hour after three days.
- [ ] **Step 3: Commit** `docs: share links, crowd snapshot, habitual reminders`.
- [ ] **Step 4: Deploy checklist (operator):** migrate 0013 on both DBs, `npx wrangler deploy` in `apps/api` and in `apps/site`, set the two EAS env vars, push main, next EAS build.

---

## Self-review

**Spec coverage:** §3.2 share link on the card → Task 1 (`ShareFooter` handle; `SHARE_URL` made real via `/play`; the iOS text-drop bug fixed). §4.1 crowd movement → Tasks 2–3 (server snapshot at seal so the wall holds; pure helper; two surfaces). §4.2 habitual-hour reminders → Task 4 (record, median, planner, fallback).

**Deliberate limits:** no universal links (needs a domain and an Apple entitlement; recorded as operator follow-up). Card handle prints only when configured. Android keeps expo-sharing.

**Placeholder scan:** Task 2 Step 1 sketches the predictions tests in comments and instructs the implementer to write them with the file's existing seal helper — that is a pointer to concrete existing code; the assertions are fully specified (100/1, 50/2, 67/3). Task 4's second reminders test asks the implementer to confirm the window arithmetic; the invariant is stated.

**Type consistency:** `SealHour` shared by `habit.ts` and `flags.ts`; `Habit` consumed by `schedule.ts`; `crowdMovement`'s snapshot shape `{pct,count}` used by store `Entry.atSeal`, `CrowdReveal`, and `revealRows.movementLine`; the two snake_case fields match across schema (`MineTodaySchema`, `RevealSchema.my`), routes, and mobile readers.
