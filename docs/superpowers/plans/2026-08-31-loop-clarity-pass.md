# Loop Clarity Pass — Implementation Plan (3 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Requires Plans 1 and 2 merged first** — every payload field used here is served by them.

**Goal:** A player always knows the stakes, the rules, and what happens next: the card shows its payoff, partial days say they don't rate, the home screen has no dead ends (a countdown between rounds, a locked round that says so, a streak that warns before it dies), the reveal shows sources/evidence/void reasons plus streak and Oracle-Score progress, and the second dopamine hit has a local trigger and a voiced permission ask.

**Architecture:** House convention — pure decisions in `apps/mobile/src/game/*` with node tests in `apps/mobile/test/`; screens/UI verified by typecheck + a simulator run. Copy comes from `@oracle/core` (`RITES_LINES`, `PARTIAL_LINE`, `SUMMONS_LINES`, bank lines) — nothing player-facing is invented in the app except the mystic reading lines already there. One new route (`/summons`). No new dependencies.

**Tech Stack:** Expo SDK 57 / RN 0.86, expo-router, Reanimated 4, zustand, TanStack Query 5, expo-notifications (local only), expo-secure-store, vitest.

**Spec:** `docs/superpowers/2026-08-31-gameplay-audit.md` §3 (all), §5 (retention findings 1–3, 6–9); `docs/superpowers/specs/2026-08-26-oracle-voice-design.md` §4 (permission ask, notification beats); `docs/superpowers/specs/2026-08-26-oracle-brand-brief.md` §7 (one gold frame per screen, Cinzel scarcity).

## Global Constraints

- **No new external services.** expo-notifications = local scheduled only.
- **One gold button per screen.** Secondary actions are `QuietLink`.
- **Machine voice** for every new line: ALL CAPS mono, no `!`, no emoji, no CTA verbs (`CHECK/TAP/CLICK/VISIT/RESULTS/DON'T MISS`). New player-facing lines that are not composed from core copy are listed in each task; keep to them.
- **Reduced motion / screen reader parity** for every new state (text is the accessible signal; no information only in color or motion).
- **Never leak an unsealed question's crowd.** Everything crowd-related derives from `/today/crowd` (sealed questions only) — unchanged.
- Expo docs: per `apps/mobile/AGENTS.md`, read https://docs.expo.dev/versions/v57.0.0/ before writing any Expo-API code (Task 5 touches expo-notifications; Task 5 adds a route).
- Test/typecheck: `pnpm --filter @oracle/mobile test`, `pnpm --filter @oracle/mobile typecheck`.
- **Simulator verification** at the end of each task: Metro from `apps/mobile` (`npx expo start --ios`), wrangler dev from `apps/api` (`nohup npx wrangler dev &`, wait for a 401 on `/v1/round/today`). Cold-start to pick up changes: `xcrun simctl terminate booted host.exp.Exponent` then reopen the `exp://` URL. Screenshots to `docs/superpowers/plans/assets/loop-clarity/`. Never steal the mouse while Erik is active.
- Commit after every task; stage files by name.

## File Structure

| File | Change | Task |
|---|---|---|
| `apps/mobile/src/api/hooks.ts` | `useNextRound` | 1 |
| `apps/mobile/src/ui/SleepsPanel.tsx` (new) | "THE ORACLE SLEEPS" + countdown to next open | 1 |
| `apps/mobile/src/game/payoffLine.ts` + `test/payoffLine.test.ts` (new) | `payoffLine(conf, big)` | 1 |
| `apps/mobile/src/game/questionState.ts` + `test/questionState.test.ts` (new) | `isClosed(q, now)`, `nextOpenQuestion(qs, answers, now)` | 1 |
| `apps/mobile/src/ui/OracleCard.tsx` | Big One eyebrow, early-lock eyebrow, buttons-mode hint, 409 → invalidate | 1 |
| `apps/mobile/src/app/round.tsx` | payoff line, closed-question skipping, struck numerals, SleepsPanel | 1 |
| `apps/mobile/src/game/homeLines.ts` + `test/homeLines.test.ts` (new) | `partialLine`, `riskLine`, `lapseNotice`, `spokenLine` | 2 |
| `apps/mobile/src/app/index.tsx` | all home states | 2 |
| `apps/mobile/src/game/revealRows.ts` + `test/revealRows.test.ts` (new) | `rowMark`, `rowRight`, `ledgerLines`, `pendingLine` | 3 |
| `apps/mobile/src/app/reveal/[date].tsx` | receipts, ledger lines, spectator rows, pending marks, seen-after-ceremony | 3 |
| `apps/mobile/src/ui/CrowdReveal.tsx` | RETURN AT NOON, noun | 4 |
| `apps/mobile/src/game/reminders.ts` + `test/reminders.test.ts` | `sealedCount`, noon reminder, partial copy | 5 |
| `apps/mobile/src/notifications/schedule.ts`, `src/notifications/summons.ts` (new), `src/app/summons.tsx` (new), `src/app/round.tsx`, `src/app/index.tsx` | interstitial + wiring | 5 |
| `apps/mobile/src/app/ledger.tsx`, `src/game/scoreProgress.ts` + `test/scoreProgress.test.ts` (new) | 50-call progress, 28-day eyebrow, verdict receipts | 6 |

---

### Task 1: The card tells the truth about stakes; no locked-card dead end

**Why:** Nothing shows that a wrong 95% costs 13× a wrong 55% (audit §3.4 #11); the Big One's downside is invisible at the pull (#10); reduced-motion players get no conviction teaching (#13); a 409 leaves a pullable card that 409s forever (#4); and with per-question early locks (Plan 2 Task 3) a closed question would trap `current`. Between rounds the round screen is a serif dead end (§3.5).

**Files:**
- Create: `apps/mobile/src/game/payoffLine.ts`, `apps/mobile/test/payoffLine.test.ts`, `apps/mobile/src/game/questionState.ts`, `apps/mobile/test/questionState.test.ts`, `apps/mobile/src/ui/SleepsPanel.tsx`
- Modify: `apps/mobile/src/api/hooks.ts`, `apps/mobile/src/ui/OracleCard.tsx`, `apps/mobile/src/app/round.tsx`

**Interfaces:**
- Consumes: `payoff(confidence, isBigOne)` (Plan 1), `RoundToday.questions[].locks_at`, `RoundNextSchema` + `GET /v1/round/next` (Plan 2 Task 1).
- Produces: `payoffLine(conf: number, isBigOne: boolean): string` → `"+38 IF RIGHT · −62 IF WRONG"` (minus sign U+2212).
- Produces: `isClosed(q: { locks_at: string }, now: number): boolean`; `nextOpenQuestion<Q extends { id: string; slot: number; locks_at: string }>(qs: Q[], sealed: (id: string) => boolean, now: number): Q | undefined` (slot order, skips sealed and closed).
- Produces: `useNextRound(enabled: boolean)` → `RoundNext | null` (404 → null), `staleTime: 60_000`.
- Produces: `<SleepsPanel />` — `"THE ORACLE SLEEPS"` line + `<Countdown until={next?.opens_at ?? null} prefix="THE ORACLE SPEAKS IN" fallback={next ? "THE ORACLE STIRS" : undefined} />`; used by `round.tsx` here and `index.tsx` in Task 2.
- Card: Big One title `"✶ The Big One · pays double · costs double"`; when `isClosed(q)` is false but `q.locks_at !== roundLocksAt` the title gets ` · closes early`; buttons-mode hint line `"HOLD TO RAISE CONVICTION · RELEASE TO SEAL"` in the hint slot; on a 409 the card calls `queryClient.invalidateQueries({ queryKey: ["round", "today"] })` after showing the error.
- Round screen footer while pulling: line 1 the mystic reading (or the floor rite), line 2 `payoffLine(lean.conf, current.is_big_one)` at size 9 mutedInk. Numerals row: closed-and-unsealed slots render `textDecorationLine: "line-through"` in `colors.mutedInk`.

- [ ] **Step 1: Failing tests**

`test/payoffLine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { payoffLine } from "../src/game/payoffLine";

describe("payoffLine", () => {
  it("prints the honest ladder with a true minus sign", () => {
    expect(payoffLine(55, false)).toBe("+10 IF RIGHT · −10 IF WRONG");
    expect(payoffLine(75, false)).toBe("+38 IF RIGHT · −62 IF WRONG");
    expect(payoffLine(95, true)).toBe("+99 IF RIGHT · −261 IF WRONG");
  });
});
```

`test/questionState.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isClosed, nextOpenQuestion } from "../src/game/questionState";

const q = (slot: number, locks_at: string) => ({ id: `q${slot}`, slot, locks_at });
const NOW = Date.parse("2026-08-28T01:00:00Z");

describe("questionState", () => {
  it("a question is closed once its lock has passed", () => {
    expect(isClosed(q(1, "2026-08-28T00:00:00Z"), NOW)).toBe(true);
    expect(isClosed(q(1, "2026-08-28T16:00:00Z"), NOW)).toBe(false);
  });
  it("the next card is the first unsealed, still-open slot", () => {
    const qs = [q(3, "2026-08-28T16:00:00Z"), q(1, "2026-08-28T16:00:00Z"), q(2, "2026-08-28T00:00:00Z")];
    expect(nextOpenQuestion(qs, (id) => id === "q1", NOW)?.slot).toBe(3); // q2 closed, q1 sealed
    expect(nextOpenQuestion(qs, () => true, NOW)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @oracle/mobile test -- payoffLine questionState`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the pure modules**

`src/game/payoffLine.ts`:

```ts
import { payoff } from "@oracle/core";

// The card's honest stake, printed under the reading: what this conviction
// earns if right and costs if wrong. A true minus sign — this is a receipt.
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

export function payoffLine(confidence: number, isBigOne: boolean): string {
  const p = payoff(confidence, isBigOne);
  return `${signed(p.win)} IF RIGHT · ${signed(p.loss)} IF WRONG`;
}
```

`src/game/questionState.ts`:

```ts
// Per-question lock state (leaky questions lock early, design spec §6). A
// closed, unsealed slot is skipped — the player was late to it — and shown
// struck in the numerals row; it is never dealt.
export function isClosed(q: { locks_at: string }, now: number): boolean {
  return Date.parse(q.locks_at) <= now;
}

export function nextOpenQuestion<Q extends { id: string; slot: number; locks_at: string }>(
  qs: ReadonlyArray<Q>,
  sealed: (id: string) => boolean,
  now: number,
): Q | undefined {
  return [...qs].sort((a, b) => a.slot - b.slot).find((q) => !sealed(q.id) && !isClosed(q, now));
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/mobile test`
Expected: PASS.

- [ ] **Step 5: Hook + panel**

`src/api/hooks.ts`:

```ts
import { RoundNextSchema } from "@oracle/core"; // add to the existing import
export function useNextRound(enabled: boolean) {
  return useQuery({
    queryKey: ["round", "next"],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const token = await getDeviceToken();
      try { return await api("/v1/round/next", RoundNextSchema, { token }); }
      catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
    },
  });
}
```

`src/ui/SleepsPanel.tsx`:

```tsx
import { View } from "react-native";
import { DecodeLine } from "./DecodeText";
import { Countdown } from "./Countdown";
import { useNextRound } from "../api/hooks";
import { colors, space } from "../theme";

// Between rounds the machine is not dead, it is waiting: one line, one
// countdown to the next noon. "THE ORACLE STIRS" covers the ≤10 minutes
// between a scheduled noon and the cron tick that opens it.
export function SleepsPanel({ active = true }: { active?: boolean }) {
  const next = useNextRound(true);
  return (
    <View style={{ gap: space(2), alignItems: "center" }}>
      <DecodeLine active={active} text="THE ORACLE SLEEPS" cursor size={11} color={colors.mutedInk} style={{ textAlign: "center" }} letterSpacing={2} />
      <Countdown until={next.data?.opens_at ?? null} prefix="THE ORACLE SPEAKS IN" fallback={next.data ? "THE ORACLE STIRS" : undefined} />
    </View>
  );
}
```

- [ ] **Step 6: Card + round screen**

`OracleCard.tsx`:
- add `import { useQueryClient } from "@tanstack/react-query";` and `const qc = useQueryClient();`
- add prop `roundLocksAt: string | null` and compute `const closesEarly = roundLocksAt !== null && q.locks_at !== roundLocksAt;`
- title: `const title = q.is_big_one ? "✶ The Big One · pays double · costs double" : closesEarly ? \`${q.category} · closes early\` : q.category;` (Big One + early → `"✶ The Big One · pays double · costs double · closes early"`).
- in the catch: after `setError(...)`, `if (e instanceof ApiError && e.status === 409) void qc.invalidateQueries({ queryKey: ["round", "today"] });`
- hint slot: change the condition to render, when `buttonsMode && liveConf === null && !sealed && !thrown`, `<Mono size={10} color={colors.mutedInk} letterSpacing={2} style={{ textAlign: "center" }}>HOLD TO RAISE CONVICTION · RELEASE TO SEAL</Mono>`; the existing pull hint stays for non-buttons mode.

`round.tsx`:
- imports: `payoffLine`, `isClosed`, `nextOpenQuestion`, `SleepsPanel`.
- `const [now, setNow] = useState(() => Date.now()); useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);`
- `const current = nextOpenQuestion(qs, (id) => !!answers[id]?.sealed, now);` (replaces the `qs.find`).
- CrowdReveal branch: render it when `!current` (unchanged) — it lists only sealed questions.
- no-round branch: `return <Screen><TopBar /><View style={{ flex: 1, justifyContent: "center" }}><SleepsPanel /></View></Screen>;`
- numerals row: `const struck = !answers[q.id]?.sealed && isClosed(q, now);` → color `struck ? colors.mutedInk : sealed ? goldText : dim`, `style={struck ? { textDecorationLine: "line-through" } : undefined}`.
- footer slot: when `lean.conf !== null` render a `<View style={{ alignItems: "center", gap: 2 }}>` with the existing reading line and below it `<Mono size={9} color={colors.mutedInk} letterSpacing={1}>{payoffLine(lean.conf, current?.is_big_one ?? false)}</Mono>`. Keep the slot `height: 40`.
- pass `roundLocksAt={today.data.locks_at}` to `<OracleCard>`.
- Accessibility: the payoff line is plain text — VoiceOver reads it; nothing else needed.

- [ ] **Step 7: Typecheck + simulator**

Run: `pnpm --filter @oracle/mobile typecheck`. Then in the simulator: pull a card to 75% and capture the two-line footer (`card-payoff.png`); switch Reduce Motion on and capture the hold hint (`card-hold-hint.png`); with wrangler dev, stop wrangler, seal → error line "THE CONNECTION WAVERS" (not 409; fine) — for the 409 path, set the dev round's `locks_at` to the past via psql, cold-start, confirm the round screen shows `SleepsPanel` (`round-sleeps.png`). Restore the dev round.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/game/payoffLine.ts apps/mobile/test/payoffLine.test.ts apps/mobile/src/game/questionState.ts apps/mobile/test/questionState.test.ts apps/mobile/src/ui/SleepsPanel.tsx apps/mobile/src/api/hooks.ts apps/mobile/src/ui/OracleCard.tsx apps/mobile/src/app/round.tsx docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): the card states its stakes — payoff line, big one costs double, hold hint, early locks, no 409 dead end"
```

---

### Task 2: Home has no dead ends and tells the truth about today

**Why:** Partial days are silently un-rated (audit §3.1); "N ORACLES ALREADY WAITING" counts people who already sealed (#9); two gold CTAs at noon (#7); the streak is invisible on the day it matters (§5.2); lapsed players get silence though the copy exists (#6); "THE ORACLE SLEEPS" with nothing to count down to (#5); the sealed countdown lands on "RETURN AT NOON" at noon (§3.5).

**Files:**
- Create: `apps/mobile/src/game/homeLines.ts`, `apps/mobile/test/homeLines.test.ts`
- Modify: `apps/mobile/src/app/index.tsx`

**Interfaces:**
- Consumes: `PARTIAL_LINE`, `COPY_BANK`, `selectLine`, `fillSlots` from `@oracle/core`; `numeral` from `../ui/CardChrome`; `msUntil` from `./countdown`; `SleepsPanel` (Task 1); `MeLedger.days_consulted/streak`; `Reveal` for yesterday.
- Produces (all pure):
  - `partialLine(sealedCount: number, total: number): string | null` → `"III OF V SEALED · THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED."` for `0 < sealed < total`, else null. (Roman numerals via `numeral`; V for total 5, else the numeral of `total`.)
  - `spokenLine(playerCount: number): string` → `"{n} ORACLES HAVE ALREADY SPOKEN"` for n > 0, else `"THE ORACLE SPEAKS"`.
  - `riskLine(streak: number, anySealed: boolean, msUntilLock: number | null, seedKey: string): string | null` → the `streak.risk-1` line filled, when `streak ≥ 1 && !anySealed && ms !== null && ms <= 3h`; else null.
  - `lapseNotice(daysConsulted: number, streak: number, playedYesterday: boolean | null, seedKey: string): string | null` → one of `streak.lapse-*` (seeded) when `daysConsulted > 0 && streak === 0 && playedYesterday === false`; else null.
  - `homeNotice(...)` priority helper: `shield ?? risk ?? lapse ?? vigil` — implement in `index.tsx` as a one-liner, not a module.

- [ ] **Step 1: Failing tests**

`test/homeLines.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { partialLine, spokenLine, riskLine, lapseNotice } from "../src/game/homeLines";

describe("homeLines", () => {
  it("partialLine names the count and the rule, only for a partial day", () => {
    expect(partialLine(3, 5)).toBe("III OF V SEALED · THE DAY RATES ONLY WHEN ALL FIVE ARE SEALED.");
    expect(partialLine(0, 5)).toBeNull();
    expect(partialLine(5, 5)).toBeNull();
  });
  it("spokenLine counts those who sealed, or announces the oracle", () => {
    expect(spokenLine(142)).toBe("142 ORACLES HAVE ALREADY SPOKEN");
    expect(spokenLine(0)).toBe("THE ORACLE SPEAKS");
  });
  it("riskLine warns inside three hours of lock, unsealed, with a vigil to lose", () => {
    expect(riskLine(4, false, 2 * 3_600_000, "k")).toBe("YOUR VIGIL OF 4 DAYS ENDS AT NOON.");
    expect(riskLine(4, true, 2 * 3_600_000, "k")).toBeNull();
    expect(riskLine(0, false, 2 * 3_600_000, "k")).toBeNull();
    expect(riskLine(4, false, 4 * 3_600_000, "k")).toBeNull();
    expect(riskLine(4, false, null, "k")).toBeNull();
  });
  it("lapseNotice speaks once the vigil is broken and yesterday went unplayed", () => {
    const l = lapseNotice(6, 0, false, "2026-08-28");
    expect(l).toBe(l?.toUpperCase());
    expect(lapseNotice(6, 0, false, "2026-08-28")).toBe(l); // deterministic
    expect(lapseNotice(0, 0, false, "k")).toBeNull();   // brand-new player: nothing lapsed
    expect(lapseNotice(6, 3, false, "k")).toBeNull();   // shield held / vigil alive
    expect(lapseNotice(6, 0, true, "k")).toBeNull();    // played yesterday
    expect(lapseNotice(6, 0, null, "k")).toBeNull();    // unknown
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- homeLines`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/game/homeLines.ts`:

```ts
import { COPY_BANK, PARTIAL_LINE, fillSlots, selectLine } from "@oracle/core";
import { numeral } from "../ui/CardChrome";

const RISK_MS = 3 * 3_600_000;
const RISK = COPY_BANK.filter((l) => l.id.startsWith("streak.risk"));
const LAPSE = COPY_BANK.filter((l) => l.id.startsWith("streak.lapse"));

export function partialLine(sealedCount: number, total: number): string | null {
  if (sealedCount <= 0 || sealedCount >= total) return null;
  return `${numeral(sealedCount)} OF ${numeral(total)} SEALED · ${PARTIAL_LINE}`;
}

export function spokenLine(playerCount: number): string {
  return playerCount > 0 ? `${playerCount} ORACLES HAVE ALREADY SPOKEN` : "THE ORACLE SPEAKS";
}

export function riskLine(streak: number, anySealed: boolean, msUntilLock: number | null, seedKey: string): string | null {
  if (streak < 1 || anySealed || msUntilLock === null || msUntilLock > RISK_MS) return null;
  const line = selectLine(RISK, seedKey, ["streak"]);
  return line ? fillSlots(line.text, { streak }) : null;
}

export function lapseNotice(daysConsulted: number, streak: number, playedYesterday: boolean | null, seedKey: string): string | null {
  if (daysConsulted <= 0 || streak !== 0 || playedYesterday !== false) return null;
  return selectLine(LAPSE, seedKey, [])?.text ?? null;
}
```

(`numeral` is a pure function in `CardChrome.tsx` — importing it from a `.tsx` under vitest works because the test doesn't render; if vitest chokes on the JSX file's RN imports, move `numeral` + `NUMERALS` into `src/game/numerals.ts` and re-export from `CardChrome.tsx`.)

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/mobile test`
Expected: PASS.

- [ ] **Step 5: Wire the home screen**

`index.tsx` changes:
- `const sealedCount = round ? round.questions.filter((q) => answers[q.id]?.sealed).length : 0;` `const partial = round ? partialLine(sealedCount, round.questions.length) : null;`
- `const playedYesterday = reveal.data && !("pending" in reveal.data) ? reveal.data.questions.some((q) => q.my !== null) : null;`
- `const [now, setNow] = useState(() => Date.now()); useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);`
- `const risk = riskLine(ledger.data?.streak ?? 0, anySealed, msUntil(round?.locks_at ?? null, now), \`risk:${round?.date ?? ""}\`);`
- `const lapse = lapseNotice(ledger.data?.days_consulted ?? 0, ledger.data?.streak ?? 0, playedYesterday, \`lapse:${yesterday}\`);`
- `const notice = shield ?? risk ?? lapse ?? vigil;` — render `notice` where `shield ?? vigil` was.
- Unsealed block: the status line becomes `partial ?? spokenLine(round.player_count)`; when `showLedgerCta` is true, replace the `GoldButton title="ENTER"` with `<QuietLink title="Enter today's round" onPress=… />` (results first — one gold frame). Otherwise the gold ENTER stays.
- Sealed block: `Countdown` fallback → `"THE LEDGER IS BEING READ. PATIENCE."` (the `system.reading-1` text; import `COPY_BANK` and look it up by id so the string lives in the bank).
- No round: replace the single `DecodeLine` with `<SleepsPanel active={booted} />`.
- `resealReminders(round.locks_at, round.date, sealedCount)` — signature changes in Task 5; until then keep `allSealed` and leave a `// TODO(task 5)` comment.

- [ ] **Step 6: Typecheck + simulator**

Run: `pnpm --filter @oracle/mobile typecheck`. Simulator: seal I–II, return home → `home-partial.png` shows "II OF V SEALED · …"; delete dev predictions for today via psql, set your dev user's streak to 4 and the dev round's `locks_at` to now+2h → `home-risk.png`; set `locks_at` to the past and no scheduled round → `home-sleeps.png` (countdown or STIRS). Restore.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/homeLines.ts apps/mobile/test/homeLines.test.ts apps/mobile/src/app/index.tsx docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): home tells the truth — partial days, who has spoken, the vigil at risk, the lapse, a countdown between rounds"
```

---

### Task 3: The reveal shows its receipts and the player's ledger

**Why:** Dopamine hit #2 is half-built: no streak, no Oracle-Score progress (audit §3.2); no source, no evidence, voids are a bare `∅` (§3.3); an unresolved question renders as a loss (`✗`, `—`); a lapsed player sees a page of dots (#6); "seen" fires before the ceremony plays (§3.5); the pending state says "RETURN AT NOON" at noon.

**Files:**
- Create: `apps/mobile/src/game/revealRows.ts`, `apps/mobile/test/revealRows.test.ts`
- Modify: `apps/mobile/src/app/reveal/[date].tsx`

**Interfaces:**
- Consumes: `Reveal` (Plan 1 Task 5 shape, served by Plan 2 Task 5), `COPY_BANK`/`selectLine` for `noon.lapsed-*`.
- Produces (pure):
  - `type RowState = "win" | "loss" | "void" | "pending" | "spectator"`; `rowState(q: Reveal["questions"][number]): RowState` — `outcome === null` → pending (regardless of `my`); `my === null` → spectator; void → void; points > 0 → win; else loss.
  - `rowMark(state: RowState): string` → win `✓`, loss `✗`, void `∅`, pending `…`, spectator `·`.
  - `rowRight(q): string` — win/loss: signed points; void/pending: `—`; spectator: outcome word `YES`/`NO`/`VOID`.
  - `receiptLine(q): string | null` — void: `VOID · ${void_reason.toUpperCase()}`; else `PER ${source_name.toUpperCase()}` + (` · "${evidence_quote}"` when present, quote trimmed to 90 chars with `…`); pending: `PER ${source} · NOT YET READ`.
  - `ledgerLines(l: Reveal["ledger"]): string[]` — settled: `[streak > 0 ? \`VIGIL: DAY ${streak}\` : "THE VIGIL BEGINS AGAIN", oracle_score === null ? \`${calls_rated} OF 50 CALLS WRITTEN\` : \`ORACLE SCORE ${oracle_score}\`]`; not settled: `["THE VIGIL IS COUNTED SHORTLY"]`.
  - `pendingLine(date: string, todayIso: string): string` — `date < todayIso` → `"THE LEDGER IS BEING READ. PATIENCE."`, else `"RETURN AT NOON."`.
  - `lapsedLine(seedKey: string): string` — a `noon.lapsed-*` line.

- [ ] **Step 1: Failing tests**

`test/revealRows.test.ts` — build a question fixture with all Plan-1 fields and assert every branch above (at least: pending beats everything; spectator right column `YES`; void receipt; quote trimming at 90; `ledgerLines` both branches incl. `0 OF 50`; `pendingLine` both branches; `lapsedLine` is uppercase and deterministic).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- revealRows`
Expected: FAIL.

- [ ] **Step 3: Implement `revealRows.ts`** per the interfaces (straightforward; trim helper `const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);`).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/mobile test`
Expected: PASS.

- [ ] **Step 5: Wire the screen**

`reveal/[date].tsx`:
- Rows (slots 1–4): `const st = rowState(q); const color = st === "win" ? goldText : st === "loss" ? vermilion : mutedInk;` mark `rowMark(st)`, right `rowRight(q)`; under the text line add `<Mono size={9} color={colors.mutedInk} numberOfLines={2}>{receiptLine(q)}</Mono>` (wrap text+receipt in a `flex: 1` column).
- Big One block: add `PER {source}` + quote line under the crowd line; add `THE ORACLE FORESAW {Math.round(oracle_p_yes*100)}% YES` when non-null (below THE MARKET SAID); when the Big One is void show `VOID · reason` instead of the you/crowd rows; when pending show `NOT YET READ`.
- Under DAY POINTS: map `ledgerLines(d.ledger)` to `<Mono size={10} color={colors.goldText} letterSpacing={3} style={{ textAlign: "center" }}>`.
- Eyebrow: any pending → `Day ${d.date} · the ledger is still being read`; no `my` anywhere → `Day ${d.date} · the ledger was read without you` plus a `DecodeLine` with `lapsedLine(d.date)` under the eyebrow (RollingPoints hidden for spectators — show nothing where points would be).
- Pending screen: replace `"RETURN AT NOON."` with `pendingLine(date ?? "", new Date().toISOString().slice(0, 10))`.
- `markRevealSeen`: move into the ceremony effect — `setTimeout(() => markRevealSeen(d.date), reducedMotion ? 0 : POINTS_DELAY + ROLL_MS)` (cleared on unmount like the haptic timers). Spectator reveals (no `my`) mark seen immediately (nothing to celebrate).
- Share button rule unchanged (`results.some(r => r !== "none")`), but `results` mapping uses `rowState`: pending → `"none"`.

- [ ] **Step 6: Typecheck + simulator**

Run: `pnpm --filter @oracle/mobile typecheck`. Simulator via deep link `exp://127.0.0.1:8081/--/reveal/<settled dev date>`: `reveal-receipts.png` (rows with PER lines, ledger lines under points); force one dev question to void with a reason via admin `force` → `reveal-void.png`; a date you didn't play → `reveal-spectator.png`.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/revealRows.ts apps/mobile/test/revealRows.test.ts "apps/mobile/src/app/reveal/[date].tsx" docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): the reveal shows receipts — sources, evidence, void reasons, the oracle's call, vigil and score progress, spectator rows"
```

---

### Task 4: The finale points home

**Why:** After the fifth seal the screen ends with a sentence and nothing to press (audit §3.4 #8). The sealed-state share is deferred until a link exists (no domain yet — third-party-gated); a forward action is not.

**Files:**
- Modify: `apps/mobile/src/ui/CrowdReveal.tsx`

**Interfaces:**
- `CrowdReveal` gains a `GoldButton title="RETURN AT NOON"` → `router.replace("/")` at the bottom; `"{n} ORACLES CONSULTED"` → `"{n} ORACLES HAVE SPOKEN"` (same noun as home); sentence stays above the button.

- [ ] **Step 1: Implement** — import `useRouter` from expo-router and `GoldButton`; add the button below the sentence inside the outer `View` (`paddingBottom: space(2)`); rename the noun.

- [ ] **Step 2: Typecheck + simulator** — `pnpm --filter @oracle/mobile typecheck`; seal all five in the sim → `finale-return.png`; tap RETURN AT NOON → home shows BEHOLD THE CROWD state.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/CrowdReveal.tsx docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): the spread ends with a way home"
```

---

### Task 5: The second hit has a trigger; the ask has a voice

**Why:** Nothing calls the player back at noon (audit §5.1) — the only local reminder is the closing call; a 3/5 player gets "FIVE ANSWERS STAND BETWEEN YOU AND NOON" (§3.1); the OS permission prompt fires bare (voice spec §4 wants an interstitial; §3.4 #12).

**Files:**
- Modify: `apps/mobile/src/game/reminders.ts`, `apps/mobile/test/reminders.test.ts`, `apps/mobile/src/notifications/schedule.ts`, `apps/mobile/src/app/round.tsx`, `apps/mobile/src/app/index.tsx`
- Create: `apps/mobile/src/notifications/summons.ts`, `apps/mobile/src/app/summons.tsx`

**Interfaces:**
- `planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5): Reminder[]` where `Reminder = { kind: "closing" | "noon"; date: string; at: Date; body: string }`.
  - Day 0 closing: skipped when `sealedCount === total`; drawn from lines requiring `"partial"` when `0 < sealedCount < total` (seed `closing:${date}`); generic otherwise.
  - Days 1–6 closing: generic, unchanged.
  - **Noon** (new): only for day 0 and only when `sealedCount > 0`: `at = locksAt + 45 min`, body = the `noon.generic-2` line verbatim (`"NOON HAS PASSED. THE OUTCOMES BELONG TO THE LEDGER NOW."` — true whether or not resolution has finished; never a false claim).
- `resealReminders(locksAt, roundDate, sealedCount)` — passes through; titles unchanged.
- `summons.ts`: `maybeSummon(push: (href: "/summons") => void): Promise<void>` — if `!getNotifAsked()` → `markNotifAsked()` then `push("/summons")`. (Marks asked on push so it can never re-fire.)
- `app/summons.tsx`: `SUMMONS_LINES` decode in; `GoldButton "LET IT SPEAK"` → `Notifications.requestPermissionsAsync()` then `router.back()`; `QuietLink "NOT NOW"` → `router.back()`. TopBar present. Reduced motion: lines render instantly (DecodeLine already does this).
- Wiring: `round.tsx` — when `allSealed` first becomes true in this mount → `maybeSummon(router.push)`; `index.tsx` — on focus, when `anySealed` → `maybeSummon(router.push)` (covers partial players). Remove `askNotifPermissionOnce` and its `useEffect`; keep the export deleted (grep for other callers first).

- [ ] **Step 1: Failing tests**

Update `reminders.test.ts` to the new signature (`false` → `0`, `true` → `5`) and add:

```ts
  it("a partial day draws a partial-aware closing line", () => {
    const r = planReminders(locksAt, "2026-08-28", 3);
    expect(r.find((x) => x.kind === "closing" && x.date === "2026-08-28")!.body).toMatch(/ALL FIVE|WHOLE DAYS/);
  });
  it("schedules one noon reminder 45 minutes after lock, only once something is sealed", () => {
    const noon = planReminders(locksAt, "2026-08-28", 1).filter((x) => x.kind === "noon");
    expect(noon).toHaveLength(1);
    expect(noon[0]!.at.toISOString()).toBe("2026-08-29T16:45:00.000Z");
    expect(noon[0]!.body).toBe("NOON HAS PASSED. THE OUTCOMES BELONG TO THE LEDGER NOW.");
    expect(planReminders(locksAt, "2026-08-28", 0).some((x) => x.kind === "noon")).toBe(false);
  });
  it("a sealed day still gets its noon reminder and no closing call", () => {
    const r = planReminders(locksAt, "2026-08-28", 5);
    expect(r.filter((x) => x.date === "2026-08-28").map((x) => x.kind)).toEqual(["noon"]);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/mobile test -- reminders`
Expected: FAIL.

- [ ] **Step 3: Implement `reminders.ts`**

```ts
import { COPY_BANK, selectLine } from "@oracle/core";

const CLOSING = COPY_BANK.filter((l) => l.pool === "closing");
const NOON_LINE = COPY_BANK.find((l) => l.id === "noon.generic-2")!.text; // true before AND after resolution

export const REMINDER_LEAD_MS = 3 * 3_600_000;
export const NOON_LAG_MS = 45 * 60_000;
export const REMINDER_DAYS = 7;

export interface Reminder { kind: "closing" | "noon"; date: string; at: Date; body: string }

export function planReminders(locksAt: string, roundDate: string, sealedCount: number, total = 5): Reminder[] {
  const lock0 = new Date(locksAt).getTime();
  const day0 = new Date(`${roundDate}T00:00:00Z`).getTime();
  const out: Reminder[] = [];
  // The second hit: once anything is sealed today, the ledger's reading is worth a knock.
  if (sealedCount > 0) out.push({ kind: "noon", date: roundDate, at: new Date(lock0 + NOON_LAG_MS), body: NOON_LINE });
  for (let k = 0; k < REMINDER_DAYS; k++) {
    if (k === 0 && sealedCount >= total) continue;
    const date = new Date(day0 + k * 86_400_000).toISOString().slice(0, 10);
    const partial = k === 0 && sealedCount > 0;
    const pool = partial ? CLOSING.filter((l) => (l.requires ?? []).includes("partial")) : CLOSING;
    const line = selectLine(pool, `closing:${date}`, partial ? ["partial"] : []);
    if (!line) continue;
    out.push({ kind: "closing", date, at: new Date(lock0 + k * 86_400_000 - REMINDER_LEAD_MS), body: line.text });
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @oracle/mobile test`
Expected: PASS.

- [ ] **Step 5: Schedule wrapper, summons module, route, wiring**

`schedule.ts`: `resealReminders(locksAt: string, roundDate: string, sealedCount: number)` → `planReminders(locksAt, roundDate, sealedCount)`; loop unchanged. Delete `askNotifPermissionOnce`.

`src/notifications/summons.ts`:

```ts
import { getNotifAsked, markNotifAsked } from "../api/flags";

// The one summons, ever (voice spec §4): the interstitial precedes the OS
// prompt, and the flag flips the moment it is shown so it can never repeat.
export async function maybeSummon(push: (href: "/summons") => void): Promise<void> {
  try {
    if (await getNotifAsked()) return;
    await markNotifAsked();
    push("/summons");
  } catch {}
}
```

`src/app/summons.tsx`:

```tsx
import { View } from "react-native";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { SUMMONS_LINES } from "@oracle/core";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow } from "../ui/Text";
import { DecodeLine } from "../ui/DecodeText";
import { GoldButton, QuietLink } from "../ui/Button";
import { colors, space } from "../theme";

export default function Summons() {
  const router = useRouter();
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The summons</Eyebrow>
        <View style={{ gap: space(2) }}>
          {SUMMONS_LINES.map((line, i) => (
            <DecodeLine key={line} text={line} delayMs={i * 160} durationMs={450} size={12} color={colors.ink} letterSpacing={2} style={{ lineHeight: 20, textAlign: "center" }} />
          ))}
        </View>
      </View>
      <View style={{ gap: space(2), paddingBottom: space(2) }}>
        <GoldButton title="LET IT SPEAK" onPress={async () => { try { await Notifications.requestPermissionsAsync(); } catch {} leave(); }} />
        <QuietLink title="Not now" onPress={leave} />
      </View>
    </Screen>
  );
}
```

`round.tsx`: replace the `askNotifPermissionOnce` effect with:
```ts
  const allSealed = qs.length > 0 && qs.every((q) => answers[q.id]?.sealed);
  const summoned = useRef(false);
  useEffect(() => {
    if (allSealed && !summoned.current) { summoned.current = true; void maybeSummon((href) => router.push(href)); }
  }, [allSealed]);
```
(`const router = useRouter();` from expo-router.)

`index.tsx`: inside the existing `useFocusEffect` callback add `if (anySealed) void maybeSummon((href) => router.push(href));` (add `anySealed` and `router` to its deps), and update `resealReminders(round.locks_at, round.date, sealedCount)` with `sealedCount` in the effect deps (removing the Task-2 TODO).

- [ ] **Step 6: Typecheck + simulator**

Run: `pnpm --filter @oracle/mobile typecheck`. Simulator: reset the `oracle.notif_asked` flag (delete the app's SecureStore by reinstalling Expo Go's data — or temporarily call `markNotifAsked` removal; simplest: `xcrun simctl privacy booted reset notifications host.exp.Exponent` plus a fresh device token is NOT needed — the flag lives in SecureStore; clearing the Expo Go app data resets it). Seal five → `/summons` appears → `summons.png`; LET IT SPEAK → OS prompt. Verify scheduled notifications: add a temporary `console.log(await Notifications.getAllScheduledNotificationsAsync())` after reseal, confirm one `noon` at lock+45m and six closing calls; remove the log.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/game/reminders.ts apps/mobile/test/reminders.test.ts apps/mobile/src/notifications/schedule.ts apps/mobile/src/notifications/summons.ts apps/mobile/src/app/summons.tsx apps/mobile/src/app/round.tsx apps/mobile/src/app/index.tsx docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): the noon knock, partial-aware closing calls, and the summons before the OS asks"
```

---

### Task 6: The plaque shows the road to fifty

**Why:** "UNWRITTEN" is a null state, not a goal (audit §3.2, §5.3); the plaque never says epithets are 28-day (§3.5); the verdict needs its receipt count (Plan 1 Task 3 signature — currently passed `0`).

**Files:**
- Create: `apps/mobile/src/game/scoreProgress.ts`, `apps/mobile/test/scoreProgress.test.ts`
- Modify: `apps/mobile/src/app/ledger.tsx`

**Interfaces:**
- Consumes: `MeLedger.calls_rated`, `calls_answered` (Plan 1 Task 5/10), `CONSTANTS.ORACLE_SCORE_MIN_CALLS`, `calibrationVerdict(avg, acc, n)`.
- Produces: `scoreValue(oracleScore: number | null, callsRated: number): string` → `"UNWRITTEN · 37 OF 50"` when null, else `String(score)`; `scoreLabel(oracleScore: number | null): string` → `"ORACLE SCORE"` either way (kept for symmetry/tests).
- Plaque: `Eyebrow` above the epithet block reads `"Epithet of the last 28 days"`; the ORACLE SCORE stat uses `scoreValue`; `calibrationVerdict(d.avg_confidence, d.accuracy_pct, d.calls_answered)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreValue } from "../src/game/scoreProgress";

describe("scoreValue", () => {
  it("counts the road to fifty until the score is written", () => {
    expect(scoreValue(null, 0)).toBe("UNWRITTEN · 0 OF 50");
    expect(scoreValue(null, 37)).toBe("UNWRITTEN · 37 OF 50");
    expect(scoreValue(812, 60)).toBe("812");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @oracle/mobile test -- scoreProgress` → FAIL.

- [ ] **Step 3: Implement**

```ts
import { CONSTANTS } from "@oracle/core";
// The mid-term goal, made visible: fifty rated calls write the Oracle Score.
export function scoreValue(oracleScore: number | null, callsRated: number): string {
  return oracleScore === null ? `UNWRITTEN · ${Math.min(callsRated, CONSTANTS.ORACLE_SCORE_MIN_CALLS)} OF ${CONSTANTS.ORACLE_SCORE_MIN_CALLS}` : String(oracleScore);
}
```

`ledger.tsx`: `<Stat label="ORACLE SCORE" value={scoreValue(d.oracle_score, d.calls_rated)} />`; add `<Eyebrow>Epithet of the last 28 days</Eyebrow>` as the first child of the plaque box (above the title); replace both `calibrationVerdict(d.avg_confidence, d.accuracy_pct, 0)` with `calibrationVerdict(d.avg_confidence, d.accuracy_pct, d.calls_answered)`.

- [ ] **Step 4: Tests + typecheck + simulator** — `pnpm --filter @oracle/mobile test && pnpm --filter @oracle/mobile typecheck`; `plaque-progress.png`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/scoreProgress.ts apps/mobile/test/scoreProgress.test.ts apps/mobile/src/app/ledger.tsx docs/superpowers/plans/assets/loop-clarity
git commit -m "feat(mobile): the plaque shows the road to fifty and dates its epithet"
```

---

## Self-review

- **Spec coverage:** audit §3.1 (Task 2 + Task 5 partial copy + rites in Plan 1); §3.2 (Task 3, Task 6); §3.3 (Task 3); §3.4 #4 (Task 1), #5 (Tasks 1–2 SleepsPanel), #6 (Task 3 spectator + Task 2 lapse), #7 (Task 2), #8 (Task 4 — share half deferred: needs a link/domain), #9 (Task 2 noun), #10–11 (Task 1), #12 (Task 5), #13 (Task 1); §3.5 minors: countdown fallback (Task 2), pending copy (Task 3), seen-after-ceremony (Task 3), nouns (Tasks 2, 4), 28-day note + UNREAD progress (Task 6 + Plan 1), NOON NEW YORK (Plan 1 rites). Deliberately not done: share link (no domain), `LEAN_COMMIT` undo grace (Erik tuned the swipe by hand — his call), `yesterdayOf` device-clock edge (cosmetic).
- **Type consistency:** `planReminders(locksAt, roundDate, sealedCount, total?)` Task 5 ↔ `resealReminders(locksAt, roundDate, sealedCount)` Task 5 ↔ `index.tsx` call (Task 2 leaves a TODO, Task 5 resolves it); `crowdVerdict(answer, pct, playerCount)` from Plan 1 already in `round.tsx`; `SleepsPanel` Task 1 → Task 2; `maybeSummon(push)` Task 5 both call sites; `scoreValue` Task 6 only; `rowState/rowMark/rowRight/receiptLine/ledgerLines/pendingLine/lapsedLine` Task 3 only.
- **Placeholders:** Task 3 Step 1's test file is specified by branch list rather than verbatim because the fixture is a 14-field object repeated per case; the executor writes it against the `Reveal` type with every branch named above asserted.
