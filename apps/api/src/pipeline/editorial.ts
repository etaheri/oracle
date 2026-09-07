import { z } from "zod";
import { QuestionContextSchema } from "@oracle/core";
import type { PipelineDeps } from "./index";
import type { Judged } from "./gauntlet/critic";
export const EditorialAssessmentSchema = z.object({
  understandability: z.number().int().min(0).max(2), reasonability: z.number().int().min(0).max(2), interest: z.number().int().min(0).max(2),
  opener: z.boolean(), bigOne: z.boolean(),
});
export type EditorialAssessment = z.infer<typeof EditorialAssessmentSchema>;
export type Edited = Judged & { editorial: EditorialAssessment };
const Response = z.object({ assessments: z.array(z.object({ index: z.number().int().min(0), ...EditorialAssessmentSchema.shape,
  context: QuestionContextSchema.nullable(), contextVerified: z.boolean(),
})) });

/** This gate never admits an integrity rejection. Missing or invalid verdicts fail closed. */
export async function assessEditorial(deps: PipelineDeps, candidates: Judged[], publishesAt: Date): Promise<Edited[]> {
  if (!candidates.length) return [];
  if (!deps.claude) return [];
  const raw = await deps.claude.structured({ model: deps.models.critic, schemaName: "editorial_assessments",
    schema: z.toJSONSchema(Response), webSearch: { maxUses: 5 },
    system: `Review daily prediction questions for human interest. Score each 0, 1 or 2 on understandability, reasonability (a non-specialist can explain reasons for either side), and interest (wanting to learn the outcome tomorrow). Zero means replace it. Mark accessible openers and recognizable, consequential Big Ones. Uncertainty alone is not interest. An arbitrary obscure threshold without context is weak; a clearly explained professional contest can be strong. Never encourage harm.
Optional context is at most 240 characters of verified neutral facts from a primary source, frozen before publication. No advice, odds, market/crowd/Oracle probabilities, or information revealing the answer. Search to verify the facts and timestamp. Set contextVerified true ONLY if verified; otherwise context must be null. Do not invent facts or sources. Return exactly one assessment per input index.`,
    user: `Publication: ${publishesAt.toISOString()}\n${candidates.map((j, index) => JSON.stringify({ index, text: j.candidate.text, criteria: j.candidate.resolution_criteria, source: j.candidate.source_url })).join("\n")}`,
  });
  const parsed = Response.safeParse(raw);
  if (!parsed.success || parsed.data.assessments.length !== candidates.length) return [];
  const byIndex = new Map(parsed.data.assessments.map(a => [a.index, a]));
  if (byIndex.size !== candidates.length || candidates.some((_, i) => !byIndex.has(i))) return [];
  return candidates.flatMap((j, i) => {
    const a = byIndex.get(i)!;
    if (!a.understandability || !a.reasonability || !a.interest) return [];
    const context = a.context && a.contextVerified && Date.parse(a.context.asOf) <= Math.min(publishesAt.getTime(), deps.now().getTime()) ? a.context : undefined;
    // Context supplied by the author is never trusted over the independent review.
    return [{ ...j, candidate: { ...j.candidate, context }, editorial: EditorialAssessmentSchema.parse(a) }];
  });
}
