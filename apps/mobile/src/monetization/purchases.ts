import Purchases, { type PurchasesOffering, type PurchasesPackage } from "react-native-purchases";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";
import { plusFromCustomerInfo, usePlusStore } from "./plusState";
import { capture } from "../analytics/analytics";

// RN module — imports react-native-purchases, so this file is typecheck +
// manual-pass only; the pure entitlement check lives in plusState.ts, which
// vitest exercises without ever loading this one.
let configured = false;

export async function initPurchases(): Promise<void> {
  if (configured || !KEYS.rcIos) {
    usePlusStore.getState().set(false);
    return;
  }
  const deviceId = await getDeviceId();
  if (!deviceId) {
    usePlusStore.getState().set(false);
    return;
  }
  Purchases.configure({ apiKey: KEYS.rcIos, appUserID: deviceId }); // spec §2: app user ID = device ID, forever
  configured = true;
  Purchases.addCustomerInfoUpdateListener((info) => usePlusStore.getState().set(plusFromCustomerInfo(info)));
  try {
    usePlusStore.getState().set(plusFromCustomerInfo(await Purchases.getCustomerInfo()));
  } catch {
    usePlusStore.getState().set(false);
  }
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    return (await Purchases.getOfferings()).current;
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  if (!configured) return false;
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    usePlusStore.getState().set(plusFromCustomerInfo(customerInfo));
    capture("purchase_completed", { product: "subscription", package_id: pkg.identifier });
    return true;
  } catch {
    return false; // user-cancelled and store errors land here; UI shows the quiet error line
  }
}

export async function purchaseRescue(): Promise<boolean> {
  if (!configured) return false;
  try {
    const products = await Purchases.getProducts(["shield_rescue"]);
    if (!products[0]) return false;
    await Purchases.purchaseStoreProduct(products[0]);
    capture("purchase_completed", { product: "shield_rescue" });
    return true;
  } catch {
    return false;
  }
}

export async function restore(): Promise<void> {
  if (!configured) return;
  try {
    usePlusStore.getState().set(plusFromCustomerInfo(await Purchases.restorePurchases()));
  } catch {
    // degrade: leave plus state as it was
  }
}

export function usePlus(): { plusActive: boolean; loading: boolean } {
  const plusActive = usePlusStore((s) => s.plusActive);
  const loading = usePlusStore((s) => s.loading);
  return { plusActive, loading };
}
