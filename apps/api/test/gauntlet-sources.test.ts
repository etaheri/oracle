import { describe, expect, it } from "vitest";
import { checkSources } from "../src/pipeline/gauntlet/sources";
import type { Candidate } from "../src/pipeline/candidate";

const cand = (url: string, text = "Will it?"): Candidate => ({
  category: "news", text, resolution_criteria: "per the page",
  source_name: "SRC", source_url: url, author_probability: 0.5,
  market_prob: null, resolves_at: "2026-09-05T14:00:00Z", topic_key: "k-" + url.length,
});

describe("checkSources — tier 1", () => {
  it("passes a source that answers 2xx", async () => {
    const fetchFn = (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/a")]);
    expect(r.passed).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it("rejects a 404 — a well-formed url that leads nowhere", async () => {
    const fetchFn = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/gone")]);
    expect(r.passed).toHaveLength(0);
    expect(r.rejected[0]!.reason).toBe("dead-source");
    expect(r.rejected[0]!.detail).toContain("404");
  });

  it("rejects a source that throws, including a timeout", async () => {
    const fetchFn = (async () => { throw new Error("The operation was aborted due to timeout"); }) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/slow")]);
    expect(r.rejected[0]!.reason).toBe("dead-source");
    expect(r.rejected[0]!.detail).toContain("timeout");
  });

  it("judges each candidate independently — one dead source never sinks the batch", async () => {
    const fetchFn = (async (input: RequestInfo | URL) =>
      String(input).includes("gone") ? new Response("", { status: 500 }) : new Response("", { status: 200 })
    ) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/ok", "A?"), cand("https://example.com/gone", "B?")]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?"]);
    expect(r.rejected.map((x) => x.text)).toEqual(["B?"]);
  });

  it("preserves candidate order among survivors", async () => {
    const fetchFn = (async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const r = await checkSources(fetchFn, [cand("https://example.com/1", "A?"), cand("https://example.com/2", "B?"), cand("https://example.com/3", "C?")]);
    expect(r.passed.map((c) => c.text)).toEqual(["A?", "B?", "C?"]);
  });
});
