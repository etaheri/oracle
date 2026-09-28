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
    expect(voice.webSearch).toEqual({ maxUses: 8 });
    expect(voice.effort).toBe("low");
    expect(voice.system).toContain(DATE);
    expect(voice.system).toContain("Search first");
    expect(voice.system).toContain("r/AmItheAsshole");
    expect(voice.system).toContain("people who post");
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
      expect(q.unhinged).toBe(q.slot === 4);
      expect(q.seenOnLabel).toBe(q.slot === 2 ? "the replies" : "r/unpopularopinion");
      expect(q.seenOnUrl).toBe(q.slot === 2 ? null : `https://reddit.com/r/unpopularopinion/t${q.slot - 1}`);
    }
    const round = await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) });
    expect(round!.rulesVersion).toBe(3);
    expect(round!.candidatesWritten).toBe(0);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(`${DATE}: opinion round authored · 5 questions · categories markets, sports, weather, culture, news`);
    expect(sent[0]).toContain("1. [markets] a car payment is a personality trait · seen on r/unpopularopinion");
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
      refuse: [TAKES[1]!],
      answer: (_c, n) => (n === 1 ? five() : five(["take 1 is the right one", "a clean take 2 is the right one", "take 3 is the right one", "take 4 is the right one", "take 5 is the right one"])),
    });
    const deps = await depsWith(claude, sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(true);
    expect(calls.map((c) => c.schemaName)).toEqual(["opinion_round", "taste_verdicts", "opinion_round", "taste_verdicts"]);
    expect(calls[2]!.user).toContain(TAKES[1]);
    const q2 = await deps.db.query.questions.findFirst({ where: eq(schema.questions.roundDate, DATE), orderBy: (q, { asc }) => [asc(q.slot)], offset: 1 });
    expect(q2!.text).toBe("a clean take 2 is the right one");
  });

  it("falls through to the bank when the taste gate refuses on both passes", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const deps = await depsWith(claudeWith({ calls, refuse: ["nfl"] }), sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toBe("the taste gate refused a question on both passes");
    expect(await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) })).toBeUndefined();
    expect(sent[0]).toContain("no opinion round");
    expect(sent[0]).toContain("the bank covers noon");
  });

  it("fails validation twice, and gives up, on a set whose first four slots do not span four categories", async () => {
    const calls: StructuredCall[] = [];
    const deps = await depsWith(claudeWith({ calls, answer: () => ({ questions: (["markets", "markets", "weather", "culture", "news"] as const).map((category, i) => ({ slot: i + 1, category, text: `take ${i + 1} is the right one`, unhinged: i + 1 === 4, seen_on: null })) }) }), []);
    const { draft, reason } = await buildOpinionDraft(deps, DATE);
    expect(draft).toBeNull();
    expect(reason).toMatch(/failed validation twice/);
    expect(reason).toMatch(/four distinct categories/);
    expect(calls.filter((c) => c.schemaName === "opinion_round").length).toBe(2);
  });

  // A malformed voice response no longer throws the whole night away (a
  // single Zod failure used to burn the Workflow's retries and skip
  // narrate entirely): a bad response is an expected outcome the retry loop
  // in buildOpinionDraft handles, naming the issue in the re-ask and giving
  // up on a second failure of either kind.
  it("rejects a text over 120 characters and one with an exclamation mark -- failing validation twice and giving up", async () => {
    for (const bad of ["x".repeat(121), "this take is fine!"]) {
      const deps = await depsWith(claudeWith({ calls: [], answer: () => five([bad, "take 2 is the right one", "take 3 is the right one", "take 4 is the right one", "take 5 is the right one"]) }), []);
      const { draft, reason } = await buildOpinionDraft(deps, DATE);
      expect(draft, bad).toBeNull();
      expect(reason, bad).toMatch(/failed validation twice/);
    }
  });

  it("re-asks once after a validation failure, naming the issue in the second call's prompt, then commits", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const bad121 = "x".repeat(120) + "?"; // 121 characters, over the 120 max
    const claude = claudeWith({
      calls,
      answer: (_c, n) => (n === 1 ? five([bad121, "take 2 is the right one", "take 3 is the right one", "take 4 is the right one", "take 5 is the right one"]) : five()),
    });
    const deps = await depsWith(claude, sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(true);
    const opinionCalls = calls.filter((c) => c.schemaName === "opinion_round");
    expect(opinionCalls.length).toBe(2);
    expect(opinionCalls[1]!.user).toContain("Your previous set failed validation:");
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    expect(qs.length).toBe(5);
  });

  it("gives up after two validation failures, tells the bank story and writes no round", async () => {
    const calls: StructuredCall[] = [];
    const sent: string[] = [];
    const bad121 = "x".repeat(120) + "?";
    const claude = claudeWith({ calls, answer: () => five([bad121, "take 2 is the right one", "take 3 is the right one", "take 4 is the right one", "take 5 is the right one"]) });
    const deps = await depsWith(claude, sent);
    const r = await runOpinionRound(deps, DATE);
    expect(r.published).toBe(false);
    expect(r.reason).toMatch(/failed validation twice/);
    expect(await deps.db.query.rounds.findFirst({ where: eq(schema.rounds.date, DATE) })).toBeUndefined();
    expect(sent[0]).toContain("no opinion round");
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
