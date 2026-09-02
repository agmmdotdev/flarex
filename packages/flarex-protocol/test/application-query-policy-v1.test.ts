import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_QUERY_IDENTITY_ACCESS_CAPABILITIES_V1,
  APPLICATION_QUERY_IDENTITY_ACCESS_POLICY_VERSION_V1,
  canonicalizeApplicationQueryIdentityAccessPolicyV1,
} from "../src/application-query-policy-v1";

describe("Application query identity access policy V1", () => {
  it("canonicalizes the anonymous read-only policy", async () => {
    const canonical = await Effect.runPromise(
      canonicalizeApplicationQueryIdentityAccessPolicyV1({
        kind: "anonymous",
      }),
    );

    expect(canonical.policy).toEqual({
      format: "flarex.identity-access-policy",
      version: 1,
      policyVersion: "policy_query_v1",
      auth: { kind: "anonymous" },
      capabilities: ["db:get"],
    });
    expect(canonical.policy.policyVersion).toBe(
      APPLICATION_QUERY_IDENTITY_ACCESS_POLICY_VERSION_V1,
    );
    expect(canonical.policy.capabilities).toEqual(
      APPLICATION_QUERY_IDENTITY_ACCESS_CAPABILITIES_V1,
    );
    expect(canonical.sha256Hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pins user claims without aliasing the caller identity", async () => {
    const role = { name: "cook" };
    const identity = {
      kind: "user" as const,
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://issuer.example",
        role,
      },
    };
    const first = await Effect.runPromise(
      canonicalizeApplicationQueryIdentityAccessPolicyV1(identity),
    );
    role.name = "admin";
    const second = await Effect.runPromise(
      canonicalizeApplicationQueryIdentityAccessPolicyV1(identity),
    );

    expect(first.policy.auth).toMatchObject({
      kind: "verifiedBearer",
      issuer: "https://issuer.example",
      subject: "user-1",
      tokenIdentifier: "issuer|user-1",
      claims: { role: { name: "cook" } },
    });
    expect(first.sha256Hex).not.toBe(second.sha256Hex);
    expect(Object.isFrozen(first.policy)).toBe(true);
    expect(Object.isFrozen(first.policy.auth)).toBe(true);
  });
});
