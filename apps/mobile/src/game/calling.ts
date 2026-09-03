// The Calling's pure logic: which rite mounts on cold start, and how each
// beat lands in the hand. The cinematic itself lives in ui/CallingRite.tsx.

// Both rites are a handoff into Home's orb — the boot rite literally slides
// its orb to Home's measured anchor, and with no anchor to reach it can only
// dissolve. So a cold start that opens anywhere else (a push tap into a
// reveal, a shared link) gets no rite at all: "none" is the app arriving
// where it was sent, with no curtain over it and no cover held while the
// flag reads. The Calling is not spent either — unmarked, it still waits for
// the first open that actually lands on Home.
//
// null = the calling_seen flag is still being read — cover the screen and
// decide nothing, so the wrong rite never flashes.
export type RiteChoice = "hold" | "calling" | "boot" | "none";
export function chooseRite(callingSeen: boolean | null, onHome: boolean): RiteChoice {
  if (!onHome) return "none";
  if (callingSeen === null) return "hold";
  return callingSeen ? "boot" : "calling";
}

// Where the app opened, read off the router's resolved path rather than off
// the raw launch URL. A URL would have to be parsed (`oracle://reveal/x` and
// `oracle:///reveal/x` disagree about which part is the host) and matched
// against a list of known screens; a path is what the router already decided,
// so an unroutable link that lands on Home reads as Home, which is right.
// Empty is not a route: treat it as Home, so an unresolved path can only ever
// cost a rite its first frame, never suppress it on an ordinary cold start.
export function openedOnHome(pathname: string): boolean {
  return pathname === "" || pathname === "/";
}

// Beats land, they don't buzz: Light as each line resolves from the static,
// Heavy on the final beat — the one that reaches the player.
export type CallingHaptic = "light" | "heavy";
export function callingHaptic(index: number, total: number): CallingHaptic {
  return index === total - 1 ? "heavy" : "light";
}
