import { describe, expect, it } from "vitest";

import {
  proveManagedSchemaCookingSchemaB,
  proveManagedSchemaCandidateUniqueAfterActiveWrite,
  proveManagedSchemaCandidateIndexCoverageBoundaries,
  proveManagedSchemaCandidateIndexAfterActiveWrite,
} from "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema B", () => {
  it("blocks populated removal, preserves A, remediates, and activates B", async () => {
    await expect(proveManagedSchemaCookingSchemaB()).resolves.toEqual({
      plannedManagedValidation: true,
      developerAdapterProjectionDetached: true,
      developerAdapterProjectionJsonSafe: true,
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
  it("keeps a candidate index complete after an active write and normal replan", async () => {
    await expect(
      proveManagedSchemaCandidateIndexAfterActiveWrite(),
    ).resolves.toEqual({
      candidateIndexEnabledBeforeWrite: true,
      schemaAStayedActive: true,
      activeWritePublished: true,
      originalPlanRejectedAsStale: true,
      sameCandidateActivatedAfterReplan: true,
      pointReadFoundDocument: true,
      staleCoverageBlockedReadiness: true,
      activeKeyMovesAndDeletionPublished: true,
      catchUpRollbackAndUncertainReplay: true,
      originalSnapshotHistoryPreserved: true,
      indexedDocumentCount: 1,
      indexMatchesPoint: true,
      indexPageIsDone: true,
    });
  }, 480_000);
  it.each(["cursorAndWholeCommit", "retainedGap", "oversizedHistory"] as const)(
    "preserves candidate coverage boundary: %s",
    async (mode) => {
      await expect(
        proveManagedSchemaCandidateIndexCoverageBoundaries(mode),
      ).resolves.toBe(true);
    },
    480_000,
  );
  it("blocks stale candidate uniqueness after valid active duplicates and repairs", async () => {
    await expect(proveManagedSchemaCandidateUniqueAfterActiveWrite()).resolves.toBe(true);
  }, 480_000);

});
