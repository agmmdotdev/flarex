import { describe, expect, it } from "vitest";

import { proveManagedSchemaBlockedPlanDoesNotApply } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema blocked exact-plan apply", () => {
  it("does not install validation or change the active schema", async () => {
    await expect(proveManagedSchemaBlockedPlanDoesNotApply()).resolves.toEqual({
      blockedPlanStayedNonApplicable: true,
      candidateValidationWasNotInstalled: true,
      activeSchemaStayedExact: true,
    });
  }, 480_000);
});
