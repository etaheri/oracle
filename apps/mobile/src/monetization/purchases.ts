import Purchases, { type PurchasesOffering, type PurchasesPackage } from "react-native-purchases";
import { KEYS } from "../config/keys";
import { getDeviceId } from "../api/auth";
import { plusFromCustomerInfo, usePlusStore } from "./plusState";
import { capture } from "../analytics/analytics";

// RN module — imports react-native-purchases, so this file is typecheck +
// manual-pass only; the pure entitlement check lives in plusState.ts, which
// vitest exercises without ever loading this one.
let configured = false;
// Shared in-flight promise (same idiom as onesignal.ts / api/auth.ts
// inflightMint): boot fires initPurchases() fire-and-forget on fresh
// install, before the device token exists — getDeviceId() returns null and
// the old code would go dark for the whole session. Every caller (boot AND
// getOffering/purchasePackage/purchaseRescue) now awaits the SAME init, so
// a later call — once the token exists — can still complete it.
let inflight: Promise<void> | null = null;

export async function initPurchases(): Promise<void> {
  // Already configured: return without touching the store. The old combined
  // guard (`configured || !KEYS.rcIos`) called set(false) here too, which
  // would clobber a live plusActive on any re-entry (e.g. purchasePackage
  // calling initPurchases() again right before a purchase).
  if (configured) return;
  const rcIosKey = KEYS.rcIos;
  if (!rcIosKey) {
    usePlusStore.getState().set(false); // keyless is permanent and dark — unchanged
    return;
  }
  if (!inflight) {
    inflight = (async () => {
      const deviceId = await getDeviceId();
      if (!deviceId) {
        // No device token yet (fresh-install race). Don't set(false) — that
        // would assert "known not-plus" when we simply don't know, and would
        // block a later, successful init from ever promoting the state.
        // Just stop loading so the UI doesn't spin forever.
        usePlusStore.setState({ loading: false });
        return;
      }
      Purchases.configure({ apiKey: rcIosKey, appUserID: deviceId }); // spec §2: app user ID = device ID, forever
      configured = true;
      Purchases.addCustomerInfoUpdateListener((info) => usePlusStore.getState().set(plusFromCustomerInfo(info)));
      try {
        usePlusStore.getState().set(plusFromCustomerInfo(await Purchases.getCustomerInfo()));
      } catch {
        usePlusStore.getState().set(false);
      }
    })().finally(() => { inflight = null; });
  }
  return inflight;
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  await initPurchases();
  if (!configured) return null;
  try {
    return (await Purchases.getOfferings()).current;
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  await initPurchases();
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
  await initPurchases();
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

// Striking the record deletes the device row server-side and mints a fresh
// one on the next call. Without this, `configured` stayed true and the SDK
// stayed logged in as the DELETED device id — so every later purchase was
// attributed to a device the RevenueCat webhook can no longer resolve
// ("unknown app_user_id"), and the entitlement was lost for good until the
// app was force-quit (audit 2026-09-02 §4.3). Log out, forget, and let the
// next initPurchases configure against the new identity.
export async function resetIdentity(): Promise<void> {
  const wasConfigured = configured;
  configured = false;
  inflight = null;
  usePlusStore.setState({ plusActive: false, loading: true });
  if (!wasConfigured) return;
  try {
    await Purchases.logOut();
  } catch {
    // Already anonymous, or the store is unreachable — either way the local
    // state above is what guards the next purchase.
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
