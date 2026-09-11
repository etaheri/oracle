// The inline path — `wrangler dev`, tests, and any deployment without the
// COUNCIL_WORKFLOW binding. Identical work, same order, in-process. The
// Workflow drives the same units per step; both share them, which is why the
// two paths cannot drift.
import { eq } from "drizzle-orm";
import { MODEL_MEMBER_IDS } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { retrieveEvidence, type EvidenceSummary } from "./evidence";
import { commitMember, type MemberResult } from "./member";
import { commitCouncil, type CouncilCommit } from "./commit";

export interface CouncilRun {
  editable: boolean;
  evidence: EvidenceSummary | null;
  members: MemberResult[];
  commit: CouncilCommit | null;
}

/** True when the round is a scheduled, uncommitted version 3 round. */
export async function councilEditable(deps: PipelineDeps, date: string): Promise<boolean> {
  const r = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  return !!r && r.status === "scheduled" && r.oracleCommittedAt === null && r.rulesVersion >= 3;
}

export async function runCouncil(deps: PipelineDeps, date: string): Promise<CouncilRun> {
  if (!(await councilEditable(deps, date))) return { editable: false, evidence: null, members: [], commit: null };
  const evidence = await retrieveEvidence(deps, date);
  const members: MemberResult[] = [];
  for (const m of MODEL_MEMBER_IDS) members.push(await commitMember(deps, date, m));
  const commit = await commitCouncil(deps, date, members);
  const run = { editable: true, evidence, members, commit };
  await narrateCouncil(deps, date, run);
  return run;
}

const pct = (p: number) => String(Math.round(p * 100));

export async function narrateCouncil(deps: PipelineDeps, date: string, run: CouncilRun): Promise<void> {
  if (!run.editable || !run.commit) return;
  const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, date), orderBy: (q, { asc }) => [asc(q.slot)], columns: { id: true, slot: true, marketProb: true, linePYes: true } });
  const slotLines = qs.map((q) => {
    const s = run.commit!.slots.find((x) => x.slot === q.slot);
    const parts = MODEL_MEMBER_IDS.map((m) => {
      const l = run.members.find((r) => r.member === m)?.lines.find((x) => x.questionId === q.id);
      return `${m} ${l ? pct(l.pYes) : "—"}`;
    });
    parts.push(`market ${q.marketProb === null ? "—" : pct(Number(q.marketProb))}`);
    const items = run.evidence?.packs.find((p) => p.questionId === q.id)?.count ?? 0;
    const tail = s?.median === null || s === undefined ? "no median" : `median ${pct(s.median)}, line ${q.linePYes === null ? "—" : pct(Number(q.linePYes))}`;
    return `slot ${q.slot}: ${parts.join(" · ")} → ${tail} (${items} item${items === 1 ? "" : "s"})`;
  });
  const abstentions = run.members.filter((m) => m.abstained.length > 0).map((m) => `${m.member} abstained${m.error ? ` (${m.error})` : ""} on ${m.abstained.length === 5 ? "every slot" : `slot${m.abstained.length === 1 ? "" : "s"} ${m.abstained.join(", ")}`}`);
  const packErrors = (run.evidence?.packs ?? []).filter((p) => p.error).map((p) => `slot ${p.slot}: ${p.error}`);
  const cost = `exa $${(run.evidence?.cost ?? 0).toFixed(2)}`;
  // "already committed" means the round IS staked — a concurrent or
  // retried call landed it — so this is informational, not an alert: no ‼️,
  // and no "opens unstaked", which would be false.
  const head = run.commit.committed
    ? `council ${date}: ${run.commit.lines} lines committed`
    : run.commit.reason === "already committed"
      ? `council ${date}: already committed; nothing written`
      : `‼️ council ${date}: no line — ${run.commit.reason}; the round opens unstaked`;
  const body = [head, ...slotLines, ...abstentions, ...(packErrors.length ? [`evidence: ${packErrors.join(" · ")}`] : []), cost].join("\n");
  await deps.telegram.send(body);
}
