// Stage geometry for the layered hero (spec 2026-09-01-boot-orb-handoff).
// Everything is a pure function of the stage width so Home and the boot rite
// compute identical rects from the same window width.
//
// Fractions come from measuring the alpha bounds of every frame of the source
// composite (1000×562), not from eyeballing frame 0: the orb swells over the
// loop to span x 354–646, y 141–432 — a 291px circle centered at (500, 286),
// NOT the (500, 265) that frame 0 alone suggests. The hands stay clear of it:
// the left never passes x=330, the right starts at x=707.
export const STAGE_ASPECT = 1000 / 562;
export const ORB_CX = 0.5;
// The composition's atmosphere anchor — where the glow and the dust ring sit.
// A touch above the orb's true center, as the original artwork had it.
export const ORB_CY = 0.47;
// The orb tile's own center and size. The tile is cropped at (345, 131) 310×310,
// which clears the swollen orb by ~9px on every side and still misses both
// hands; centering it here reproduces the source composite exactly.
export const ORB_TILE_CY = 286 / 562;
export const ORB_TILE_RATIO = 310 / 562;
export const HAND_SLOT_RATIO = 345 / 1000;
export const DUST_RATIO = 1.15;

export type Rect = { x: number; y: number; w: number; h: number };

export function stageSize(width: number): { w: number; h: number } {
  return { w: width, h: width / STAGE_ASPECT };
}

function centeredSquare(width: number, ratioOfHeight: number, cy: number): Rect {
  const { w, h } = stageSize(width);
  const size = h * ratioOfHeight;
  return { x: w * ORB_CX - size / 2, y: h * cy - size / 2, w: size, h: size };
}

export function orbRect(width: number): Rect {
  return centeredSquare(width, ORB_TILE_RATIO, ORB_TILE_CY);
}

export function dustRect(width: number): Rect {
  return centeredSquare(width, DUST_RATIO, ORB_CY);
}

export function handSlot(width: number, side: "left" | "right"): Rect {
  const { w, h } = stageSize(width);
  const slotW = w * HAND_SLOT_RATIO;
  return { x: side === "left" ? 0 : w - slotW, y: 0, w: slotW, h };
}

// translateX that parks a hand slot entirely beyond its own screen edge (with
// a little slack so antialiased fringes never peek).
export function handOffscreenX(width: number, side: "left" | "right"): number {
  const slotW = stageSize(width).w * HAND_SLOT_RATIO * 1.1;
  return side === "left" ? -slotW : slotW;
}
