import { describe, expect, it } from "vitest";
import { locate, ORB_D, ORB_DY } from "../src/ui/orb/orbTouch";

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
