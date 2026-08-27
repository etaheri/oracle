// Hermes pipeline tick (spec §2-11). This is the single function the cron
// calls: load state → decide actions (pure, from Tasks 1-2) → execute each
// action in isolation. A single action's failure never aborts the tick — the
// state machine is idempotent per action kind, so a failed action simply
// gets retried on the next tick. Telegram alerts are best-effort narration,
// never load-bearing (spec §11).
import type { Db } from "../db/client";
import { etNow } from "./clock";
import { decideActions, loadPipelineState } from "./state";
import { lock, publish, settle, voidQuestions } from "./actions";
import { authorRound } from "./author";
import { resolveWithClaude } from "./resolve";
import type { TelegramClient } from "./telegram";
import type { ClaudeClient } from "./claude";

export interface PipelineDeps {
  db: Db;
  telegram: TelegramClient;
  claude: ClaudeClient | null;
  models: { author: string; resolve: string };
  now(): Date;
  // Fetch used for market signal feeds (feeds.ts); defaults to global fetch.
  // Injectable so tests never touch the network.
  marketFetch?: typeof fetch;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runTick(deps: PipelineDeps): Promise<string[]> {
  const now = deps.now();
  const state = await loadPipelineState(deps.db, now);
  const actions = decideActions(etNow(now), state);
  const done: string[] = [];

  for (const action of actions) {
    try {
      switch (action.kind) {
        case "lock":
          await lock(deps.db, action.date);
          done.push(`lock:${action.date}`);
          break;

        case "publish": {
          const published = await publish(deps.db, deps.telegram, action.date);
          if (published) done.push(`publish:${action.date}`);
          break;
        }

        case "void":
          await voidQuestions(deps.db, deps.telegram, action.questionIds, now.toISOString());
          done.push(`void:${action.date}`);
          break;

        case "settle":
          await settle({ db: deps.db, telegram: deps.telegram }, action.date);
          done.push(`settle:${action.date}`);
          break;

        case "author":
          await authorRound(deps, action.date);
          done.push(`author:${action.date}`);
          break;

        case "resolve":
          // Each question resolves independently — spec §6: one Claude call
          // failing must never stall the other, still-resolvable questions.
          for (const questionId of action.questionIds) {
            try {
              await resolveWithClaude(deps, questionId);
            } catch (err) {
              await deps.telegram.send(`⚠ resolve failed: ${errorMessage(err)}`);
            }
          }
          // "resolve:<date>" means the tick ATTEMPTED resolution for every
          // still-locked question in this round — not that all of them
          // resolved. resolveWithClaude returns false (and unresolved
          // questions stay locked for the next tick, then void at 13:00 ET)
          // whenever Claude can't produce a sourced yes/no.
          done.push(`resolve:${action.date}`);
          break;

        case "alert": {
          const prefix = action.level === "critical" ? "‼️" : "⚠";
          await deps.telegram.send(`${prefix} ${action.message}`);
          break;
        }
      }
    } catch (err) {
      await deps.telegram.send(`⚠ ${action.kind} failed: ${errorMessage(err)}`);
    }
  }

  return done;
}
