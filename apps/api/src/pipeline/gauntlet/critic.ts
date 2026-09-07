// Tier 2 — the prosecution (design 2026-09-04 §3.2), and the contestedness
// gate that reads its number (§7).
//
// The author advocates for its own draft; this call prosecutes it. Separate
// prompt, separate role, one call for the whole surviving set.
//
// THE CRITIC NEVER SEES author_probability. Not as a matter of prompt wording:
// the user block below is built from an explicit field list that does not
// contain it. A critic shown the author's number anchors to it, and §7's
// disagreement check degenerates into comparing a number with itself.
import { z } from "zod";
import type { PipelineDeps } from "../index";
import type { Candidate, Rejection, Screened } from "../candidate";

// Outside 0.25–0.75. The author's own band is 0.3–0.7; this is the same band,
// verified by someone else, with a little tolerance.
export const CONTESTED_MAX_DELTA = 0.25;
// Two competent models this far apart on one sentence usually means the
// sentence is ambiguous, not that one of them is badly calibrated.
export const PROB_DISAGREEMENT_MAX = 0.3;

export interface Judged { candidate: Candidate; criticProbability: number; editorial?: import("../editorial").EditorialAssessment }

const VerdictSchema = z.object({
  index: z.number().int().min(0),
  readable_two_ways: z.boolean(),
  criteria_determine_outcome: z.boolean(),
  resolves_at_plausible: z.boolean(),
  critic_probability: z.number().min(0).max(1),
  reasons: z.array(z.string()).default([]),
});
const CriticSchema = z.object({ verdicts: z.array(VerdictSchema) });

const criticJsonSchema = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "The candidate's index, exactly as given." },
          readable_two_ways: { type: "boolean", description: "Could two careful people reach different answers from the same criteria?" },
          criteria_determine_outcome: { type: "boolean", description: "Do the stated criteria fully determine the outcome?" },
          resolves_at_plausible: { type: "boolean", description: "Is the stated resolution instant credible given what the question asks?" },
          critic_probability: { type: "number", description: "YOUR OWN probability that the answer is YES, 0 to 1." },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["index", "readable_two_ways", "criteria_determine_outcome", "resolves_at_plausible", "critic_probability", "reasons"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};

const SYSTEM = `You are the adversary. You are shown candidate yes/no questions for a prediction game and your job is to find what is wrong with each one. Someone else wrote them and wants them accepted; you do not.

For every candidate, report:
- readable_two_ways: true if two careful people, given only the question and its resolution criteria, could defensibly reach different answers about the same real-world facts.
- criteria_determine_outcome: true only if the stated criteria fully determine a yes or a no. Vague measurements, missing thresholds and unnamed pages are false.
- resolves_at_plausible: true if the stated resolution instant is credible for what the question asks. A question about a closing price that claims to resolve before the close is not.
- critic_probability: YOUR OWN probability that the answer is YES. Nobody else's number has been shown to you and you must not try to guess one. State what you actually believe.
- reasons: short notes on anything you flagged.

Return exactly one verdict per candidate, carrying that candidate's index unchanged. Call the critic_verdicts tool exactly once.`;

// The explicit field list is the enforcement mechanism, not a convenience:
// author_probability, market_prob and topic_key are absent by construction.
function candidateBlock(candidates: Candidate[]): string {
  return candidates
    .map((c, i) => `[${i}] (${c.category}) ${c.text}\n  CRITERIA: ${c.resolution_criteria}\n  SOURCE: ${c.source_name} <${c.source_url}>\n  RESOLVES AT: ${c.resolves_at}`)
    .join("\n\n");
}

export async function criticize(
  deps: PipelineDeps,
  candidates: Candidate[],
): Promise<Screened & { judged: Judged[] }> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  if (candidates.length === 0) return { passed: [], rejected: [], judged: [] };

  const response = await deps.claude.structured({
    model: deps.models.critic,
    system: SYSTEM,
    user: `${candidateBlock(candidates)}\n\nReturn one verdict per candidate now.`,
    schemaName: "critic_verdicts",
    schema: criticJsonSchema,
    // No search. This is a reading of the sentence, not of the world.
  });

  const parsed = CriticSchema.safeParse(response);
  // No verdict is not "sound by default". A gate that passes what it could not
  // read is not a gate — and the night falls through to the bank, which is a
  // mechanism that already exists and is already tested.
  if (!parsed.success) {
    return {
      passed: [],
      judged: [],
      rejected: candidates.map((c) => ({ text: c.text, reason: "ambiguous" as const, detail: "the critic's response could not be read" })),
    };
  }

  const byIndex = new Map(parsed.data.verdicts.map((v) => [v.index, v]));
  const passed: Candidate[] = [];
  const judged: Judged[] = [];
  const rejected: Rejection[] = [];

  candidates.forEach((c, i) => {
    const v = byIndex.get(i);
    if (!v) {
      rejected.push({ text: c.text, reason: "ambiguous", detail: "the critic returned no verdict for this candidate" });
      return;
    }
    if (v.readable_two_ways || !v.criteria_determine_outcome || !v.resolves_at_plausible) {
      const flags = [
        v.readable_two_ways ? "readable two ways" : null,
        v.criteria_determine_outcome ? null : "criteria do not determine the outcome",
        v.resolves_at_plausible ? null : "resolves_at is not plausible",
      ].filter(Boolean);
      rejected.push({ text: c.text, reason: "ambiguous", detail: `${flags.join("; ")}${v.reasons.length ? ` — ${v.reasons.join("; ")}` : ""}` });
      return;
    }

    // §7, decided here beside the number it reads. Two distinct failures:
    if (Math.abs(v.critic_probability - 0.5) > CONTESTED_MAX_DELTA) {
      rejected.push({ text: c.text, reason: "uncontested", detail: `critic reads it at ${v.critic_probability}, outside the contested band` });
      return;
    }
    const gap = Math.abs(c.author_probability - v.critic_probability);
    if (gap > PROB_DISAGREEMENT_MAX) {
      rejected.push({ text: c.text, reason: "uncontested", detail: `author and critic are ${gap.toFixed(2)} apart, which usually means the sentence is ambiguous` });
      return;
    }

    passed.push(c);
    judged.push({ candidate: c, criticProbability: v.critic_probability });
  });

  return { passed, rejected, judged };
}
