// The night shift's reactions (design 2026-09-25 §5.3). At resolution, each
// model member whose line was on the wrong side of the room writes one line
// in character; winners say nothing. One Haiku call per wrong member, one
// taste call over the batch, written once. Same guard as lessons: nothing
// here may fail the resolution it follows; only BudgetExhausted escapes.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { MEMBER_PROFILE, MODEL_MEMBER_IDS, onRightSide, type ModelMemberId } from "@oracle/core";
import { schema } from "../../db/client";
import type { PipelineDeps } from "../index";
import { BudgetExhausted } from "../spend";
import { tasteTexts } from "../taste";
import { reactionModel, REACTION_PROMPT_VERSION } from "./members";

export interface ReactionsOutcome { questionId: string; written: number; dropped: number; error?: string }

const MAX_CHARS = 140;
const ReactionSchema = z.object({ text: z.string().min(1).max(MAX_CHARS) });
const reactionJsonSchema = {
  type: "object",
  properties: { text: { type: "string", description: `One line, at most ${MAX_CHARS} characters.` } },
  required: ["text"], additionalProperties: false,
};

function system(member: ModelMemberId): string {
  const me = MEMBER_PROFILE[member];
  return `You are ${me.name}, ${me.title} on THE ORACLE's Council, reacting in #nightshift to being wrong about what the room would say. ${me.register}
One line, at most ${MAX_CHARS} characters. You may mock yourself, your co-workers, or your own record. Never a player, never a group of people, never the take's subject. No emoji, no hashtags. Prompt version ${REACTION_PROMPT_VERSION}. Call the reaction tool exactly once.`;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export async function writeReactions(deps: PipelineDeps, questionId: string): Promise<ReactionsOutcome> {
  const none = { questionId, written: 0, dropped: 0 };
  try {
    const q = await deps.db.query.questions.findFirst({ where: eq(schema.questions.id, questionId) });
    if (!q || q.marketSource !== "crowd" || q.outcome !== "yes" && q.outcome !== "no" || q.resolvedAt === null) return none;
    const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, q.roundDate), columns: { rulesVersion: true } });
    if (!round || round.rulesVersion < 3) return none;
    const outcome = q.outcome;
    const lines = await deps.db.query.lines.findMany({ where: eq(schema.lines.questionId, questionId) });
    const have = new Set((await deps.db.query.reactions.findMany({ where: eq(schema.reactions.questionId, questionId), columns: { member: true } })).map((r) => r.member));
    const wrong = MODEL_MEMBER_IDS.filter((m) => {
      const l = lines.find((x) => x.member === m);
      return l !== undefined && !have.has(m) && onRightSide(Number(l.pYes), outcome) === false;
    });
    if (wrong.length === 0) return none;
    if (!deps.claude) return { ...none, error: "no claude client" };

    const yesPct = q.crowdYesPct === null ? null : Math.round(Number(q.crowdYesPct));
    const room = `THE ROOM: ${yesPct ?? "?"}% agreed of ${q.crowdCount ?? "?"} · outcome ${outcome === "yes" ? "AGREE" : "DISAGREE"}`;
    const others = (me: ModelMemberId) => MODEL_MEMBER_IDS.filter((m) => m !== me).map((m) => {
      const l = lines.find((x) => x.member === m);
      if (!l) return `${MEMBER_PROFILE[m].name} did not post`;
      const right = onRightSide(Number(l.pYes), outcome);
      return `${MEMBER_PROFILE[m].name} said ${pct(Number(l.pYes))} and was ${right === null ? "on neither side" : right ? "right" : "wrong"}`;
    }).join("\n");

    const drafts: { member: ModelMemberId; text: string }[] = [];
    const errors: string[] = [];
    for (const member of wrong) {
      const mine = lines.find((x) => x.member === member)!;
      const user = `THE TAKE: ${q.text}\nYOUR LINE: ${pct(Number(mine.pYes))} agree\nYOUR REASONING: ${mine.reasoning ?? "(none)"}\n${room}\n${others(member)}`;
      try {
        const res = await deps.claude.structured({ model: reactionModel(deps), system: system(member), user, schemaName: "reaction", schema: reactionJsonSchema });
        const parsed = ReactionSchema.safeParse(res);
        if (!parsed.success) { errors.push(`${member}: response failed the reaction schema`); continue; }
        drafts.push({ member, text: parsed.data.text.trim() });
      } catch (err) {
        if (err instanceof BudgetExhausted) throw err;
        errors.push(`${member}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (drafts.length === 0) return { questionId, written: 0, dropped: 0, ...(errors.length ? { error: errors.join(" · ") } : {}) };

    // Fail-closed, as the gate is for takes: a gate failure drops the batch.
    const taste = await tasteTexts(deps, drafts.map((d) => d.text));
    if (taste.detail !== null) return { questionId, written: 0, dropped: drafts.length, error: [`taste: ${taste.detail}`, ...errors].join(" · ") };
    let written = 0;
    let dropped = 0;
    for (let i = 0; i < drafts.length; i++) {
      if (!taste.allowed[i]) { dropped++; continue; }
      await deps.db.insert(schema.reactions)
        .values({ questionId, member: drafts[i]!.member, text: drafts[i]!.text, model: reactionModel(deps), promptVersion: REACTION_PROMPT_VERSION })
        .onConflictDoNothing();
      written++;
    }
    return { questionId, written, dropped, ...(errors.length ? { error: errors.join(" · ") } : {}) };
  } catch (err) {
    if (err instanceof BudgetExhausted) throw err;
    return { ...none, error: err instanceof Error ? err.message : String(err) };
  }
}
