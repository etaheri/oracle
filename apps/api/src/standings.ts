// The open record (design 2026-09-11 §13): every member scored on every
// settled version 3 question, the crowd and the market beside them, and the
// CSV that is the dataset. Nothing here names a player.
import { and, asc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { MEMBER_ORDER, standingsRow, type Standings, type StandingsCall } from "@oracle/core";
import { schema, type Db } from "./db/client";

export interface SettledCall {
  date: string;
  slot: number;
  text: string;
  marketSource: string | null;
  marketId: string | null;
  marketProb: number | null;
  linePYes: number;
  crowdYesPct: number | null;
  crowdCount: number | null;
  outcome: "yes" | "no";
  lines: { member: string; pYes: number }[];
  predictions: { answer: boolean; stake: number }[];
}

export async function loadSettledCalls(db: Db): Promise<SettledCall[]> {
  const qs = await db
    .select({
      id: schema.questions.id, date: schema.questions.roundDate, slot: schema.questions.slot, text: schema.questions.text,
      marketSource: schema.questions.marketSource, marketId: schema.questions.marketId, marketProb: schema.questions.marketProb,
      linePYes: schema.questions.linePYes, crowdYesPct: schema.questions.crowdYesPct, crowdCount: schema.questions.crowdCount, outcome: schema.questions.outcome,
    })
    .from(schema.questions)
    .innerJoin(schema.rounds, eq(schema.rounds.date, schema.questions.roundDate))
    .where(and(gte(schema.rounds.rulesVersion, 3), isNotNull(schema.questions.linePYes), inArray(schema.questions.outcome, ["yes", "no"])))
    .orderBy(asc(schema.questions.roundDate), asc(schema.questions.slot));
  if (qs.length === 0) return [];
  const ids = qs.map((q) => q.id);
  const [lines, preds] = await Promise.all([
    db.query.lines.findMany({ where: inArray(schema.lines.questionId, ids) }),
    db.query.predictions.findMany({ where: and(inArray(schema.predictions.questionId, ids), isNotNull(schema.predictions.stake)), columns: { questionId: true, answer: true, stake: true } }),
  ]);
  return qs.map((q) => ({
    date: q.date,
    slot: q.slot,
    text: q.text,
    marketSource: q.marketSource,
    marketId: q.marketId,
    marketProb: q.marketProb === null ? null : Number(q.marketProb),
    linePYes: Number(q.linePYes),
    crowdYesPct: q.crowdYesPct === null ? null : Number(q.crowdYesPct),
    crowdCount: q.crowdCount,
    outcome: q.outcome as "yes" | "no",
    lines: lines.filter((l) => l.questionId === q.id).map((l) => ({ member: l.member, pYes: Number(l.pYes) })),
    predictions: preds.filter((p) => p.questionId === q.id).map((p) => ({ answer: p.answer, stake: p.stake! })),
  }));
}

export function standings(calls: SettledCall[], asOf: Date): Standings {
  const forMember = (member: string): StandingsCall[] =>
    calls.flatMap((c) => {
      const line = c.lines.find((l) => l.member === member);
      return line ? [{ p: line.pYes, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }] : [];
    });
  const crowd: StandingsCall[] = calls.flatMap((c) =>
    c.crowdYesPct === null ? [] : [{ p: c.crowdYesPct / 100, marketProb: c.marketProb, outcome: c.outcome, predictions: c.predictions }],
  );
  return {
    as_of: asOf.toISOString(),
    rounds: new Set(calls.map((c) => c.date)).size,
    questions: calls.length,
    rows: [
      ...MEMBER_ORDER.map((member) => ({ member, ...standingsRow(forMember(member)) })),
      { member: "crowd" as const, ...standingsRow(crowd) },
    ],
  };
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADER = "date,slot,question,market_source,market_id,market_prob,member,member_line,house_line,crowd_yes_pct,crowd_count,outcome";

export function standingsCsv(calls: SettledCall[]): string {
  const rows = calls.flatMap((c) =>
    [...c.lines].sort((a, b) => MEMBER_ORDER.indexOf(a.member as never) - MEMBER_ORDER.indexOf(b.member as never)).map((l) =>
      [c.date, c.slot, c.text, c.marketSource, c.marketId, c.marketProb, l.member, l.pYes, c.linePYes, c.crowdYesPct, c.crowdCount, c.outcome].map(csvCell).join(","),
    ),
  );
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}

const NAMES: Record<string, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", market: "The market", crowd: "The players" };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The site's tokens, inlined (apps/site/public/style.css): the page is served
// from the API host and must not depend on the site's stylesheet.
const STYLE = `:root{--ground:#F7F6F2;--ink:#17191F;--muted:#666A73;--gold-text:#7E6538;--line:rgba(23,25,31,.16)}
@media (prefers-color-scheme:dark){:root{--ground:#121A2B;--ink:#EDEAE2;--muted:#9AA3B6;--gold-text:#D6BA80;--line:rgba(237,234,226,.18)}}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--ink);font-family:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px;line-height:1.65}
.wrap{max-width:720px;margin:0 auto;padding:30px 24px 100px}
.brand{font-family:Cinzel,Georgia,serif;font-weight:600;font-size:13px;letter-spacing:.4em;color:var(--gold-text);text-decoration:none}
h1{font-family:Marcellus,Georgia,serif;font-weight:400;font-size:28px;margin:28px 0 8px}
p{color:var(--muted);margin:0 0 18px}
table{border-collapse:collapse;width:100%;margin:12px 0 24px}
th{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
td{padding:10px 6px;border-bottom:1px solid var(--line);font-variant-numeric:tabular-nums}
td.n{text-align:right}a{color:var(--gold-text)}`;

export function standingsHtml(s: Standings): string {
  const rows = s.rows.map((r) =>
    `<tr><td>${escapeHtml(NAMES[r.member] ?? r.member)}</td><td class="n">${r.calls}</td><td class="n">${r.brier === null ? "—" : r.brier.toFixed(3)}</td><td class="n">${r.house_delta > 0 ? "+" : ""}${r.house_delta}</td></tr>`,
  ).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Standings · Outsee</title><style>${STYLE}</style></head><body><div class="wrap"><a class="brand" href="https://outseen-site.etaheri.workers.dev/">Outsee</a><h1>Standings</h1><p>Each member of the Council commits a line on every question before it opens. Brier is the mean squared error of the line, lower is better; house delta is what the purse would have done with that member alone, at the stakes players actually placed. On opinion rounds the players are the answer, so their row is the baseline the machines are measured against.</p><table><thead><tr><th>Member</th><th>Calls</th><th>Brier</th><th>House delta</th></tr></thead><tbody>${rows}</tbody></table><p>${s.questions} questions over ${s.rounds} rounds, as of ${escapeHtml(s.as_of.slice(0, 10))}. <a href="/v1/standings?format=csv">Download the record as CSV</a> · <a href="/v1/standings">JSON</a></p></div></body></html>`;
}
