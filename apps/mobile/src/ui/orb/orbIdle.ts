// The orb's unprompted motion: the signal that the glass is a thing you can
// touch. Pure, and deliberately tiny -- the brief asks for "almost
// imperceptible breathing", and anything a player can time reads as a pulse.
import { isTransient, type OrbState } from "./orbState";

// The stir window. Wide and jittered so the rhythm is never countable.
export const STIR_MIN_MS = 5000;
export const STIR_MAX_MS = 10000;
// A stir's own shape: out over this long, then back over the same.
export const STIR_RISE_MS = 1800;
// How far the warm centre wanders. Smaller than any state's own lean, so a
// stir decorates the state rather than reading as a change of one.
export const STIR_LEAN = 0.06;
export const STIR_HALO = 0.13;

// The greeting: on the day's first arrival the orb ripples once, by itself,
// a beat after it lands. It teaches the gesture without a word of copy.
export const GREET_DELAY_MS = 1800;
export const GREET_STRENGTH = 0.85;

// Only the states the orb can sit in indefinitely stir. dormant is the boot
// rite's frozen still, and a transient already owns the interior for the
// length of its own animation.
export function stirs(state: OrbState): boolean {
  return state !== "dormant" && !isTransient(state);
}

export function nextStirDelay(rand: number): number {
  const r = rand < 0 ? 0 : rand > 1 ? 1 : rand;
  return STIR_MIN_MS + (STIR_MAX_MS - STIR_MIN_MS) * r;
}

// A direction on the circle, at the stir's fixed reach. Successive stirs pull
// the centre different ways, so the orb never appears to rock between two
// poses.
export function stirVector(rand: number): readonly [number, number] {
  const a = rand * Math.PI * 2;
  return [Math.cos(a) * STIR_LEAN, Math.sin(a) * STIR_LEAN];
}
