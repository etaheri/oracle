import { it, expect } from "vitest";
import { maybeSummon, summonNow } from "../src/notifications/summons";

// "The one summons, ever" (voice spec §4). The flag flips when the screen is
// SHOWN, not when the reader consents — so a decline is final too.

function harness(startAsked = false) {
  const state = { asked: startAsked, pushes: 0 };
  return {
    state,
    deps: {
      asked: async () => state.asked,
      mark: async () => { state.asked = true; },
    },
    push: () => { state.pushes++; },
  };
}

it("shows the summons and marks it asked when nothing has asked yet", async () => {
  const h = harness();
  await maybeSummon(h.push, h.deps);
  expect(h.state.pushes).toBe(1);
  expect(h.state.asked).toBe(true);
});

it("never shows a second time once it has been asked", async () => {
  const h = harness(true);
  await maybeSummon(h.push, h.deps);
  expect(h.state.pushes).toBe(0);
});

// The regression this exists to prevent: Home's reminder control routes a
// reader who has sealed nothing straight to the summons. If that path did not
// mark the flag, sealing a question later would summon them a SECOND time —
// after they had already granted permission from the first.
it("counts a direct summons as the one ask, so a later seal cannot repeat it", async () => {
  const h = harness();
  await summonNow(h.push, h.deps);       // the reminder control's path
  expect(h.state.pushes).toBe(1);
  await maybeSummon(h.push, h.deps);     // and then the reader seals something
  expect(h.state.pushes).toBe(1);        // still one: they are not asked twice
});

it("swallows a failing flag store rather than blocking the reader", async () => {
  const failing = { asked: async () => { throw new Error("secure store gone"); }, mark: async () => {} };
  let pushed = 0;
  await maybeSummon(() => { pushed++; }, failing);
  expect(pushed).toBe(0);
});
