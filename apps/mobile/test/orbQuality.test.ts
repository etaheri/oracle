import { describe, expect, it } from "vitest";
import {
  dispersionEnabled,
  interiorSamples,
  resolve,
  rippleCapacity,
} from "../src/ui/orb/orbQuality";

const ok = { reducedMotion: false, compiled: true, imagesReady: true };

describe("resolve", () => {
  it("runs high when everything is available", () => {
    expect(resolve(ok)).toBe("high");
    expect(resolve({ ...ok, prop: "auto" })).toBe("high");
  });

  it("falls to static when the shader did not compile", () => {
    expect(resolve({ ...ok, compiled: false })).toBe("static");
  });

  it("falls to static when the images are not loaded", () => {
    expect(resolve({ ...ok, imagesReady: false })).toBe("static");
  });

  it("falls to static under reduced motion", () => {
    expect(resolve({ ...ok, reducedMotion: true })).toBe("static");
  });

  it("lets an explicit prop pick a lower tier", () => {
    expect(resolve({ ...ok, prop: "reduced" })).toBe("reduced");
    expect(resolve({ ...ok, prop: "static" })).toBe("static");
  });

  it("never lets a prop override a hard failure", () => {
    // Asking for high on a device where the shader failed must not render a
    // shader. The signals are facts; the prop is only a preference.
    expect(resolve({ ...ok, prop: "high", compiled: false })).toBe("static");
    expect(resolve({ ...ok, prop: "high", reducedMotion: true })).toBe("static");
    expect(resolve({ ...ok, prop: "reduced", imagesReady: false })).toBe("static");
  });
});

describe("tier capabilities", () => {
  it("gives the high tier two ripples, two samples, and dispersion", () => {
    expect(rippleCapacity("high")).toBe(2);
    expect(interiorSamples("high")).toBe(2);
    expect(dispersionEnabled("high")).toBe(true);
  });

  it("halves the reduced tier and drops dispersion", () => {
    expect(rippleCapacity("reduced")).toBe(1);
    expect(interiorSamples("reduced")).toBe(1);
    expect(dispersionEnabled("reduced")).toBe(false);
  });

  it("gives the static tier no ripples at all", () => {
    expect(rippleCapacity("static")).toBe(0);
    expect(dispersionEnabled("static")).toBe(false);
  });
});
