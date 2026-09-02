import * as AppleAuthentication from "expo-apple-authentication";
import { z } from "zod";
import { api, ApiError } from "./client";
import { getDeviceToken, clearDeviceToken } from "./auth";
import { capture } from "../analytics/analytics";
import { resetIdentity as resetPurchaseIdentity } from "../monetization/purchases";
import { resetIdentity as resetPushIdentity } from "../notifications/onesignal";

// The claim/restore trigger only needs the identity token (which carries the
// stable `sub`) to prove "this Apple ID exists" — no name/email scope, since
// those are only granted on a user's very first Apple sign-in ever and we
// don't display or store them.
async function identityToken(): Promise<string | "cancelled" | null> {
  try {
    const cred = await AppleAuthentication.signInAsync({ requestedScopes: [] });
    return cred.identityToken ?? null;
  } catch (e) {
    return (e as { code?: string }).code === "ERR_REQUEST_CANCELED" ? "cancelled" : null;
  }
}

export async function appleClaim(): Promise<"claimed" | "collision" | "cancelled" | "failed"> {
  const idt = await identityToken();
  if (idt === "cancelled") return "cancelled";
  if (!idt) return "failed";
  try {
    await api("/v1/auth/apple/claim", z.object({ claimed: z.boolean() }), {
      method: "POST",
      token: await getDeviceToken(),
      body: JSON.stringify({ identity_token: idt }),
    });
    capture("record_claimed");
    return "claimed";
  } catch (e) {
    return e instanceof ApiError && e.status === 409 ? "collision" : "failed";
  }
}

export async function appleRestore(): Promise<"restored" | "none" | "cancelled" | "failed"> {
  const idt = await identityToken();
  if (idt === "cancelled") return "cancelled";
  if (!idt) return "failed";
  try {
    await api("/v1/auth/apple/restore", z.object({ restored: z.boolean(), user_id: z.string() }), {
      method: "POST",
      token: await getDeviceToken(),
      body: JSON.stringify({ identity_token: idt }),
    });
    return "restored";
  } catch (e) {
    return e instanceof ApiError && e.status === 404 ? "none" : "failed";
  }
}

export async function strikeRecord(): Promise<boolean> {
  try {
    await api("/v1/auth/apple/strike", z.object({ struck: z.boolean() }), {
      method: "POST",
      token: await getDeviceToken(),
      body: JSON.stringify({}),
    });
    await clearDeviceToken();
    // The device row is gone; the native SDKs are still keyed to its id. Drop
    // both identities with the token, or the next launch buys entitlements
    // the webhook cannot deliver and registers for pushes nobody can address
    // (audit 2026-09-02 §4.3). Best-effort: the record IS struck either way,
    // and reporting failure here would be a lie about what happened.
    await Promise.allSettled([resetPurchaseIdentity(), resetPushIdentity()]);
    return true;
  } catch {
    return false;
  }
}
