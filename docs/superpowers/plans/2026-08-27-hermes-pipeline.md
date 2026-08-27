# Hermes Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily round loop operational: a cron-driven state machine in the API Worker that authors, publishes, locks, resolves (verify-or-void), and settles rounds, with Telegram alerts and a review window.

**Architecture:** A dumb `*/10` cron tick reads ET time + DB state, a pure `decideActions` function decides what is due, and idempotent executors act. Claude is called only for authoring (opus + web search) and resolution (sonnet + source-restricted web search); all control flow is deterministic code. Clients (Claude, Telegram) are fetch-based, injectable, and no-op gracefully when unconfigured.

**Tech Stack:** Hono on Cloudflare Workers, Drizzle (neon-http), zod, PGlite for tests, Anthropic Messages API (web search server tool), Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-08-27-hermes-pipeline-design.md` — read it first; every editorial and timing rule below is copied from it.

## Global Constraints

- **No new npm dependencies.** Claude and Telegram clients are plain `fetch`.
- **neon-http has NO interactive transactions** — never write code needing one.
- **ET time only via `Intl.DateTimeFormat` with `America/New_York`** — never hard-coded UTC offsets.
- **No live network calls in tests.** Every Claude/Telegram interaction goes through an injectable interface with fakes in tests.
- API vitest runs **single-worker** (already pinned in `vitest.config.ts`); PGlite tests use `makeTestDb()` from `test/helpers/db.ts` — never a real DB.
- Status lifecycles (already in schema, this pipeline is their driver): round `scheduled → open → locked → resolved`; question `scheduled → open → locked → resolved | void`.
- Exactly ONE round may have status `open` at any time (`openRound` in routes assumes it).
- Models: authoring default `claude-opus-5`, resolution default `claude-sonnet-5`, overridable via env vars `PIPELINE_AUTHOR_MODEL` / `PIPELINE_RESOLVE_MODEL`.
- The scheduled handler no-ops unless `PIPELINE_ENABLED === "true"`.
- Secrets (never committed): `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET`. All optional at runtime: missing Telegram config → client logs and returns; missing Anthropic key → author/resolve actions fail per-tick with a WARN alert (pipeline structure keeps running).
- `settleRound` is NOT atomic (PLAN-4 precondition comment in `settlement.ts`) — do not change it; the retry-until-settled loop tolerates it exactly like the admin route does.
- Run all api commands from `apps/api/`. Full-suite check: `npx vitest run` and `npx tsc --noEmit`.

## File Map

- Create `apps/api/src/pipeline/clock.ts` — ET time helpers (pure).
- Create `apps/api/src/pipeline/state.ts` — `PipelineState`, `Action`, `loadPipelineState`, `decideActions` (pure core).
- Create `apps/api/src/pipeline/telegram.ts` — Telegram client + pure command parser.
- Create `apps/api/src/pipeline/actions.ts` — lock/publish/void/settle executors + day report.
- Create `apps/api/src/pipeline/index.ts` — `PipelineDeps`, `runTick`.
- Create `apps/api/src/pipeline/draft.ts` — zod draft schema + insert/replace.
- Create `apps/api/src/pipeline/claude.ts` — Anthropic structured-output client.
- Create `apps/api/src/pipeline/author.ts` — authoring + reroll (stub in Task 3, real in Task 6).
- Create `apps/api/src/pipeline/resolve.ts` — resolution (stub in Task 3, real in Task 7).
- Create `apps/api/src/routes/telegram.ts` — webhook route.
- Modify `apps/api/src/routes/admin.ts`, `src/app.ts`, `src/worker.ts`, `wrangler.jsonc`, `.dev.vars`.
- Tests: `apps/api/test/pipeline-clock.test.ts`, `pipeline-decide.test.ts`, `pipeline-tick.test.ts`, `pipeline-draft.test.ts`, `admin-rounds.test.ts`, `pipeline-claude.test.ts`, `pipeline-author.test.ts`, `pipeline-resolve.test.ts`, `telegram-webhook.test.ts`.

---

### Task 1: ET clock helpers

**Files:**
- Create: `apps/api/src/pipeline/clock.ts`
- Test: `apps/api/test/pipeline-clock.test.ts`

**Interfaces:**
- Produces: `ETNow { date: string; hour: number; minute: number }`, `etNow(now: Date): ETNow`, `noonET(date: string): Date`, `addDays(date: string, n: number): string`. Later tasks consume all three.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { addDays, etNow, noonET } from "../src/pipeline/clock";

describe("etNow", () => {
  it("converts UTC instants to ET wall clock (EDT)", () => {
    // 2026-08-27 is daylight time: ET = UTC-4
    expect(etNow(new Date("2026-08-27T16:10:00Z"))).toEqual({ date: "2026-08-27", hour: 12, minute: 10 });
  });
  it("converts in standard time (EST)", () => {
    // 2026-01-15 is standard time: ET = UTC-5
    expect(etNow(new Date("2026-01-15T17:00:00Z"))).toEqual({ date: "2026-01-15", hour: 12, minute: 0 });
  });
  it("crosses the date line correctly", () => {
    expect(etNow(new Date("2026-08-28T02:00:00Z")).date).toBe("2026-08-27");
  });
  it("never yields hour 24 at ET midnight", () => {
    expect(etNow(new Date("2026-08-27T04:00:00Z")).hour).toBe(0);
  });
});

describe("noonET", () => {
  it("is 16:00Z in daylight time", () => {
    expect(noonET("2026-08-27").toISOString()).toBe("2026-08-27T16:00:00.000Z");
  });
  it("is 17:00Z in standard time", () => {
    expect(noonET("2026-01-15").toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });
  it("handles the spring-forward date", () => {
    // 2026-03-08: DST begins 2:00 ET; noon that day is already EDT
    expect(noonET("2026-03-08").toISOString()).toBe("2026-03-08T16:00:00.000Z");
  });
});

describe("addDays", () => {
  it("adds and subtracts across month ends", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-09-01", -1)).toBe("2026-08-31");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run test/pipeline-clock.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// ET wall-clock helpers. The cron is UTC and dumb; ALL schedule intelligence
// derives from these (spec §2-3). Intl only — never hard-coded offsets.
const ET = "America/New_York";

export interface ETNow { date: string; hour: number; minute: number }

export function etNow(now: Date): ETNow {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // some engines render midnight as "24" with hour12:false
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")) };
}

// Noon ET on `date` as a UTC instant: 16:00Z under EDT, 17:00Z under EST.
// Decided by asking Intl what 16:00Z reads as in ET on that date.
export function noonET(date: string): Date {
  const edt = new Date(`${date}T16:00:00Z`);
  return etNow(edt).hour === 12 ? edt : new Date(`${date}T17:00:00Z`);
}

export function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run test/pipeline-clock.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/pipeline/clock.ts test/pipeline-clock.test.ts && git commit -m "feat(api): pipeline ET clock helpers"`

---

### Task 2: Pipeline state + decideActions

**Files:**
- Create: `apps/api/src/pipeline/state.ts`
- Test: `apps/api/test/pipeline-decide.test.ts` (pure) and state-loading cases in the same file (PGlite)

**Interfaces:**
- Consumes: `ETNow`, `addDays` from Task 1.
- Produces (Tasks 3, 8, 9 rely on these exact shapes):

```ts
export type Action =
  | { kind: "lock"; date: string }
  | { kind: "publish"; date: string }
  | { kind: "resolve"; date: string; questionIds: string[] }
  | { kind: "void"; date: string; questionIds: string[] }
  | { kind: "settle"; date: string }
  | { kind: "author"; date: string }
  | { kind: "alert"; level: "warn" | "critical"; message: string };

export interface PipelineState {
  openRound: { date: string; lockPassed: boolean } | null;      // status='open'; lockPassed = now >= questions' locksAt
  lockedRound: { date: string; unresolvedIds: string[] } | null; // status='locked'
  scheduledDates: string[];                                      // rounds with status='scheduled'
}

export function loadPipelineState(db: Db, now: Date): Promise<PipelineState>;
export function decideActions(now: ETNow, state: PipelineState): Action[];
```

**Timing rules (spec §2, §9 — encode exactly):**
- LOCK whenever `openRound.lockPassed`.
- PUBLISH when `hour >= 12`, today ∈ `scheduledDates`, and (`openRound` is null OR `lockPassed` — lock is emitted earlier in the same list and executes first). If an open round exists with `lockPassed === false`, no publish (two-open guard).
- On `lockedRound`: if `unresolvedIds.length > 0` → `hour >= 13 ? VOID : RESOLVE`; else SETTLE.
- AUTHOR tomorrow when tomorrow ∉ `scheduledDates`, `hour >= 17`, and `minute < 10` (hourly throttle — spec §2).
- Alerts (each throttled to one tick per hour by minute window):
  - CRITICAL "no draft for tomorrow — seed manually: POST /admin/rounds/<tomorrow>" when `hour >= 23 && minute < 10` and tomorrow ∉ scheduledDates.
  - CRITICAL "no round published for today — POST /admin/rounds/<today>/publish (or seed a draft first)" when `hour >= 12 && minute >= 10 && minute < 20`, today ∉ scheduledDates, and there is no open round for today (`openRound?.date !== today`).
  - CRITICAL "round <date> locked but unsettled" when `lockedRound` exists and `(hour > 13 || (hour === 13 && minute >= 30)) && minute >= 30 && minute < 40`.
- Order of returned actions: lock, publish, resolve/void, settle, author, alerts.

- [ ] **Step 1: Write the failing tests** — pure grid over the day:

```ts
import { describe, expect, it } from "vitest";
import { decideActions, loadPipelineState, type PipelineState } from "../src/pipeline/state";
import { makeTestDb, seedRound } from "./helpers/db";

const empty: PipelineState = { openRound: null, lockedRound: null, scheduledDates: [] };
const at = (hour: number, minute = 0) => ({ date: "2026-08-27", hour, minute });

describe("decideActions", () => {
  it("does nothing on a quiet mid-morning tick", () => {
    expect(decideActions(at(9), { ...empty, openRound: { date: "2026-08-26", lockPassed: false } })).toEqual([]);
  });
  it("locks a round past its lock time", () => {
    const acts = decideActions(at(12), { ...empty, openRound: { date: "2026-08-26", lockPassed: true } });
    expect(acts[0]).toEqual({ kind: "lock", date: "2026-08-26" });
  });
  it("locks then publishes in one noon tick", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: true }, lockedRound: null, scheduledDates: ["2026-08-27"] });
    expect(acts.map((a) => a.kind)).toEqual(["lock", "publish"]);
  });
  it("never publishes while another round is open and not yet lockable", () => {
    const acts = decideActions(at(12), { openRound: { date: "2026-08-26", lockPassed: false }, lockedRound: null, scheduledDates: ["2026-08-27"] });
    expect(acts.some((a) => a.kind === "publish")).toBe(false);
  });
  it("does not publish before noon", () => {
    expect(decideActions(at(11, 50), { ...empty, scheduledDates: ["2026-08-27"] })).toEqual([]);
  });
  it("resolves unresolved questions before 13:00 and voids after", () => {
    const st: PipelineState = { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: ["a", "b"] } };
    expect(decideActions(at(12, 20), st)).toEqual([{ kind: "resolve", date: "2026-08-26", questionIds: ["a", "b"] }]);
    expect(decideActions(at(13, 0), st)).toEqual([{ kind: "void", date: "2026-08-26", questionIds: ["a", "b"] }]);
  });
  it("settles once nothing is unresolved", () => {
    expect(decideActions(at(12, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: [] } }))
      .toEqual([{ kind: "settle", date: "2026-08-26" }]);
  });
  it("authors tomorrow from 17:00, only on minute<10 ticks", () => {
    expect(decideActions(at(17, 0), empty)).toEqual([{ kind: "author", date: "2026-08-28" }]);
    expect(decideActions(at(17, 30), empty)).toEqual([]);
    expect(decideActions(at(16, 0), empty)).toEqual([]);
  });
  it("skips author when tomorrow is drafted", () => {
    expect(decideActions(at(18, 0), { ...empty, scheduledDates: ["2026-08-28"] })).toEqual([]);
  });
  it("criticals at 23:00 with no draft", () => {
    const acts = decideActions(at(23, 0), empty);
    expect(acts.some((a) => a.kind === "alert" && a.level === "critical" && a.message.includes("2026-08-28"))).toBe(true);
  });
  it("criticals at 12:10 with nothing published or publishable", () => {
    const acts = decideActions(at(12, 10), empty);
    expect(acts.some((a) => a.kind === "alert" && a.level === "critical")).toBe(true);
    expect(decideActions(at(12, 10), { ...empty, openRound: { date: "2026-08-27", lockPassed: false } })).toEqual([]);
  });
  it("criticals at 13:30 with a still-unsettled round", () => {
    const acts = decideActions(at(13, 30), { ...empty, lockedRound: { date: "2026-08-26", unresolvedIds: [] } });
    expect(acts.filter((a) => a.kind === "alert").length).toBe(1);
  });
});

describe("loadPipelineState", () => {
  it("classifies open/locked/scheduled rounds and unresolved questions", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const st = await loadPipelineState(db, new Date("2026-08-27T16:05:00Z"));
    expect(st.openRound).toEqual({ date: "2026-08-26", lockPassed: true });
    const st2 = await loadPipelineState(db, new Date("2026-08-27T15:00:00Z"));
    expect(st2.openRound).toEqual({ date: "2026-08-26", lockPassed: false });
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement `state.ts`.** `loadPipelineState`: query rounds by status (`open`, `locked`, `scheduled`); for the open round, `lockPassed` = `now >= max(questions.locksAt)`; for the locked round, `unresolvedIds` = its questions still in status `locked` (ordered by slot). `decideActions` implements the timing rules verbatim; keep it a single readable function of ifs — no cleverness.
- [ ] **Step 4: Run to verify pass**, plus `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): pipeline state machine — loadPipelineState + decideActions"`

---

### Task 3: Telegram client, action executors, runTick

**Files:**
- Create: `apps/api/src/pipeline/telegram.ts`, `apps/api/src/pipeline/actions.ts`, `apps/api/src/pipeline/index.ts`, stub `apps/api/src/pipeline/author.ts`, stub `apps/api/src/pipeline/resolve.ts`, and `apps/api/src/pipeline/claude.ts` containing ONLY the two interfaces below (Task 5 adds the implementation to this same file):

```ts
// claude.ts — interfaces only in this task; makeClaudeClient arrives in Task 5.
export interface StructuredCall {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  webSearch?: { allowedDomains?: string[]; maxUses?: number };
}
export interface ClaudeClient { structured(call: StructuredCall): Promise<unknown> }
```

- Test: `apps/api/test/pipeline-tick.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 exports; `settleRound(db, date)`; `resolveQuestion(db, id, outcome, evidence)`; `noonET`, `addDays`.
- Produces:

```ts
// telegram.ts
export interface TelegramClient { send(text: string): Promise<void> }
export function makeTelegramClient(botToken: string | undefined, chatId: string | undefined, fetchFn?: typeof fetch): TelegramClient;
// missing token/chatId → send() logs to console and returns (OneSignal no-op pattern in push/onesignal.ts)

// index.ts
export interface PipelineDeps {
  db: Db;
  telegram: TelegramClient;
  claude: ClaudeClient | null;       // type imported from ./claude (interfaces created in this task)
  models: { author: string; resolve: string };
  now(): Date;
}
export async function runTick(deps: PipelineDeps): Promise<string[]>; // labels of executed actions, e.g. ["lock:2026-08-26","publish:2026-08-27"]

// author.ts (stub until Task 6)
export async function authorRound(deps: PipelineDeps, date: string): Promise<void> { throw new Error("authoring not wired"); }
// resolve.ts (stub until Task 7)
export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean> { throw new Error("resolution not wired"); }
```

**Executor behavior (`actions.ts`):**
- `lock(db, date)`: questions of `date` with status `open` → `locked`; round → `locked`.
- `publish(db, date)`: guard — if any round has status `open`, send WARN and skip (spec §2 two-open guard). Else stamp all questions of `date`: `opensAt = noonET(date)`, `locksAt = noonET(addDays(date,1))`, status `scheduled → open`; round → `open`.
- `voidQuestions(db, ids, nowIso)`: for each id, `resolveQuestion(db, id, "void", { unverifiable: true, checked_at: nowIso, reason: "unverifiable by 13:00 ET" })`, then one WARN listing the voided question texts.
- `settle(deps, date)`: `settleRound(db, date)`, then the INFO **day report**: outcomes per slot (✓ text → YES/NO/VOID), `settled` count, and the line `reply if any outcome looks wrong` (spec §6 manual-repair flag).
- `runTick`: `loadPipelineState` → `decideActions(etNow(deps.now()), state)` → execute in order, **each action in its own try/catch**; a throw sends a WARN (`⚠ <kind> failed: <message>`) and continues — the state machine retries next tick. `author` dispatches to `authorRound`, `resolve` loops `resolveWithClaude` per id (each its own catch). `alert` actions send via telegram with `‼️` (critical) / `⚠` (warn) prefix.

- [ ] **Step 1: Write the failing tests** — PGlite + a capturing fake telegram:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { runTick, type PipelineDeps } from "../src/pipeline";
import { resolveQuestion } from "../src/resolution";
import * as schema from "../src/db/schema";

function fakeDeps(db: PipelineDeps["db"], nowIso: string) {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db, claude: null, models: { author: "m-a", resolve: "m-r" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date(nowIso),
  };
  return { deps, sent };
}

describe("runTick", () => {
  it("locks a round whose lock time has passed", async () => {
    const { db } = await makeTestDb();
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    const done = await runTick(deps);
    expect(done).toContain("lock:2026-08-26");
    const round = await db.query.rounds.findFirst({ where: eq(schema.rounds.date, "2026-08-26") });
    expect(round!.status).toBe("locked");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    expect(qs.every((q) => q.status === "locked")).toBe(true);
  });

  it("publishes a scheduled draft at noon and stamps noon open/lock times", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "scheduled" });
    await db.insert(schema.questions).values([1, 2, 3, 4, 5].map((slot) => ({
      roundDate: "2026-08-27", slot, isBigOne: slot === 5, text: `Q${slot}?`, category: "news" as const,
      resolutionCriteria: "c", sourceName: "s", opensAt: new Date(0), locksAt: new Date(0), resolveBy: new Date(0), status: "scheduled" as const,
    })));
    const { deps } = fakeDeps(db, "2026-08-27T16:01:00Z");
    expect(await runTick(deps)).toContain("publish:2026-08-27");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-27") });
    expect(qs[0]!.opensAt.toISOString()).toBe("2026-08-27T16:00:00.000Z");
    expect(qs[0]!.locksAt.toISOString()).toBe("2026-08-28T16:00:00.000Z");
    expect(qs.every((q) => q.status === "open")).toBe(true);
  });

  it("refuses to publish while another round is open (WARN instead)", async () => {
    const { db } = await makeTestDb();
    // open round whose lock is NOT passed (hand-seeded anomaly)
    await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-29T16:00:00Z") });
    await db.insert(schema.rounds).values({ date: "2026-08-27", status: "scheduled" });
    const { deps, sent } = fakeDeps(db, "2026-08-27T16:01:00Z");
    const done = await runTick(deps);
    expect(done.some((d) => d.startsWith("publish"))).toBe(false);
    expect(sent.length).toBe(0); // decide layer already skips publish; no warn needed here
  });

  it("voids unresolved questions after 13:00 ET and then settles on the next tick", async () => {
    const { db } = await makeTestDb();
    const qs = await seedRound(db, { date: "2026-08-26", opensAt: new Date("2026-08-26T16:00:00Z"), locksAt: new Date("2026-08-27T16:00:00Z") });
    for (const q of qs.slice(0, 3)) await resolveQuestion(db, q.id, "yes");
    const { deps: d1 } = fakeDeps(db, "2026-08-27T17:05:00Z"); // 13:05 ET
    let done = await runTick(d1); // lock happens this tick
    expect(done).toContain("lock:2026-08-26");
    const { deps: d2, sent } = fakeDeps(db, "2026-08-27T17:15:00Z");
    done = await runTick(d2); // void the 2 stragglers
    expect(done).toContain("void:2026-08-26");
    expect(sent.some((t) => t.includes("⚠"))).toBe(true);
    const { deps: d3, sent: sent3 } = fakeDeps(db, "2026-08-27T17:25:00Z");
    done = await runTick(d3);
    expect(done).toContain("settle:2026-08-26");
    expect(sent3.some((t) => t.includes("reply if any outcome looks wrong"))).toBe(true);
    const voided = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-26") });
    expect(voided.filter((q) => q.status === "void").length).toBe(2);
  });

  it("author failure becomes a WARN, not a crash", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakeDeps(db, "2026-08-27T21:05:00Z"); // 17:05 ET
    const done = await runTick(deps); // stub authorRound throws "authoring not wired"
    expect(done.some((d) => d.startsWith("author"))).toBe(false);
    expect(sent.some((t) => t.includes("author failed"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `telegram.ts` (POST `https://api.telegram.org/bot<token>/sendMessage` with `{chat_id, text}`; catch and console.error on failure — alerts are never load-bearing, spec §11), `actions.ts`, stubs, and `runTick` per the interfaces above. Executed-action labels are `"<kind>:<date>"`.
- [ ] **Step 4: Run to verify pass; run the full suite** (`npx vitest run`) — settlement tests must be untouched.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): pipeline runTick — lock/publish/void/settle executors + telegram alerts"`

---

### Task 4: Draft schema + admin round endpoints

**Files:**
- Create: `apps/api/src/pipeline/draft.ts`
- Modify: `apps/api/src/routes/admin.ts`, `apps/api/src/app.ts` (Deps gains `pipeline?: PipelineDeps`)
- Test: `apps/api/test/pipeline-draft.test.ts`, `apps/api/test/admin-rounds.test.ts`

**Interfaces:**
- Consumes: `noonET`, `addDays` (Task 1); `PipelineDeps`, `runTick` (Task 3).
- Produces:

```ts
// draft.ts
export const DraftQuestionSchema = z.object({
  slot: z.number().int().min(1).max(5),
  category: z.enum(["markets", "sports", "weather", "culture", "news"]),
  text: z.string().min(10),
  resolution_criteria: z.string().min(10),
  source_name: z.string().min(1),
  source_url: z.string().url(),
  author_probability: z.number().min(0.3).max(0.7),
  is_big_one: z.boolean(),
});
export const DraftSchema = z.object({ questions: z.array(DraftQuestionSchema).length(5) })
  .superRefine((v, ctx) => { /* slots exactly 1..5; exactly one is_big_one and it is slot 5; ≥4 distinct categories */ });
export type Draft = z.infer<typeof DraftSchema>;
export async function upsertDraft(db: Db, date: string, draft: Draft): Promise<void>;
// deletes any existing scheduled round+questions for `date`, inserts round status 'scheduled'
// + questions status 'scheduled' with opensAt=noonET(date), locksAt=noonET(addDays(date,1)),
// resolveBy=locksAt+3_600_000 (the 13:00 ET void deadline). Throws "round not editable"
// if a round exists for `date` with status other than 'scheduled'.
```

- Admin routes added (all behind existing `x-admin-secret` middleware):
  - `POST /admin/rounds/:date` — body `DraftSchema`; 400 invalid, 409 "round not editable", 200 `{ok:true}`.
  - `POST /admin/rounds/:date/publish` — force-publish via the Task 3 publish executor; 404 unknown, 409 if not `scheduled` or another round open, 200 `{ok:true}`.
  - `PATCH /admin/questions/:id` — body zod `{ text?, resolution_criteria?, source_name?, source_url? }`; only when question status is `scheduled` (409 otherwise).
  - `GET /admin/rounds/:date` — `{ round: {date,status}, questions: [{id,slot,status,text,category,outcome}] }`; 404 unknown.
  - `POST /admin/pipeline/tick` — 503 `{error:"pipeline not configured"}` when `deps.pipeline` is undefined; else `{ok:true, executed: await runTick(deps.pipeline)}`. (Dev smoke + manual remedy surface.)

- [ ] **Step 1: Write the failing tests.** `pipeline-draft.test.ts`: valid draft round-trips into scheduled rows with noon stamps; 6 questions rejected; two big-ones rejected; big-one at slot 3 rejected; probability 0.2 rejected; 3-category draft rejected; upsert replaces a prior scheduled draft; upsert onto an `open` round throws. `admin-rounds.test.ts` (existing test style — `createApp` + secret header): each route's happy path + each 4xx listed above; tick route 503 without `deps.pipeline` and executes with a fake.

Draft fixture for tests (reuse everywhere in this plan):

```ts
export const validDraft = { questions: [1, 2, 3, 4, 5].map((slot) => ({
  slot, category: (["markets", "sports", "weather", "culture", "news"] as const)[slot - 1],
  text: `Will thing ${slot} happen tomorrow?`, resolution_criteria: `Official number per source, page X, by 11:00 ET`,
  source_name: "SRC", source_url: "https://example.com/x", author_probability: 0.5, is_big_one: slot === 5,
})) };
```

- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** `draft.ts` and the admin routes. `app.ts`: `export interface Deps { db: Db; env: AppEnv; pipeline?: PipelineDeps }`.
- [ ] **Step 4: Run to verify pass + full suite + `npx tsc --noEmit`.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): draft schema + admin round endpoints + pipeline tick route"`

---

### Task 5: Claude structured-output client

**Files:**
- Modify: `apps/api/src/pipeline/claude.ts` (Task 3 created it with the `StructuredCall`/`ClaudeClient` interfaces; this task adds the implementation)
- Test: `apps/api/test/pipeline-claude.test.ts`

**Interfaces:**
- Consumes: the `StructuredCall`/`ClaudeClient` interfaces already in the file (Task 3).
- Produces: `export function makeClaudeClient(apiKey: string, fetchFn: typeof fetch = fetch): ClaudeClient;`

**Behavior (Anthropic Messages API):**
- POST `https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- Body: `model`, `max_tokens: 8000`, `system`, `messages: [{role:"user", content: call.user}]`, `tools`: the output tool `{name: schemaName, description: "Report your final answer by calling this tool exactly once.", input_schema: schema}` plus, when `webSearch` given, `{type:"web_search_20250305", name:"web_search", max_uses: maxUses ?? 5, ...(allowedDomains?.length ? {allowed_domains: allowedDomains} : {})}`. `tool_choice: {type:"auto"}` — web search is a server tool the API executes inside the request; forcing the output tool would forbid searching first, so the system prompt must demand the final tool call instead.
- If `stop_reason === "pause_turn"`: continue by re-POSTing with `messages` + the assistant turn (`{role:"assistant", content: resp.content}`), up to 3 continuations, then throw `"claude: pause_turn limit"`.
- Extract the last `content` block with `type === "tool_use"` and `name === schemaName`; return its `input`. None found → throw `"claude: no structured output"`. Non-2xx → throw `"claude: <status> <body-snippet>"`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch` capturing requests:

```ts
import { describe, expect, it } from "vitest";
import { makeClaudeClient } from "../src/pipeline/claude";

const toolResp = (input: unknown) => new Response(JSON.stringify({
  stop_reason: "tool_use",
  content: [{ type: "text", text: "thinking" }, { type: "tool_use", name: "report", input }],
}), { status: 200 });

const call = {
  model: "m", system: "sys", user: "usr", schemaName: "report",
  schema: { type: "object" }, webSearch: { allowedDomains: ["example.com"], maxUses: 3 },
};

function capturingFetch(responses: Response[]) {
  const seen: { url: string; init: RequestInit; body: any }[] = [];
  const fn = (async (url: any, init: any) => {
    seen.push({ url: String(url), init, body: JSON.parse(init.body) });
    return responses.shift()!;
  }) as typeof fetch;
  return { fn, seen };
}

describe("makeClaudeClient", () => {
  it("sends model/system/tools and returns the tool input", async () => {
    const { fn, seen } = capturingFetch([toolResp({ answer: 42 })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ answer: 42 });
    const { url, init, body } = seen[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(body.model).toBe("m");
    expect(body.system).toBe("sys");
    const names = body.tools.map((t: any) => t.name ?? t.type);
    expect(names).toContain("report");
    const ws = body.tools.find((t: any) => t.type === "web_search_20250305");
    expect(ws.allowed_domains).toEqual(["example.com"]);
    expect(ws.max_uses).toBe(3);
  });

  it("omits the web search tool when webSearch is absent", async () => {
    const { fn, seen } = capturingFetch([toolResp({})]);
    await makeClaudeClient("key", fn).structured({ ...call, webSearch: undefined });
    expect(seen[0]!.body.tools.length).toBe(1);
  });

  it("continues on pause_turn then extracts", async () => {
    const paused = new Response(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "searching…" }] }), { status: 200 });
    const { fn, seen } = capturingFetch([paused, toolResp({ ok: true })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ ok: true });
    expect(seen.length).toBe(2);
    expect(seen[1]!.body.messages.length).toBe(2); // user + assistant continuation
    expect(seen[1]!.body.messages[1].role).toBe("assistant");
  });

  it("throws when no structured output block is returned", async () => {
    const { fn } = capturingFetch([new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "sorry" }] }), { status: 200 })]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("no structured output");
  });

  it("throws with status on non-2xx", async () => {
    const { fn } = capturingFetch([new Response("overloaded", { status: 529 })]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("529");
  });
});
```

- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Verify pass + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): fetch-based Claude structured-output client with web search"`

---

### Task 6: Authoring + reroll + draft Telegram message

**Files:**
- Modify: `apps/api/src/pipeline/author.ts` (replace stub)
- Test: `apps/api/test/pipeline-author.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient` (Task 5), `DraftSchema`/`upsertDraft` (Task 4), `PipelineDeps` (Task 3), `addDays`.
- Produces:

```ts
export async function authorRound(deps: PipelineDeps, date: string): Promise<void>;
export async function rerollSlot(deps: PipelineDeps, date: string, slot: number, guidance: string): Promise<void>;
export function draftMessage(
  date: string,
  questions: Array<{ slot: number; category: string; text: string; resolution_criteria: string; is_big_one: boolean; author_probability?: number }>,
): string;
// author_probability appears in the message when present ("(55%)"); it is never stored,
// so reroll's re-sent message (built from DB rows) simply omits the percentages.
```

**Authoring flow:** throw `"pipeline: no claude client"` if `deps.claude` is null (runTick catches → WARN). Query the last 7 days of question texts (dedup context). One `structured` call: model `deps.models.author`, `webSearch: { maxUses: 8 }` (unrestricted — authoring reads the day's news), `schemaName: "draft_round"`, `schema` = JSON Schema mirroring `DraftQuestionSchema` (array of 5 objects, enums inline). Validate with `DraftSchema.safeParse`; on failure retry ONCE with the zod issues appended to the user prompt (`"Your previous draft failed validation: <issues>. Produce a corrected draft."`); still failing → throw (WARN + next-hour retry, spec §5). On success: `upsertDraft`, then `deps.telegram.send(draftMessage(...))`.

**System prompt (verbatim editorial contract — spec §5):**

```
You author the daily round for ORACLE, a prediction game. Produce exactly 5 yes/no questions for the round dated {date} (ET). Rules:
- Slots 1-4: four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the day's most contested story from any category.
- Each question must be binary YES/NO in plain English, resolvable by 11:00 AM ET on {date+1} from ONE named public source.
- Genuinely contested: your own probability for YES must be between 0.30 and 0.70. No gimmes.
- resolution_criteria must name the exact measurement, the exact source page, and the deadline. Zero ambiguity: a stranger must be able to resolve it identically.
- FORBIDDEN: deaths, disasters, or tragedies as betting objects; private individuals; medical outcomes of named people; anything derogatory or that rewards hoping for harm. Public figures' professional outcomes are fine.
- Avoid repeating these recent questions: {recentTexts}
Search the web for today's actual news before writing. When your draft is final, call the draft_round tool exactly once.
```

**Reroll flow:** load the scheduled draft's questions; throw `"no draft for <date>"` if absent. One `structured` call (same model/webSearch) asking for ONE replacement question for `slot`, carrying the other four questions ("do not overlap these") and the operator guidance; schema = single `DraftQuestionSchema` shape (`schemaName: "draft_question"`). Validate with `DraftQuestionSchema` + reject if `is_big_one !== (slot === 5)`. Update that question row (text, criteria, source, category), then re-send `draftMessage`.

**`draftMessage` format:**

```
HERMES · DRAFT 2026-08-28
1 [markets] Will the S&P 500 close green on Friday? (55%)
  ↳ Official close per CNBC markets page
...
5 [news] ★ Will ... ? (40%)
  ↳ ...
publishes at noon · /reroll <slot> [guidance] · /status
```

- [ ] **Step 1: Write the failing tests** — fake `ClaudeClient` returning: (a) a valid draft → scheduled rows exist + telegram message contains all 5 texts and "/reroll"; (b) invalid-then-valid (first call 6 questions, second valid) → asserts exactly 2 claude calls and the second user prompt contains "failed validation"; (c) invalid-twice → throws, no rows inserted; (d) `rerollSlot` replaces only slot 3's text and re-sends the draft; (e) reroll rejecting a response that flips `is_big_one`.
- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Verify pass + full suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): hermes authoring — draft generation, validation retry, reroll, telegram draft"`

---

### Task 7: Resolution — verify-or-void

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts` (replace stub)
- Test: `apps/api/test/pipeline-resolve.test.ts`

**Interfaces:**
- Consumes: `ClaudeClient`, `resolveQuestion`, `PipelineDeps`.
- Produces: `export async function resolveWithClaude(deps: PipelineDeps, questionId: string): Promise<boolean>` — true if resolved, false if left for retry (runTick already loops per-id with per-id catch from Task 3).

**Flow:** load the question (throw if missing). `allowedDomains`: hostname of `source_url` when it parses (strip `www.`), else no restriction — but the system prompt always names `source_name` as the only acceptable source (spec §6: resolution happens against the promised source). One `structured` call: model `deps.models.resolve`, `webSearch: { allowedDomains, maxUses: 5 }`, `schemaName: "resolution"`, schema `{ outcome: enum["yes","no","unverifiable"], quotes: [{url, quote}], reasoning }`. System prompt:

```
You resolve a prediction question for ORACLE. Question: "{text}". Resolution criteria: "{resolution_criteria}". Source: {source_name}.
Determine the outcome STRICTLY per the criteria, using only {source_name}. Quote the exact evidence.
If the source does not yet show a definitive outcome, answer "unverifiable" — never guess. Call the resolution tool exactly once.
```

- `yes`/`no` **with ≥1 quote** → `resolveQuestion(db, id, outcome, { outcome, quotes, reasoning, checked_at: deps.now().toISOString(), model: deps.models.resolve })`, return true.
- `yes`/`no` with zero quotes → treat as unverifiable (no receipts, no resolution).
- `unverifiable` → return false.

- [ ] **Step 1: Write the failing tests** — fake claude: (a) yes+quote → question `resolved`, outcome yes, `resolution_evidence.quotes` present, prediction points computed (seed one prediction first, existing `seedRound` + predictions insert style from `settlement.test.ts`); (b) unverifiable → still `locked`, returns false; (c) yes with no quotes → still `locked`; (d) allowed_domains passed to the claude call equals `["example.com"]` for source_url `https://www.example.com/page` (capture the `StructuredCall`); (e) end-to-end tick test: locked round + fake claude resolving all → next tick settles (extends `pipeline-tick.test.ts` pattern inline here).
- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Verify pass + full suite.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): verify-or-void resolution with source-restricted web search"`

---

### Task 8: Telegram webhook route

**Files:**
- Create: `apps/api/src/routes/telegram.ts`
- Modify: `apps/api/src/app.ts` (route + `AppEnv` gains `TELEGRAM_WEBHOOK_SECRET?: string; TELEGRAM_CHAT_ID?: string`)
- Test: `apps/api/test/telegram-webhook.test.ts`

**Interfaces:**
- Consumes: `rerollSlot`, `draftMessage` context via `deps.pipeline`; `loadPipelineState`; `addDays`, `etNow`.
- Produces: `POST /v1/telegram/:secret` route; pure `parseCommand(text: string): { cmd: "reroll"; slot: number; guidance: string } | { cmd: "status" } | { cmd: "help" }` exported for tests.

**Behavior:** 404 when `deps.env.TELEGRAM_WEBHOOK_SECRET` is unset or `:secret` mismatches (don't reveal the route exists). Parse the Telegram update body (`{ message?: { chat?: { id?: number }, text?: string } }` — anything else → 200 `{ok:true}` and ignore). Wrong chat id (`String(chat.id) !== deps.env.TELEGRAM_CHAT_ID`) → 200, ignore silently (spec §7 hardening). Commands:
- `/reroll <slot> [guidance]` → `rerollSlot(deps.pipeline, tomorrowsDraftDate, slot, guidance)` where the target date = the single `scheduled` round's date (reply "no draft standing" if none, or if slot ∉ 1–5); reply "rerolling slot N…" then the reroll itself re-sends the draft.
- `/status` → reply with pipeline state summary: open round date + lock time, locked-unsettled round if any, tomorrow draft y/n.
- anything else → reply the command list.
Replies go through `deps.pipeline.telegram.send`. All handlers return 200 to Telegram even on internal errors (send the error text to the operator chat instead) — Telegram retries non-2xx forever.

- [ ] **Step 1: Write the failing tests** — `parseCommand` units (reroll with/without guidance, junk text → help); route tests via `createApp` with a fake pipeline deps: secret mismatch → 404, wrong chat → 200 + no sends, `/status` → send contains draft state, `/reroll 3 more sports` → rerollSlot called with (date, 3, "more sports"), internal reroll throw → 200 + error text sent.
- [ ] **Step 2: Run to verify failure.** **Step 3: Implement.** **Step 4: Verify pass + full suite + typecheck.**
- [ ] **Step 5: Commit** — `git commit -m "feat(api): telegram webhook — /reroll and /status with chat allowlist"`

---

### Task 9: Worker wiring — cron, env, enablement

**Files:**
- Modify: `apps/api/src/worker.ts`, `apps/api/wrangler.jsonc`, `apps/api/.dev.vars` (add keys, values may be empty), `apps/api/src/app.ts` if any env plumbing remains
- Test: extend `apps/api/test/pipeline-tick.test.ts` with a `buildPipelineDeps` unit; manual dev smoke

**Interfaces:**
- Consumes: everything prior.
- Produces: `buildPipelineDeps(env: WorkerEnv): PipelineDeps | undefined` exported from `worker.ts` — undefined unless `env.PIPELINE_ENABLED === "true"`; claude null without `ANTHROPIC_API_KEY`; telegram no-op without token/chat.

- [ ] **Step 1: wrangler.jsonc** — add:

```jsonc
"triggers": { "crons": ["*/10 * * * *"] },
"vars": { "PIPELINE_AUTHOR_MODEL": "claude-opus-5", "PIPELINE_RESOLVE_MODEL": "claude-sonnet-5" }
// new secrets (wrangler secret put): ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET, PIPELINE_ENABLED ("true" to arm)
```

- [ ] **Step 2: worker.ts** — `WorkerEnv` gains the new optional fields; `buildPipelineDeps(env)`; `fetch` passes `pipeline: buildPipelineDeps(env)` into `createApp` deps; add:

```ts
async scheduled(_controller: ScheduledController, env: WorkerEnv, ctx: ExecutionContext) {
  const deps = buildPipelineDeps(env);
  if (!deps) return;
  ctx.waitUntil(runTick(deps).catch((e) => console.error("pipeline tick failed:", e)));
},
```

- [ ] **Step 3: Unit test `buildPipelineDeps`** — undefined when PIPELINE_ENABLED unset; defined with null claude when only PIPELINE_ENABLED=true; models default to the two constants and honor env overrides.
- [ ] **Step 4: Full verification** — `npx vitest run` (all suites), `npx tsc --noEmit`, and `npx wrangler deploy --dry-run` (config validity).
- [ ] **Step 5: Dev smoke (manual, real dev stack)** — with `.dev.vars` having `PIPELINE_ENABLED="true"` (Telegram/Anthropic keys optional): start wrangler dev, `curl -X POST -H "x-admin-secret: $ADMIN_SECRET" localhost:8787/admin/rounds/<tomorrow>` with the `validDraft` JSON, then `POST /admin/pipeline/tick` and confirm executed actions + `GET /admin/rounds/<date>` transitions against the dev DB. Record output in the ledger.
- [ ] **Step 6: Commit** — `git commit -m "feat(api): pipeline cron wiring + enablement gate"`

**Erik's go-live checklist (report in completion summary, do not attempt):** create the bot via @BotFather → `TELEGRAM_BOT_TOKEN`; DM the bot, get chat id (`getUpdates`) → `TELEGRAM_CHAT_ID`; `curl https://api.telegram.org/bot<t>/setWebhook?url=https://<worker>/v1/telegram/<TELEGRAM_WEBHOOK_SECRET>`; `wrangler secret put` all five; deploy.
