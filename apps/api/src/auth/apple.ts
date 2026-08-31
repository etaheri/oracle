// Sign in with Apple identity-token verification (spec §4). Workers-safe:
// WebCrypto only, injectable fetch, null on any failure — callers 401.
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISS = "https://appleid.apple.com";
const JWKS_TTL_MS = 3_600_000;

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwksCache: { keys: Jwk[]; fetchedAt: number } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}
function decodeJson(part: string): Record<string, unknown> | null {
  try { return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>; } catch { return null; }
}

export async function verifyAppleIdentityToken(
  token: string,
  opts: { audience: string; fetchFn?: typeof fetch; nowMs?: number },
): Promise<{ sub: string } | null> {
  try {
    const fetchFn = opts.fetchFn ?? fetch;
    const nowMs = opts.nowMs ?? Date.now();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = decodeJson(h);
    const claims = decodeJson(p);
    if (!header || !claims || header.alg !== "RS256" || typeof header.kid !== "string") return null;
    if (claims.iss !== APPLE_ISS || claims.aud !== opts.audience) return null;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs) return null;
    if (typeof claims.sub !== "string" || !claims.sub) return null;

    if (!jwksCache || nowMs - jwksCache.fetchedAt > JWKS_TTL_MS) {
      const res = await fetchFn(APPLE_JWKS_URL);
      if (!res.ok) return null;
      const body = (await res.json()) as { keys?: unknown };
      const keys = body.keys;
      if (!Array.isArray(keys)) return null;
      jwksCache = { keys: keys as Jwk[], fetchedAt: nowMs };
    }
    const jwk = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!jwk) { jwksCache = null; return null; } // unknown kid: bust cache so a rotated key retries next call

    let key: CryptoKey;
    try {
      key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    } catch { return null; }
    const sig = b64urlToBytes(s);
    const data = new TextEncoder().encode(`${h}.${p}`);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig as BufferSource, data);
    return ok ? { sub: claims.sub } : null;
  } catch {
    return null; // fail-closed: null on any unguarded error
  }
}

/** Test hook: reset the module JWKS cache. */
export function __resetJwksCache(): void { jwksCache = null; }
