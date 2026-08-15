import { describe, expect, it } from "vitest";

import { proveManagedSchemaCookingSchemaF } from
  "../../support/managedSchemaCookingHarness";

describe("Managed-schema cooking simulation - schema F", () => {
  it("proves candidate recovery and concurrent activation", async () => {
    await expect(proveManagedSchemaCookingSchemaF()).resolves.toEqual({
      supersededCandidate: true,
      exactCandidateReplay: true,
      decisionUncertaintyColdReplayed: true,
      confirmedRollbackPreservedHead: true,
      concurrentActivationConverged: true,
      corruptionRejectedCold: true,
      activeSchemaSurvivedCandidateCorruption: true,
      candidateHeadCount: 1,
      activationCount: 5,
      activeHeadCount: 1,
      analysisWorkerLoads: 18,
      runtimeWorkerLoads: 18,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    });
  }, 480_000);
});
