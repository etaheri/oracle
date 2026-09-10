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
import { authorBankEntry } from "./author";
import { stampOracleForecast } from "./forecast";
import { commitLine } from "./line";
import { hourBucket, type WorkflowStarter } from "./workflows";
import { meterClaude, reportBudgetExhaustion } from "./spend";
import type { TelegramClient } from "./telegram";
import type { ClaudeClient } from "./claude";
import type { ExchangeFeed } from "./exchanges/types";
import type { PushEnv } from "../push/onesignal";

export interface PipelineDeps {
  db: Db;
  telegram: TelegramClient;
  claude: ClaudeClient | null;
  models: {
    author: string;    // Opus 5 + search — bank authoring and /reroll only,
                       // never the nightly round
    resolve: string;   // Sonnet 5 + search — resolver A
    resolveB: string;  // Opus 5 + search — resolver B, a DIFFERENT model on purpose
    forecast: string;  // Sonnet 5 + search — the Oracle's own position
    taste: string;     // Haiku 4.5, no search — classification only
    voice: string;     // Sonnet 5, no search — rewrites exchange titles in the app's voice
  };
  now(): Date;
  // How long work is launched. In production this is bindingStarter over the
  // two Workflow bindings; in tests and wherever the bindings are absent it
  // is inlineStarter, which awaits the runner in-process — so behaviour and the
  // executed-action labels are identical either way.
  workflows: WorkflowStarter;
  // OneSignal credentials for the hinge push at settle. Absent (or absent
  // keys) → sendPushes no-ops cleanly and the settle report says so, which is
  // the state until the account exists.
  push?: PushEnv;
  // Fetch used for market signal feeds (feeds.ts); defaults to global fetch.
  // Injectable so tests never touch the network.
  marketFetch?: typeof fetch;
  // The exchanges the market round is dealt from (design 2026-09-10 §5.1).
  // Defaults to DEFAULT_EXCHANGES; tests inject canned feeds.
  exchangeFeeds?: ExchangeFeed[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runTick(deps: PipelineDeps): Promise<string[]> {
  const now = deps.now();
  const et = etNow(now);
  const bucket = hourBucket(et);

  // THE CEILING, APPLIED IN ONE PLACE. Every model call in this pipeline goes
  // through deps.claude, and no deterministic action touches it — which is
  // exactly why lock, publish, void and settle can never be blocked by the
  // budget. Everything downstream, including the inline starter's runners,
  // receives this metered copy.
  const metered: PipelineDeps = {
    ...deps,
    claude: deps.claude ? meterClaude(deps.db, deps.claude, et.date) : null,
  };

  const state = await loadPipelineState(deps.db, now, deps.claude !== null);
  const actions = decideActions(et, state);
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
          await deps.workflows.start(metered, "author", `author-${action.date}-${bucket}`, { date: action.date });
          done.push(`author:${action.date}`);
          break;

        case "forecast":
          await stampOracleForecast(metered, action.date);
          // The line follows the commit on the same tick (design 2026-09-10 §5.5)
          // and on every later forecast tick until every question carries one.
          await commitLine(deps.db, action.date);
          done.push(`forecast:${action.date}`);
          break;

        case "author-bank":
          // One entry a night while the bank is thin. A failure here is
          // narrated by the catch below and retried tomorrow — the buffer is
          // what buys the time, so nothing about today depends on this.
          await authorBankEntry(metered);
          done.push("author-bank");
          break;

        case "resolve":
          // "resolve:<date>" means the tick DISPATCHED resolution for every
          // still-locked question in this round — not that all of them
          // resolved. Unresolved questions stay locked and are retried
          // hourly; they void at noon ET two days after the round date.
          await deps.workflows.start(metered, "resolve", `resolve-${action.date}-${bucket}`, {
            date: action.date,
            questionIds: action.questionIds,
          });
          done.push(`resolve:${action.date}`);
          break;

        case "alert": {
          const prefix = action.level === "critical" ? "‼️" : "⚠";
          await deps.telegram.send(`${prefix} ${action.message}`);
          break;
        }
      }
    } catch (err) {
      // The budget's own alert, raised exactly once — on the call that crossed
      // the line. It covers only the actions this tick still AWAITS: a
      // dispatched Workflow runs on the far side of create(), so its
      // entrypoint narrates its own exhaustion.
      if (!(await reportBudgetExhaustion(deps.telegram, err))) {
        await deps.telegram.send(`⚠ ${action.kind} failed: ${errorMessage(err)}`);
      }
    }
  }

  return done;
}
