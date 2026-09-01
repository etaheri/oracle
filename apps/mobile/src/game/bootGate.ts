import type { Rect } from "./heroStage";

// The boot gate: module-level phase signals for the once-per-process boot
// rite (spec 2026-09-01-boot-orb-handoff).
//   bootDone  — the rite's hold elapsed; the field is fading. Home's bottom
//               DecodeLines print now, so the static resolves in view.
//   orbLanded — the rite's orb has arrived at Home's anchor (or there was no
//               slide). Home mounts its own orb and cues title/epigraph.
// Plus the hero anchor: the orb tile's rect in window coordinates, published
// by Home whenever its layout settles, read once by the rite at `done`.

type Signal = { fired: boolean; listeners: Set<() => void> };
const bootDone: Signal = { fired: false, listeners: new Set() };
const orbLanded: Signal = { fired: false, listeners: new Set() };
let heroAnchor: Rect | null = null;

function fire(s: Signal): void {
  if (s.fired) return;
  s.fired = true;
  s.listeners.forEach((l) => l());
  s.listeners.clear();
}

// Calls cb immediately if already fired; otherwise on fire. Returns unsubscribe.
function listen(s: Signal, cb: () => void): () => void {
  if (s.fired) {
    cb();
    return () => {};
  }
  s.listeners.add(cb);
  return () => s.listeners.delete(cb);
}

export function markBootDone(): void { fire(bootDone); }
export function onBootDone(cb: () => void): () => void { return listen(bootDone, cb); }
export function isBootDone(): boolean { return bootDone.fired; }

export function markOrbLanded(): void { fire(orbLanded); }
export function onOrbLanded(cb: () => void): () => void { return listen(orbLanded, cb); }
export function isOrbLanded(): boolean { return orbLanded.fired; }

export function setHeroAnchor(rect: Rect): void { heroAnchor = rect; }
export function getHeroAnchor(): Rect | null { return heroAnchor; }

// Test seam only.
export function resetBootGateForTest(): void {
  for (const s of [bootDone, orbLanded]) { s.fired = false; s.listeners.clear(); }
  heroAnchor = null;
}
