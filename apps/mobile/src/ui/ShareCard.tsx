import { RefObject } from "react";
import { Canvas, Rect, Circle, Line, Fill, vec, Text as SkText, Image as SkImage, RadialGradient, useCanvasRef, useFont, useImage } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";
import { PatinaHalo } from "./TerminalPatina";
import { shareMessage, type QuestionResult } from "../game/sharePattern";
import { capture } from "../analytics/analytics";
import { DUEL_ART } from "./DuelPortrait";
import { LITURGY_LINES } from "@oracle/core";

// Offscreen Skia surface (design spec §7) shaped as a literal oracle card
// (5:8, frame + register marks). The app lives in the museum by day; the
// shared prophecy goes out in the night realm — midnight ground, glowing orb
// (design/art-direction/orb-on-midnight-navy.png).
export const CARD_W = 640;
export const CARD_H = 1024;
const INSET = 30;
const TICK = 22;
const OVER = 9;
export const NIGHT_LINE = "rgba(247,246,242,0.16)";
export const NIGHT_DIM = "rgba(247,246,242,0.55)";
const NIGHT_LOSS = "#D9705A"; // text-tier vermilion for the midnight ground (5.3:1)

export interface ShareCardData {
  duelText?: string;
  duelScores?: { you: number; oracle: number };
  date: string;
  dayPoints: number;
  bigOneText: string | null;
  bigOneCrowdPct: number | null;
  bigOneMarketPct: number | null;
  results: ReadonlyArray<QuestionResult>;
  // The machine's own count against the day (design's Oracle-record beat).
  // Omitted entirely -- rather than passed as null -- by a caller with no
  // forecast for the day, so the line below simply does not render. The
  // canvas renders this prop; it must never derive it from `results`.
  oracleDayCounts?: { you: number; oracle: number };
}

export async function shareSnapshot(ref: RefObject<any>, filename: string, dialogTitle: string): Promise<void> {
  const image = ref.current?.makeImageSnapshot();
  if (!image) throw new Error("card not ready");
  const bytes = image.encodeToBytes();
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.write(bytes);
  const sharing = Sharing.shareAsync(file.uri, { mimeType: "image/png", dialogTitle });
  // Shared home for both share surfaces (round spread + plaque) — one
  // capture covers both call sites.
  capture("share_sheet_opened", { filename });
  await sharing;
}

export async function shareCard(ref: RefObject<any>, data: ShareCardData): Promise<void> {
  await shareSnapshot(ref, `oracle-${data.date}.png`, shareMessage(data));
}

function ellipsize(text: string, font: { measureText(t: string): { width: number } } | null, maxWidth: number): string {
  if (!font) return text;
  if (font.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && font.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function centered(font: { measureText(t: string): { width: number } } | null, text: string): number {
  return font ? (CARD_W - font.measureText(text).width) / 2 : CARD_W / 2;
}

export function RegisterMarks() {
  const xs = [INSET, CARD_W - INSET];
  const ys = [INSET, CARD_H - INSET];
  const lines: { p1: [number, number]; p2: [number, number] }[] = [];
  for (const x of xs) for (const y of ys) {
    lines.push({ p1: [x - OVER, y], p2: [x - OVER + TICK, y] });
    lines.push({ p1: [x, y - OVER], p2: [x, y - OVER + TICK] });
  }
  return (
    <>
      {lines.map((l, i) => (
        <Line key={i} p1={vec(l.p1[0], l.p1[1])} p2={vec(l.p2[0], l.p2[1])} color={colors.agedGold} strokeWidth={1.5} opacity={0.9} />
      ))}
    </>
  );
}

export function ShareCardCanvas({ canvasRef, data }: { canvasRef: ReturnType<typeof useCanvasRef>; data: ShareCardData }) {
  const portrait = useImage(DUEL_ART);
  const orb = useImage(require("../../assets/art/orb.png"));
  const ritual = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 52);
  const numeralFont = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 22);
  const score = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 40);
  const display = useFont(require("../../assets/fonts/Marcellus-Regular.ttf"), 24);
  const mono = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 18);
  const monoSmall = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 12);

  const points = data.dayPoints >= 0 ? `+${data.dayPoints}` : String(data.dayPoints);
  const wins = data.results.filter((r) => r === "win").length;
  const answered = data.results.filter((r) => r !== "none").length;
  const scoreLine = data.duelScores ? "CONFIDENCE POINTS" : `${wins}/${answered} · ${points}`;
  const bigOne = data.bigOneText ? ellipsize(data.bigOneText, display, CARD_W - 130) : null;
  // No "✶" here: Skia text has no font fallback and Plex Mono lacks the glyph.
  const crowdLine = data.bigOneCrowdPct !== null ? `THE BIG ONE · CROWD SAID ${data.bigOneCrowdPct}% YES` : null;
  // Phase 2 market display: only when the question was adapted from a live market.
  const marketLine = data.bigOneMarketPct !== null ? `THE MARKET SAID ${data.bigOneMarketPct}% YES` : null;
  // The machine's own count against the day (design's Oracle-record beat).
  // Omitted by the caller -- not merely null -- on a day it never forecast,
  // so there is nothing to check for beyond the prop's own presence.
  const oracleLine = data.duelScores ? (data.duelScores.you > data.duelScores.oracle ? "YOU OUTSAW THE ORACLE" : data.duelScores.you < data.duelScores.oracle ? "THE ORACLE SAW FURTHER" : "YOU AND THE ORACLE STAND LEVEL") : data.duelText ?? (data.oracleDayCounts
    ? `THE ORACLE ${data.oracleDayCounts.oracle} · YOU ${data.oracleDayCounts.you}`
    : null);

  return (
    <Canvas ref={canvasRef} style={{ position: "absolute", left: -9999, top: 0, width: CARD_W, height: CARD_H }}>
      <Fill color={colors.midnightMuseum} />
      <Rect x={INSET + 0.5} y={INSET + 0.5} width={CARD_W - 2 * INSET - 1} height={CARD_H - 2 * INSET - 1} style="stroke" strokeWidth={1} color={NIGHT_LINE} />
      <RegisterMarks />
      {numeralFont && <SkText font={numeralFont} text="V" x={centered(numeralFont, "V")} y={92} color={colors.agedGold} />}
      {ritual && <SkText font={ritual} text="ORACLE" x={centered(ritual, "ORACLE")} y={152} color={colors.museumWhite} />}
      {mono && <SkText font={mono} text={`DAY ${data.date}`} x={centered(mono, `DAY ${data.date}`)} y={192} color={colors.agedGold} />}
      <Line p1={vec(INSET + 40, 218)} p2={vec(CARD_W - INSET - 40, 218)} color={NIGHT_LINE} strokeWidth={1} />
      {data.duelScores && portrait ? <>
        <SkImage image={portrait} x={INSET + 1} y={246} width={CARD_W - 2 * INSET - 2} height={316} fit="contain" />
        {mono && ["YOU", "THE ORACLE"].map((label, index) => <SkText key={label} font={mono} text={label}
          x={(index === 0 ? 180 : 460) - mono.measureText(label).width / 2} y={582} color={colors.agedGold} />)}
        {score && [data.duelScores.you, data.duelScores.oracle].map((value, index) => <SkText key={index} font={score} text={String(value)}
          x={(index === 0 ? 180 : 460) - score.measureText(String(value)).width / 2} y={626} color={colors.museumWhite} />)}
      </> : <>
      <Circle cx={CARD_W / 2} cy={432} r={280}>
        <RadialGradient c={vec(CARD_W / 2, 432)} r={280} colors={["rgba(247,246,242,0.28)", "rgba(183,169,228,0.12)", "rgba(18,26,43,0)"]} />
      </Circle>
      {/* Terminal Patina halo atmosphere (brief §4): sparse glass-blue glyphs
          collect around the orb halo. Drawn UNDER the orb so the rim overdraws
          the inner cells and the warm center stays completely clear; the outer
          radius stops short of the divider and the pattern row (copy-safe). */}
      <PatinaHalo
        x={CARD_W / 2 - 220}
        y={432 - 220}
        width={440}
        height={440}
        center={[CARD_W / 2, 432]}
        innerR={160}
        outerR={200}
        seed={[...data.date].reduce((a, c) => a + c.charCodeAt(0), 0) % 97}
      />
      {orb && <SkImage image={orb} x={CARD_W / 2 - 180} y={252} width={360} height={360} fit="contain" />}
      </>}
      {/* The pattern row: numerals colored by result (gold win / warm loss / dim
          void+unanswered). Color-only here — Cinzel has no ✓/✗ and Skia has no
          font fallback; the share message string carries the exact marks. */}
      {numeralFont && (() => {
        const nums = ["I", "II", "III", "IV", "V"];
        const gap = 34;
        const widths = nums.map((n) => numeralFont.measureText(n).width);
        const total = widths.reduce((a, b) => a + b, 0) + gap * (nums.length - 1);
        let x = (CARD_W - total) / 2;
        return nums.map((n, i) => {
          const r = data.results[i] ?? "none";
          const color = r === "win" ? colors.agedGold : r === "loss" ? NIGHT_LOSS : NIGHT_DIM;
          const el = <SkText key={n} font={numeralFont} text={n} x={x} y={data.duelScores ? 724 : 672} color={color} />;
          x += widths[i] + gap;
          return el;
        });
      })()}
      {(data.duelScores ? mono : score) && <SkText font={(data.duelScores ? mono : score)!} text={scoreLine} x={centered(data.duelScores ? mono : score, scoreLine)} y={data.duelScores ? 660 : 724} color={colors.warmCenter} />}
      {display && bigOne && <SkText font={display} text={bigOne} x={centered(display, bigOne)} y={802} color={colors.museumWhite} />}
      {mono && crowdLine && <SkText font={mono} text={crowdLine} x={centered(mono, crowdLine)} y={840} color={NIGHT_DIM} />}
      {monoSmall && marketLine && <SkText font={monoSmall} text={marketLine} x={centered(monoSmall, marketLine)} y={866} color={NIGHT_DIM} />}
      {/* Below the crowd line, in the same register the market line uses --
          the market line (added since this row was specced) already sits at
          the crowd-line-plus-26 slot this was to occupy, so this holds the
          next one down, still clear of the divider. Gold only when the
          player actually outdid the machine today. */}
      {monoSmall && oracleLine && (
        <SkText
          font={monoSmall}
          text={oracleLine}
          x={centered(monoSmall, oracleLine)}
          y={892}
          color={data.oracleDayCounts && data.oracleDayCounts.you > data.oracleDayCounts.oracle ? colors.warmCenter : NIGHT_DIM}
        />
      )}
      <Line p1={vec(INSET + 40, 900)} p2={vec(CARD_W - INSET - 40, 900)} color={NIGHT_LINE} strokeWidth={1} />
      {mono && <SkText font={mono} text="CAN YOU OUTSEE ME?" x={centered(mono, "CAN YOU OUTSEE ME?")} y={938} color={colors.agedGold} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[0]} x={centered(monoSmall, LITURGY_LINES[0])} y={968} color={NIGHT_DIM} />}
      {monoSmall && <SkText font={monoSmall} text={LITURGY_LINES[1]} x={centered(monoSmall, LITURGY_LINES[1])} y={986} color={NIGHT_DIM} />}
    </Canvas>
  );
}
