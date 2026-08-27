// Hermes resolution (spec §6): verify-or-void. Claude is handed the
// question's promised source (its hostname, if it parses, restricts the
// web_search tool it gets) and must answer strictly from that source, with
// quoted evidence. No quotes → no resolution, even on a yes/no answer — a
// ruling without receipts is treated the same as "unverifiable": left for
// the next tick to retry, and eventually voided by the pipeline's 13:00 ET
// deadline (actions.ts:voidQuestions) if it never produces one.
import { z } from "zod";
import { eq } from "drizzle-orm";
import { schema, type Db } from "../db/client";
import type { PipelineDeps } from "./index";
import { resolveQuestion } from "../resolution";

const ResolutionSchema = z.object({
  outcome: z.enum(["yes", "no", "unverifiable"]),
  quotes: z.array(z.object({ url: z.string(), quote: z.string() })),
  reasoning: z.string(),
});

const resolutionJsonSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["yes", "no", "unverifiable"] },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          quote: { type: "string" },
        },
        required: ["url", "quote"],
        additionalProperties: false,
      },
    },
    reasoning: { type: "string" },
  },
  required: ["outcome", "quotes", "reasoning"],
  additionalProperties: false,
};

// Hostname of source_url, www.-stripped, when it parses as a URL; otherwise
// undefined — the web_search tool then runs with no allowed_domains
// restriction (claude.ts only sets allowed_domains when this is non-empty).
// The system prompt still names source_name as the only acceptable source
// either way (spec §6: resolution happens against the promised source).
function allowedDomainsFor(sourceUrl: string | null): string[] | undefined {
  if (!sourceUrl) return undefined;
  try {
    return [new URL(sourceUrl).hostname.replace(/^www\./, "")];
  } catch {
    return undefined;
  }
}

function systemPrompt(text: string, resolutionCriteria: string, sourceName: string): string {
  return `You resolve a prediction question for ORACLE. Question: "${text}". Resolution criteria: "${resolutionCriteria}". Source: ${sourceName}.
Determine the outcome STRICTLY per the criteria, using only ${sourceName}. Quote the exact evidence.
If the source does not yet show a definitive outcome, answer "unverifiable" — never guess. Call the resolution tool exactly once.`;
}

export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const claude = deps.claude;

  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q) throw new Error(`resolve: question not found: ${questionId}`);

  const response = await claude.structured({
    model: deps.models.resolve,
    system: systemPrompt(q.text, q.resolutionCriteria, q.sourceName),
    user: `Resolve this question now, using only ${q.sourceName}.`,
    schemaName: "resolution",
    schema: resolutionJsonSchema,
    webSearch: { allowedDomains: allowedDomainsFor(q.sourceUrl), maxUses: 5 },
  });

  const parsed = ResolutionSchema.safeParse(response);
  if (!parsed.success) return false;

  const { outcome, quotes, reasoning } = parsed.data;
  if (outcome === "unverifiable") return false;
  if (quotes.length === 0) return false; // yes/no with no receipts — treat as unverifiable

  // The Claude call above can take minutes across chained web searches, and
  // cron ticks can overlap: another tick may have voided this question (or
  // otherwise moved it off "locked") while this call was in flight. Re-check
  // right before writing so a late resolve never clobbers a void.
  const current = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!current || current.status !== "locked") return false;

  await resolveQuestion(deps.db, questionId, outcome, {
    outcome,
    quotes,
    reasoning,
    checked_at: deps.now().toISOString(),
    model: deps.models.resolve,
  });
  return true;
}
