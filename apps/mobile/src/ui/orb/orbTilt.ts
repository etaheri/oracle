// The orb answering the phone itself. Pure: the tests must never load a sensor.
//
// The design decision that makes this work without a calibration step: the
// orb responds to the *deviation* from how the phone is currently being held,
// not to an absolute angle. A slowly-tracked reference creeps toward whatever
// the hand settles at, so a tilt that is simply held fades back to neutral
// over a couple of seconds and the canonical orb is always the attractor.
// An absolute mapping would leave the brand object permanently off-centre for
// anyone whose habitual grip is not vertical.

// How far the interior can slide, in the orb's local [-1,1]. Bigger than the
// stir and smaller than a deliberate press: the phone moving is a louder
// signal than the orb breathing, and a quieter one than a finger.
export const TILT_REACH = 0.11;

// Below this much deviation, in g, nothing moves at all. A hand trying to
// hold still is never actually still, and an orb that answers tremor jitters
// -- which reads as cheap, the exact opposite of what this is for.
export const TILT_DEADBAND = 0.012;

// Local units per g of deviation past the deadband. A brisk tilt of the wrist
// is roughly a quarter of a g, and should reach most of the travel.
export const TILT_GAIN = 0.45;

// How fast the reference creeps toward the current hold. At a 33ms sample
// interval this is a time constant of about two and a half seconds.
export const TILT_REF_BETA = 0.012;

// Output smoothing per sample. The accelerometer is noisy even past the
// deadband; this is what turns a jittery signal into a glide.
export const TILT_SMOOTH = 0.18;

// One exponential step toward a target. Used for both the reference frame and
// the output glide -- same maths, very different rates.
function toward(from: number, to: number, rate: number): number {
  "worklet";
  return from + (to - from) * rate;
}

export function trackReference(ref: number, sample: number, beta: number): number {
  "worklet";
  return toward(ref, sample, beta);
}

export function smooth(prev: number, next: number, alpha: number): number {
  "worklet";
  return toward(prev, next, alpha);
}

// Subtracting the deadband rather than gating on it: gating leaves a step at
// the threshold, and a step reads as the orb snapping into place.
function knee(v: number): number {
  "worklet";
  const a = Math.abs(v);
  if (a <= TILT_DEADBAND) return 0;
  return (v < 0 ? -1 : 1) * (a - TILT_DEADBAND);
}

// `dx` is gravity's x deviation, `dz` its z. Both map straight through, and
// both signs are physical rather than chosen:
//
//   x grows as the right edge drops, and the interior is heavy -- it goes
//   WITH gravity, toward the edge that fell.
//   z drops as the phone reclines, and the orb's local +y is DOWN the screen
//   (orbTouch normalizes raw pixels), so a negative dz correctly lifts the
//   interior toward the top of the glass.
export function tiltOffset(dx: number, dz: number): readonly [number, number] {
  "worklet";
  const x = knee(dx) * TILT_GAIN;
  const y = knee(dz) * TILT_GAIN;
  const len = Math.hypot(x, y);
  if (len <= TILT_REACH) return [x, y];
  const k = TILT_REACH / len;
  return [x * k, y * k];
}
