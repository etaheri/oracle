import { z } from "zod";
import { api, setUnauthorizedRecovery } from "./client";

export interface TokenStore {
  get(k: string): Promise<string | null>;
  set(k: string, v: string): Promise<void>;
  delete(k: string): Promise<void>;
}

const KEY = "oracle.device_token";
const MintSchema = z.object({ token: z.string(), user_id: z.string() });

async function secureStore(): Promise<TokenStore> {
  const SecureStore = await import("expo-secure-store");
  return {
    get: (k) => SecureStore.getItemAsync(k),
    set: (k, v) => SecureStore.setItemAsync(k, v),
    delete: (k) => SecureStore.deleteItemAsync(k),
  };
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

// After a strike, the device row itself is gone server-side — keeping the
// old token would just 401 forever. Clear it so the next getDeviceToken()
// mints a fresh device (and fresh user) rather than being stuck.
export async function clearDeviceToken(deps: { store?: TokenStore } = {}): Promise<void> {
  const store = deps.store ?? (await secureStore());
  await store.delete(KEY);
}

// The same "401 forever" the note above describes, arrived at WITHOUT a strike:
// the server no longer knows this device (its row was lost, or the database it
// lived in was reset). Nothing in the app could recover from that, and a
// reinstall could not either — SecureStore is the iOS Keychain, which outlives
// app deletion — so the install was simply dead, showing THE ORACLE SLEEPS on
// a working server.
//
// Discard the dead token and mint a new one. That does start a blank record,
// which is a real loss, but the alternative is an app that can never do
// anything again; and a player who had a record can still bring it back with
// RESTORE, which is exactly what Sign in with Apple is for.
//
// Guarded against a burst: first launch fires several queries at once, so many
// can 401 together. Whoever gets here first clears and mints (getDeviceToken's
// own inflightMint collapses the mints); everyone after that finds a token
// that is no longer the stale one and simply takes it, instead of deleting a
// freshly-minted token and starting a second user.
export async function recoverFromUnauthorized(
  staleToken: string,
  deps: { fetchFn?: typeof fetch; store?: TokenStore } = {},
): Promise<string | null> {
  const store = deps.store ?? (await secureStore());
  const current = await store.get(KEY);
  if (current && current !== staleToken) return current;
  await store.delete(KEY);
  try {
    return await getDeviceToken(deps);
  } catch {
    // The mint itself failed (offline, server down). Let the original 401
    // stand rather than reporting a mint error in its place.
    return null;
  }
}

setUnauthorizedRecovery((staleToken) => recoverFromUnauthorized(staleToken));
