import { describe, expect, it } from "vitest";
import { makeClaudeClient } from "../src/pipeline/claude";
import { sse } from "./helpers/sse";

// The client streams (design 2026-09-08 §4.7): a non-streaming turn on the
// authoring model ran ~128s and Anthropic's edge returned 524 before the
// response landed, six times an hour, each one billed. Every fixture here is
// therefore an SSE body, not a JSON one.

/** The happy path: a text block, then the schema tool called once. */
const toolResp = (input: unknown, stopReason = "tool_use") =>
  sse([
    { type: "message_start", message: { usage: { input_tokens: 11, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "thinking" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 22 } },
    { type: "message_stop" },
  ]);

/** A turn that paused for a server-side search, carrying one text block. */
const pausedResp = (text: string) =>
  sse([
    { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: { output_tokens: 2 } },
    { type: "message_stop" },
  ]);

const call = {
  model: "m", system: "sys", user: "usr", schemaName: "report",
  schema: { type: "object" }, webSearch: { allowedDomains: ["example.com"], maxUses: 3 },
};

function capturingFetch(responses: Response[]) {
  const seen: { url: string; init: RequestInit; body: any }[] = [];
  const fn = (async (url: any, init: any) => {
    seen.push({ url: String(url), init, body: JSON.parse(init.body) });
    return responses.shift()!;
  }) as typeof fetch;
  return { fn, seen };
}

describe("makeClaudeClient", () => {
  it("sends model/system/tools and returns the tool input", async () => {
    const { fn, seen } = capturingFetch([toolResp({ answer: 42 })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ answer: 42 });
    const { url, init, body } = seen[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("key");
    expect((init.headers as Record<string, string>)["anthropic-version"]).toBe("2023-06-01");
    expect(body.model).toBe("m");
    expect(body.system).toBe("sys");
    const names = body.tools.map((t: any) => t.name ?? t.type);
    expect(names).toContain("report");
    const ws = body.tools.find((t: any) => t.type === "web_search_20260209");
    expect(ws.allowed_domains).toEqual(["example.com"]);
    expect(ws.max_uses).toBe(3);
  });

  // THE 524 FIX. A non-streaming request is the defect; if this assertion is
  // ever relaxed, the authoring call goes back to dying at the edge timeout.
  it("always streams", async () => {
    const { fn, seen } = capturingFetch([toolResp({ ok: true })]);
    await makeClaudeClient("key", fn).structured(call);
    expect(seen[0]!.body.stream).toBe(true);
  });

  it("assembles a tool input split across several input_json_delta chunks", async () => {
    const chunked = sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1,' } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"b":[2,3]}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ]);
    const { fn } = capturingFetch([chunked]);
    expect(await makeClaudeClient("key", fn).structured(call)).toEqual({ a: 1, b: [2, 3] });
  });

  it("splits events on chunk boundaries that fall mid-line", async () => {
    // The transport does not respect event framing; the parser must.
    const whole = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"ok":true}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
    ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
    const bytes = new TextEncoder().encode(whole);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      },
    });
    const { fn } = capturingFetch([new Response(body, { status: 200 })]);
    expect(await makeClaudeClient("key", fn).structured(call)).toEqual({ ok: true });
  });

  it("frames events written with CRLF, including across a chunk boundary", async () => {
    const crlf = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"crlf":true}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
    ].map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join("");
    const bytes = new TextEncoder().encode(crlf);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Deliberately odd stride, so some "\r\n" pairs land astride two reads.
        for (let i = 0; i < bytes.length; i += 13) controller.enqueue(bytes.slice(i, i + 13));
        controller.close();
      },
    });
    const { fn } = capturingFetch([new Response(body, { status: 200 })]);
    expect(await makeClaudeClient("key", fn).structured(call)).toEqual({ crlf: true });
  });

  it("omits the web search tool when webSearch is absent", async () => {
    const { fn, seen } = capturingFetch([toolResp({})]);
    await makeClaudeClient("key", fn).structured({ ...call, webSearch: undefined });
    expect(seen[0]!.body.tools.length).toBe(1);
  });

  // effort is opt-in per call because it is NOT universally supported —
  // PIPELINE_TASTE_MODEL is Haiku 4.5, which rejects output_config.effort with
  // a 400. Sending it unconditionally would take the fail-closed taste gate
  // down on every round.
  it("sends output_config.effort only when the call asks for it", async () => {
    const { fn, seen } = capturingFetch([toolResp({}), toolResp({})]);
    const client = makeClaudeClient("key", fn);
    await client.structured(call);
    expect(seen[0]!.body.output_config).toBeUndefined();
    await client.structured({ ...call, effort: "medium" });
    expect(seen[1]!.body.output_config).toEqual({ effort: "medium" });
  });

  it("continues on pause_turn then extracts", async () => {
    const { fn, seen } = capturingFetch([pausedResp("searching…"), toolResp({ ok: true })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ ok: true });
    expect(seen.length).toBe(2);
    expect(seen[1]!.body.messages.length).toBe(2); // user + assistant continuation
    expect(seen[1]!.body.messages[1].role).toBe("assistant");
  });

  it("merges consecutive pause_turn continuations into one trailing assistant turn", async () => {
    const { fn, seen } = capturingFetch([pausedResp("searching one…"), pausedResp("searching two…"), toolResp({ ok: true })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ ok: true });
    expect(seen.length).toBe(3);
    expect(seen[1]!.body.messages.length).toBe(2); // user + single assistant continuation
    expect(seen[1]!.body.messages[1].role).toBe("assistant");
    expect(seen[2]!.body.messages.length).toBe(2); // still a single trailing assistant message
    expect(seen[2]!.body.messages[1].role).toBe("assistant");
    const mergedTexts = seen[2]!.body.messages[1].content.map((b: any) => b.text);
    expect(mergedTexts).toEqual(["searching one…", "searching two…"]);
  });

  it("reports usage assembled from message_start and message_delta", async () => {
    const withSearch = sse([
      { type: "message_start", message: { usage: { input_tokens: 100, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 250, server_tool_use: { web_search_requests: 4 } } },
      { type: "message_stop" },
    ]);
    const seenUsage: unknown[] = [];
    const { fn } = capturingFetch([withSearch]);
    await makeClaudeClient("key", fn, async (u) => { seenUsage.push(u); }).structured(call);
    expect(seenUsage).toEqual([{ model: "m", inputTokens: 100, outputTokens: 250, webSearches: 4 }]);
  });

  it("throws when no structured output block is returned", async () => {
    const { fn } = capturingFetch([sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sorry" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    ])]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("no structured output");
  });

  it("throws with status on non-2xx", async () => {
    const { fn } = capturingFetch([new Response("overloaded", { status: 529 })]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("529");
  });

  // A stream can fail AFTER the 200. Anthropic sends an `error` event and stops;
  // silently returning the half-built message would hand malformed candidates
  // to the screen as if the model had produced them.
  it("throws on a mid-stream error event", async () => {
    const { fn } = capturingFetch([sse([
      { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
    ])]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("overloaded_error");
  });

  it("throws when the stream ends mid-tool-input", async () => {
    const { fn } = capturingFetch([sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "report", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
    ])]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("not valid JSON");
  });
});
