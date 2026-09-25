# The Night Shift, Plan 1 of 3: The Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the API side of the night shift: takes as sourced statements, the three members as named personas, reactions at resolution, the channel served after the seal and on the reveal, and the read rate on the standings. Deploys against build 12 without breaking it.

**Architecture:** The pipeline is a Hono Worker over Drizzle and Neon (`apps/api`), with pure game logic in `@oracle/core` (`packages/core`). Authoring, the Council and resolution each run as a Cloudflare Workflow with an identical inline path for tests and `wrangler dev`. This plan changes the opinion prompt, the crowd Council prompt, adds a reactions step to resolution, adds migration 0017, and serves the channel from three routes. Everything the app will render in build 13 is built here as data first, so the first night's log exists before anything can show it.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, PGlite (tests), Zod 4, Vitest, drizzle-kit, Cloudflare Workers and Workflows, Anthropic Messages API with `web_search_20260209`.

**Spec:** `docs/superpowers/specs/2026-09-25-nightshift-design.md`. Read it first; §4, §5, §6.1, §6.2, §8.1, §8.3, §9, §10, §11 are this plan. Read `docs/superpowers/specs/2026-09-22-hot-takes-design.md` for what the pipeline does today.

## Global Constraints

- Rules stay at version 3. No migration to the rules; `market_source = 'crowd'` still marks a crowd question.
- Storage words are `yes` and `no` (`predictions.answer` true is agree). Nothing in the API renames them.
- Every model call goes through `deps.claude.structured`; tests inject a fake client and never touch the network.
- `BudgetExhausted` always propagates; every other failure inside a pipeline unit becomes a value.
- The taste gate is fail-closed. A gate failure drops the batch, never lets it through.
- Machine-voice strings in `packages/core/src/copy.ts` are linted by `copy-lint.test.ts`: tracked caps, no exclamation marks, no CTA verbs. Add lines there, never as literals in a route.
- Reactions never target a player, a group of people, or the take's subject. The prompt says so and the taste gate enforces it.
- The API suite takes about 6.5 minutes and runs on one worker. Run single files while iterating (`pnpm vitest run test/<file>.test.ts` from `apps/api`); run the whole suite once per task before committing.
- Migrations: `cd apps/api && pnpm db:generate --name <name>` generates the SQL from `src/db/schema.ts`. `makeTestDb()` applies every SQL file in `apps/api/drizzle` in order, so a generated migration is exercised by every test.
- Commit after every task with the message shape `feat(api): ...` or `feat(core): ...` and end every commit message with the line `Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske`.
- `/today` is the hottest route. One extra query is acceptable there; a per-question query is not.
- `/today/log` and the reveal serve the channel only after the caller has sealed (log) or after lock (reveal). Nothing about the Council leaves the server before the seal.

---

## File Structure

**Core (`packages/core/src`)**
- `council.ts` — gains `MEMBER_PROFILE`, `readRate`, `READ_RATE_MIN_CALLS` (Task 1).
- `schemas.ts` — gains `LogLineSchema`, `TodayLogSchema`, the reveal's `reactions`/`lessons`/`committed_at`, the round's `crowd`/`seen_on`/`unhinged`/`council_committed_at`, the standings' `read_rate`/`title`/`window` (Tasks 2, 10).
- `channel.ts` — new; `buildLog` (Task 2).
- `exhibition.ts` — `ExhibitionSchema.log` (Task 14).
- `index.ts` — exports `channel` (Task 2).

**API (`apps/api/src`)**
- `db/schema.ts` — `questions.seenOnLabel`, `seenOnUrl`, `unhinged`; `reactions` table (Task 3).
- `drizzle/0017_nightshift.sql` — generated (Task 3).
- `pipeline/draft.ts` — `seen_on`, `unhinged` on the draft (Task 4).
- `pipeline/opinion-round.ts` — prompt v2, search, statements, reroll v2 (Task 5).
- `pipeline/council/member.ts` — crowd prompt v2 with profiles and caps (Task 6).
- `pipeline/council/reactions.ts` — new (Task 7).
- `pipeline/council/lessons.ts` — register in the lesson prompt (Task 7).
- `pipeline/resolve.ts` — reactions in `runResolution`, `CROWD_RESOLVE_MIN` from deps (Tasks 8, 9).
- `pipeline/workflow-entrypoints.ts` — `reactions-<id>` step (Task 8).
- `pipeline/index.ts`, `pipeline/round-kind.ts`, `worker.ts`, `wrangler.jsonc` — `crowdResolveMin` (Task 9).
- `routes/round.ts` — `/today` fields and sealed-only line, `/today/log`, reveal additions (Tasks 11, 12).
- `standings.ts` — `read_rate`, `title`, `?days` (Task 13).
- `exhibition.ts` — the log on a past hot take (Task 14).

**Docs**
- `docs/launch-playbook.md` — rollout of 0017 and the new var (Task 15).
- `docs/superpowers/specs/2026-09-25-nightshift-design.md` — §17 As built (Task 15).

---

### Task 1: Member profiles and the read rate in core

**Files:**
- Modify: `packages/core/src/council.ts`
- Test: `packages/core/test/council.test.ts`

**Interfaces:**
- Produces: `MEMBER_PROFILE: Record<ModelMemberId, MemberProfile>` where `MemberProfile = { name: string; title: string; register: string }`; `readRate(calls: { p: number; outcome: "yes" | "no" }[]): number | null`; `READ_RATE_MIN_CALLS = 25`. Later tasks import all three from `@oracle/core`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/test/council.test.ts`:

```ts
import { MEMBER_PROFILE, MODEL_MEMBER_IDS, readRate, READ_RATE_MIN_CALLS } from "../src/council";

describe("member profiles (design 2026-09-25 §5.1)", () => {
  it("names every model member with a title and a register", () => {
    for (const id of MODEL_MEMBER_IDS) {
      const p = MEMBER_PROFILE[id];
      expect(p.name).toBe(id.toUpperCase());
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.register.length).toBeGreaterThan(20);
    }
    expect(MEMBER_PROFILE.haiku.title).toBe("night shift");
    expect(MEMBER_PROFILE.sonnet.title).toBe("day shift");
    expect(MEMBER_PROFILE.opus.title).toBe("senior forecaster");
  });
});

describe("the read rate (design 2026-09-25 §8.1)", () => {
  const call = (p: number, outcome: "yes" | "no") => ({ p, outcome });
  it("is null under the minimum", () => {
    expect(READ_RATE_MIN_CALLS).toBe(25);
    expect(readRate(Array.from({ length: 24 }, () => call(0.9, "yes")))).toBeNull();
  });
  it("is the share of calls on the right side, with exactly 0.5 counted as a call on neither side", () => {
    const calls = [
      ...Array.from({ length: 20 }, () => call(0.9, "yes")),
      ...Array.from({ length: 4 }, () => call(0.9, "no")),
      call(0.5, "yes"),
    ];
    expect(readRate(calls)).toBeCloseTo(20 / 25, 6);
  });
  it("maps a player's side to 1 and 0", () => {
    const calls = [...Array.from({ length: 25 }, (_, i) => call(i % 5 === 0 ? 0 : 1, "yes"))];
    expect(readRate(calls)).toBeCloseTo(20 / 25, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && pnpm vitest run test/council.test.ts`
Expected: FAIL, `MEMBER_PROFILE` is not exported.

- [ ] **Step 3: Implement**

Append to `packages/core/src/council.ts`:

```ts
// The night shift (design 2026-09-25 §5.1): real names, job titles, and the
// disposition each member's prompt carries. A persona the standings can prove:
// nothing here claims what the record cannot back.
export interface MemberProfile { name: string; title: string; register: string }

export const MEMBER_PROFILE: Record<ModelMemberId, MemberProfile> = Object.freeze({
  haiku: {
    name: "HAIKU",
    title: "night shift",
    register: "You post first and fast. Lowercase, no punctuation beyond a full stop, no hedging, certain. You are wrong first, often, and you never apologise for it. Fastest read on the floor.",
  },
  sonnet: {
    name: "SONNET",
    title: "day shift",
    register: "You keep the channel on task. Plain sentences, no jargon, no theatrics. You are usually closest to the room and you do not make a thing of it.",
  },
  opus: {
    name: "OPUS",
    title: "senior forecaster",
    register: "You overthink everything. You write in paragraphs, you cite your own earlier calls by name, and you correct yourself mid-post. You lose the easy ones to the night shift and it eats at you.",
  },
});

// The read rate (design 2026-09-25 §8.1): the share of settled calls on the
// right side of the room. A player's side maps to 1 or 0; a member's line is
// its probability. Exactly 0.5 is a call on neither side and counts against.
export const READ_RATE_MIN_CALLS = 25;

export function readRate(calls: ReadonlyArray<{ p: number; outcome: "yes" | "no" }>): number | null {
  if (calls.length < READ_RATE_MIN_CALLS) return null;
  const right = calls.filter((c) => onRightSide(c.p, c.outcome) === true).length;
  return right / calls.length;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/core && pnpm vitest run test/council.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/council.ts packages/core/test/council.test.ts
git commit -m "feat(core): member profiles and the read rate

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 2: The log line and `buildLog`

**Files:**
- Modify: `packages/core/src/schemas.ts`
- Create: `packages/core/src/channel.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/channel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const LogLineSchema = z.object({
    at: z.string(), kind: z.enum(["system", "say", "note"]),
    member: z.enum(["sonnet", "opus", "haiku"]).nullable(),
    text: z.string(), p_yes: z.number().nullable(), tone: z.enum(["win", "loss", "mute"]),
  });
  export type LogLine = z.infer<typeof LogLineSchema>;

  export interface LogInput {
    lines: { member: ModelMemberId; pYes: number; reasoning: string | null; committedAt: string }[];
    outcome: "yes" | "no" | "void" | null;
    crowd: { yesPct: number | null; count: number | null; resolvedAt: string | null; voidReason: string | null };
    reactions: { member: ModelMemberId; text: string; createdAt: string }[];
    lessons: { member: ModelMemberId; text: string; createdAt: string }[];
  }
  export function buildLog(input: LogInput): LogLine[];
  ```
  The system line text for a decided outcome: `THE ROOM AGREED · 62% · 41 PLAYERS` or `THE ROOM DISAGREED · 38% AGREED · 41 PLAYERS`. A void uses `crowd.voidReason` verbatim.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/channel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLog, LogLineSchema } from "../src";

const say = (member: "sonnet" | "opus" | "haiku", pYes: number, reasoning: string | null = "why") => ({ member, pYes, reasoning, committedAt: "2026-09-25T13:00:00.000Z" });
const undecided = { yesPct: null, count: null, resolvedAt: null, voidReason: null };

describe("buildLog (design 2026-09-25 §6.1)", () => {
  it("orders member lines by commit time, mute before the outcome, with no system line", () => {
    const log = buildLog({ lines: [say("opus", 0.4), { ...say("haiku", 0.31), committedAt: "2026-09-25T12:59:00.000Z" }], outcome: null, crowd: undecided, reactions: [], lessons: [] });
    expect(log.map((l) => l.member)).toEqual(["haiku", "opus"]);
    expect(log.every((l) => l.kind === "say" && l.tone === "mute")).toBe(true);
    expect(log[0]).toMatchObject({ p_yes: 0.31, text: "why" });
    for (const l of log) LogLineSchema.parse(l);
  });
  it("adds the room's system line at resolution, tones each member by side, and appends reactions and notes", () => {
    const log = buildLog({
      lines: [say("haiku", 0.31), say("sonnet", 0.44), say("opus", 0.70)],
      outcome: "yes",
      crowd: { yesPct: 62, count: 41, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null },
      reactions: [{ member: "haiku", text: "ok the room is wrong", createdAt: "2026-09-26T16:02:00.000Z" }],
      lessons: [{ member: "opus", text: "The room is warmer on food than I model.", createdAt: "2026-09-26T16:03:00.000Z" }],
    });
    expect(log.map((l) => l.kind)).toEqual(["say", "say", "say", "system", "say", "note"]);
    expect(log.map((l) => l.tone)).toEqual(["loss", "loss", "win", "mute", "loss", "mute"]);
    expect(log[3]).toMatchObject({ member: null, text: "THE ROOM AGREED · 62% · 41 PLAYERS", p_yes: null });
    expect(log[4]).toMatchObject({ member: "haiku", text: "ok the room is wrong" });
    expect(log[5]).toMatchObject({ member: "opus", kind: "note" });
  });
  it("phrases a NO majority as the room disagreeing", () => {
    const log = buildLog({ lines: [say("haiku", 0.6)], outcome: "no", crowd: { yesPct: 38, count: 41, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] });
    expect(log[1]!.text).toBe("THE ROOM DISAGREED · 38% AGREED · 41 PLAYERS");
    expect(log[0]!.tone).toBe("loss");
  });
  it("prints the void reason as the system line and leaves every member mute", () => {
    const log = buildLog({ lines: [say("haiku", 0.6)], outcome: "void", crowd: { yesPct: 50, count: 2, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: "THE ROOM SPLIT EXACTLY IN HALF" }, reactions: [], lessons: [] });
    expect(log[1]).toMatchObject({ kind: "system", text: "THE ROOM SPLIT EXACTLY IN HALF" });
    expect(log[0]!.tone).toBe("mute");
  });
  it("a 0.5 line is mute even after the outcome, and a member with no reasoning still says its number", () => {
    const log = buildLog({ lines: [say("sonnet", 0.5, null)], outcome: "yes", crowd: { yesPct: 60, count: 30, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] });
    expect(log[0]).toMatchObject({ tone: "mute", text: "" });
  });
  it("is empty with no lines", () => {
    expect(buildLog({ lines: [], outcome: "yes", crowd: { yesPct: 60, count: 30, resolvedAt: "2026-09-26T16:01:00.000Z", voidReason: null }, reactions: [], lessons: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && pnpm vitest run test/channel.test.ts`
Expected: FAIL, `buildLog` is not exported.

- [ ] **Step 3: Add the schema and the builder**

In `packages/core/src/schemas.ts`, directly after `EvidenceItemSchema`:

```ts
// One line of #nightshift (design 2026-09-25 §6.1). Built by the API from
// lines, reactions and lessons; rendered by the app in order.
export const LogLineSchema = z.object({
  at: z.string(),
  kind: z.enum(["system", "say", "note"]),
  member: z.enum(["sonnet", "opus", "haiku"]).nullable(),
  text: z.string(),
  p_yes: z.number().nullable(),
  tone: z.enum(["win", "loss", "mute"]),
});
export type LogLine = z.infer<typeof LogLineSchema>;
```

Create `packages/core/src/channel.ts`:

```ts
// #nightshift as data (design 2026-09-25 §6.1). Pure: the API hands in rows,
// this orders and tones them, the app prints what comes back.
import { onRightSide, type ModelMemberId } from "./council";
import type { LogLine } from "./schemas";

export interface LogInput {
  lines: { member: ModelMemberId; pYes: number; reasoning: string | null; committedAt: string }[];
  outcome: "yes" | "no" | "void" | null;
  crowd: { yesPct: number | null; count: number | null; resolvedAt: string | null; voidReason: string | null };
  reactions: { member: ModelMemberId; text: string; createdAt: string }[];
  lessons: { member: ModelMemberId; text: string; createdAt: string }[];
}

function toneOf(pYes: number, outcome: LogInput["outcome"]): LogLine["tone"] {
  if (outcome === null || outcome === "void") return "mute";
  const right = onRightSide(pYes, outcome);
  return right === null ? "mute" : right ? "win" : "loss";
}

export function roomLine(outcome: "yes" | "no", yesPct: number, count: number): string {
  const players = `${count} PLAYER${count === 1 ? "" : "S"}`;
  return outcome === "yes" ? `THE ROOM AGREED · ${yesPct}% · ${players}` : `THE ROOM DISAGREED · ${yesPct}% AGREED · ${players}`;
}

export function buildLog(input: LogInput): LogLine[] {
  if (input.lines.length === 0) return [];
  const out: LogLine[] = input.lines.map((l) => ({
    at: l.committedAt, kind: "say", member: l.member, text: (l.reasoning ?? "").trim(), p_yes: l.pYes, tone: toneOf(l.pYes, input.outcome),
  }));
  const { outcome, crowd } = input;
  if (outcome !== null && crowd.resolvedAt !== null) {
    const text = outcome === "void"
      ? (crowd.voidReason ?? "VOID")
      : roomLine(outcome, crowd.yesPct ?? 0, crowd.count ?? 0);
    out.push({ at: crowd.resolvedAt, kind: "system", member: null, text, p_yes: null, tone: "mute" });
  }
  for (const r of input.reactions) out.push({ at: r.createdAt, kind: "say", member: r.member, text: r.text, p_yes: null, tone: "loss" });
  for (const l of input.lessons) out.push({ at: l.createdAt, kind: "note", member: l.member, text: l.text, p_yes: null, tone: "mute" });
  // Stable by time; ties keep insertion order (member lines, then the room, then reactions, then notes).
  return out
    .map((line, i) => ({ line, i }))
    .sort((a, b) => a.line.at.localeCompare(b.line.at) || a.i - b.i)
    .map((x) => x.line);
}
```

Add to `packages/core/src/index.ts` after `export * from "./council";`:

```ts
export * from "./channel";
```

- [ ] **Step 4: Run to verify pass, then typecheck**

Run: `cd packages/core && pnpm vitest run test/channel.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/channel.ts packages/core/src/index.ts packages/core/test/channel.test.ts
git commit -m "feat(core): the log line and buildLog

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 3: Migration 0017: seen-on, unhinged, reactions

**Files:**
- Modify: `apps/api/src/db/schema.ts`
- Create: `apps/api/drizzle/0017_nightshift.sql` (generated)
- Test: `apps/api/test/schema-nightshift.test.ts`

**Interfaces:**
- Produces: `schema.questions.seenOnLabel: text | null`, `schema.questions.seenOnUrl: text | null`, `schema.questions.unhinged: boolean not null default false`; `schema.reactions` with columns `questionId, member, text, model, promptVersion, createdAt`, primary key `(questionId, member)`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/schema-nightshift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";

describe("migration 0017 (design 2026-09-25 §10)", () => {
  it("stores where a take was seen and whether it is the unhinged one, defaulting both", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedRound(db, { date: "2026-09-25", opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
    const before = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(before!.seenOnLabel).toBeNull();
    expect(before!.seenOnUrl).toBeNull();
    expect(before!.unhinged).toBe(false);
    await db.update(schema.questions).set({ seenOnLabel: "r/AmItheAsshole", seenOnUrl: "https://reddit.com/r/AmItheAsshole/x", unhinged: true }).where(eq(schema.questions.id, q!.id));
    const after = await db.query.questions.findFirst({ where: eq(schema.questions.id, q!.id) });
    expect(after).toMatchObject({ seenOnLabel: "r/AmItheAsshole", unhinged: true });
  });
  it("keeps one reaction per member per question and cascades with the question", async () => {
    const { db } = await makeTestDb();
    const [q] = await seedRound(db, { date: "2026-09-25", opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
    await db.insert(schema.reactions).values({ questionId: q!.id, member: "haiku", text: "ok the room is wrong", model: "m", promptVersion: "reaction-v1" });
    await db.insert(schema.reactions).values({ questionId: q!.id, member: "haiku", text: "again" }).onConflictDoNothing();
    const rows = await db.query.reactions.findMany({ where: eq(schema.reactions.questionId, q!.id) });
    expect(rows.length).toBe(1);
    expect(rows[0]!.text).toBe("ok the room is wrong");
    expect(rows[0]!.createdAt).toBeInstanceOf(Date);
    await db.delete(schema.questions).where(eq(schema.questions.id, q!.id));
    expect((await db.query.reactions.findMany()).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/schema-nightshift.test.ts`
Expected: FAIL, `seenOnLabel` undefined / `reactions` not on schema.

- [ ] **Step 3: Extend the schema**

In `apps/api/src/db/schema.ts`, inside `questions` after `marketSeriesKey`:

```ts
  // Where the argument came from (design 2026-09-25 §4.2): the community as
  // people name it and the thread, when search found one. Null when the take
  // was written from the day's mood. Not the source of the ANSWER, which is
  // still the players.
  seenOnLabel: text("seen_on_label"),
  seenOnUrl: text("seen_on_url"),
  // The one take a night that is absurd on its face (§4.1). Exactly one per
  // opinion round; the card carries a modifier for it.
  unhinged: boolean("unhinged").notNull().default(false),
```

After the `lessons` table:

```ts
// The night shift's reactions (design 2026-09-25 §5.3): one line per model
// member on the wrong side of the room, written once at resolution, through
// the taste gate. Winners write nothing, so a member without a row was
// right, absent, or refused.
export const reactions = pgTable("reactions", {
  questionId: uuid("question_id").notNull().references(() => questions.id, { onDelete: "cascade" }),
  member: text("member").notNull(),
  text: text("text").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.questionId, t.member] })]);
```

Check the file's imports already include `boolean`, `primaryKey`, `timestamp`, `text`, `uuid` from `drizzle-orm/pg-core` (they do; `predictions` and `lines` use them).

- [ ] **Step 4: Generate the migration**

Run: `cd apps/api && pnpm db:generate --name nightshift`
Expected: `drizzle/0017_nightshift.sql` created with three `ALTER TABLE "questions" ADD COLUMN` statements, a `CREATE TABLE "reactions"`, and the FK with `ON DELETE cascade`; `drizzle/meta/_journal.json` gains idx 17. Open the SQL and confirm the FK line ends in `ON DELETE cascade ON UPDATE no action`.

- [ ] **Step 5: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/schema-nightshift.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/drizzle apps/api/test/schema-nightshift.test.ts
git commit -m "feat(api): migration 0017 — seen-on, unhinged, reactions

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 4: `seen_on` and `unhinged` on the draft

**Files:**
- Modify: `apps/api/src/pipeline/draft.ts`
- Test: `apps/api/test/pipeline-draft-crowd.test.ts`

**Interfaces:**
- Produces: `DraftQuestionSchema` accepts `seen_on: { label: string; url: string | null } | null` (optional, no default stamped) and `unhinged: boolean` (optional). `upsertDraft` writes `seenOnLabel`, `seenOnUrl`, `unhinged` (false when absent).

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-draft-crowd.test.ts`:

```ts
describe("seen-on and unhinged (design 2026-09-25 §4.2)", () => {
  it("writes where each take was seen and marks the unhinged one; absent fields default", async () => {
    const { db } = await makeTestDb();
    const draft = crowdDraft();
    draft.questions[0]!.seen_on = { label: "r/AmItheAsshole", url: "https://reddit.com/r/AmItheAsshole/abc" };
    draft.questions[1]!.seen_on = { label: "the replies", url: null };
    draft.questions[2]!.unhinged = true;
    await upsertDraft(db, DATE, draft, 3);
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs[0]).toMatchObject({ seenOnLabel: "r/AmItheAsshole", seenOnUrl: "https://reddit.com/r/AmItheAsshole/abc", unhinged: false });
    expect(qs[1]).toMatchObject({ seenOnLabel: "the replies", seenOnUrl: null });
    expect(qs[2]!.unhinged).toBe(true);
    expect(qs[3]).toMatchObject({ seenOnLabel: null, seenOnUrl: null, unhinged: false });
  });
  it("refuses a seen-on with an empty label or a non-URL", () => {
    const base = crowdDraft().questions[0]!;
    expect(() => DraftSchema.parse({ questions: [{ ...base, seen_on: { label: "", url: null } }, ...crowdDraft().questions.slice(1)] })).toThrow();
    expect(() => DraftSchema.parse({ questions: [{ ...base, seen_on: { label: "x", url: "not a url" } }, ...crowdDraft().questions.slice(1)] })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/pipeline-draft-crowd.test.ts`
Expected: FAIL on the first new test (`seenOnLabel` null).

- [ ] **Step 3: Extend the draft**

In `DraftQuestionSchema`, after `market`:

```ts
    // Where the argument came from (design 2026-09-25 §4.2). Optional and
    // undefaulted for the same reason context is: the bank, /reroll and the
    // admin API post drafts that never carried it.
    seen_on: z.object({ label: z.string().min(1).max(80), url: z.string().url().nullable() }).nullable().optional(),
    unhinged: z.boolean().optional(),
```

In `upsertDraft`'s `rows` map, after `marketClosesAt`:

```ts
      seenOnLabel: q.seen_on?.label ?? null,
      seenOnUrl: q.seen_on?.url ?? null,
      unhinged: q.unhinged ?? false,
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/pipeline-draft-crowd.test.ts test/pipeline-draft-v3.test.ts test/pipeline-draft.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/draft.ts apps/api/test/pipeline-draft-crowd.test.ts
git commit -m "feat(api): seen_on and unhinged on the draft

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 5: The opinion round, version 2

**Files:**
- Modify: `apps/api/src/pipeline/opinion-round.ts`
- Test: `apps/api/test/opinion-round.test.ts`, `apps/api/test/opinion-reroll.test.ts`

**Interfaces:**
- Consumes: `seen_on`, `unhinged` on the draft (Task 4).
- Produces: `OPINION_PROMPT_VERSION = "opinion-v2"`; `OpinionEntry = { slot; category; text; unhinged: boolean; seen_on: { label: string; url: string | null } | null }`; the voice call carries `webSearch: { maxUses: 8 }`; `TextSchema` refuses a trailing `?` and a leading `hot take` / `unpopular opinion`; exactly one entry unhinged; `rerollOpinionSlot` keeps the unhinged count at one.

- [ ] **Step 1: Update the fixtures and write the failing tests**

In `apps/api/test/opinion-round.test.ts`, replace `five` with:

```ts
const TAKES = ["a car payment is a personality trait", "the nfl is better on the radio", "fall is the worst season and everyone is lying", "cereal is a soup", "nobody actually likes going to the airport early"];
function five(texts?: string[], opts: { unhingedSlot?: number | null; seenOn?: boolean } = {}) {
  const unhingedSlot = opts.unhingedSlot === undefined ? 4 : opts.unhingedSlot;
  return {
    questions: CATS.map((category, i) => ({
      slot: i + 1, category, text: texts?.[i] ?? TAKES[i]!,
      unhinged: i + 1 === unhingedSlot,
      seen_on: opts.seenOn === false ? null : { label: i === 1 ? "the replies" : "r/unpopularopinion", url: i === 1 ? null : `https://reddit.com/r/unpopularopinion/t${i}` },
    })),
  };
}
```

In the first test, change the assertions on the voice call:

```ts
    expect(voice.webSearch).toEqual({ maxUses: 8 });
    expect(voice.effort).toBe("low");
    expect(voice.system).toContain(DATE);
    expect(voice.system).toContain("Search first");
    expect(voice.system).toContain("r/AmItheAsshole");
    expect(voice.system).toContain("people who post");
```

and inside the `for (const q of qs)` loop add:

```ts
      expect(q.unhinged).toBe(q.slot === 4);
      expect(q.seenOnLabel).toBe(q.slot === 2 ? "the replies" : "r/unpopularopinion");
      expect(q.seenOnUrl).toBe(q.slot === 2 ? null : `https://reddit.com/r/unpopularopinion/t${q.slot - 1}`);
```

Anywhere else in the file that builds texts ending in `?` (search for `the right one?`), change them to statements (`take ${i + 1} is the right one`).

Append new cases:

```ts
describe("the opinion round at version 2 (design 2026-09-25 §4.1)", () => {
  it("refuses a question mark, then accepts the corrected set", async () => {
    const calls: StructuredCall[] = [];
    const deps = await depsWith(claudeWith({ calls, answer: (_c, n) => n === 1 ? five(["is cereal a soup?", ...TAKES.slice(1)]) : five() }), []);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls.filter((c) => c.schemaName === "opinion_round").length).toBe(2);
    expect(calls[1]!.user).toContain("failed validation");
    expect(calls[1]!.user).toMatch(/question mark|statement/i);
  });
  it("refuses a set with no unhinged take or two of them", async () => {
    for (const unhingedSlot of [null, undefined] as const) {
      const calls: StructuredCall[] = [];
      const deps = await depsWith(claudeWith({ calls, answer: (_c, n) => n === 1 ? (unhingedSlot === null ? five(undefined, { unhingedSlot: null }) : { questions: five().questions.map((q) => ({ ...q, unhinged: true })) }) : five() }), []);
      expect((await runOpinionRound(deps, DATE)).published).toBe(true);
      expect(calls.filter((c) => c.schemaName === "opinion_round").length).toBe(2);
    }
  });
  it("refuses 'hot take:' and 'unpopular opinion:' openers", async () => {
    const calls: StructuredCall[] = [];
    const deps = await depsWith(claudeWith({ calls, answer: (_c, n) => n === 1 ? five(["Hot take: cereal is a soup", ...TAKES.slice(1)]) : five() }), []);
    expect((await runOpinionRound(deps, DATE)).published).toBe(true);
    expect(calls.filter((c) => c.schemaName === "opinion_round").length).toBe(2);
  });
  it("accepts a null seen_on", async () => {
    const deps = await depsWith(claudeWith({ calls: [], answer: () => five(undefined, { seenOn: false }) }), []);
    expect((await runOpinionRound(deps, DATE)).published).toBe(true);
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    expect(qs.every((q) => q.seenOnLabel === null && q.seenOnUrl === null)).toBe(true);
  });
  it("narrates the seen-on label per slot and marks the unhinged one", async () => {
    const sent: string[] = [];
    const deps = await depsWith(claudeWith({ calls: [] }), sent);
    await runOpinionRound(deps, DATE);
    expect(sent[0]).toContain("seen on r/unpopularopinion");
    expect(sent[0]).toContain("[UNHINGED]");
  });
});
```

In `apps/api/test/opinion-reroll.test.ts`, change the `opinion_round` fixture to statements with `unhinged: i + 1 === 4` and `seen_on: null`, and the `opinion_question` fixture shape to `{ category, text, seen_on }`. Append:

```ts
describe("/reroll at version 2 (design 2026-09-25 §4.4)", () => {
  it("searches, writes the replacement's seen-on, and never adds a second unhinged take", async () => {
    const { deps, calls } = await world({ category: "markets", text: "a car payment is a personality trait", seen_on: { label: "r/personalfinance", url: null } });
    await rerollSlot(deps, DATE, 1, "sharper");
    const voice = calls.find((c) => c.schemaName === "opinion_question")!;
    expect(voice.webSearch).toEqual({ maxUses: 4 });
    expect(voice.system).toContain("statement");
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 1)) });
    expect(q).toMatchObject({ text: "a car payment is a personality trait", seenOnLabel: "r/personalfinance", unhinged: false });
    const unhinged = await deps.db.query.questions.findMany({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.unhinged, true)) });
    expect(unhinged.map((u) => u.slot)).toEqual([4]);
  });
});
```

Check how `world` in that file passes the replacement to the fake client and thread `seen_on` through it.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/opinion-round.test.ts test/opinion-reroll.test.ts`
Expected: FAIL (webSearch undefined, `?` accepted, `unhinged` undefined on rows).

- [ ] **Step 3: Rewrite the prompt, schema and reroll**

In `apps/api/src/pipeline/opinion-round.ts`:

```ts
export const OPINION_PROMPT_VERSION = "opinion-v2";
export const RECENT_DAYS = 60;
const MAX_CHARS = 120;
const SEARCH_USES = 8;
const REROLL_SEARCH_USES = 4;
const CATEGORIES = ["markets", "sports", "weather", "culture", "news"] as const;
type Category = (typeof CATEGORIES)[number];

export interface SeenOn { label: string; url: string | null }
export interface OpinionEntry { slot: number; category: Category; text: string; unhinged: boolean; seen_on: SeenOn | null }
export interface OpinionRoundResult { published: boolean; categories: string[]; texts: string[]; reason: string | null }

// A take is a statement (design 2026-09-25 N1): never a question, never
// prefaced with the label the card already carries.
const TextSchema = z.string().min(10).max(MAX_CHARS)
  .refine((t) => !/\?\s*$/.test(t), "a take is a statement, not a question: no question mark")
  .refine((t) => !t.includes("!"), "no exclamation marks")
  .refine((t) => !/^\s*(hot take|unpopular opinion)\b/i.test(t), "never open with 'hot take' or 'unpopular opinion'");

const SeenOnSchema = z.object({ label: z.string().min(1).max(80), url: z.string().url().nullable() }).nullable();
const EntrySchema = z.object({ slot: z.number().int().min(1).max(5), category: z.enum(CATEGORIES), text: TextSchema, unhinged: z.boolean(), seen_on: SeenOnSchema });

const OpinionSchema = z.object({ questions: z.array(EntrySchema).length(5) })
  .refine((v) => new Set(v.questions.map((q) => q.slot)).size === 5, "slots must be exactly 1..5")
  .refine((v) => new Set(v.questions.filter((q) => q.slot <= 4).map((q) => q.category)).size === 4, "slots 1 to 4 take four distinct categories")
  .refine((v) => v.questions.filter((q) => q.unhinged).length === 1, "exactly one take is unhinged");

const SingleSchema = z.object({ category: z.enum(CATEGORIES), text: TextSchema, seen_on: SeenOnSchema });

const seenOnJson = {
  type: ["object", "null"],
  properties: {
    label: { type: "string", description: "The community as people name it: r/AmItheAsshole, the replies, a group chat." },
    url: { type: ["string", "null"], description: "The thread, when search found one." },
  },
  required: ["label", "url"], additionalProperties: false,
};
const entryJson = {
  type: "object",
  properties: {
    slot: { type: "integer", minimum: 1, maximum: 5 },
    category: { type: "string", enum: [...CATEGORIES] },
    text: { type: "string", description: `The take: a statement a person would post, one sentence, at most ${MAX_CHARS} characters, no question mark.` },
    unhinged: { type: "boolean", description: "True on exactly one take: the absurd one people will still argue about." },
    seen_on: seenOnJson,
  },
  required: ["slot", "category", "text", "unhinged", "seen_on"], additionalProperties: false,
};
const opinionJsonSchema = {
  type: "object",
  properties: { questions: { type: "array", minItems: 5, maxItems: 5, items: entryJson } },
  required: ["questions"], additionalProperties: false,
};
const singleJsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    text: { type: "string", description: `The take: a statement a person would post, one sentence, at most ${MAX_CHARS} characters, no question mark.` },
    seen_on: seenOnJson,
  },
  required: ["category", "text", "seen_on"], additionalProperties: false,
};

const RULES = `- Write like a person posting, not like a survey. A take is a statement, at most ${MAX_CHARS} characters, ending in a full stop or nothing, never a question mark. Lowercase is allowed. No hashtags, no emoji, no exclamation marks. Never open with "Hot take:" or "Unpopular opinion:"; the card already says that.
- No take about a death, a tragedy, a private individual, a named person's health, or anything derogatory. No take that asks the player to hope for harm. Politics is allowed as a subject, never as a side.
- Categories, read loosely: markets is money and work; sports is sports and games; weather is the outdoors and the seasons; culture is food, film, music and manners; news is society and public life.`;

const SEARCH = `Search first. Look at what is being argued on Reddit (r/unpopularopinion, r/AmItheAsshole, r/AskReddit, r/CasualConversation and the subreddit of whatever is in the news), on the day's trending topics, and in the comments under the day's viral posts. Prefer arguments from the last 48 hours. A take may be evergreen if the argument is live today. For each take, report where you saw it argued as seen_on; null when it came from the day's mood rather than one thread.`;

function systemPrompt(date: string, recent: string[]): string {
  const asked = recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n");
  return `You write the daily round for OUTSEE, a game where three AIs try to predict what the players think. The players are people who post. Find five things people are actually arguing about today, and write each as a hot take: a statement a person would post, that half the room will agree with and half will not, for the round dated ${date}.
${SEARCH}
- Slots 1 to 4 take one each of four different categories from markets, sports, weather, culture, news. Slot 5 is THE BIG ONE: the take everyone will have a view on, in any category.
- Exactly one of the five is unhinged: absurd on its face, and people will still argue about it ("cereal is a soup", "the airport is the best part of the trip"). Mark it with unhinged: true and no other.
${RULES}
- Do not post anything already posted in the last ${RECENT_DAYS} days:
${asked}
Call the opinion_round tool exactly once with one entry per slot 1 through 5.`;
}
```

In `askFive`, change the call to:

```ts
  const response = await deps.claude.structured({
    model: deps.models.voice,
    system: systemPrompt(date, recent),
    user,
    schemaName: "opinion_round",
    schema: opinionJsonSchema,
    effort: "low",
    webSearch: { maxUses: SEARCH_USES },
  });
```

In `toOpinionDraft`, add to each question:

```ts
      seen_on: e.seen_on,
      unhinged: e.unhinged,
```

In `opinionResult`, the texts become:

```ts
  texts: qs.map((q) => `${q.slot}. [${q.category}]${q.unhinged ? " [UNHINGED]" : ""} ${q.text}${q.seen_on ? ` · seen on ${q.seen_on.label}` : ""}`),
```

Rewrite `rerollOpinionSlot`'s prompt and write:

```ts
  const system = `You write one replacement hot take for OUTSEE's round dated ${date}, slot ${slot}${isBigOne ? " (THE BIG ONE: the take everyone will have a view on, in any category)" : ` (category: ${target.category})`}. The players are people who post. A hot take is a statement a person would post, that half the room will agree with and half will not.
${SEARCH}
${RULES}
${isBigOne ? "" : `- Keep the category ${target.category}.\n`}- Do not overlap these takes already in the round:\n${others.map((q) => `- [${q.category}] ${q.text}`).join("\n")}
- Do not post anything already posted in the last ${RECENT_DAYS} days:\n${recent.length === 0 ? "None yet." : recent.map((t) => `- ${t}`).join("\n")}
Operator guidance: ${guidance || "none"}
Call the opinion_question tool exactly once.`;
  const response = await deps.claude.structured({
    model: deps.models.voice, system, user: `Write the replacement for slot ${slot} now.`,
    schemaName: "opinion_question", schema: singleJsonSchema, effort: "low", webSearch: { maxUses: REROLL_SEARCH_USES },
  });
```

and the update:

```ts
  // The slot's own unhinged flag is kept (a reroll of the unhinged take stays
  // the unhinged take); no reroll can create a second one (§4.4).
  await deps.db.update(schema.questions)
    .set({ text: parsed.data.text, category, context: null, seenOnLabel: parsed.data.seen_on?.label ?? null, seenOnUrl: parsed.data.seen_on?.url ?? null })
    .where(and(eq(schema.questions.roundDate, date), eq(schema.questions.slot, slot), eq(schema.questions.status, "scheduled")));
```

- [ ] **Step 4: Run to verify pass, then the full suite**

Run: `cd apps/api && pnpm vitest run test/opinion-round.test.ts test/opinion-reroll.test.ts test/council-crowd.test.ts test/admin-rounds.test.ts`
Expected: PASS. If `council-crowd.test.ts` fails because its `opinion_round` fixture still returns questions with `?` and no `unhinged`, update that fixture to `TAKES`-style statements with `unhinged: i + 1 === 4, seen_on: null` (Task 6 rewrites its assertions anyway).

Run: `cd apps/api && pnpm vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/opinion-round.ts apps/api/test/opinion-round.test.ts apps/api/test/opinion-reroll.test.ts apps/api/test/council-crowd.test.ts
git commit -m "feat(api): opinion round v2 — sourced statements, one unhinged take

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 6: The Council's crowd prompt with personas

**Files:**
- Modify: `apps/api/src/pipeline/council/member.ts`, `apps/api/src/pipeline/council/members.ts`
- Test: `apps/api/test/council-crowd.test.ts`

**Interfaces:**
- Consumes: `MEMBER_PROFILE` from `@oracle/core` (Task 1).
- Produces: `COUNCIL_PROMPT_VERSION = "council-v2"`; `crowdSystemPrompt(date, now, member)`; `REASONING_CAP: Record<ModelMemberId, number> = { haiku: 200, sonnet: 500, opus: 800 }` exported from `member.ts`; a crowd line whose reasoning exceeds the cap abstains that slot.

- [ ] **Step 1: Write the failing tests**

In `apps/api/test/council-crowd.test.ts`, replace the audience and register assertions in "asks each member for the share…" with:

```ts
    expect(c.system).toContain("share of players who will answer YES");
    expect(c.system).toContain("people who post");
    expect(c.system).not.toContain("lunchtime");
    expect(c.system).toContain("You are SONNET, day shift");
    expect(c.system).toContain("#nightshift");
    expect(c.system).toContain("two to four plain sentences");
```

Append:

```ts
describe("personas on a crowd round (design 2026-09-25 §5.2)", () => {
  it("gives each member its own register and names the other two", async () => {
    const { deps, calls } = await world();
    await commitMember(deps, DATE, "haiku");
    await commitMember(deps, DATE, "opus");
    const haiku = calls[0]!.system;
    const opus = calls[1]!.system;
    expect(haiku).toContain("You are HAIKU, night shift");
    expect(haiku).toContain("lowercase");
    expect(haiku).toContain("SONNET (day shift)");
    expect(haiku).toContain("OPUS (senior forecaster)");
    expect(opus).toContain("You are OPUS, senior forecaster");
    expect(opus).toContain("three to six sentences");
    expect(opus).toContain("HAIKU (night shift)");
  });
  it("caps reasoning per member in the schema and abstains a slot over the cap", async () => {
    const long = "x".repeat(201);
    const { deps, calls } = await world();
    deps.claude = {
      async structured(call) {
        calls.push(call);
        return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: 0.4, reasoning: slot === 2 ? long : "short", cited: [] })) };
      },
    };
    const r = await commitMember(deps, DATE, "haiku");
    const cap = (calls[0]!.schema as { properties: { lines: { items: { properties: { reasoning: { maxLength: number } } } } } }).properties.lines.items.properties.reasoning.maxLength;
    expect(cap).toBe(200);
    expect(r.abstained).toEqual([2]);
    expect(r.lines.length).toBe(4);
  });
  it("stamps council-v2 on the committed lines", async () => {
    const { deps } = await world();
    await runCouncil(deps, DATE);
    const rows = await deps.db.query.lines.findMany();
    expect(rows.filter((l) => l.member !== "market").every((l) => l.promptVersion === "council-v2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/council-crowd.test.ts`
Expected: FAIL on the persona assertions.

- [ ] **Step 3: Implement**

In `members.ts`: `export const COUNCIL_PROMPT_VERSION = "council-v2";`

In `member.ts`, import `MEMBER_PROFILE, MODEL_MEMBER_IDS` from `@oracle/core` and add:

```ts
// Reasoning caps per member (design 2026-09-25 §5.2): the register is a
// length as much as a voice. Over the cap the slot abstains, as a bad p_yes does.
export const REASONING_CAP: Record<ModelMemberId, number> = { haiku: 200, sonnet: 500, opus: 800 };

const REASONING_ASK: Record<ModelMemberId, string> = {
  haiku: "one or two lines, lowercase, no punctuation beyond a full stop, no hedging",
  sonnet: "two to four plain sentences",
  opus: "three to six sentences, and you may refer to your own earlier calls by name",
};

export function crowdCouncilJsonSchemaFor(member: ModelMemberId) {
  const base = crowdCouncilJsonSchema as { properties: { lines: { items: { properties: { reasoning: Record<string, unknown> } } } } };
  return {
    ...crowdCouncilJsonSchema,
    properties: {
      lines: {
        ...base.properties.lines,
        items: {
          ...base.properties.lines.items,
          properties: {
            ...base.properties.lines.items.properties,
            reasoning: { ...base.properties.lines.items.properties.reasoning, maxLength: REASONING_CAP[member], description: `Why the room will lean the way you say: ${REASONING_ASK[member]}. Shown to players as written, in #nightshift.` },
          },
        },
      },
    },
  };
}

function crowdSystemPrompt(date: string, now: Date, member: ModelMemberId): string {
  const me = MEMBER_PROFILE[member];
  const others = MODEL_MEMBER_IDS.filter((m) => m !== member).map((m) => `${MEMBER_PROFILE[m].name} (${MEMBER_PROFILE[m].title})`).join(" and ");
  return `You are ${me.name}, ${me.title} on THE ORACLE's Council. ${me.register} You post in #nightshift, the Council's channel, which players read after they seal. Your co-workers are ${others}.

The round dated ${date} opens at noon ET and locks at noon ET the following day. It is now ${now.toISOString()}.

- Each take is a statement. Players answer YES (agree) or NO (disagree) from their own view. Estimate the share of players who will answer YES, between ${P_MIN} and ${P_MAX}. Exactly 0.5 is valid when you expect an even room.
- The players are people who post. They are online more than is good for them, they have opinions about everything, and they answer from the gut. Weigh what people say when asked, not what they believe privately.
- Your reasoning is ${REASONING_ASK[member]}. It will be shown to players as written.
- Where lessons from your own earlier calls are given, weigh them; they are yours.
- Leave cited empty; there is nothing to cite.

Call the council_lines tool exactly once with exactly one entry for each slot 1 through 5.`;
}
```

In `commitMember`, pass the member to the prompt and schema:

```ts
      system: crowd ? crowdSystemPrompt(date, now, member) : systemPrompt(date, now),
      user,
      schemaName: "council_lines",
      schema: crowd ? crowdCouncilJsonSchemaFor(member) : councilJsonSchema,
```

and in the line loop, after the `p_yes` range check:

```ts
    if (crowd && e.data.reasoning.length > REASONING_CAP[member]) continue;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/council-crowd.test.ts test/council-member.test.ts test/council-commit.test.ts test/reveal-council.test.ts`
Expected: PASS. If `council-member.test.ts` or `reveal-council.test.ts` assert `council-v1` on committed rows, update to `council-v2` (fixtures that insert `promptVersion: "council-v1"` by hand need no change).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/council apps/api/test/council-crowd.test.ts apps/api/test/council-member.test.ts
git commit -m "feat(api): the Council's crowd prompt with personas and caps

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 7: Reactions, and the lesson's register

**Files:**
- Create: `apps/api/src/pipeline/council/reactions.ts`
- Modify: `apps/api/src/pipeline/council/lessons.ts`, `apps/api/src/pipeline/council/members.ts`
- Test: `apps/api/test/council-reactions.test.ts`, `apps/api/test/council-lessons.test.ts`

**Interfaces:**
- Consumes: `schema.reactions` (Task 3), `MEMBER_PROFILE` (Task 1), `tasteTexts(deps, texts)`.
- Produces: `REACTION_PROMPT_VERSION = "reaction-v1"` in `members.ts`; `reactionModel(deps)` (uses `councilModels.lesson` then the Haiku default); `writeReactions(deps, questionId): Promise<ReactionsOutcome>` with `ReactionsOutcome = { questionId; written: number; dropped: number; error?: string }`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/council-reactions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { writeReactions } from "../src/pipeline/council/reactions";

const DATE = "2026-09-25";
const NOW = new Date("2026-09-26T16:02:00Z");
type TestDb = Awaited<ReturnType<typeof makeTestDb>>["db"];

function makeDeps(db: TestDb, claude: { structured: ClaudeClient["structured"] } | null): PipelineDeps {
  return {
    workflows: inlineStarter(), db, claude,
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    councilModels: { lesson: "m-lesson" },
    telegram: { send: async () => {} }, now: () => NOW,
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
}

// A resolved crowd question: haiku 0.31 and sonnet 0.44 said NO, opus 0.70 said YES; the room said YES 62%.
async function resolved(outcome: "yes" | "no" | "void" = "yes", opts: { crowd?: boolean; version?: number } = {}) {
  const { db } = await makeTestDb();
  const rows = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: opts.version ?? 3, status: "locked" }).where(eq(schema.rounds.date, DATE));
  const q = rows[0]!;
  await db.update(schema.questions).set({
    text: "cereal is a soup", status: outcome === "void" ? "void" : "resolved", outcome, resolvedAt: new Date("2026-09-26T16:01:00Z"),
    marketSource: opts.crowd === false ? "kalshi" : "crowd", linePYes: "0.44", crowdYesPct: "62", crowdCount: 41,
  }).where(eq(schema.questions.id, q.id));
  await db.insert(schema.lines).values([
    { questionId: q.id, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "no chance" },
    { questionId: q.id, member: "sonnet", pYes: "0.44", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "Most people will not sign that." },
    { questionId: q.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "Four reasons." },
  ]);
  return { db, q };
}

// The fake client answers reactions by member name and allows every taste verdict unless told to refuse a text.
function claude(calls: StructuredCall[], opts: { refuse?: string; tasteFails?: boolean; reactionFails?: string } = {}) {
  return {
    async structured(call: StructuredCall) {
      calls.push(call);
      if (call.schemaName === "reaction") {
        const who = call.system.includes("You are HAIKU") ? "haiku" : call.system.includes("You are SONNET") ? "sonnet" : "opus";
        if (opts.reactionFails === who) throw new Error("down");
        return { text: `${who} reacts` };
      }
      if (call.schemaName === "taste_verdicts") {
        if (opts.tasteFails) throw new Error("taste down");
        const lines = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l));
        return { verdicts: lines.map((l, i) => ({ index: i, allowed: !(opts.refuse && l.includes(opts.refuse)), reason: "" })) };
      }
      throw new Error(`unexpected ${call.schemaName}`);
    },
  };
}

describe("writeReactions (design 2026-09-25 §5.3)", () => {
  it("writes one reaction per member on the wrong side, in character, through one taste call", async () => {
    const { db, q } = await resolved("yes");
    const calls: StructuredCall[] = [];
    const r = await writeReactions(makeDeps(db, claude(calls)), q.id);
    expect(r).toEqual({ questionId: q.id, written: 2, dropped: 0 });
    const reactions = calls.filter((c) => c.schemaName === "reaction");
    expect(reactions.length).toBe(2);
    expect(reactions[0]!.model).toBe("m-lesson");
    expect(reactions[0]!.webSearch).toBeUndefined();
    expect(reactions.map((c) => c.system.match(/You are (\w+)/)![1])).toEqual(["HAIKU", "SONNET"]);
    expect(reactions[0]!.system).toContain("night shift");
    expect(reactions[0]!.system).toContain("Never a player");
    expect(reactions[0]!.user).toContain("cereal is a soup");
    expect(reactions[0]!.user).toContain("YOUR LINE: 31% agree");
    expect(reactions[0]!.user).toContain("THE ROOM: 62% agreed of 41");
    expect(reactions[0]!.user).toContain("OPUS said 70% and was right");
    expect(calls.filter((c) => c.schemaName === "taste_verdicts").length).toBe(1);
    const rows = await db.query.reactions.findMany({ orderBy: (x, { asc }) => [asc(x.member)] });
    expect(rows.map((x) => [x.member, x.text, x.promptVersion])).toEqual([["haiku", "haiku reacts", "reaction-v1"], ["sonnet", "sonnet reacts", "reaction-v1"]]);
  });
  it("writes nothing for a void, a market question, a version 2 round, or an unresolved question", async () => {
    for (const [outcome, opts] of [["void", {}], ["yes", { crowd: false }], ["yes", { version: 2 }]] as const) {
      const { db, q } = await resolved(outcome, opts);
      const r = await writeReactions(makeDeps(db, claude([])), q.id);
      expect(r.written).toBe(0);
      expect((await db.query.reactions.findMany()).length).toBe(0);
    }
  });
  it("a member exactly at 0.5 is on neither side and stays silent", async () => {
    const { db, q } = await resolved("no");
    await db.update(schema.lines).set({ pYes: "0.5" }).where(eq(schema.lines.member, "opus"));
    // outcome NO: haiku 0.31 and sonnet 0.44 are right; opus at 0.5 is neither.
    const r = await writeReactions(makeDeps(db, claude([])), q.id);
    expect(r.written).toBe(0);
  });
  it("drops a reaction the taste gate refuses and keeps the rest", async () => {
    const { db, q } = await resolved("yes");
    const r = await writeReactions(makeDeps(db, claude([], { refuse: "haiku reacts" })), q.id);
    expect(r).toEqual({ questionId: q.id, written: 1, dropped: 1 });
    expect((await db.query.reactions.findMany()).map((x) => x.member)).toEqual(["sonnet"]);
  });
  it("drops the whole batch when the taste gate fails — fail-closed", async () => {
    const { db, q } = await resolved("yes");
    const r = await writeReactions(makeDeps(db, claude([], { tasteFails: true })), q.id);
    expect(r.written).toBe(0);
    expect(r.dropped).toBe(2);
    expect(r.error).toContain("taste");
    expect((await db.query.reactions.findMany()).length).toBe(0);
  });
  it("is idempotent and never throws on a failed member call", async () => {
    const { db, q } = await resolved("yes");
    const deps = makeDeps(db, claude([], { reactionFails: "haiku" }));
    const first = await writeReactions(deps, q.id);
    expect(first.written).toBe(1);
    expect(first.error).toContain("haiku: down");
    const again = await writeReactions(makeDeps(db, claude([])), q.id);
    expect(again.written).toBe(1); // haiku's row, missing before, is written now; sonnet's is kept
    expect((await db.query.reactions.findMany()).length).toBe(2);
  });
});
```

Append to `apps/api/test/council-lessons.test.ts`:

```ts
describe("the lesson's register (design 2026-09-25 §5.4)", () => {
  it("names the member's title and asks for its own register", async () => {
    const { db, q } = await settled("yes");
    const calls: StructuredCall[] = [];
    await writeLessons(makeDeps(db, { structured: async (c) => { calls.push(c); return { text: "L." }; } }), q.id);
    expect(calls[0]!.system).toContain("in your own register");
    expect(calls[0]!.user).toContain("MEMBER: SONNET, day shift");
    expect(calls[0]!.user).toContain("REGISTER: You keep the channel on task");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/council-reactions.test.ts test/council-lessons.test.ts`
Expected: FAIL, module not found / register missing.

- [ ] **Step 3: Implement reactions**

In `members.ts` add:

```ts
export const REACTION_PROMPT_VERSION = "reaction-v1";

export function reactionModel(deps: PipelineDeps): string {
  return deps.councilModels?.lesson ?? DEFAULT_LESSON_MODEL;
}
```

Create `apps/api/src/pipeline/council/reactions.ts`:

```ts
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
```

In `lessons.ts`: replace the `NAMES` map with `MEMBER_PROFILE` (import from `@oracle/core`), change `SYSTEM` to end `...one concrete adjustment for the next question in the same series, in your own register. No preamble. ...`, and the user block's first line to:

```ts
      const me = MEMBER_PROFILE[member];
      const user = `MEMBER: ${me.name}, ${me.title}\nREGISTER: ${me.register}\nQUESTION: ${q.text}\n...
```

keeping the rest of the block as it is.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/council-reactions.test.ts test/council-lessons.test.ts test/pipeline-taste.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/council apps/api/test/council-reactions.test.ts apps/api/test/council-lessons.test.ts
git commit -m "feat(api): reactions at resolution, lessons in register

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 8: The reactions step on both resolution paths, and the day report

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts`, `apps/api/src/pipeline/workflow-entrypoints.ts`
- Test: `apps/api/test/pipeline-resolve-crowd.test.ts`, `apps/api/workflows-test/` (see Step 1)

**Interfaces:**
- Consumes: `writeReactions` (Task 7).
- Produces: `runResolution` calls `writeReactions` after `resolveOne` and before `writeLessons`; `ResolutionWorkflow` runs step `reactions-<questionId>` under `POLICY.model` between `resolve-` and `lessons-`; `narrateResolution` gains a line `reactions: N written, M dropped` when any were attempted.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/pipeline-resolve-crowd.test.ts`:

```ts
import { runResolution } from "../src/pipeline/resolve";

describe("reactions on the inline path (design 2026-09-25 §9)", () => {
  it("writes reactions after the crowd resolves, before lessons, and narrates the count", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    await db.insert(schema.lines).values([
      { questionId: qId, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-23T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "no" },
      { questionId: qId, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-23T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "yes" },
    ]);
    const order: string[] = [];
    const sent: string[] = [];
    deps.telegram = { send: async (t) => { sent.push(t); } };
    deps.claude = {
      async structured(call) {
        order.push(call.schemaName);
        if (call.schemaName === "reaction") return { text: "ok the room is wrong" };
        if (call.schemaName === "taste_verdicts") return { verdicts: [{ index: 0, allowed: true, reason: "" }] };
        if (call.schemaName === "lesson") return { text: "L." };
        throw new Error(`unexpected ${call.schemaName}`);
      },
    };
    await runResolution(deps, DATE, [qId]);
    expect(order).toEqual(["reaction", "taste_verdicts", "lesson", "lesson"]);
    const rows = await db.query.reactions.findMany();
    expect(rows.map((r) => r.member)).toEqual(["haiku"]);
    expect(sent.some((t) => t.includes("reactions: 1 written, 0 dropped"))).toBe(true);
  });
});
```

Look in `apps/api/workflows-test/` for the existing ResolutionWorkflow step-order test (search for `lessons-`). Add an assertion that the recorded step names for one question are `["resolve-<id>", "reactions-<id>", "lessons-<id>"]` in that order, using the same fake `step` the file already uses. If no such test exists, add one modelled on the nearest CouncilWorkflow step test in that directory.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/pipeline-resolve-crowd.test.ts && pnpm test:workflows`
Expected: FAIL (order lacks `reaction`; step order lacks `reactions-`).

- [ ] **Step 3: Implement**

In `resolve.ts`:

```ts
import { writeReactions, type ReactionsOutcome } from "./council/reactions";
```

`runResolution` becomes:

```ts
export async function runResolution(deps: PipelineDeps, date: string, questionIds: string[]): Promise<ResolveOutcome[]> {
  const outcomes: ResolveOutcome[] = [];
  const reactions: ReactionsOutcome[] = [];
  for (const questionId of questionIds) {
    outcomes.push(await resolveOne(deps, questionId));
    // The night shift reacts before it learns (design 2026-09-25 §5.3): the
    // reaction is in the moment, the lesson is the morning after.
    reactions.push(await writeReactions(deps, questionId));
    await writeLessons(deps, questionId);
  }
  await narrateResolution(deps, date, outcomes, reactions);
  return outcomes;
}
```

`narrateResolution` gains an optional fourth parameter `reactions: ReactionsOutcome[] = []` and, after the push lines:

```ts
  const attempted = reactions.filter((r) => r.written + r.dropped > 0 || r.error);
  if (attempted.length > 0) {
    const written = attempted.reduce((s, r) => s + r.written, 0);
    const dropped = attempted.reduce((s, r) => s + r.dropped, 0);
    const errs = attempted.filter((r) => r.error).map((r) => `${r.questionId}: ${r.error}`);
    await deps.telegram.send(`reactions: ${written} written, ${dropped} dropped${errs.length ? ` · ⚠ ${errs.join(" · ")}` : ""}`);
  }
```

In `workflow-entrypoints.ts`, import `writeReactions` and `ReactionsOutcome`, and in `ResolutionWorkflow.run`:

```ts
    const outcomes: ResolveOutcome[] = [];
    const reactions: ReactionsOutcome[] = [];
    for (const questionId of questionIds) {
      outcomes.push(await durableStep(step, `resolve-${questionId}`, POLICY.noRetry, deps, () => resolveOne(deps, questionId)));
      reactions.push(await durableStep(step, `reactions-${questionId}`, POLICY.model, deps, () => writeReactions(deps, questionId)));
      await durableStep(step, `lessons-${questionId}`, POLICY.model, deps, () => writeLessons(deps, questionId));
    }
    await durableStep(step, "narrate", POLICY.narrate, deps, async () => {
      await narrateResolution(deps, date, outcomes, reactions);
      return { failed: outcomes.filter((o) => o.error).length };
    });
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/pipeline-resolve-crowd.test.ts test/pipeline-resolve.test.ts test/resolution.test.ts && pnpm test:workflows`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline/resolve.ts apps/api/src/pipeline/workflow-entrypoints.ts apps/api/test/pipeline-resolve-crowd.test.ts apps/api/workflows-test
git commit -m "feat(api): the reactions step on both resolution paths

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 9: `CROWD_RESOLVE_MIN` as a Worker var

**Files:**
- Modify: `apps/api/src/pipeline/resolve.ts`, `apps/api/src/pipeline/round-kind.ts`, `apps/api/src/pipeline/index.ts`, `apps/api/src/worker.ts`, `apps/api/wrangler.jsonc`
- Test: `apps/api/test/round-kind.test.ts`, `apps/api/test/pipeline-resolve-crowd.test.ts`

**Interfaces:**
- Produces: `PipelineDeps.crowdResolveMin?: number`; `CROWD_RESOLVE_MIN = 20` (the default); `parseCrowdResolveMin(raw: string | undefined): number` (a positive integer, else the default); `crowdResolveMinOf(deps): number`. `resolveFromCrowd` reads `crowdResolveMinOf(deps)`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/round-kind.test.ts`:

```ts
import { parseCrowdResolveMin, crowdResolveMinOf } from "../src/pipeline/round-kind";
import { CROWD_RESOLVE_MIN } from "../src/pipeline/resolve";

describe("the crowd floor as a var (design 2026-09-25 N11)", () => {
  it("defaults to 20 and parses a positive integer", () => {
    expect(CROWD_RESOLVE_MIN).toBe(20);
    expect(parseCrowdResolveMin(undefined)).toBe(20);
    expect(parseCrowdResolveMin("3")).toBe(3);
    expect(parseCrowdResolveMin("0")).toBe(20);
    expect(parseCrowdResolveMin("-2")).toBe(20);
    expect(parseCrowdResolveMin("abc")).toBe(20);
    expect(crowdResolveMinOf({ crowdResolveMin: 3 })).toBe(3);
    expect(crowdResolveMinOf({})).toBe(20);
  });
});
```

In `apps/api/test/pipeline-resolve-crowd.test.ts`, add `crowdResolveMin: 1` to the `deps` object in `world`, and change the existing floor test (search for `CROWD_RESOLVE_MIN`) so it sets `deps.crowdResolveMin = 4` on a three-player room and expects a void with `PIPELINE_LINES.crowdTooFew`. Add:

```ts
  it("voids a three-player room at the default floor of 20", async () => {
    const { db, deps, qId } = await world([true, true, false]);
    delete deps.crowdResolveMin;
    expect(await resolveFromCrowd(deps, qId)).toBe(true);
    expect((await db.query.questions.findFirst({ where: eq(schema.questions.id, qId) }))!.outcome).toBe("void");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/round-kind.test.ts test/pipeline-resolve-crowd.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`round-kind.ts`:

```ts
// The crowd floor (design 2026-09-25 N11): an operating fact, set by hand
// while the field is small. The code's default is the rule.
export const DEFAULT_CROWD_RESOLVE_MIN = 20;

export function parseCrowdResolveMin(raw: string | undefined): number {
  const n = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_CROWD_RESOLVE_MIN;
}

export function crowdResolveMinOf(deps: Pick<PipelineDeps, "crowdResolveMin">): number {
  return deps.crowdResolveMin ?? DEFAULT_CROWD_RESOLVE_MIN;
}
```

`index.ts` `PipelineDeps`: add `crowdResolveMin?: number;` beside `siteUrl`.

`resolve.ts`: replace the constant's comment and value with

```ts
export const CROWD_RESOLVE_MIN = DEFAULT_CROWD_RESOLVE_MIN;
```

(import `DEFAULT_CROWD_RESOLVE_MIN, crowdResolveMinOf` from `./round-kind`) and in `resolveFromCrowd` use `const floor = crowdResolveMinOf(deps);` and `if (n < floor) {`.

`worker.ts`: add `CROWD_RESOLVE_MIN?: string;` to `WorkerEnv` with the comment `// The crowd floor (design 2026-09-25 N11); the code defaults to 20.`, and `crowdResolveMin: parseCrowdResolveMin(env.CROWD_RESOLVE_MIN),` in `buildPipelineDeps`.

`wrangler.jsonc` vars: add

```jsonc
    // The crowd floor (design 2026-09-25 N11). The rule is 20; it is 3 by
    // hand while the field is a handful. Raise it in one deploy.
    "CROWD_RESOLVE_MIN": "3",
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/round-kind.test.ts test/pipeline-resolve-crowd.test.ts test/pipeline-decide.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/pipeline apps/api/src/worker.ts apps/api/wrangler.jsonc apps/api/test/round-kind.test.ts apps/api/test/pipeline-resolve-crowd.test.ts
git commit -m "feat(api): CROWD_RESOLVE_MIN as a Worker var, default 20

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 10: The wire schemas in core

**Files:**
- Modify: `packages/core/src/schemas.ts`, `packages/core/src/exhibition.ts`
- Test: `packages/core/test/schemas-nightshift.test.ts`

**Interfaces:**
- Produces, all in `@oracle/core`:
  - `SeenOnSchema = z.object({ label: z.string(), url: z.string().nullable() })`.
  - `RoundTodaySchema`: `council_committed_at: z.string().nullable().default(null)`; per question `crowd: z.boolean().default(false)`, `seen_on: SeenOnSchema.nullable().default(null)`, `unhinged: z.boolean().default(false)`. `line_p_yes` unchanged in shape.
  - `TodayLogSchema = z.object({ questions: z.array(z.object({ question_id: z.string().uuid(), line_p_yes: z.number().nullable(), log: z.array(LogLineSchema) })) })`.
  - `CouncilEntrySchema.committed_at: z.string().nullable().default(null)`.
  - `RevealSchema`: `reactions: z.array(z.object({ question_id, member: z.enum(["sonnet","opus","haiku"]), text, created_at }))` default `[]`; `lessons` same shape default `[]`; per question `seen_on` and `unhinged` with the same defaults as today.
  - `StandingsSchema`: rows gain `read_rate: z.number().nullable().default(null)` and `title: z.string().nullable().default(null)`; top level gains `window: z.number().int().nullable().default(null)`.
  - `ExhibitionSchema.log: z.array(LogLineSchema).default([])`.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/test/schemas-nightshift.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RoundTodaySchema, TodayLogSchema, RevealSchema, StandingsSchema, ExhibitionSchema, CouncilEntrySchema } from "../src";

const qid = "5d3f0d2a-6a3e-4a1f-9b8e-0c2a1b3c4d5e";
const q = { id: qid, slot: 1, is_big_one: false, text: "cereal is a soup", category: "culture", source_name: "THE PLAYERS", resolution_criteria: "rules", locks_at: "2026-09-26T16:00:00.000Z", lock_healed: false };
const line = { at: "2026-09-25T13:00:00.000Z", kind: "say", member: "haiku", text: "no chance", p_yes: 0.31, tone: "mute" };

describe("the night shift on the wire (design 2026-09-25 §11)", () => {
  it("RoundToday carries the shift clock and each take's provenance, defaulting all three", () => {
    const r = RoundTodaySchema.parse({ rules_version: 3, date: "2026-09-25", locks_at: null, player_count: 0, questions: [q] });
    expect(r.council_committed_at).toBeNull();
    expect(r.questions[0]).toMatchObject({ crowd: false, seen_on: null, unhinged: false });
    const s = RoundTodaySchema.parse({ rules_version: 3, date: "2026-09-25", locks_at: null, player_count: 0, council_committed_at: "2026-09-25T13:00:00.000Z", questions: [{ ...q, crowd: true, seen_on: { label: "r/x", url: null }, unhinged: true }] });
    expect(s.questions[0]!.seen_on).toEqual({ label: "r/x", url: null });
  });
  it("TodayLog is per sealed question with the line and the log", () => {
    const t = TodayLogSchema.parse({ questions: [{ question_id: qid, line_p_yes: 0.38, log: [line] }] });
    expect(t.questions[0]!.log[0]!.member).toBe("haiku");
    expect(() => TodayLogSchema.parse({ questions: [{ question_id: "nope", line_p_yes: null, log: [] }] })).toThrow();
  });
  it("Reveal carries reactions, lessons and commit instants, all defaulted", () => {
    const base = { rules_version: 3, date: "2026-09-25", day_points: 0, first_hour: false, candidates_written: 0, candidates_rejected: 0, vigil_mult: null, questions: [], ledger: { settled: false, streak: 0, calls_rated: 0, oracle_score: null } };
    const r = RevealSchema.parse(base);
    expect(r.reactions).toEqual([]);
    expect(r.lessons).toEqual([]);
    const s = RevealSchema.parse({ ...base, reactions: [{ question_id: qid, member: "haiku", text: "lmao", created_at: "2026-09-26T16:02:00.000Z" }], lessons: [{ question_id: qid, member: "opus", text: "note", created_at: "2026-09-26T16:03:00.000Z" }] });
    expect(s.reactions[0]!.member).toBe("haiku");
    expect(CouncilEntrySchema.parse({ question_id: qid, member: "sonnet", p_yes: 0.4, on_right_side: null, reasoning: null, cited: [], lessons_received: 0 }).committed_at).toBeNull();
  });
  it("Standings rows carry a read rate and a title; the payload a window", () => {
    const s = StandingsSchema.parse({ as_of: "2026-09-25T00:00:00.000Z", rounds: 1, questions: 5, rows: [{ member: "haiku", calls: 30, brier: 0.2, house_delta: 0, read_rate: 0.6, title: "night shift" }, { member: "crowd", calls: 30, brier: null, house_delta: 0 }] });
    expect(s.window).toBeNull();
    expect(s.rows[1]).toMatchObject({ read_rate: null, title: null });
  });
  it("Exhibition carries a log, defaulting to empty", () => {
    const e = ExhibitionSchema.parse({ id: "x", kind: "historical", question: "cereal is a soup", context: null, sourceName: "THE PLAYERS", roundDate: "2026-09-25", oraclePYes: 0.38, outcome: "yes", crowdYesPct: 62 });
    expect(e.log).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/core && pnpm vitest run test/schemas-nightshift.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `schemas.ts`, before `RoundTodaySchema`:

```ts
// Where a take was seen (design 2026-09-25 §4.2).
export const SeenOnSchema = z.object({ label: z.string(), url: z.string().nullable() });
export type SeenOn = z.infer<typeof SeenOnSchema>;
```

In `RoundTodaySchema`, at the top level: `council_committed_at: z.string().nullable().default(null),` with the comment `// When the Council clocked in (design 2026-09-25 §6.5); null when it never committed.` Per question, after `line_p_yes`:

```ts
      // A crowd question (design 2026-09-25 §7): the client keys every
      // agree/disagree string on this, never on source_name.
      crowd: z.boolean().default(false),
      seen_on: SeenOnSchema.nullable().default(null),
      unhinged: z.boolean().default(false),
```

After `MineTodaySchema`:

```ts
// The channel after the seal (design 2026-09-25 §6.2): only the caller's
// sealed questions are present; unsealed ones are absent, not empty.
export const TodayLogSchema = z.object({
  questions: z.array(z.object({
    question_id: z.string().uuid(),
    line_p_yes: z.number().nullable(),
    log: z.array(LogLineSchema),
  })),
});
export type TodayLog = z.infer<typeof TodayLogSchema>;
```

`CouncilEntrySchema` gains `committed_at: z.string().nullable().default(null),`.

After `EvidenceItemSchema`:

```ts
export const ChannelRemarkSchema = z.object({
  question_id: z.string().uuid(),
  member: z.enum(["sonnet", "opus", "haiku"]),
  text: z.string(),
  created_at: z.string(),
});
export type ChannelRemark = z.infer<typeof ChannelRemarkSchema>;
```

`RevealSchema`: after `evidence`, `reactions: z.array(ChannelRemarkSchema).default([]),` and `lessons: z.array(ChannelRemarkSchema).default([]),`; per question after `oracle_p_yes`: `seen_on: SeenOnSchema.nullable().default(null),` and `unhinged: z.boolean().default(false),`.

`StandingsSchema`: rows gain `read_rate: z.number().nullable().default(null), title: z.string().nullable().default(null),`; top level gains `window: z.number().int().nullable().default(null),`.

`exhibition.ts`: import `LogLineSchema` from `./schemas` and add `log: z.array(LogLineSchema).default([]),` with the comment `// The channel on a past hot take (design 2026-09-25 §11); empty on a market question and the fictional fallback.`

- [ ] **Step 4: Run core, then everything that parses these schemas**

Run: `cd packages/core && pnpm vitest run && pnpm typecheck`
Expected: PASS. Then `cd ../../apps/mobile && pnpm typecheck && pnpm vitest run` — mobile fixtures parse with defaults, so this should stay green; if a mobile test constructs a `Reveal` or `RoundToday` literal typed against the schema output (not parsed), add the new fields to that literal.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schemas.ts packages/core/src/exhibition.ts packages/core/test/schemas-nightshift.test.ts apps/mobile
git commit -m "feat(core): the night shift on the wire

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 11: `/today` and `/today/log`

**Files:**
- Modify: `apps/api/src/routes/round.ts`
- Test: `apps/api/test/today-log.test.ts`, `apps/api/test/round-v3.test.ts`

**Interfaces:**
- Consumes: `buildLog`, `TodayLogSchema`, `RoundTodaySchema` (Tasks 2, 10); `schema.reactions`.
- Produces: `GET /v1/round/today` serves `council_committed_at`, and per question `crowd`, `seen_on`, `unhinged`; `line_p_yes` is served only on questions the caller has sealed, null otherwise. `GET /v1/round/today/log` serves `TodayLog` for the caller's sealed questions; 404 with no open round.

Amendment to spec N5, recorded in Task 15: `line_p_yes` stays on `/today` for sealed questions only, so build 12's receipt and tray keep working while the leak closes. Build 13 reads the log instead; plan 2 removes the field.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/test/today-log.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { TodayLogSchema, RoundTodaySchema } from "@oracle/core";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-25";
afterEach(() => vi.useRealTimers());

async function world() {
  vi.useFakeTimers({ now: new Date("2026-09-25T17:00:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
  await db.update(schema.rounds).set({ rulesVersion: 3, oracleCommittedAt: new Date("2026-09-25T13:00:00Z") }).where(eq(schema.rounds.date, DATE));
  await db.update(schema.questions).set({ linePYes: "0.38", marketSource: "crowd", sourceName: "THE PLAYERS" }).where(eq(schema.questions.roundDate, DATE));
  await db.update(schema.questions).set({ seenOnLabel: "r/unpopularopinion", seenOnUrl: "https://r/x", unhinged: true }).where(eq(schema.questions.id, qs[3]!.id));
  await db.insert(schema.lines).values([
    { questionId: qs[0]!.id, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "no chance" },
    { questionId: qs[0]!.id, member: "opus", pYes: "0.70", committedAt: new Date("2026-09-25T13:00:01Z"), model: "m", promptVersion: "council-v2", reasoning: "Four reasons." },
    { questionId: qs[1]!.id, member: "sonnet", pYes: "0.55", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "Close." },
  ]);
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const as = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const seal = (qid: string, answer: boolean) => as("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence: 75, idempotency_key: `k-${qid}` }) });
  return { db, app, qs, as, seal };
}

describe("GET /v1/round/today (design 2026-09-25 §11)", () => {
  it("carries the shift clock and each take's provenance, and serves the line only once the caller has sealed", async () => {
    const { qs, as, seal } = await world();
    const before = RoundTodaySchema.parse(await (await as("/v1/round/today")).json());
    expect(before.council_committed_at).toBe("2026-09-25T13:00:00.000Z");
    expect(before.questions.every((q) => q.crowd)).toBe(true);
    expect(before.questions.every((q) => q.line_p_yes === null)).toBe(true);
    expect(before.questions.find((q) => q.slot === 4)).toMatchObject({ unhinged: true, seen_on: { label: "r/unpopularopinion", url: "https://r/x" } });
    expect(before.questions.find((q) => q.slot === 1)).toMatchObject({ unhinged: false, seen_on: null });
    await seal(qs[0]!.id, true);
    const after = RoundTodaySchema.parse(await (await as("/v1/round/today")).json());
    expect(after.questions.find((q) => q.slot === 1)!.line_p_yes).toBe(0.38);
    expect(after.questions.find((q) => q.slot === 2)!.line_p_yes).toBeNull();
  });
});

describe("GET /v1/round/today/log (design 2026-09-25 §6.2)", () => {
  it("serves the log only for the caller's sealed questions, ordered by commit time, mute before lock", async () => {
    const { qs, as, seal } = await world();
    await seal(qs[0]!.id, true);
    const out = TodayLogSchema.parse(await (await as("/v1/round/today/log")).json());
    expect(out.questions.map((q) => q.question_id)).toEqual([qs[0]!.id]);
    const q = out.questions[0]!;
    expect(q.line_p_yes).toBe(0.38);
    expect(q.log.map((l) => [l.member, l.p_yes, l.tone, l.kind])).toEqual([["haiku", 0.31, "mute", "say"], ["opus", 0.7, "mute", "say"]]);
    expect(q.log[0]!.at).toBe("2026-09-25T13:00:00.000Z");
    expect(q.log[0]!.text).toBe("no chance");
  });
  it("is empty when nothing is sealed and 404 with no open round", async () => {
    const { as } = await world();
    expect(TodayLogSchema.parse(await (await as("/v1/round/today/log")).json()).questions).toEqual([]);
    vi.setSystemTime(new Date("2026-09-27T12:00:00Z"));
    expect((await as("/v1/round/today/log")).status).toBe(404);
  });
  it("a sealed question with no Council rows has an empty log and a null line", async () => {
    const { db, qs, as, seal } = await world();
    await db.update(schema.questions).set({ linePYes: null }).where(eq(schema.questions.id, qs[2]!.id));
    await seal(qs[2]!.id, false);
    const out = TodayLogSchema.parse(await (await as("/v1/round/today/log")).json());
    expect(out.questions).toEqual([{ question_id: qs[2]!.id, line_p_yes: null, log: [] }]);
  });
});
```

In `apps/api/test/round-v3.test.ts`, change the first test's last assertion to:

```ts
    expect(json.questions.every((q) => q.line_p_yes === null)).toBe(true);
```

and add, in the same `describe`:

```ts
  it("serves the line on a sealed question", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-10T16:30:00Z"), toFake: ["Date"] });
    const { qs, as, seal } = await world(1);
    await seal(0, qs[0]!.id, true, 75);
    const json = RoundTodaySchema.parse(await (await as(0)("/v1/round/today")).json());
    expect(json.questions.find((q) => q.slot === 1)!.line_p_yes).toBe(0.35);
    expect(json.questions.find((q) => q.slot === 2)!.line_p_yes).toBeNull();
  });
```

Search the other API route tests for `line_p_yes` on `/today` (`grep -rn "line_p_yes" apps/api/test`) and update any that expect the line before a seal.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/today-log.test.ts test/round-v3.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `round.ts`, import `buildLog` and `type ModelMemberId, MODEL_MEMBER_IDS` from `@oracle/core`. In `/today`, after the `players` query add the caller's seals:

```ts
    // The line is a common signal before the seal (design 2026-09-22 T9) and
    // the leak the hot-takes design accepted for a week closes here: it is
    // served only on the caller's own sealed questions (design 2026-09-25 N5).
    const sealed = new Set(
      qIds.length
        ? (await db.query.predictions.findMany({ where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qIds)), columns: { questionId: true } })).map((p) => p.questionId)
        : [],
    );
```

and in the response: `council_committed_at: round.oracleCommittedAt?.toISOString() ?? null,` at the top level; per question replace the `line_p_yes` line with:

```ts
        line_p_yes: sealed.has(q.id) && q.linePYes !== null ? Number(q.linePYes) : null,
        crowd: q.marketSource === "crowd",
        seen_on: q.seenOnLabel === null ? null : { label: q.seenOnLabel, url: q.seenOnUrl },
        unhinged: q.unhinged,
```

Add a helper near `openRound`:

```ts
// The channel's rows for a set of questions (design 2026-09-25 §6.1): model
// members only, ordered by commit; the market member never posts.
async function channelRows(db: Db, qIds: string[]) {
  if (qIds.length === 0) return { lines: [], reactions: [], lessons: [] };
  const [lines, reactions, lessons] = await Promise.all([
    db.query.lines.findMany({ where: inArray(schema.lines.questionId, qIds) }),
    db.query.reactions.findMany({ where: inArray(schema.reactions.questionId, qIds) }),
    db.query.lessons.findMany({ where: inArray(schema.lessons.questionId, qIds) }),
  ]);
  const isModel = (m: string): m is ModelMemberId => (MODEL_MEMBER_IDS as readonly string[]).includes(m);
  return {
    lines: lines.filter((l) => isModel(l.member)).map((l) => ({ questionId: l.questionId, member: l.member as ModelMemberId, pYes: Number(l.pYes), reasoning: l.reasoning, committedAt: l.committedAt.toISOString() })),
    reactions: reactions.filter((r) => isModel(r.member)).map((r) => ({ questionId: r.questionId, member: r.member as ModelMemberId, text: r.text, createdAt: r.createdAt.toISOString() })),
    lessons: lessons.filter((l) => isModel(l.member)).map((l) => ({ questionId: l.questionId, member: l.member as ModelMemberId, text: l.text, createdAt: l.createdAt.toISOString() })),
  };
}
```

Add the route after `/today/mine`:

```ts
  // The channel after the seal (design 2026-09-25 §6.2). Only the caller's
  // sealed questions; before lock there is no outcome, so every tone is mute.
  .get("/today/log", async (c) => {
    const { db } = c.get("deps");
    const userId = c.get("userId");
    const found = await openRound(db, new Date());
    if (!found) return c.json({ error: "no open round" }, 404);
    const { qs } = found;
    const mine = qs.length
      ? await db.query.predictions.findMany({ where: and(eq(schema.predictions.userId, userId), inArray(schema.predictions.questionId, qs.map((q) => q.id))), columns: { questionId: true } })
      : [];
    const sealedIds = mine.map((p) => p.questionId);
    const rows = await channelRows(db, sealedIds);
    const questions = qs.filter((q) => sealedIds.includes(q.id)).map((q) => ({
      question_id: q.id,
      line_p_yes: q.linePYes === null ? null : Number(q.linePYes),
      log: buildLog({
        lines: rows.lines.filter((l) => l.questionId === q.id),
        outcome: null,
        crowd: { yesPct: null, count: null, resolvedAt: null, voidReason: null },
        reactions: [],
        lessons: [],
      }),
    }));
    return c.json({ questions });
  })
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/today-log.test.ts test/round-v3.test.ts test/round.test.ts test/mine.test.ts test/crowd.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/today-log.test.ts apps/api/test/round-v3.test.ts
git commit -m "feat(api): /today provenance and sealed-only line; /today/log

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 12: The reveal carries the channel

**Files:**
- Modify: `apps/api/src/routes/round.ts`
- Test: `apps/api/test/reveal-council.test.ts`

**Interfaces:**
- Consumes: `channelRows` (Task 11), `RevealSchema` additions (Task 10).
- Produces: reveal Council entries carry `committed_at`; the payload carries `reactions` and `lessons` (model members only); each question carries `seen_on` and `unhinged`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/reveal-council.test.ts`:

```ts
describe("the reveal's channel (design 2026-09-25 §6.3)", () => {
  it("carries commit instants, reactions and lessons for model members, and each take's provenance", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-12T02:00:00Z"), toFake: ["Date"] });
    const { db, qs, get } = await world();
    await db.update(schema.questions).set({ status: "resolved", outcome: "no", resolvedAt: new Date("2026-09-11T16:01:00Z"), seenOnLabel: "the replies", unhinged: true }).where(eq(schema.questions.id, qs[0]!.id));
    await db.insert(schema.reactions).values({ questionId: qs[0]!.id, member: "haiku", text: "ok the room is wrong", model: "m", promptVersion: "reaction-v1", createdAt: new Date("2026-09-11T16:02:00Z") });
    await db.insert(schema.lessons).values({ questionId: qs[0]!.id, member: "sonnet", seriesKey: "news", text: "Warmer than I model.", resolvedAt: new Date("2026-09-11T16:01:00Z"), createdAt: new Date("2026-09-11T16:03:00Z") });
    const r = RevealSchema.parse(await (await get(`/v1/round/${DATE}/reveal`)).json());
    expect(r.council.find((e) => e.member === "sonnet")!.committed_at).toBe("2026-09-10T14:00:00.000Z");
    expect(r.reactions).toEqual([{ question_id: qs[0]!.id, member: "haiku", text: "ok the room is wrong", created_at: "2026-09-11T16:02:00.000Z" }]);
    expect(r.lessons).toEqual([{ question_id: qs[0]!.id, member: "sonnet", text: "Warmer than I model.", created_at: "2026-09-11T16:03:00.000Z" }]);
    expect(r.questions[0]).toMatchObject({ seen_on: { label: "the replies", url: null }, unhinged: true });
    expect(r.questions[1]).toMatchObject({ seen_on: null, unhinged: false });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/reveal-council.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the reveal handler, add `committed_at: l.committedAt.toISOString(),` to each Council entry. After the `evidence` map:

```ts
    const channel = await channelRows(db, qIds);
    const reactions = channel.reactions.map((r) => ({ question_id: r.questionId, member: r.member, text: r.text, created_at: r.createdAt }));
    const lessons = channel.lessons.map((l) => ({ question_id: l.questionId, member: l.member, text: l.text, created_at: l.createdAt }));
```

(`channelRows` re-reads `lines`; that is one extra query on a route read once a day per player, accepted.) Add `reactions, lessons,` to the response beside `evidence`, and per question after `oracle_p_yes`:

```ts
          seen_on: q.seenOnLabel === null ? null : { label: q.seenOnLabel, url: q.seenOnUrl },
          unhinged: q.unhinged,
```

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/reveal-council.test.ts test/resolve-reveal.test.ts test/reveal-first-hour.test.ts test/round-v3.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/round.ts apps/api/test/reveal-council.test.ts
git commit -m "feat(api): the reveal carries the channel

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 13: Standings: read rate, titles, window

**Files:**
- Modify: `apps/api/src/standings.ts`, `apps/api/src/routes/standings.ts`
- Test: `apps/api/test/standings.test.ts`

**Interfaces:**
- Consumes: `readRate`, `MEMBER_PROFILE` (Task 1); `StandingsSchema` (Task 10).
- Produces: `standings(calls, asOf, window?: number | null)` returns rows with `read_rate` (over the calls given, null under 25) and `title` (`MEMBER_PROFILE[m].title` for model members, null otherwise) and `window`; `loadSettledCalls(db, opts?: { since?: Date })`; `GET /v1/standings?days=30` filters to rounds dated on or after `asOf − days` and reports `window: 30`; without the query, `window: null`. HTML shows the title beside the name and a READ column; CSV gains `right_side` (`1`, `0`, or empty for a 0.5 line) per row.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/standings.test.ts`:

```ts
import { MEMBER_PROFILE } from "@oracle/core";

describe("the read rate on the standings (design 2026-09-25 §8.1)", () => {
  // 30 settled calls: sonnet right on 18 of 30, opus on 12; the players' row has no rate.
  async function thirty() {
    const { db } = await makeTestDb();
    for (let d = 0; d < 6; d++) {
      const date = `2026-09-${String(10 + d).padStart(2, "0")}`;
      const qs = await seedRound(db, { date, opensAt: new Date(`${date}T16:00:00Z`), locksAt: new Date(`${date}T17:00:00Z`) });
      await db.update(schema.rounds).set({ rulesVersion: 3, status: "resolved" }).where(eq(schema.rounds.date, date));
      for (const q of qs) {
        const i = d * 5 + (q.slot - 1);
        await db.update(schema.questions).set({ linePYes: "0.5", marketSource: "crowd", marketId: date, status: "resolved", outcome: "yes", crowdYesPct: "60", crowdCount: 30 }).where(eq(schema.questions.id, q.id));
        await db.insert(schema.lines).values([
          { questionId: q.id, member: "sonnet", pYes: i < 18 ? "0.7" : "0.3", committedAt: new Date(`${date}T13:00:00Z`) },
          { questionId: q.id, member: "opus", pYes: i < 12 ? "0.7" : "0.3", committedAt: new Date(`${date}T13:00:00Z`) },
        ]);
      }
    }
    return db;
  }
  it("reports each model member's rate and title, and null for the players", async () => {
    const db = await thirty();
    const s = standings(await loadSettledCalls(db), new Date("2026-09-16T00:00:00Z"));
    const row = (m: string) => s.rows.find((r) => r.member === m)!;
    expect(row("sonnet").read_rate).toBeCloseTo(0.6, 6);
    expect(row("opus").read_rate).toBeCloseTo(0.4, 6);
    expect(row("sonnet").title).toBe(MEMBER_PROFILE.sonnet.title);
    expect(row("haiku")).toMatchObject({ calls: 0, read_rate: null, title: "night shift" });
    expect(row("crowd")).toMatchObject({ read_rate: null, title: null });
    expect(s.window).toBeNull();
  });
  it("is null under 25 calls", async () => {
    const { db } = await settledWorld();
    const s = standings(await loadSettledCalls(db), new Date());
    expect(s.rows.find((r) => r.member === "sonnet")!.read_rate).toBeNull();
  });
  it("?days=N windows the calls and reports the window; the HTML shows titles and a READ column; the CSV a right_side", async () => {
    const db = await thirty();
    const app = createApp({ db, env });
    const all = StandingsSchema.parse(await (await app.request("/v1/standings")).json());
    expect(all.questions).toBe(30);
    const windowed = StandingsSchema.parse(await (await app.request("/v1/standings?days=3")).json());
    expect(windowed.window).toBe(3);
    expect(windowed.questions).toBeLessThan(30);
    const html = await (await app.request("/standings")).text();
    expect(html).toContain("night shift");
    expect(html).toContain("<th>Read</th>");
    const csv = await (await app.request("/v1/standings?format=csv")).text();
    expect(csv.split("\n")[0]).toContain("right_side");
    expect(csv.split("\n")[1]!.endsWith(",yes,1") || csv.split("\n")[1]!.endsWith(",yes,0")).toBe(true);
  });
});
```

Check the file's existing imports cover `createApp`, `env`, `StandingsSchema` (they do per the head of the file).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/standings.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `standings.ts`:

```ts
import { MEMBER_ORDER, MEMBER_PROFILE, MODEL_MEMBER_IDS, onRightSide, readRate, standingsRow, type ModelMemberId, type Standings, type StandingsCall } from "@oracle/core";
```

`loadSettledCalls(db, opts: { since?: Date } = {})`: add `...(opts.since ? [gte(schema.questions.roundDate, opts.since.toISOString().slice(0, 10))] : [])` inside the `and(...)`.

`standings(calls, asOf, window: number | null = null)`: build rows as

```ts
  const titleOf = (m: string) => ((MODEL_MEMBER_IDS as readonly string[]).includes(m) ? MEMBER_PROFILE[m as ModelMemberId].title : null);
  const rate = (xs: StandingsCall[]) => readRate(xs.map((x) => ({ p: x.p, outcome: x.outcome })));
  return {
    as_of: asOf.toISOString(),
    rounds: new Set(calls.map((c) => c.date)).size,
    questions: calls.length,
    window,
    rows: [
      ...MEMBER_ORDER.map((member) => { const xs = forMember(member); return { member, ...standingsRow(xs), read_rate: rate(xs), title: titleOf(member) }; }),
      { member: "crowd" as const, ...standingsRow(crowd), read_rate: null, title: null },
    ],
  };
```

CSV: `CSV_HEADER` gains `,right_side`; each row appends `onRightSide(l.pYes, c.outcome) === null ? "" : onRightSide(l.pYes, c.outcome) ? 1 : 0`.

HTML: the row renderer prints `${NAMES[r.member]}${r.title ? ` <span class="title">${escapeHtml(r.title)}</span>` : ""}` in the member cell, a `<th>Read</th>` column after Calls showing `r.read_rate === null ? "—" : \`${Math.round(r.read_rate * 100)}%\``, and the footnote sentence "The players are people who post." Add `.title{color:#666;font-size:12px;margin-left:6px}` to `STYLE`.

In `routes/standings.ts`, parse `days` from `c.req.query("days")`: a positive integer sets `since = new Date(asOf.getTime() − days × 86_400_000)` and `window = days`; anything else leaves both null. Pass `since` to `loadSettledCalls` and `window` to `standings`. Both the JSON and CSV forms honour it; the HTML page is all-time.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/standings.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/standings.ts apps/api/src/routes/standings.ts apps/api/test/standings.test.ts
git commit -m "feat(api): standings read rate, titles and window

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 14: The channel on a past hot take

**Files:**
- Modify: `apps/api/src/exhibition.ts`
- Test: `apps/api/test/exhibition.test.ts`

**Interfaces:**
- Consumes: `buildLog`, `ExhibitionSchema.log` (Tasks 2, 10).
- Produces: `selectExhibition` returns `log` built from the chosen crowd question's lines, reactions and lessons with its real outcome and room; empty on a market question.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/exhibition.test.ts`, using that file's own `resolvedRound` helper with `noContext: true` and setting the question to a crowd one the way the existing crowd case in that file does (search for `marketSource: "crowd"`):

```ts
describe("the channel on a past hot take (design 2026-09-25 §11)", () => {
  it("carries the log with the room's line, reactions and notes, and nothing on a market question", async () => {
    const { db } = await makeTestDb();
    const q = await resolvedRound(db, "2026-09-20", { noContext: true });
    await db.update(schema.questions).set({ marketSource: "crowd", crowdYesPct: "62", crowdCount: 41, outcome: "yes", resolvedAt: new Date("2026-09-21T16:01:00Z"), linePYes: "0.38", sourceName: "THE PLAYERS" }).where(eq(schema.questions.id, q.id));
    await db.insert(schema.lines).values({ questionId: q.id, member: "haiku", pYes: "0.31", committedAt: new Date("2026-09-20T13:00:00Z"), reasoning: "no chance" });
    await db.insert(schema.reactions).values({ questionId: q.id, member: "haiku", text: "ok", createdAt: new Date("2026-09-21T16:02:00Z") });
    const e = ExhibitionSchema.parse(await selectExhibition(db));
    expect(e.id).toBe(q.id);
    expect(e.log.map((l) => l.kind)).toEqual(["say", "system", "say"]);
    expect(e.log[1]!.text).toBe("THE ROOM AGREED · 62% · 41 PLAYERS");
    expect(e.log[0]!.tone).toBe("loss");
  });
});
```

Adjust `q` to however `resolvedRound` returns the first question in that file (it may return the rows array; use `[0]`).

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/exhibition.test.ts`
Expected: FAIL (`log` empty).

- [ ] **Step 3: Implement**

In `exhibition.ts`, import `buildLog, MODEL_MEMBER_IDS, type ModelMemberId` and `PIPELINE_LINES` is not needed (void never reaches here). Before `const projected`, when `crowd`:

```ts
    let log: ReturnType<typeof buildLog> = [];
    if (crowd) {
      const isModel = (m: string): m is ModelMemberId => (MODEL_MEMBER_IDS as readonly string[]).includes(m);
      const [lines, reactions, lessons] = await Promise.all([
        db.query.lines.findMany({ where: eq(schema.lines.questionId, question.id) }),
        db.query.reactions.findMany({ where: eq(schema.reactions.questionId, question.id) }),
        db.query.lessons.findMany({ where: eq(schema.lessons.questionId, question.id) }),
      ]);
      log = buildLog({
        lines: lines.filter((l) => isModel(l.member)).map((l) => ({ member: l.member as ModelMemberId, pYes: Number(l.pYes), reasoning: l.reasoning, committedAt: l.committedAt.toISOString() })),
        outcome: question.outcome,
        crowd: { yesPct: crowdYesPct, count: question.crowdCount, resolvedAt: question.resolvedAt?.toISOString() ?? null, voidReason: null },
        reactions: reactions.filter((r) => isModel(r.member)).map((r) => ({ member: r.member as ModelMemberId, text: r.text, createdAt: r.createdAt.toISOString() })),
        lessons: lessons.filter((l) => isModel(l.member)).map((l) => ({ member: l.member as ModelMemberId, text: l.text, createdAt: l.createdAt.toISOString() })),
      });
    }
```

and add `log,` to the `ExhibitionSchema.safeParse({...})` object.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run test/exhibition.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/exhibition.ts apps/api/test/exhibition.test.ts
git commit -m "feat(api): the channel on a past hot take

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

### Task 15: Full suite, docs, and the as-built section

**Files:**
- Modify: `docs/launch-playbook.md`, `docs/superpowers/specs/2026-09-25-nightshift-design.md`

- [ ] **Step 1: Run everything**

Run: `pnpm -r typecheck && (cd packages/core && pnpm vitest run) && (cd apps/mobile && pnpm vitest run) && (cd apps/api && pnpm vitest run && pnpm test:workflows)`
Expected: all green. Record the counts.

- [ ] **Step 2: Playbook**

In `docs/launch-playbook.md` §2 (backend deploy), add a step after the 0016 note:

```markdown
2. Apply `0017` to production: `cd apps/api && DATABASE_URL='<prod>' pnpm db:migrate`. `0017` is the night shift (design 2026-09-25 §10): `seen_on_label`, `seen_on_url` and `unhinged` on `questions`, and the `reactions` table. No data migration.
3. `wrangler.jsonc` now carries `CROWD_RESOLVE_MIN` (design 2026-09-25 N11). It is `3` while the field is a handful; the rule is 20. Raise it in one deploy once twenty players seal a round.
4. The first night on `opinion-v2` (design 2026-09-25 §4): read the Telegram draft for the `seen on` labels and the `[UNHINGED]` mark; `/reroll <slot> <guidance>` still works and searches. The Council commits at 09:00 as `council-v2`; reactions land at the first resolve tick after lock and print in the day report as `reactions: N written, M dropped`.
```

Renumber the following steps.

- [ ] **Step 3: As built**

Append to the spec:

```markdown
## 17. As built, plan 1 (the pipeline)

- **N5 amended.** `line_p_yes` stays on `GET /v1/round/today`, served only on the caller's own sealed questions. Build 12 prices its tray and receipt from it; removing it would have broken the live app the night this deployed. The leak is closed either way. Plan 2 removes the field once build 13 reads the log.
- **§8.1 window.** `GET /v1/standings` is all-time by default (`window: null`, the dataset) and takes `?days=N` for the windowed view; the 30-day board in §8.2 is plan 3's and reads the same loader with `since`.
- **§5.3 the gate.** Reactions run through `tasteTexts`, whose prompt screens "candidate questions"; its rules (derogatory, private individual, harm) are the ones that matter and it refuses on them. A reaction-specific gate prompt is a follow-up if refusals prove wrong-shaped.
- **§6.1 tie order.** `buildLog` sorts by instant and keeps insertion order on ties, so a reaction and a lesson written in the same second print reaction first.
- **§4.4 reroll.** A reroll keeps the slot's `unhinged` flag; a rerolled unhinged take is still the unhinged take. The reroll writes `seen_on` and never touches the flag.
- Migration `0017_nightshift`; suites at merge: core N, mobile N, api N (fill in from Step 1).
```

- [ ] **Step 4: Commit**

```bash
git add docs/launch-playbook.md docs/superpowers/specs/2026-09-25-nightshift-design.md
git commit -m "docs: night shift plan 1 rollout and as-built

Claude-Session: https://claude.ai/code/session_01QfJ2j2sSP4jacqTEkTbske"
```

---

## Self-review

**Spec coverage, plan 1 scope.** §4.1 sourcing, register, unhinged → Task 5. §4.2 draft fields → Tasks 3, 4. §4.4 reroll and narration → Task 5. §5.1 profiles → Task 1. §5.2 prompt and caps → Task 6. §5.3 reactions → Tasks 7, 8. §5.4 lessons register → Task 7. §6.1 log data → Task 2. §6.2 log route and `/today` → Task 11. §6.3 reveal payload → Task 12. §8.1 read rate → Tasks 1, 13. §8.3 floor → Task 9. §9 resolution unchanged plus the step → Task 8. §10 data → Task 3. §11 routes → Tasks 11–14. §6.5's `council_committed_at` → Task 11. Not in this plan, by design: §4.3 card caption, §6.4 ledger `room` block, §6.5 Home, §6.6 share card, §7 copy, §8.2 board, §12, §13 (plans 2 and 3).

**Placeholder scan.** Task 8 Step 1 asks the implementer to find or add the workflow step-order test; the assertion is stated. Task 14 Step 1 notes the helper's return shape must be checked. Task 15's counts are filled in at execution. No TBDs.

**Type consistency.** `buildLog` input shape is identical in Tasks 2, 11, 14. `MEMBER_PROFILE` keys and `title` strings match Tasks 1, 6, 7, 13. `ReactionsOutcome` matches Tasks 7 and 8. `crowdResolveMinOf(deps)` matches Tasks 9 and the resolve test. `TodayLogSchema` field names match Task 10 and 11.
