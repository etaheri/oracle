// Hermes pipeline tick (spec §2-11). This is the single function the cron
// calls: load state → decide actions (pure, from Tasks 1-2) → execute each
// action in isolation. A single action's failure never aborts the tick — the
// state machine is idempotent per action kind, so a failed action simply
// gets retried on the next tick. Telegram alerts are best-effort narration,
// never load-bearing (spec §11).
import type { Db } from "../db/client";
import { etNow } from "./clock";
import { decideActions, loadPipelineState } from "./state";
import { lock, publish, publishFromBank, settle, voidQuestions } from "./actions";
import { authorBankEntry, authorRound } from "./author";
import { resolveWithClaude } from "./resolve";
import { stampOracleForecast } from "./forecast";
import type { TelegramClient } from "./telegram";
import type { ClaudeClient } from "./claude";
import type { PushEnv } from "../push/onesignal";

export interface PipelineDeps {
  db: Db;
  telegram: TelegramClient;
  claude: ClaudeClient | null;
  models: {
    author: string;    // Opus 5 + search — writes the candidates
    resolve: string;   // Sonnet 5 + search — resolver A
    resolveB: string;  // Opus 5 + search — resolver B, a DIFFERENT model on purpose
    forecast: string;  // Sonnet 5 + search — the Oracle's own position
    critic: string;    // Opus 5, no search — prosecutes the candidates
    preflight: string; // Sonnet 5 + search — the pre-flight resolve
    probe: string;     // Sonnet 5 + search — the in-window probe
    taste: string;     // Haiku 4.5, no search — classification only
  };
  now(): Date;
  // OneSignal credentials for the hinge push at settle. Absent (or absent
  // keys) → sendPushes no-ops cleanly and the settle report says so, which is
  // the state until the account exists.
  push?: PushEnv;
  // Fetch used for market signal feeds (feeds.ts); defaults to global fetch.
  // Injectable so tests never touch the network.
  marketFetch?: typeof fetch;
  // Fetch used for tier-1 source reachability (gauntlet/sources.ts); defaults
  // to global fetch. Injectable so tests never touch the network.
  sourceFetch?: typeof fetch;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runTick(deps: PipelineDeps): Promise<string[]> {
  const now = deps.now();
  const state = await loadPipelineState(deps.db, now, deps.claude !== null);
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

        case "publish-bank": {
          const published = await publishFromBank(deps.db, deps.telegram, action.date);
          if (published) done.push(`publish-bank:${action.date}`);
          break;
        }

        case "void":
          await voidQuestions(deps.db, deps.telegram, action.questionIds, now.toISOString());
          done.push(`void:${action.date}`);
          break;

        case "settle":
          await settle({ db: deps.db, telegram: deps.telegram, push: deps.push }, action.date);
          done.push(`settle:${action.date}`);
          break;

        case "author":
          await authorRound(deps, action.date);
          done.push(`author:${action.date}`);
          break;

        case "forecast":
          await stampOracleForecast(deps, action.date);
          done.push(`forecast:${action.date}`);
          break;

        case "author-bank":
          // One entry a night while the bank is thin. A failure here is
          // narrated by the catch below and retried tomorrow — the buffer is
          // what buys the time, so nothing about today depends on this.
          await authorBankEntry(deps);
          done.push("author-bank");
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
          // questions stay locked, retried hourly) whenever Claude can't
          // produce a sourced yes/no — they void at noon ET two days after
          // the round date (unverifiable within 24 hours of lock).
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
