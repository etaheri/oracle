import { describe, expect, it } from "vitest";
import { chooseRite, callingHaptic, openedOnHome } from "../src/game/calling";

describe("chooseRite", () => {
  it("holds a blank cover while the flag is still unread", () => {
    expect(chooseRite(null, true)).toBe("hold");
  });
  it("summons the calling on the first open ever", () => {
    expect(chooseRite(false, true)).toBe("calling");
  });
  it("gives veterans the plain boot rite", () => {
    expect(chooseRite(true, true)).toBe("boot");
  });

  // The rite is a handoff into Home's orb. Opened anywhere else — a push tap,
  // a shared reveal — it is a curtain over the screen the player asked for.
  it("stands down when the app opened somewhere other than home", () => {
    expect(chooseRite(true, false)).toBe("none");
  });
  it("does not even hold a cover over a deep-linked screen", () => {
    expect(chooseRite(null, false)).toBe("none");
  });
  it("saves the calling rather than burning it on a deep link", () => {
    expect(chooseRite(false, false)).toBe("none");
  });
});

describe("openedOnHome", () => {
  it("reads the router's own resolved path", () => {
    expect(openedOnHome("/")).toBe(true);
    expect(openedOnHome("/reveal/2026-09-02")).toBe(false);
    expect(openedOnHome("/round")).toBe(false);
    expect(openedOnHome("/plus")).toBe(false);
  });
  // An empty path is not a deep link. Reading it as one would risk
  // suppressing the rite on an ordinary cold start; reading it as Home costs
  // at worst a single frame of curtain over a deep-linked screen.
  it("treats an unresolved path as home", () => {
    expect(openedOnHome("")).toBe(true);
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
