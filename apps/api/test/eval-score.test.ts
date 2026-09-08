import { describe, expect, it } from "vitest";
import { score, formatConfusion } from "../eval/score";

describe("score", () => {
  it("counts the two error kinds separately", () => {
    const c = score([
      { expected: "pass", actual: "pass" },
      { expected: "reject", actual: "reject" },
      { expected: "reject", actual: "pass" },
      { expected: "pass", actual: "reject" },
    ]);
    expect(c).toEqual({ truePass: 1, trueReject: 1, falsePass: 1, falseReject: 1 });
  });

  it("reports false passes first, because they are the expensive error", () => {
    // A false ACCEPT on taste is a brand and App Review incident. A false
    // REJECT is free — surplus absorbs it. A single accuracy number over a
    // gate this asymmetric would hide the only error that matters.
    const out = formatConfusion("taste", { truePass: 8, trueReject: 4, falsePass: 2, falseReject: 1 });
    expect(out.indexOf("false-pass")).toBeLessThan(out.indexOf("false-reject"));
    expect(out).toContain("2");
  });
});
