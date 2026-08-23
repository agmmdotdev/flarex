import { describe, expect, it } from "vitest";

import { proveApplicationNativeMutation } from
  "../../support/applicationNativeMutationHarness";

describe("Application-native Standard mutation - PGlite", () => {
  it("composes active Application authority through the shared commit tail", async () => {
    const proof = await proveApplicationNativeMutation();
    expect(proof).toMatchObject({
      initialCommit: {
        publication: { disposition: "published" },
        replay: { disposition: "replayed" },
        conflictingRequestKey: {
          disposition: "rejected",
          errorTag: "CommittedPointOutcomeRequestKeyReuseErrorV1",
          mismatches: ["requestSha256"],
        },
      },
      validationCaught: true,
      concurrentDuplicateInProgress: true,
      concurrentDuplicateReplay: true,
      occConflictReran: true,
      staleHeadRejected: true,
      admittedHeadStayedPinned: true,
      terminalJournalFailureDidNotCommit: true,
      terminalFailureDidNotCommit: true,
      candidateSchemaWriteGuard: {
        exact: { disposition: "accepted" },
        copied: {
          disposition: "rejected",
          errorTag: "ApplicationMutationSystemConfigurationError",
          reason: "invalidCandidateSchemaWriteGuard",
        },
        foreignAuthority: {
          disposition: "rejected",
          errorTag: "ApplicationMutationSystemConfigurationError",
          reason: "invalidCandidateSchemaWriteGuard",
        },
        missing: {
          disposition: "rejected",
          errorTag: "ApplicationMutationSystemConfigurationError",
          reason: "invalidCandidateSchemaWriteGuard",
        },
      },
      freshWorkerLoads: 9,
      commitCount: 6,
      outcomeCount: 6,
      feedCount: 6,
      outboxCount: 6,
    });
    expect(proof.initialCommit.publication.value).toEqual(expect.any(String));
    expect(proof.initialCommit.replay.commitSeq).toBe(
      proof.initialCommit.publication.commitSeq,
    );
    expect(proof.initialCommit.replay.workerLoads).toBe(
      proof.initialCommit.publication.workerLoads,
    );
  }, 480_000);
});
