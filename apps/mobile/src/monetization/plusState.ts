import { create } from "zustand";

// RN-free (testable): the fact of "is plus active" reduces to one entitlement
// check, kept separate from the RevenueCat SDK so it needs no native module.
export function plusFromCustomerInfo(info: { entitlements: { active: Record<string, unknown> } }): boolean {
  return "plus" in info.entitlements.active;
}

export const usePlusStore = create<{ plusActive: boolean; loading: boolean; set: (v: boolean) => void }>((set) => ({
  plusActive: false,
  loading: true,
  set: (v) => set({ plusActive: v, loading: false }),
}));
