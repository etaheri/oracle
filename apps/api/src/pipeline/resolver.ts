// One model-resolver call, shared by everything that needs to ask "does the
// answer exist yet, and can you show me where" (design 2026-09-04 §3, §5, §6).
//
// Three callers, three directions:
//   - resolve.ts  — forwards, after lock: what IS the outcome (run twice)
//   - preflight   — backwards, at authoring time: an answer that EXISTS is a
//                   rejection, because the question was never a prediction
//   - probe       — sideways, mid-window: an answer that has APPEARED pulls
//                   the lock forward to now
//
// The domain restriction is deliberate and it bounds what a verdict means: an
// `unverifiable` proves the NAMED SOURCE does not show it yet, not that no
// source does. That is the right scope, because resolution will read only that
// source too — but it is a narrower claim than "not knowable anywhere".
import { z } from "zod";
import type { PipelineDeps } from "./index";

export interface ResolverQuote { url: string; quote: string }
export interface ResolverVerdict {
  outcome: "yes" | "no" | "unverifiable";
  quotes: ResolverQuote[];
  reasoning: string;
}
export interface ResolverTarget {
  text: string;
  resolutionCriteria: string;
  sourceName: string;
  sourceUrl: string | null;
}

const ResolutionSchema = z.object({
  outcome: z.enum(["yes", "no", "unverifiable"]),
  quotes: z.array(z.object({ url: z.string(), quote: z.string() })),
  reasoning: z.string(),
});

export const resolutionJsonSchema = {
  type: "object",
  properties: {
    outcome: { type: "string", enum: ["yes", "no", "unverifiable"] },
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: { url: { type: "string" }, quote: { type: "string" } },
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
// either way.
export function allowedDomainsFor(sourceUrl: string | null): string[] | undefined {
  if (!sourceUrl) return undefined;
  try {
    return [new URL(sourceUrl).hostname.replace(/^www\./, "")];
  } catch {
    return undefined;
  }
}

function systemPrompt(t: ResolverTarget): string {
  return `You resolve a prediction question for ORACLE. Question: "${t.text}". Resolution criteria: "${t.resolutionCriteria}". Source: ${t.sourceName}.
Determine the outcome STRICTLY per the criteria, using only ${t.sourceName}. Quote the exact evidence.
If the source does not yet show a definitive outcome, answer "unverifiable" — never guess. Call the resolution tool exactly once.`;
}

// An unparseable response is not an error here: it is the same fact as
// "the source does not show it". Every caller already has a correct branch for
// unverifiable, and throwing instead would turn a bad model turn into a failed
// tick.
const UNVERIFIABLE: ResolverVerdict = { outcome: "unverifiable", quotes: [], reasoning: "" };

export async function askResolver(deps: PipelineDeps, model: string, target: ResolverTarget): Promise<ResolverVerdict> {
  if (!deps.claude) throw new Error("pipeline: no claude client");
  const response = await deps.claude.structured({
    model,
    system: systemPrompt(target),
    user: `Resolve this question now, using only ${target.sourceName}.`,
    schemaName: "resolution",
    schema: resolutionJsonSchema,
    webSearch: { allowedDomains: allowedDomainsFor(target.sourceUrl), maxUses: 5 },
  });
  const parsed = ResolutionSchema.safeParse(response);
  return parsed.success ? parsed.data : UNVERIFIABLE;
}

// THE ONE DEFINITION of "the answer exists". A yes/no with no quotes is a
// ruling without receipts, and this codebase has always treated that as
// identical to unverifiable — three callers now depend on that being decided
// in exactly one place.
export function settled(v: ResolverVerdict): "yes" | "no" | null {
  if (v.outcome === "unverifiable") return null;
  if (v.quotes.length === 0) return null;
  return v.outcome;
}
