import { useEffect } from "react";
import { Canvas, Fill, ImageShader, Rect, Shader, Skia, useClock, useImage } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";
import { LEAN_FULL } from "../game/swipeLean";

// Terminal Patina (brand brief §4-5, spec 2026-08-26-terminal-patina-shader.md):
// sparse hash-selected monospace glyphs inside an annulus mask. Phase 1 has no
// source-image sampling — glyph choice is per-cell hash, so this is the
// "atmospheric" material, not image reconstruction (that's phase 2).
// Uniforms animate; the effect is compiled once at module load.
const ATLAS = require("../../assets/art/ascii-atlas.png");
const ATLAS_W = 768;
const ATLAS_H = 128;
const GLYPH_COUNT = 8;
const CELL_W = 9; // logical px; 27 physical @3x — above the 6px floor
const CELL_H = 12; // keeps the atlas cell's 3:4 aspect

const PATINA_SKSL = `
uniform shader glyphAtlas;
uniform float2 atlasSize;
uniform float glyphCount;
uniform float2 cell;
uniform float intensity;
uniform float t;
uniform float4 tint;
uniform float2 center;
uniform float innerR;
uniform float outerR;
uniform float gate;
// Per-cell clock (Atmospheric Dust): hold = [minSeconds, maxSeconds]. When
// hold.y > 0, t is continuous seconds and each cell derives its own tick from
// its own dwell time and phase, so re-rolls never land on a shared frame. When
// hold.y == 0, t is already an integer step shared by every cell (halo,
// activation) — legacy lockstep behavior.
uniform float2 hold;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

half4 main(float2 xy) {
  float2 cellID = floor(xy / cell);
  float2 localUV = fract(xy / cell);
  float2 cellCenter = (cellID + 0.5) * cell;
  float d = distance(cellCenter, center);
  float band = smoothstep(innerR - cell.y, innerR + cell.y, d)
             * (1.0 - smoothstep(outerR - cell.y, outerR + cell.y, d));
  float tick = t;
  if (hold.y > 0.0) {
    float seed = hash21(cellID * 3.1);
    float myHold = mix(hold.x, hold.y, seed);
    tick = floor(t / myHold + seed);
  }
  float show = step(1.0 - gate, hash21(cellID + tick));
  float idx = 1.0 + floor(hash21(cellID * 1.7 + tick * 0.37) * (glyphCount - 1.0));
  idx = min(idx, glyphCount - 1.0);
  float glyphW = atlasSize.x / glyphCount;
  float2 atlasPos = float2(idx * glyphW + localUV.x * glyphW, localUV.y * atlasSize.y);
  half4 g = glyphAtlas.eval(atlasPos);
  half a = half(g.a * band * show * intensity);
  return half4(half3(tint.rgb) * a, a);
}`;

// Guarded, not asserted (brief §11: the app must remain fully usable if shader
// effects are disabled) — a compile failure degrades to "no ASCII" rather than
// crashing the app.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  effect = Skia.RuntimeEffect.Make(PATINA_SKSL);
} catch (e) {
  console.error("Terminal Patina SkSL failed to compile:", e);
}
if (!effect) console.error("Terminal Patina SkSL unavailable — ASCII effects disabled");

const LAVENDER = [183, 169, 228] as const;
export const GOLD = [126, 101, 56] as const; // goldText
const GLASS_BLUE = [156, 181, 209] as const; // glassBlue
const ULTRAMARINE = [36, 61, 120] as const; // YES sleeve
const VERMILION = [168, 75, 53] as const; // NO sleeve

// Marked 'worklet' (spec deviation from brief's literal listing): this runs
// inside useDerivedValue on the UI thread, and Reanimated 4.5.1 does not
// auto-workletize a plain helper called from a worklet in this project's
// babel/Expo Go config — without the directive it native-crashes (SIGABRT,
// objc_exception_rethrow) as soon as the derived value is bound to the UI
// runtime. Verified by bisection: see task-2-report.md.
function tintOf(c: readonly [number, number, number]): [number, number, number, number] {
  "worklet";
  return [c[0] / 255, c[1] / 255, c[2] / 255, 1];
}

// Atmospheric Dust (spec mode 3): a glyph halo where each cell ticks on its
// own clock. A cell dwells DUST_HOLD[0]–DUST_HOLD[1] seconds (per-cell, hashed)
// before it re-rolls — blinks out, appears, or swaps glyph — so at any instant
// most of the field is still and a few glyphs tick over at unshared moments:
// hidden system activity, not a strobe. (V1 stepped every cell in lockstep at
// 3 Hz, which read as flashing and violated the brief's no-rapid-flicker rule.)
const DUST_HOLD: readonly [number, number] = [2, 6];

export function AsciiDust({
  size = 180,
  color = LAVENDER,
  intensity = 0.28,
  gate = 0.22,
  innerRatio = 0.24,
  outerRatio = 0.46,
  hold = DUST_HOLD,
}: {
  size?: number;
  color?: readonly [number, number, number];
  intensity?: number;
  gate?: number;
  innerRatio?: number;
  outerRatio?: number;
  // Per-cell dwell range. Home drives it from the crowd (see haloMood); the
  // default is the calm, unknown-crowd cadence.
  hold?: readonly [number, number];
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const uniforms = useDerivedValue(() => ({
    atlasSize: [ATLAS_W, ATLAS_H],
    glyphCount: GLYPH_COUNT,
    cell: [CELL_W, CELL_H],
    intensity,
    t: reducedMotion ? 1 : clock.value / 1000,
    tint: tintOf(color),
    center: [size / 2, size / 2],
    innerR: size * innerRatio,
    outerR: size * outerRatio,
    gate,
    hold: [hold[0], hold[1]],
  }), [size, color, intensity, gate, innerRatio, outerRatio, hold, reducedMotion]);

  if (!effect || !atlas) return null;
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}

// Terminal Patina proper (spec mode 1): the static museum-artifact treatment,
// for embedding inside an existing Skia canvas — glyphs collecting around an
// orb halo (brief §4 "halo atmosphere"). No clock: the mode is "static or
// nearly static" by definition, and its one consumer is the share-card
// snapshot, which must render deterministically. `seed` varies the glyph
// pattern between artifacts without animating it.
export function PatinaHalo({
  x,
  y,
  width,
  height,
  center,
  innerR,
  outerR,
  color = GLASS_BLUE,
  intensity = 0.34,
  gate = 0.2,
  cellW = 12,
  cellH = 16,
  seed = 7,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  center: readonly [number, number];
  innerR: number;
  outerR: number;
  color?: readonly [number, number, number];
  intensity?: number;
  gate?: number;
  cellW?: number;
  cellH?: number;
  seed?: number;
}) {
  const atlas = useImage(ATLAS);
  if (!effect || !atlas) return null;
  return (
    <Rect x={x} y={y} width={width} height={height}>
      <Shader
        source={effect}
        uniforms={{
          atlasSize: [ATLAS_W, ATLAS_H],
          glyphCount: GLYPH_COUNT,
          cell: [cellW, cellH],
          intensity,
          t: seed,
          tint: tintOf(color),
          center: [center[0], center[1]],
          innerR,
          outerR,
          gate,
          hold: [0, 0],
        }}
      >
        <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
      </Shader>
    </Rect>
  );
}

// Charge (the swipe's instrument): a glyph annulus over the card face in the
// side's sleeve tone, reading the pull live off the UI thread. The ring
// widens and densifies as conviction climbs — the machine's own alphabet
// where a soft glow would break the material system. `charge` is the
// resolved conviction (0..1) so hold-to-charge reads too; `pull` is the raw
// drag fraction so the field answers the very first slid point. Clock is
// quantized to 6 steps/s and the canvas only mounts while a pull or charge
// is live, so nothing repaints at rest.
export function AsciiCharge({ width, height, side, charge, pull }: {
  width: number;
  height: number;
  side: boolean; // true = YES (ultramarine), false = NO (vermilion)
  charge: number; // 0..1 resolved conviction
  pull: SharedValue<number>; // raw drag fraction −1..1; 0 under hold-to-charge
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const uniforms = useDerivedValue(() => {
    const a = Math.max(Math.min(1, Math.abs(pull.value) / LEAN_FULL), charge);
    const base = Math.min(width, height) / 2;
    return {
      atlasSize: [ATLAS_W, ATLAS_H],
      glyphCount: GLYPH_COUNT,
      cell: [CELL_W, CELL_H],
      intensity: 0.15 + 0.55 * a,
      t: Math.floor(clock.value / 166),
      tint: tintOf(side ? ULTRAMARINE : VERMILION),
      center: [width / 2, height / 2],
      innerR: base * (0.42 + 0.3 * a),
      outerR: base * (0.85 + 0.5 * a),
      gate: 0.16 + 0.3 * a,
      hold: [0, 0],
    };
  }, [width, height, side, charge]);

  if (reducedMotion || !effect || !atlas || width === 0 || height === 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}

// Activation (spec mode 2): a glyph ring travels outward across the artwork,
// intensity 0 -> 0.8 -> 0, then the overlay is inert. Fired by the seal flow.
export function AsciiActivation({
  width,
  height,
  durationMs = 560,
  debugProgress,
}: {
  width: number;
  height: number;
  durationMs?: number;
  debugProgress?: number;
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();
  const progress = useSharedValue(debugProgress ?? 0);

  useEffect(() => {
    if (debugProgress !== undefined) { progress.value = debugProgress; return; }
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.out(Easing.poly(4)) });
  }, [debugProgress, durationMs, progress]);

  const maxR = Math.hypot(width, height) / 2 + 40;
  const uniforms = useDerivedValue(() => {
    const p = progress.value;
    const outerR = p * maxR;
    return {
      atlasSize: [ATLAS_W, ATLAS_H],
      glyphCount: GLYPH_COUNT,
      cell: [CELL_W, CELL_H],
      intensity: 0.8 * (1 - Math.abs(2 * p - 1)),
      t: p >= 1 ? 0 : Math.floor(clock.value / 125),
      tint: tintOf(GOLD),
      center: [width / 2, height / 2],
      innerR: Math.max(0, outerR - width * 0.45),
      outerR,
      gate: 0.35,
      hold: [0, 0],
    };
  }, [width, height, maxR]);

  if (reducedMotion || !effect || !atlas || width === 0 || height === 0) return null;
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
        </Shader>
      </Fill>
    </Canvas>
  );
}
