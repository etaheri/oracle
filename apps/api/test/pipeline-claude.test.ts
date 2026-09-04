import { describe, expect, it } from "vitest";
import { makeClaudeClient } from "../src/pipeline/claude";

const toolResp = (input: unknown) => new Response(JSON.stringify({
  stop_reason: "tool_use",
  content: [{ type: "text", text: "thinking" }, { type: "tool_use", name: "report", input }],
}), { status: 200 });

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

  it("omits the web search tool when webSearch is absent", async () => {
    const { fn, seen } = capturingFetch([toolResp({})]);
    await makeClaudeClient("key", fn).structured({ ...call, webSearch: undefined });
    expect(seen[0]!.body.tools.length).toBe(1);
  });

  it("continues on pause_turn then extracts", async () => {
    const paused = new Response(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "searching…" }] }), { status: 200 });
    const { fn, seen } = capturingFetch([paused, toolResp({ ok: true })]);
    const out = await makeClaudeClient("key", fn).structured(call);
    expect(out).toEqual({ ok: true });
    expect(seen.length).toBe(2);
    expect(seen[1]!.body.messages.length).toBe(2); // user + assistant continuation
    expect(seen[1]!.body.messages[1].role).toBe("assistant");
  });

  it("merges consecutive pause_turn continuations into one trailing assistant turn", async () => {
    const paused1 = new Response(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "searching one…" }] }), { status: 200 });
    const paused2 = new Response(JSON.stringify({ stop_reason: "pause_turn", content: [{ type: "text", text: "searching two…" }] }), { status: 200 });
    const { fn, seen } = capturingFetch([paused1, paused2, toolResp({ ok: true })]);
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

  it("throws when no structured output block is returned", async () => {
    const { fn } = capturingFetch([new Response(JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: "sorry" }] }), { status: 200 })]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("no structured output");
  });

  it("throws with status on non-2xx", async () => {
    const { fn } = capturingFetch([new Response("overloaded", { status: 529 })]);
    await expect(makeClaudeClient("key", fn).structured(call)).rejects.toThrow("529");
  });
});
