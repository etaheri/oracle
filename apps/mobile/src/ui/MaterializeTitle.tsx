import { useEffect, useMemo } from "react";
import { View } from "react-native";
import {
  Canvas,
  Fill,
  ImageShader,
  Shader,
  Skia,
  useFont,
  useImage,
} from "@shopify/react-native-skia";
import { Easing, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { colors, trackTail } from "../theme";
import { Ritual } from "./Text";

// Materialization (brand brief §4, patina spec phase 2): the wordmark is
// reconstructed from ASCII — glyph cells sample the rasterized Cinzel
// letterforms' luminance, a reveal wave sweeps left to right, then the cells
// drop out hash-staggered as the carved text fades in beneath them. The cells
// that survive longest become a static edge residue (brief: "edge shimmer",
// frozen) so a whisper of computation stays in the artifact.
const ATLAS = require("../../assets/art/ascii-atlas.png");
const ATLAS_W = 768;
const ATLAS_H = 128;
const GLYPH_COUNT = 8;

const WORD = "OUTSEE";
// 34/8 rather than 40/11: at the old setting the wordmark was spaced like a
// luxury logotype rather than an inscription, and it was the only serif on a
// screen of eight mono rows. Tighter and smaller, it sits closer to the
// machine voice's optical weight while staying the temple's one carved word.
const SIZE = 34;
const TRACKING = 8;
// A fixed line box, generous enough to clear Cinzel's ascender and descender
// at SIZE. Both the shader canvas and the plain fallback centre inside it, so
// the wordmark occupies the same rows whether or not the Skia font and atlas
// have loaded — the epigraph below never shifts when they arrive.
const BOX_H = Math.round(SIZE * 1.5);
const CELL_W = 3.75; // ~10 rows of glyph cells across the cap height, so the pure-ASCII
const CELL_H = 5; // phase reads as letterforms; 11.25x15 physical @3x, above the 6px floor
const RASTER_SCALE = 2;

const MATERIALIZE_SKSL = `
uniform shader glyphAtlas;
uniform shader source;
uniform shader txtImg;
uniform float2 atlasSize;
uniform float glyphCount;
uniform float2 cell;
uniform float t;
uniform float p;
uniform float ta;
uniform float w;
uniform float gx;
uniform float4 ink;
uniform float4 gold;

float hash21(float2 q) {
  q = fract(q * float2(123.34, 456.21));
  q += dot(q, q + 45.32);
  return fract(q.x * q.y);
}

half4 main(float2 xy) {
  float2 cellID = floor(xy / cell);
  float2 localUV = fract(xy / cell);
  float2 cc = (cellID + 0.5) * cell;
  float lum = source.eval(cc).a;
  if (lum < 0.16) { return txtImg.eval(xy) * ta; }
  // The wave front finishes its sweep by p = 0.62; cells appear the moment it
  // passes them (terminal-quantized, no fade-in).
  float front = (min(p, 0.62) / 0.62) * (w + 120.0) - 60.0;
  float reached = step(cc.x, front);
  float h = hash21(cellID);
  // Hash-staggered dropout as the real text resolves underneath.
  float gone = step(h, smoothstep(0.60, 0.96, p));
  float live = reached * (1.0 - gone) * (0.40 + 0.60 * lum);
  // Edge residue: high-hash cells on the letterform boundary (partial area
  // coverage) survive as a faint static patina.
  // Residue was 10% of edge cells at 0.30 alpha — invisible at this size, which
  // is why the settled wordmark read as clean type rather than a patinated one.
  // 22% at 0.55: a permanent ASCII crust on the letterform boundary.
  float residue = smoothstep(0.86, 1.0, p) * step(0.78, h) * (1.0 - step(0.72, lum)) * 0.55;
  // Periodic breath: inside a narrow sweeping band, half the letterform cells
  // knock their portion of the carved text out and wear a glyph instead — the
  // brief's "edge shimmer" (ASCII replaces small portions of the silhouette).
  // gx sits far offscreen when idle.
  float band = 1.0 - smoothstep(0.0, 100.0, abs(cc.x - gx));
  float h2 = hash21(cellID * 2.3 + floor(t) * 0.11);
  float knock = step(0.35, band) * step(h2, 0.85);
  float flicker = knock * (0.65 + 0.35 * lum);
  float glow = 1.0 - smoothstep(0.0, 110.0, abs(cc.x - front));
  float idx = 1.0 + floor(hash21(cellID * 1.7 + t * 0.37) * (glyphCount - 1.0));
  idx = min(idx, glyphCount - 1.0);
  float gw = atlasSize.x / glyphCount;
  float2 ap = float2(idx * gw + localUV.x * gw, localUV.y * atlasSize.y);
  half4 g = glyphAtlas.eval(ap);
  float lit = max(live, flicker);
  half a = half(g.a * max(lit, residue));
  // The wave front is gold as it passes. What it leaves behind — the residue
  // cells that outlive the reveal — stays gold: patina is aged, not inked. The
  // breath keeps a trace of the same warmth so the glitch belongs to the crust
  // rather than reading as a separate black artifact.
  float aged = step(lit, residue) * step(0.001, residue) * 0.70;
  half3 col = mix(half3(ink.rgb), half3(gold.rgb), half(max(glow * 0.85, max(aged, knock * 0.25))));
  half4 gl = half4(col * a, a);
  half4 tx = txtImg.eval(xy) * half(ta * (1.0 - knock));
  return gl + tx * (1.0 - gl.a);
}`;

// Guarded, not asserted (brief §11): a compile failure falls back to the plain
// carved wordmark rather than crashing.
let effect: ReturnType<typeof Skia.RuntimeEffect.Make> = null;
try {
  effect = Skia.RuntimeEffect.Make(MATERIALIZE_SKSL);
} catch (e) {
  console.error("Materialize SkSL failed to compile:", e);
}

const INK = [0x17 / 255, 0x19 / 255, 0x1f / 255, 1] as const;
const GOLD = [0x7e / 255, 0x65 / 255, 0x38 / 255, 1] as const;

const CHURN_STEP_MS = 166; // ~6 steps/s while materializing, then frozen
const REVEAL_MS = 2100;

// The stable box. Overflow stays visible, so a font whose metrics exceed BOX_H
// draws past it rather than being clipped — it just never changes the row the
// epigraph starts on.
function Box({ children }: { children: React.ReactNode }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={WORD} style={{ height: BOX_H, alignItems: "center", justifyContent: "center" }}>
      {children}
    </View>
  );
}

function FallbackWordmark() {
  return (
    <Ritual bold size={SIZE} color={colors.ink} letterSpacing={TRACKING} style={{ ...trackTail(TRACKING) }}>
      {WORD}
    </Ritual>
  );
}

export function MaterializeTitle({ active }: { active: boolean }) {
  const reducedMotion = useReducedMotion();
  const font = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), SIZE);
  const atlas = useImage(ATLAS);
  const p = useSharedValue(0);
  const tick = useSharedValue(0);
  const gp = useSharedValue(-1); // glitch-band progress; negative = idle (band offscreen)

  // Rasterize the tracked wordmark once — it is both the luminance source the
  // shader samples and the crisp text that fades in underneath.
  const layout = useMemo(() => {
    if (!font) return null;
    const ids = font.getGlyphIDs(WORD);
    const advances = font.getGlyphWidths(ids);
    const m = font.getMetrics();
    const ascent = Math.ceil(-m.ascent);
    const h = ascent + Math.ceil(m.descent);
    const w = Math.ceil(advances.reduce((a, b) => a + b, 0) + TRACKING * (WORD.length - 1));
    const surface = Skia.Surface.MakeOffscreen(w * RASTER_SCALE, h * RASTER_SCALE);
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.scale(RASTER_SCALE, RASTER_SCALE);
    const paint = Skia.Paint();
    paint.setColor(Skia.Color(colors.ink));
    paint.setAntiAlias(true);
    let x = 0;
    for (let i = 0; i < WORD.length; i++) {
      canvas.drawText(WORD[i], x, ascent, paint, font);
      x += advances[i] + TRACKING;
    }
    const image = surface.makeImageSnapshot().makeNonTextureImage();
    // Luminance source at one pixel per glyph cell: the word is re-drawn at
    // cell resolution so anti-aliasing computes area coverage — thin strokes
    // still light their cells, where point-sampling the full raster misses
    // them (verified on-device: sparse reconstruction).
    const cols = Math.ceil(w / CELL_W);
    const rows = Math.ceil(h / CELL_H);
    const lumSurface = Skia.Surface.MakeOffscreen(cols, rows);
    if (!lumSurface) return null;
    const lc = lumSurface.getCanvas();
    lc.scale(cols / w, rows / h);
    let lx = 0;
    for (let i = 0; i < WORD.length; i++) {
      lc.drawText(WORD[i], lx, ascent, paint, font);
      lx += advances[i] + TRACKING;
    }
    const lumImage = lumSurface.makeImageSnapshot().makeNonTextureImage();
    return { w, h, image, lumImage };
  }, [font]);

  useEffect(() => {
    if (!active || reducedMotion) return;
    p.value = 0;
    p.value = withTiming(1, { duration: REVEAL_MS, easing: Easing.out(Easing.cubic) });
    // Glyph churn is interval-stepped (never per-frame) and stops with the
    // reveal, so the settled canvas invalidates nothing.
    const churn = setInterval(() => { tick.value = tick.value + 1; }, CHURN_STEP_MS);
    const stop = setTimeout(() => clearInterval(churn), REVEAL_MS + 200);
    return () => { clearInterval(churn); clearTimeout(stop); };
  }, [active, reducedMotion, p, tick]);

  // The breath: every 6-11s a narrow band sweeps the settled wordmark for
  // ~700ms while the residue re-rolls its glyphs, then stillness again. Sparse
  // and quantized (brief §4: no rapid flickering; discovered as a detail).
  useEffect(() => {
    if (!active || reducedMotion) return;
    let alive = true;
    const ids: ReturnType<typeof setTimeout>[] = [];
    const intervals: ReturnType<typeof setInterval>[] = [];
    const schedule = () => {
      ids.push(setTimeout(() => {
        if (!alive) return;
        gp.value = 0;
        gp.value = withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) });
        const churn = setInterval(() => { tick.value = tick.value + 1; }, 180);
        intervals.push(churn);
        ids.push(setTimeout(() => { clearInterval(churn); gp.value = -1; }, 780));
        schedule();
      }, 6000 + Math.random() * 5000));
    };
    schedule();
    return () => { alive = false; ids.forEach(clearTimeout); intervals.forEach(clearInterval); };
  }, [active, reducedMotion, gp, tick]);

  const uniforms = useDerivedValue(() => ({
    atlasSize: [ATLAS_W, ATLAS_H],
    glyphCount: GLYPH_COUNT,
    cell: [CELL_W, CELL_H],
    t: tick.value,
    p: p.value,
    // Held back until the glyph reconstruction has carried the form on its
    // own, then the carved text resolves through the dropout.
    ta: Math.min(1, Math.max(0, (p.value - 0.68) / 0.27)),
    w: layout?.w ?? 0,
    gx: gp.value < 0 ? -9999 : gp.value * ((layout?.w ?? 0) + 160) - 80,
    ink: INK,
    gold: GOLD,
  }), [layout]);

  if (reducedMotion || !effect || !layout || !atlas) return <Box><FallbackWordmark /></Box>;

  return (
    <Box>
      <Canvas style={{ width: layout.w, height: layout.h }}>
        <Fill>
          <Shader source={effect} uniforms={uniforms}>
            <ImageShader image={atlas} rect={{ x: 0, y: 0, width: ATLAS_W, height: ATLAS_H }} />
            <ImageShader image={layout.lumImage} fit="fill" rect={{ x: 0, y: 0, width: layout.w, height: layout.h }} />
            <ImageShader image={layout.image} fit="fill" rect={{ x: 0, y: 0, width: layout.w, height: layout.h }} />
          </Shader>
        </Fill>
      </Canvas>
    </Box>
  );
}
