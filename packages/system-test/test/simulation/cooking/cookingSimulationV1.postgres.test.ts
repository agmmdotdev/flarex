import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  withTemporarySplitPostgresPersistence,
} from "../../support/databaseFixturesV1";
import {
  makePostgresDatabaseLane,
} from "@flarex/system-test/lanes";
import {
  runSimulation,
} from "@flarex/system-test/environment";

import { cookingSimulationV1 } from "./cookingSimulationV1";
import { readCookingActionStateV1 } from "./cookingActionStateV1";
import {
  readCookingTaskRecoveryReplayStateV1,
  readCookingTaskStateV1,
} from "./cookingTaskStateV1";

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
    await withTemporarySplitPostgresPersistence(async persistence => {
      const proof = await Effect.runPromise(runSimulation({
        lane: makePostgresDatabaseLane(persistence),
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
          taskCreationReplay: true,
          taskNestedQueryOutputValidated: true,
          taskHostedDeliveryCompleted: true,
          taskMutationCreationReplay: true,
          taskMutationWorkflowCommitted: true,
          taskMutationNestedQueryOutputValidated: true,
          taskMutationDuplicateDeliverySuppressed: true,
          taskMutationCompletionCreationReplay: true,
          taskMutationCompletionResponseReplayed: true,
          taskMutationCompletionWorkflowCommitted: true,
          taskMutationCompletionNestedQueryOutputValidated: true,
          taskMutationResultReconciliationCreationReplay: true,
          taskMutationResultPublicationReconciled: true,
          taskMutationResultReconciliationWorkflowCommitted: true,
          taskMutationResultReconciliationNestedQueryOutputValidated: true,
          taskMutationResultUncertainCreationReplay: true,
          taskMutationResultPublicationUncertain: true,
          taskMutationResultUncertainWorkflowCommitted: true,
          taskMutationResultUncertainCommittedAssessmentValidated: true,
          taskMutationResultUncertainTerminalResultFabricated: false,
          taskMutationRecoveryCreationReplay: true,
          taskMutationRecoveredAfterResultUncertainty: true,
          taskMutationRecoveryCommittedOnce: true,
          taskMutationRecoveryNestedQueryOutputValidated: true,
          actionPublishedAndValidated: true,
          actionPublicQueryCallback: true,
          actionInternalMutationCallback: true,
          actionControlledOutbound: true,
          actionAnonymousIdentity: true,
          actionReplay: true,
          actionDeniedOutboundFailedBeforeDispatch: true,
          actionDeniedOutboundReplay: true,
          actionOutboundUncertaintyPersisted: true,
          actionOutboundUncertaintyReplay: true,
          actionInvalidReturnFailed: true,
          actionInvalidReturnReplay: true,
          actionCommittedMutationSurvivedFailure: true,
          actionCommittedMutationFailureReplay: true,
          actionRejectedMutationUncertain: true,
          actionRejectedMutationReplay: true,
          actionRejectedMutationRolledBack: true,
          mutationReplay: true,
          secondaryMutationReplay: true,
          queryReplay: true,
          multipleRecipesIsolated: true,
          optionalFieldOmissionRoundTrip: true,
          optionalFieldDeletion: true,
          optionalFieldDeletionReplay: true,
          unicodeRecordRoundTrip: true,
          invalidReturnRollsBack: true,
          thrownFailureRollsBack: true,
          failedMutationsReachedRuntime: true,
          failedMutationStateUnchanged: true,
          applicationInvariantRejected: true,
          applicationErrorPreserved: true,
          queryApplicationErrorPreserved: true,
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
          indexedRangeDecisionReran: true,
          indexedRangeDecisionReplay: true,
          losingIndexedDecisionWriteRolledBack: true,
          pantryConflictReran: true,
          singleStockReservationCommitted: true,
          stockNeverNegative: true,
          losingReservationWritesRolledBack: true,
          competitorReservationReplay: true,
        },
        mutationRuntimeExecutions: 32,
        queryRuntimeExecutions: 30,
        actionRuntimeExecutions: 6,
        actionOutboundRequests: 2,
      });
      expect(proof.afterSetupInspection).toMatchObject({
        currentRowCount: 1,
        liveRowCount: 1,
        revisionRowCount: 1,
        commitSeqs: ["1"],
        commitFeedCommitSeqs: ["1"],
        outboxCommitSeqs: ["1"],
      });
      expect(proof.workloadProof.taskRunId).not.toHaveLength(0);
      expect(proof.workloadProof.taskMutationRunId).not.toHaveLength(0);
      expect(proof.workloadProof.taskMutationCompletionReplayRunId)
        .not.toHaveLength(0);
      expect(proof.workloadProof.taskMutationResultReconciliationRunId)
        .not.toHaveLength(0);
      expect(proof.workloadProof.taskMutationResultUncertainRunId)
        .not.toHaveLength(0);
      expect(proof.workloadProof.taskMutationRecoveryRunId)
        .not.toHaveLength(0);
      expect(await readCookingTaskStateV1(persistence.target)).toEqual([{
        catalog_count: "1",
        definition_count: "2",
        legacy_definition_revision_count: "0",
        run_count: "6",
        request_count: "6",
        attempt_count: "7",
        pending_count: "0",
        dispatch_count: "7",
        terminal_run_count: "5",
        executing_run_count: "1",
        child_mutation_effect_count: "9",
        confirmed_child_mutation_effect_count: "8",
        child_mutation_outcome_count: "8",
      }]);
      expect(await readCookingActionStateV1(persistence.target)).toEqual([{
        invocation_count: "6",
        completed_count: "1",
        failed_count: "3",
        uncertain_count: "2",
        effect_count: "5",
        confirmed_child_mutation_effect_count: "2",
        uncertain_child_mutation_effect_count: "1",
        confirmed_outbound_effect_count: "1",
        uncertain_outbound_effect_count: "1",
        failed_before_dispatch_effect_count: "0",
      }]);
      expect(await readCookingTaskRecoveryReplayStateV1(persistence.target))
        .toEqual([{
          attempt_count: "2",
          request_key_count: "1",
          outcome_count: "1",
          minimum_subject_fence: "1",
          maximum_subject_fence: "2",
        }]);
      expect(proof.finalInspection).toMatchObject({
        currentRows: expect.arrayContaining([{
          tableName: "recipes",
          documentId: proof.workloadProof.documentId,
          commitSeq: "6",
          valueState: "tombstone",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.secondaryDocumentId,
          commitSeq: "25",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.indexedPhantomDocumentId,
          commitSeq: "13",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.racePrimaryDocumentId,
          commitSeq: "9",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.raceCompetitorDocumentId,
          commitSeq: "12",
          valueState: "live",
        }, {
          tableName: "pantryStock",
          documentId: proof.workloadProof.pantryDocumentId,
          commitSeq: "12",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.taskMutationDocumentId,
          commitSeq: "15",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId:
            proof.workloadProof.taskMutationCompletionReplayDocumentId,
          commitSeq: "17",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId:
            proof.workloadProof.taskMutationResultReconciliationDocumentId,
          commitSeq: "19",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId: proof.workloadProof.taskMutationRecoveryDocumentId,
          commitSeq: "21",
          valueState: "live",
        }, {
          tableName: "recipes",
          documentId:
            proof.workloadProof.taskMutationResultUncertainDocumentId,
          commitSeq: "23",
          valueState: "live",
        }]),
        currentRowCount: 11,
        liveRowCount: 10,
        revisionRowCount: 26,
        commitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25",
        ],
        idempotencyOutcomeCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25",
        ],
        commitFeedCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25",
        ],
        outboxCommitSeqs: [
          "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24", "25",
        ],
      });
      const sidecarCounts = await persistence.target.query<{
        revisions: string;
        current_rows: string;
      }>(`select
        (select count(*)::text from fx_app_index_entry_rev) as revisions,
        (select count(*)::text from fx_app_index_entry_current) as current_rows`);
      expect(sidecarCounts.rows[0]).toEqual({
        revisions: "77",
        current_rows: "28",
      });
      const removedFieldEvidence = await persistence.target.query<{
        commit_seq: string;
        value_json: unknown;
      }>(`select revision.commit_seq::text,
          revision.value_json
        from fx_app_row_current as current_row
        join fx_app_row_rev as revision
          on revision.scope_uuid = current_row.scope_uuid
         and revision.table_id = current_row.table_id
         and revision.row_id = current_row.row_id
         and revision.commit_seq = current_row.commit_seq
        where encode(current_row.row_id, 'hex') = $1`, [
        pointRowIdHex(proof.workloadProof.indexedPhantomDocumentId),
      ]);
      expect(removedFieldEvidence.rows).toHaveLength(1);
      expect(removedFieldEvidence.rows[0]?.commit_seq).toBe("13");
      expect(removedFieldEvidence.rows[0]?.value_json).not.toHaveProperty(
        "description",
      );
      const optionalFieldSidecars = await persistence.target.query<{
        commit_seq: string;
        current_count: string;
        revision_count: string;
      }>(`select revision.commit_seq::text,
          count(*)::text as revision_count,
          sum(case when current_entry.row_id is null then 0 else 1 end)::text
            as current_count
        from fx_app_index_entry_rev as revision
        left join fx_app_index_entry_current as current_entry
          on current_entry.scope_uuid = revision.scope_uuid
         and current_entry.index_definition_id = revision.index_definition_id
         and current_entry.encoded_key = revision.encoded_key
         and current_entry.row_id = revision.row_id
         and current_entry.commit_seq = revision.commit_seq
        where encode(revision.row_id, 'hex') = $1
          and revision.commit_seq in (8, 13)
        group by revision.commit_seq
        order by revision.commit_seq`, [
        pointRowIdHex(proof.workloadProof.indexedPhantomDocumentId),
      ]);
      expect(optionalFieldSidecars.rows).toEqual([{
        commit_seq: "8",
        current_count: "0",
        revision_count: "3",
      }, {
        commit_seq: "13",
        current_count: "3",
        revision_count: "3",
      }]);
      const indexedDecisionEvidence = await persistence.target.query<{
        lifecycle: string;
        current_attempt_fence: string;
        journal_count: string;
        indexed_query_syscalls: string;
        range_count: string;
      }>(`select session.lifecycle,
          session.attempt_fence::text as current_attempt_fence,
          (select count(*)::text
             from fx_system_tx_journal as journal
            where journal.scope_uuid = session.scope_uuid
              and journal.session_id = session.session_id) as journal_count,
          (select coalesce(sum(journal.indexed_query_syscalls), 0)::text
             from fx_system_tx_journal as journal
            where journal.scope_uuid = session.scope_uuid
              and journal.session_id = session.session_id) as indexed_query_syscalls,
          (select count(*)::text
             from fx_system_tx_journal_index_range as dependency
            where dependency.scope_uuid = session.scope_uuid
              and dependency.session_id = session.session_id) as range_count
        from fx_system_tx_session as session
        where session.request_key = $1`, ["sac01:cooking:publish-smallest-batch"]);
      expect(indexedDecisionEvidence.rows).toEqual([{
        lifecycle: "committed",
        current_attempt_fence: "2",
        journal_count: "0",
        indexed_query_syscalls: "0",
        range_count: "0",
      }]);
      const crossTableSidecars = await persistence.target.query<{
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
        where revision.commit_seq = 12
        order by definition.access_kind, revision.table_id`);
      expect(crossTableSidecars.rows).toEqual([{
        access_kind: "by_creation_time",
        table_id: "1",
        row_id_hex: pointRowIdHex(proof.workloadProof.pantryDocumentId),
        commit_seq: "12",
        is_tombstone: false,
        is_current: true,
      }, {
        access_kind: "by_creation_time",
        table_id: "2",
        row_id_hex: pointRowIdHex(
          proof.workloadProof.raceCompetitorDocumentId,
        ),
        commit_seq: "12",
        is_tombstone: false,
        is_current: true,
      }, {
        access_kind: "developer",
        table_id: "2",
        row_id_hex: pointRowIdHex(
          proof.workloadProof.raceCompetitorDocumentId,
        ),
        commit_seq: "12",
        is_tombstone: false,
        is_current: true,
      }, {
        access_kind: "developer",
        table_id: "2",
        row_id_hex: pointRowIdHex(
          proof.workloadProof.raceCompetitorDocumentId,
        ),
        commit_seq: "12",
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
