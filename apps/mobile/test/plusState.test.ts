import { describe, it, expect } from "vitest";
import { plusFromCustomerInfo } from "../src/monetization/plusState";

describe("plusFromCustomerInfo", () => {
  it("is true iff the plus entitlement is active", () => {
    expect(plusFromCustomerInfo({ entitlements: { active: { plus: {} } } })).toBe(true);
    expect(plusFromCustomerInfo({ entitlements: { active: {} } })).toBe(false);
    expect(plusFromCustomerInfo({ entitlements: { active: { other: {} } } })).toBe(false);
  });
});
