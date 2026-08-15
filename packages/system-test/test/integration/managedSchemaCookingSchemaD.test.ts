import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaD } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema D", () => {
  it("blocks nested tightening, remediates through C, and activates D", async () => {
    await expect(proveManagedSchemaCookingSchemaD()).resolves.toEqual({
      plannedNestedValidatorValidation: true,
      nestedValidatorBlocked: true,
      failureEvidenceWasPathOnly: true,
      schemaCStayedActive: true,
      remediatedThroughSchemaC: true,
      activatedSchemaD: true,
      schemaDRejectedInvalidNestedArgument: true,
      finalDocumentsConformToSchemaD: true,
      analysisWorkerLoads: 14,
      runtimeWorkerLoads: 16,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    });
  }, 480_000);
});
