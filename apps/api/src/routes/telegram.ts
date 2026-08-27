// Telegram webhook — the operator's review-window controls (spec §11).
// Secret-in-path + chat-id allowlist keep this closed to the world; every
// reply happens through deps.pipeline.telegram.send, and every handler path
// returns 200 to Telegram even on internal failure (Telegram retries
// non-2xx forever, so a thrown error would otherwise loop the webhook).
import { Hono } from "hono";
import type { AppContext } from "../app";
import { loadPipelineState } from "../pipeline/state";
import { rerollSlot } from "../pipeline/author";

export type Command =
  | { cmd: "reroll"; slot: number; guidance: string }
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

  return { cmd: "help" };
}

interface TelegramUpdate {
  message?: { chat?: { id?: number }; text?: string };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const HELP_TEXT = "/reroll <slot> [guidance] · /status";

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
        const date = state.scheduledDates[0];
        if (!date) {
          await send("no draft standing");
          break;
        }
        await send(`rerolling slot ${command.slot}…`);
        await rerollSlot(pipeline, date, command.slot, command.guidance);
        break;
      }
    }
  } catch (err) {
    await send(errorMessage(err));
  }

  return c.json({ ok: true });
});
