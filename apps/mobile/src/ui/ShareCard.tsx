import { RefObject } from "react";
import { Canvas, Rect, Circle, Line, Fill, vec, Text as SkText, Image as SkImage, RadialGradient, useCanvasRef, useFont, useImage } from "@shopify/react-native-skia";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { colors } from "../theme";

// Offscreen Skia surface (design spec §7) shaped as a literal oracle card
// (5:8, frame + register marks). The app lives on parchment by day; the
// shared prophecy goes out in the night realm — midnight ground, glowing orb
// (design/art-direction/orb-on-midnight-navy.png).
export const CARD_W = 640;
export const CARD_H = 1024;
const INSET = 30;
const TICK = 22;
const OVER = 9;
const NIGHT_LINE = "rgba(233,225,205,0.18)";
const NIGHT_DIM = "rgba(233,225,205,0.55)";

export interface ShareCardData {
  date: string;
  wins: number;
  answered: number;
  dayPoints: number;
  bigOneText: string | null;
  bigOneCrowdPct: number | null;
}

export function shareMessage(d: ShareCardData): string {
  const points = d.dayPoints >= 0 ? `+${d.dayPoints}` : String(d.dayPoints);
  return `🔮 ORACLE ${d.date} — ${d.wins}/${d.answered} · ${points} · can you outsee me?`;
}

export async function shareCard(ref: RefObject<any>, data: ShareCardData): Promise<void> {
  const image = ref.current?.makeImageSnapshot();
  if (!image) throw new Error("card not ready");
  const bytes = image.encodeToBytes();
  const file = new File(Paths.cache, `oracle-${data.date}.png`);
  if (file.exists) file.delete();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: "image/png", dialogTitle: shareMessage(data) });
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

function RegisterMarks() {
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
        <Line key={i} p1={vec(l.p1[0], l.p1[1])} p2={vec(l.p2[0], l.p2[1])} color={colors.gold} strokeWidth={1.5} opacity={0.9} />
      ))}
    </>
  );
}

export function ShareCardCanvas({ canvasRef, data }: { canvasRef: ReturnType<typeof useCanvasRef>; data: ShareCardData }) {
  const orb = useImage(require("../../assets/art/orb.png"));
  const ritual = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 52);
  const numeralFont = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 22);
  const score = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 40);
  const display = useFont(require("../../assets/fonts/Marcellus-Regular.ttf"), 24);
  const mono = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 18);

  const points = data.dayPoints >= 0 ? `+${data.dayPoints}` : String(data.dayPoints);
  const scoreLine = `${data.wins}/${data.answered} · ${points}`;
  const bigOne = data.bigOneText ? ellipsize(data.bigOneText, display, CARD_W - 130) : null;
  // No "✶" here: Skia text has no font fallback and Plex Mono lacks the glyph.
  const crowdLine = data.bigOneCrowdPct !== null ? `THE BIG ONE · CROWD SAID ${data.bigOneCrowdPct}% YES` : null;

  return (
    <Canvas ref={canvasRef} style={{ position: "absolute", left: -9999, top: 0, width: CARD_W, height: CARD_H }}>
      <Fill color={colors.night} />
      <Rect x={INSET + 0.5} y={INSET + 0.5} width={CARD_W - 2 * INSET - 1} height={CARD_H - 2 * INSET - 1} style="stroke" strokeWidth={1} color={NIGHT_LINE} />
      <RegisterMarks />
      {numeralFont && <SkText font={numeralFont} text="V" x={centered(numeralFont, "V")} y={92} color={colors.gold} />}
      {ritual && <SkText font={ritual} text="ORACLE" x={centered(ritual, "ORACLE")} y={152} color={colors.nightBone} />}
      {mono && <SkText font={mono} text={`DAY ${data.date}`} x={centered(mono, `DAY ${data.date}`)} y={192} color={colors.gold} />}
      <Line p1={vec(INSET + 40, 218)} p2={vec(CARD_W - INSET - 40, 218)} color={NIGHT_LINE} strokeWidth={1} />
      <Circle cx={CARD_W / 2} cy={432} r={280}>
        <RadialGradient c={vec(CARD_W / 2, 432)} r={280} colors={["rgba(233,225,205,0.30)", "rgba(178,166,203,0.10)", "rgba(6,16,32,0)"]} />
      </Circle>
      {orb && <SkImage image={orb} x={CARD_W / 2 - 180} y={252} width={360} height={360} fit="contain" />}
      {score && <SkText font={score} text={scoreLine} x={centered(score, scoreLine)} y={706} color={colors.goldBright} />}
      {display && bigOne && <SkText font={display} text={bigOne} x={centered(display, bigOne)} y={790} color={colors.nightBone} />}
      {mono && crowdLine && <SkText font={mono} text={crowdLine} x={centered(mono, crowdLine)} y={830} color={NIGHT_DIM} />}
      <Line p1={vec(INSET + 40, 900)} p2={vec(CARD_W - INSET - 40, 900)} color={NIGHT_LINE} strokeWidth={1} />
      {mono && <SkText font={mono} text="CAN YOU OUTSEE ME?" x={centered(mono, "CAN YOU OUTSEE ME?")} y={950} color={colors.gold} />}
    </Canvas>
  );
}
