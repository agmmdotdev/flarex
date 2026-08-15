import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaB } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema B", () => {
  it("blocks populated removal, preserves A, remediates, and activates B", async () => {
    await expect(proveManagedSchemaCookingSchemaB()).resolves.toEqual({
      plannedManagedValidation: true,
      applyRejectedCopiedHandle: true,
      applyRejectedForeignTarget: true,
      applyRejectedStaleFrontier: true,
      applyDrovePhysicalBuild: true,
      applyObservedActiveCandidate: true,
      applyDidNotMislabelStaleReplay: true,
      populatedRemovalBlocked: true,
      schemaAStayedActive: true,
      remediatedThroughSchemaA: true,
      activatedSchemaB: true,
      schemaBRejectedRemovedArgument: true,
      schemaBRejectedRemovedWrite: true,
      finalDocumentConformsToSchemaB: true,
      analysisWorkerLoads: 6,
      runtimeWorkerLoads: 7,
      commitCount: 3,
      outcomeCount: 3,
      feedCount: 3,
      outboxCount: 3,
    });
  }, 480_000);
});
