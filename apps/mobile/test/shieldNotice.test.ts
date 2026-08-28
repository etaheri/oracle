import { describe, it, expect } from "vitest";
import { shieldNotice } from "../src/game/shieldNotice";

describe("shieldNotice", () => {
  it("speaks only on the morning after the shield held", () => {
    expect(shieldNotice("2026-08-27", "2026-08-27")).toBe("THE SHIELD HELD. YOUR VIGIL SURVIVES THE MISSED NOON.");
    expect(shieldNotice("2026-08-20", "2026-08-27")).toBeNull();
    expect(shieldNotice(null, "2026-08-27")).toBeNull();
  });
});
