// The voice call (design 2026-09-10 §5.4): five exchange titles in, five
// questions in the app's register out. It may not change what is asked.
import { z } from "zod";
import type { PipelineDeps } from "./index";
import type { Category } from "./exchanges/types";

export const VOICE_PROMPT_VERSION = "voice-v1";

export interface VoiceInput { slot: number; title: string; rules: string; category: Category; isBigOne: boolean }
export interface Voiced { slot: number; text: string; context: string }

const VoiceSchema = z.object({
  questions: z.array(z.object({
    slot: z.number().int().min(1).max(5),
    text: z.string().min(10).max(160).regex(/\?$/, "a question ends with a question mark"),
    context: z.string().max(240),
  })).length(5).refine((rows) => new Set(rows.map((r) => r.slot)).size === 5, "slots must be exactly 1..5"),
});

const voiceJsonSchema = {
  type: "object",
  properties: {
    questions: {
      type: "array", minItems: 5, maxItems: 5,
      items: {
        type: "object",
        properties: {
          slot: { type: "integer", minimum: 1, maximum: 5 },
          text: { type: "string", description: "The question, plain English, one sentence, ending in a question mark, at most 160 characters." },
          context: { type: "string", description: "One neutral sentence of background a player could use, at most 240 characters. Empty if nothing is worth saying." },
        },
        required: ["slot", "text", "context"], additionalProperties: false,
      },
    },
  },
  required: ["questions"], additionalProperties: false,
};

function systemPrompt(date: string): string {
  return `You write the daily round for ORACLE, a prediction game. Tonight's five questions are live real-money markets. For each one, rewrite the exchange's title as a single plain-English yes/no question a stranger would understand, and add one neutral sentence of context.
Rules:
- Ask EXACTLY what the market asks. Keep every number, date, team, threshold and unit. Do not widen, narrow or reinterpret.
- Name the day in words when the market names a date (the round is dated ${date} ET and closes at noon ET the following day).
- Plain words. No inscriptions, no flourishes, no exclamation marks. Ending in a question mark.
- Context is one sentence of fact, never a hint about the answer.
Call the oracle_voice tool exactly once with one entry per slot 1 through 5.`;
}

export async function voiceQuestions(deps: PipelineDeps, date: string, inputs: VoiceInput[]): Promise<Voiced[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const user = inputs
    .map((i) => `[slot ${i.slot}${i.isBigOne ? " · THE BIG ONE" : ""} · ${i.category}]\nTITLE: ${i.title}\nRULES: ${i.rules.slice(0, 1200)}`)
    .join("\n\n");
  const response = await deps.claude.structured({
    model: deps.models.voice,
    system: systemPrompt(date),
    user,
    schemaName: "oracle_voice",
    schema: voiceJsonSchema,
    effort: "low",
  });
  const parsed = VoiceSchema.safeParse(response);
  if (!parsed.success) throw new Error(`voice: response failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  return [...parsed.data.questions].sort((a, b) => a.slot - b.slot);
}
