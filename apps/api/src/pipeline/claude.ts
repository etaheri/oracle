// Claude client contract for the pipeline (spec §5-7).
//
// THE CLIENT STREAMS, AND THAT IS NOT AN OPTIMISATION (design 2026-09-08 §4.7).
// A non-streaming POST holds one HTTP response open for the whole turn, and the
// authoring call — Opus 5, adaptive thinking, twelve candidates, eight web
// searches — runs well past two minutes. Anthropic's edge closes the connection
// first and returns 524; on 2026-09-08 that killed six attempts an hour, each
// one a full generation that was performed, billed, and thrown away. Streaming
// puts bytes on the wire continuously, so no intermediary can time the turn out.
//
// The assembled message keeps the exact shape the non-streaming endpoint
// returned, so pause_turn continuation, structured extraction and the usage
// instrument below are unchanged by the switch.
import type { CallUsage } from "./usage";

export interface StructuredCall {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  webSearch?: { allowedDomains?: string[]; maxUses?: number };
  /**
   * OPT-IN, never a default. `output_config.effort` is unsupported on Haiku
   * 4.5, which is PIPELINE_TASTE_MODEL — sending it unconditionally would 400
   * the fail-closed taste gate and reject every round. Only callers that know
   * their model supports it may set it.
   */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /**
   * OPT-IN, defaulting to DEFAULT_MAX_TOKENS. One budget covers the thinking
   * AND the tool input, so a call that asks for a large structured answer has
   * to say so: the authoring call wants fourteen candidates of fourteen
   * fields, and at 8000 the turn ran out before emitting any of the input.
   */
  maxTokens?: number;
}
export interface ClaudeClient { structured(call: StructuredCall): Promise<unknown> }

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_CONTINUATIONS = 3;

function buildTools(call: StructuredCall): Record<string, unknown>[] {
  const tools: Record<string, unknown>[] = [
    {
      name: call.schemaName,
      description: "Report your final answer by calling this tool exactly once.",
      input_schema: call.schema,
    },
  ];
  if (call.webSearch) {
    tools.push({
      // web_search_20260209 is the current variant for Opus 5 and Sonnet 5 and
      // adds dynamic filtering (design 2026-09-04 §14.3). Every search-using
      // call in this pipeline runs on one of those two models.
      type: "web_search_20260209",
      name: "web_search",
      max_uses: call.webSearch.maxUses ?? 5,
      ...(call.webSearch.allowedDomains?.length ? { allowed_domains: call.webSearch.allowedDomains } : {}),
    });
  }
  return tools;
}

// Enough for every short structured answer in the pipeline — a resolution
// verdict, a critic's rubric, a taste score. The authoring call is the one
// that needs more, and asks for it.
const DEFAULT_MAX_TOKENS = 8000;

function extractStructuredOutput(content: unknown[], schemaName: string): unknown | undefined {
  let found: unknown | undefined;
  for (const block of content) {
    const b = block as { type?: string; name?: string; input?: unknown };
    if (b.type === "tool_use" && b.name === schemaName) {
      found = b.input;
    }
  }
  return found;
}

/** The shape the non-streaming endpoint used to hand back, rebuilt from events. */
interface AssembledMessage {
  stop_reason?: string;
  content: unknown[];
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
}

type Block = Record<string, unknown>;

/**
 * Fold one SSE event into the message under construction.
 *
 * `partialJson` is accumulated separately from the block because a tool_use
 * block's `input` arrives as a string in pieces and is only valid JSON once
 * the block closes.
 */
function applyEvent(
  ev: Record<string, any>,
  msg: AssembledMessage,
  blocks: Map<number, { block: Block; partialJson: string }>,
): void {
  switch (ev.type) {
    case "message_start": {
      const u = ev.message?.usage;
      if (u) {
        msg.usage.input_tokens = u.input_tokens ?? 0;
        msg.usage.output_tokens = u.output_tokens ?? 0;
        if (u.server_tool_use) msg.usage.server_tool_use = u.server_tool_use;
      }
      break;
    }
    case "content_block_start":
      // Shallow copy: deltas only ever append to top-level scalar fields, and
      // server-tool result blocks arrive whole and must survive untouched.
      blocks.set(ev.index, { block: { ...(ev.content_block ?? {}) }, partialJson: "" });
      break;
    case "content_block_delta": {
      const entry = blocks.get(ev.index);
      if (!entry) break;
      const d = ev.delta ?? {};
      if (d.type === "text_delta") entry.block.text = String(entry.block.text ?? "") + d.text;
      else if (d.type === "thinking_delta") entry.block.thinking = String(entry.block.thinking ?? "") + d.thinking;
      else if (d.type === "signature_delta") entry.block.signature = String(entry.block.signature ?? "") + d.signature;
      else if (d.type === "input_json_delta") entry.partialJson += d.partial_json ?? "";
      break;
    }
    case "content_block_stop": {
      const entry = blocks.get(ev.index);
      if (!entry) break;
      // Only the schema tool is checked. `web_search_tool_result` blocks
      // arrive whole and carry no input_json_delta at all, so an empty
      // partialJson is normal for them and must stay normal.
      if (entry.block.type !== "tool_use") break;
      if (!entry.partialJson) {
        // A tool_use block that opened and never received its input.
        //
        // content_block_start carries `input: {}` and the shallow copy above
        // keeps it, so breaking here left a well-formed, empty tool call —
        // which is not undefined, so structured()'s "no structured output"
        // guard never fired, and the caller read its own key off {} and got
        // nothing. On 2026-09-09 that turned an authoring turn which stopped
        // at max_tokens into a cheerful "0 candidates, rejected: none" and a
        // workflow that exited Completed. Absence must be as loud as
        // corruption: both mean the model did not answer.
        throw new Error("claude: tool input never arrived (turn ended before the input was sent)");
      }
      try {
        entry.block.input = JSON.parse(entry.partialJson);
      } catch {
        // A truncated tool input is not a partial answer, it is no answer.
        // Returning the half-built block would hand unvalidated garbage to
        // the screen as though the model had produced it.
        throw new Error("claude: tool input was not valid JSON");
      }
      break;
    }
    case "message_delta": {
      if (ev.delta?.stop_reason) msg.stop_reason = ev.delta.stop_reason;
      const u = ev.usage;
      if (u) {
        // output_tokens on message_delta is cumulative for the turn.
        if (u.output_tokens !== undefined) msg.usage.output_tokens = u.output_tokens;
        if (u.server_tool_use) msg.usage.server_tool_use = u.server_tool_use;
      }
      break;
    }
    case "error":
      // A stream can fail after the 200. Anthropic reports it in-band and
      // stops; this must surface as a thrown error so the step retries rather
      // than proceeding on a truncated message.
      throw new Error(
        `claude: stream error ${ev.error?.type ?? "unknown"}${ev.error?.message ? `: ${ev.error.message}` : ""}`,
      );
  }
}

/** Read an SSE body to completion and return the message it describes. */
async function readStream(res: Response): Promise<AssembledMessage> {
  if (!res.body) throw new Error("claude: streaming response had no body");

  const msg: AssembledMessage = { content: [], usage: {} };
  const blocks = new Map<number, { block: Block; partialJson: string }>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // One SSE event: some `field: value` lines. Only `data:` carries anything —
  // the `event:` line is redundant with the payload's own `type`.
  const applyBlock = (raw: string) => {
    for (const line of raw.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      applyEvent(JSON.parse(payload), msg, blocks);
    }
  };

  const drain = (flush: boolean) => {
    // Events are separated by a blank line. Chunk boundaries fall wherever the
    // transport puts them, including mid-line, so the tail stays buffered
    // until its terminator arrives — or until `flush`, at end of body.
    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      applyBlock(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
    if (flush && buffer.trim()) {
      applyBlock(buffer);
      buffer = "";
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CRLF over the WHOLE buffer, not the chunk: a "\r\n" can be
      // split across two reads, and a per-chunk replace would miss it.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      drain(false);
    }
    buffer += decoder.decode();
    drain(true);
  } catch (err) {
    // An abandoned body holds its connection open in workerd, and this path is
    // reached by every malformed-JSON and in-band `error` event — the failure
    // modes a retrying step hits repeatedly. Release it before rethrowing.
    await reader.cancel().catch(() => {});
    throw err;
  }

  msg.content = [...blocks.keys()].sort((a, b) => a - b).map((i) => blocks.get(i)!.block);
  return msg;
}

export function makeClaudeClient(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
  onUsage?: (u: CallUsage) => Promise<void>,
): ClaudeClient {
  return {
    async structured(call: StructuredCall): Promise<unknown> {
      const tools = buildTools(call);
      const messages: Record<string, unknown>[] = [{ role: "user", content: call.user }];

      for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
        const res = await fetchFn(ANTHROPIC_URL, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: call.model,
            max_tokens: call.maxTokens ?? DEFAULT_MAX_TOKENS,
            system: call.system,
            messages,
            tools,
            tool_choice: { type: "auto" },
            stream: true,
            ...(call.effort ? { output_config: { effort: call.effort } } : {}),
          }),
        });

        if (!res.ok) {
          const bodySnippet = (await res.text()).slice(0, 200);
          throw new Error(`claude: ${res.status} ${bodySnippet}`);
        }

        const data = await readStream(res);
        const content = data.content;

        if (onUsage) {
          const u = data.usage;
          try {
            await onUsage({
              model: call.model,
              inputTokens: u.input_tokens ?? 0,
              outputTokens: u.output_tokens ?? 0,
              webSearches: u.server_tool_use?.web_search_requests ?? 0,
            });
          } catch {
            // An instrument must never take down the thing it measures. A
            // failed usage write loses a number; a thrown one loses the round.
          }
        }

        if (data.stop_reason === "pause_turn") {
          if (attempt === MAX_CONTINUATIONS) {
            throw new Error("claude: pause_turn limit");
          }
          const last = messages[messages.length - 1];
          if (last && last.role === "assistant") {
            (last.content as unknown[]).push(...content);
          } else {
            messages.push({ role: "assistant", content: [...content] });
          }
          continue;
        }

        const output = extractStructuredOutput(content, call.schemaName);
        if (output === undefined) {
          throw new Error("claude: no structured output");
        }
        return output;
      }

      throw new Error("claude: pause_turn limit");
    },
  };
}
