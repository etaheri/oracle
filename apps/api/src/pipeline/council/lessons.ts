// Memory (design 2026-09-11 §8), taken from TradingAgents' decision log and
// nothing else of it: store the decision now, reflect once when the outcome
// is known, feed a few short lessons back under the as-of rule. One Haiku
// call per model member per settled question; written once; a member's own.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MODEL_MEMBER_IDS, type ModelMemberId } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { BudgetExhausted } from "../spend";
import { lessonModel, LESSON_PROMPT_VERSION } from "./members";
import { seriesKeyOf } from "./lessonsFor";

export interface LessonsOutcome { questionId: string; written: number; skipped: number; error?: string }

const LessonSchema = z.object({ text: z.string().min(1) });
const lessonJsonSchema = {
  type: "object",
  properties: { text: { type: "string", description: "Two to four plain sentences." } },
  required: ["text"], additionalProperties: false,
};

const SYSTEM = `You write one lesson for a forecaster reviewing its own settled call. State in two to four plain sentences whether the line was on the right side of the outcome, what in the reasoning held or failed, and one concrete adjustment for the next question in the same series. No preamble. Prompt version ${LESSON_PROMPT_VERSION}. Call the lesson tool exactly once.`;

const NAMES: Record<ModelMemberId, string> = { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku" };

export async function writeLessons(deps: PipelineDeps, questionId: string): Promise<LessonsOutcome> {
  const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
  if (!q || q.outcome === null || q.outcome === "void" || q.resolvedAt === null) return { questionId, written: 0, skipped: 0 };
  const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate), columns: { rulesVersion: true } });
  if (!round || round.rulesVersion < 3) return { questionId, written: 0, skipped: 0 };
  const lines = await deps.db.query.lines.findMany({ where: eq(schema.lines.questionId, questionId) });
  const have = new Set((await deps.db.query.lessons.findMany({ where: eq(schema.lessons.questionId, questionId), columns: { member: true } })).map((l) => l.member));

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (const member of MODEL_MEMBER_IDS) {
    const line = lines.find((l) => l.member === member);
    if (!line) continue;
    if (have.has(member)) { skipped++; continue; }
    if (!deps.claude) { errors.push(`${member}: no claude client`); continue; }
    const user = `MEMBER: ${NAMES[member]}\nQUESTION: ${q.text}\nRESOLVES BY: ${q.resolutionCriteria}\nSERIES: ${seriesKeyOf(q)}\nYOUR LINE: ${Number(line.pYes)} (probability of YES)\nYOUR REASONING: ${line.reasoning ?? "(none)"}\nOUTCOME: ${q.outcome.toUpperCase()}`;
    try {
      const res = await deps.claude.structured({ model: lessonModel(deps), system: SYSTEM, user, schemaName: "lesson", schema: lessonJsonSchema });
      const parsed = LessonSchema.safeParse(res);
      if (!parsed.success) { errors.push(`${member}: response failed the lesson schema`); continue; }
      await deps.db.insert(schema.lessons)
        .values({ member, seriesKey: seriesKeyOf(q), questionId, text: parsed.data.text.trim(), resolvedAt: q.resolvedAt })
        .onConflictDoNothing();
      written++;
    } catch (err) {
      if (err instanceof BudgetExhausted) throw err;
      errors.push(`${member}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { questionId, written, skipped, ...(errors.length ? { error: errors.join(" · ") } : {}) };
}
