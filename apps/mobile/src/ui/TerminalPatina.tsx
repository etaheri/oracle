import { useEffect } from "react";
import { Canvas, Fill, ImageShader, Shader, Skia, useClock, useImage } from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

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
  float show = step(1.0 - gate, hash21(cellID + t));
  float idx = 1.0 + floor(hash21(cellID * 1.7 + t * 0.37) * (glyphCount - 1.0));
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

const LAVENDER = [183, 169, 228] as const;
const GOLD = [126, 101, 56] as const; // goldText

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

// Atmospheric Dust (spec mode 3): a slow-stepping glyph halo. The clock is
// quantized to 3 steps/s — the pattern must never re-randomize per frame.
export function AsciiDust({
  size = 180,
  color = LAVENDER,
  intensity = 0.28,
  gate = 0.22,
  innerRatio = 0.24,
  outerRatio = 0.46,
}: {
  size?: number;
  color?: readonly [number, number, number];
  intensity?: number;
  gate?: number;
  innerRatio?: number;
  outerRatio?: number;
}) {
  const atlas = useImage(ATLAS);
  const clock = useClock();
  const reducedMotion = useReducedMotion();

  const uniforms = useDerivedValue(() => ({
    atlasSize: [ATLAS_W, ATLAS_H],
    glyphCount: GLYPH_COUNT,
    cell: [CELL_W, CELL_H],
    intensity,
    t: reducedMotion ? 1 : Math.floor(clock.value / 333),
    tint: tintOf(color),
    center: [size / 2, size / 2],
    innerR: size * innerRatio,
    outerR: size * outerRatio,
    gate,
  }), [size, color, intensity, gate, innerRatio, outerRatio, reducedMotion]);

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
      t: Math.floor(clock.value / 125),
      tint: tintOf(GOLD),
      center: [width / 2, height / 2],
      innerR: Math.max(0, outerR - width * 0.45),
      outerR,
      gate: 0.35,
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
