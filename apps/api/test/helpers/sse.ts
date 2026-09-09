// SSE fixtures for makeClaudeClient, which streams (pipeline/claude.ts header).
// Shared so the two suites that fake the Anthropic transport cannot drift into
// disagreeing about what the wire looks like.

/** Wrap events in an event-stream Response, one `data:` line each. */
export function sse(events: unknown[], status = 200): Response {
  const text = events
    .map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

/** The common shape: one tool_use block carrying `input`, plus a usage tally. */
export function toolStream(
  name: string,
  input: unknown,
  usage?: { inputTokens?: number; outputTokens?: number; webSearches?: number },
): Response {
  return sse([
    { type: "message_start", message: { usage: { input_tokens: usage?.inputTokens ?? 0, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "tool_use" },
      usage: {
        output_tokens: usage?.outputTokens ?? 0,
        ...(usage?.webSearches ? { server_tool_use: { web_search_requests: usage.webSearches } } : {}),
      },
    },
    { type: "message_stop" },
  ]);
}
