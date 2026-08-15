import { describe, expect, it } from "vitest";

import { proveApplicationNativeMutation } from
  "../../support/applicationNativeMutationHarness";

describe("Application-native Standard mutation - PGlite", () => {
  it("composes active Application authority through the shared commit tail", async () => {
    await expect(proveApplicationNativeMutation()).resolves.toMatchObject({
      published: true,
      exactReplay: true,
      conflictingReuseRejected: true,
      validationCaught: true,
      concurrentDuplicateInProgress: true,
      concurrentDuplicateReplay: true,
      occConflictReran: true,
      staleHeadRejected: true,
      admittedHeadStayedPinned: true,
      terminalJournalFailureDidNotCommit: true,
      terminalFailureDidNotCommit: true,
      exactCandidateGuardComposed: true,
      copiedCandidateGuardRejected: true,
      foreignCandidateGuardAuthorityRejected: true,
      missingCandidateGuardRejected: true,
      freshWorkerLoads: 9,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    });
  }, 480_000);
});
