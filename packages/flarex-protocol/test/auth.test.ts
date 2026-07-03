import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  AuthProtocolValidationError,
  decodeExecutionIdentityEffect,
  decodeUserIdentityEffect,
  ExecutionIdentitySchema,
  UserIdentitySchema,
} from "../src/auth";

const decodeUserIdentity = Schema.decodeUnknownSync(UserIdentitySchema);
const decodeExecutionIdentity = Schema.decodeUnknownSync(ExecutionIdentitySchema);

describe("auth protocol schemas", () => {
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
