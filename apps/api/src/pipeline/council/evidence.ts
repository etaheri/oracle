// The shared evidence pack (design 2026-09-11 §5). Retrieval is owned by the
// pipeline, not by the members: one Exa search per question, a published-date
// ceiling at the retrieval instant, and the same numbered pack for every
// member. That ceiling is what makes the September 9 failure structurally
// impossible — no member can be shown a recap of last week's meeting as if
// it were this one.
import { eq, inArray } from "drizzle-orm";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";

export const EVIDENCE = { RESULTS: 8, WINDOW_DAYS: 14, QUERY_CHARS: 500, HIGHLIGHT_SENTENCES: 3 } as const;
const EXA_URL = "https://api.exa.ai/search";

export interface PackSummary { questionId: string; slot: number; count: number; skipped: boolean; error?: string }
export interface EvidenceSummary { packs: PackSummary[]; cost: number }

interface ExaResult { url: string; title?: string | null; publishedDate?: string | null; highlights?: string[] }
interface ExaResponse { results?: ExaResult[]; costDollars?: { total?: number } }

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

/** Hosts named by URL in the rules, minus the exchange's own; undefined when none. */
export function resolutionDomains(rules: string, exchangeUrl: string | null): string[] | undefined {
  const own = exchangeUrl ? hostOf(exchangeUrl) : null;
  const hosts = new Set<string>();
  for (const m of rules.matchAll(/https?:\/\/[^\s)"'<>]+/g)) {
    const h = hostOf(m[0]);
    if (h && h !== own) hosts.add(h);
  }
  return hosts.size > 0 ? [...hosts] : undefined;
}

async function search(deps: PipelineDeps, key: string, q: { resolutionCriteria: string; sourceUrl: string | null }, now: Date): Promise<{ results: ExaResult[]; cost: number }> {
  const domains = resolutionDomains(q.resolutionCriteria, q.sourceUrl);
  const body = {
    // No separate exchange title here: market-round.ts's toDraft already
    // prefixes it onto resolutionCriteria (`${c.title}\n\n${c.rules}`), so
    // the first QUERY_CHARS of the criteria already carry it.
    query: q.resolutionCriteria.slice(0, EVIDENCE.QUERY_CHARS),
    type: "auto",
    numResults: EVIDENCE.RESULTS,
    startPublishedDate: new Date(now.getTime() - EVIDENCE.WINDOW_DAYS * 86_400_000).toISOString(),
    endPublishedDate: now.toISOString(),
    ...(domains ? { includeDomains: domains } : {}),
    contents: { highlights: { numSentences: EVIDENCE.HIGHLIGHT_SENTENCES, highlightsPerUrl: 1 } },
  };
  const res = await (deps.exaFetch ?? fetch)(EXA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`exa: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as ExaResponse;
  return { results: json.results ?? [], cost: json.costDollars?.total ?? 0 };
}

export async function retrieveEvidence(deps: PipelineDeps, date: string): Promise<EvidenceSummary> {
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round || round.rulesVersion < 3) return { packs: [], cost: 0 };
  const qs = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, resolutionCriteria: true, sourceUrl: true },
  });
  const existing = qs.length
    ? await deps.db.select({ questionId: schema.evidence.questionId }).from(schema.evidence).where(inArray(schema.evidence.questionId, qs.map((q) => q.id)))
    : [];
  const have = new Map<string, number>();
  for (const e of existing) have.set(e.questionId, (have.get(e.questionId) ?? 0) + 1);

  const packs: PackSummary[] = [];
  let cost = 0;
  for (const q of qs) {
    const had = have.get(q.id);
    if (had) { packs.push({ questionId: q.id, slot: q.slot, count: had, skipped: true }); continue; }
    if (!deps.exaApiKey) { packs.push({ questionId: q.id, slot: q.slot, count: 0, skipped: false, error: "no EXA_API_KEY" }); continue; }
    const now = deps.now();
    try {
      const { results, cost: c } = await search(deps, deps.exaApiKey, q, now);
      cost += c;
      const rows = results.slice(0, EVIDENCE.RESULTS).map((r, i) => ({
        questionId: q.id,
        rank: i + 1,
        url: r.url,
        title: (r.title ?? "").trim() || r.url,
        source: hostOf(r.url) ?? r.url,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : null,
        highlight: (r.highlights?.[0] ?? "").trim() || ((r.title ?? "").trim() || r.url),
        retrievedAt: now,
      }));
      if (rows.length > 0) await deps.db.insert(schema.evidence).values(rows).onConflictDoNothing();
      packs.push({ questionId: q.id, slot: q.slot, count: rows.length, skipped: false });
    } catch (err) {
      packs.push({ questionId: q.id, slot: q.slot, count: 0, skipped: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { packs, cost };
}
