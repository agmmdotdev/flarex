import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_EXECUTION_IDENTITY,
  resolveExecutionIdentityEffect,
  trustedExecutionIdentityErrorToHttpError,
  TRUSTED_EXECUTION_IDENTITY_HEADER,
  TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER,
  TrustedExecutionIdentityError,
} from "../src/auth";
import type { Env } from "../src/types";

type IdentityResolverEnv = Pick<
  Env,
  "FLAREX_TRUSTED_EXECUTION_IDENTITY" | "FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN"
>;

describe("backend execution identity resolver", () => {
  it("returns anonymous identity by default", async () => {
    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      new Request("https://flarex.test/invoke"),
      {},
    ))).resolves.toEqual(ANONYMOUS_EXECUTION_IDENTITY);
  });

  it("fails closed when trusted identity headers are not enabled", async () => {
    const error = await Effect.runPromise(Effect.flip(resolveExecutionIdentityEffect(
      trustedIdentityRequest({ kind: "anonymous" }),
      {},
    )));

    expect(error).toBeInstanceOf(TrustedExecutionIdentityError);
    expect(error).toMatchObject({
      _tag: "TrustedExecutionIdentityError",
      reason: "disabled",
      message: "Trusted execution identity header is disabled for this deployment.",
    });
    expect(trustedExecutionIdentityErrorToHttpError(error)).toMatchObject({
      status: 400,
      message: "Trusted execution identity header is disabled for this deployment.",
    });
  });

  it("requires a matching trusted identity token after env opt-in", async () => {
    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      trustedIdentityRequest({ kind: "anonymous" }),
      { FLAREX_TRUSTED_EXECUTION_IDENTITY: "true" } satisfies IdentityResolverEnv,
    ))).rejects.toMatchObject({
      _tag: "TrustedExecutionIdentityError",
      reason: "missingToken",
      message:
        "Trusted execution identity token is required when trusted identity headers are enabled.",
    });

    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      trustedIdentityRequest({ kind: "anonymous" }, "wrong-secret"),
      {
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true",
        FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-secret",
      } satisfies IdentityResolverEnv,
    ))).rejects.toMatchObject({
      _tag: "TrustedExecutionIdentityError",
      reason: "unauthorized",
      message: "Trusted execution identity token is invalid.",
    });
  });

  it("decodes trusted execution identities only after explicit env opt-in", async () => {
    const identity = {
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
        emailVerified: true,
      },
    } as const;

    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      trustedIdentityRequest(identity, "trusted-secret"),
      {
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true",
        FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-secret",
      } satisfies IdentityResolverEnv,
    ))).resolves.toEqual(identity);
  });

  it("rejects malformed trusted identity header values", async () => {
    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      new Request("https://flarex.test/invoke", {
        headers: {
          [TRUSTED_EXECUTION_IDENTITY_HEADER]: "{",
          [TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER]: "trusted-secret",
        },
      }),
      {
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true",
        FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-secret",
      } satisfies IdentityResolverEnv,
    ))).rejects.toMatchObject({
      _tag: "TrustedExecutionIdentityError",
      reason: "invalidJson",
      message: "Trusted execution identity header must be JSON.",
    });

    await expect(Effect.runPromise(resolveExecutionIdentityEffect(
      trustedIdentityRequest({ kind: "user" }, "trusted-secret"),
      {
        FLAREX_TRUSTED_EXECUTION_IDENTITY: "true",
        FLAREX_TRUSTED_EXECUTION_IDENTITY_TOKEN: "trusted-secret",
      } satisfies IdentityResolverEnv,
    ))).rejects.toMatchObject({
      _tag: "TrustedExecutionIdentityError",
      reason: "invalidIdentity",
      message: "Trusted execution identity header must be a valid execution identity.",
    });
  });
});

function trustedIdentityRequest(identity: unknown, token?: string): Request {
  return new Request("https://flarex.test/invoke", {
    headers: {
      [TRUSTED_EXECUTION_IDENTITY_HEADER]: JSON.stringify(identity),
      ...(token === undefined ? {} : { [TRUSTED_EXECUTION_IDENTITY_TOKEN_HEADER]: token }),
    },
  });
}
