import { describe, it, expect } from "vitest";
import { formatFortune, signedFortune, returnPct } from "../src/game/fortuneText";

describe("fortune formatting", () => {
  it("groups thousands", () => {
    expect(formatFortune(1000)).toBe("1,000");
    expect(formatFortune(940)).toBe("940");
    expect(formatFortune(-1240)).toBe("−1,240");
  });
  it("signs a delta with a true minus sign", () => {
    expect(signedFortune(140)).toBe("+140");
    expect(signedFortune(-60)).toBe("−60");
    expect(signedFortune(0)).toBe("0");
    expect(signedFortune(1002)).toBe("+1,002");
  });
  it("prints basis points as a signed percent with one decimal", () => {
    expect(returnPct(10020)).toBe("+100.2%");
    expect(returnPct(-600)).toBe("−6.0%");
    expect(returnPct(0)).toBe("0.0%");
  });
});
