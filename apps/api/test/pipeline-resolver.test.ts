import { describe, expect, it } from "vitest";
import { makeTestDb } from "./helpers/db";
import { askResolver, settled, allowedDomainsFor, type ResolverVerdict } from "../src/pipeline/resolver";
import type { PipelineDeps } from "../src/pipeline";
import { inlineStarter } from "../src/pipeline/workflows";

function deps(db: PipelineDeps["db"], reply: unknown, seen: { call?: Record<string, unknown> } = {}): PipelineDeps {
  return {
    workflows: inlineStarter(),
    db,
    telegram: { send: async () => {} },
    claude: { structured: async (call) => { seen.call = call as unknown as Record<string, unknown>; return reply; } },
    models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
    now: () => new Date("2026-09-04T16:00:00Z"),
  };
}

const target = { text: "Will it?", resolutionCriteria: "per the page", sourceName: "SRC", sourceUrl: "https://www.example.com/x", opensAt: "2026-09-10T16:00:00.000Z", now: "2026-09-12T02:00:00.000Z" };

describe("allowedDomainsFor", () => {
  it("strips www and returns one hostname", () => {
    expect(allowedDomainsFor("https://www.example.com/x")).toEqual(["example.com"]);
  });
  it("returns undefined for a null or unparseable url, so search runs unrestricted", () => {
    expect(allowedDomainsFor(null)).toBeUndefined();
    expect(allowedDomainsFor("not a url")).toBeUndefined();
  });
});

describe("askResolver", () => {
  it("restricts the search to the source's own hostname and uses the model it was handed", async () => {
    const { db } = await makeTestDb();
    const seen: { call?: Record<string, unknown> } = {};
    await askResolver(deps(db, { outcome: "unverifiable", quotes: [], reasoning: "nothing yet" }, seen), "model-x", target);
    expect(seen.call!.model).toBe("model-x");
    expect((seen.call!.webSearch as { allowedDomains?: string[] }).allowedDomains).toEqual(["example.com"]);
  });

  it("collapses an unparseable response to unverifiable rather than throwing", async () => {
    const { db } = await makeTestDb();
    const v = await askResolver(deps(db, { nonsense: true }), "model-x", target);
    expect(v.outcome).toBe("unverifiable");
    expect(v.quotes).toEqual([]);
  });
});

describe("settled — the one definition of 'the answer exists'", () => {
  const v = (o: ResolverVerdict["outcome"], quotes: ResolverVerdict["quotes"]): ResolverVerdict => ({ outcome: o, quotes, reasoning: "" });
  const q = [{ url: "https://example.com/x", quote: "it happened" }];
  it("is the outcome when yes or no arrives WITH receipts", () => {
    expect(settled(v("yes", q))).toBe("yes");
    expect(settled(v("no", q))).toBe("no");
  });
  it("is null for unverifiable, and for a ruling with no receipts", () => {
    expect(settled(v("unverifiable", q))).toBeNull();
    expect(settled(v("yes", []))).toBeNull();
    expect(settled(v("no", []))).toBeNull();
  });
});

describe("askResolver date anchors", () => {
  it("anchors the resolver in time: the current instant, the open instant, and the different-event rule (design 2026-09-11 §10)", async () => {
    const { db } = await makeTestDb();
    interface StructuredCall {
      system: string;
      user?: string;
      model?: string;
      schemaName?: string;
      schema?: unknown;
      webSearch?: unknown;
    }
    const calls: StructuredCall[] = [];
    const testDeps: PipelineDeps = {
      workflows: inlineStarter(),
      db,
      telegram: { send: async () => {} },
      claude: {
        structured: async (c) => {
          calls.push(c as StructuredCall);
          return { outcome: "unverifiable", quotes: [], reasoning: "" };
        },
      },
      models: { author: "m-a", resolve: "m-r", resolveB: "m-rb", forecast: "m-f", taste: "m-t", voice: "m-v" },
      now: () => new Date("2026-09-04T16:00:00Z"),
    };
    await askResolver(testDeps, "m-r", { text: "Will the 49ers beat the Rams?", resolutionCriteria: "Final score per NFL.com", sourceName: "NFL.com", sourceUrl: "https://www.nfl.com/x", opensAt: "2026-09-10T16:00:00.000Z", now: "2026-09-12T02:00:00.000Z" });
    const s = calls[0]!.system;
    expect(s).toContain("It is now 2026-09-12T02:00:00.000Z.");
    expect(s).toContain("This question opened at 2026-09-10T16:00:00.000Z.");
    expect(s).toContain("before the open instant describes a different event");
  });
});
