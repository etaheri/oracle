// The Calling's pure logic: which rite mounts on cold start, and how each
// beat lands in the hand. The cinematic itself lives in ui/CallingRite.tsx.

// null = the calling_seen flag is still being read — cover the screen and
// decide nothing, so the wrong rite never flashes.
export type RiteChoice = "hold" | "calling" | "boot";
export function chooseRite(callingSeen: boolean | null): RiteChoice {
  if (callingSeen === null) return "hold";
  return callingSeen ? "boot" : "calling";
}

// Beats land, they don't buzz: Light as each line resolves from the static,
// Heavy on the final beat — the one that reaches the player.
export type CallingHaptic = "light" | "heavy";
export function callingHaptic(index: number, total: number): CallingHaptic {
  return index === total - 1 ? "heavy" : "light";
}
