import { describe, it, expect } from "vitest";
import { voiceQuestions, VOICE_PROMPT_VERSION } from "../src/pipeline/voice";
import type { PipelineDeps } from "../src/pipeline";

function depsWith(structured: NonNullable<PipelineDeps["claude"]>["structured"]): PipelineDeps {
  return {
    db: null as unknown as PipelineDeps["db"],
    telegram: { send: async () => {} },
    claude: { structured },
    models: { author: "a", resolve: "r", resolveB: "rb", forecast: "f", critic: "c", preflight: "p", probe: "pr", taste: "t", voice: "claude-sonnet-5" },
    now: () => new Date("2026-09-10T21:00:00Z"),
    workflows: { start: async () => {} },
  };
}

const inputs = [1, 2, 3, 4, 5].map((slot) => ({
  slot, title: `Will the maximum temperature be 87-88° on Sep 11, 2026? — NYC ${slot}`, rules: "Per the NWS daily climate report for Central Park.",
  category: "weather" as const, isBigOne: slot === 5,
}));

describe("voiceQuestions", () => {
  it("sends every title and rule, no web search, low effort, and returns five voiced rows by slot", async () => {
    let seen: Record<string, unknown> = {};
    const deps = depsWith(async (call) => {
      seen = call as unknown as Record<string, unknown>;
      return { questions: inputs.map((i) => ({ slot: i.slot, text: "Will Central Park reach 87°F on Thursday?", context: "The forecast high is 86." })) };
    });
    const out = await voiceQuestions(deps, "2026-09-10", inputs);
    expect(seen.model).toBe("claude-sonnet-5");
    expect(seen.webSearch).toBeUndefined();
    expect(seen.effort).toBe("low");
    expect(String(seen.user)).toContain("NYC 3");
    expect(String(seen.user)).toContain("NWS daily climate report");
    expect(out.map((v) => v.slot)).toEqual([1, 2, 3, 4, 5]);
    expect(out[0]!.text).toMatch(/\?$/);
  });
  it("throws when a slot is missing or a text is too short", async () => {
    const deps = depsWith(async () => ({ questions: inputs.slice(0, 4).map((i) => ({ slot: i.slot, text: "Will it?", context: "" })) }));
    await expect(voiceQuestions(deps, "2026-09-10", inputs)).rejects.toThrow(/voice/);
  });
  it("has a prompt version", () => {
    expect(VOICE_PROMPT_VERSION).toBe("voice-v1");
  });
});
