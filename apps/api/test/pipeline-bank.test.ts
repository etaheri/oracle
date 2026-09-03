// Track D (spec §5): the evergreen bank refills itself. publishFromBank burns
// an entry per use and POST /admin/bank was the only writer, so the promise
// "the drop never depends on the agent being alive" held exactly as long as
// the buffer lasted. These cover the 03:00 refill decision, the evergreen
// author, and the low-water warning.
import { describe, expect, it } from "vitest";
import { isNull } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { decideActions, BANK_LOW_WATER, type PipelineState } from "../src/pipeline/state";
import { authorBankEntry } from "../src/pipeline/author";
import { runTick, type PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import * as schema from "../src/db/schema";

const empty: PipelineState = { openRound: null, lockedRound: null, scheduledDates: [], bankCount: 0, claudeAvailable: true };
const at = (hour: number, minute = 0) => ({ date: "2026-08-27", hour, minute });
const alerts = (acts: ReturnType<typeof decideActions>) => acts.filter((a) => a.kind === "alert");

function fakeClaude(responses: unknown[]) {
  const calls: StructuredCall[] = [];
  const claude: ClaudeClient = {
    async structured(call) {
      calls.push(call);
      if (responses.length === 0) throw new Error("no more fake responses queued");
      return responses.shift();
    },
  };
  return { claude, calls };
}

function fakeDeps(db: PipelineDeps["db"], claude: ClaudeClient | null, nowIso = "2026-08-27T07:00:00Z") {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db,
    claude,
    models: { author: "m-a", resolve: "m-r", forecast: "m-f" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date(nowIso),
    marketFetch: (async () => { throw new Error("no market feeds in tests"); }) as unknown as typeof fetch,
  };
  return { deps, sent };
}

const datedDraft = {
  questions: validDraft.questions.map((q) => (q.slot === 1 ? { ...q, resolves_at: "2026-08-28T15:00:00Z" } : q)),
};

describe("decideActions — author-bank", () => {
  it("refills at 03:00 only while the bank is under the low-water mark", () => {
    expect(decideActions(at(3, 0), { ...empty, bankCount: BANK_LOW_WATER - 1 })).toEqual([{ kind: "author-bank" }]);
    expect(decideActions(at(3, 9), { ...empty, bankCount: 0 })).toEqual([{ kind: "author-bank" }]);
    // At the mark, and above it, the buffer is deep enough.
    expect(decideActions(at(3, 0), { ...empty, bankCount: BANK_LOW_WATER })).toEqual([]);
    expect(decideActions(at(3, 0), { ...empty, bankCount: BANK_LOW_WATER + 4 })).toEqual([]);
  });

  it("fires at most once a day: only the 03:00 hour, only the first ten minutes", () => {
    const low = { ...empty, bankCount: 1 };
    expect(decideActions(at(3, 10), low)).toEqual([]);
    expect(decideActions(at(3, 59), low)).toEqual([]);
    expect(decideActions(at(2, 0), low)).toEqual([]);
    expect(decideActions(at(4, 0), low)).toEqual([]);
  });

  it("never collides with the 17:00 authoring window or the noon drop", () => {
    // The bank is thin at both, and neither hour refills it: 17:00 authors
    // tomorrow, noon drops today.
    const low = { ...empty, bankCount: 1, scheduledDates: ["2026-08-27"] };
    expect(decideActions(at(17, 0), low).map((a) => a.kind)).toEqual(["publish", "author"]);
    expect(decideActions(at(12, 0), low).map((a) => a.kind)).toEqual(["publish"]);
    // And the 03:00 tick touches nothing else.
    expect(decideActions(at(3, 0), { ...low, scheduledDates: ["2026-08-27", "2026-08-28"] })).toEqual([
      { kind: "author-bank" },
    ]);
  });
});

describe("decideActions — the low-water warning", () => {
  it("warns at 23:00 when the bank is thin, and stays quiet at the mark", () => {
    const tomorrowDrafted = { ...empty, scheduledDates: ["2026-08-28"] };
    const warn = alerts(decideActions(at(23, 0), { ...tomorrowDrafted, bankCount: 3 }));
    expect(warn).toEqual([expect.objectContaining({ level: "warn" })]);
    expect((warn[0] as { message: string }).message).toContain("3");
    expect(alerts(decideActions(at(23, 0), { ...tomorrowDrafted, bankCount: BANK_LOW_WATER }))).toEqual([]);
    // Throttled to the same one-tick-an-hour window as every other alert.
    expect(alerts(decideActions(at(23, 30), { ...tomorrowDrafted, bankCount: 1 }))).toEqual([]);
  });

  it("is distinct from the empty-bank critical, and never doubles it", () => {
    // Nothing for tomorrow and nothing in the bank: the critical already says
    // it, once. A second line about the same emptiness is noise.
    const acts = alerts(decideActions(at(23, 0), empty));
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ level: "critical" });

    // Nothing for tomorrow but a thin bank: two different facts, two lines —
    // tomorrow's drop is covered, and the buffer behind it is running out.
    const both = alerts(decideActions(at(23, 0), { ...empty, bankCount: 2 }));
    expect(both).toHaveLength(2);
    expect(both.every((a) => a.kind === "alert" && a.level === "warn")).toBe(true);
    const messages = both.map((a) => (a as { message: string }).message);
    expect(messages.some((m) => m.includes("no draft for tomorrow"))).toBe(true);
    expect(messages.some((m) => m.includes("evergreen bank"))).toBe(true);
    expect(new Set(messages).size).toBe(2);
  });
});

describe("authorBankEntry", () => {
  it("throws when there is no claude client", async () => {
    const { db } = await makeTestDb();
    const { deps } = fakeDeps(db, null);
    await expect(authorBankEntry(deps)).rejects.toThrow("pipeline: no claude client");
  });

  it("banks a valid evergreen draft and narrates the new count", async () => {
    const { db } = await makeTestDb();
    await db.insert(schema.draftBank).values({ draft: validDraft });
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await authorBankEntry(deps);

    expect(calls).toHaveLength(1);
    const rows = await db.query.draftBank.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.usedOn === null)).toBe(true);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("2 in the bank");
    for (const q of validDraft.questions) expect(sent[0]).toContain(q.text);
  });

  it("refuses a draft carrying a dated resolves_at, retries once, and banks nothing", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([datedDraft, datedDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await expect(authorBankEntry(deps)).rejects.toThrow(/after-lock/);

    expect(calls).toHaveLength(2);
    expect(calls[1]!.user).toContain("failed validation");
    // The bank must not be poisonable by its own author: nothing was written,
    // so publishFromBank's poison-skip never has to be the first line of
    // defence for an entry we made ourselves.
    expect(await db.query.draftBank.findMany()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it("recovers when the retry comes back clean", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([datedDraft, validDraft]);
    const { deps, sent } = fakeDeps(db, claude);

    await authorBankEntry(deps);

    expect(calls).toHaveLength(2);
    const rows = await db.query.draftBank.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.draft).toEqual(validDraft);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("1 in the bank");
  });

  it("asks for an evergreen round: after-lock only, no weather, no dates", async () => {
    const { db } = await makeTestDb();
    const { claude, calls } = fakeClaude([validDraft]);
    const { deps } = fakeDeps(db, claude);

    await authorBankEntry(deps);

    const system = calls[0]!.system;
    expect(system).toContain("after-lock");
    expect(system.toLowerCase()).toContain("never weather");
    // Date-agnostic: the entry publishes on a date nobody knows yet.
    expect(system.toLowerCase()).toContain("you do not know what date");
    // The rest of the authoring contract is unchanged.
    expect(system).toContain("0.30 and 0.70");
    expect(system).toContain("FORBIDDEN");
    expect(system).toContain("THE BIG ONE");
    expect(system).toContain("ONE named public source");
    // The prompt itself must not carry a concrete date to copy.
    expect(system).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe("runTick — author-bank", () => {
  it("refills the bank on a 03:00 tick and reports the action", async () => {
    const { db } = await makeTestDb();
    const { claude } = fakeClaude([validDraft]);
    // 03:00 ET on 2026-08-27 is 07:00 UTC (EDT, UTC-4).
    const { deps, sent } = fakeDeps(db, claude, "2026-08-27T07:00:00Z");

    const done = await runTick(deps);

    expect(done).toContain("author-bank");
    const unused = await db.query.draftBank.findMany({ where: isNull(schema.draftBank.usedOn) });
    expect(unused).toHaveLength(1);
    expect(sent.some((t) => t.includes("1 in the bank"))).toBe(true);
  });

  it("a failed refill is narrated, not fatal to the tick", async () => {
    const { db } = await makeTestDb();
    const { claude } = fakeClaude([datedDraft, datedDraft]);
    const { deps, sent } = fakeDeps(db, claude, "2026-08-27T07:00:00Z");

    const done = await runTick(deps);

    expect(done).not.toContain("author-bank");
    expect(await db.query.draftBank.findMany()).toHaveLength(0);
    expect(sent.some((t) => t.includes("author-bank failed"))).toBe(true);
  });
});
