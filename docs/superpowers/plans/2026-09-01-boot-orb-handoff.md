# Boot → Home Orb Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On cold start the orb is the one object that persists from the boot rite into Home — it sits as a still in the boot field, rises to Home's measured hero position as the field fades, and wakes (starts its loop) on landing while the hands enter around it.

**Architecture:** `LivingHero` becomes a stage of independently positioned layers (glow, dust, two hands, orb) driven by a `phase` prop. Home measures the orb slot's window rect and publishes it through `bootGate`; `BootRite` renders a still orb at the same size, and on `done` translates it to the published anchor, then signals `orbLanded`, at which point Home mounts its own orb (frame 0 = the still) and cues title/epigraph on timers. No anchor (deep link, not yet measured) → today's plain fade.

**Tech Stack:** Expo SDK 57 (`expo-image` ~57.0.3 animated WebP, `autoplay`), react-native-reanimated 4.5.1 (`useSharedValue`, `withTiming`, `withDelay`, `runOnJS`, `useAnimatedStyle`), @shopify/react-native-skia 2.6.2 (existing glow + dust), vitest for pure TS units, libwebp CLI (`img2webp`, `webpmux`) + ffmpeg for placeholder assets.

**Spec:** `docs/superpowers/specs/2026-09-01-boot-orb-handoff-design.md`

## Global Constraints

- Expo SDK 57: read https://docs.expo.dev/versions/v57.0.0/ before writing Expo API calls (repo `AGENTS.md`). `expo-image` animated props available: `autoplay` (default true), `startAnimating()`, `stopAnimating()`, `onDisplay`. There is no seek, no onEnd, no loop-count prop.
- Reduced motion: the rite never mounts; Home shows the graded still `creation-hands-orb.jpg` with no glow (unchanged).
- Hero footprint on Home is unchanged: `w = window width`, `h = w / (1000 / 562)`. Nothing else on Home may move.
- The stage's orb center is `(0.50, 0.47)` of the stage; orb tile diameter is `290 / 562` of stage height; hand slots are `345 / 1000` of stage width, full height (measured from `hero-loop.webp` frame 0).
- Brand brief §4: ASCII never obscures anatomy — hands and orb paint over the dust.
- Reanimated helpers called from a worklet need `"worklet"`; callbacks into React state from `withTiming` completion go through `runOnJS` (see `src/ui/OracleCard.tsx` for the house pattern).
- Vitest only runs `test/**/*.test.ts` (pure TS, no RN renderer). Components are verified by `tsc` and on device.
- Every commit in this plan stages **only the files named in its task**. The working tree contains unrelated uncommitted work (`apps/api/...`, `apps/mobile/app.json`, `eas.json`, `package.json`, `pnpm-lock.yaml`, docs) — never `git add -A` / `git add .`.
- Commit messages end with the trailer line: `Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ`
- All paths below are relative to the repo root `/Users/eriktaheri/Development/oracle`; run `pnpm`/`npx` commands from `apps/mobile`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/mobile/assets/art/orb-loop.webp` (new) | Placeholder orb tile: crop of `hero-loop.webp`, animated, alpha, infinite loop |
| `apps/mobile/assets/art/hand-left-loop.webp`, `hand-right-loop.webp` (new) | Placeholder hand slots: crops of `hero-loop.webp` |
| `apps/mobile/src/game/heroStage.ts` (new) | Pure stage geometry: aspect, orb rect, hand slots for a given width. Tested. |
| `apps/mobile/src/game/bootGate.ts` (modify) | Adds `orbLanded` phase + hero anchor pub/sub + sync getters. Tested. |
| `apps/mobile/src/game/heroCues.ts` (new) | Pure cue scheduler: title/epigraph delays after landing. Tested. |
| `apps/mobile/src/ui/useHeroCues.ts` (new) | Hook wrapping `heroCues` into `{ title, epigraph }` booleans |
| `apps/mobile/src/ui/OrbLayer.tsx` (new) | The orb tile `Image`; `playing` → `autoplay` |
| `apps/mobile/src/ui/HandLayer.tsx` (new) | One hand slot `Image` with Reanimated edge entrance |
| `apps/mobile/src/ui/LivingHero.tsx` (modify) | Becomes the layered stage; `phase` prop; publishes the anchor |
| `apps/mobile/src/ui/BootRite.tsx` (modify) | Still orb + dust group; slide to anchor on `done`; fallback fade |
| `apps/mobile/src/ui/CallingRite.tsx` (modify, 1 line) | Also marks `orbLanded` when it ends |
| `apps/mobile/src/app/index.tsx` (modify) | Derives `phase`, uses `useHeroCues` for title/epigraph |
| `apps/mobile/test/heroStage.test.ts`, `test/heroCues.test.ts` (new), `test/bootGate.test.ts` (modify) | Unit tests |

---

### Task 0: Commit the already-approved dust work

The working tree has approved, uncommitted changes from the same session (gold dust on the rites, per-cell dust clock, spec text). Commit them first so every later diff is clean.

**Files:**
- Commit: `apps/mobile/src/ui/TerminalPatina.tsx`, `apps/mobile/src/ui/BootRite.tsx`, `apps/mobile/src/ui/CallingRite.tsx`, `docs/superpowers/specs/2026-08-26-terminal-patina-shader.md`, `docs/superpowers/specs/2026-09-01-boot-orb-handoff-design.md`, `docs/superpowers/plans/2026-09-01-boot-orb-handoff.md`

- [ ] **Step 1: Confirm the diff is only the dust work**

Run from repo root: `git diff --stat -- apps/mobile/src/ui docs/superpowers/specs/2026-08-26-terminal-patina-shader.md`
Expected: exactly `BootRite.tsx`, `CallingRite.tsx`, `TerminalPatina.tsx`, and the patina spec. If anything else appears under `apps/mobile/src/ui`, stop and report.

- [ ] **Step 2: Typecheck and test**

Run from `apps/mobile`: `npx tsc --noEmit -p . && npx vitest run`
Expected: tsc exit 0; `Tests 120 passed`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/TerminalPatina.tsx apps/mobile/src/ui/BootRite.tsx apps/mobile/src/ui/CallingRite.tsx docs/superpowers/specs/2026-08-26-terminal-patina-shader.md docs/superpowers/specs/2026-09-01-boot-orb-handoff-design.md docs/superpowers/plans/2026-09-01-boot-orb-handoff.md
git commit -m "feat(mobile): atmospheric dust ticks per cell, gold on the rites; boot→home orb handoff spec + plan

Per-cell dwell (2–6s, hashed) replaces the 3 Hz whole-field re-roll that read
as flashing. Boot/Calling rites tint the dust text-gold at 0.7 so it is
visible on museum white.

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 1: Placeholder assets — split the hero loop into orb and hand tiles

**Files:**
- Create: `apps/mobile/assets/art/orb-loop.webp`, `apps/mobile/assets/art/hand-left-loop.webp`, `apps/mobile/assets/art/hand-right-loop.webp`
- Source (unchanged for now): `apps/mobile/assets/art/hero-loop.webp` (1000×562, 118 frames, 83ms each, alpha, loop 0)

**Interfaces:**
- Produces: three animated WebP files with alpha, 118 frames @ 83ms, infinite loop. Dimensions: orb 290×290, hands 345×562 each. Later tasks `require()` them by these exact paths.

- [ ] **Step 1: Extract cropped PNG frame sequences**

Run from `apps/mobile` (scratch dir is session-specific; any temp dir works):

```bash
S=/private/tmp/claude-501/-Users-eriktaheri-Development-oracle/e0aa3d92-5605-40fe-8c29-fa5b94294f3f/scratchpad/tiles
mkdir -p $S/orb $S/left $S/right
ffmpeg -v error -y -i assets/art/hero-loop.webp -vf "crop=290:290:355:120" $S/orb/%03d.png
ffmpeg -v error -y -i assets/art/hero-loop.webp -vf "crop=345:562:0:0"     $S/left/%03d.png
ffmpeg -v error -y -i assets/art/hero-loop.webp -vf "crop=345:562:655:0"   $S/right/%03d.png
ls $S/orb | wc -l; ls $S/left | wc -l; ls $S/right | wc -l
```
Expected: `118` three times.

- [ ] **Step 2: Assemble animated WebPs**

```bash
img2webp -loop 0 -d 83 -lossy -q 80 $S/orb/*.png   -o assets/art/orb-loop.webp
img2webp -loop 0 -d 83 -lossy -q 80 $S/left/*.png  -o assets/art/hand-left-loop.webp
img2webp -loop 0 -d 83 -lossy -q 80 $S/right/*.png -o assets/art/hand-right-loop.webp
```

- [ ] **Step 3: Verify alpha, frame count, dimensions, loop**

```bash
for f in orb-loop hand-left-loop hand-right-loop; do echo "== $f"; webpmux -info assets/art/$f.webp | sed -n 1,4p; done
ls -la assets/art/*.webp
```
Expected per file: `Features present: animation transparency`, `Loop Count : 0`, `Number of frames: 118`; canvas `290 x 290` for orb and `345 x 562` for hands. Each file well under 2 MB (source is 2.8 MB for the full frame).

- [ ] **Step 4: Eyeball one frame of each tile**

```bash
ffmpeg -v error -y -i assets/art/orb-loop.webp -frames:v 1 $S/orb-check.png
ffmpeg -v error -y -i assets/art/hand-left-loop.webp -frames:v 1 $S/left-check.png
```
Open both PNGs (Read tool). Expected: orb tile shows the full sphere with a small transparent margin, no hand pixels; left tile shows the marble hand only, no orb pixels.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/assets/art/orb-loop.webp apps/mobile/assets/art/hand-left-loop.webp apps/mobile/assets/art/hand-right-loop.webp
git commit -m "chore(mobile): placeholder orb and hand tiles cropped from the hero loop

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 2: Stage geometry (`heroStage.ts`)

**Files:**
- Create: `apps/mobile/src/game/heroStage.ts`
- Test: `apps/mobile/test/heroStage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const STAGE_ASPECT: number;          // 1000 / 562
  export const ORB_CX: number;                // 0.5
  export const ORB_CY: number;                // 0.47
  export const ORB_TILE_RATIO: number;        // 290 / 562 — tile diameter / stage height
  export const HAND_SLOT_RATIO: number;       // 345 / 1000 — slot width / stage width
  export const DUST_RATIO: number;            // 1.15 — dust canvas size / stage height (matches today's LivingHero)
  export type Rect = { x: number; y: number; w: number; h: number };
  export function stageSize(width: number): { w: number; h: number };
  export function orbRect(width: number): Rect;                 // square tile, centered on (ORB_CX, ORB_CY)
  export function dustRect(width: number): Rect;                // square, centered on the same point
  export function handSlot(width: number, side: "left" | "right"): Rect;
  export function handOffscreenX(width: number, side: "left" | "right"): number; // translateX that hides the slot beyond its edge
  ```

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/heroStage.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  STAGE_ASPECT, ORB_TILE_RATIO, HAND_SLOT_RATIO, DUST_RATIO,
  stageSize, orbRect, dustRect, handSlot, handOffscreenX,
} from "../src/game/heroStage";

const W = 1000; // stage width equal to the source frame makes expectations readable

describe("heroStage", () => {
  it("keeps the hero footprint of the source frame", () => {
    expect(stageSize(W)).toEqual({ w: 1000, h: 1000 / STAGE_ASPECT });
    expect(stageSize(W).h).toBeCloseTo(562, 5);
  });

  it("centers the orb tile on (0.50, 0.47) with the measured diameter", () => {
    const r = orbRect(W);
    expect(r.w).toBeCloseTo(290, 5);
    expect(r.h).toBeCloseTo(290, 5);
    expect(r.x + r.w / 2).toBeCloseTo(500, 5);
    expect(r.y + r.h / 2).toBeCloseTo(562 * 0.47, 5);
    expect(ORB_TILE_RATIO).toBeCloseTo(290 / 562, 10);
  });

  it("centers the dust on the orb at 1.15× stage height", () => {
    const d = dustRect(W);
    const o = orbRect(W);
    expect(d.w).toBeCloseTo(562 * DUST_RATIO, 5);
    expect(d.x + d.w / 2).toBeCloseTo(o.x + o.w / 2, 5);
    expect(d.y + d.h / 2).toBeCloseTo(o.y + o.h / 2, 5);
  });

  it("places hand slots flush to their edges, full height", () => {
    expect(HAND_SLOT_RATIO).toBeCloseTo(345 / 1000, 10);
    expect(handSlot(W, "left")).toEqual({ x: 0, y: 0, w: 345, h: 1000 / STAGE_ASPECT });
    const right = handSlot(W, "right");
    expect(right.x).toBeCloseTo(655, 5);
    expect(right.w).toBeCloseTo(345, 5);
  });

  it("offscreen offsets push each slot fully past its own edge", () => {
    expect(handOffscreenX(W, "left")).toBeLessThanOrEqual(-345);
    expect(handOffscreenX(W, "right")).toBeGreaterThanOrEqual(345);
  });

  it("scales linearly with width", () => {
    const a = orbRect(390);
    const b = orbRect(780);
    expect(b.w).toBeCloseTo(a.w * 2, 5);
    expect(b.x).toBeCloseTo(a.x * 2, 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run from `apps/mobile`: `npx vitest run test/heroStage.test.ts`
Expected: FAIL — cannot resolve `../src/game/heroStage`.

- [ ] **Step 3: Implement**

`apps/mobile/src/game/heroStage.ts`:
```ts
// Stage geometry for the layered hero (spec 2026-09-01-boot-orb-handoff).
// Fractions are measured from hero-loop.webp frame 0 (1000×562): the orb is a
// clean circle centered at (500, 265), r≈135; the hands never cross x=345 /
// x=655. Everything is a pure function of the stage width so Home and the
// boot rite compute identical rects from the same window width.
export const STAGE_ASPECT = 1000 / 562;
export const ORB_CX = 0.5;
export const ORB_CY = 0.47;
export const ORB_TILE_RATIO = 290 / 562;
export const HAND_SLOT_RATIO = 345 / 1000;
export const DUST_RATIO = 1.15;

export type Rect = { x: number; y: number; w: number; h: number };

export function stageSize(width: number): { w: number; h: number } {
  return { w: width, h: width / STAGE_ASPECT };
}

function centeredSquare(width: number, ratioOfHeight: number): Rect {
  const { w, h } = stageSize(width);
  const size = h * ratioOfHeight;
  return { x: w * ORB_CX - size / 2, y: h * ORB_CY - size / 2, w: size, h: size };
}

export function orbRect(width: number): Rect {
  return centeredSquare(width, ORB_TILE_RATIO);
}

export function dustRect(width: number): Rect {
  return centeredSquare(width, DUST_RATIO);
}

export function handSlot(width: number, side: "left" | "right"): Rect {
  const { w, h } = stageSize(width);
  const slotW = w * HAND_SLOT_RATIO;
  return { x: side === "left" ? 0 : w - slotW, y: 0, w: slotW, h };
}

// translateX that parks a hand slot entirely beyond its own screen edge (with
// a little slack so antialiased fringes never peek).
export function handOffscreenX(width: number, side: "left" | "right"): number {
  const slotW = stageSize(width).w * HAND_SLOT_RATIO * 1.1;
  return side === "left" ? -slotW : slotW;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/heroStage.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/heroStage.ts apps/mobile/test/heroStage.test.ts
git commit -m "feat(mobile): hero stage geometry — orb, dust, hand slot rects from stage width

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 3: Boot gate phases and hero anchor

**Files:**
- Modify: `apps/mobile/src/game/bootGate.ts`
- Test: `apps/mobile/test/bootGate.test.ts`

**Interfaces:**
- Consumes: `Rect` from `src/game/heroStage.ts` (Task 2).
- Produces (all module-level, once per process):
  ```ts
  export function markBootDone(): void;                      // unchanged
  export function onBootDone(cb: () => void): () => void;    // unchanged
  export function isBootDone(): boolean;                     // new, sync
  export function markOrbLanded(): void;                     // new
  export function onOrbLanded(cb: () => void): () => void;   // new, same contract as onBootDone
  export function isOrbLanded(): boolean;                    // new, sync
  export function setHeroAnchor(rect: Rect): void;           // new — orb tile rect in WINDOW coords
  export function getHeroAnchor(): Rect | null;              // new
  export function resetBootGateForTest(): void;              // clears all of the above
  ```

- [ ] **Step 1: Add failing tests**

Append to `apps/mobile/test/bootGate.test.ts` (update the import line to include the new names):
```ts
import {
  markBootDone, onBootDone, isBootDone,
  markOrbLanded, onOrbLanded, isOrbLanded,
  setHeroAnchor, getHeroAnchor, resetBootGateForTest,
} from "../src/game/bootGate";
```
and add these describes below the existing one:
```ts
describe("bootGate: orbLanded phase", () => {
  beforeEach(() => resetBootGateForTest());

  it("is independent of bootDone", () => {
    markBootDone();
    expect(isBootDone()).toBe(true);
    expect(isOrbLanded()).toBe(false);
  });

  it("defers callbacks until the orb lands", () => {
    const cb = vi.fn();
    onOrbLanded(cb);
    expect(cb).not.toHaveBeenCalled();
    markOrbLanded();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(isOrbLanded()).toBe(true);
  });

  it("fires immediately once already landed, is idempotent, honors unsubscribe", () => {
    markOrbLanded();
    const late = vi.fn();
    onOrbLanded(late);
    expect(late).toHaveBeenCalledTimes(1);
    markOrbLanded();
    expect(late).toHaveBeenCalledTimes(1);

    resetBootGateForTest();
    const cb = vi.fn();
    const off = onOrbLanded(cb);
    off();
    markOrbLanded();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("bootGate: hero anchor", () => {
  beforeEach(() => resetBootGateForTest());

  it("is null until published", () => {
    expect(getHeroAnchor()).toBeNull();
  });

  it("returns the latest published rect", () => {
    setHeroAnchor({ x: 10, y: 20, w: 100, h: 100 });
    setHeroAnchor({ x: 12, y: 300, w: 100, h: 100 });
    expect(getHeroAnchor()).toEqual({ x: 12, y: 300, w: 100, h: 100 });
  });

  it("is cleared by reset", () => {
    setHeroAnchor({ x: 1, y: 2, w: 3, h: 3 });
    resetBootGateForTest();
    expect(getHeroAnchor()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/bootGate.test.ts`
Expected: FAIL — `isBootDone`/`markOrbLanded`/… are not exported.

- [ ] **Step 3: Implement**

Replace `apps/mobile/src/game/bootGate.ts` with:
```ts
import type { Rect } from "./heroStage";

// The boot gate: module-level phase signals for the once-per-process boot
// rite (spec 2026-09-01-boot-orb-handoff).
//   bootDone  — the rite's hold elapsed; the field is fading. Home's bottom
//               DecodeLines print now, so the static resolves in view.
//   orbLanded — the rite's orb has arrived at Home's anchor (or there was no
//               slide). Home mounts its own orb and cues title/epigraph.
// Plus the hero anchor: the orb tile's rect in window coordinates, published
// by Home whenever its layout settles, read once by the rite at `done`.

type Signal = { fired: boolean; listeners: Set<() => void> };
const bootDone: Signal = { fired: false, listeners: new Set() };
const orbLanded: Signal = { fired: false, listeners: new Set() };
let heroAnchor: Rect | null = null;

function fire(s: Signal): void {
  if (s.fired) return;
  s.fired = true;
  s.listeners.forEach((l) => l());
  s.listeners.clear();
}

// Calls cb immediately if already fired; otherwise on fire. Returns unsubscribe.
function listen(s: Signal, cb: () => void): () => void {
  if (s.fired) {
    cb();
    return () => {};
  }
  s.listeners.add(cb);
  return () => s.listeners.delete(cb);
}

export function markBootDone(): void { fire(bootDone); }
export function onBootDone(cb: () => void): () => void { return listen(bootDone, cb); }
export function isBootDone(): boolean { return bootDone.fired; }

export function markOrbLanded(): void { fire(orbLanded); }
export function onOrbLanded(cb: () => void): () => void { return listen(orbLanded, cb); }
export function isOrbLanded(): boolean { return orbLanded.fired; }

export function setHeroAnchor(rect: Rect): void { heroAnchor = rect; }
export function getHeroAnchor(): Rect | null { return heroAnchor; }

// Test seam only.
export function resetBootGateForTest(): void {
  for (const s of [bootDone, orbLanded]) { s.fired = false; s.listeners.clear(); }
  heroAnchor = null;
}
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npx tsc --noEmit -p .`
Expected: all pass (existing 4 bootGate tests + 6 new + others); tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/bootGate.ts apps/mobile/test/bootGate.test.ts
git commit -m "feat(mobile): boot gate grows an orbLanded phase and a hero anchor

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 4: Hero cue scheduler + hook

**Files:**
- Create: `apps/mobile/src/game/heroCues.ts`, `apps/mobile/src/ui/useHeroCues.ts`
- Test: `apps/mobile/test/heroCues.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/game/heroCues.ts
  export const TITLE_CUE_MS = 350;
  export const EPIGRAPH_CUE_MS = 850;
  export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void };
  export function scheduleHeroCues(onTitle: () => void, onEpigraph: () => void, timers?: Timers): () => void; // returns cancel
  // src/ui/useHeroCues.ts
  export function useHeroCues(landed: boolean): { title: boolean; epigraph: boolean };
  ```

- [ ] **Step 1: Write the failing test**

`apps/mobile/test/heroCues.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EPIGRAPH_CUE_MS, TITLE_CUE_MS, scheduleHeroCues } from "../src/game/heroCues";

describe("scheduleHeroCues", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("cues the title, then the epigraph, at the spec offsets", () => {
    const title = vi.fn();
    const epigraph = vi.fn();
    scheduleHeroCues(title, epigraph);
    vi.advanceTimersByTime(TITLE_CUE_MS - 1);
    expect(title).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(title).toHaveBeenCalledTimes(1);
    expect(epigraph).not.toHaveBeenCalled();
    vi.advanceTimersByTime(EPIGRAPH_CUE_MS - TITLE_CUE_MS);
    expect(epigraph).toHaveBeenCalledTimes(1);
  });

  it("orders title before epigraph", () => {
    expect(TITLE_CUE_MS).toBeLessThan(EPIGRAPH_CUE_MS);
  });

  it("cancel stops both pending cues", () => {
    const title = vi.fn();
    const epigraph = vi.fn();
    const cancel = scheduleHeroCues(title, epigraph);
    cancel();
    vi.advanceTimersByTime(EPIGRAPH_CUE_MS + 100);
    expect(title).not.toHaveBeenCalled();
    expect(epigraph).not.toHaveBeenCalled();
  });

  it("accepts injected timers", () => {
    const set = vi.fn(() => 42);
    const clear = vi.fn();
    const cancel = scheduleHeroCues(() => {}, () => {}, { set, clear });
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls.map((c) => c[1])).toEqual([TITLE_CUE_MS, EPIGRAPH_CUE_MS]);
    cancel();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/heroCues.test.ts`
Expected: FAIL — cannot resolve `../src/game/heroCues`.

- [ ] **Step 3: Implement the scheduler**

`apps/mobile/src/game/heroCues.ts`:
```ts
// Cold-start cue offsets, measured from the moment the orb lands on Home
// (spec 2026-09-01-boot-orb-handoff storyboard: landing at +550ms, title at
// +900ms, epigraph at +1400ms).
export const TITLE_CUE_MS = 350;
export const EPIGRAPH_CUE_MS = 850;

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

// Schedules both cues; returns a cancel that clears whatever is still pending.
export function scheduleHeroCues(
  onTitle: () => void,
  onEpigraph: () => void,
  timers: Timers = realTimers,
): () => void {
  const ids = [timers.set(onTitle, TITLE_CUE_MS), timers.set(onEpigraph, EPIGRAPH_CUE_MS)];
  return () => ids.forEach((id) => timers.clear(id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run test/heroCues.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Write the hook**

`apps/mobile/src/ui/useHeroCues.ts`:
```ts
import { useEffect, useState } from "react";
import { scheduleHeroCues } from "../game/heroCues";

// Turns the landing moment into the two staggered print cues Home needs.
// `landed` true on first render (warm mount) still walks the same schedule —
// a 350/850ms stagger on a screen re-entry is invisible and keeps one path.
export function useHeroCues(landed: boolean): { title: boolean; epigraph: boolean } {
  const [title, setTitle] = useState(false);
  const [epigraph, setEpigraph] = useState(false);
  useEffect(() => {
    if (!landed) return;
    return scheduleHeroCues(() => setTitle(true), () => setEpigraph(true));
  }, [landed]);
  return { title, epigraph };
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit -p .` → exit 0.
```bash
git add apps/mobile/src/game/heroCues.ts apps/mobile/src/ui/useHeroCues.ts apps/mobile/test/heroCues.test.ts
git commit -m "feat(mobile): hero cue scheduler — title and epigraph offsets from the orb landing

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 5: `OrbLayer` and `HandLayer`

**Files:**
- Create: `apps/mobile/src/ui/OrbLayer.tsx`, `apps/mobile/src/ui/HandLayer.tsx`

**Interfaces:**
- Consumes: `Rect`, `handOffscreenX` from `src/game/heroStage.ts`.
- Produces:
  ```tsx
  export function OrbLayer(props: { rect: Rect; playing: boolean }): JSX.Element;
  // absolutely positioned at rect within its parent; playing → expo-image autoplay
  export function HandLayer(props: { rect: Rect; side: "left" | "right"; enter: boolean; stageWidth: number; delayMs?: number }): JSX.Element;
  // absolutely positioned at rect; when `enter` is false it sits at handOffscreenX; when it flips true it eases to 0 over 700ms after delayMs
  ```

- [ ] **Step 1: Write `OrbLayer`**

`apps/mobile/src/ui/OrbLayer.tsx`:
```tsx
import { Image } from "expo-image";
import type { Rect } from "../game/heroStage";

// The orb tile: a transparent animated WebP, 1:1. `playing={false}` shows
// frame 0 as a still — that is the boot rite's orb; Home's orb mounts with
// `playing` so its loop begins on frame 0, pixel-identical to the still that
// just arrived (expo-image `autoplay`, Expo SDK 57).
const ORB = require("../../assets/art/orb-loop.webp");

export function OrbLayer({ rect, playing }: { rect: Rect; playing: boolean }) {
  return (
    <Image
      source={ORB}
      autoplay={playing}
      contentFit="contain"
      style={{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      accessible={false}
    />
  );
}
```

- [ ] **Step 2: Write `HandLayer`**

`apps/mobile/src/ui/HandLayer.tsx`:
```tsx
import { useEffect } from "react";
import { Image } from "expo-image";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { handOffscreenX, type Rect } from "../game/heroStage";

// One hand slot. Placeholder behavior: the idle loop slides in from its own
// edge when `enter` flips true. With real entrance clips (loop count 1) the
// slide collapses to 0ms and the clip's own motion carries the entrance —
// the prop contract stays the same.
const SOURCES = {
  left: require("../../assets/art/hand-left-loop.webp"),
  right: require("../../assets/art/hand-right-loop.webp"),
} as const;

export const HAND_ENTER_MS = 700;

export function HandLayer({
  rect,
  side,
  enter,
  stageWidth,
  delayMs = 0,
}: {
  rect: Rect;
  side: "left" | "right";
  enter: boolean;
  stageWidth: number;
  delayMs?: number;
}) {
  const off = handOffscreenX(stageWidth, side);
  const tx = useSharedValue(enter ? 0 : off);

  useEffect(() => {
    if (enter) tx.value = withDelay(delayMs, withTiming(0, { duration: HAND_ENTER_MS, easing: Easing.out(Easing.cubic) }));
  }, [enter, delayMs, tx]);

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <Animated.View style={[{ position: "absolute", left: rect.x, top: rect.y, width: rect.w, height: rect.h }, style]} pointerEvents="none">
      <Image source={SOURCES[side]} contentFit="contain" style={{ width: rect.w, height: rect.h }} accessible={false} />
    </Animated.View>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p .` → exit 0. (No unit tests: these are RN components; verified on device in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/OrbLayer.tsx apps/mobile/src/ui/HandLayer.tsx
git commit -m "feat(mobile): OrbLayer and HandLayer — the hero's orb tile and edge-entering hand slots

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 6: `LivingHero` becomes the layered stage

**Files:**
- Modify: `apps/mobile/src/ui/LivingHero.tsx` (whole file)

**Interfaces:**
- Consumes: `OrbLayer`, `HandLayer` (Task 5); `stageSize`, `orbRect`, `dustRect`, `handSlot`, `ORB_CX`, `ORB_CY` (Task 2); `setHeroAnchor` (Task 3); existing `AsciiDust`, `orbGlowRgb`.
- Produces:
  ```tsx
  export type HeroPhase = "cold" | "waking" | "live";
  export function LivingHero(props: { lean: number | null; phase?: HeroPhase }): JSX.Element; // phase defaults to "live"
  ```
  Behavior by phase — `cold`: glow opacity 0, hands offscreen, orb unmounted, anchor published. `waking`: glow fades to 1 after 300ms (400ms), hands enter after 450ms. `live`: orb mounted with `playing`; glow 1 (animating in if arriving from waking); hands at rest. Reduced motion: unchanged graded still.

- [ ] **Step 1: Replace the file**

`apps/mobile/src/ui/LivingHero.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { orbGlowRgb } from "../game/orbMood";
import { ORB_CX, ORB_CY, dustRect, handSlot, orbRect, stageSize } from "../game/heroStage";
import { setHeroAnchor } from "../game/bootGate";
import { AsciiDust } from "./TerminalPatina";
import { OrbLayer } from "./OrbLayer";
import { HandLayer } from "./HandLayer";

// The living hero as a stage of layers (spec 2026-09-01-boot-orb-handoff):
// glow (Skia, mood-tinted) → dust ring → hands → orb. The footprint is the
// old loop's (width × width/1.779) so nothing else on Home moves. On a cold
// start the boot rite's orb slides into the orb slot measured here; the
// phases stagger what is visible so the arrival reads as one motion.
export type HeroPhase = "cold" | "waking" | "live";

const GLOW_DELAY_MS = 300;
const GLOW_MS = 400;
const HANDS_DELAY_MS = 450;

export function LivingHero({ lean, phase = "live" }: { lean: number | null; phase?: HeroPhase }) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const { w, h } = stageSize(width);
  const orb = orbRect(width);
  const dust = dustRect(width);
  const [r, g, b] = orbGlowRgb(lean);

  // Anchor: the orb slot's rect in window coordinates, republished on every
  // layout so the rite reads a settled value at `done`.
  const slotRef = useRef<View>(null);
  const publishAnchor = () => {
    slotRef.current?.measureInWindow((x, y, mw, mh) => {
      if (mw > 0 && mh > 0) setHeroAnchor({ x, y, w: mw, h: mh });
    });
  };

  // Glow: 0 while cold; fades up 300ms after the rite's `done` (waking); 1 when live.
  const glow = useSharedValue(phase === "cold" ? 0 : 1);
  useEffect(() => {
    if (phase === "waking") glow.value = withDelay(GLOW_DELAY_MS, withTiming(1, { duration: GLOW_MS, easing: Easing.out(Easing.quad) }));
    else if (phase === "live") glow.value = withTiming(1, { duration: GLOW_MS });
  }, [phase, glow]);
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  if (reducedMotion) {
    // Still world: the graded still frame, no glow behind it.
    return (
      <Image
        source={require("../../assets/art/creation-hands-orb.jpg")}
        contentFit="cover"
        style={{ width: w, aspectRatio: 1408 / 768 }}
        accessible={false}
      />
    );
  }

  const handsEnter = phase !== "cold";
  const handsDelay = phase === "waking" ? HANDS_DELAY_MS : 0;

  return (
    <View style={{ width: w, height: h }}>
      <Animated.View style={[{ position: "absolute", left: 0, top: 0, width: w, height: h }, glowStyle]} pointerEvents="none">
        <Canvas style={{ width: w, height: h }}>
          <Circle cx={w * ORB_CX} cy={h * ORB_CY} r={h * 0.52}>
            <RadialGradient
              c={vec(w * ORB_CX, h * ORB_CY)}
              r={h * 0.52}
              colors={[`rgba(${r},${g},${b},0.38)`, `rgba(${r},${g},${b},0)`]}
            />
          </Circle>
        </Canvas>
      </Animated.View>
      {/* Patina halo: sparse glyphs collect around the orb, between the glow
          and the artwork — the hands and orb paint over them (brief §4: ASCII
          never obscures anatomy). */}
      <View pointerEvents="none" style={{ position: "absolute", left: dust.x, top: dust.y }}>
        <AsciiDust size={dust.w} intensity={0.22} gate={0.18} />
      </View>
      <HandLayer rect={handSlot(width, "left")} side="left" enter={handsEnter} stageWidth={width} delayMs={handsDelay} />
      <HandLayer rect={handSlot(width, "right")} side="right" enter={handsEnter} stageWidth={width} delayMs={handsDelay} />
      {/* The orb slot always exists (it is what gets measured); the orb itself
          mounts only once landed, so its loop starts on frame 0 — the frame the
          rite's still was showing. */}
      <View
        ref={slotRef}
        onLayout={publishAnchor}
        pointerEvents="none"
        style={{ position: "absolute", left: orb.x, top: orb.y, width: orb.w, height: orb.h }}
      >
        {phase === "live" && <OrbLayer rect={{ x: 0, y: 0, w: orb.w, h: orb.h }} playing />}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p .` → exit 0. Existing caller `src/app/index.tsx` passes only `lean`, so it compiles unchanged and renders `"live"` — identical composition to before, now layered.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/LivingHero.tsx
git commit -m "feat(mobile): LivingHero is a layered stage — glow, dust, hands, orb — with cold/waking/live phases

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 7: Home derives the phase and cues title/epigraph from the landing

**Files:**
- Modify: `apps/mobile/src/app/index.tsx` — imports (`onBootDone` line), the `booted` block near the end of the component body, and the JSX for `LivingHero`, `MaterializeTitle`, and the two epigraph `DecodeLine`s.

**Interfaces:**
- Consumes: `onBootDone`, `isBootDone`, `onOrbLanded`, `isOrbLanded` (Task 3); `useHeroCues` (Task 4); `HeroPhase` via `LivingHero` (Task 6).

- [ ] **Step 1: Update the import**

Change
```ts
import { onBootDone } from "../game/bootGate";
```
to
```ts
import { isBootDone, isOrbLanded, onBootDone, onOrbLanded } from "../game/bootGate";
import { useHeroCues } from "../ui/useHeroCues";
```

- [ ] **Step 2: Replace the boot-gate block**

Find:
```ts
  // Hold the print-in until the boot rite lifts — the static resolves in
  // view as the overlay fades, instead of playing unseen behind it.
  const [booted, setBooted] = useState(false);
  useEffect(() => onBootDone(() => setBooted(true)), []);
```
Replace with:
```ts
  // Cold-start choreography (spec 2026-09-01-boot-orb-handoff). `booted`:
  // the rite's hold elapsed — the bottom-stack lines print now, the hero
  // starts waking. `orbLanded`: the rite's orb arrived — the hero goes live
  // and title/epigraph follow on the cue timers. Both seed from the gate's
  // sync getters so a warm (re)mount renders live on its first frame.
  const [booted, setBooted] = useState(isBootDone);
  useEffect(() => onBootDone(() => setBooted(true)), []);
  const [orbLanded, setOrbLanded] = useState(isOrbLanded);
  useEffect(() => onOrbLanded(() => setOrbLanded(true)), []);
  const heroPhase = orbLanded ? "live" : booted ? "waking" : "cold";
  const cues = useHeroCues(orbLanded);
```

- [ ] **Step 3: Update the hero JSX**

Change
```tsx
        <LivingHero lean={lean} />
```
to
```tsx
        <LivingHero lean={lean} phase={heroPhase} />
```
Change
```tsx
        <MaterializeTitle active={booted} />
```
to
```tsx
        <MaterializeTitle active={cues.title} />
```
Change both epigraph lines' `active={booted}` (the two `DecodeLine`s inside the `paddingHorizontal: space(5)` View — the quoted `epigraph.text` line and the `— ${epigraph.source...}` line) to `active={cues.epigraph}`. Leave every other `active={booted}` in the bottom stack (ledger/round/sealed lines, `SleepsPanel`) as is.

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit -p . && npx vitest run` → tsc exit 0, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): home derives the hero phase from the boot gate; title and epigraph cue off the landing

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 8: `BootRite` renders the still orb and slides it to the anchor

**Files:**
- Modify: `apps/mobile/src/ui/BootRite.tsx` (whole file)
- Modify: `apps/mobile/src/ui/CallingRite.tsx:57` (one added call)

**Interfaces:**
- Consumes: `OrbLayer` (Task 5); `orbRect`, `dustRect` (Task 2); `markBootDone`, `markOrbLanded`, `getHeroAnchor` (Task 3); existing `AsciiDust`, `GOLD`, `DecodeLine`.
- Produces: no exports change. Behavior: on `done`, `markBootDone()`; if `getHeroAnchor()` is non-null, the orb+dust group translates from its measured window position to the anchor's center over 550ms while the field fades over 450ms and the text over 200ms; on completion `markOrbLanded()` then unmount. If null, field fades 450ms, then `markOrbLanded()` and unmount. Reduced motion: both marks fire immediately, nothing mounts.

- [ ] **Step 1: Replace the file**

`apps/mobile/src/ui/BootRite.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { Easing, FadeIn, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, space } from "../theme";
import { getHeroAnchor, markBootDone, markOrbLanded } from "../game/bootGate";
import { dustRect, orbRect } from "../game/heroStage";
import { DecodeLine } from "./DecodeText";
import { AsciiDust, GOLD } from "./TerminalPatina";
import { OrbLayer } from "./OrbLayer";

// The boot rite: one short machine-voice ceremony on cold start, covering the
// app's first data fetch (brief §7 — "ASCII used for delight, loading,
// activation, and transitions"). It runs once per process, never on
// foreground, is tap-skippable, and under reduced motion never mounts at all
// — it must only ever occupy time the app would spend loading anyway, plus a
// minimum hold so it reads as intentional rather than as a flash.
// V3 (spec 2026-09-01-boot-orb-handoff): the orb is here from the first frame
// as a still, with its dust ring, at exactly the size it has on Home. When the
// hold elapses the field fades and the orb rises to Home's measured slot; on
// landing Home's own orb takes over on frame 0 — THE ORB WAKES. With no
// anchor (deep link, unmeasured) the rite simply fades as before.
const LINES = ["ORACLE OS V1.0", "THE ORB WAKES", "THE LEDGER OPENS"] as const;
const LINE_MS = 420;
const READY_MS = LINES.length * LINE_MS + 320;
const HOLD_MS = READY_MS + 700;
const FADE_MS = 450;
const TEXT_FADE_MS = 200;
const SLIDE_MS = 550;

export function BootRite() {
  const reducedMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const [shown, setShown] = useState(1);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);

  // Geometry shared with Home: identical rects from the same window width, so
  // the slide is pure translation.
  const orb = orbRect(width);
  const dust = dustRect(width);
  const groupRef = useRef<View>(null);

  const field = useSharedValue(1);
  const text = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  useEffect(() => {
    if (reducedMotion) { markBootDone(); markOrbLanded(); return; }
    const timers = LINES.slice(1).map((_, i) =>
      setTimeout(() => setShown(i + 2), (i + 1) * LINE_MS),
    );
    timers.push(setTimeout(() => setReady(true), READY_MS));
    timers.push(setTimeout(() => setDone(true), HOLD_MS));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion]);

  useEffect(() => {
    if (!done || gone) return;
    markBootDone();
    const finish = () => { markOrbLanded(); setGone(true); };
    field.value = withTiming(0, { duration: FADE_MS, easing: Easing.out(Easing.quad) });
    text.value = withTiming(0, { duration: TEXT_FADE_MS });

    const anchor = getHeroAnchor();
    const group = groupRef.current;
    if (!anchor || !group) {
      // No slide possible: fade as V2 did, then hand off.
      const id = setTimeout(finish, FADE_MS);
      return () => clearTimeout(id);
    }
    // The group is the dust canvas with the orb centered inside it, so the
    // group's center IS the orb's center; the anchor is the orb tile's rect.
    group.measureInWindow((gx, gy, gw, gh) => {
      const dx = anchor.x + anchor.w / 2 - (gx + gw / 2);
      const dy = anchor.y + anchor.h / 2 - (gy + gh / 2);
      const cfg = { duration: SLIDE_MS, easing: Easing.out(Easing.cubic) };
      tx.value = withTiming(dx, cfg);
      ty.value = withTiming(dy, cfg, (finished) => {
        "worklet";
        if (finished) runOnJS(finish)();
      });
    });
  }, [done, gone, field, text, tx, ty]);

  const fieldStyle = useAnimatedStyle(() => ({ opacity: field.value }));
  const textStyle = useAnimatedStyle(() => ({ opacity: text.value }));
  const groupStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }] }));

  if (reducedMotion || gone) return null;
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 100 }]} pointerEvents={done ? "none" : "auto"}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.museumWhite }, fieldStyle]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip introduction"
        onPress={() => setDone(true)}
        style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space(4) }}
      >
        <Animated.View ref={groupRef} style={[{ width: dust.w, height: dust.h }, groupStyle]}>
          <AsciiDust size={dust.w} color={GOLD} intensity={0.7} gate={0.28} />
          <OrbLayer rect={{ x: (dust.w - orb.w) / 2, y: (dust.h - orb.h) / 2, w: orb.w, h: orb.h }} playing={false} />
        </Animated.View>
        <Animated.View style={[{ gap: space(2), alignItems: "center" }, textStyle]}>
          {LINES.slice(0, shown).map((line, i) => (
            <DecodeLine
              key={line}
              text={line}
              cursor={!ready && i === shown - 1}
              durationMs={340}
              size={11}
              color={i === 0 ? colors.goldText : colors.mutedInk}
              letterSpacing={3}
            />
          ))}
          {ready && (
            <Animated.View entering={FadeIn.duration(200)}>
              <DecodeLine text="READY." cursor durationMs={200} size={11} color={colors.goldText} letterSpacing={3} />
            </Animated.View>
          )}
        </Animated.View>
      </Pressable>
    </View>
  );
}
```

Notes for the implementer:
- `Animated.View` accepts a `ref` typed as `View`; `measureInWindow` is available on it. If tsc complains about the ref type, use `useRef<Animated.View>(null)` and cast at the call site — do not drop the measurement.
- `pointerEvents="none"` once `done` lets taps reach Home during the slide.
- Do **not** reintroduce `exiting={FadeOut}` on the root: the orb must stay fully opaque while it travels; only the white field and the text fade.

- [ ] **Step 2: Mark the landing from `CallingRite` too**

In `apps/mobile/src/ui/CallingRite.tsx`, change the import on line 7:
```ts
import { markBootDone, markOrbLanded } from "../game/bootGate";
```
and at line 57 where `markBootDone();` is called, add `markOrbLanded();` immediately after it. (First-open goes through the Calling rite instead of the boot rite; without this, Home would wait forever in `"waking"` for a landing that never comes.)

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit -p . && npx vitest run` → tsc exit 0, all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/ui/BootRite.tsx apps/mobile/src/ui/CallingRite.tsx
git commit -m "feat(mobile): boot rite holds the orb as a still and slides it into Home's measured slot

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

### Task 9: On-device verification and cleanup

**Files:**
- Delete: `apps/mobile/assets/art/hero-loop.webp` (no longer referenced after Task 6)
- Modify (if needed): `docs/superpowers/specs/2026-09-01-boot-orb-handoff-design.md` — record the loop-count finding in the Verification section.

- [ ] **Step 1: Confirm the old loop is unreferenced**

Run from `apps/mobile`: `grep -rn "hero-loop" src app.json 2>/dev/null`
Expected: no matches. If there are, fix the reference before deleting.

- [ ] **Step 2: Launch on iOS simulator and run the checklist**

Run from `apps/mobile`: `pnpm run:ios` (or the project's existing iOS run script in `package.json` — check `scripts` first; do not invent a command). Then, from the spec's Verification list:
1. Cold start → orb rises from the boot field and lands with no visible jump; the loop begins swirling at landing; hands slide in from the edges after; title materializes after; epigraph decodes last.
2. Kill the app, cold start again and tap to skip mid-text → same handoff, just sooner.
3. Trigger a deep link cold start (e.g. `xcrun simctl openurl booted oracle://reveal/2026-08-31` — check `app.json` `scheme` for the exact scheme) → plain fade, no slide, no red box, no console error.
4. Navigate Home → /round → back → hero is `"live"` immediately, no blank orb slot, no hands re-entering.
5. Settings → Accessibility → Motion → Reduce Motion ON, relaunch → no rite, graded still.
6. Metro console: no `Terminal Patina SkSL` error, no `measureInWindow` warnings.

Record what you saw for each item in the task report — pass/fail with a sentence. Do not mark the task complete on a failure; report it.

- [ ] **Step 3: Delete the superseded asset and commit**

```bash
git rm apps/mobile/assets/art/hero-loop.webp
git commit -m "chore(mobile): drop the monolithic hero loop; the layered stage owns its tiles

Claude-Session: https://claude.ai/code/session_01WpCizx1BTkyKFYuyDUqonZ"
```

---

## Self-review notes (writer's pass)

- Spec coverage: storyboard (Tasks 6–8), components (5–6), bootGate (3), Home (7), data flow (7–8), placeholder assets (1), verification + cleanup (9). Real-asset generation is the user's, per spec; the `HandLayer` contract already fits loop-count-1 clips (set `HAND_ENTER_MS` to 0 when they land).
- Type consistency: `Rect` `{x,y,w,h}` everywhere; `HeroPhase` `"cold" | "waking" | "live"`; gate names match Task 3 across Tasks 6–8.
- Known deviation from spec text: Home's glow/hands cue off `booted` (the rite's `done`) via the `"waking"` phase, orb off `orbLanded` — this is what the storyboard's +300/+450/+550 offsets require; the spec's Components section was amended to say so.
