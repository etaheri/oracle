import { describe, it, expect, beforeEach } from "vitest";
import { verifyAppleIdentityToken, __resetJwksCache } from "../src/auth/apple";

const b64url = (buf: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof buf === "string" ? new TextEncoder().encode(buf) : new Uint8Array(buf as ArrayBuffer);
  return Buffer.from(bytes).toString("base64url");
};

async function makeApple() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  const jwks = { keys: [{ ...jwk, kid: "test-kid", use: "sig", alg: "RS256" }] };
  const fetchFn = (async () => new Response(JSON.stringify(jwks))) as unknown as typeof fetch;
  const sign = async (claims: Record<string, unknown>, kid = "test-kid") => {
    const h = b64url(JSON.stringify({ alg: "RS256", kid }));
    const p = b64url(JSON.stringify(claims));
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { fetchFn, sign };
}
const NOW = Date.UTC(2026, 8, 1);
const good = { iss: "https://appleid.apple.com", aud: "com.erikcitrine.oracle", exp: NOW / 1000 + 600, sub: "apple-sub-1" };

describe("verifyAppleIdentityToken", () => {
  beforeEach(() => __resetJwksCache());

  it("accepts a valid token and returns sub", async () => {
    const { fetchFn, sign } = await makeApple();
    const out = await verifyAppleIdentityToken(await sign(good), { audience: "com.erikcitrine.oracle", fetchFn, nowMs: NOW });
    expect(out).toEqual({ sub: "apple-sub-1" });
  });
  it("rejects wrong audience, wrong issuer, expiry, unknown kid, bad signature, garbage", async () => {
    const { fetchFn, sign } = await makeApple();
    const opts = { audience: "com.erikcitrine.oracle", fetchFn, nowMs: NOW };
    expect(await verifyAppleIdentityToken(await sign({ ...good, aud: "other.app" }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign({ ...good, iss: "https://evil.example" }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign({ ...good, exp: NOW / 1000 - 10 }), opts)).toBeNull();
    expect(await verifyAppleIdentityToken(await sign(good, "other-kid"), opts)).toBeNull();
    const forged = (await sign(good)).slice(0, -6) + "AAAAAA";
    expect(await verifyAppleIdentityToken(forged, opts)).toBeNull();
    expect(await verifyAppleIdentityToken("not.a.jwt", opts)).toBeNull();
  });
  it("returns null when fetchFn rejects (network error)", async () => {
    const { sign } = await makeApple();
    const failFetch = (() => Promise.reject(new Error("Network error"))) as unknown as typeof fetch;
    const opts = { audience: "com.erikcitrine.oracle", fetchFn: failFetch, nowMs: NOW };
    expect(await verifyAppleIdentityToken(await sign(good), opts)).toBeNull();
  });
  it("returns null when fetchFn returns invalid JSON", async () => {
    const { sign } = await makeApple();
    const badJsonFetch = (async () => new Response("not json")) as unknown as typeof fetch;
    const opts = { audience: "com.erikcitrine.oracle", fetchFn: badJsonFetch, nowMs: NOW };
    expect(await verifyAppleIdentityToken(await sign(good), opts)).toBeNull();
  });
  it("returns null when JWKS response has no keys array", async () => {
    const { sign } = await makeApple();
    const noKeysFetch = (async () => new Response(JSON.stringify({}))) as unknown as typeof fetch;
    const opts = { audience: "com.erikcitrine.oracle", fetchFn: noKeysFetch, nowMs: NOW };
    expect(await verifyAppleIdentityToken(await sign(good), opts)).toBeNull();
  });
  it("returns null when signature segment is not valid base64url", async () => {
    const { fetchFn, sign } = await makeApple();
    const validToken = await sign(good);
    const parts = validToken.split(".");
    const badToken = `${parts[0]}.${parts[1]}.!!!not-base64url!!!`;
    const opts = { audience: "com.erikcitrine.oracle", fetchFn, nowMs: NOW };
    expect(await verifyAppleIdentityToken(badToken, opts)).toBeNull();
  });
});
