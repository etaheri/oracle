# Delight Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ORACLE's parchment world react to the player: a living animated hero on home whose glow carries the crowd's mood, a wax-seal stamp on sealing, cards dealt from a deck, and a Wordle-grade share pattern.

**Architecture:** The user's VEED alpha-webm (hands + swirling orb, background removed) becomes an animated WebP with alpha played by `expo-image` (SDWebImage/Glide both decode it natively — no new dependencies, works in Expo Go), layered over a Skia radial glow tinted by crowd lean. All pure logic (glow color, share pattern) lives in `src/game/` so node vitest can test it without importing Skia/Expo modules. Motion is Reanimated with the house easing; every animated moment has a `useReducedMotion` fallback.

**Tech Stack:** Expo SDK 57 / RN 0.86, expo-image, @shopify/react-native-skia 2.6.2, react-native-reanimated 4.5.1, expo-haptics, vitest, Pillow + ffmpeg (asset pipeline only).

**Spec:** `docs/superpowers/specs/` (design 2026-08-09 §3b/§7) + art direction in `design/art-direction/` + the approved delight ideation (this plan's parent conversation, 2026-08-26).

## Rev 2 — Brand Brief Reconciliation (2026-08-26)

The brand brief (`docs/superpowers/specs/2026-08-26-oracle-brand-brief.md`) landed after this plan was written and supersedes the parchment-era tokens. A **brand-v2 retheme executes between Task 0 and Task 1** (museumWhite `#F7F6F2` ground, frescoWhite `#F3F0E9` cards, ink `#17191F`/mutedInk `#666A73` text, agedGold `#AA8A50` borders + derived goldText `#7E6538` text tier, ultramarine `#243D78` = YES, vermilion `#A84B35` = NO, midnightMuseum `#121A2B` night, glassBlue/lavender/warmCenter decorative; chrome quiets per the approved "card = artifact" ruling — Cinzel survives only in wordmark, numerals, day points, and the card/share artifacts; buttons go mono). Apply these substitutions when executing later tasks:

- Task 2 `orbMood.ts` anchors: NEUTRAL = lavender `[183,169,228]`, WARM = warmCenter `[242,190,145]`, COOL = glassBlue-leaning `[156,181,209]`. Update test expectations accordingly.
- Task 4 SealStamp: `colors.gold` → `colors.agedGold`, `colors.goldDeep` → `colors.goldText`.
- Task 6 night card: `NIGHT_LINE`/`NIGHT_DIM` are museumWhite-based rgba; `NIGHT_LOSS = "#D9705A"` (5.3:1 on midnightMuseum); win = `colors.agedGold`.
- Terminal Patina phase 1 (per `2026-08-26-terminal-patina-shader.md`) is scheduled AFTER this plan completes.

## Global Constraints

- Expo SDK 57 exact — read https://docs.expo.dev/versions/v57.0.0/ before using any Expo API (per `apps/mobile/AGENTS.md`).
- No new npm dependencies. Everything here uses packages already in `apps/mobile/package.json`.
- House easing is `Easing.out(Easing.poly(4))` — `Easing.quart` does not exist in Reanimated.
- Every animation must have a `useReducedMotion` fallback (static or short fade).
- Skia text has NO font fallback: never put non-ASCII glyphs (✶ ✓ ✗ ∅) into `SkText` — encode meaning by color/position instead. RN `<Text>` and share-message strings may use them freely (system fallback applies).
- Palette tokens come from `src/theme.ts` only. Night-card-local colors are file-local constants in `ShareCard.tsx`.
- Mobile tests live in `apps/mobile/test/*.test.ts` (vitest `include: ["test/**/*.test.ts"]`), import from `../src/...`, and must not transitively import `@shopify/react-native-skia`, `expo-*`, or `react-native` — put pure logic in `src/game/`.
- Verification commands (run from repo root): `pnpm --filter @oracle/mobile exec tsc --noEmit` and `pnpm --filter @oracle/mobile test`.
- Simulator verification: Metro MUST be started from `apps/mobile` (root start mis-detects the project and generates a stray root `tsconfig.json`). Fast Refresh from a nohup'd Metro silently fails — always `xcrun simctl terminate <UDID> host.exp.Exponent` then `xcrun simctl openurl <UDID> "exp://127.0.0.1:8081/--/<path>"` for a fresh bundle.
- The API dev server (`wrangler dev` on :8787, run from `apps/api`) must be up for screens to load data.

---

### Task 0: Commit the pending parchment-pivot work

The working tree holds the entire uncommitted parchment retheme (Aug 20 design pass + Aug 25 pivot). This plan's commits must not mix with it.

**Files:** everything currently modified/untracked per `git status` (theme, ui components, screens, assets, `design/art-direction/`, `docs/`).

- [ ] **Step 1: Review and stage**

```bash
git status --porcelain   # sanity: only expected mobile/design/docs paths
git add -A
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(mobile): parchment art-direction pivot — palette, living icons, night share card"
```

- [ ] **Step 3: Verify clean tree**

Run: `git status --porcelain` — Expected: empty output.

---

### Task 1: Hero-loop asset pipeline

Convert the VEED alpha webm into the shipping animated WebP, reproducibly.

**Files:**
- Create: `design/scripts/make-hero-loop.py`
- Create (generated): `apps/mobile/assets/art/hero-loop.webp`
- Create (copy): `design/art-direction/hero-loop-source.webm`

**Interfaces:**
- Produces: `apps/mobile/assets/art/hero-loop.webp` — 1000×562 animated WebP, alpha, 12fps, 60 frames, infinite loop, ≤3MB. Orb center sits at (0.50, 0.47) of the frame. Task 3 requires this exact path.

- [ ] **Step 1: Copy the source into the repo**

```bash
cp "/Users/eriktaheri/Downloads/Oracle Assets_Veed Background Removal_2026-08-26_00-06-10.webm" \
   design/art-direction/hero-loop-source.webm
```

- [ ] **Step 2: Write the converter script**

Create `design/scripts/make-hero-loop.py`:

```python
#!/usr/bin/env python3
"""Convert the VEED alpha-webm hero loop into the in-app animated WebP.

Usage: python3 make-hero-loop.py [source.webm]
Requires: ffmpeg on PATH, Pillow (pip install pillow).
"""
import glob
import os
import subprocess
import sys
import tempfile

from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SRC = os.path.join(REPO, "design/art-direction/hero-loop-source.webm")
OUT = os.path.join(REPO, "apps/mobile/assets/art/hero-loop.webp")
FPS, WIDTH, QUALITY = 12, 1000, 78

src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
with tempfile.TemporaryDirectory() as td:
    # -c:v libvpx-vp9 BEFORE -i: ffmpeg's default vp9 path drops the alpha plane
    subprocess.run(
        ["ffmpeg", "-v", "error", "-c:v", "libvpx-vp9", "-i", src,
         "-vf", f"fps={FPS}", os.path.join(td, "f%03d.png")],
        check=True,
    )
    frames = [Image.open(f).convert("RGBA") for f in sorted(glob.glob(os.path.join(td, "f*.png")))]
    h = round(frames[0].size[1] * WIDTH / frames[0].size[0])
    frames = [f.resize((WIDTH, h), Image.LANCZOS) for f in frames]
    frames[0].save(OUT, save_all=True, append_images=frames[1:],
                   duration=int(1000 / FPS), loop=0, quality=QUALITY, method=4)

mb = os.path.getsize(OUT) / 1e6
print(f"{OUT}: {mb:.2f} MB, {len(frames)} frames, {frames[0].size[0]}x{frames[0].size[1]}")
assert mb <= 3.0, "hero loop too heavy — lower QUALITY or FPS"
```

- [ ] **Step 3: Run it and verify output**

Run: `python3 design/scripts/make-hero-loop.py` (use a Pillow venv if system python lacks it: `python3 -m venv /tmp/venv && /tmp/venv/bin/pip install pillow && /tmp/venv/bin/python design/scripts/make-hero-loop.py`)
Expected: prints `hero-loop.webp: ~2.4 MB, 60 frames, 1000x562`, no assert failure.

- [ ] **Step 4: Commit**

```bash
git add design/scripts/make-hero-loop.py design/art-direction/hero-loop-source.webm apps/mobile/assets/art/hero-loop.webp
git commit -m "feat(mobile): hero-loop animated webp + reproducible converter"
```

---

### Task 2: Orb mood logic (TDD)

Pure functions mapping the crowd's lean to the orb glow color. The anti-herding wall holds: crowd data only exists for questions the player has already sealed (`GET /v1/round/today/crowd` returns nothing else), so the orb starts neutral each day and warms/cools as the player's sealed picks reveal the crowd.

**Files:**
- Create: `apps/mobile/src/game/orbMood.ts`
- Test: `apps/mobile/test/orbMood.test.ts`

**Interfaces:**
- Consumes: nothing (pure module — no imports from theme/skia so the test stays node-clean; color anchors are file-local constants matching `theme.ts` `orbLavender`/`orbPeach`).
- Produces: `crowdLean(entries: ReadonlyArray<{ crowd_yes_pct: number }>): number | null` and `orbGlowRgb(lean: number | null): readonly [number, number, number]`. Task 3 consumes both.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/orbMood.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { crowdLean, orbGlowRgb } from "../src/game/orbMood";

describe("crowdLean", () => {
  it("is null with no sealed crowd data (anti-herding: orb starts neutral)", () => {
    expect(crowdLean([])).toBeNull();
  });
  it("averages the yes-lean across sealed questions", () => {
    expect(crowdLean([{ crowd_yes_pct: 60 }, { crowd_yes_pct: 80 }])).toBe(70);
  });
});

describe("orbGlowRgb", () => {
  it("is neutral lavender when the crowd is unknown", () => {
    expect(orbGlowRgb(null)).toEqual([178, 166, 203]);
  });
  it("is neutral lavender at a perfectly split crowd", () => {
    expect(orbGlowRgb(50)).toEqual([178, 166, 203]);
  });
  it("warms to peach at full YES", () => {
    expect(orbGlowRgb(100)).toEqual([237, 188, 148]);
  });
  it("cools to lapis-lavender at full NO", () => {
    expect(orbGlowRgb(0)).toEqual([143, 160, 201]);
  });
  it("clamps out-of-range leans", () => {
    expect(orbGlowRgb(140)).toEqual([237, 188, 148]);
    expect(orbGlowRgb(-10)).toEqual([143, 160, 201]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/mobile test`
Expected: FAIL — cannot resolve `../src/game/orbMood`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/game/orbMood.ts`:

```ts
// The orb holds the crowd's mood. Anti-herding wall stays intact: lean is
// computed only from questions the player has already sealed, so the orb is
// neutral until the player commits, then drifts as the crowd is revealed.
// Color anchors mirror theme.ts orbLavender/orbPeach (kept literal here so
// node tests never import RN modules).
const NEUTRAL = [178, 166, 203] as const; // orbLavender
const COOL = [143, 160, 201] as const; // lapis-leaning lavender (crowd says NO)
const WARM = [237, 188, 148] as const; // orbPeach (crowd says YES)

export function crowdLean(entries: ReadonlyArray<{ crowd_yes_pct: number }>): number | null {
  if (entries.length === 0) return null;
  return entries.reduce((s, e) => s + e.crowd_yes_pct, 0) / entries.length;
}

export function orbGlowRgb(lean: number | null): readonly [number, number, number] {
  if (lean === null) return NEUTRAL;
  const t = Math.min(100, Math.max(0, lean));
  const [from, to, k] = t < 50 ? [COOL, NEUTRAL, t / 50] : [NEUTRAL, WARM, (t - 50) / 50];
  return [0, 1, 2].map((i) => Math.round(from[i] + (to[i] - from[i]) * k)) as unknown as readonly [number, number, number];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test`
Expected: all pass (11 existing + 7 new).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/game/orbMood.ts apps/mobile/test/orbMood.test.ts
git commit -m "feat(mobile): orb mood — crowd lean to glow color"
```

---

### Task 3: LivingHero component + home integration

**Files:**
- Create: `apps/mobile/src/ui/LivingHero.tsx`
- Modify: `apps/mobile/src/app/index.tsx` (replace the static hero `<Image>`)

**Interfaces:**
- Consumes: `crowdLean`/`orbGlowRgb` from Task 2; `hero-loop.webp` from Task 1; `useCrowdSoFar(enabled: boolean)` from `src/api/hooks` (returns `{ data?: { questions: { id: string; crowd_yes_pct: number; player_count: number }[] } }`, 10s refetch); `useRoundStore` answers (`Record<string, { sealed: boolean; ... }>`).
- Produces: `LivingHero({ lean }: { lean: number | null })` — self-sizing full-width hero.

- [ ] **Step 1: Write the component**

Create `apps/mobile/src/ui/LivingHero.tsx`:

```tsx
import { View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { Canvas, Circle, RadialGradient, vec } from "@shopify/react-native-skia";
import { useReducedMotion } from "react-native-reanimated";
import { space } from "../theme";
import { orbGlowRgb } from "../game/orbMood";

// The living hero: the VEED alpha loop (both hands + swirling orb) over a
// Skia glow tinted by the crowd's mood (src/game/orbMood.ts). The loop is
// transparent, so the parchment ground and the glow read through it.
// Orb center sits at (0.50, 0.47) of the 1000x562 frame.
const ASPECT = 1000 / 562;
const ORB_CX = 0.5;
const ORB_CY = 0.47;

export function LivingHero({ lean }: { lean: number | null }) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const w = width - space(6);
  const h = w / ASPECT;
  const [r, g, b] = orbGlowRgb(lean);

  if (reducedMotion) {
    // Still world: the graded still frame, no glow pulse behind it.
    return (
      <Image
        source={require("../../assets/art/creation-hands-orb.jpg")}
        contentFit="cover"
        style={{ width: w, aspectRatio: 1408 / 768 }}
        accessible={false}
      />
    );
  }

  return (
    <View style={{ width: w, height: h }}>
      <Canvas style={{ position: "absolute", left: 0, top: 0, width: w, height: h }} pointerEvents="none">
        <Circle cx={w * ORB_CX} cy={h * ORB_CY} r={h * 0.52}>
          <RadialGradient
            c={vec(w * ORB_CX, h * ORB_CY)}
            r={h * 0.52}
            colors={[`rgba(${r},${g},${b},0.38)`, `rgba(${r},${g},${b},0)`]}
          />
        </Circle>
      </Canvas>
      <Image
        source={require("../../assets/art/hero-loop.webp")}
        contentFit="contain"
        style={{ width: w, height: h }}
        accessible={false}
      />
    </View>
  );
}
```

- [ ] **Step 2: Wire it into home**

In `apps/mobile/src/app/index.tsx`:
- Add imports: `import { LivingHero } from "../ui/LivingHero";`, `import { useCrowdSoFar } from "../api/hooks";` (extend the existing `useToday` import line), `import { crowdLean } from "../game/orbMood";`. Remove the now-unused `Image` import from `expo-image` and `useWindowDimensions` if nothing else uses them.
- Above the return, after `allSealed`:

```tsx
const anySealed = !!round && round.questions.some((q) => answers[q.id]?.sealed);
const crowd = useCrowdSoFar(anySealed);
const lean = crowdLean(crowd.data?.questions ?? []);
```

- Replace the hero `<Image source={require("../../assets/art/creation-hands-orb.jpg")} ... />` block with:

```tsx
<LivingHero lean={lean} />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit` — Expected: clean.

- [ ] **Step 4: Verify live in simulator**

With wrangler dev (from `apps/api`) and Metro (from `apps/mobile`) running:

```bash
UDID=$(xcrun simctl list devices booted | grep -oE '[0-9A-F-]{36}' | head -1)
xcrun simctl terminate $UDID host.exp.Exponent; sleep 1
xcrun simctl openurl $UDID "exp://127.0.0.1:8081"
sleep 20
xcrun simctl io $UDID recordVideo --codec h264 /tmp/hero.mov & REC=$!
sleep 4; kill -INT $REC
```

Expected: video shows the orb nucleus swirling and hands alive on the parchment; no black box behind the loop (alpha intact); no jank.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/LivingHero.tsx apps/mobile/src/app/index.tsx
git commit -m "feat(mobile): living hero — alpha loop + crowd-mood glow on home"
```

---

### Task 4: Wax-seal stamp

Sealing gets its physical beat: a gold roundel bearing the card's numeral stamps down onto the card face with a heavy haptic, then the flip proceeds.

**Files:**
- Create: `apps/mobile/src/ui/SealStamp.tsx`
- Modify: `apps/mobile/src/ui/OracleCard.tsx` (seal flow + render stamp on front face)

**Interfaces:**
- Consumes: `numeral(slot)` from `./CardChrome`; `Ritual` from `./Text`; theme colors.
- Produces: `SealStamp({ numeral }: { numeral: string })` and `STAMP_MS = 240`. OracleCard's `onSealed()` now fires `STAMP_MS + 320` ms after a successful submit (immediately under reduced motion).

- [ ] **Step 1: Write the stamp component**

Create `apps/mobile/src/ui/SealStamp.tsx`:

```tsx
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { colors } from "../theme";
import { Ritual } from "./Text";

export const STAMP_MS = 240;

// The wax seal: a gold roundel bearing the card's numeral, stamped onto the
// card face the moment the prophecy is sealed. Lives on the front face only,
// so it rides along into the flip.
export function SealStamp({ numeral }: { numeral: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withTiming(1, { duration: STAMP_MS, easing: Easing.out(Easing.poly(4)) });
  }, [p]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ scale: 1.6 - 0.6 * p.value }, { rotate: "-8deg" }],
  }));
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      <Animated.View
        style={[
          {
            width: 92,
            height: 92,
            borderRadius: 46,
            borderWidth: 2,
            borderColor: colors.gold,
            backgroundColor: colors.goldWash,
            alignItems: "center",
            justifyContent: "center",
          },
          style,
        ]}
      >
        <View style={{ position: "absolute", top: 5, bottom: 5, left: 5, right: 5, borderRadius: 41, borderWidth: 1, borderColor: colors.gold }} />
        <Ritual bold size={30} color={colors.goldDeep} letterSpacing={0}>{numeral}</Ritual>
      </Animated.View>
    </View>
  );
}
```

- [ ] **Step 2: Wire it into the seal flow**

In `apps/mobile/src/ui/OracleCard.tsx`:
- Imports: `import { CardChrome, numeral } from "./CardChrome";` (extend the existing CardChrome import) and `import { SealStamp, STAMP_MS } from "./SealStamp";`.
- Add state next to `error`: `const [stamped, setStamped] = useState(false);`
- Replace the success branch of `seal()` (currently `markSealed(...); Haptics.notificationAsync(...); onSealed();`) with:

```tsx
      markSealed(q.id);
      if (reducedMotion) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onSealed();
        return;
      }
      setStamped(true);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), STAMP_MS);
      setTimeout(onSealed, STAMP_MS + 320);
```

- Render the stamp inside the FRONT `Animated.View`, immediately after `</CardChrome>`:

```tsx
        {stamped && <SealStamp numeral={numeral(q.slot)} />}
```

(No cleanup needed: the parent keys the card wrapper by question id, so a drawn card remounts fresh and `stamped` resets; `onSealed` only sets parent state, which outlives the timeout.)

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: both clean.

- [ ] **Step 4: Static verification**

The stamp end-state can be verified without tapping: temporarily render `<SealStamp numeral="III" />` unconditionally, cold-start, screenshot, confirm roundel centered/rotated over the card, then revert the temp edit. The full seal→stamp→flip sequence in motion needs a hand tap — flag it for the user at handoff.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/SealStamp.tsx apps/mobile/src/ui/OracleCard.tsx
git commit -m "feat(mobile): wax-seal stamp on SEAL THE PROPHECY"
```

---

### Task 5: Deck-draw card motion

**Files:**
- Modify: `apps/mobile/src/app/round.tsx`

**Interfaces:**
- Consumes: the existing `Animated.View key={current.id} entering={...}` wrapper.
- Produces: cards deal in from the bottom edge with a slight rotation; reduced motion falls back to a short fade.

- [ ] **Step 1: Swap the entering animation**

In `apps/mobile/src/app/round.tsx`:
- Change the Reanimated import to `import Animated, { Easing, FadeIn, Keyframe } from "react-native-reanimated";` and add `import { useReducedMotion } from "react-native-reanimated";` (same line). Remove `FadeInDown` if now unused.
- At module scope (below imports):

```tsx
// Cards come off a deck: up from the bottom edge, slightly rotated, settling
// with the house easing. Reduced motion gets a plain 200ms fade.
const DealIn = new Keyframe({
  0: { transform: [{ translateY: 560 }, { rotate: "-5deg" }], opacity: 0.9 },
  100: { transform: [{ translateY: 0 }, { rotate: "0deg" }], opacity: 1, easing: Easing.out(Easing.poly(4)) },
}).duration(480);
```

- Inside `Round()`, add `const reducedMotion = useReducedMotion();`
- Change the card wrapper to:

```tsx
<Animated.View key={current.id} entering={reducedMotion ? FadeIn.duration(200) : DealIn}>
```

Fallback if `Keyframe` misbehaves on this Reanimated version (visual jank or a runtime warning): use `SlideInDown.duration(480).easing(Easing.out(Easing.poly(4)))` and drop the rotation.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit` — Expected: clean.

- [ ] **Step 3: Verify live**

Cold-start to `exp://127.0.0.1:8081/--/round` and record 3s of video (same recipe as Task 3 Step 4). Expected: the first card deals up from the bottom with a settle; no clipping against the progress numerals.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/round.tsx
git commit -m "feat(mobile): deal cards from the deck"
```

---

### Task 6: Share pattern line (TDD)

The share artifact gains Wordle's trick: a text pattern anyone can parse in a feed — `I✓ II✗ III· IV∅ V✓` — plus the same pattern rendered as colored numerals on the night card.

**Files:**
- Create: `apps/mobile/src/game/sharePattern.ts`
- Test: `apps/mobile/test/sharePattern.test.ts`
- Modify: `apps/mobile/src/ui/ShareCard.tsx` (consume sharePattern, drop its own `shareMessage`, add numerals row)
- Modify: `apps/mobile/src/app/reveal/[date].tsx` (build `results`, adjust share-button condition)

**Interfaces:**
- Consumes: reveal data `d.questions: { slot: number; outcome: string; my: { points: number | null } | null }[]`.
- Produces: `type QuestionResult = "win" | "loss" | "void" | "none"`; `patternLine(results): string`; `shareMessage({ date, dayPoints, results }): string`. `ShareCardData` becomes `{ date: string; dayPoints: number; bigOneText: string | null; bigOneCrowdPct: number | null; results: ReadonlyArray<QuestionResult> }` — `wins`/`answered` are removed and derived internally.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/test/sharePattern.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { patternLine, shareMessage } from "../src/game/sharePattern";

describe("patternLine", () => {
  it("pairs Roman numerals with result marks", () => {
    expect(patternLine(["win", "loss", "none", "void", "win"])).toBe("I✓ II✗ III· IV∅ V✓");
  });
});

describe("shareMessage", () => {
  it("composes date, pattern, signed points, and the taunt", () => {
    expect(shareMessage({ date: "2026-08-26", dayPoints: 58, results: ["win", "loss", "win", "win", "win"] }))
      .toBe("🔮 ORACLE 2026-08-26 — I✓ II✗ III✓ IV✓ V✓ · +58 · can you outsee me?");
  });
  it("keeps the minus sign on negative days", () => {
    expect(shareMessage({ date: "2026-08-26", dayPoints: -12, results: ["loss", "none", "none", "none", "none"] }))
      .toContain("· -12 ·");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @oracle/mobile test`
Expected: FAIL — cannot resolve `../src/game/sharePattern`.

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/game/sharePattern.ts`:

```ts
// The share pattern: Wordle's feed-readable artifact, in Roman numerals.
// win ✓ · loss ✗ · void ∅ · unanswered ·
export type QuestionResult = "win" | "loss" | "void" | "none";

export const RESULT_MARKS: Record<QuestionResult, string> = { win: "✓", loss: "✗", void: "∅", none: "·" };
const NUMERALS = ["I", "II", "III", "IV", "V"];

export function patternLine(results: ReadonlyArray<QuestionResult>): string {
  return results.map((r, i) => `${NUMERALS[i] ?? String(i + 1)}${RESULT_MARKS[r]}`).join(" ");
}

export function shareMessage(d: { date: string; dayPoints: number; results: ReadonlyArray<QuestionResult> }): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  return `🔮 ORACLE ${d.date} — ${patternLine(d.results)} · ${points} · can you outsee me?`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @oracle/mobile test` — Expected: all pass.

- [ ] **Step 5: Rewire ShareCard**

In `apps/mobile/src/ui/ShareCard.tsx`:
- Add `import { shareMessage, type QuestionResult } from "../game/sharePattern";` and delete the local `shareMessage` function.
- Change `ShareCardData` to:

```ts
export interface ShareCardData {
  date: string;
  dayPoints: number;
  bigOneText: string | null;
  bigOneCrowdPct: number | null;
  results: ReadonlyArray<QuestionResult>;
}
```

- In `ShareCardCanvas`, derive the old numbers and add night-tier loss color next to the other night constants:

```ts
const NIGHT_LOSS = "#D9705A"; // text-tier oxblood for the night ground
```

```ts
  const wins = data.results.filter((r) => r === "win").length;
  const answered = data.results.filter((r) => r !== "none").length;
  const scoreLine = `${wins}/${answered} · ${points}`;
```

- Add the numerals row between the orb and the score. Cinzel has no ✓/✗ glyphs and Skia has no fallback, so the pattern is encoded by color alone (gold = win, warm oxblood = loss, dim = void/unanswered — the message string carries the exact marks). Insert after the orb `<SkImage>` line:

```tsx
      {numeralFont && (() => {
        const nums = ["I", "II", "III", "IV", "V"];
        const gap = 34;
        const widths = nums.map((n) => numeralFont.measureText(n).width);
        const total = widths.reduce((a, b) => a + b, 0) + gap * (nums.length - 1);
        let x = (CARD_W - total) / 2;
        return nums.map((n, i) => {
          const r = data.results[i] ?? "none";
          const color = r === "win" ? colors.gold : r === "loss" ? NIGHT_LOSS : NIGHT_DIM;
          const el = <SkText key={n} font={numeralFont} text={n} x={x} y={672} color={color} />;
          x += widths[i] + gap;
          return el;
        });
      })()}
```

- Nudge the lower block down to make room: score `y={706}` → `y={724}`, big one `y={790}` → `y={802}`, crowd line `y={830}` → `y={840}`. Rules stay put.

- [ ] **Step 6: Rewire the reveal screen**

In `apps/mobile/src/app/reveal/[date].tsx`:
- Add `import type { QuestionResult } from "../../game/sharePattern";`
- Replace the `cardData` construction (and delete the now-unused `answered` const above it):

```tsx
  const results = [...d.questions].sort((a, b) => a.slot - b.slot).map((q): QuestionResult =>
    !q.my ? "none" : q.outcome === "void" ? "void" : (q.my.points ?? 0) > 0 ? "win" : "loss");
  const cardData: ShareCardData = {
    date: d.date,
    dayPoints: d.day_points,
    bigOneText: big?.text ?? null,
    bigOneCrowdPct: big?.crowd_yes_pct ?? null,
    results,
  };
```

- Change the share-button condition `{answered > 0 && (` to `{results.some((r) => r !== "none") && (`.

- [ ] **Step 7: Typecheck + tests**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: clean; all tests pass.

- [ ] **Step 8: Verify the night card visually**

Temporarily change the ShareCard canvas style `left: -9999` to `left: 0` with `transform: [{ scale: 0.55 }], transformOrigin: "top left"`, cold-start to `exp://127.0.0.1:8081/--/reveal/2026-08-20`, screenshot, confirm: numerals row centered between orb and score, colors legible, no overlap. REVERT the temp edit.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/game/sharePattern.ts apps/mobile/test/sharePattern.test.ts apps/mobile/src/ui/ShareCard.tsx "apps/mobile/src/app/reveal/[date].tsx"
git commit -m "feat(mobile): wordle-grade share pattern — numerals on card + message"
```

---

### Task 7: Full-pass verification and evidence

**Files:**
- Create: `docs/superpowers/plans/assets/delight-pass/` (screenshots + clips)

- [ ] **Step 1: Clean state**

Run: `pnpm --filter @oracle/mobile exec tsc --noEmit && pnpm --filter @oracle/mobile test`
Expected: clean, all tests green. `git status --porcelain` shows no stray temp edits.

- [ ] **Step 2: Capture evidence**

With API + Metro up, cold-start and capture: (a) 4s video of home (living hero swirling), (b) 3s video of round entry (deal-in), (c) screenshot of reveal. Copy into `docs/superpowers/plans/assets/delight-pass/`.

- [ ] **Step 3: Commit evidence**

```bash
git add docs/superpowers/plans/assets/delight-pass/
git commit -m "chore(mobile): delight-pass evidence"
```

- [ ] **Step 4: Hand-test handoff**

Tell the user what needs a human hand: (1) seal a card — feel the stamp + heavy haptic, watch stamp→flip; (2) fire the share sheet from a played round and check the pattern message; (3) confirm the hero loop doesn't stutter on device (simulator decode ≠ device decode).

---

## Self-Review Notes

- **Spec coverage:** hero loop (Task 1+3), crowd-mood glow with anti-herding intact (Task 2+3), wax seal (Task 4), deck draw (Task 5), share pattern on both message and card (Task 6). Deferred by design: against-the-tide celebration, noon countdown, count-up points, sibyl medallions (tier 2/3 of the ideation — separate pass).
- **Type consistency:** `QuestionResult` defined once in `sharePattern.ts`, imported by ShareCard and reveal. `STAMP_MS` exported from SealStamp, consumed by OracleCard. `orbGlowRgb` tuple consumed by LivingHero.
- **Skia glyph rule** respected: night-card pattern is color-coded numerals, no ✓/✗ in SkText.
