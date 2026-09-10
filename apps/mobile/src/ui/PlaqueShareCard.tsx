import { Canvas, Fill, Line, Rect, Text as SkText, Image as SkImage, vec, useCanvasRef, useFont, useImage } from "@shopify/react-native-skia";
import type { MeLedger } from "@oracle/core";
import { colors } from "../theme";
import { PatinaHalo } from "./TerminalPatina";
import { RegisterMarks, ShareFooter, NIGHT_LINE, NIGHT_DIM } from "./ShareCard";

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
  const ritual44 = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 44);
  // Cinzel 44 overflows the 580px frame width for the two longest epithet
  // titles ("HIGH PRIEST OF CONVICTION" at 692px, "TRUE BELIEVER OF THE
  // CROWD" at 722px) — measured off the actual glyph advances, not eyeballed.
  // Drop to 34 for those rather than ellipsize (identity copy is never cut).
  const ritual34 = useFont(require("../../assets/fonts/Cinzel-SemiBold.ttf"), 34);
  const receiptFont = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 16);
  const mono = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 18);
  const monoSmall = useFont(require("../../assets/fonts/IBMPlexMono-Regular.ttf"), 12);

  const titleFits44 = ritual44 ? ritual44.measureText(data.epithet.title).width <= PLAQUE_W - 2 * INSET : true;
  const ritual = titleFits44 ? ritual44 : ritual34;

  const pct = (v: number | null) => (v === null ? "-" : `${v}%`);
  const statLines = [
    `ROUNDS PLAYED ${data.days_consulted} · STREAK ${data.streak}`,
    `ACCURACY ${pct(data.accuracy_pct)} · CONFIDENCE ${pct(data.avg_confidence)}`,
    `YOUR FORECAST RATING ${data.oracle_score ?? "UNWRITTEN"}`,
    `ORACLE RATING ${data.oracle.score ?? "UNWRITTEN"}`,
    `AGAINST THE TIDE x${data.tide_wins}`,
  ];

  return (
    <Canvas ref={canvasRef} style={{ position: "absolute", left: -9999, top: 0, width: PLAQUE_W, height: PLAQUE_H }}>
      <Fill color={colors.midnightMuseum} />
      <Rect x={INSET + 0.5} y={INSET + 0.5} width={PLAQUE_W - 2 * INSET - 1} height={PLAQUE_H - 2 * INSET - 1} style="stroke" strokeWidth={1} color={NIGHT_LINE} />
      <RegisterMarks />
      {mono && <SkText font={mono} text="OUTSEEN · YOUR LEDGER" x={centered(mono, "OUTSEEN · YOUR LEDGER")} y={110} color={colors.agedGold} />}
      <Line p1={vec(INSET + 40, 140)} p2={vec(PLAQUE_W - INSET - 40, 140)} color={NIGHT_LINE} strokeWidth={1} />
      <PatinaHalo x={PLAQUE_W / 2 - 190} y={330 - 190} width={380} height={380} center={[PLAQUE_W / 2, 330]} innerR={130} outerR={172} seed={[...data.epithet.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 97} />
      {orb && <SkImage image={orb} x={PLAQUE_W / 2 - 145} y={185} width={290} height={290} fit="contain" />}
      {ritual && <SkText font={ritual} text={data.epithet.title} x={centered(ritual, data.epithet.title)} y={600} color={colors.museumWhite} />}
      {receiptFont && <SkText font={receiptFont} text={data.epithet.receipt} x={centered(receiptFont, data.epithet.receipt)} y={644} color={colors.agedGold} />}
      {mono && statLines.map((line, i) => (
        <SkText key={line} font={mono} text={line} x={centered(mono, line)} y={710 + i * 32} color={NIGHT_DIM} />
      ))}
      <Line p1={vec(INSET + 40, 880)} p2={vec(PLAQUE_W - INSET - 40, 880)} color={NIGHT_LINE} strokeWidth={1} />
      <ShareFooter mono={mono} monoSmall={monoSmall} y={926} width={PLAQUE_W} />
    </Canvas>
  );
}
