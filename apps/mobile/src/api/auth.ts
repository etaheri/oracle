import { z } from "zod";
import { api } from "./client";

export interface TokenStore { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; }

const KEY = "oracle.device_token";
const MintSchema = z.object({ token: z.string(), user_id: z.string() });

async function secureStore(): Promise<TokenStore> {
  const SecureStore = await import("expo-secure-store");
  return { get: (k) => SecureStore.getItemAsync(k), set: (k, v) => SecureStore.setItemAsync(k, v) };
}

// First launch fires several queries at once (today, ledger, reveal); each
// calls getDeviceToken, and without a shared in-flight mint each would
// create its own server user — a user per query. One mint, shared by all.
let inflightMint: Promise<string> | null = null;

export async function getDeviceToken(deps: { fetchFn?: typeof fetch; store?: TokenStore } = {}): Promise<string> {
  const store = deps.store ?? (await secureStore());
  const existing = await store.get(KEY);
  if (existing) return existing;
  if (!inflightMint) {
    inflightMint = (async () => {
      const { token } = await api("/v1/auth/device", MintSchema, {
        method: "POST",
        body: JSON.stringify({ platform: "ios" }),
        fetchFn: deps.fetchFn,
      });
      await store.set(KEY, token);
      return token;
    })().finally(() => { inflightMint = null; });
  }
  return inflightMint;
}

// The device token is `deviceId.issuedAtMs.hmac` (see apps/api/src/auth/deviceToken.ts);
// the RevenueCat app user ID is that same deviceId, so purchases survive a
// reinstall the same way the rest of the account does. No token yet →
// no id yet — never mint one just to identify a purchaser.
export async function getDeviceId(deps: { store?: TokenStore } = {}): Promise<string | null> {
  try {
    const store = deps.store ?? (await secureStore());
    const token = await store.get(KEY);
    if (!token) return null;
    const deviceId = token.split(".")[0];
    return deviceId || null;
  } catch {
    return null;
  }
}
