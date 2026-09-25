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
async function resolved(outcome: "yes" | "no" | "void" = "yes", opts: { crowd?: boolean; version?: number; opusPYes?: string } = {}) {
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
    { questionId: q.id, member: "opus", pYes: opts.opusPYes ?? "0.70", committedAt: new Date("2026-09-25T13:00:00Z"), model: "m", promptVersion: "council-v2", reasoning: "Four reasons." },
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
    expect(reactions.map((c) => c.system.match(/You are (\w+)/)![1])).toEqual(["SONNET", "HAIKU"]);
    expect(reactions[1]!.system).toContain("night shift");
    expect(reactions[0]!.system).toContain("Never a player");
    expect(reactions[0]!.user).toContain("cereal is a soup");
    expect(reactions[1]!.user).toContain("YOUR LINE: 31% agree");
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
    // outcome NO: haiku 0.31 and sonnet 0.44 are right; opus at 0.5 is neither.
    const { db, q } = await resolved("no", { opusPYes: "0.5" });
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
