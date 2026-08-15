import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaE } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema E", () => {
  it("keeps paused validation sound across valid and invalid active writes", async () => {
    await expect(proveManagedSchemaCookingSchemaE()).resolves.toEqual({
      plannedConcurrentWriteValidation: true,
      pausedAfterNonNullCursor: true,
      candidateValidCommitPreservedProgress: true,
      candidateInvalidCommitPublished: true,
      candidateInvalidCommitFailedValidationAtomically: true,
      failureEvidenceWasPathOnly: true,
      schemaDStayedActive: true,
      finalWritesVisibleThroughSchemaD: true,
      analysisWorkerLoads: 16,
      runtimeWorkerLoads: 20,
      commitCount: 8,
      outcomeCount: 8,
      feedCount: 8,
      outboxCount: 8,
    });
  }, 480_000);
});
