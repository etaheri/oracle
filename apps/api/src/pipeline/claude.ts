// Claude client contract for the pipeline (spec §5-7). Task 5 adds
// makeClaudeClient's implementation to this same file; this task ships only
// the interfaces so author.ts/resolve.ts stubs and PipelineDeps can type
// against them.
export interface StructuredCall {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  webSearch?: { allowedDomains?: string[]; maxUses?: number };
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
      type: "web_search_20250305",
      name: "web_search",
      max_uses: call.webSearch.maxUses ?? 5,
      ...(call.webSearch.allowedDomains?.length ? { allowed_domains: call.webSearch.allowedDomains } : {}),
    });
  }
  return tools;
}

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

export function makeClaudeClient(apiKey: string, fetchFn: typeof fetch = fetch): ClaudeClient {
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
            max_tokens: 8000,
            system: call.system,
            messages,
            tools,
            tool_choice: { type: "auto" },
          }),
        });

        if (!res.ok) {
          const bodySnippet = (await res.text()).slice(0, 200);
          throw new Error(`claude: ${res.status} ${bodySnippet}`);
        }

        const data = (await res.json()) as { stop_reason?: string; content?: unknown[] };
        const content = data.content ?? [];

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
