import { describe, it, expect } from "vitest";
import { roundKindOf, siteUrlOf, DEFAULT_SITE_URL } from "../src/pipeline/round-kind";
import { buildPipelineDeps, type WorkerEnv } from "../src/worker";

// "postgres://x" (as the brief's test literal has it) fails the neon()
// driver's stricter connection-string validation at buildPipelineDeps time,
// which is unrelated to this task; pipeline-tick.test.ts's baseEnv() uses
// this same host:port:db form for the same reason.
const base: WorkerEnv = { DATABASE_URL: "postgres://user:pass@localhost:5432/db", DEVICE_TOKEN_SECRET: "s", ADMIN_SECRET: "a", PIPELINE_ENABLED: "true" };

describe("the round kind (design 2026-09-22 T3)", () => {
  it("is the market round when a test builds deps without one", () => {
    expect(roundKindOf({})).toBe("market");
    expect(roundKindOf({ roundKind: "opinion" })).toBe("opinion");
  });
  it("defaults to opinion in production and reads market when the var says so", () => {
    expect(buildPipelineDeps(base)!.roundKind).toBe("opinion");
    expect(buildPipelineDeps({ ...base, PIPELINE_ROUND_KIND: "market" })!.roundKind).toBe("market");
    expect(buildPipelineDeps({ ...base, PIPELINE_ROUND_KIND: "opinion" })!.roundKind).toBe("opinion");
    expect(buildPipelineDeps({ ...base, PIPELINE_ROUND_KIND: "nonsense" })!.roundKind).toBe("opinion");
  });
  it("carries the site URL with the standings page's hard-coded host as its default", () => {
    expect(siteUrlOf({})).toBe(DEFAULT_SITE_URL);
    expect(siteUrlOf({ siteUrl: "https://example.test" })).toBe("https://example.test");
    expect(buildPipelineDeps(base)!.siteUrl).toBe(DEFAULT_SITE_URL);
    expect(buildPipelineDeps({ ...base, SITE_URL: "https://example.test/" })!.siteUrl).toBe("https://example.test");
  });
});
