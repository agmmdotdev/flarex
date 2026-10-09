import { expect, it } from "vitest";
import { projectCommerceRequestFailure } from "../../../src/frameworks/commerceTransaction/request";
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
