import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { schema } from "../src/db/client";
import { runOpinionRound } from "../src/pipeline/opinion-round";
import { rerollSlot } from "../src/pipeline/author";
import { inlineStarter } from "../src/pipeline/workflows";
import type { PipelineDeps } from "../src/pipeline";
import type { StructuredCall } from "../src/pipeline/claude";

const DATE = "2026-09-23";
const CATS = ["markets", "sports", "weather", "culture", "news"] as const;
const TAKES = ["a car payment is a personality trait", "the nfl is better on the radio", "fall is the worst season and everyone is lying", "cereal is a soup", "nobody actually likes going to the airport early"];

type Replacement = { category: string; text: string; seen_on: { label: string; url: string | null } | null };

function claude(calls: StructuredCall[], replacement: Replacement, refuse = false) {
  return {
    async structured(call: StructuredCall) {
      calls.push(call);
      if (call.schemaName === "opinion_round") return { questions: CATS.map((category, i) => ({ slot: i + 1, category, text: TAKES[i]!, unhinged: i + 1 === 4, seen_on: null })) };
      if (call.schemaName === "opinion_question") return replacement;
      if (call.schemaName === "taste_verdicts") {
        const n = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l)).length;
        return { verdicts: Array.from({ length: n }, (_, index) => ({ index, allowed: !(refuse && call.user.includes(replacement.text)), reason: refuse ? "derogatory" : "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function world(replacement: Replacement, refuse = false) {
  const { db } = await makeTestDb();
  const calls: StructuredCall[] = [];
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db, telegram: { send: async (t) => { sent.push(t); } }, claude: claude(calls, replacement, refuse),
    models: { author: "opus", resolve: "r", resolveB: "rb", forecast: "f", taste: "t", voice: "v" },
    now: () => new Date("2026-09-22T21:05:00Z"), workflows: inlineStarter(), roundKind: "opinion",
    marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
  };
  await runOpinionRound(deps, DATE);
  calls.length = 0; sent.length = 0;
  return { deps, calls, sent };
}

describe("/reroll on a crowd slot (design 2026-09-22 §13)", () => {
  it("replaces the text with one voice call in the slot's own category, never the author model, and keeps the crowd columns", async () => {
    const { deps, calls, sent } = await world({ category: "news", text: "a rerolled take is the right one", seen_on: null });
    await rerollSlot(deps, DATE, 2, "flat");
    expect(calls.map((c) => c.schemaName)).toEqual(["opinion_question", "taste_verdicts"]);
    expect(calls[0]!.model).toBe("v");
    expect(calls[0]!.webSearch).toEqual({ maxUses: 4 });
    expect(calls[0]!.system).toContain("flat");
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 2)) });
    expect(q!.text).toBe("a rerolled take is the right one");
    expect(q!.category).toBe("sports"); // the slot keeps its category; only the Big One may move
    expect(q!.marketSource).toBe("crowd");
    expect(q!.marketEventKey).toBe("2");
    expect(sent.length).toBe(2);
    expect(sent[0]).toContain("a rerolled take is the right one");
    expect(sent[1]).toMatch(/^provenance: /);
  });
  it("lets the Big One take the model's category", async () => {
    const { deps } = await world({ category: "culture", text: "a rerolled big one is the right one", seen_on: null });
    await rerollSlot(deps, DATE, 5, "");
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 5)) });
    expect(q!.category).toBe("culture");
    expect(q!.isBigOne).toBe(true);
  });
  it("refuses a replacement the taste gate refuses and leaves the slot as it was", async () => {
    const { deps } = await world({ category: "news", text: "a rude take is the right one", seen_on: null }, true);
    await expect(rerollSlot(deps, DATE, 2, "")).rejects.toThrow(/taste gate refused/);
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 2)) });
    expect(q!.text).toBe(TAKES[1]);
  });
  it("refuses once the round has published", async () => {
    const { deps } = await world({ category: "news", text: "a late take is the right one", seen_on: null });
    await deps.db.update(schema.questions).set({ status: "open" }).where(eq(schema.questions.roundDate, DATE));
    await expect(rerollSlot(deps, DATE, 2, "")).rejects.toThrow(/already published/);
  });
});

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

  it("tells the voice when the slot is THE UNHINGED ONE, and does not on other slots", async () => {
    const unhinged = await world({ category: "culture", text: "cereal is definitely a soup", seen_on: null });
    await rerollSlot(unhinged.deps, DATE, 4, "");
    const unhingedVoice = unhinged.calls.find((c) => c.schemaName === "opinion_question")!;
    expect(unhingedVoice.system).toContain("THE UNHINGED ONE");

    const plain = await world({ category: "markets", text: "a rerolled take is the right one", seen_on: null });
    await rerollSlot(plain.deps, DATE, 1, "");
    const plainVoice = plain.calls.find((c) => c.schemaName === "opinion_question")!;
    expect(plainVoice.system).not.toContain("THE UNHINGED ONE");
  });

  it("sends the provenance line after the reroll, with the unhinged slot marked", async () => {
    const { deps, sent } = await world({ category: "markets", text: "a car payment is a personality trait", seen_on: { label: "r/personalfinance", url: null } });
    // Slot 4 is the fixture's unhinged slot; give it a seen-on directly so the
    // provenance line has something real to report for it.
    await deps.db.update(schema.questions).set({ seenOnLabel: "the replies" }).where(and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 4)));
    await rerollSlot(deps, DATE, 1, "");
    expect(sent.length).toBe(2);
    expect(sent[1]).toBe("provenance: 1. seen on r/personalfinance · 2. — · 3. — · 4. [UNHINGED] seen on the replies · 5. —");
  });
});
