import type { z } from "zod";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

// What to do when the server rejects a token we believed in.
//
// A device token is minted once and kept in the Keychain, which SURVIVES app
// deletion — so a token whose server row is gone cannot be cleared by
// reinstalling, and every authed call 401s forever. The app then shows THE
// ORACLE SLEEPS with no way back: the only in-app control that clears the
// token is STRIKE THE RECORD, which lives on a ledger that cannot load.
//
// Registered by api/auth.ts rather than imported from it, because auth.ts
// imports this module and a direct call would be a cycle. Returns the token
// to retry with, or null to give up and let the 401 stand.
type UnauthorizedRecovery = (staleToken: string) => Promise<string | null>;
let recover: UnauthorizedRecovery | null = null;
export function setUnauthorizedRecovery(fn: UnauthorizedRecovery | null): void {
  recover = fn;
}

export async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { fetchFn?: typeof fetch; token?: string; retried?: boolean } = {},
): Promise<T> {
  const { fetchFn = fetch, token, retried = false, ...rest } = init;
  const res = await fetchFn(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(rest.headers ?? {}),
    },
  });
  // Exactly one retry, and only for a call that actually presented a token —
  // an unauthenticated 401 is a different bug and must not mint anything.
  if (res.status === 401 && token && !retried && recover) {
    const fresh = await recover(token);
    if (fresh && fresh !== token) {
      return api(path, schema, { ...init, token: fresh, retried: true });
    }
  }
  if (!res.ok) throw new ApiError(res.status, `API ${res.status} on ${path}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new ApiError(res.status, "invalid response body");
  }
  return schema.parse(body);
}
