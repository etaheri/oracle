import { describe, expect, it } from "vitest";
import { asciiGauge, decodeFrame, GAUGE_CELLS, blinkFrame } from "../src/game/terminalPrint";

describe("decodeFrame", () => {
  const text = "THE ORACLE SPEAKS";
  const steps = 8;

  it("returns the exact text at the final step", () => {
    expect(decodeFrame(text, steps, steps, "seed")).toBe(text);
    expect(decodeFrame(text, steps + 3, steps, "seed")).toBe(text);
  });

  it("preserves length and spaces at every step", () => {
    for (let s = 0; s <= steps; s++) {
      const frame = decodeFrame(text, s, steps, "seed");
      expect(frame.length).toBe(text.length);
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") expect(frame[i]).toBe(" ");
      }
    }
  });

  it("reveals a monotone prefix of the real text", () => {
    let prev = 0;
    for (let s = 0; s <= steps; s++) {
      const frame = decodeFrame(text, s, steps, "seed");
      let revealed = 0;
      while (revealed < text.length && frame[revealed] === text[revealed]) revealed++;
      expect(revealed).toBeGreaterThanOrEqual(prev);
      prev = revealed;
    }
    expect(prev).toBe(text.length);
  });

  it("is deterministic for the same seed and step", () => {
    expect(decodeFrame(text, 3, steps, "a")).toBe(decodeFrame(text, 3, steps, "a"));
  });

  it("varies noise between steps so the scramble lives", () => {
    const a = decodeFrame("XXXXXXXXXXXXXXXXXXXX", 1, 100, "a");
    const b = decodeFrame("XXXXXXXXXXXXXXXXXXXX", 2, 100, "a");
    expect(a).not.toBe(b);
  });

  it("never emits the real character early by accident of the pool", () => {
    // Pool is symbols only, so an unrevealed letter can never masquerade as final.
    const frame = decodeFrame("ABCDEFGH", 0, 8, "seed");
    expect(frame).not.toMatch(/[A-Z]/);
  });
});

describe("asciiGauge", () => {
  it("renders empty and full", () => {
    expect(asciiGauge(0)).toBe(`[${"·".repeat(GAUGE_CELLS)}]`);
    expect(asciiGauge(100)).toBe(`[${"#".repeat(GAUGE_CELLS)}]`);
  });

  it("fills proportionally", () => {
    const half = asciiGauge(50);
    const hashes = (half.match(/#/g) ?? []).length;
    expect(hashes).toBe(Math.round(GAUGE_CELLS / 2));
    expect(half.length).toBe(GAUGE_CELLS + 2);
  });

  it("clamps out-of-range input", () => {
    expect(asciiGauge(-10)).toBe(asciiGauge(0));
    expect(asciiGauge(140)).toBe(asciiGauge(100));
  });

  it("scales with a partial print progress", () => {
    const full = (asciiGauge(80, 1).match(/#/g) ?? []).length;
    const mid = (asciiGauge(80, 0.5).match(/#/g) ?? []).length;
    expect(mid).toBeLessThan(full);
    expect((asciiGauge(80, 0).match(/#/g) ?? []).length).toBe(0);
  });
});

describe("blinkFrame", () => {
  it("holds characters that did not change and noises only the ones that did", () => {
    const f = blinkFrame("70%", "75%", "col");
    expect(f[0]).toBe("7");
    expect(f[1]).not.toBe("5");
    expect(f[1]).not.toMatch(/[0-9]/); // symbols only — never a wrong digit
    expect(f[2]).toBe("%");
  });
  it("noises every changed character when both digits roll (55 → 60)", () => {
    const f = blinkFrame("55%", "60%", "col");
    expect(f[0]).not.toMatch(/[0-9]/);
    expect(f[1]).not.toMatch(/[0-9]/);
    expect(f[2]).toBe("%");
  });
  it("is a no-op when nothing changed", () => {
    expect(blinkFrame("80%", "80%", "col")).toBe("80%");
  });
  it("treats positions beyond the previous text as changed", () => {
    const f = blinkFrame("9%", "95%", "col");
    expect(f).toHaveLength(3);
    expect(f[0]).toBe("9");
    expect(f[1]).not.toMatch(/[0-9]/); // '%' is a legal noise symbol, so only digits are ruled out
  });
});
