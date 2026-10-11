import { expect, it } from "vitest";
import { projectCommerceRequestFailure } from "../../../src/frameworks/commerceTransaction/request";
import { ApplicationActivationError } from "../../../src/application/activation/errors";
import { ApplicationReadinessError } from "../../../src/application/readiness/errors";
import { PreparedHostRuntimeError } from "../../../src/execution/preparation/preparedHostRuntime";
import {
  TrustedScopeAuthorityPortError,
  TrustedScopeAuthorityResolutionError,
} from "../../../src/scope/scopeAuthorityResolution";

it("distinguishes an exact scope read outage from missing authority", () => {
  const outage = new TrustedScopeAuthorityPortError({
    operation: "scopeMetadataRead", cause: new Error("control database unavailable"),
  });
  const unavailable = projectCommerceRequestFailure(outage);
  expect(unavailable).toMatchObject({ reason: "resourceFailure" });
  expect(unavailable.cause).toBe(outage);

  const missing = new TrustedScopeAuthorityResolutionError({
    reason: "scopeMetadataMissing", deploymentId: "missing-deployment",
  });
  const refused = projectCommerceRequestFailure(missing);
  expect(refused).toMatchObject({ reason: "invalidAuthority" });
  expect(refused.cause).toBe(missing);
});

it("retains preparation-owner resource causes without accepting unrelated authority failures", () => {
  const capacity = new PreparedHostRuntimeError({ reason: "capacityExceeded" });
  const generation = new ApplicationActivationError({ operation: "read", reason: "resourceFailure", retryable: false, cause: capacity });
  const refused = projectCommerceRequestFailure(generation);
  expect(refused.reason).toBe("resourceFailure");
  expect(refused.cause).toBe(generation);
  expect(generation.cause).toBe(capacity);
  const readiness = new ApplicationReadinessError({ operation: "readReady", reason: "resourceFailure", retryable: false, cause: capacity });
  const unavailable = projectCommerceRequestFailure(readiness);
  expect(unavailable.reason).toBe("resourceFailure");
  expect(unavailable.cause).toBe(readiness);
  expect(readiness.cause).toBe(capacity);

  const composition = new ApplicationActivationError({ operation: "read", reason: "invalidComposition", retryable: false });
  const invalid = projectCommerceRequestFailure(composition);
  expect(invalid.reason).toBe("invalidAuthority");
  expect(invalid.cause).toBe(composition);
  const unrelatedReadiness = new ApplicationReadinessError({ operation: "readReady", reason: "invalidComposition", retryable: false });
  const invalidReadiness = projectCommerceRequestFailure(unrelatedReadiness);
  expect(invalidReadiness.reason).toBe("invalidAuthority");
  expect(invalidReadiness.cause).toBe(unrelatedReadiness);
});
