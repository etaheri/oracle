import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { schema } from "../src/db/client";
import { runOpinionRound, buildOpinionDraft, recentCrowdTexts, RECENT_DAYS } from "../src/pipeline/opinion-round";
import { upsertDraft, CROWD_RESOLUTION_CRITERIA } from "../src/pipeline/draft";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { StructuredCall } from "../src/pipeline/claude";
import { noonET, addDays } from "../src/pipeline/clock";

// Authoring runs at 17:00 ET the evening before (now is Sept 22, 21:05Z; the round is Sept 23).
const DATE = "2026-09-23";
const lock = noonET(addDays(DATE, 1));
const CATS = ["markets", "sports", "weather", "culture", "news"] as const;

function five(texts?: string[]) {
  return { questions: CATS.map((category, i) => ({ slot: i + 1, category, text: texts?.[i] ?? `Is take ${i + 1} the right one?` })) };
}

// A canned Claude: the opinion call answers five questions; the taste call allows everything unless told otherwise.
function claudeWith(opts: { refuse?: string[]; calls: StructuredCall[]; answer?: (call: StructuredCall, n: number) => unknown }) {
  let opinionCalls = 0;
  return {
    async structured(call: StructuredCall) {
      opts.calls.push(call);
      if (call.schemaName === "opinion_round") {
        opinionCalls += 1;
        return opts.answer ? opts.answer(call, opinionCalls) : five();
      }
      if (call.schemaName === "taste_verdicts") {
        const lines = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l));
        return { verdicts: lines.map((l, i) => ({ index: i, allowed: !(opts.refuse ?? []).some((r) => l.includes(r)), reason: "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function depsWith(claude: PipelineDeps["claude"], sent: string[]): Promise<PipelineDeps> {
  const { db } = await makeTestDb();
  return {
    db, telegram: { send: async (t) => { sent.push(t); } }, claude,
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", taste: "t", voice: "v" },
    now: () => new Date("2026-09-22T21:05:00Z"),
    workflows: inlineStarter(),
    roundKind: "opinion",
    siteUrl: "https://example.test",
    marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
  };
}

describe("runOpinionRound (design 2026-09-22 §4)", () => {
  it("commits a version 3 draft of five crowd questions from one voice call and one taste call, and narrates it", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const deps = await depsWith(claudeWith({ calls }), sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls.map((c) => c.schemaName)).toEqual(["opinion_round", "taste_verdicts"]);
    const voice = calls[0]!;
    expect(voice.model).toBe("v");
    expect(voice.webSearch).toBeUndefined();
    expect(voice.effort).toBe("low");
    expect(voice.system).toContain(DATE);
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)] });
    expect(qs.length).toBe(5);
    expect(qs.map((q) => q.category)).toEqual([...CATS]);
    for (const q of qs) {
      expect(q.marketSource).toBe("crowd");
      expect(q.marketId).toBe(DATE);
      expect(q.marketEventKey).toBe(String(q.slot));
      expect(q.marketClosesAt!.toISOString()).toBe(lock.toISOString());
      expect(q.resolutionCriteria).toBe(CROWD_RESOLUTION_CRITERIA);
      expect(q.sourceName).toBe("THE PLAYERS");
      expect(q.sourceUrl).toBe("https://example.test/play");
      expect(q.authorProb).toBe("0.5");
      expect(q.marketProb).toBeNull();
      expect(q.context).toBeNull();
      expect(q.isBigOne).toBe(q.slot === 5);
    }
    const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    expect(round!.candidatesWritten).toBe(0);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(`${DATE}: opinion round authored · 5 questions · categories markets, sports, weather, culture, news`);
    expect(sent[0]).toContain("1. [markets] Is take 1 the right one?");
  });

  it("passes the last 60 days of crowd texts to the prompt as the exclusion list", async () => {
    const calls: StructuredCall[] = [];
    const deps = await depsWith(claudeWith({ calls }), []);
    // A crowd round inside the window and one outside it.
    const inside = addDays(DATE, -30);
    const outside = addDays(DATE, -(RECENT_DAYS + 1));
    for (const [date, text] of [[inside, "Is pineapple fine on pizza?"], [outside, "Is a hot dog a sandwich?"]] as const) {
      await deps.db.insert(schema.rounds).values({ date, status: "resolved", rulesVersion: 3 });
      await deps.db.insert(schema.questions).values({
        roundDate: date, slot: 1, text, category: "culture", resolutionCriteria: CROWD_RESOLUTION_CRITERIA, sourceName: "THE PLAYERS",
        opensAt: noonET(date), locksAt: noonET(addDays(date, 1)), resolveBy: noonET(addDays(date, 1)), status: "resolved",
        marketSource: "crowd", marketId: date, marketEventKey: "1", marketClosesAt: noonET(addDays(date, 1)),
      });
    }
    expect(await recentCrowdTexts(deps.db, DATE)).toEqual(["Is pineapple fine on pizza?"]);
    await runOpinionRound(deps, DATE);
    expect(calls[0]!.user).toContain("Is pineapple fine on pizza?");
    expect(calls[0]!.user).not.toContain("Is a hot dog a sandwich?");
  });

  it("re-authors once naming the refused texts, then commits the clean set", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const claude = claudeWith({
      calls,
      refuse: ["Is take 2 the right one?"],
      answer: (_c, n) => (n === 1 ? five() : five(["Is take 1 the right one?", "Is a clean take 2 the right one?", "Is take 3 the right one?", "Is take 4 the right one?", "Is take 5 the right one?"])),
    });
    const deps = await depsWith(claude, sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls.map((c) => c.schemaName)).toEqual(["opinion_round", "taste_verdicts", "opinion_round", "taste_verdicts"]);
    expect(calls[2]!.user).toContain("Is take 2 the right one?");
    const q2 = await deps.db.query.questions.findFirst({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)], offset: 1 });
    expect(q2!.text).toBe("Is a clean take 2 the right one?");
  });

  it("falls through to the bank when the taste gate refuses on both passes", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const deps = await depsWith(claudeWith({ calls, refuse: ["take 2"] }), sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toBe("the taste gate refused a question on both passes");
    expect(await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) })).toBeUndefined();
    expect(sent[0]).toContain("no opinion round");
    expect(sent[0]).toContain("the bank covers noon");
  });

  it("rejects a set whose first four slots do not span four categories", async () => {
    const calls: StructuredCall[] = [];
    const deps = await depsWith(claudeWith({ calls, answer: () => ({ questions: (["markets", "markets", "weather", "culture", "news"] as const).map((category, i) => ({ slot: i + 1, category, text: `Is take ${i + 1} the right one?` })) }) }), []);
    await expect(buildOpinionDraft(deps, DATE)).rejects.toThrow(/four distinct categories/);
  });

  it("rejects a text over 120 characters, one without a question mark, one with an exclamation mark, and one opening with 'Do you think'", async () => {
    for (const bad of ["x".repeat(118) + "ok?", "Is this fine", "Is this fine!?", "Do you think this is fine?"]) {
      const deps = await depsWith(claudeWith({ calls: [], answer: () => five([bad, "Is take 2 the right one?", "Is take 3 the right one?", "Is take 4 the right one?", "Is take 5 the right one?"]) }), []);
      await expect(buildOpinionDraft(deps, DATE), bad).rejects.toThrow(/opinion: response failed validation/);
    }
  });

  it("leaves a round that is no longer editable alone", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const deps = await depsWith(claudeWith({ calls }), sent);
    await runOpinionRound(deps, DATE);
    await deps.db.update(schema.rounds).set({ status: "open" }).where(eq(schema.rounds.date, DATE));
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toBe("round not editable");
    expect(calls.length).toBe(2);
  });
});
