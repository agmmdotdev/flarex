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
  it("preserves lifecycle and deterministic pantry OCC invariants", async () => {
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
          invalidReturnRollsBack: true,
          thrownFailureRollsBack: true,
          failedMutationsReachedRuntime: true,
          failedMutationStateUnchanged: true,
          applicationInvariantRejected: true,
          applicationErrorPreserved: true,
          applicationInvariantFailureStateUnchanged: true,
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
          pantryConflictReran: true,
          singleStockReservationCommitted: true,
          stockNeverNegative: true,
          losingReservationWritesRolledBack: true,
          competitorReservationReplay: true,
        },
        mutationRuntimeExecutions: 15,
        queryRuntimeExecutions: 14,
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
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.racePrimaryDocumentId,
          commitSeq: "7",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.raceCompetitorDocumentId,
          commitSeq: "10",
          valueState: "live",
        }, {
          tableName: "pantryStock",
          documentId: proof.workloadProof.pantryDocumentId,
          commitSeq: "10",
          valueState: "live",
        }]),
        currentRowCount: 5,
        liveRowCount: 4,
        revisionRowCount: 11,
        commitSeqs: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
        idempotencyOutcomeCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
        ],
        commitFeedCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10",
        ],
        outboxCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
        ],
      });
      const sidecarCounts = await persistence.query<{
        revisions: string;
        current_rows: string;
      }>(`select
        (select count(*)::text from fx_app_index_entry_rev) as revisions,
        (select count(*)::text from fx_app_index_entry_current) as current_rows`);
      expect(sidecarCounts.rows[0]).toEqual({
        revisions: "21",
        current_rows: "7",
      });
      const crossTableSidecars = await persistence.query<{
        access_kind: string;
        table_id: string;
        row_id_hex: string;
        commit_seq: string;
        is_tombstone: boolean;
        is_current: boolean;
      }>(`select definition.access_kind,
          revision.table_id::text,
          encode(revision.row_id, 'hex') as row_id_hex,
          revision.commit_seq::text,
          revision.is_tombstone,
          current_entry.row_id is not null as is_current
        from fx_app_index_entry_rev as revision
        join fx_control_index_definition as definition
          on definition.index_definition_id = revision.index_definition_id
        left join fx_app_index_entry_current as current_entry
          on current_entry.scope_uuid = revision.scope_uuid
         and current_entry.index_definition_id = revision.index_definition_id
         and current_entry.encoded_key = revision.encoded_key
         and current_entry.row_id = revision.row_id
         and current_entry.commit_seq = revision.commit_seq
        where revision.commit_seq = 10
        order by definition.access_kind, revision.table_id`);
      expect(crossTableSidecars.rows).toEqual([{
        access_kind: "by_creation_time",
        table_id: "1",
        row_id_hex: pointRowIdHex(proof.workloadProof.pantryDocumentId),
        commit_seq: "10",
        is_tombstone: false,
        is_current: true,
      }, {
        access_kind: "by_creation_time",
        table_id: "2",
        row_id_hex: pointRowIdHex(
          proof.workloadProof.raceCompetitorDocumentId,
        ),
        commit_seq: "10",
        is_tombstone: false,
        is_current: true,
      }, {
        access_kind: "developer",
        table_id: "2",
        row_id_hex: pointRowIdHex(
          proof.workloadProof.raceCompetitorDocumentId,
        ),
        commit_seq: "10",
        is_tombstone: false,
        is_current: true,
      }]);
      expect(proof.postgresVersion).toMatch(/^PostgreSQL \d+\.\d+\b/);
    });
  }, 480_000);
});

function pointRowIdHex(documentId: string): string {
  return documentId.slice(documentId.indexOf(":") + 1).replaceAll("-", "");
}
