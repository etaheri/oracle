import { describe, expect, it } from "vitest";
import {
  STAGE_ASPECT, ORB_TILE_RATIO, HAND_SLOT_RATIO, DUST_RATIO,
  stageSize, orbRect, dustRect, handSlot, handOffscreenX,
} from "../src/game/heroStage";

const W = 1000; // stage width equal to the source frame makes expectations readable

describe("heroStage", () => {
  it("keeps the hero footprint of the source frame", () => {
    expect(stageSize(W)).toEqual({ w: 1000, h: 1000 / STAGE_ASPECT });
    expect(stageSize(W).h).toBeCloseTo(562, 5);
  });

  it("centers the orb tile on (0.50, 0.47) with the measured diameter", () => {
    const r = orbRect(W);
    expect(r.w).toBeCloseTo(290, 5);
    expect(r.h).toBeCloseTo(290, 5);
    expect(r.x + r.w / 2).toBeCloseTo(500, 5);
    expect(r.y + r.h / 2).toBeCloseTo(562 * 0.47, 5);
    expect(ORB_TILE_RATIO).toBeCloseTo(290 / 562, 10);
  });

  it("centers the dust on the orb at 1.15× stage height", () => {
    const d = dustRect(W);
    const o = orbRect(W);
    expect(d.w).toBeCloseTo(562 * DUST_RATIO, 5);
    expect(d.x + d.w / 2).toBeCloseTo(o.x + o.w / 2, 5);
    expect(d.y + d.h / 2).toBeCloseTo(o.y + o.h / 2, 5);
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
