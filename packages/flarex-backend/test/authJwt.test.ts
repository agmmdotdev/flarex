import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { AuthConfig } from "flarex-protocol/auth";

import {
  JwtAuthError,
  jwtAuthErrorToHttpError,
  resolveBearerExecutionIdentityEffect,
  verifyBearerTokenEffect,
  type JwtAuthFetch,
} from "../src/authJwt";

const now = new Date("2026-07-04T00:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

describe("JWT auth resolver", () => {
  it("returns anonymous identity when no authorization header is present", async () => {
    await expect(
      Effect.runPromise(resolveBearerExecutionIdentityEffect({
        authorization: null,
        authConfig: null,
        now,
      })),
    ).resolves.toEqual({ kind: "anonymous" });
  });

  it("rejects malformed explicit authorization headers", async () => {
    await expect(
      Effect.runPromise(resolveBearerExecutionIdentityEffect({
        authorization: "Basic abc",
        authConfig: null,
        now,
      })),
    ).rejects.toMatchObject({
      reason: "invalidAuthorization",
    });
  });

  it("rejects bearer tokens when no providers are configured", async () => {
    await expect(
      Effect.runPromise(resolveBearerExecutionIdentityEffect({
        authorization: "Bearer token",
        authConfig: { providers: [] },
        now,
      })),
    ).rejects.toMatchObject({
      reason: "noProvider",
    });
  });

  it("verifies a custom JWT with RS256 JWKS and maps Convex identity claims", async () => {
    const keys = await createRsaSigningKeys("custom-rs");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_123",
        aud: "flarex-app",
        exp: nowSeconds + 60,
        name: "Ada Lovelace",
        email: "ada@example.com",
        email_verified: true,
        emailVerified: "not-a-boolean",
        givenName: 123,
        role: "admin",
      },
    });

    await expect(
      Effect.runPromise(resolveBearerExecutionIdentityEffect({
        authorization: `bearer ${token}`,
        authConfig: customJwtConfig("https://issuer.example.com", "https://issuer.example.com/jwks.json"),
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).resolves.toEqual({
      kind: "user",
      user: {
        tokenIdentifier: "https://issuer.example.com|user_123",
        subject: "user_123",
        issuer: "https://issuer.example.com",
        name: "Ada Lovelace",
        email: "ada@example.com",
        emailVerified: true,
        role: "admin",
      },
    });
  });

  it("verifies an OIDC JWT through discovery and JWKS", async () => {
    const keys = await createRsaSigningKeys("oidc-rs");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://oidc.example.com/",
        sub: "user_oidc",
        aud: "oidc-app",
        exp: nowSeconds + 60,
        preferred_username: "ada",
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: {
          providers: [
            {
              domain: "https://oidc.example.com",
              applicationID: "oidc-app",
            },
          ],
        },
        fetch: fetchRoutes({
          "https://oidc.example.com/.well-known/openid-configuration": {
            issuer: "https://oidc.example.com/",
            jwks_uri: "https://oidc.example.com/jwks.json",
          },
          "https://oidc.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).resolves.toMatchObject({
      kind: "user",
      user: {
        tokenIdentifier: "https://oidc.example.com/|user_oidc",
        subject: "user_oidc",
        issuer: "https://oidc.example.com/",
        preferredUsername: "ada",
      },
    });
  });

  it("verifies a custom JWT with ES256 JWKS", async () => {
    const keys = await createEcSigningKeys("custom-es");
    const token = await signJwt({
      algorithm: "ES256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_es",
        aud: "flarex-app",
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: {
          providers: [
            {
              type: "customJwt",
              issuer: "https://issuer.example.com",
              jwks: "https://issuer.example.com/ec-jwks.json",
              algorithm: "ES256",
              applicationID: "flarex-app",
            },
          ],
        },
        fetch: fetchRoutes({
          "https://issuer.example.com/ec-jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).resolves.toMatchObject({
      kind: "user",
      user: {
        tokenIdentifier: "https://issuer.example.com|user_es",
      },
    });
  });


  it("accepts a custom JWT without audience only when applicationID is omitted", async () => {
    const keys = await createRsaSigningKeys("custom-no-aud");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "issuer.example.com",
        sub: "user_no_aud",
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: {
          providers: [
            {
              type: "customJwt",
              issuer: "https://issuer.example.com",
              jwks: "https://issuer.example.com/jwks.json",
              algorithm: "RS256",
            },
          ],
        },
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).resolves.toMatchObject({
      kind: "user",
      user: {
        tokenIdentifier: "issuer.example.com|user_no_aud",
      },
    });
  });

  it("rejects tokens with the wrong audience", async () => {
    const keys = await createRsaSigningKeys("wrong-aud");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_123",
        aud: "other-app",
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: customJwtConfig("https://issuer.example.com", "https://issuer.example.com/jwks.json"),
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "noProvider",
    });
  });

  it("rejects malformed nbf temporal claims", async () => {
    const keys = await createRsaSigningKeys("bad-nbf");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_123",
        aud: "flarex-app",
        exp: nowSeconds + 60,
        nbf: "tomorrow",
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: customJwtConfig("https://issuer.example.com", "https://issuer.example.com/jwks.json"),
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "invalidToken",
    });
  });

  it("rejects OIDC tokens with multiple audiences", async () => {
    const keys = await createRsaSigningKeys("oidc-multi-aud");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://oidc.example.com",
        sub: "user_oidc",
        aud: ["oidc-app", "other-app"],
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: {
          providers: [
            {
              domain: "https://oidc.example.com",
              applicationID: "oidc-app",
            },
          ],
        },
        fetch: fetchRoutes({
          "https://oidc.example.com/.well-known/openid-configuration": {
            issuer: "https://oidc.example.com",
            jwks_uri: "https://oidc.example.com/jwks.json",
          },
          "https://oidc.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "claimsInvalid",
    });
  });

  it("rejects OIDC discovery without a matching issuer", async () => {
    const keys = await createRsaSigningKeys("oidc-missing-issuer");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://oidc.example.com",
        sub: "user_oidc",
        aud: "oidc-app",
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: {
          providers: [
            {
              domain: "https://oidc.example.com",
              applicationID: "oidc-app",
            },
          ],
        },
        fetch: fetchRoutes({
          "https://oidc.example.com/.well-known/openid-configuration": {
            jwks_uri: "https://oidc.example.com/jwks.json",
          },
          "https://oidc.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "jwksInvalid",
    });
  });

  it("rejects expired tokens after signature verification", async () => {
    const keys = await createRsaSigningKeys("expired");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: keys.privateKey,
      kid: keys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_123",
        aud: "flarex-app",
        exp: nowSeconds - 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: customJwtConfig("https://issuer.example.com", "https://issuer.example.com/jwks.json"),
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [keys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "claimsInvalid",
    });
  });

  it("rejects tokens when JWKS keys do not verify the signature", async () => {
    const signingKeys = await createRsaSigningKeys("signed");
    const jwksKeys = await createRsaSigningKeys("signed");
    const token = await signJwt({
      algorithm: "RS256",
      privateKey: signingKeys.privateKey,
      kid: signingKeys.jwk.kid,
      payload: {
        iss: "https://issuer.example.com",
        sub: "user_123",
        aud: "flarex-app",
        exp: nowSeconds + 60,
      },
    });

    await expect(
      Effect.runPromise(verifyBearerTokenEffect({
        token,
        authConfig: customJwtConfig("https://issuer.example.com", "https://issuer.example.com/jwks.json"),
        fetch: fetchRoutes({
          "https://issuer.example.com/jwks.json": { keys: [jwksKeys.jwk] },
        }),
        now,
      })),
    ).rejects.toMatchObject({
      reason: "signatureInvalid",
    });
  });

  it("redacts resolver detail from HTTP errors", () => {
    const httpError = jwtAuthErrorToHttpError(new JwtAuthError({
      reason: "jwksFetchFailed",
      message: "Failed to fetch auth metadata from https://issuer.example.com/jwks.json.",
    }));

    expect(httpError.status).toBe(401);
    expect(httpError.message).toBe("Authentication failed.");
  });
});

function customJwtConfig(issuer: string, jwks: string): AuthConfig {
  return {
    providers: [
      {
        type: "customJwt",
        issuer,
        jwks,
        algorithm: "RS256",
        applicationID: "flarex-app",
      },
    ],
  };
}

function fetchRoutes(routes: Record<string, unknown>): JwtAuthFetch {
  return async (url) => {
    const body = routes[url];
    if (body === undefined) {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    return Response.json(body);
  };
}

interface SigningKeys {
  readonly privateKey: CryptoKey;
  readonly jwk: JsonWebKey & {
    readonly kid: string;
    readonly alg: "RS256" | "ES256";
  };
}

async function createRsaSigningKeys(kid: string): Promise<SigningKeys> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return {
    privateKey: keys.privateKey,
    jwk: {
      ...publicJwk,
      kid,
      alg: "RS256",
    },
  };
}

async function createEcSigningKeys(kid: string): Promise<SigningKeys> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return {
    privateKey: keys.privateKey,
    jwk: {
      ...publicJwk,
      kid,
      alg: "ES256",
    },
  };
}

async function signJwt(input: {
  readonly algorithm: "RS256" | "ES256";
  readonly privateKey: CryptoKey;
  readonly kid: string;
  readonly payload: Record<string, unknown>;
}): Promise<string> {
  const header = { alg: input.algorithm, kid: input.kid, typ: "JWT" };
  const encodedHeader = base64UrlJson(header);
  const encodedPayload = base64UrlJson(input.payload);
  const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign(
    input.algorithm === "RS256"
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: "SHA-256" },
    input.privateKey,
    arrayBufferFromBytes(signingInput),
  );
  return `${encodedHeader}.${encodedPayload}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
