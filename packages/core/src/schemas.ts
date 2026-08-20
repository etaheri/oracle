import { z } from "zod";
import { CONSTANTS } from "./constants";

export const ConfidenceSchema = z
  .number()
  .int()
  .min(CONSTANTS.CONFIDENCE_MIN)
  .max(CONSTANTS.CONFIDENCE_MAX)
  .refine((n) => (n - CONSTANTS.CONFIDENCE_MIN) % CONSTANTS.CONFIDENCE_STEP === 0, {
    message: "confidence must be on the 55-95 step-5 grid",
  });

export const PredictionSubmitSchema = z.object({
  question_id: z.string().uuid(),
  answer: z.boolean(),
  confidence: ConfidenceSchema,
  idempotency_key: z.string().min(1).max(128),
});
export type PredictionSubmit = z.infer<typeof PredictionSubmitSchema>;
