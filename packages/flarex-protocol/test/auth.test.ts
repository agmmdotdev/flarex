import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AuthConfigSchema,
  AuthProtocolValidationError,
  AuthProviderSchema,
  decodeAuthConfigEffect,
  decodeAuthProviderEffect,
  decodeExecutionIdentityEffect,
  decodeUserIdentityEffect,
  executionIdentityFingerprint,
  ExecutionIdentitySchema,
  UserIdentitySchema,
} from "../src/auth";

const decodeUserIdentity = Schema.decodeUnknownSync(UserIdentitySchema);
const decodeExecutionIdentity = Schema.decodeUnknownSync(ExecutionIdentitySchema);
const decodeAuthProvider = Schema.decodeUnknownSync(AuthProviderSchema);
const decodeAuthConfig = Schema.decodeUnknownSync(AuthConfigSchema);

describe("auth protocol schemas", () => {
  it("decodes OIDC and custom JWT auth provider config", async () => {
    const oidc = {
      domain: "https://auth.example.com",
      applicationID: "app-123",
    };
    const customJwt = {
      type: "customJwt",
      issuer: "https://issuer.example.com",
      jwks: "https://issuer.example.com/.well-known/jwks.json",
      algorithm: "RS256",
      applicationID: "app-456",
    };
    const config = {
      providers: [
        oidc,
        customJwt,
        {
          type: "customJwt",
          issuer: "https://internal.example.com",
          jwks: "https://internal.example.com/jwks.json",
          algorithm: "ES256",
        },
      ],
    };

    await expect(Effect.runPromise(decodeAuthProviderEffect(oidc)))
      .resolves.toEqual(oidc);
    await expect(Effect.runPromise(decodeAuthProviderEffect(customJwt)))
      .resolves.toEqual(customJwt);
    await expect(Effect.runPromise(decodeAuthConfigEffect(config)))
      .resolves.toEqual(config);
    expect(decodeAuthProvider(oidc)).toEqual(oidc);
    expect(decodeAuthConfig(config)).toEqual(config);
  });

  it("rejects malformed auth provider config", async () => {
    await expect(Effect.runPromise(decodeAuthConfigEffect({})))
      .rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeAuthProviderEffect({
      domain: "https://auth.example.com",
    }))).rejects.toThrow("Auth provider must be an OIDC provider");

    await expect(Effect.runPromise(decodeAuthProviderEffect({
      domain: "https://auth.example.com",
      applicationID: "",
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeAuthProviderEffect({
      type: "customJwt",
      issuer: "https://issuer.example.com",
      jwks: "https://issuer.example.com/.well-known/jwks.json",
      algorithm: "HS256",
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeAuthProviderEffect({
      type: "customJwt",
      issuer: "https://issuer.example.com",
      jwks: "https://issuer.example.com/.well-known/jwks.json",
      algorithm: "RS256",
      extra: true,
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeAuthConfigEffect({
      providers: [
        {
          type: "customJwt",
          issuer: "https://issuer.example.com",
          jwks: "https://issuer.example.com/.well-known/jwks.json",
          algorithm: "RS256",
          applicationID: null,
        },
      ],
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);
  });

  it("decodes Convex-compatible user identities with custom claims", async () => {
    const identity = {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "https://auth.example.com",
      name: "Ada Lovelace",
      email: "ada@example.com",
      emailVerified: true,
      roles: ["admin", "writer"],
      profile: {
        tenantId: "tenant-a",
        beta: true,
      },
    };

    await expect(Effect.runPromise(decodeUserIdentityEffect(identity)))
      .resolves.toEqual(identity);
    expect(decodeUserIdentity(identity)).toEqual(identity);
  });

  it("retains the auth-owned plain-record and symbol-key policy", async () => {
    const nullPrototypeIdentity: Record<string, unknown> = Object.assign(
      Object.create(null),
      {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
      },
    );
    const decoded = await Effect.runPromise(
      decodeUserIdentityEffect(nullPrototypeIdentity),
    );
    expect(decoded.subject).toBe("user-1");

    const symbolBearingIdentity = {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "https://auth.example.com",
      [Symbol("private")]: true,
    };
    await expect(
      Effect.runPromise(decodeUserIdentityEffect(symbolBearingIdentity)),
    ).rejects.toBeInstanceOf(AuthProtocolValidationError);
  });

  it("decodes anonymous and user execution identities", async () => {
    await expect(Effect.runPromise(decodeExecutionIdentityEffect({
      kind: "anonymous",
    }))).resolves.toEqual({ kind: "anonymous" });

    const userIdentity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-2",
        subject: "user-2",
        issuer: "https://auth.example.com",
        phoneNumberVerified: false,
      },
    };

    await expect(Effect.runPromise(decodeExecutionIdentityEffect(userIdentity)))
      .resolves.toEqual(userIdentity);
    expect(decodeExecutionIdentity(userIdentity)).toEqual(userIdentity);
  });

  it("fingerprints execution identities with stable claim ordering", () => {
    expect(executionIdentityFingerprint({ kind: "anonymous" })).toMatch(
      /^identity:v1:[a-f0-9]{16}$/,
    );
    const fingerprint = executionIdentityFingerprint({
      kind: "user",
      user: {
        issuer: "https://auth.example.com",
        subject: "user-2",
        tokenIdentifier: "issuer|user-2",
        profile: {
          tenantId: "tenant-a",
          roles: ["writer", "admin"],
        },
      },
    });
    expect(fingerprint).toMatch(/^identity:v1:[a-f0-9]{16}$/);
    expect(fingerprint).not.toContain("user-2");
    expect(fingerprint).toBe(
      executionIdentityFingerprint({
        kind: "user",
        user: {
          profile: {
            roles: ["writer", "admin"],
            tenantId: "tenant-a",
          },
          tokenIdentifier: "issuer|user-2",
          issuer: "https://auth.example.com",
          subject: "user-2",
        },
      }),
    );
  });

  it("rejects malformed user identities", async () => {
    await expect(Effect.runPromise(decodeUserIdentityEffect({
      subject: "user-1",
      issuer: "https://auth.example.com",
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeUserIdentityEffect({
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "https://auth.example.com",
      emailVerified: "yes",
    }))).rejects.toThrow("User identity must include string tokenIdentifier");

    await expect(Effect.runPromise(decodeUserIdentityEffect({
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "https://auth.example.com",
      customDate: new Date(0),
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeUserIdentityEffect(Object.assign(new IdentityLike(), {
      tokenIdentifier: "issuer|user-1",
      subject: "user-1",
      issuer: "https://auth.example.com",
    })))).rejects.toBeInstanceOf(AuthProtocolValidationError);
  });

  it("rejects malformed execution identities", async () => {
    await expect(Effect.runPromise(decodeExecutionIdentityEffect({
      kind: "anonymous",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
      },
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionIdentityEffect({
      kind: "user",
    }))).rejects.toThrow("Execution identity must be anonymous");

    await expect(Effect.runPromise(decodeExecutionIdentityEffect({
      kind: "admin",
    }))).rejects.toBeInstanceOf(AuthProtocolValidationError);
  });
});

class IdentityLike {}
