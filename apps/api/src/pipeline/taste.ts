// Taste — the only fail-closed gate in this design (design 2026-09-04 §8).
// It was tier 4 of the retired authoring gauntlet; the market round now calls
// it directly on the titles it is about to publish.
//
// The forbidden list lives today as a clause in the AUTHORING prompt, checked
// by nothing. With no human reading questions before they go live, one
// tasteless question reaching every player is the largest brand and App Review
// risk in the system — and it would be guarded by the same class of component
// that generates it.
//
// FAIL-CLOSED. An error, a timeout, or unparseable output rejects EVERY
// candidate in the batch. Every other gate here may fail open on infrastructure
// trouble; a taste check that fails open is not a taste check. The cost of
// failing closed is a night that falls through to the evergreen bank — a
// mechanism that already exists and is already tested.
//
// ONE CARVE-OUT: BudgetExhausted propagates instead of rejecting the batch.
// A spent budget is a day-level stop, not this batch's problem — swallowing
// it here would end the night silently, with no ‼️ critical, exactly the
// defect this gate exists to avoid on every OTHER failure.
//
// It runs LAST, on the small set that survived everything else, so the
// fail-closed blast radius is as small as it can be.
import { z } from "zod";
import type { PipelineDeps } from "./index";
import { BudgetExhausted } from "./spend";

const TasteSchema = z.object({
  verdicts: z.array(z.object({ index: z.number().int().min(0), allowed: z.boolean(), reason: z.string().default("") })),
});

const tasteJsonSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The candidate's index, exactly as given." },
          allowed: { type: "boolean" },
          reason: { type: "string", description: "Which rule it breaks. Empty when allowed." },
        },
        required: ["index", "allowed", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const SYSTEM = `You screen candidate questions for a daily prediction game. For each candidate, decide whether it is acceptable to put in front of every player.

Set allowed to false if the question does any of these:
- treats a death, a disaster or a tragedy as the thing being bet on
- concerns a private individual rather than a public figure
- concerns the medical outcome of a named person
- is derogatory about any person or group
- rewards a player for hoping that harm comes to someone

A public figure's professional outcome — an election, a resignation, a contract, a result — is acceptable. Ordinary markets, sports, weather and culture questions are acceptable.

Return exactly one verdict per candidate, carrying that candidate's index unchanged. Call the taste_verdicts tool exactly once.`;

// The text-only core of the gate: candidate strings in, one verdict per
// string out. It knows nothing about the shape of what it screens, so
// anything holding plain text (a bank candidate's text, a voiced exchange
// title) can call it directly.
export async function tasteTexts(
  deps: PipelineDeps,
  texts: string[],
): Promise<{ allowed: boolean[]; reasons: string[]; detail: string | null }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  if (texts.length === 0) return { allowed: [], reasons: [], detail: null };

  const refuse = (detail: string) => ({ allowed: texts.map(() => false), reasons: texts.map(() => ""), detail });

  let response: unknown;
  try {
    response = await deps.claude.structured({
      model: deps.models.taste,
      system: SYSTEM,
      user: `${texts.map((t, i) => `[${i}] ${t}`).join("\n")}\n\nReturn one verdict per candidate now.`,
      schemaName: "taste_verdicts",
      schema: tasteJsonSchema,
      // No webSearch. Classification, not research.
    });
  } catch (err) {
    // A spent budget is a day-level stop, not one batch's problem — let it
    // propagate, so reportBudgetExhaustion sees it and the ‼️ critical
    // actually fires. Every OTHER error still fails
    // closed: a taste check that fails open is not a taste check.
    if (err instanceof BudgetExhausted) throw err;
    return refuse(`the taste gate could not be reached, so the batch was refused: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parsed = TasteSchema.safeParse(response);
  if (!parsed.success) return refuse("the taste gate's response could not be read, so the batch was refused");

  const byIndex = new Map(parsed.data.verdicts.map((v) => [v.index, v]));
  // A missing verdict is a failed check, not a pass. Anything less would make
  // the gate's coverage depend on the model remembering to answer.
  if (texts.some((_, i) => !byIndex.has(i))) {
    return refuse("the taste gate did not judge every candidate, so the batch was refused");
  }

  return {
    allowed: texts.map((_, i) => byIndex.get(i)!.allowed),
    reasons: texts.map((_, i) => byIndex.get(i)!.reason),
    detail: null,
  };
}

