// A finger on the glass, in the orb's own terms. Pure: the tests must never
// load Skia or Reanimated.
//
// Everything here maps a contact point and a *bloom* -- how far a hold has
// developed, 0 at touchdown and 1 once it is fully open -- onto offsets that
// are ADDED to whatever the current state already asked for. At bloom 0 every
// offset is zero, so a finger resting on the orb leaves the state's own look
// untouched. That is the same baseline-identity bet the shader makes.
import type { OrbPoint } from "./orbTouch";

// How long a hold takes to open fully. Long enough that the bloom is a thing
// you watch happen, short enough that an ordinary press reaches most of it.
export const HOLD_FULL_MS = 700;

// How far the warm centre travels toward a finger at the rim. Better than
// twice the ambient lean the `attending` state carries on its own, so a press
// does not read as a slightly stronger version of standing still -- the light
// plainly comes to meet your finger.
export const LEAN_REACH = 0.18;

// The centre advances toward the front glass while held. Negative is forward
// (see orbState's centerDepth). Deliberately past `revealing`'s -0.16: a hold
// is the closest the interior ever comes to the front of the glass, because
// it is the one moment the player is actively asking it to.
export const HOLD_DEPTH = -0.22;

// The halo swells while the orb is held -- from `attending`'s 0.5 to 0.8, a
// glow you notice from the corner of your eye rather than one you have to
// look for.
export const HOLD_HALO = 0.3;

// The dimple under the fingertip reaches full depth in a third of the bloom:
// the touch must register at once, and only the opening is slow.
const CONTACT_RUSH = 3;

export type GestureOffsets = {
  leanX: number;
  leanY: number;
  depth: number;
  halo: number;
  // The local lens under the fingertip, 0..1.
  contact: number;
};

function clamp01(v: number): number {
  "worklet";
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function offsetsFor(local: OrbPoint, bloom: number): GestureOffsets {
  "worklet";
  const b = clamp01(bloom);
  // A touch is never past the rim -- locate() rejects those -- but a lean
  // beyond the silhouette would sample outside the interior, so the clamp is
  // geometric rather than trusting.
  const len = Math.hypot(local.x, local.y);
  const k = len > 1 ? 1 / len : 1;
  return {
    leanX: local.x * k * LEAN_REACH * b,
    leanY: local.y * k * LEAN_REACH * b,
    depth: HOLD_DEPTH * b,
    halo: HOLD_HALO * b,
    contact: clamp01(b * CONTACT_RUSH),
  };
}

// The ripple a release fires. A bare tap already rings clearly -- the tap is
// the orb's whole answer, and an answer you can barely see is not one -- and
// a full hold releases everything the shader has.
const TAP_STRENGTH = 0.7;

export function releaseStrength(bloom: number): number {
  "worklet";
  return Math.min(1, TAP_STRENGTH + (1 - TAP_STRENGTH) * clamp01(bloom));
}

export function releaseHaptic(bloom: number): "light" | "medium" {
  "worklet";
  return clamp01(bloom) >= 0.5 ? "medium" : "light";
}
