import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import { schema } from "../src/db/client";
import type { PipelineDeps } from "../src/pipeline";
import type { StructuredCall } from "../src/pipeline/claude";
import { inlineStarter } from "../src/pipeline/workflows";
import { runOpinionRound } from "../src/pipeline/opinion-round";
import { commitMember } from "../src/pipeline/council/member";
import { runCouncil, isCrowdRound } from "../src/pipeline/council";

const DATE = "2026-09-23";
const NOW = new Date("2026-09-23T13:00:00Z"); // 09:00 ET on the round date
const CATS = ["markets", "sports", "weather", "culture", "news"] as const;

function claude(calls: StructuredCall[], p: (member: string, slot: number) => number) {
  return {
    async structured(call: StructuredCall) {
      calls.push(call);
      if (call.schemaName === "opinion_round") return { questions: CATS.map((category, i) => ({ slot: i + 1, category, text: `Is take ${i + 1} the right one?` })) };
      if (call.schemaName === "taste_verdicts") return { verdicts: [0, 1, 2, 3, 4].map((index) => ({ index, allowed: true, reason: "" })) };
      if (call.schemaName === "council_lines") return { lines: [1, 2, 3, 4, 5].map((slot) => ({ slot, p_yes: p(call.model, slot), reasoning: `The room leans ${slot}.`, cited: [1] })) };
      throw new Error(`unexpected call ${call.schemaName}`);
    },
  };
}

async function world(p: (member: string, slot: number) => number = () => 0.4) {
  const { db } = await makeTestDb();
  const calls: StructuredCall[] = [];
  const sent: string[] = [];
  let exaCalls = 0;
  const deps: PipelineDeps = {
    db, telegram: { send: async (t) => { sent.push(t); } }, claude: claude(calls, p),
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", taste: "t", voice: "v" },
    councilModels: { sonnet: "m-sonnet", opus: "m-opus", haiku: "m-haiku" },
    now: () => new Date("2026-09-22T21:05:00Z"), workflows: inlineStarter(), roundKind: "opinion",
    exaApiKey: "exa-key",
    exaFetch: (async () => { exaCalls += 1; return new Response(JSON.stringify({ results: [] }), { status: 200 }); }) as unknown as typeof fetch,
    marketFetch: (async () => { throw new Error("no network in tests"); }) as unknown as typeof fetch,
  };
  await runOpinionRound(deps, DATE);
  calls.length = 0; sent.length = 0;
  deps.now = () => NOW;
  return { deps, calls, sent, exa: () => exaCalls };
}

describe("the Council on a crowd round (design 2026-09-22 §5)", () => {
  it("recognises a crowd round", async () => {
    const { deps } = await world();
    expect(await isCrowdRound(deps, DATE)).toBe(true);
    expect(await isCrowdRound(deps, "2026-01-01")).toBe(false);
  });

  it("asks each member for the share of players who will say YES, with no price, no criteria and no evidence", async () => {
    const { deps, calls } = await world();
    const r = await commitMember(deps, DATE, "sonnet");
    expect(calls.length).toBe(1);
    const c = calls[0]!;
    expect(c.model).toBe("m-sonnet");
    expect(c.webSearch).toBeUndefined();
    expect(c.schemaName).toBe("council_lines");
    expect(c.system).toContain(DATE);
    expect(c.system).toContain(NOW.toISOString());
    expect(c.system).toContain("share of players who will answer YES");
    expect(c.system).toContain("general US audience on their phones at lunchtime");
    expect(c.system).not.toContain("evidence");
    expect(c.user).toContain("[slot 1] Is take 1 the right one?");
    expect(c.user).toContain("[slot 5 · THE BIG ONE] Is take 5 the right one?");
    expect(c.user).not.toContain("RESOLVES BY");
    expect(c.user).not.toContain("THE MARKET'S PRICE");
    expect(c.user).not.toContain("EVIDENCE");
    expect(r.lines.length).toBe(5);
    // cited is always empty on a crowd question: there is no pack to cite.
    expect(r.lines.every((l) => l.cited.length === 0)).toBe(true);
  });

  it("skips evidence, writes no market row and commits the unclamped median as the line", async () => {
    const byMember: Record<string, number> = { "m-sonnet": 0.15, "m-opus": 0.22, "m-haiku": 0.9 };
    const { deps, calls, sent, exa } = await world((model) => byMember[model]!);
    const run = await runCouncil(deps, DATE);
    expect(run.editable).toBe(true);
    expect(run.evidence).toBeNull();
    expect(exa()).toBe(0);
    expect(calls.map((c) => c.schemaName)).toEqual(["council_lines", "council_lines", "council_lines"]);
    expect(run.commit!.committed).toBe(true);
    expect(run.commit!.lines).toBe(15);
    const lines = await deps.db.query.lines.findMany();
    expect(lines.length).toBe(15);
    expect(lines.some((l) => l.member === "market")).toBe(false);
    const qs = await deps.db.query.questions.findMany({ where: eq(schema.questions.roundDate, DATE) });
    // Median of 0.15, 0.22, 0.9 is 0.22; a market band would have clamped
    // nothing here because there is no market, and the global band is 0.05–0.95.
    for (const q of qs) {
      expect(Number(q.oracleProbYes)).toBeCloseTo(0.22, 6);
      expect(Number(q.linePYes)).toBeCloseTo(0.22, 6);
    }
    expect(await deps.db.query.evidence.findMany()).toEqual([]);
    expect(sent.length).toBe(1);
    expect(sent[0]).toContain(`council ${DATE}: 15 lines committed`);
    expect(sent[0]).toContain("slot 1: sonnet 15 · opus 22 · haiku 90 → median 22, line 22");
    expect(sent[0]).not.toContain("market");
    expect(sent[0]).not.toContain("exa $");
    expect(sent[0]).not.toContain("item");
  });
});
