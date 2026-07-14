import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { AuthConfig, CustomJwtAuthProvider } from "flarex-protocol/auth";

import {
  InvalidVerifiedAuthContextError,
  JwtAuthError,
  TransactionGrantAuthProjectionError,
  inspectVerifiedAuthContext,
  jwtAuthErrorToHttpError,
  resolveBearerAuthenticationEffect,
  resolveBearerExecutionIdentityEffect,
  transactionGrantAuthFromBearerAuthenticationV1,
  transactionGrantAuthFromVerifiedAuthContextV1,
  verifyBearerTokenEffect,
  verifyBearerTokenToAuthenticationEffect,
  type JwtAuthFetch,
  type VerifiedAuthContext,
  type VerifiedBearerAuthentication,
} from "../src/authJwt";

const now = new Date("2026-07-04T00:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

describe("JWT auth resolver", () => {
  it("returns anonymous identity when no authorization header is present", async () => {
    const authentication = await Effect.runPromise(
      resolveBearerAuthenticationEffect({
        authorization: null,
        authConfig: null,
        now,
      }),
    );

    expect(authentication).toEqual({
      kind: "anonymous",
      executionIdentity: { kind: "anonymous" },
    });
    expect(transactionGrantAuthFromBearerAuthenticationV1(authentication)).toEqual({
      kind: "anonymous",
    });
    expect("verifiedAuthContext" in authentication).toBe(false);

    await expect(
      Effect.runPromise(resolveBearerExecutionIdentityEffect({
        authorization: null,
        authConfig: null,
        now,
      })),
    ).resolves.toEqual({ kind: "anonymous" });
  });

  it("retains immutable verified provider provenance while minimizing grant claims", async () => {
    const { authentication, expiresAt } =
      await verifiedCustomAuthenticationFixture("user_provenance");

    expect(authentication.executionIdentity).toEqual({
      kind: "user",
      user: {
        tokenIdentifier: "https://issuer.example.com|user_provenance",
        subject: "user_provenance",
        issuer: "https://issuer.example.com",
        email: "private@example.com",
        role: "admin",
      },
    });
    const evidence = inspectVerifiedAuthContext(
      authentication.verifiedAuthContext,
    );
    expect(evidence).toEqual({
      issuer: "https://issuer.example.com",
      subject: "user_provenance",
      credentialExpiresAtEpochSeconds: expiresAt,
      matchedProvider: {
        type: "customJwt",
        providerIndex: 1,
        configuration: {
          type: "customJwt",
          issuer: "https://issuer.example.com",
          jwks: "https://issuer.example.com/jwks.json",
          algorithm: "RS256",
          applicationID: "flarex-app",
        },
      },
    });
    expect(Object.isFrozen(authentication.verifiedAuthContext)).toBe(true);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.matchedProvider)).toBe(true);
    expect(Object.isFrozen(evidence.matchedProvider.configuration)).toBe(true);

    const grantAuth = transactionGrantAuthFromBearerAuthenticationV1(
      authentication,
    );
    expect(grantAuth).toEqual({
      kind: "verifiedBearer",
      issuer: "https://issuer.example.com",
      subject: "user_provenance",
      claims: {},
    });
    expect(Object.isFrozen(grantAuth)).toBe(true);
    if (grantAuth.kind === "verifiedBearer") {
      expect(Object.isFrozen(grantAuth.claims)).toBe(true);
    }

    if (authentication.executionIdentity.kind !== "user") {
      throw new Error("Expected the compatibility user identity.");
    }
    expect(Reflect.set(authentication.executionIdentity.user, "role", "operator")).toBe(
      true,
    );
    expect(
      Reflect.set(
        authentication.executionIdentity.user,
        "issuer",
        "https://forged.example.com",
      ),
    ).toBe(true);
    expect(
      inspectVerifiedAuthContext(authentication.verifiedAuthContext),
    ).toEqual(evidence);
    expect(
      transactionGrantAuthFromVerifiedAuthContextV1(
        authentication.verifiedAuthContext,
      ),
    ).toEqual(grantAuth);
  });

  it("rejects structural, copied-brand, serialized, and trusted-dev forgeries", async () => {
    const { authentication } =
      await verifiedCustomAuthenticationFixture("user_forgeries");
    expect(JSON.stringify(authentication.verifiedAuthContext)).toBe("{}");
    const jsonRoundTrip: unknown = JSON.parse(
      JSON.stringify(authentication.verifiedAuthContext),
    );
    const structuredCloneContext = structuredClone(
      authentication.verifiedAuthContext,
    );
    const spreadContext = { ...authentication.verifiedAuthContext };
    const copiedSymbolContext: Record<PropertyKey, unknown> = {};
    for (const key of Reflect.ownKeys(authentication.verifiedAuthContext)) {
      const descriptor = Object.getOwnPropertyDescriptor(
        authentication.verifiedAuthContext,
        key,
      );
      if (descriptor !== undefined) {
        Object.defineProperty(copiedSymbolContext, key, descriptor);
      }
    }
    const inheritedContext: unknown = Object.create(
      authentication.verifiedAuthContext,
    );
    // @ts-expect-error The private symbol makes structural construction invalid.
    const structurallyForgedContext: VerifiedAuthContext = {};
    const mismatchedAuthentication: VerifiedBearerAuthentication = {
      kind: "verifiedBearer",
      // @ts-expect-error Verified bearer authentication requires a user identity.
      executionIdentity: { kind: "anonymous" },
      verifiedAuthContext: authentication.verifiedAuthContext,
    };
    void mismatchedAuthentication;
    const trustedDevIdentity: unknown = {
      kind: "user",
      user: {
        tokenIdentifier: "trusted-dev|admin",
        subject: "admin",
        issuer: "trusted-dev",
      },
    };
    for (const forged of [
      jsonRoundTrip,
      structuredCloneContext,
      spreadContext,
      copiedSymbolContext,
      inheritedContext,
      structurallyForgedContext,
      trustedDevIdentity,
    ]) {
      expect(() => inspectVerifiedAuthContext(forged)).toThrow(
        InvalidVerifiedAuthContextError,
      );
    }
    expect(() =>
      transactionGrantAuthFromVerifiedAuthContextV1(trustedDevIdentity)
    ).toThrow(InvalidVerifiedAuthContextError);
  });

  it("rejects grant-incompatible evidence without narrowing compatibility identity", async () => {
    const { authentication } = await verifiedCustomAuthenticationFixture(
      "user\u0000not-grant-safe",
    );
    expect(authentication.executionIdentity).toMatchObject({
      kind: "user",
      user: { subject: "user\u0000not-grant-safe" },
    });
    expect(() =>
      transactionGrantAuthFromVerifiedAuthContextV1(
        authentication.verifiedAuthContext,
      )
    ).toThrow(TransactionGrantAuthProjectionError);
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

    const authentication = await Effect.runPromise(
      verifyBearerTokenToAuthenticationEffect({
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
      }),
    );
    expect(authentication.executionIdentity).toMatchObject({
      kind: "user",
      user: {
        tokenIdentifier: "https://oidc.example.com/|user_oidc",
        subject: "user_oidc",
        issuer: "https://oidc.example.com/",
        preferredUsername: "ada",
      },
    });
    expect(inspectVerifiedAuthContext(authentication.verifiedAuthContext)).toEqual({
      issuer: "https://oidc.example.com/",
      subject: "user_oidc",
      credentialExpiresAtEpochSeconds: nowSeconds + 60,
      matchedProvider: {
        type: "oidc",
        providerIndex: 0,
        configuration: {
          domain: "https://oidc.example.com",
          applicationID: "oidc-app",
        },
      },
    });
    expect(
      transactionGrantAuthFromVerifiedAuthContextV1(
        authentication.verifiedAuthContext,
      ),
    ).toEqual({
      kind: "verifiedBearer",
      issuer: "https://oidc.example.com/",
      subject: "user_oidc",
      claims: {},
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

async function verifiedCustomAuthenticationFixture(
  subject: string,
): Promise<{
  readonly authentication: VerifiedBearerAuthentication;
  readonly expiresAt: number;
}> {
  const keys = await createRsaSigningKeys("verified-context-rs");
  const expiresAt = nowSeconds + 37;
  const provider = {
    type: "customJwt",
    issuer: "https://issuer.example.com",
    jwks: "https://issuer.example.com/jwks.json",
    algorithm: "RS256",
    applicationID: "flarex-app",
  } satisfies CustomJwtAuthProvider;
  const authConfig: AuthConfig = {
    providers: [
      {
        domain: "https://other.example.com",
        applicationID: "other-app",
      },
      provider,
    ],
  };
  const token = await signJwt({
    algorithm: "RS256",
    privateKey: keys.privateKey,
    kid: keys.jwk.kid,
    payload: {
      iss: "https://issuer.example.com",
      sub: subject,
      aud: "flarex-app",
      exp: expiresAt,
      email: "private@example.com",
      role: "admin",
    },
  });
  const fetcher: JwtAuthFetch = async (url) => {
    if (url !== "https://issuer.example.com/jwks.json") {
      return Response.json({ error: "not found" }, { status: 404 });
    }
    provider.issuer = "https://mutated.example.com";
    provider.jwks = "https://mutated.example.com/jwks.json";
    provider.applicationID = "mutated-app";
    return Response.json({ keys: [keys.jwk] });
  };
  const authentication = await Effect.runPromise(
    resolveBearerAuthenticationEffect({
      authorization: `Bearer ${token}`,
      authConfig,
      fetch: fetcher,
      now,
    }),
  );
  if (authentication.kind !== "verifiedBearer") {
    throw new Error("Expected verified bearer authentication.");
  }
  return { authentication, expiresAt };
}

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
