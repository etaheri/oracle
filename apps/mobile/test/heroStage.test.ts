import { describe, expect, it } from "vitest";
import {
  STAGE_ASPECT, ORB_CY, ORB_TILE_CY, ORB_TILE_RATIO, HAND_SLOT_RATIO, DUST_RATIO,
  stageSize, orbRect, dustRect, handSlot, handOffscreenX,
} from "../src/game/heroStage";

const W = 1000; // stage width equal to the source frame makes expectations readable

describe("heroStage", () => {
  it("keeps the hero footprint of the source frame", () => {
    expect(stageSize(W)).toEqual({ w: 1000, h: 1000 / STAGE_ASPECT });
    expect(stageSize(W).h).toBeCloseTo(562, 5);
  });

  it("centers the orb tile on the orb's measured center, not the atmosphere anchor", () => {
    const r = orbRect(W);
    expect(r.w).toBeCloseTo(310, 5);
    expect(r.h).toBeCloseTo(310, 5);
    expect(r.x + r.w / 2).toBeCloseTo(500, 5);
    expect(r.y + r.h / 2).toBeCloseTo(286, 5);
    expect(ORB_TILE_RATIO).toBeCloseTo(310 / 562, 10);
    expect(ORB_TILE_CY).toBeCloseTo(286 / 562, 10);
  });

  // The source orb swells to x 354–646, y 141–432 over its loop. The tile has
  // to contain that at every frame or the sphere renders with a flat edge.
  it("holds the whole swollen orb inside the tile", () => {
    const r = orbRect(W);
    expect(r.x).toBeLessThanOrEqual(354);
    expect(r.x + r.w).toBeGreaterThanOrEqual(646);
    expect(r.y).toBeLessThanOrEqual(141);
    expect(r.y + r.h).toBeGreaterThanOrEqual(432);
  });

  // ...and must not reach into either hand's slot, or the tiles double-draw.
  it("keeps the orb tile clear of both hands", () => {
    const r = orbRect(W);
    expect(r.x).toBeGreaterThanOrEqual(330); // left hand's furthest reach
    expect(r.x + r.w).toBeLessThanOrEqual(707); // right hand's nearest pixel
  });

  it("centers the dust on the atmosphere anchor at 1.15× stage height", () => {
    const d = dustRect(W);
    const o = orbRect(W);
    expect(d.w).toBeCloseTo(562 * DUST_RATIO, 5);
    expect(d.x + d.w / 2).toBeCloseTo(o.x + o.w / 2, 5);
    expect(d.y + d.h / 2).toBeCloseTo(562 * ORB_CY, 5);
  });

  it("places hand slots flush to their edges, full height", () => {
    expect(HAND_SLOT_RATIO).toBeCloseTo(345 / 1000, 10);
    expect(handSlot(W, "left")).toEqual({ x: 0, y: 0, w: 345, h: 1000 / STAGE_ASPECT });
    const right = handSlot(W, "right");
    expect(right.x).toBeCloseTo(655, 5);
    expect(right.w).toBeCloseTo(345, 5);
  });

  it("offscreen offsets push each slot fully past its own edge", () => {
    expect(handOffscreenX(W, "left")).toBeLessThanOrEqual(-345);
    expect(handOffscreenX(W, "right")).toBeGreaterThanOrEqual(345);
  });

  it("scales linearly with width", () => {
    const a = orbRect(390);
    const b = orbRect(780);
    expect(b.w).toBeCloseTo(a.w * 2, 5);
    expect(b.x).toBeCloseTo(a.x * 2, 5);
  });
});
