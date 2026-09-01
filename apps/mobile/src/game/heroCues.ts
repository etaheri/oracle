// Cold-start cue offsets, measured from the moment the orb lands on Home
// (spec 2026-09-01-boot-orb-handoff storyboard: landing at +550ms, title at
// +900ms, epigraph at +1400ms).
export const TITLE_CUE_MS = 350;
export const EPIGRAPH_CUE_MS = 850;

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
};

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

// Schedules both cues; returns a cancel that clears whatever is still pending.
export function scheduleHeroCues(
  onTitle: () => void,
  onEpigraph: () => void,
  timers: Timers = realTimers,
): () => void {
  const ids = [timers.set(onTitle, TITLE_CUE_MS), timers.set(onEpigraph, EPIGRAPH_CUE_MS)];
  return () => ids.forEach((id) => timers.clear(id));
}
