import { describe, expect, it } from "vitest";
import { chooseRite, callingHaptic } from "../src/game/calling";

describe("chooseRite", () => {
  it("holds a blank cover while the flag is still unread", () => {
    expect(chooseRite(null)).toBe("hold");
  });
  it("summons the calling on the first open ever", () => {
    expect(chooseRite(false)).toBe("calling");
  });
  it("gives veterans the plain boot rite", () => {
    expect(chooseRite(true)).toBe("boot");
  });
});

describe("callingHaptic", () => {
  it("lands each beat lightly", () => {
    expect(callingHaptic(0, 5)).toBe("light");
    expect(callingHaptic(3, 5)).toBe("light");
  });
  it("lands the final beat heavy — it has reached you", () => {
    expect(callingHaptic(4, 5)).toBe("heavy");
  });
});
