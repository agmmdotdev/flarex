import { describe, expect, it } from "vitest";
import { activationError } from "../../../src/application/activation/errors";
import { CoreNativeReferenceError, CoreTransactionError } from "../../../src/core/api";
import { projectCoreCmsFailure } from "../../../src/frameworks/cmsTransaction/nativeFailure";
import { projectCoreCommerceFailure } from "../../../src/frameworks/commerceTransaction/nativeFailure";
import { CompositeCommandError } from "../../../src/frameworks/crossDomainCommand/model";
import { projectCompositeFailure } from "../../../src/frameworks/crossDomainCommand/legacyFailure";
import { projectCoreCompositeFailure } from "../../../src/frameworks/crossDomainCommand/nativeFailure";

describe("joint command current Application failure projection", () => {
  it("retains a preparation resource failure and its exact cause chain", () => {
    const databaseFailure = new Error("Current Application catalog read failed");
    const activation = activationError("read", "resourceFailure", undefined, false, databaseFailure);
    const projected = projectCompositeFailure(activation);

    expect(projected).toBeInstanceOf(CompositeCommandError);
    expect(projected.reason).toBe("resourceFailure");
    expect(projected.cause).toBe(activation);
    expect(activation.cause).toBe(databaseFailure);
  });

  it.each(["invalidInput", "invalidComposition", "notReady", "activeMissing", "alreadyActive",
    "expectedHead", "scopeAuthority", "concurrentHead", "storedState", "decisionUncertain"] as const)(
    "keeps the Application %s refusal classified as invalid authority", reason => {
      const refusal = activationError("read", reason);
      const projected = projectCompositeFailure(refusal);

      expect(projected).toBeInstanceOf(CompositeCommandError);
      expect(projected.reason).toBe("invalidAuthority");
      expect(projected.cause).toBe(refusal);
    });
});

describe.each([
  { profile: "CMS", project: projectCoreCmsFailure, expectedReason: "documentInvalid" },
  { profile: "Commerce", project: projectCoreCommerceFailure, expectedReason: "invalidInput" },
  { profile: "Composite", project: projectCoreCompositeFailure, expectedReason: "invalidInput" },
])("native $profile document ID failure projection", ({ project, expectedReason }) => {
  it.each(["documentExists", "documentDeleted"] as const)("keeps %s as bad input with its exact Core cause", reason => {
    const history = new Error("Generated ID has retained document history");
    const refusal = new CoreTransactionError({ reason, cause: history });
    const projected = project(refusal);

    expect(projected.reason).toBe(expectedReason);
    expect(projected.cause).toBe(refusal);
    expect(refusal.cause).toBe(history);
  });
});

describe.each([
  { profile: "Commerce", project: projectCoreCommerceFailure },
  { profile: "Composite", project: projectCoreCompositeFailure },
])("native $profile reference failure projection", ({ project }) => {
  it.each(["relationTargetMissing", "relationDeleteRestricted"] as const)("keeps %s as input failure with its exact Core cause", reason => {
    const refusal = new CoreNativeReferenceError({ reason, forwardName: "sourceTarget",
      sourceTable: "sources", targetTable: "targets", sourceId: "source", targetId: "target" });
    const projected = project(refusal);
    expect(projected.reason).toBe("invalidInput");
    expect(projected.cause).toBe(refusal);
  });
});
