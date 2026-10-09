import { expect, it } from "vitest";
import { TrustedScopeAuthorityPortError, TrustedScopeAuthorityResolutionError } from "../../../src/scope/scopeAuthorityResolution";
import { projectCe0CmsRequestFailure } from "./ce0CmsReferencePersistence";

it("keeps CE0 authority-reader outages distinct from missing scope", () => {
  const outage = new TrustedScopeAuthorityPortError({
    operation: "scopeMetadataRead", cause: new Error("control catalog unavailable"),
  });
  expect(projectCe0CmsRequestFailure(outage)).toMatchObject({ reason: "resourceFailure", cause: outage });

  const missing = new TrustedScopeAuthorityResolutionError({
    reason: "scopeMetadataMissing", deploymentId: "missing-deployment",
  });
  expect(projectCe0CmsRequestFailure(missing)).toMatchObject({ reason: "invalidAuthority", cause: missing });
});
