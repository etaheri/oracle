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

function claude(calls: StructuredCall[], replacement: { category: string; text: string }, refuse = false) {
  return {
    async structured(call: StructuredCall) {
      calls.push(call);
      if (call.schemaName === "opinion_round") return { questions: CATS.map((category, i) => ({ slot: i + 1, category, text: `Is take ${i + 1} the right one?` })) };
      if (call.schemaName === "opinion_question") return replacement;
      if (call.schemaName === "taste_verdicts") {
        const n = call.user.split("\n").filter((l) => /^\[\d+\]/.test(l)).length;
        return { verdicts: Array.from({ length: n }, (_, index) => ({ index, allowed: !(refuse && call.user.includes(replacement.text)), reason: refuse ? "derogatory" : "" })) };
      }
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function world(replacement: { category: string; text: string }, refuse = false) {
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
    const { deps, calls, sent } = await world({ category: "news", text: "Is a rerolled take the right one?" });
    await rerollSlot(deps, DATE, 2, "flat");
    expect(calls.map((c) => c.schemaName)).toEqual(["opinion_question", "taste_verdicts"]);
    expect(calls[0]!.model).toBe("v");
    expect(calls[0]!.webSearch).toBeUndefined();
    expect(calls[0]!.system).toContain("flat");
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 2)) });
    expect(q!.text).toBe("Is a rerolled take the right one?");
    expect(q!.category).toBe("sports"); // the slot keeps its category; only the Big One may move
    expect(q!.marketSource).toBe("crowd");
    expect(q!.marketEventKey).toBe("2");
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain("Is a rerolled take the right one?");
  });
  it("lets the Big One take the model's category", async () => {
    const { deps } = await world({ category: "culture", text: "Is a rerolled big one the right one?" });
    await rerollSlot(deps, DATE, 5, "");
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 5)) });
    expect(q!.category).toBe("culture");
    expect(q!.isBigOne).toBe(true);
  });
  it("refuses a replacement the taste gate refuses and leaves the slot as it was", async () => {
    const { deps } = await world({ category: "news", text: "Is a rude take the right one?" }, true);
    await expect(rerollSlot(deps, DATE, 2, "")).rejects.toThrow(/taste gate refused/);
    const q = await deps.db.query.questions.findFirst({ where: and(eq(schema.questions.roundDate, DATE), eq(schema.questions.slot, 2)) });
    expect(q!.text).toBe("Is take 2 the right one?");
  });
  it("refuses once the round has published", async () => {
    const { deps } = await world({ category: "news", text: "Is a late take the right one?" });
    await deps.db.update(schema.questions).set({ status: "open" }).where(eq(schema.questions.roundDate, DATE));
    await expect(rerollSlot(deps, DATE, 2, "")).rejects.toThrow(/already published/);
  });
});
