// Telegram webhook — the operator's review-window controls (spec §11).
// Secret-in-path + chat-id allowlist keep this closed to the world; every
// reply happens through deps.pipeline.telegram.send, and every handler path
// returns 200 to Telegram even on internal failure (Telegram retries
// non-2xx forever, so a thrown error would otherwise loop the webhook).
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import type { AppContext } from "../app";
import { loadPipelineState } from "../pipeline/state";
import { rerollSlot } from "../pipeline/author";
import { resolveQuestion } from "../resolution";
import { resettleRound } from "../settlement";
import { schema } from "../db/client";

export type Command =
  | { cmd: "reroll"; slot: number; guidance: string }
  | { cmd: "flip"; slot: number; outcome: "yes" | "no" | "void" }
  | { cmd: "status" }
  | { cmd: "help" };

export function parseCommand(text: string): Command {
  const parts = text.trim().split(/\s+/);
  const head = parts[0];

  if (head === "/status") return { cmd: "status" };

  if (head === "/reroll") {
    const slotStr = parts[1];
    if (!slotStr || !/^\d+$/.test(slotStr)) return { cmd: "help" };
    const slot = Number(slotStr);
    if (slot < 1 || slot > 5) return { cmd: "help" };
    const guidance = parts.slice(2).join(" ");
    return { cmd: "reroll", slot, guidance };
  }

  if (head === "/flip") {
    const slot = Number(parts[1]);
    const outcome = (parts[2] ?? "").toLowerCase();
    if (!Number.isInteger(slot) || slot < 1 || slot > 5) return { cmd: "help" };
    if (outcome !== "yes" && outcome !== "no" && outcome !== "void") return { cmd: "help" };
    return { cmd: "flip", slot, outcome };
  }

  return { cmd: "help" };
}

interface TelegramUpdate {
  message?: { chat?: { id?: number }; text?: string };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const HELP_TEXT = "/reroll <slot> [guidance] · /flip <slot> <yes|no|void> · /status";

export const telegramRoutes = new Hono<AppContext>().post("/:secret", async (c) => {
  const { env, pipeline } = c.get("deps");
  const secret = env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || c.req.param("secret") !== secret) return c.notFound();

  const body = (await c.req.json().catch(() => null)) as TelegramUpdate | null;
  const chat = body?.message?.chat;
  const text = body?.message?.text;
  if (!chat || chat.id === undefined || typeof text !== "string") return c.json({ ok: true });
  if (String(chat.id) !== env.TELEGRAM_CHAT_ID) return c.json({ ok: true });

  if (!pipeline) return c.json({ ok: true });

  const send = (msg: string) => pipeline.telegram.send(msg);

  try {
    const command = parseCommand(text);
    switch (command.cmd) {
      case "help":
        await send(HELP_TEXT);
        break;

      case "status": {
        const state = await loadPipelineState(pipeline.db, pipeline.now());
        const lines = [
          state.openRound
            ? `open: ${state.openRound.date} (lock ${state.openRound.lockPassed ? "passed" : "pending"})`
            : "open: none",
          state.lockedRound
            ? `locked-unsettled: ${state.lockedRound.date} (${state.lockedRound.unresolvedIds.length} unresolved)`
            : "locked-unsettled: none",
          `tomorrow draft: ${state.scheduledDates.length > 0 ? "yes" : "no"}`,
        ];
        await send(lines.join("\n"));
        break;
      }

      case "reroll": {
        const state = await loadPipelineState(pipeline.db, pipeline.now());
        const date = [...state.scheduledDates].sort()[0];
        if (!date) {
          await send("no draft standing");
          break;
        }
        await send(`rerolling slot ${command.slot}…`);
        await rerollSlot(pipeline, date, command.slot, command.guidance);
        break;
      }

      case "flip": {
        const state = await loadPipelineState(pipeline.db, pipeline.now());
        const date = state.lockedRound?.date
          ?? (await pipeline.db.query.rounds.findFirst({ where: eq(schema.rounds.status, "resolved"), orderBy: (r, { desc }) => [desc(r.date)] }))?.date;
        if (!date) { await send("no round to flip"); break; }
        const q = await pipeline.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, command.slot)) });
        if (!q) { await send(`no slot ${command.slot} on ${date}`); break; }
        await resolveQuestion(pipeline.db, q.id, command.outcome, { flipped_by: "telegram", checked_at: pipeline.now().toISOString(), reason: "overturned by the operator" }, { force: true });
        const { users } = await resettleRound(pipeline.db, date);
        await send(`flipped slot ${command.slot} of ${date} → ${command.outcome.toUpperCase()} · rescored ${users} users`);
        break;
      }
    }
  } catch (err) {
    await send(errorMessage(err));
  }

  return c.json({ ok: true });
});
