import { z } from "zod";
import { api } from "./client";

export interface TokenStore { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; }

const KEY = "oracle.device_token";
const MintSchema = z.object({ token: z.string(), user_id: z.string() });

async function secureStore(): Promise<TokenStore> {
  const SecureStore = await import("expo-secure-store");
  return { get: (k) => SecureStore.getItemAsync(k), set: (k, v) => SecureStore.setItemAsync(k, v) };
}

export async function getDeviceToken(deps: { fetchFn?: typeof fetch; store?: TokenStore } = {}): Promise<string> {
  const store = deps.store ?? (await secureStore());
  const existing = await store.get(KEY);
  if (existing) return existing;
  const { token } = await api("/v1/auth/device", MintSchema, {
    method: "POST",
    body: JSON.stringify({ platform: "ios" }),
    fetchFn: deps.fetchFn,
  });
  await store.set(KEY, token);
  return token;
}
