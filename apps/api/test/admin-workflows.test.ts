import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { makeTestDb } from "./helpers/db";
import type { WorkflowBindings } from "../src/pipeline/workflows";

const env = { DEVICE_TOKEN_SECRET: "test-secret", ADMIN_SECRET: "s" };

async function makeApp(workflows: Partial<WorkflowBindings>) {
  const { db } = await makeTestDb();
  return createApp({ db, env, workflows });
}

describe("admin workflow routes", () => {
  it("GET /admin/workflows/:kind/:id returns the instance status", async () => {
    const app = await makeApp({
      AUTHORING_WORKFLOW: {
        create: async () => {},
        get: async () => ({ status: async () => ({ status: "complete" }), restart: async () => {} }),
      },
    });
    const res = await app.request("/admin/workflows/author/author-2026-09-08-2026090817", {
      headers: { "x-admin-secret": "s" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "complete" });
  });

  it("refuses an unknown kind rather than guessing a binding", async () => {
    const app = await makeApp({});
    const res = await app.request("/admin/workflows/nonsense/x", { headers: { "x-admin-secret": "s" } });
    expect(res.status).toBe(400);
  });

  it("requires the admin secret", async () => {
    const app = await makeApp({});
    const res = await app.request("/admin/workflows/author/x");
    expect(res.status).toBe(401);
  });

  it("returns 503 for a known kind with no binding configured", async () => {
    const app = await makeApp({});
    const res = await app.request("/admin/workflows/author/x", { headers: { "x-admin-secret": "s" } });
    expect(res.status).toBe(503);
  });

  it("POST .../restart resumes from a named step", async () => {
    let restartedFrom: unknown;
    const app = await makeApp({
      RESOLUTION_WORKFLOW: {
        create: async () => {},
        get: async () => ({ status: async () => ({}), restart: async (o: unknown) => void (restartedFrom = o) }),
      },
    });
    const res = await app.request("/admin/workflows/resolve/resolve-2026-09-07-2026090812/restart", {
      method: "POST",
      headers: { "x-admin-secret": "s", "content-type": "application/json" },
      body: JSON.stringify({ from: "resolve-q4" }),
    });
    expect(res.status).toBe(200);
    expect(restartedFrom).toEqual({ from: { name: "resolve-q4" } });
  });

  it("POST .../restart with no body restarts from the top", async () => {
    let restartedFrom: unknown = "unset";
    const app = await makeApp({
      PROBE_WORKFLOW: {
        create: async () => {},
        get: async () => ({ status: async () => ({}), restart: async (o: unknown) => void (restartedFrom = o) }),
      },
    });
    const res = await app.request("/admin/workflows/probe/probe-2026-09-07-2026090812/restart", {
      method: "POST",
      headers: { "x-admin-secret": "s" },
    });
    expect(res.status).toBe(200);
    expect(restartedFrom).toBeUndefined();
  });
});
