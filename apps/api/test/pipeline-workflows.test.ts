import { describe, expect, it } from "vitest";
import { hourBucket, bindingStarter } from "../src/pipeline/workflows";

describe("hourBucket", () => {
  it("is the ET date and hour, zero-padded, with no separators", () => {
    expect(hourBucket({ date: "2026-09-04", hour: 17, minute: 3 })).toBe("2026090417");
    expect(hourBucket({ date: "2026-09-04", hour: 3, minute: 59 })).toBe("2026090403");
    expect(hourBucket({ date: "2026-09-04", hour: 0, minute: 0 })).toBe("2026090400");
  });
});

describe("bindingStarter", () => {
  const binding = (created: unknown[]) => ({ create: async (o: unknown) => void created.push(o) });
  // bindingStarter ignores the deps argument entirely — the Workflow builds its
  // own deps from env on the other side of the dispatch.
  const noDeps = null as unknown as import("../src/pipeline").PipelineDeps;

  it("routes each kind to its own binding and passes the id and params through", async () => {
    const author: unknown[] = [], resolve: unknown[] = [];
    const s = bindingStarter({ AUTHORING_WORKFLOW: binding(author), RESOLUTION_WORKFLOW: binding(resolve), COUNCIL_WORKFLOW: binding([]) });
    await s.start(noDeps, "author", "author-2026-09-05-2026090417", { date: "2026-09-05" });
    await s.start(noDeps, "resolve", "resolve-2026-09-04-2026090412", { date: "2026-09-04", questionIds: ["q1"] });
    expect(author).toEqual([{ id: "author-2026-09-05-2026090417", params: { date: "2026-09-05" } }]);
    expect(resolve[0]).toMatchObject({ id: "resolve-2026-09-04-2026090412" });
  });

  it("routes the council kind to its own binding", async () => {
    const council: unknown[] = [];
    const s = bindingStarter({ AUTHORING_WORKFLOW: binding([]), RESOLUTION_WORKFLOW: binding([]), COUNCIL_WORKFLOW: binding(council) });
    await s.start(noDeps, "council", "council-2026-09-05-2026090409", { date: "2026-09-05" });
    expect(council).toEqual([{ id: "council-2026-09-05-2026090409", params: { date: "2026-09-05" } }]);
  });

  it("swallows a duplicate-instance error, because a collision IS the idempotency", async () => {
    const s = bindingStarter({
      AUTHORING_WORKFLOW: { create: async () => { throw new Error("instance.already_exists: an instance with id author-x already exists"); } },
      RESOLUTION_WORKFLOW: { create: async () => {} },
      COUNCIL_WORKFLOW: { create: async () => {} },
    });
    await expect(s.start(noDeps, "author", "author-x", { date: "2026-09-05" })).resolves.toBeUndefined();
  });

  it("still throws on any OTHER failure — a broken binding must not look like a duplicate", async () => {
    const s = bindingStarter({
      AUTHORING_WORKFLOW: { create: async () => { throw new Error("binding is not configured"); } },
      RESOLUTION_WORKFLOW: { create: async () => {} },
      COUNCIL_WORKFLOW: { create: async () => {} },
    });
    await expect(s.start(noDeps, "author", "author-x", { date: "2026-09-05" })).rejects.toThrow("not configured");
  });
});
