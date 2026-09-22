import { z } from "zod";
import { oracleQuestionPoints } from "./oracleRecord";
import { ConfidenceSchema } from "./schemas";
import { clampLine, payout, stake, odds } from "./fortune";

export const ExhibitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["historical", "fictional"]),
  question: z.string().min(1),
  // A market question carries the context it opened with; a past hot take
  // (design 2026-09-22 T10) has none, because an opinion has nothing to
  // look up.
  context: z.string().min(1).nullable().default(null),
  sourceName: z.string().min(1),
  roundDate: z.string().nullable(),
  oraclePYes: z.number().min(0).max(1),
  outcome: z.enum(["yes", "no"]),
  // The house line the practice card is priced at (design §7). Served by the
  // API for historical questions; null on the fallback fixture, where
  // practiceLine derives one from the Oracle's own forecast.
  linePYes: z.number().min(0).max(1).nullable().default(null),
  // The room's share of YES at lock on a past hot take; null on a market
  // question and on the fictional fallback.
  crowdYesPct: z.number().int().min(0).max(100).nullable().default(null),
});

export type Exhibition = z.infer<typeof ExhibitionSchema>;

// Practice runs on a fixed fortune and never touches the player's (design §8.3).
export const PRACTICE_FORTUNE = 1000;

/** The line the practice card plays against. */
export function practiceLine(exhibition: Exhibition): number {
  return exhibition.linePYes ?? clampLine(exhibition.oraclePYes, null);
}

const PracticeCallSchema = z.object({ answer: z.boolean() });

/** The practice result in the game's own currency, on the practice fortune at the flat stake. */
export function practiceOutcome(
  prediction: { answer: boolean },
  exhibition: Exhibition,
): { line: number; stake: number; wins: number; payout: number; delta: number; correct: boolean; oppositeDelta: number } {
  const p = PracticeCallSchema.parse(prediction);
  const ex = ExhibitionSchema.parse(exhibition);
  const line = practiceLine(ex);
  const s = stake(PRACTICE_FORTUNE, false);
  const wins = Math.round(s * odds(p.answer, line));
  const paid = payout({ stake: s, answer: p.answer, line, outcome: ex.outcome });
  const opposite = payout({ stake: s, answer: p.answer, line, outcome: ex.outcome === "yes" ? "no" : "yes" });
  return { line, stake: s, wins, payout: paid, delta: paid - s, correct: (ex.outcome === "yes") === p.answer, oppositeDelta: opposite - s };
}

// The points duel the practice used to be scored in. Kept for the archived
// tests and for any version 1 or 2 surface; no current screen calls it.
const LegacyPredictionSchema = z.object({ answer: z.boolean(), confidence: ConfidenceSchema });

export function compareExhibition(
  prediction: { answer: boolean; confidence: number },
  exhibition: Exhibition,
): { youPoints: number; oraclePoints: number; winner: "you" | "oracle" | "tie" } {
  const validPrediction = LegacyPredictionSchema.parse(prediction);
  const validExhibition = ExhibitionSchema.parse(exhibition);
  const youPYes = validPrediction.answer ? validPrediction.confidence / 100 : 1 - validPrediction.confidence / 100;
  const youPoints = oracleQuestionPoints({ pYes: youPYes, outcome: validExhibition.outcome, isBigOne: false });
  const oraclePoints = oracleQuestionPoints({ pYes: validExhibition.oraclePYes, outcome: validExhibition.outcome, isBigOne: false });
  const winner = youPoints === oraclePoints ? "tie" : youPoints > oraclePoints ? "you" : "oracle";
  return { youPoints, oraclePoints, winner };
}
