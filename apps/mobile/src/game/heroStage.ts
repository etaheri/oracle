// Stage geometry for the layered hero (spec 2026-09-01-boot-orb-handoff).
// Fractions are measured from hero-loop.webp frame 0 (1000×562): the orb is a
// clean circle centered at (500, 265), r≈135; the hands never cross x=345 /
// x=655. Everything is a pure function of the stage width so Home and the
// boot rite compute identical rects from the same window width.
export const STAGE_ASPECT = 1000 / 562;
export const ORB_CX = 0.5;
export const ORB_CY = 0.47;
export const ORB_TILE_RATIO = 290 / 562;
export const HAND_SLOT_RATIO = 345 / 1000;
export const DUST_RATIO = 1.15;

export type Rect = { x: number; y: number; w: number; h: number };

export function stageSize(width: number): { w: number; h: number } {
  return { w: width, h: width / STAGE_ASPECT };
}

function centeredSquare(width: number, ratioOfHeight: number): Rect {
  const { w, h } = stageSize(width);
  const size = h * ratioOfHeight;
  return { x: w * ORB_CX - size / 2, y: h * ORB_CY - size / 2, w: size, h: size };
}

export function orbRect(width: number): Rect {
  return centeredSquare(width, ORB_TILE_RATIO);
}

export function dustRect(width: number): Rect {
  return centeredSquare(width, DUST_RATIO);
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
