import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeTestDb } from "./helpers/db";
import * as schema from "../src/db/schema";
import { recordUsage } from "../src/pipeline/usage";
import { makeClaudeClient } from "../src/pipeline/claude";

describe("recordUsage", () => {
  it("accumulates per (date, model) in one atomic statement", async () => {
    const { db } = await makeTestDb();
    await recordUsage(db, "2026-09-08", { model: "opus", inputTokens: 10, outputTokens: 5, webSearches: 1 });
    await recordUsage(db, "2026-09-08", { model: "opus", inputTokens: 3, outputTokens: 2, webSearches: 0 });
    await recordUsage(db, "2026-09-08", { model: "haiku", inputTokens: 1, outputTokens: 1, webSearches: 0 });

    const rows = await db.select().from(schema.pipelineUsage);
    const opus = rows.find((r) => r.model === "opus")!;
    expect(opus.calls).toBe(2);
    expect(opus.inputTokens).toBe(13);
    expect(opus.outputTokens).toBe(7);
    expect(opus.webSearches).toBe(1);
    expect(rows.find((r) => r.model === "haiku")!.calls).toBe(1);
  });
});

describe("makeClaudeClient onUsage", () => {
  it("reports usage without changing what structured() returns", async () => {
    const seen: unknown[] = [];
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", name: "s", input: { ok: true } }],
          usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2 } },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const client = makeClaudeClient("k", fakeFetch, async (u) => void seen.push(u));
    const out = await client.structured({ model: "m", system: "", user: "", schemaName: "s", schema: {} });

    // The return value is unchanged — this is what keeps ClaudeClient a
    // one-method interface and the ceiling's "one place" claim true.
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual([{ model: "m", inputTokens: 100, outputTokens: 20, webSearches: 2 }]);
  });

  it("never lets a usage-recording failure break the model call", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "s", input: { ok: true } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const client = makeClaudeClient("k", fakeFetch, async () => { throw new Error("db down"); });
    // An instrument must never take down the thing it measures.
    await expect(client.structured({ model: "m", system: "", user: "", schemaName: "s", schema: {} })).resolves.toEqual({ ok: true });
  });
});
