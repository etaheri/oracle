import { describe, it, expect, vi, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { RevealSchema } from "@oracle/core";
import { makeTestDb, seedRound } from "./helpers/db";
import { schema } from "../src/db/client";
import { createApp } from "../src/app";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "admin" };
const DATE = "2026-09-25";
afterEach(() => vi.useRealTimers());

async function world() {
  vi.useFakeTimers({ now: new Date("2026-09-25T17:00:00Z"), toFake: ["Date"] });
  const { db } = await makeTestDb();
  const app = createApp({ db, env });
  const qs = await seedRound(db, { date: DATE, opensAt: new Date("2026-09-25T16:00:00Z"), locksAt: new Date("2026-09-26T16:00:00Z") });
  // Slot 1 is a hot take; the rest stay market questions.
  await db.update(schema.questions).set({ marketSource: "crowd", sourceName: "THE PLAYERS", linePYes: "0.38" }).where(eq(schema.questions.id, qs[0]!.id));
  await db.update(schema.rounds).set({ rulesVersion: 3 }).where(eq(schema.rounds.date, DATE));
  const res = await app.request("/v1/auth/device", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform: "ios" }) });
  const { token } = (await res.json()) as { token: string };
  const as = (path: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  const seal = (qid: string, answer: boolean) => as("/v1/predictions", { method: "POST", body: JSON.stringify({ question_id: qid, answer, confidence: 75, idempotency_key: `k-${qid}` }) });
  return { db, qs, as, seal };
}

describe("the reveal's room fields (design 2026-09-25 §6.3, §6.6)", () => {
  it("marks a hot take, stamps when the room answered, and stamps when the caller sealed", async () => {
    const { db, qs, as, seal } = await world();
    expect((await seal(qs[0]!.id, true)).status).toBe(200);
    vi.setSystemTime(new Date("2026-09-26T16:05:00Z"));
    await db.update(schema.questions).set({ status: "resolved", outcome: "yes", resolvedAt: new Date("2026-09-26T16:01:00Z"), crowdYesPct: "62", crowdCount: 41 }).where(eq(schema.questions.id, qs[0]!.id));
    const r = RevealSchema.parse(await (await as(`/v1/round/${DATE}/reveal`)).json());
    const first = r.questions.find((q) => q.slot === 1)!;
    expect(first).toMatchObject({ crowd: true, resolved_at: "2026-09-26T16:01:00.000Z" });
    // created_at is the database's own clock, which fake timers do not move,
    // so the assertion is on the shape rather than the instant.
    expect(first.my!.sealed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const second = r.questions.find((q) => q.slot === 2)!;
    expect(second).toMatchObject({ crowd: false, resolved_at: null, my: null });
  });
});
