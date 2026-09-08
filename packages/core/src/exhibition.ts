import { z } from "zod";
import { oracleQuestionPoints } from "./oracleRecord";
import { ConfidenceSchema } from "./schemas";

export const ExhibitionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["historical", "fictional"]),
  question: z.string().min(1),
  context: z.string().min(1),
  sourceName: z.string().min(1),
  roundDate: z.string().nullable(),
  oraclePYes: z.number().min(0).max(1),
  outcome: z.enum(["yes", "no"]),
});

export type Exhibition = z.infer<typeof ExhibitionSchema>;

const ExhibitionPredictionSchema = z.object({
  answer: z.boolean(),
  confidence: ConfidenceSchema,
});

export function compareExhibition(
  prediction: { answer: boolean; confidence: number },
  exhibition: Exhibition,
): { youPoints: number; oraclePoints: number; winner: "you" | "oracle" | "tie" } {
  const validPrediction = ExhibitionPredictionSchema.parse(prediction);
  const validExhibition = ExhibitionSchema.parse(exhibition);
  const youPYes = validPrediction.answer
    ? validPrediction.confidence / 100
    : 1 - validPrediction.confidence / 100;
  const youPoints = oracleQuestionPoints({ pYes: youPYes, outcome: validExhibition.outcome, isBigOne: false });
  const oraclePoints = oracleQuestionPoints({ pYes: validExhibition.oraclePYes, outcome: validExhibition.outcome, isBigOne: false });
  const winner = youPoints === oraclePoints ? "tie" : youPoints > oraclePoints ? "you" : "oracle";
  return { youPoints, oraclePoints, winner };
}
