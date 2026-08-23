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
      validationCatch: {
        disposition: "published",
        caughtValidationCount: 1,
      },
      concurrentDuplicate: {
        contender: {
          disposition: "rejected",
          errorTag: "ApplicationMutationOutcomeUnavailableError",
          reason: "inProgress",
        },
        publication: { disposition: "published" },
        replay: { disposition: "replayed" },
      },
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
    expect(proof.validationCatch.commitSeq).toBe(
      proof.initialCommit.replay.commitSeq + 1n,
    );
    expect(proof.validationCatch.workerLoads).toBe(
      proof.initialCommit.replay.workerLoads + 1,
    );
    expect(proof.concurrentDuplicate.publication.commitSeq).toBe(
      proof.validationCatch.commitSeq + 1n,
    );
    expect(proof.concurrentDuplicate.publication.commitSeq).toBe(
      proof.concurrentDuplicate.replay.commitSeq,
    );
    expect(proof.concurrentDuplicate.workerLoadsBeforeRelease).toBe(
      proof.validationCatch.workerLoads + 1,
    );
    expect(proof.concurrentDuplicate.publication.workerLoads).toBe(
      proof.concurrentDuplicate.workerLoadsBeforeRelease,
    );
    expect(proof.concurrentDuplicate.publication.workerLoads).toBe(
      proof.concurrentDuplicate.replay.workerLoads,
    );
  }, 480_000);
});
