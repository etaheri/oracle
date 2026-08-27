import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";
import { validDraft } from "./helpers/draft";
import { upsertDraft } from "../src/pipeline/draft";
import { parseCommand } from "../src/routes/telegram";
import type { PipelineDeps } from "../src/pipeline";
import type { ClaudeClient, StructuredCall } from "../src/pipeline/claude";
import * as schema from "../src/db/schema";

const env = {
  DEVICE_TOKEN_SECRET: "test-secret",
  ADMIN_SECRET: "admin",
  TELEGRAM_WEBHOOK_SECRET: "hook",
  TELEGRAM_CHAT_ID: "42",
};

function fakeClaude(responses: unknown[]) {
  const calls: StructuredCall[] = [];
  const claude: ClaudeClient = {
    async structured(call) {
      calls.push(call);
      if (responses.length === 0) throw new Error("no more fake responses queued");
      const next = responses.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { claude, calls };
}

function fakePipeline(db: PipelineDeps["db"], claude: ClaudeClient | null, nowIso: string) {
  const sent: string[] = [];
  const deps: PipelineDeps = {
    db,
    claude,
    models: { author: "m-a", resolve: "m-r" },
    telegram: { send: async (t) => void sent.push(t) },
    now: () => new Date(nowIso),
  };
  return { deps, sent };
}

function post(app: ReturnType<typeof createApp>, secret: string, body: unknown) {
  return app.request(`/v1/telegram/${secret}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function msg(text: string, chatId: number | undefined = 42) {
  return { message: { chat: chatId === undefined ? undefined : { id: chatId }, text } };
}

describe("parseCommand", () => {
  it("parses /reroll with guidance", () => {
    expect(parseCommand("/reroll 3 more sports")).toEqual({ cmd: "reroll", slot: 3, guidance: "more sports" });
  });

  it("parses /reroll without guidance", () => {
    expect(parseCommand("/reroll 3")).toEqual({ cmd: "reroll", slot: 3, guidance: "" });
  });

  it("falls back to help for /reroll with no slot", () => {
    expect(parseCommand("/reroll")).toEqual({ cmd: "help" });
  });

  it("falls back to help for /reroll with an out-of-range slot", () => {
    expect(parseCommand("/reroll 9")).toEqual({ cmd: "help" });
  });

  it("falls back to help for /reroll with a junk slot", () => {
    expect(parseCommand("/reroll abc")).toEqual({ cmd: "help" });
  });

  it("parses /status", () => {
    expect(parseCommand("/status")).toEqual({ cmd: "status" });
  });

  it("falls back to help for anything else", () => {
    expect(parseCommand("hello")).toEqual({ cmd: "help" });
    expect(parseCommand("")).toEqual({ cmd: "help" });
  });
});

describe("POST /v1/telegram/:secret", () => {
  it("404s on secret mismatch", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await post(app, "wrong", msg("/status"));
    expect(res.status).toBe(404);
  });

  it("404s when TELEGRAM_WEBHOOK_SECRET is unset", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env: { DEVICE_TOKEN_SECRET: "x", ADMIN_SECRET: "admin" } });
    const res = await post(app, "hook", msg("/status"));
    expect(res.status).toBe(404);
  });

  it("ignores a wrong chat id: 200 with no sends", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakePipeline(db, null, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });
    const res = await post(app, "hook", msg("/status", 999));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("ignores a malformed body: 200 with no sends", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakePipeline(db, null, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });
    const res = await post(app, "hook", { not: "a telegram update" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(0);
  });

  it("200s with no action when the pipeline isn't configured", async () => {
    const { db } = await makeTestDb();
    const app = createApp({ db, env });
    const res = await post(app, "hook", msg("/status"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("/status replies with a summary of the pipeline state", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-28", validDraft);
    const { deps, sent } = fakePipeline(db, null, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });
    const res = await post(app, "hook", msg("/status"));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("open: none");
    expect(sent[0]).toContain("locked-unsettled: none");
    expect(sent[0]).toContain("tomorrow draft: yes");
  });

  it("/reroll with a standing draft: 'rerolling slot N…' sent and the slot's question changes", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-28", validDraft);
    const replacement = {
      slot: 3,
      category: "weather" as const,
      text: "Will it rain in NYC before midnight?",
      resolution_criteria: "NWS observed precipitation at Central Park station by 23:59 ET",
      source_name: "NWS",
      source_url: "https://weather.gov/nyc",
      author_probability: 0.45,
      is_big_one: false,
    };
    const { claude } = fakeClaude([replacement]);
    const { deps, sent } = fakePipeline(db, claude, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });

    const res = await post(app, "hook", msg("/reroll 3 make it about weather"));
    expect(res.status).toBe(200);

    expect(sent[0]).toBe("rerolling slot 3…");
    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-28") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.text).toBe(replacement.text);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain(replacement.text);
  });

  it("/reroll with no standing draft replies 'no draft standing'", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakePipeline(db, null, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });
    const res = await post(app, "hook", msg("/reroll 3 more sports"));
    expect(res.status).toBe(200);
    expect(sent).toEqual(["no draft standing"]);
  });

  it("help text for an unrecognized command", async () => {
    const { db } = await makeTestDb();
    const { deps, sent } = fakePipeline(db, null, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });
    const res = await post(app, "hook", msg("hello there"));
    expect(res.status).toBe(200);
    expect(sent).toEqual(["/reroll <slot> [guidance] · /status"]);
  });

  it("an internal throw during reroll still returns 200 and sends the error text", async () => {
    const { db } = await makeTestDb();
    await upsertDraft(db, "2026-08-28", validDraft);
    const { claude } = fakeClaude([new Error("claude blew up")]);
    const { deps, sent } = fakePipeline(db, claude, "2026-08-27T12:00:00Z");
    const app = createApp({ db, env, pipeline: deps });

    const res = await post(app, "hook", msg("/reroll 3 more sports"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sent).toContain("claude blew up");

    const qs = await db.query.questions.findMany({ where: eq(schema.questions.roundDate, "2026-08-28") });
    const slot3 = qs.find((q) => q.slot === 3)!;
    expect(slot3.text).toBe(validDraft.questions[2]!.text); // unchanged
  });
});
