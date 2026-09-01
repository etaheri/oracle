// Ripple slots. Two at most, because the shader carries two ripple uniforms
// and a third would have to displace one of them anyway -- better to choose
// which, here, in code that can be reasoned about, than in SkSL.
import type { OrbPoint } from "./orbTouch";

// A ripple's whole life, in milliseconds: compression, the wave crossing the
// sphere, the warm centre leaning, then the return to the steady state.
export const RIPPLE_MS = 1300;

export type Ripple = { origin: OrbPoint; startMs: number; strength: number };
export type RippleSlots = readonly [Ripple | null, Ripple | null];

export const EMPTY_SLOTS: RippleSlots = [null, null];

function done(r: Ripple | null, nowMs: number): boolean {
  return r === null || nowMs - r.startMs >= RIPPLE_MS;
}

export function assign(
  slots: RippleSlots,
  next: Ripple,
  nowMs: number,
  capacity: number = 2,
): RippleSlots {
  const out: (Ripple | null)[] = [slots[0], slots[1]];
  const usable = capacity >= 2 ? 2 : 1;

  // The reduced tier owns one slot; the second is held empty rather than
  // left stale, so dropping a tier never leaves a ripple frozen mid-travel.
  if (usable === 1) return [next, null];

  // A free or finished slot first -- a tap should never cut a live ripple
  // short while a spent one sits idle beside it.
  for (let i = 0; i < usable; i++) {
    if (done(out[i], nowMs)) {
      out[i] = next;
      return [out[0], out[1]];
    }
  }

  // Both still travelling: the weakest yields, and on a tie the oldest does,
  // since it is closest to finishing anyway.
  const a = out[0]!;
  const b = out[1]!;
  const replaceFirst = a.strength < b.strength || (a.strength === b.strength && a.startMs <= b.startMs);
  out[replaceFirst ? 0 : 1] = next;
  return [out[0], out[1]];
}
