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
      occConflict: {
        competitor: { disposition: "published" },
        rerun: { disposition: "published" },
        conflictReadCount: 2,
        executions: [{ ordinal: 1 }, { ordinal: 2 }],
      },
      headMovement: {
        staleAdmission: {
          disposition: "rejected",
          errorTag: "ApplicationActivationError",
          operation: "validateSelection",
          reason: "concurrentHead",
          retryable: false,
        },
        publication: { disposition: "published" },
      },
      terminalization: {
        journal: {
          outcome: {
            disposition: "rejected",
            errorTag: "PinnedPointTableNotFoundV1Error",
            deploymentId: expect.any(String),
            schemaVersionId: expect.any(String),
            tableName: "missing_table",
          },
        },
        userCode: {
          outcome: {
            disposition: "rejected",
            errorTag: "PointMutationOccUserCodeV1Error",
            cause: {
              kind: "error",
              name: "ApplicationWorkerUserCodeV1Error",
              message: "application terminal failure",
            },
          },
        },
      },
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
    expect(proof.occConflict.workerLoadsBeforeCompetitor).toBe(
      proof.concurrentDuplicate.replay.workerLoads + 1,
    );
    expect(proof.occConflict.competitor.workerLoads).toBe(
      proof.occConflict.workerLoadsBeforeCompetitor + 1,
    );
    expect(proof.occConflict.rerun.workerLoads).toBe(
      proof.occConflict.competitor.workerLoads + 1,
    );
    expect(proof.occConflict.competitor.commitSeq).toBe(
      proof.concurrentDuplicate.replay.commitSeq + 1n,
    );
    expect(proof.occConflict.rerun.commitSeq).toBe(
      proof.occConflict.competitor.commitSeq + 1n,
    );
    expect(proof.occConflict.executions).toHaveLength(2);
    expect(proof.occConflict.executions.every(execution =>
      execution.revisionId === proof.occConflict.admittedRevisionId
    )).toBe(true);
    expect(proof.headMovement.movedRevisionId).not.toBe(
      proof.headMovement.pinnedRevisionId,
    );
    expect(proof.headMovement.staleAdmission.revisionId).toBe(
      proof.headMovement.pinnedRevisionId,
    );
    expect(proof.headMovement.workerLoadsBeforeRelease).toBe(
      proof.occConflict.rerun.workerLoads + 1,
    );
    expect(proof.headMovement.publication.workerLoads).toBe(
      proof.headMovement.workerLoadsBeforeRelease,
    );
    expect(proof.headMovement.publication.commitSeq).toBe(
      proof.occConflict.rerun.commitSeq + 1n,
    );
    expect(proof.headMovement.executionRevisionIds).toEqual([
      proof.headMovement.pinnedRevisionId,
    ]);
    expect(proof.terminalization.journal.before).toEqual(
      proof.terminalization.journal.after,
    );
    expect(proof.terminalization.journal.workerLoads).toBe(
      proof.headMovement.publication.workerLoads + 1,
    );
    expect(proof.terminalization.userCode.before).toEqual(
      proof.terminalization.journal.after,
    );
    expect(proof.terminalization.userCode.after).toEqual(
      proof.terminalization.userCode.before,
    );
    expect(proof.terminalization.userCode.workerLoads).toBe(
      proof.terminalization.journal.workerLoads + 1,
    );
  }, 480_000);
});
