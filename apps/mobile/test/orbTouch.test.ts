import { describe, expect, it } from "vitest";
import { locate, normalize, ORB_D, ORB_DY } from "../src/ui/orb/orbTouch";

// A 310px tile, the size the hero stage gives the orb on a typical phone.
const TILE = 310;
// The orb's centre inside that tile: horizontally centred, lifted by ORB_DY.
const CX = TILE / 2;
const CY = TILE / 2 + ORB_DY * TILE;
const R = (ORB_D * TILE) / 2;

describe("locate", () => {
  it("puts the orb's centre at the origin", () => {
    const hit = locate({ x: CX, y: CY }, TILE);
    expect(hit).not.toBeNull();
    expect(hit!.local.x).toBeCloseTo(0, 5);
    expect(hit!.local.y).toBeCloseTo(0, 5);
  });

  it("faces the viewer at the centre", () => {
    const [nx, ny, nz] = locate({ x: CX, y: CY }, TILE)!.normal;
    expect(nx).toBeCloseTo(0, 5);
    expect(ny).toBeCloseTo(0, 5);
    expect(nz).toBeCloseTo(1, 5);
  });

  it("reaches exactly 1 at the silhouette", () => {
    const hit = locate({ x: CX + R * 0.999, y: CY }, TILE)!;
    expect(hit.local.x).toBeCloseTo(0.999, 3);
    // At the rim the normal lies very nearly in the screen plane.
    expect(hit.normal[2]).toBeLessThan(0.05);
  });

  it("rejects a touch outside the circle", () => {
    expect(locate({ x: CX + R * 1.01, y: CY }, TILE)).toBeNull();
    // The tile's corners are outside the orb and must not be tappable.
    expect(locate({ x: 0, y: 0 }, TILE)).toBeNull();
    expect(locate({ x: TILE, y: TILE }, TILE)).toBeNull();
  });

  it("accounts for the orb sitting above the tile's centre", () => {
    // The tile's own centre is BELOW the orb's, so its local y is positive.
    const hit = locate({ x: CX, y: TILE / 2 }, TILE)!;
    expect(hit.local.y).toBeGreaterThan(0);
  });

  it("returns a unit normal everywhere inside", () => {
    for (const [dx, dy] of [[0.3, -0.4], [-0.7, 0.2], [0.0, 0.9], [0.5, 0.5]]) {
      const [nx, ny, nz] = locate({ x: CX + dx * R, y: CY + dy * R }, TILE)!.normal;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
    }
  });

  it("survives a degenerate tile without producing NaN", () => {
    expect(locate({ x: 0, y: 0 }, 0)).toBeNull();
    expect(locate({ x: Number.NaN, y: 0 }, TILE)).toBeNull();
  });
});

describe("normalize", () => {
  it("puts the orb's centre at the origin", () => {
    // The centre sits ORB_DY above the tile's own centre.
    const p = normalize({ x: 155, y: 155 + ORB_DY * 310 }, 310);
    expect(p.x).toBeCloseTo(0, 10);
    expect(p.y).toBeCloseTo(0, 10);
  });

  it("puts the rim at unit distance", () => {
    const r = (ORB_D * 310) / 2;
    const p = normalize({ x: 155 + r, y: 155 + ORB_DY * 310 }, 310);
    expect(p.x).toBeCloseTo(1, 10);
  });

  it("keeps reporting a finger that has slid off the glass", () => {
    // A drag does not end at the rim -- the fingertip carries on, and the
    // interior has to be told so it can let go rather than stick.
    const p = normalize({ x: 310, y: 0 }, 310);
    expect(Math.hypot(p.x, p.y)).toBeGreaterThan(1);
  });

  it("agrees with locate wherever locate answers at all", () => {
    const hit = locate({ x: 200, y: 120 }, 310);
    expect(hit).not.toBeNull();
    expect(normalize({ x: 200, y: 120 }, 310)).toEqual(hit!.local);
  });
});
