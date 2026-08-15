import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaC } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema C", () => {
  it("blocks required slug, backfills through B, and activates C", async () => {
    await expect(proveManagedSchemaCookingSchemaC()).resolves.toEqual({
      plannedRequiredFieldValidation: true,
      missingRequiredFieldBlocked: true,
      schemaBStayedActive: true,
      backfilledThroughSchemaB: true,
      activatedSchemaC: true,
      schemaCRejectedMissingSlugArgument: true,
      finalDocumentsConformToSchemaC: true,
      analysisWorkerLoads: 10,
      runtimeWorkerLoads: 12,
      commitCount: 5,
      outcomeCount: 5,
      feedCount: 5,
      outboxCount: 5,
    });
  }, 480_000);
});
