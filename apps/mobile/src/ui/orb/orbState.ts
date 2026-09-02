// The orb's states, in ORACLE's vocabulary rather than a voice assistant's.
// Pure: no React, no Skia, no Reanimated. This module decides *what* the
// interior should be doing; OracleOrbCanvas decides how to get there.

export type OrbState = "dormant" | "waking" | "attending" | "sealed" | "revealing" | "spent";

export type OrbTargets = {
  // How fast the two interior layers slide past each other. 0 is still.
  parallax: number;
  // Positive recedes the warm centre (an outward coordinate scale); negative
  // advances it toward the front glass. It never scales toward the origin, so
  // the centre cannot collapse into a dot.
  centerDepth: number;
  // How far the centre sits off-axis.
  centerLean: number;
  // Interior-only refraction, strongest where the glass is steepest.
  refraction: number;
  // The tight glow just outside the silhouette.
  halo: number;
  // Multiplier on the shader's clock. 0 freezes the orb on its current frame.
  timeScale: number;
};

const TARGETS: Record<OrbState, OrbTargets> = {
  // The boot rite's still. Every warp at baseline, so what it holds IS the
  // reference image.
  dormant: { parallax: 0, centerDepth: 0, centerLean: 0, refraction: 0, halo: 0, timeScale: 0 },
  // The arrival: the centre comes forward and the halo lights.
  waking: { parallax: 0.35, centerDepth: -0.08, centerLean: 0.06, refraction: 0.5, halo: 0.55, timeScale: 1 },
  // A round is open. Slow opposing drift, broad and slightly off-axis warmth.
  // The cycle must not be consciously countable, hence the low parallax.
  attending: { parallax: 0.4, centerDepth: 0, centerLean: 0.08, refraction: 0.55, halo: 0.5, timeScale: 1 },
  // The player has committed. The interior settles.
  sealed: { parallax: 0.22, centerDepth: 0.04, centerLean: 0.04, refraction: 0.5, halo: 0.45, timeScale: 0.8 },
  // The crowd is shown. The centre advances and the interior opens.
  revealing: { parallax: 0.55, centerDepth: -0.16, centerLean: 0.12, refraction: 0.7, halo: 0.7, timeScale: 1.15 },
  // The day is done. The centre withdraws and cools; the halo contracts.
  spent: { parallax: 0.18, centerDepth: 0.14, centerLean: 0.02, refraction: 0.42, halo: 0.3, timeScale: 0.6 },
};

// Transients play once and resolve. Everything else is a steady state the orb
// can sit in indefinitely.
const TRANSIENT: Record<OrbState, OrbState | null> = {
  dormant: null,
  waking: "attending",
  attending: null,
  sealed: null,
  revealing: "spent",
  spent: null,
};

// The direction the state's scalar lean points. The warm centre's ambient
// off-axis drift has always been this diagonal; naming it is what lets a
// gesture or a stir add its own displacement on top without disturbing it.
const LEAN_DIR = [1, 0.4] as const;

// The state's lean plus whatever a gesture or a stir is adding. With both
// offsets at zero this is exactly the scalar mapping the shader shipped with,
// which is the whole point: the interior at rest is untouched by the
// existence of an interaction layer.
export function leanVector(stateLean: number, offsetX: number, offsetY: number): readonly [number, number] {
  "worklet";
  return [stateLean * LEAN_DIR[0] + offsetX, stateLean * LEAN_DIR[1] + offsetY];
}

export function targetsFor(state: OrbState): OrbTargets {
  return TARGETS[state];
}

// The one state that must not move at all. Derived from timeScale rather than
// naming dormant directly, so "frozen" stays whatever the targets table says
// it is. The boot rite holds a still, and a still that answers a sensor is
// not a still.
export function isFrozen(state: OrbState): boolean {
  return TARGETS[state].timeScale === 0;
}

export function isTransient(state: OrbState): boolean {
  return TRANSIENT[state] !== null;
}

export function settleTo(state: OrbState): OrbState {
  return TRANSIENT[state] ?? state;
}

// The awakening owns its duration (the brief's 700-1000ms); everything else
// crossfades slowly enough that the change is felt rather than watched.
const WAKE_MS = 850;
const STEADY_MS = 600;

export function transitionMs(from: OrbState, to: OrbState): number {
  if (from === "dormant" || to === "waking") return WAKE_MS;
  return STEADY_MS;
}

export function nextState(current: OrbState, requested: OrbState): OrbState {
  // Dormant is the boot rite's frozen still. An orb that has woken must never
  // be sent back to it -- that would freeze a live orb mid-drift.
  if (requested === "dormant" && current !== "dormant") return current;
  // A transient already running is not restarted by a repeat of its own name,
  // or a parent re-rendering with an unchanged prop would re-run the
  // awakening on every commit.
  if (requested === current) return current;
  return requested;
}
