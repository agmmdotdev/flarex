import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "../../support/databaseFixturesV1";
import {
  makePostgresStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";

import { cookingSimulationV1 } from "./cookingSimulationV1";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describe("cooking simulation genuine PostgreSQL environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the system-test PostgreSQL lane.",
    ).not.toBeNull();
  });
});

describePostgres("cooking simulation - PostgreSQL", () => {
  it("isolates two recipes while one completes its full lifecycle", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
        lane: makePostgresStandardApplicationSystemTestLaneV1(persistence),
        simulation: cookingSimulationV1,
      }));
      expect(proof).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        workloadProof: {
          rejectedInvalidMutations: 5,
          invalidArgumentsRejectedBeforeRuntime: true,
          committedStateUnchangedAfterRejections: true,
          richDocumentRoundTrip: true,
          mutationReplay: true,
          secondaryMutationReplay: true,
          queryReplay: true,
          multipleRecipesIsolated: true,
          optionalFieldOmissionRoundTrip: true,
          unicodeRecordRoundTrip: true,
          patchReplay: true,
          replaceReplay: true,
          assessmentUsesCustomLogic: true,
          queryCallsInternalQuery: true,
          mutationCallsInternalQuery: true,
          mutationCallsInternalMutation: true,
          nestedMutationReplay: true,
          nestedMutationPublishesOnce: true,
          deleteReplay: true,
          pointMutationLifecycle: true,
          deletedDocumentReadsNull: true,
        },
        mutationRuntimeExecutions: 6,
        queryRuntimeExecutions: 9,
      });
      expect(proof.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        commitSeqs: ["1"],
        commitFeedCommitSeqs: ["1"],
        outboxCommitSeqs: ["1"],
      });
      expect(proof.finalInspection).toMatchObject({
        currentRows: expect.arrayContaining([{
          tableName: "recipes",
          documentId: proof.workloadProof.documentId,
          commitSeq: "6",
          valueState: "tombstone",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.secondaryDocumentId,
          commitSeq: "2",
          valueState: "live",
        }]),
        currentRowCount: 2,
        liveRowCount: 1,
        revisionRowCount: 6,
        commitSeqs: ["1", "2", "3", "4", "5", "6"],
        idempotencyOutcomeCommitSeqs: ["1", "2", "3", "4", "5", "6"],
        commitFeedCommitSeqs: ["1", "2", "3", "4", "5", "6"],
        outboxCommitSeqs: ["1", "2", "3", "4", "5", "6"],
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
