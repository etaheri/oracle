// The Council commit (design 2026-09-11 §7): the median of the model members
// present becomes oracle_p_yes through commit_council, which wraps the
// existing commit_oracle_forecast so the snapshot check, the deadline check
// and the members' rows land in one statement. Then the house line, by the
// same clamp the single forecast used.
import { eq, sql } from "drizzle-orm";
import { MODEL_MEMBER_IDS, medianLine } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { commitLine } from "../line";
import { BudgetExhausted } from "../spend";
import { COUNCIL_PROMPT_VERSION, memberModel } from "./members";
import type { MemberResult } from "./member";

// drizzle-orm wraps a raised Postgres exception (e.g. commit_oracle_forecast's
// "opening deadline passed") in a DrizzleQueryError whose own .message is the
// generic "Failed query: ...", with the actual exception text on .cause — see
// council-schema.test.ts. Prefer that when present.
function errorReason(err: unknown): string {
  if (err instanceof Error) {
    return err.cause instanceof Error ? err.cause.message : err.message;
  }
  return String(err);
}

export interface CouncilCommit {
  committed: boolean;
  reason: string | null;
  lines: number;
  slots: { slot: number; present: string[]; median: number | null }[];
}

export async function commitCouncil(deps: PipelineDeps, date: string, results: MemberResult[]): Promise<CouncilCommit> {
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, date) });
  if (!round) return { committed: false, reason: "round missing", lines: 0, slots: [] };
  if (round.oracleCommittedAt !== null) {
    // The round IS staked — a prior call landed the commit — so a retry
    // (e.g. the Workflow's `commit` step re-running after committing but
    // throwing before returning, most plausibly inside the commitLine call
    // below) must still close out the line rather than leave it to a later
    // forecast tick. commitLine is write-once and idempotent, so calling it
    // again here is always safe.
    await commitLine(deps.db, date);
    return { committed: false, reason: "already committed", lines: 0, slots: [] };
  }
  if (round.rulesVersion < 3) return { committed: false, reason: "not a version 3 round", lines: 0, slots: [] };

  const rows = await deps.db.query.questions.findMany({
    where: eq(schema.questions.roundDate, date),
    orderBy: (q, { asc }) => [asc(q.slot)],
    columns: { id: true, slot: true, isBigOne: true, text: true, category: true, resolutionCriteria: true, sourceName: true, sourceUrl: true, context: true, opensAt: true, locksAt: true, marketProb: true },
  });
  if (rows.length !== 5) return { committed: false, reason: "five questions required", lines: 0, slots: [] };

  const slots = rows.map((q) => {
    const present = MODEL_MEMBER_IDS.filter((m) => results.find((r) => r.member === m)?.lines.some((l) => l.questionId === q.id));
    const values = present.map((m) => results.find((r) => r.member === m)!.lines.find((l) => l.questionId === q.id)!.pYes);
    return { slot: q.slot, present: [...present], median: medianLine(values) };
  });
  const thin = slots.find((s) => s.median === null);
  if (thin) return { committed: false, reason: `fewer than two members present on slot ${thin.slot}`, lines: 0, slots };

  const snapshot = rows.map(({ marketProb: _m, ...q }) => ({ ...q, pYes: Math.round(slots.find((s) => s.slot === q.slot)!.median! * 1e6) / 1e6 }));
  const lines = rows.flatMap((q) => {
    const members = results.flatMap((r) => {
      const l = r.lines.find((x) => x.questionId === q.id);
      return l ? [{ question_id: q.id, member: r.member, p_yes: l.pYes, model: memberModel(deps, r.member), prompt_version: COUNCIL_PROMPT_VERSION, reasoning: l.reasoning, cited: l.cited, lessons_received: l.lessonsReceived }] : [];
    });
    const market = q.marketProb === null ? [] : [{ question_id: q.id, member: "market", p_yes: Number(q.marketProb), model: null, prompt_version: null, reasoning: null, cited: [], lessons_received: [] }];
    return [...members, ...market];
  });

  const checkedAt = deps.now();
  try {
    // db.execute returns a driver-shaped result: neon-http and PGlite both
    // give { rows }, but the widened PgDatabase type (src/db/client.ts)
    // promises neither shape — see src/resolution.ts's executeRows for the
    // same defensive read.
    const res: unknown = await deps.db.execute(sql`select commit_council(
      ${date}::date, ${JSON.stringify(snapshot)}::jsonb, ${JSON.stringify(lines)}::jsonb,
      ${COUNCIL_PROMPT_VERSION}, ${checkedAt.toISOString()}::timestamptz
    ) as ok`);
    const resultRows = (res as { rows?: unknown[] } | null)?.rows ?? (Array.isArray(res) ? res : []);
    const ok = Boolean((resultRows[0] as { ok?: boolean } | undefined)?.ok);
    if (!ok) {
      // commit_council itself returned false: another call landed first,
      // between our own read of oracleCommittedAt above and this statement.
      // Same reasoning as the early return above — the round is staked, so
      // close out the line rather than strand it.
      await commitLine(deps.db, date);
      return { committed: false, reason: "already committed", lines: 0, slots };
    }
    await commitLine(deps.db, date);
    return { committed: true, reason: null, lines: lines.length, slots };
  } catch (err) {
    // commit_council can raise (opening deadline passed, question snapshot
    // changed, predictions already submitted): db.execute rejects, and
    // without this catch the Workflow's `commit` step exhausts its retries,
    // the instance fails, and `narrate` never runs — the round opens
    // unstaked in silence. Report it as an ordinary uncommitted outcome
    // instead, so narrateCouncil can raise the ‼️ head it already has.
    // BudgetExhausted still propagates: it is mapped to a NonRetryableError
    // by durableStep, not narrated as a council outcome.
    if (err instanceof BudgetExhausted) throw err;
    return { committed: false, reason: errorReason(err), lines: 0, slots };
  }
}
