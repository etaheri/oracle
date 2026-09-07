// Candidate authoring (design 2026-09-04 §3.1): surplus, not exactly enough.
//
// A gauntlet that cannot afford to reject is not a gauntlet, and generating
// exactly five makes every rejection a serial re-authoring round-trip against
// a six-hour window. Candidates are NOT slotted here: slot, the Big One and
// the category spread are selection constraints applied to survivors, so that
// a rejection in one category is substituted rather than re-authored.
import type { PipelineDeps } from "../index";
import { addDays } from "../clock";
import { fetchMarketSignals, type MarketSignal } from "../feeds";
import { loadQualityRows, qualityReport, questionQuality } from "../quality";
import { recentQuestionDigest } from "../author";

export const CANDIDATE_MIN = 12;
export const CANDIDATE_TARGET = 14;
export const CANDIDATE_MAX = 15;

const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;

const candidateProperties = {
  category: { type: "string", enum: [...CATEGORIES] },
  text: { type: "string", minLength: 10 },
  resolution_criteria: { type: "string", minLength: 10 },
  source_name: { type: "string", minLength: 1 },
  source_url: { type: "string", format: "uri" },
  author_probability: { type: "number", minimum: 0.3, maximum: 0.7 },
  market_prob: { type: ["number", "null"], minimum: 0, maximum: 1 },
  resolves_at: {
    type: "string",
    description:
      'ISO-8601 UTC instant at which this outcome first becomes publicly determinable from the named source, or the literal "after-lock" when nothing about it is knowable before the round locks.',
  },
  topic_key: {
    type: "string",
    description:
      'A normalized, lower-case, hyphenated subject key for what this question is ABOUT, never its wording: "btc-close-above-threshold", not "will-btc-close-above-70000-on-friday". Two questions about the same underlying subject must share a key even when their numbers differ.',
  },
};

const candidateSetJsonSchema = {
  type: "object",
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        properties: candidateProperties,
        required: Object.keys(candidateProperties),
        additionalProperties: false,
      },
      minItems: CANDIDATE_MIN,
      maxItems: CANDIDATE_MAX,
    },
  },
  required: ["candidates"],
  additionalProperties: false,
};

function marketSignalsBlock(signals: MarketSignal[]): string {
  if (signals.length === 0) return "";
  const lines = signals.map(
    (s) => `- [${s.source}] "${s.question}" — ${Math.round(s.prob * 100)}% YES — closes ${s.closesAt}`,
  );
  return `
LIVE MARKET SIGNALS — real prediction markets closing within 36 hours. These are contested by actual bettors:
${lines.join("\n")}
- Prefer adapting market-backed candidates where they fit. When a candidate is adapted from a listed market, set market_prob to that market's probability (0-1); otherwise set market_prob to null.
- NEVER cite a prediction market as the resolution source — resolution always names a primary public source.
- A candidate adapted from a listed market MUST set resolves_at to that market's own close: the price is public and converges on the answer, so answers have to close with it.`;
}

function systemPrompt(date: string, recent: string, signals: MarketSignal[], scorecard: string): string {
  const lockDay = addDays(date, 1);
  return `You author CANDIDATE questions for ORACLE, a prediction game. Produce ${CANDIDATE_TARGET} yes/no candidates for the round dated ${date} (ET). The round opens at noon ET on ${date} and closes at noon ET on ${lockDay}.

You are writing a SURPLUS on purpose. Every candidate you write is put through a gauntlet — an adversarial reader, a source check, and a resolver that tries to answer it tonight — and most nights several are thrown away. Do not write five careful questions; write ${CANDIDATE_TARGET} you would defend, and let the gauntlet choose. Do not assign slots, do not nominate a big one, and do not try to balance the categories: something else does all three from whatever survives.

Rules for every candidate:
- Binary YES/NO in plain English, resolvable from ONE named public source.
- ONE CLAUSE. Never join two conditions with "and" or "or" — a compound question is the classic way for two careful readers to reach different answers, and it will be thrown out.
- THE ANSWER MUST NOT EXIST WHILE PLAYERS CAN STILL ANSWER. Set resolves_at to the ISO-8601 UTC instant at which the outcome first becomes publicly determinable — the final whistle, the market's close, the moment the report is published. A resolver will be run against your named source TONIGHT, and any candidate it can already answer is rejected. If nothing about the outcome is determinable before noon ET on ${lockDay}, set resolves_at to "after-lock".
- Every question must remain unknowable until noon ET on ${lockDay}. Prefer events just after that lock, with results in the next 24 hours. Never use early-closing events just to deliver a noon result.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. An independent reader will state its own probability without seeing yours, and a candidate the two of you read very differently is rejected as ambiguous.
- resolution_criteria must name the exact measurement and the exact source page. Zero ambiguity: a stranger must be able to resolve it identically.
- source_url must be a real, reachable page. Every URL is fetched before the round is chosen, and one that does not answer is rejected.
- topic_key is the SUBJECT, not the wording. A key used in the last seven days is rejected, so do not re-ask last week's question with a new number.
- WEATHER: the measurement period must begin after noon ET on ${lockDay} and end within the following 24 hours. Set resolves_at to the end of the measurement period. Weather may never use "after-lock".
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine. A separate screen refuses these, and a refusal there costs the whole night.
- Here is your own record in aggregate. It is the standard you are held to.
${scorecard}
- Here is how your last seven days landed. Do not repeat them, and read the outcomes and crowd splits as feedback on your own question-writing: ${recent}${marketSignalsBlock(signals)}
Search the web for today's actual news before writing. When your candidates are final, call the candidate_round tool exactly once.`;
}

export async function generateCandidates(deps: PipelineDeps, date: string): Promise<unknown[]> {
  if (!deps.claude) throw new Error("pipeline: no claude client");

  const recent = await recentQuestionDigest(deps.db, date);
  // Market feeds are advisory: any failure logs inside fetchMarketSignals and
  // authoring proceeds market-blind on an empty list. Cold start reaches here
  // with no history and no signals and must still produce a round.
  const { signals } = await fetchMarketSignals(deps.marketFetch ?? fetch, deps.now());
  const scorecard = qualityReport(questionQuality(await loadQualityRows(deps.db, date))).join("\n  ");

  const response = await deps.claude.structured({
    model: deps.models.author,
    system: systemPrompt(date, recent, signals, scorecard),
    user: `Produce ${CANDIDATE_TARGET} candidate questions for ${date} now.`,
    schemaName: "candidate_round",
    schema: candidateSetJsonSchema,
    webSearch: { maxUses: 8 },
  });

  const list = (response as { candidates?: unknown }).candidates;
  // No retry loop here, unlike authorRound: the gauntlet's whole design is that
  // bad candidates are THROWN AWAY rather than corrected, and a malformed
  // response is simply a night with no candidates, which falls to the bank.
  return Array.isArray(list) ? list : [];
}
