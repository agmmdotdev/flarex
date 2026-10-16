import { Result } from "effect";
import { isJsonObject } from "flarex-protocol/json";
import { describe, expect, it } from "vitest";

import { decodeTaskExecutionPrincipalObjectV1 } from "../src/runCreation/v1.js";

function principal() {
  return {
    version: 1,
    scopeId: "scope_97000000-0000-4000-8000-000000000001",
    executionIdentity: {
      kind: "user",
      user: {
        tokenIdentifier: "token-1",
        subject: "user-1",
        issuer: "https://auth.flarex.invalid",
        claims: { roles: ["reader"], settings: { enabled: true } },
      },
    },
  };
}

describe("Task execution principal canonical object", () => {
  it("retains JSON claims in detached, deeply immutable identity ownership", () => {
    const caller = principal();
    const decoded = Result.getOrThrow(decodeTaskExecutionPrincipalObjectV1(caller));
    const second = Result.getOrThrow(decodeTaskExecutionPrincipalObjectV1(caller));
    expect(decoded).toEqual(caller);
    expect(decoded.executionIdentity).not.toBe(caller.executionIdentity);
    expect(decoded.executionIdentity).not.toBe(second.executionIdentity);
    caller.executionIdentity.user.subject = "mutated";
    caller.executionIdentity.user.claims.roles.push("admin");
    caller.executionIdentity.user.claims.settings.enabled = false;
    expect(decoded.executionIdentity.user.subject).toBe("user-1");
    expect(decoded.executionIdentity.user.claims).toEqual({
      roles: ["reader"], settings: { enabled: true },
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.executionIdentity)).toBe(true);
    expect(Object.isFrozen(decoded.executionIdentity.user)).toBe(true);
    expect(Object.isFrozen(decoded.executionIdentity.user.claims)).toBe(true);
    const claims = decoded.executionIdentity.user.claims;
    if (claims === undefined || !isJsonObject(claims)) {
      throw new Error("Expected the authored object claim");
    }
    expect(Object.isFrozen(claims.roles)).toBe(true);
    expect(Object.isFrozen(claims.settings)).toBe(true);
    expect(Object.isFrozen(caller.executionIdentity.user.claims.roles)).toBe(false);
  });

  it("rejects excess envelope and execution-identity keys with the existing void failure", () => {
    const value = principal();
    for (const candidate of [
      { ...value, extra: true },
      { ...value, executionIdentity: { ...value.executionIdentity, extra: true } },
    ]) {
      const decoded = decodeTaskExecutionPrincipalObjectV1(candidate);
      expect(Result.isFailure(decoded)).toBe(true);
      if (Result.isFailure(decoded)) expect(decoded.failure).toBeUndefined();
    }
  });

  it("refuses anonymous identity, invalid scope, versions and non-JSON claims", () => {
    const value = principal();
    for (const candidate of [
      { ...value, version: 2 },
      { ...value, scopeId: "not-a-scope" },
      { ...value, executionIdentity: { kind: "anonymous" } },
      { ...value, executionIdentity: {
        ...value.executionIdentity, user: { ...value.executionIdentity.user, subject: 1 },
      } },
      { ...value, executionIdentity: {
        ...value.executionIdentity, user: { ...value.executionIdentity.user, unsafe: () => true },
      } },
    ]) {
      expect(Result.isFailure(decodeTaskExecutionPrincipalObjectV1(candidate))).toBe(true);
    }
  });
});
