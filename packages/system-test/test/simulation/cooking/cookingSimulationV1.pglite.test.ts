import { Effect } from "effect";
import { expect, it } from "vitest";
import { createMigratedSplitPGlitePersistence as createMigratedPGlitePersistence } from
  "../../support/databaseFixturesV1";
import {
  makePGliteStandardApplicationSystemTestLaneV1,
} from "@flarex/system-test/lanes/v1";
import {
  runStandardApplicationSimulationV1,
} from "@flarex/system-test/environment/v1";

import { expectSinglePublicationInspectionV1 } from
  "../support/inspectionAssertionsV1";
import { cookingSimulationV1 } from "./cookingSimulationV1";
import { readCookingTaskStateV1 } from "./cookingTaskStateV1";

it("runs the cooking simulation through the real Standard path", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const proof = await Effect.runPromise(runStandardApplicationSimulationV1({
    lane: makePGliteStandardApplicationSystemTestLaneV1(persistence),
    simulation: cookingSimulationV1,
  }));

  expect(proof).toMatchObject({
    version: 1,
    simulationId: "cooking-rich-recipe-point-lifecycle-v1",
    applicationId: "cooking",
    lane: "pglite",
    definitionAnalyzedRegisteredReadyActivated: true,
    workloadProof: {
      richDocumentRoundTrip: true,
      taskCreationReplay: true,
      taskNestedQueryOutputValidated: true,
      taskHostedDeliveryCompleted: true,
      rejectedInvalidMutations: 5,
      invalidArgumentsRejectedBeforeRuntime: true,
      committedStateUnchangedAfterRejections: true,
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
    mutationRuntimeExecutions: 19,
    queryRuntimeExecutions: 19,
    postgresVersion: null,
  });
  expect(proof.workloadProof.documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expect(proof.workloadProof.taskRunId).not.toHaveLength(0);
  expect(await readCookingTaskStateV1(persistence.target)).toEqual([{
    catalog_count: "1",
    definition_count: "1",
    legacy_definition_revision_count: "0",
    run_count: "1",
    request_count: "1",
    attempt_count: "1",
    pending_count: "0",
    dispatch_count: "1",
    terminal_run_count: "1",
  }]);
  expect(proof.workloadProof.secondaryDocumentId)
    .toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  expect(proof.workloadProof.secondaryDocumentId)
    .not.toBe(proof.workloadProof.documentId);
  for (const documentId of [
    proof.workloadProof.racePrimaryDocumentId,
    proof.workloadProof.raceCompetitorDocumentId,
    proof.workloadProof.indexedPhantomDocumentId,
    proof.workloadProof.pantryDocumentId,
  ]) {
    expect(documentId).toMatch(/^[0-9]+:[0-9a-f-]{36}$/);
  }
  expectSinglePublicationInspectionV1(
    proof.afterSetupInspection,
    "recipes",
    proof.workloadProof.documentId,
    1,
    0,
  );
  const currentRows = [{
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
  }].sort((left, right) => left.documentId < right.documentId ? -1 : 1);
  const lifecycleInspection = {
    version: 1,
    currentRows,
    currentRowCount: 6,
    liveRowCount: 5,
    revisionRowCount: 14,
    commitSeqs: [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13",
    ],
    idempotencyOutcomeCommitSeqs: [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13",
    ],
    commitFeedCommitSeqs: [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "12", "13",
    ],
    outboxCommitSeqs: [
      "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13",
    ],
    mutationRuntimeExecutions: 19,
    queryRuntimeExecutions: 19,
  } as const;
  expect(proof.workloadProof.workloadInspection).toEqual(lifecycleInspection);
  expect(proof.finalInspection).toEqual(lifecycleInspection);
  const sidecarCounts = await persistence.target.query<{
    revisions: string;
    current_rows: string;
  }>(`select
    (select count(*)::text from fx_app_index_entry_rev) as revisions,
    (select count(*)::text from fx_app_index_entry_current) as current_rows`);
  expect(sidecarCounts.rows[0]).toEqual({
    revisions: "41",
    current_rows: "13",
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
    row_id_hex: pointRowIdHex(proof.workloadProof.raceCompetitorDocumentId),
    commit_seq: "12",
    is_tombstone: false,
    is_current: true,
  }, {
    access_kind: "developer",
    table_id: "2",
    row_id_hex: pointRowIdHex(proof.workloadProof.raceCompetitorDocumentId),
    commit_seq: "12",
    is_tombstone: false,
    is_current: true,
  }, {
    access_kind: "developer",
    table_id: "2",
    row_id_hex: pointRowIdHex(proof.workloadProof.raceCompetitorDocumentId),
    commit_seq: "12",
    is_tombstone: false,
    is_current: true,
  }]);
}, 480_000);

function pointRowIdHex(documentId: string): string {
  return documentId.slice(documentId.indexOf(":") + 1).replaceAll("-", "");
}
