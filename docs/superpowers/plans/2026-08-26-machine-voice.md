# Machine Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the machine-voice layer from the voice spec: the linted copy bank + liturgy, deterministic line selection, the epithet engine, `GET /v1/me/ledger`, the Forecaster's Ledger plaque (screen + night share card), and TDD'd hinge-push composition with a no-op OneSignal sender.

**Architecture:** All voice content and pure logic live in `@oracle/core` (copy bank as a typed constant with a vitest "copy lint"; deterministic selection; epithet assignment) so API and mobile share one source of truth. The API grows one read endpoint (`/v1/me/ledger`, computed on read from existing predictions/questions rows — points, brier, outcome, crowdYesPct are already stored at resolution) and a pure push-composition module whose *trigger* (cron / round-resolve orchestration) is explicitly Plan-4 work. Mobile grows the plaque screen and a second night-realm share card reusing ShareCard's anatomy.

**Tech Stack:** zod (@oracle/core), Hono + Drizzle (API, PGlite test DB), @tanstack/react-query, @shopify/react-native-skia (share card), vitest everywhere.

**Spec:** `docs/superpowers/specs/2026-08-26-oracle-voice-design.md` (this plan implements it; read it first). Brand register rules: `docs/superpowers/specs/2026-08-26-oracle-brand-brief.md` §7.

## Global Constraints

- No new npm dependencies anywhere in the monorepo.
- Voice register (spec §2, enforced by the copy lint, not just convention): mono caps, no emoji, no exclamation marks, no CTA verbs, complete sentences. Blunt lines must cite the record; noon pushes never contain a score ("curiosity gap").
- The liturgy is frozen text, verbatim, everywhere: `EVERY ANSWER SEALED BEFORE THE OUTCOME. EVERY SCORE READ AGAINST THE CROWD. NOTHING REVISED.`
- No LLM-composed copy: the bank is hand-written constants; selection is `hash(userId + date)` — deterministic, same player + same day = same line.
- Push SDK / permission interstitial / cron triggers are OUT of this plan (need EAS dev builds + OneSignal keys + Plan-4 crons). The sender must no-op cleanly when `ONESIGNAL_APP_ID`/`ONESIGNAL_API_KEY` are absent.
- Palette: agedGold borders only; goldText for gold text; mutedInk captions; never new colors. Skia text has NO font fallback — no non-ASCII glyphs in share-card text.
- Workers are NEVER run against the production DB — API tests use `makeTestDb()` + `seedRound()` from `apps/api/test/helpers/db.ts`.
- Verification commands (repo root): `pnpm --filter @oracle/core test` (34 tests now), `pnpm --filter @oracle/core typecheck`, `pnpm --filter @oracle/api test` (21), `pnpm --filter @oracle/api typecheck`, `pnpm --filter @oracle/mobile exec tsc --noEmit`, `pnpm --filter @oracle/mobile test` (33). Totals grow with this plan; all must be green.
- Mobile pure logic goes in `src/game/` (node-testable); mobile tests must not transitively import Skia/Expo/react-native.
- Simulator workflow: Metro from `apps/mobile` on :8081 (`lsof -nP -iTCP:8081 -sTCP:LISTEN`; if missing `cd apps/mobile && nohup npx expo start --port 8081 > /tmp/expo.log 2>&1 &`), wrangler on :8787 from `apps/api`. Booted UDID via `xcrun simctl list devices booted`. Fast Refresh from nohup'd Metro silently fails — for EVERY visual check: `xcrun simctl terminate <UDID> host.exp.Exponent; xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/<path>"; sleep 22; xcrun simctl io <UDID> screenshot <file>`, then Read the screenshot.
- Any temporary debug edit made for verification MUST be reverted before the task's commit; check `git diff` before committing.

---

### Task 1: Copy bank + liturgy + copy lint (core, TDD)

**Files:**
- Create: `packages/core/src/copy.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./copy";`)
- Test: `packages/core/test/copy-lint.test.ts` (create)

**Interfaces:**
- Produces: `CopyLine`, `Requirement`, `COPY_BANK: ReadonlyArray<CopyLine>`, `LITURGY: string`, `LITURGY_LINES: readonly [string, string]`, `fillSlots(text: string, slots: { n?: number; streak?: number }): string`. Tasks 2, 5, 6, 7 consume these.

- [ ] **Step 1: Write the failing lint test**

Create `packages/core/test/copy-lint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COPY_BANK, LITURGY, LITURGY_LINES, fillSlots, type CopyLine } from "../src/copy";

const BANNED = ["CHECK", "TAP", "CLICK", "VISIT", "RESULTS", "DON'T MISS"];
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const worst = (l: CopyLine) => fillSlots(l.text, { n: 99, streak: 999 });

describe("the liturgy", () => {
  it("is frozen, verbatim", () => {
    expect(LITURGY).toBe("EVERY ANSWER SEALED BEFORE THE OUTCOME. EVERY SCORE READ AGAINST THE CROWD. NOTHING REVISED.");
    expect(LITURGY_LINES.join(" ")).toBe(LITURGY);
  });
});

describe("copy lint (spec §2/§3 — every line, every rule)", () => {
  it("bank is at least 60 lines with unique ids matching their pool", () => {
    expect(COPY_BANK.length).toBeGreaterThanOrEqual(60);
    const ids = COPY_BANK.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of COPY_BANK) expect(l.id.startsWith(`${l.pool}.`)).toBe(true);
  });
  it("register: mono caps, no emoji, no exclamation, no CTA verbs", () => {
    for (const l of COPY_BANK) {
      expect(l.text, l.id).toBe(l.text.toUpperCase());
      expect(l.text, l.id).not.toMatch(EMOJI);
      expect(l.text, l.id).not.toContain("!");
      for (const b of BANNED) expect(l.text, l.id).not.toContain(b);
    }
  });
  it("fits a push after worst-case slot expansion", () => {
    for (const l of COPY_BANK) expect(worst(l).length, l.id).toBeLessThanOrEqual(140);
  });
  it("every slot is backed by a requirement, and expansion clears all slots", () => {
    for (const l of COPY_BANK) {
      if (l.text.includes("{n}")) expect(l.requires ?? [], l.id).toContain(l.pool === "closing" ? "players" : "results");
      if (l.text.includes("{streak}")) expect(l.requires ?? [], l.id).toContain("streak");
      expect(worst(l), l.id).not.toMatch(/[{}]/);
    }
  });
  it("curiosity gap: no noon line carries a score", () => {
    for (const l of COPY_BANK.filter((x) => x.pool === "noon")) {
      expect(l.text, l.id).not.toContain("POINTS");
      expect(l.text, l.id).not.toContain("SCORE");
      expect(worst(l), l.id).not.toMatch(/[+-]\d/);
    }
  });
  it("has the spec'd pool shape", () => {
    const count = (p: string) => COPY_BANK.filter((l) => l.pool === p).length;
    expect(count("noon")).toBeGreaterThanOrEqual(25);
    expect(count("closing")).toBeGreaterThanOrEqual(20);
    expect(count("streak")).toBeGreaterThanOrEqual(10);
    expect(count("system")).toBeGreaterThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test`
Expected: FAIL — cannot find `../src/copy`. Pre-existing 34 tests still pass.

- [ ] **Step 3: Implement the bank**

Create `packages/core/src/copy.ts` exactly:

```ts
// The machine voice (spec: docs/superpowers/specs/2026-08-26-oracle-voice-design.md).
// Hand-written, linted, versioned. No generated copy — the meme value of a
// voice comes from one unmistakable register sustained for years.

export type Requirement = "results" | "tideWin" | "streak" | "players" | "lapsed";

export interface CopyLine {
  id: string;
  pool: "noon" | "closing" | "streak" | "system";
  text: string;
  requires?: ReadonlyArray<Requirement>;
}

export const LITURGY_LINES = [
  "EVERY ANSWER SEALED BEFORE THE OUTCOME.",
  "EVERY SCORE READ AGAINST THE CROWD. NOTHING REVISED.",
] as const;
export const LITURGY = LITURGY_LINES.join(" ");

export function fillSlots(text: string, slots: { n?: number; streak?: number }): string {
  return text
    .replace(/\{n\}/g, slots.n === undefined ? "{n}" : String(slots.n))
    .replace(/\{streak\}/g, slots.streak === undefined ? "{streak}" : String(slots.streak));
}

export const COPY_BANK: ReadonlyArray<CopyLine> = [
  // ── noon: the hinge. Ledger read; the pull, never the payoff. ──
  { id: "noon.generic-1", pool: "noon", text: "THE LEDGER IS READ. IT DOES NOT READ ITSELF TWICE." },
  { id: "noon.generic-2", pool: "noon", text: "NOON HAS PASSED. THE OUTCOMES BELONG TO THE LEDGER NOW." },
  { id: "noon.generic-3", pool: "noon", text: "THE LEDGER IS READ. THE CROWD IS COUNTING ITS WOUNDS." },
  { id: "noon.generic-4", pool: "noon", text: "WHAT WAS SEALED IS NOW SETTLED." },
  { id: "noon.generic-5", pool: "noon", text: "THE ORB HAS SPOKEN. THE LEDGER AGREES." },
  { id: "noon.read-1", pool: "noon", text: "THE LEDGER IS READ. {n} OF YOUR ANSWERS DID NOT SURVIVE.", requires: ["results"] },
  { id: "noon.read-2", pool: "noon", text: "THE LEDGER IS READ. ONE OF YOUR ANSWERS SURPRISED US.", requires: ["results"] },
  { id: "noon.read-3", pool: "noon", text: "THE CROWD MOVED. YOU DID NOT. THE LEDGER REMEMBERS WHO WAS RIGHT.", requires: ["results"] },
  { id: "noon.read-4", pool: "noon", text: "NOON HAS PASSED. YOUR CONVICTION HAS BEEN WEIGHED.", requires: ["results"] },
  { id: "noon.read-5", pool: "noon", text: "THE OUTCOMES ARE IN. YOUR LEDGER HAS CHANGED SHAPE.", requires: ["results"] },
  { id: "noon.read-6", pool: "noon", text: "THE LEDGER IS READ. YOU AND THE CROWD DID NOT AGREE EVERYWHERE.", requires: ["results"] },
  { id: "noon.read-7", pool: "noon", text: "FIVE QUESTIONS WERE ASKED. THE ANSWERS ARE NO LONGER YOURS TO CHOOSE.", requires: ["results"] },
  { id: "noon.read-8", pool: "noon", text: "THE LEDGER IS READ. SOME OF IT WILL PLEASE YOU.", requires: ["results"] },
  { id: "noon.read-9", pool: "noon", text: "YOUR ANSWERS MET THEIR OUTCOMES AT NOON. NOT ALL OF THEM STOOD.", requires: ["results"] },
  { id: "noon.read-10", pool: "noon", text: "THE INK IS DRY. THE LEDGER HOLDS YOUR RECKONING.", requires: ["results"] },
  { id: "noon.tide-1", pool: "noon", text: "YOU STOOD AGAINST THE TIDE. THE TIDE BROKE.", requires: ["tideWin"] },
  { id: "noon.tide-2", pool: "noon", text: "THE CROWD WENT ONE WAY. YOU WENT THE OTHER. THE LEDGER BOWED TO YOU.", requires: ["tideWin"] },
  { id: "noon.tide-3", pool: "noon", text: "FEW STOOD WHERE YOU STOOD. THE LEDGER PAID TWICE.", requires: ["tideWin"] },
  { id: "noon.lapsed-1", pool: "noon", text: "THE LEDGER WAS READ WITHOUT YOU. TOMORROW IT NEED NOT BE.", requires: ["lapsed"] },
  { id: "noon.lapsed-2", pool: "noon", text: "THE CROWD SPOKE. YOUR LINE IS BLANK.", requires: ["lapsed"] },
  { id: "noon.lapsed-3", pool: "noon", text: "NOON CAME AND WENT. THE ORB DID NOT HEAR FROM YOU.", requires: ["lapsed"] },
  { id: "noon.vigil-1", pool: "noon", text: "{streak} DAYS WITHOUT SILENCE. THE ORACLE NOTICES.", requires: ["results", "streak"] },
  { id: "noon.vigil-2", pool: "noon", text: "DAY {streak} OF YOUR VIGIL IS WRITTEN.", requires: ["results", "streak"] },
  { id: "noon.vigil-3", pool: "noon", text: "THE LEDGER IS READ. YOUR VIGIL HOLDS AT {streak} DAYS.", requires: ["results", "streak"] },
  { id: "noon.vigil-4", pool: "noon", text: "ANOTHER NOON, ANOTHER PAGE. {streak} WITHOUT A GAP.", requires: ["results", "streak"] },
  // ── closing: the call. Unsealed players only, hours before lock. ──
  { id: "closing.call-1", pool: "closing", text: "FIVE QUESTIONS. THE ORB IS OPEN UNTIL NOON." },
  { id: "closing.call-2", pool: "closing", text: "THE QUESTIONS ARE POSTED. THE CROWD IS ALREADY MOVING." },
  { id: "closing.call-3", pool: "closing", text: "TODAY'S LEDGER IS BLANK. IT WILL NOT STAY THAT WAY." },
  { id: "closing.call-4", pool: "closing", text: "{n} ORACLES HAVE ALREADY SPOKEN. THE ORB WAITS FOR YOU.", requires: ["players"] },
  { id: "closing.call-5", pool: "closing", text: "THE BIG ONE IS WORTH THE MOST. IT IS ALSO THE HARDEST. THIS IS NOT A COINCIDENCE." },
  { id: "closing.call-6", pool: "closing", text: "THE ORB CLOSES AT NOON. IT DOES NOT REOPEN." },
  { id: "closing.call-7", pool: "closing", text: "THREE HOURS REMAIN. THE CROWD HAS NOT WAITED." },
  { id: "closing.call-8", pool: "closing", text: "YOUR SEAT AT THE LEDGER IS EMPTY. NOON IS COMING." },
  { id: "closing.call-9", pool: "closing", text: "THE CROWD HAS CHOSEN ITS SIDES. YOURS IS STILL UNCLAIMED." },
  { id: "closing.call-10", pool: "closing", text: "PROPHECY FAVORS THE PRESENT. THE ORB IS STILL LIT." },
  { id: "closing.call-11", pool: "closing", text: "FIVE ANSWERS STAND BETWEEN YOU AND NOON." },
  { id: "closing.call-12", pool: "closing", text: "THE QUESTIONS WILL NOT ASK THEMSELVES TWICE." },
  { id: "closing.call-13", pool: "closing", text: "NOON SEALS THE LEDGER WITH OR WITHOUT YOU." },
  { id: "closing.call-14", pool: "closing", text: "THE ORACLE ASKS ONCE A DAY. TODAY IT IS STILL ASKING." },
  { id: "closing.call-15", pool: "closing", text: "WHAT YOU BELIEVE BEFORE NOON BECOMES RECORD AFTER IT." },
  { id: "closing.call-16", pool: "closing", text: "THE CROWD LEANS. IT DOES NOT KNOW YET IF IT LEANS WRONG." },
  { id: "closing.call-17", pool: "closing", text: "AN UNSEALED PROPHECY IS ONLY AN OPINION." },
  { id: "closing.call-18", pool: "closing", text: "THE ORB HOLDS FIVE QUESTIONS AND NO GRUDGES. NOON CHANGES THAT." },
  { id: "closing.call-19", pool: "closing", text: "SPEAK BEFORE NOON OR HOLD YOUR PEACE UNTIL TOMORROW." },
  { id: "closing.call-20", pool: "closing", text: "THE LEDGER TAKES NO LATE ENTRIES." },
  // ── streak: vigil lines for in-app surfaces. ──
  { id: "streak.vigil-1", pool: "streak", text: "{streak} DAYS WITHOUT SILENCE.", requires: ["streak"] },
  { id: "streak.vigil-2", pool: "streak", text: "YOUR VIGIL HOLDS. {streak} DAYS AND COUNTING.", requires: ["streak"] },
  { id: "streak.vigil-3", pool: "streak", text: "THE ORACLE KEEPS COUNT. {streak}.", requires: ["streak"] },
  { id: "streak.vigil-4", pool: "streak", text: "{streak} CONSECUTIVE NOONS. THE LEDGER APPROVES.", requires: ["streak"] },
  { id: "streak.vigil-5", pool: "streak", text: "A VIGIL OF {streak} DAYS IS NOT LUCK.", requires: ["streak"] },
  { id: "streak.lapse-1", pool: "streak", text: "YESTERDAY THE ORB WENT UNCONSULTED. IT DID NOT GO UNREAD." },
  { id: "streak.lapse-2", pool: "streak", text: "A GAP IN THE LEDGER IS NOT THE END OF IT." },
  { id: "streak.lapse-3", pool: "streak", text: "STREAKS END. RECORDS REMAIN." },
  { id: "streak.shield-1", pool: "streak", text: "THE SHIELD HELD. YOUR VIGIL SURVIVES THE MISSED NOON." },
  { id: "streak.begin-1", pool: "streak", text: "BEGIN AGAIN. THE ORB DOES NOT DWELL." },
  // ── system: states of the machine. ──
  { id: "system.sleep-1", pool: "system", text: "THE ORACLE SLEEPS. NO ROUND IS OPEN." },
  { id: "system.reading-1", pool: "system", text: "THE LEDGER IS BEING READ. PATIENCE." },
  { id: "system.offline-1", pool: "system", text: "THE ORB IS BEYOND REACH. IT WILL RETURN." },
  { id: "system.creed-1", pool: "system", text: "NOTHING IS REVISED. NOTHING IS FORGOTTEN." },
  { id: "system.creed-2", pool: "system", text: "EVERY ANSWER SEALED BEFORE THE OUTCOME." },
] as const;
```

Then add to `packages/core/src/index.ts`: `export * from "./copy";`

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/core test && pnpm --filter @oracle/core typecheck`
Expected: all pass (34 + 6 new), typecheck clean. If a lint rule fails on a line, fix the LINE, not the rule.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/copy.ts packages/core/src/index.ts packages/core/test/copy-lint.test.ts
git commit -m "feat(core): machine-voice copy bank, liturgy, and copy lint"
```

---

### Task 2: Deterministic line selection (core, TDD)

**Files:**
- Modify: `packages/core/src/copy.ts` (append)
- Test: `packages/core/test/copy-select.test.ts` (create)

**Interfaces:**
- Consumes: `CopyLine`, `Requirement`, `COPY_BANK` (Task 1).
- Produces: `voiceSeed(key: string): number`; `selectLine(lines: ReadonlyArray<CopyLine>, seedKey: string, satisfied: ReadonlyArray<Requirement>): CopyLine | null` — filters to lines whose every `requires` is satisfied, then picks by `voiceSeed(seedKey) % candidates.length`; null when nothing is eligible. Task 7 consumes both.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/copy-select.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { COPY_BANK, selectLine } from "../src/copy";

const noon = COPY_BANK.filter((l) => l.pool === "noon");

describe("selectLine", () => {
  it("is deterministic: same seed, same line", () => {
    const a = selectLine(noon, "user-1:2026-08-26", ["results"]);
    const b = selectLine(noon, "user-1:2026-08-26", ["results"]);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });
  it("different seeds reach different lines across the pool", () => {
    const picked = new Set(
      Array.from({ length: 40 }, (_, i) => selectLine(noon, `user-${i}:2026-08-26`, ["results"])!.id),
    );
    expect(picked.size).toBeGreaterThan(3);
  });
  it("never selects a line whose requirements are unmet", () => {
    for (let i = 0; i < 40; i++) {
      const l = selectLine(noon, `u${i}`, []);
      expect(l).not.toBeNull();
      expect(l!.requires ?? []).toEqual([]);
    }
  });
  it("honors satisfied requirements (a tide winner can draw a tide line)", () => {
    const tideOnly = noon.filter((l) => l.requires?.includes("tideWin"));
    const l = selectLine(tideOnly, "any-seed", ["results", "tideWin"]);
    expect(l).not.toBeNull();
    expect(l!.requires).toContain("tideWin");
  });
  it("returns null when no line is eligible", () => {
    const tideOnly = noon.filter((l) => l.requires?.includes("tideWin"));
    expect(selectLine(tideOnly, "seed", [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test` — Expected: FAIL, `selectLine` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/copy.ts`:

```ts
// Same char-walk hash as the mobile epigraph: deterministic, and the oracle
// does not change its mind — one seed key, one line, all day.
export function voiceSeed(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function selectLine(
  lines: ReadonlyArray<CopyLine>,
  seedKey: string,
  satisfied: ReadonlyArray<Requirement>,
): CopyLine | null {
  const have = new Set(satisfied);
  const eligible = lines.filter((l) => (l.requires ?? []).every((r) => have.has(r)));
  if (eligible.length === 0) return null;
  return eligible[voiceSeed(seedKey) % eligible.length]!;
}
```

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/core test && pnpm --filter @oracle/core typecheck` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/copy.ts packages/core/test/copy-select.test.ts
git commit -m "feat(core): deterministic machine-voice line selection"
```

---

### Task 3: Epithet engine (core, TDD)

**Files:**
- Create: `packages/core/src/epithet.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./epithet";`)
- Test: `packages/core/test/epithet.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export interface EpithetInput {
  completeRounds: number;        // trailing-28d rounds with all 5 answered
  tideWins: number;              // trailing-28d contrarian wins
  avgConfidence: number | null;  // trailing-28d mean confidence (resolved, non-void); null if none
  accuracyPct: number | null;    // trailing-28d accuracy 0-100; null if none
  majorityRate: number | null;   // trailing-28d fraction sided with majority (0-1); null if none
  streakCurrent: number;
}
export interface Epithet { id: string; title: string; receipt: string }
export function assignEpithet(input: EpithetInput): Epithet;
```

Task 4 consumes all three.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/epithet.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignEpithet, type EpithetInput } from "../src/epithet";

const base: EpithetInput = {
  completeRounds: 10, tideWins: 0, avgConfidence: 75,
  accuracyPct: 72, majorityRate: 0.6, streakCurrent: 3,
};

describe("assignEpithet (spec §6 — priority order, first match wins)", () => {
  it("THE UNREAD below five complete rounds, regardless of everything else", () => {
    const e = assignEpithet({ ...base, completeRounds: 4, tideWins: 9, streakCurrent: 30 });
    expect(e.id).toBe("unread");
    expect(e.receipt).toBe("THE LEDGER KNOWS TOO LITTLE OF YOU.");
  });
  it("TIDE-FIGHTER outranks calibration at 3+ tide wins, receipt carries the count", () => {
    const e = assignEpithet({ ...base, tideWins: 3, avgConfidence: 65, accuracyPct: 65 });
    expect(e.id).toBe("tide-fighter");
    expect(e.title).toBe("TIDE-FIGHTER");
    expect(e.receipt).toBe("3 TIMES AGAINST THE CROWD. 3 TIMES RIGHT.");
  });
  it("CALIBRATED SKEPTIC: honest gap and quiet conviction", () => {
    expect(assignEpithet({ ...base, avgConfidence: 65, accuracyPct: 60 }).id).toBe("calibrated-skeptic");
  });
  it("HIGH PRIEST OF CONVICTION: loud and right", () => {
    expect(assignEpithet({ ...base, avgConfidence: 90, accuracyPct: 65 }).id).toBe("high-priest");
  });
  it("THE HUMBLE LEDGER: knows more than it claims", () => {
    expect(assignEpithet({ ...base, avgConfidence: 60, accuracyPct: 80 }).id).toBe("humble-ledger");
  });
  it("TRUE BELIEVER at 80% majority; ORACLE OF THE MINORITY at 35% minority", () => {
    expect(assignEpithet({ ...base, majorityRate: 0.85 }).id).toBe("true-believer");
    expect(assignEpithet({ ...base, majorityRate: 0.6 }).id).toBe("minority-oracle");
  });
  it("THE UNSHAKEN at a 7-day streak, receipt carries the streak", () => {
    const e = assignEpithet({ ...base, majorityRate: 0.7, streakCurrent: 9 });
    expect(e.id).toBe("unshaken");
    expect(e.receipt).toBe("9 DAYS WITHOUT SILENCE.");
  });
  it("KEEPER OF THE LEDGER is the floor; null stats skip their rules safely", () => {
    const e = assignEpithet({ completeRounds: 6, tideWins: 0, avgConfidence: null, accuracyPct: null, majorityRate: null, streakCurrent: 0 });
    expect(e.id).toBe("keeper");
    expect(e.receipt).toBe("THE LEDGER GROWS. SO DO YOU.");
  });
});
```

Note the base fixture is chosen so exactly one rule fires per test: gap = 75−72 = 3 but avgConfidence 75 ≥ 70 blocks calibrated-skeptic; majorityRate 0.6 → minority 0.4 ≥ 0.35 fires minority-oracle as the base outcome — which is why tests above it override the relevant fields.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/core test` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `packages/core/src/epithet.ts`:

```ts
// The weekly epithet (voice spec §6): one title, priority-ordered rules,
// first match wins, and every epithet carries its receipt — the plaque never
// asserts identity without evidence. Inputs are computed over a trailing
// 28-day window by the ledger endpoint.

export interface EpithetInput {
  completeRounds: number;
  tideWins: number;
  avgConfidence: number | null;
  accuracyPct: number | null;
  majorityRate: number | null;
  streakCurrent: number;
}

export interface Epithet {
  id: string;
  title: string;
  receipt: string;
}

export function assignEpithet(s: EpithetInput): Epithet {
  if (s.completeRounds < 5) {
    return { id: "unread", title: "THE UNREAD", receipt: "THE LEDGER KNOWS TOO LITTLE OF YOU." };
  }
  if (s.tideWins >= 3) {
    return { id: "tide-fighter", title: "TIDE-FIGHTER", receipt: `${s.tideWins} TIMES AGAINST THE CROWD. ${s.tideWins} TIMES RIGHT.` };
  }
  const gap = s.avgConfidence !== null && s.accuracyPct !== null ? s.avgConfidence - s.accuracyPct : null;
  if (gap !== null && Math.abs(gap) <= 10 && s.avgConfidence! < 70) {
    return { id: "calibrated-skeptic", title: "CALIBRATED SKEPTIC", receipt: "YOU CLAIM LITTLE AND MISS LESS." };
  }
  if (s.avgConfidence !== null && s.accuracyPct !== null && s.avgConfidence >= 85 && s.accuracyPct >= 60) {
    return { id: "high-priest", title: "HIGH PRIEST OF CONVICTION", receipt: "YOU SPEAK LOUDLY AND THE LEDGER AGREES." };
  }
  if (gap !== null && gap < -10) {
    return { id: "humble-ledger", title: "THE HUMBLE LEDGER", receipt: "YOU KNOW MORE THAN YOU CLAIM." };
  }
  if (s.majorityRate !== null && s.majorityRate >= 0.8) {
    return { id: "true-believer", title: "TRUE BELIEVER OF THE CROWD", receipt: "WHERE THE CROWD GOES, YOU GO." };
  }
  if (s.majorityRate !== null && 1 - s.majorityRate >= 0.35) {
    return { id: "minority-oracle", title: "ORACLE OF THE MINORITY", receipt: "YOU WALK WHERE FEW WALK." };
  }
  if (s.streakCurrent >= 7) {
    return { id: "unshaken", title: "THE UNSHAKEN", receipt: `${s.streakCurrent} DAYS WITHOUT SILENCE.` };
  }
  return { id: "keeper", title: "KEEPER OF THE LEDGER", receipt: "THE LEDGER GROWS. SO DO YOU." };
}
```

Then add to `packages/core/src/index.ts`: `export * from "./epithet";`

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/core test && pnpm --filter @oracle/core typecheck` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/epithet.ts packages/core/src/index.ts packages/core/test/epithet.test.ts
git commit -m "feat(core): epithet engine with receipts"
```

---

### Task 4: GET /v1/me/ledger (API, TDD)

**Files:**
- Modify: `packages/core/src/schemas.ts` (append `MeLedgerSchema`)
- Create: `apps/api/src/routes/me.ts`
- Modify: `apps/api/src/app.ts` (mount `/v1/me`)
- Test: `apps/api/test/ledger.test.ts` (create)

**Interfaces:**
- Consumes: `assignEpithet`, `EpithetInput` (Task 3); `deviceAuth` from `./auth`; `makeTestDb`/`seedRound` helpers; `resolveQuestion` from `../src/resolution`.
- Produces: `GET /v1/me/ledger` → 200

```json
{ "oracle_score": null, "days_consulted": 1, "streak": 0, "accuracy_pct": 100,
  "avg_confidence": 85, "tide_wins": 1, "majority_rate": 0,
  "epithet": { "id": "unread", "title": "THE UNREAD", "receipt": "THE LEDGER KNOWS TOO LITTLE OF YOU." },
  "computed_through": "2026-08-20" }
```

Core exports `MeLedgerSchema` and `type MeLedger`. Task 5 consumes both.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/ledger.test.ts`:

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
const body = (q: string, answer: boolean, confidence = 85) =>
  JSON.stringify({ question_id: q, answer, confidence, idempotency_key: "k" });

afterEach(() => vi.useRealTimers());

describe("GET /v1/me/ledger", () => {
  it("computes stats and a tide win from the caller's resolved record", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    // a stands alone on YES; crowd is 1/3 = 33% yes → a's side is 33 (<40)
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await resolveQuestion(db, qs[0]!.id, "yes");

    const res = await a("/v1/me/ledger");
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, unknown>;
    expect(out).toMatchObject({
      days_consulted: 1,
      accuracy_pct: 100,
      avg_confidence: 85,
      tide_wins: 1,
      majority_rate: 0,
      computed_through: "2026-08-20",
    });
    expect((out.epithet as { id: string }).id).toBe("unread"); // < 5 complete rounds

    const resB = await b("/v1/me/ledger");
    const outB = (await resB.json()) as Record<string, unknown>;
    expect(outB).toMatchObject({ accuracy_pct: 0, tide_wins: 0, majority_rate: 1 });
  });

  it("void outcomes are excluded; a fresh player gets the null shape", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-20T17:00:00Z"), toFake: ["Date"] });
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await a("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) });
    await resolveQuestion(db, qs[1]!.id, "void");

    const out = (await (await a("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(out).toMatchObject({ days_consulted: 1, accuracy_pct: null, avg_confidence: null, tide_wins: 0, majority_rate: null });

    const fresh = await player(app);
    const outF = (await (await fresh("/v1/me/ledger")).json()) as Record<string, unknown>;
    expect(outF).toMatchObject({ days_consulted: 0, accuracy_pct: null, streak: 0 });
    expect((outF.epithet as { id: string }).id).toBe("unread");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test` — Expected: ledger.test.ts FAILS (404, route missing); pre-existing suites pass.

- [ ] **Step 3: Implement**

Append to `packages/core/src/schemas.ts` (after `MineTodaySchema`):

```ts
export const MeLedgerSchema = z.object({
  oracle_score: z.number().int().nullable(),
  days_consulted: z.number().int(),
  streak: z.number().int(),
  accuracy_pct: z.number().int().nullable(),
  avg_confidence: z.number().int().nullable(),
  tide_wins: z.number().int(),
  majority_rate: z.number().nullable(),
  epithet: z.object({ id: z.string(), title: z.string(), receipt: z.string() }),
  computed_through: z.string(),
});
export type MeLedger = z.infer<typeof MeLedgerSchema>;
```

Create `apps/api/src/routes/me.ts`:

```ts
import { Hono } from "hono";
import { eq, inArray } from "drizzle-orm";
import { assignEpithet, CONTRARIAN_CROWD_PCT } from "@oracle/core";
import type { AppContext } from "../app";
import { schema } from "../db/client";
import { deviceAuth } from "./auth";

const WINDOW_MS = 28 * 86_400_000;

export const meRoutes = new Hono<AppContext>()
  .use("*", deviceAuth)
  .get("/ledger", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
    const preds = await db.query.predictions.findMany({ where: eq(schema.predictions.userId, userId) });
    const qs = preds.length
      ? await db.query.questions.findMany({ where: inArray(schema.questions.id, preds.map((p) => p.questionId)) })
      : [];
    const qById = new Map(qs.map((q) => [q.id, q]));
    const windowStart = Date.now() - WINDOW_MS;

    interface Row { correct: boolean; confidence: number; sidePct: number | null; inWindow: boolean }
    const resolved: Row[] = [];
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      resolved.push({
        correct: p.answer === (q.outcome === "yes"),
        confidence: p.confidence,
        sidePct: crowd === null ? null : p.answer ? crowd : 100 - crowd,
        inWindow: q.locksAt.getTime() >= windowStart,
      });
    }

    const stats = (rows: Row[]) => {
      const withCrowd = rows.filter((r) => r.sidePct !== null && r.sidePct !== 50);
      return {
        accuracyPct: rows.length ? Math.round((100 * rows.filter((r) => r.correct).length) / rows.length) : null,
        avgConfidence: rows.length ? Math.round(rows.reduce((s, r) => s + r.confidence, 0) / rows.length) : null,
        tideWins: rows.filter((r) => r.correct && r.sidePct !== null && r.sidePct < CONTRARIAN_CROWD_PCT).length,
        majorityRate: withCrowd.length ? withCrowd.filter((r) => r.sidePct! > 50).length / withCrowd.length : null,
      };
    };
    const life = stats(resolved);
    const win = stats(resolved.filter((r) => r.inWindow));

    const byDate = new Map<string, number>();
    for (const p of preds) {
      const q = qById.get(p.questionId);
      if (q) byDate.set(q.roundDate, (byDate.get(q.roundDate) ?? 0) + 1);
    }
    const completeRounds = [...byDate.entries()].filter(([date, n]) => {
      const anyQ = qs.find((q) => q.roundDate === date);
      return n >= 5 && anyQ !== undefined && anyQ.locksAt.getTime() >= windowStart;
    }).length;

    const epithet = assignEpithet({
      completeRounds,
      tideWins: win.tideWins,
      avgConfidence: win.avgConfidence,
      accuracyPct: win.accuracyPct,
      majorityRate: win.majorityRate,
      streakCurrent: user?.streakCurrent ?? 0,
    });

    return c.json({
      oracle_score: user?.oracleScore ?? null,
      days_consulted: byDate.size,
      streak: user?.streakCurrent ?? 0,
      accuracy_pct: life.accuracyPct,
      avg_confidence: life.avgConfidence,
      tide_wins: life.tideWins,
      majority_rate: life.majorityRate,
      epithet,
      computed_through: new Date().toISOString().slice(0, 10),
    });
  });
```

If `CONTRARIAN_CROWD_PCT` is not exported from `@oracle/core` constants, check `packages/core/src/constants.ts` for its exact exported name and use that (it is the `sidePct < 40` threshold used by `questionPoints`).

In `apps/api/src/app.ts`: add `import { meRoutes } from "./routes/me";` and, after the predictions route line, `app.route("/v1/me", meRoutes);`

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck`
Expected: all suites pass including ledger.test.ts; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts apps/api/src/routes/me.ts apps/api/src/app.ts apps/api/test/ledger.test.ts
git commit -m "feat(api): GET /v1/me/ledger — stats, receipts, epithet"
```

---

### Task 5: Plaque screen + home link + liturgy placements (mobile)

**Files:**
- Modify: `apps/mobile/src/api/hooks.ts` (add `useMeLedger`)
- Create: `apps/mobile/src/app/ledger.tsx`
- Modify: `apps/mobile/src/app/index.tsx` (add quiet link)
- Modify: `apps/mobile/src/ui/ShareCard.tsx` (liturgy footer)

**Interfaces:**
- Consumes: `MeLedgerSchema`, `type MeLedger`, `LITURGY_LINES` from `@oracle/core`; existing `api`/`getDeviceToken`, `Screen`, `TopBar`, `Eyebrow`, `Serif`, `Mono`, `Ritual`, `QuietLink`, `AsciiDust`, `colors`, `space`.
- Produces: route `/ledger`; `useMeLedger()` (queryKey `["me","ledger"]`). Task 6 adds the share button to this screen.

- [ ] **Step 1: Hook**

In `apps/mobile/src/api/hooks.ts`: extend the core import with `MeLedgerSchema` and add:

```ts
export function useMeLedger() {
  return useQuery({
    queryKey: ["me", "ledger"],
    queryFn: async () => {
      const token = await getDeviceToken();
      return api("/v1/me/ledger", MeLedgerSchema, { token });
    },
  });
}
```

- [ ] **Step 2: Plaque screen**

Create `apps/mobile/src/app/ledger.tsx`:

```tsx
import { View } from "react-native";
import { Screen } from "../ui/Screen";
import { TopBar } from "../ui/TopBar";
import { Eyebrow, Mono, Ritual } from "../ui/Text";
import { AsciiDust } from "../ui/TerminalPatina";
import { useMeLedger } from "../api/hooks";
import { colors, space } from "../theme";
import { LITURGY_LINES } from "@oracle/core";

// The Forecaster's Ledger (voice spec §6): a museum specimen plaque. Stats in
// machine voice, one epithet with its receipt — identity only with evidence.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Mono size={11} color={colors.mutedInk} letterSpacing={2}>{label}</Mono>
      <Mono size={11} color={colors.ink} letterSpacing={2}>{value}</Mono>
    </View>
  );
}

export default function Ledger() {
  const ledger = useMeLedger();

  if (!ledger.data) return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(3) }}>
        <AsciiDust />
        <Eyebrow>The ledger is consulted</Eyebrow>
      </View>
    </Screen>
  );

  const d = ledger.data;
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
  return (
    <Screen>
      <TopBar />
      <View style={{ flex: 1, justifyContent: "center", gap: space(4) }}>
        <Eyebrow>The forecaster&apos;s ledger</Eyebrow>
        <View style={{ backgroundColor: colors.frescoWhite, borderWidth: 1, borderColor: colors.agedGold, padding: space(5), gap: space(4) }}>
          <View style={{ alignItems: "center", gap: space(2) }}>
            <Ritual bold size={24} color={colors.ink} letterSpacing={3} style={{ textAlign: "center" }}>{d.epithet.title}</Ritual>
            <Mono size={10} color={colors.goldText} letterSpacing={2} style={{ textAlign: "center" }}>{d.epithet.receipt}</Mono>
          </View>
          <View style={{ height: 1, backgroundColor: colors.agedGold, opacity: 0.4 }} />
          <View style={{ gap: space(2) }}>
            <Stat label="ORACLE SCORE" value={d.oracle_score === null ? "UNWRITTEN" : String(d.oracle_score)} />
            <Stat label="DAYS CONSULTED" value={String(d.days_consulted)} />
            <Stat label="CURRENT VIGIL" value={`${d.streak} DAYS`} />
            <Stat label="ACCURACY" value={pct(d.accuracy_pct)} />
            <Stat label="AVG CONVICTION" value={pct(d.avg_confidence)} />
            <Stat label="AGAINST THE TIDE" value={`×${d.tide_wins}`} />
          </View>
        </View>
        <View style={{ gap: space(1) }}>
          {LITURGY_LINES.map((line) => (
            <Mono key={line} size={9} color={colors.mutedInk} letterSpacing={1} style={{ textAlign: "center" }}>{line}</Mono>
          ))}
        </View>
      </View>
    </Screen>
  );
}
```

The `×` in the tide stat is React Native text (full font fallback) — allowed; the no-non-ASCII rule applies only to Skia canvases.

- [ ] **Step 3: Home link**

In `apps/mobile/src/app/index.tsx`, directly above the existing `<QuietLink title="Yesterday's ledger" ...>` line, add:

```tsx
        <QuietLink title="The forecaster's ledger" onPress={() => router.push("/ledger")} />
```

- [ ] **Step 4: Liturgy on the share card**

In `apps/mobile/src/ui/ShareCard.tsx`:
- Import: `import { LITURGY_LINES } from "@oracle/core";`
- Add a small mono font next to the existing fonts in `ShareCardCanvas`: `const monoSmall = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 12);`
- Change the CTA line's y from `950` to `938`, then add below it:

```tsx
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[0]} x={centered(monoSmall, LITURGY_LINES[0])} y={968} color={NIGHT_DIM} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[1]} x={centered(monoSmall, LITURGY_LINES[1])} y={986} color={NIGHT_DIM} />}
```

(Both liturgy lines are pure ASCII — Skia-safe.)

- [ ] **Step 5: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test` — Expected: clean; 33 pass (no new node-testable logic in this task).

- [ ] **Step 6: Visual verification**

With wrangler + Metro up, cold-start `exp://127.0.0.1:8081/--/ledger` (see Global Constraints for the exact terminate/openurl/screenshot recipe) and Read the screenshot: plaque renders with an epithet (this device likely shows THE UNREAD), receipt, six stat rows, liturgy footer. Then cold-start home and confirm both quiet links render.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/api/hooks.ts apps/mobile/src/app/ledger.tsx apps/mobile/src/app/index.tsx apps/mobile/src/ui/ShareCard.tsx
git commit -m "feat(mobile): forecaster's ledger plaque + liturgy placements"
```

---

### Task 6: Plaque share card (mobile)

**Files:**
- Modify: `apps/mobile/src/ui/ShareCard.tsx` (export `RegisterMarks`, `NIGHT_LINE`, `NIGHT_DIM`; add `shareSnapshot`)
- Create: `apps/mobile/src/ui/PlaqueShareCard.tsx`
- Modify: `apps/mobile/src/app/ledger.tsx` (mount canvas + share button)

**Interfaces:**
- Consumes: `MeLedger` (Task 4 shape), `LITURGY_LINES`, `PatinaHalo` from `./TerminalPatina`, exports added to ShareCard.
- Produces: `PlaqueShareCanvas({ canvasRef, data: MeLedger })`; `shareSnapshot(ref, filename, dialogTitle): Promise<void>`.

- [ ] **Step 1: Generalize sharing + export card chrome**

In `apps/mobile/src/ui/ShareCard.tsx`:
- Change `function RegisterMarks()` to `export function RegisterMarks()`; change `const NIGHT_LINE`/`const NIGHT_DIM` to `export const NIGHT_LINE`/`export const NIGHT_DIM`.
- Add above `shareCard`:

```ts
export async function shareSnapshot(ref: RefObject<any>, filename: string, dialogTitle: string): Promise<void> {
  const image = ref.current?.makeImageSnapshot();
  if (!image) throw new Error("card not ready");
  const bytes = image.encodeToBytes();
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: "image/png", dialogTitle });
}
```

- Rewrite `shareCard`'s body to delegate: `await shareSnapshot(ref, `oracle-${data.date}.png`, shareMessage(data));`

- [ ] **Step 2: The plaque canvas**

Create `apps/mobile/src/ui/PlaqueShareCard.tsx`:

```tsx
import { Canvas, Fill, Line, Rect, Text as SkText, Image as SkImage, vec, useCanvasRef, useFont, useImage } from "@shopify/react-native-skia";
import type { MeLedger } from "@oracle/core";
import { LITURGY_LINES } from "@oracle/core";
import { colors } from "../theme";
import { PatinaHalo } from "./TerminalPatina";
import { RegisterMarks, NIGHT_LINE, NIGHT_DIM } from "./ShareCard";

// The plaque, sent into the night realm: epithet, receipt, the record, the
// liturgy. Same 5:8 card anatomy as the daily share.
export const PLAQUE_W = 640;
export const PLAQUE_H = 1024;
const INSET = 30;

function centered(font: { measureText(t: string): { width: number } } | null, text: string): number {
  return font ? (PLAQUE_W - font.measureText(text).width) / 2 : PLAQUE_W / 2;
}

export function PlaqueShareCanvas({ canvasRef, data }: { canvasRef: ReturnType<typeof useCanvasRef>; data: MeLedger }) {
  const orb = useImage(require("../../assets/art/orb.png"));
  const ritual = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 44);
  const receiptFont = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 16);
  const mono = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 18);
  const monoSmall = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 12);

  const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
  const statLines = [
    `DAYS CONSULTED ${data.days_consulted} · VIGIL ${data.streak}`,
    `ACCURACY ${pct(data.accuracy_pct)} · CONVICTION ${pct(data.avg_confidence)}`,
    `AGAINST THE TIDE x${data.tide_wins}`,
  ];

  return (
    <Canvas ref={canvasRef} style={{ position: "absolute", left: -9999, top: 0, width: PLAQUE_W, height: PLAQUE_H }}>
      <Fill color={colors.midnightMuseum} />
      <Rect x={INSET + 0.5} y={INSET + 0.5} width={PLAQUE_W - 2 * INSET - 1} height={PLAQUE_H - 2 * INSET - 1} style="stroke" strokeWidth={1} color={NIGHT_LINE} />
      <RegisterMarks />
      {mono && <SkText font={mono} text="THE FORECASTER'S LEDGER" x={centered(mono, "THE FORECASTER'S LEDGER")} y={110} color={colors.agedGold} />}
      <Line p1={vec(INSET + 40, 140)} p2={vec(PLAQUE_W - INSET - 40, 140)} color={NIGHT_LINE} strokeWidth={1} />
      <PatinaHalo x={PLAQUE_W / 2 - 190} y={330 - 190} width={380} height={380} center={[PLAQUE_W / 2, 330]} innerR={130} outerR={172} seed={[...data.epithet.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 97} />
      {orb && <SkImage image={orb} x={PLAQUE_W / 2 - 145} y={185} width={290} height={290} fit="contain" />}
      {ritual && <SkText font={ritual} text={data.epithet.title} x={centered(ritual, data.epithet.title)} y={600} color={colors.museumWhite} />}
      {receiptFont && <SkText font={receiptFont} text={data.epithet.receipt} x={centered(receiptFont, data.epithet.receipt)} y={644} color={colors.agedGold} />}
      {mono && statLines.map((line, i) => (
        <SkText key={line} font={mono} text={line} x={centered(mono, line)} y={730 + i * 34} color={NIGHT_DIM} />
      ))}
      <Line p1={vec(INSET + 40, 880)} p2={vec(PLAQUE_W - INSET - 40, 880)} color={NIGHT_LINE} strokeWidth={1} />
      {mono && <SkText font={mono} text="CAN YOU OUTSEE ME?" x={centered(mono, "CAN YOU OUTSEE ME?")} y={926} color={colors.agedGold} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[0]} x={centered(monoSmall, LITURGY_LINES[0])} y={960} color={NIGHT_DIM} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[1]} x={centered(monoSmall, LITURGY_LINES[1])} y={978} color={NIGHT_DIM} />}
    </Canvas>
  );
}
```

Note the tide stat uses ASCII `x`, not `×` — Skia has no font fallback. Longest epithet title "TRUE BELIEVER OF THE CROWD" at Cinzel 44 must fit 580px; if `ritual.measureText` shows overflow during verification, drop the size to 38 — do not ellipsize an epithet.

- [ ] **Step 3: Wire into the ledger screen**

In `apps/mobile/src/app/ledger.tsx`:
- Imports: `import { useState } from "react";`, `import { useCanvasRef } from "@shopify/react-native-skia";`, `import { GoldButton } from "../ui/Button";`, `import { PlaqueShareCanvas } from "../ui/PlaqueShareCard";`, `import { shareSnapshot } from "../ui/ShareCard";`
- Inside `Ledger` (top, before the early return): `const canvasRef = useCanvasRef();` and `const [sharing, setSharing] = useState(false);`
- After the liturgy block inside the main `<View>`, add:

```tsx
        <GoldButton
          title={sharing ? "PREPARING…" : "DECLARE YOURSELF"}
          onPress={async () => {
            setSharing(true);
            try { await shareSnapshot(canvasRef, "oracle-plaque.png", d.epithet.title); } catch {} finally { setSharing(false); }
          }}
        />
        <PlaqueShareCanvas canvasRef={canvasRef} data={d} />
```

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test` — Expected: clean; all pass.

- [ ] **Step 5: Visual verification**

Temporarily change PlaqueShareCanvas's Canvas style to `{ position: "absolute", left: 0, top: 0, width: PLAQUE_W, height: PLAQUE_H, transform: [{ scale: 0.55 }], transformOrigin: "top left", zIndex: 99 }`, cold-start `/--/ledger`, screenshot, Read it: night plaque with orb + patina halo, epithet, receipt, stats, liturgy — nothing colliding, patina clear of all text. REVERT the temp edit (`git diff` shows only intended changes), cold-start once to confirm the plaque screen is back to normal.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/ui/ShareCard.tsx apps/mobile/src/ui/PlaqueShareCard.tsx apps/mobile/src/app/ledger.tsx
git commit -m "feat(mobile): plaque share card — declare yourself"
```

---

### Task 7: Hinge-push composition + no-op sender (API, TDD)

**Files:**
- Create: `apps/api/src/push/compose.ts`
- Create: `apps/api/src/push/onesignal.ts`
- Test: `apps/api/test/compose.test.ts` (create)

**Interfaces:**
- Consumes: `COPY_BANK`, `selectLine`, `fillSlots`, `type Requirement`, `CONTRARIAN_CROWD_PCT` from `@oracle/core`; `Db`/`schema` from `../db/client`.
- Produces: `composeHingePushes(db: Db, date: string): Promise<Array<{ userId: string; lineId: string; text: string }>>`; `sendPushes(env: { ONESIGNAL_APP_ID?: string; ONESIGNAL_API_KEY?: string }, pushes: ReadonlyArray<{ userId: string; text: string }>): Promise<{ sent: number; skipped: number }>`. The TRIGGER (cron / round-resolve orchestration) is Plan-4 work — nothing calls these in production yet, and that is intentional.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/compose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb, seedRound } from "./helpers/db";
import { resolveQuestion } from "../src/resolution";
import { composeHingePushes } from "../src/push/compose";
import { sendPushes } from "../src/push/onesignal";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };

async function player(app: ReturnType<typeof createApp>) {
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  return (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
}
const body = (q: string, answer: boolean) => JSON.stringify({ question_id: q, answer, confidence: 85, idempotency_key: "k" });

describe("composeHingePushes", () => {
  it("tiers players: results for the sealed, lapsed for the absent; text is slot-free", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const [a, b, c] = [await player(app), await player(app), await player(app)];
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await b("/v1/predictions", { method: "POST", body: body(qs[0]!.id, false) });
    await c("/v1/predictions", { method: "POST", body: body(qs[1]!.id, true) }); // never touches q0; c IS a player
    await resolveQuestion(db, qs[0]!.id, "yes");
    await resolveQuestion(db, qs[1]!.id, "yes");

    const pushes = await composeHingePushes(db, "2026-08-20");
    expect(pushes).toHaveLength(3);
    for (const p of pushes) {
      expect(p.text).not.toMatch(/[{}]/);
      expect(p.lineId.startsWith("noon.")).toBe(true);
      expect(p.lineId.startsWith("noon.lapsed")).toBe(false); // all three played this round
    }
    // a was wrong nowhere (crowd 33% yes, outcome yes): no {n}-line with n=0
    const aPush = pushes.find((p) => p.text.includes("0 OF YOUR"));
    expect(aPush).toBeUndefined();
  });

  it("gives users with no prediction this round the lapsed tier", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const qs = await seedRound(db, { date: "2026-08-20", opensAt: new Date("2026-08-20T16:00:00Z"), locksAt: new Date("2026-08-21T16:00:00Z") });
    const a = await player(app);
    await player(app); // registered, never played
    await a("/v1/predictions", { method: "POST", body: body(qs[0]!.id, true) });
    await resolveQuestion(db, qs[0]!.id, "no");

    const pushes = await composeHingePushes(db, "2026-08-20");
    expect(pushes).toHaveLength(2);
    const lapsed = pushes.filter((p) => p.lineId.startsWith("noon.lapsed"));
    expect(lapsed).toHaveLength(1);
  });
});

describe("sendPushes", () => {
  it("no-ops cleanly without OneSignal keys", async () => {
    const out = await sendPushes({}, [{ userId: "u1", text: "THE LEDGER IS READ." }]);
    expect(out).toEqual({ sent: 0, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @oracle/api test` — Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/push/compose.ts`:

```ts
import { eq, inArray } from "drizzle-orm";
import { COPY_BANK, CONTRARIAN_CROWD_PCT, fillSlots, selectLine, type Requirement } from "@oracle/core";
import { schema, type Db } from "../db/client";

// The hinge push (voice spec §4): one line per user when the round resolves.
// Deterministic — selectLine hashes userId+date, so a re-run composes the
// identical batch (safe to retry). The TRIGGER is Plan-4 cron work; nothing
// in production calls this yet.
const NOON = COPY_BANK.filter((l) => l.pool === "noon");
const NOON_PLAYED = NOON.filter((l) => !l.requires?.includes("lapsed"));
const NOON_LAPSED = NOON.filter((l) => l.requires?.includes("lapsed"));

export async function composeHingePushes(db: Db, date: string) {
  const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, date) });
  const resolved = qs.filter((q) => q.outcome !== null && q.outcome !== "void");
  const preds = qs.length
    ? await db.query.predictions.findMany({ where: inArray(schema.predictions.questionId, qs.map((q) => q.id)) })
    : [];
  const users = await db.query.users.findMany();
  const qById = new Map(qs.map((q) => [q.id, q]));
  const byUser = new Map<string, typeof preds>();
  for (const p of preds) {
    const list = byUser.get(p.userId) ?? [];
    list.push(p);
    byUser.set(p.userId, list);
  }

  const out: Array<{ userId: string; lineId: string; text: string }> = [];
  for (const u of users) {
    const mine = byUser.get(u.id) ?? [];
    const seedKey = `${u.id}:${date}`;
    if (mine.length === 0) {
      const line = selectLine(NOON_LAPSED, seedKey, ["lapsed"]);
      if (line) out.push({ userId: u.id, lineId: line.id, text: fillSlots(line.text, {}) });
      continue;
    }
    let wrong = 0;
    let tideWin = false;
    for (const p of mine) {
      const q = qById.get(p.questionId);
      if (!q || q.outcome === null || q.outcome === "void") continue;
      const correct = p.answer === (q.outcome === "yes");
      if (!correct) wrong++;
      const crowd = q.crowdYesPct === null ? null : Number(q.crowdYesPct);
      const sidePct = crowd === null ? null : p.answer ? crowd : 100 - crowd;
      if (correct && sidePct !== null && sidePct < CONTRARIAN_CROWD_PCT) tideWin = true;
    }
    const hasResults = resolved.length > 0;
    const satisfied: Requirement[] = [];
    if (hasResults) satisfied.push("results");
    if (tideWin) satisfied.push("tideWin");
    if (u.streakCurrent >= 2) satisfied.push("streak");
    // a "{n} DID NOT SURVIVE" line with n=0 is true but absurd — gate it out
    const pool = wrong === 0 ? NOON_PLAYED.filter((l) => !l.text.includes("{n}")) : NOON_PLAYED;
    const line = selectLine(pool, seedKey, satisfied);
    if (line) out.push({ userId: u.id, lineId: line.id, text: fillSlots(line.text, { n: wrong, streak: u.streakCurrent }) });
  }
  return out;
}
```

Create `apps/api/src/push/onesignal.ts`:

```ts
// Thin OneSignal REST sender. No keys → clean no-op (the voice exists in-app
// regardless; spec §7). Live sends are hand-verified once EAS builds + keys
// exist — do not attempt to unit-test the HTTP path.
export async function sendPushes(
  env: { ONESIGNAL_APP_ID?: string; ONESIGNAL_API_KEY?: string },
  pushes: ReadonlyArray<{ userId: string; text: string }>,
): Promise<{ sent: number; skipped: number }> {
  if (!env.ONESIGNAL_APP_ID || !env.ONESIGNAL_API_KEY) return { sent: 0, skipped: pushes.length };
  let sent = 0;
  for (const p of pushes) {
    const res = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${env.ONESIGNAL_API_KEY}` },
      body: JSON.stringify({
        app_id: env.ONESIGNAL_APP_ID,
        include_aliases: { external_id: [p.userId] },
        target_channel: "push",
        contents: { en: p.text },
      }),
    });
    if (res.ok) sent++;
  }
  return { sent, skipped: pushes.length - sent };
}
```

- [ ] **Step 4: Run to verify green**

Run: `pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck` — Expected: all pass, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/push apps/api/test/compose.test.ts
git commit -m "feat(api): hinge-push composition + no-op onesignal sender"
```

---

### Task 8: Full-pass verification + evidence

**Files:**
- Create: `docs/superpowers/plans/assets/machine-voice/` (screenshots)

- [ ] **Step 1: Clean state**

Run: `pnpm --filter @oracle/core test && pnpm --filter @oracle/core typecheck && pnpm --filter @oracle/api test && pnpm --filter @oracle/api typecheck && pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test && git status --porcelain`
Expected: everything green (core 34+~19, api 21+~5, mobile 33), no stray edits.

- [ ] **Step 2: Capture evidence**

Into `docs/superpowers/plans/assets/machine-voice/` (mkdir -p), reusing Task 5/6 recipes (with mandatory reverts of any temp onscreen edit):
- `plaque.png` — the ledger screen (epithet + receipt + stats + liturgy)
- `plaque-share.png` — the night plaque canvas temp-onscreen
- `home-links.png` — home with both quiet links
After reverts: `git status --porcelain` shows ONLY the new PNGs; cold-start home once to leave the simulator in the real state.

- [ ] **Step 3: Commit evidence**

```bash
git add docs/superpowers/plans/assets/machine-voice/
git commit -m "chore(mobile): machine-voice evidence"
```

- [ ] **Step 4: Hand-test handoff**

Report what needs a human hand or later infra: (1) the plaque share sheet on a real tap; (2) live OneSignal sends (needs keys + EAS dev build + the Plan-4 cron trigger); (3) the permission interstitial (deliberately out of this plan — lands with the OneSignal SDK in the EAS build plan); (4) streakCurrent is real once Plan 3's streak settlement wires `settleStreak` into resolution — until then UNSHAKEN/vigil lines simply don't fire.

---

## Self-Review Notes

- **Spec coverage:** §2 guardrails → lint (T1); §3 bank+lint → T1, selection → T2; §4 hinge tiers + n=0 gate + deterministic retry → T7 (trigger deferred per Global Constraints, spec §9 order kept); §5 liturgy → T1 constant, T5 placements (App Store/site copy is outside the repo — hand item); §6 epithets/receipts/endpoint/plaque/share → T3/T4/T5/T6; §7 failure handling → no-op sender, generic-line fallback (T7), UNREAD-not-apology (T5); §8 testing map → matches tasks.
- **Type consistency:** `CopyLine`/`Requirement`/`fillSlots`/`selectLine` names identical across T1/T2/T7; `EpithetInput`/`assignEpithet` across T3/T4; `MeLedger` across T4/T5/T6; `shareSnapshot` across T6 steps.
- **Placeholder scan:** none — full copy bank, full rule table, full route math inline.
- **Known deviation from spec:** Requirement union uses `players`/`lapsed` instead of the spec's unused `epithet` slot (YAGNI); spec §4's closing-call audience query ships with the Plan-4 trigger, since audience selection without a scheduler is dead code.
