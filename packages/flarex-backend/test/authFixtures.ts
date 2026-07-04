import type { Json } from "../src/types";

export interface RsaJwtSigningKeys {
  readonly privateKey: CryptoKey;
  readonly jwk: Record<string, Json> & { readonly kid: string; readonly alg: "RS256" };
}

export async function createRsaSigningKeys(kid: string): Promise<RsaJwtSigningKeys> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  return {
    privateKey: keyPair.privateKey,
    jwk: {
      kty: requiredString(exported.kty, "jwk.kty"),
      n: requiredString(exported.n, "jwk.n"),
      e: requiredString(exported.e, "jwk.e"),
      kid,
      alg: "RS256",
    },
  };
}

export async function signJwt(input: {
  readonly privateKey: CryptoKey;
  readonly kid: string;
  readonly payload: Record<string, Json>;
}): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: input.kid };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(input.payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    input.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

export function dataJsonUrl(value: Json): string {
  return `data:application/json,${encodeURIComponent(JSON.stringify(value))}`;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${field} must be a non-empty string.`);
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}
