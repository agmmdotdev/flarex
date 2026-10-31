import { describe, expect, it } from "vitest";
import { activationError } from "../../../src/application/activation/errors";
import { CompositeCommandError } from "../../../src/frameworks/crossDomainCommand/model";
import { projectCompositeFailure } from "../../../src/frameworks/crossDomainCommand/legacyFailure";

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
