import { describe, it, expect } from "vitest";
import { payoffLine } from "../src/game/payoffLine";

describe("payoffLine", () => {
  it("prints the honest ladder with a true minus sign", () => {
    expect(payoffLine(55, false)).toBe("+10 IF RIGHT · −10 IF WRONG");
    expect(payoffLine(75, false)).toBe("+38 IF RIGHT · −62 IF WRONG");
    expect(payoffLine(95, true)).toBe("+99 IF RIGHT · −261 IF WRONG");
  });
});
