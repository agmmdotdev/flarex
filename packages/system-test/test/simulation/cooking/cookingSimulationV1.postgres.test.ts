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
  it("creates, patches, replaces, deletes, and reads one recipe", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
        lane: makePostgresStandardApplicationSystemTestLaneV1(persistence),
        simulation: cookingSimulationV1,
      }));
      expect(proof).toMatchObject({
        lane: "postgres",
        definitionAnalyzedRegisteredReadyActivated: true,
        workloadProof: {
          rejectedInvalidMutations: 2,
          invalidArgumentsRejectedBeforeRuntime: true,
          committedStateUnchangedAfterRejections: true,
          richDocumentRoundTrip: true,
          mutationReplay: true,
          queryReplay: true,
          patchReplay: true,
          replaceReplay: true,
          deleteReplay: true,
          pointMutationLifecycle: true,
          deletedDocumentReadsNull: true,
        },
        mutationRuntimeExecutions: 4,
        queryRuntimeExecutions: 5,
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
        currentRows: [{
          tableName: "recipes",
          documentId: proof.workloadProof.documentId,
          commitSeq: "4",
          valueState: "tombstone",
        }],
        currentRowCount: 1,
        liveRowCount: 0,
        revisionRowCount: 4,
        commitSeqs: ["1", "2", "3", "4"],
        idempotencyOutcomeCommitSeqs: ["1", "2", "3", "4"],
        commitFeedCommitSeqs: ["1", "2", "3", "4"],
        outboxCommitSeqs: ["1", "2", "3", "4"],
      });
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});
