import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { QuerySyncState } from "@flarex/query-sync/internal/kernel";

import type {
  DeploymentQuerySyncBinding,
} from "../src/deploymentSync/Binding";
import {
  encodeDeploymentQuerySyncDependencyRow,
  type EncodedDeploymentQuerySyncDependencyRow,
} from "../src/deploymentSync/DependencyRowCodec";
import {
  encodeDeploymentQuerySyncCompleteQueryRow,
  encodeDeploymentQuerySyncPendingPublicationRow,
  type EncodedDeploymentQuerySyncCompleteQueryRow,
  type EncodedDeploymentQuerySyncPendingPublicationRow,
} from "../src/deploymentSync/EvaluationRowCodec";
import {
  encodeDeploymentQuerySyncScopeRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";

export function seedEvaluationPopulation(
  database: DatabaseSync,
  binding: DeploymentQuerySyncBinding,
  state: QuerySyncState,
): void {
  assertGeneration3PublicationLifecycle(state);
  const scopeRow = encodeDeploymentQuerySyncScopeRow({
    scopeUuid: binding.scopeUuid,
    epochUuid: binding.epochUuid,
    storageGeneration: binding.storageGeneration,
    storageGenerationFence: binding.storageGenerationFence,
    syncModelId: binding.syncModelId,
    facts: Object.freeze({
      cursor: state.cursor,
      evaluationWork: state.evaluationWork,
      metrics: state.metrics,
    }),
  });
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM deployment_sync_pending_publications");
    database.exec("DELETE FROM deployment_sync_query_dependencies");
    database.exec("DELETE FROM deployment_sync_queries");
    database.exec("DELETE FROM deployment_sync_scope_state");
    database.prepare(`INSERT INTO deployment_sync_scope_state (
      singleton,
      scope_uuid,
      epoch_uuid,
      storage_generation,
      storage_generation_fence,
      sync_model_id,
      applied_through_sequence,
      evaluation_work_revision,
      fairness_anchor,
      query_count,
      retained_identity_bytes,
      dependency_memberships,
      pending_publication_count,
      in_flight_publication_count,
      retained_publication_content_bytes,
      settlement_envelope_bytes,
      counted_canonical_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(...scopeRowValues(scopeRow));

    const insertQuery = database.prepare(`INSERT INTO deployment_sync_queries (
      query_key,
      query_identity,
      active_generation,
      active_evaluation_snapshot_sequence,
      active_fresh_through_sequence,
      active_dirty_through_sequence,
      active_result_digest,
      active_authority_witness,
      provisional_generation,
      provisional_expected_active_generation,
      provisional_registration_sequence,
      provisional_requested_dirty_through_sequence,
      provisional_disposition,
      completion_generation,
      completion_expected_active_generation,
      completion_registration_sequence,
      completion_requested_dirty_through_sequence,
      completion_evaluation_snapshot_sequence,
      completion_evaluation_authority_witness,
      completion_refreshed_through_sequence,
      completion_relevant_through_sequence,
      completion_refresh_authority_witness,
      completion_result_digest,
      completion_publication_disposition,
      preceding_completion_generation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertDependency = database.prepare(
      `INSERT INTO deployment_sync_query_dependencies (
        role,
        query_key,
        generation,
        dependency_key
      ) VALUES (?, ?, ?, ?)`,
    );
    const insertPending = database.prepare(
      `INSERT INTO deployment_sync_pending_publications (
        query_key,
        generation,
        query_identity,
        completed_through_sequence,
        result_digest,
        content
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const query of state.queries.toReversed()) {
      insertQuery.run(...queryRowValues(
        encodeDeploymentQuerySyncCompleteQueryRow(query),
      ));
      const active = query.active;
      if (active !== null) {
        for (const dependencyKey of active.dependencyKeys) {
          insertDependency.run(...dependencyRowValues(
            encodeDeploymentQuerySyncDependencyRow({
              role: "active",
              queryKey: query.descriptor.queryKey,
              generation: active.generation,
              dependencyKey,
            }),
          ));
        }
      }
      const completion = query.currentCompletion;
      if (completion !== null) {
        for (const dependencyKey of completion.evaluationDependencyKeys) {
          insertDependency.run(...dependencyRowValues(
            encodeDeploymentQuerySyncDependencyRow({
              role: "completion",
              queryKey: query.descriptor.queryKey,
              generation: completion.identity.generation,
              dependencyKey,
            }),
          ));
        }
      }
    }
    for (const publication of state.publicationWork.pending) {
      insertPending.run(...pendingPublicationRowValues(
        encodeDeploymentQuerySyncPendingPublicationRow(publication),
      ));
    }
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
}

function assertGeneration3PublicationLifecycle(state: QuerySyncState): void {
  if (
    state.publicationWork.inFlight !== null
    || state.publicationWork.latestDelivered !== null
    || state.publicationWork.precedingAttemptOutcome !== null
    || state.metrics.inFlightPublicationCount !== 0
    || state.metrics.settlementEnvelopeBytes !== 0
  ) {
    throw new Error(
      "Generation-3 evaluation fixtures cannot retain C3 publication lifecycle state.",
    );
  }
}

function scopeRowValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): SQLInputValue[] {
  return [
    row.singleton,
    row.scope_uuid,
    row.epoch_uuid,
    row.storage_generation,
    row.storage_generation_fence,
    row.sync_model_id,
    row.applied_through_sequence,
    row.evaluation_work_revision,
    row.fairness_anchor,
    row.query_count,
    row.retained_identity_bytes,
    row.dependency_memberships,
    row.pending_publication_count,
    row.in_flight_publication_count,
    row.retained_publication_content_bytes,
    row.settlement_envelope_bytes,
    row.counted_canonical_bytes,
  ];
}

function queryRowValues(
  row: EncodedDeploymentQuerySyncCompleteQueryRow,
): SQLInputValue[] {
  return [
    row.query_key,
    row.query_identity,
    row.active_generation,
    row.active_evaluation_snapshot_sequence,
    row.active_fresh_through_sequence,
    row.active_dirty_through_sequence,
    row.active_result_digest,
    row.active_authority_witness,
    row.provisional_generation,
    row.provisional_expected_active_generation,
    row.provisional_registration_sequence,
    row.provisional_requested_dirty_through_sequence,
    row.provisional_disposition,
    row.completion_generation,
    row.completion_expected_active_generation,
    row.completion_registration_sequence,
    row.completion_requested_dirty_through_sequence,
    row.completion_evaluation_snapshot_sequence,
    row.completion_evaluation_authority_witness,
    row.completion_refreshed_through_sequence,
    row.completion_relevant_through_sequence,
    row.completion_refresh_authority_witness,
    row.completion_result_digest,
    row.completion_publication_disposition,
    row.preceding_completion_generation,
  ];
}

function dependencyRowValues(
  row: EncodedDeploymentQuerySyncDependencyRow,
): SQLInputValue[] {
  return [row.role, row.query_key, row.generation, row.dependency_key];
}

function pendingPublicationRowValues(
  row: EncodedDeploymentQuerySyncPendingPublicationRow,
): SQLInputValue[] {
  return [
    row.query_key,
    row.generation,
    row.query_identity,
    row.completed_through_sequence,
    row.result_digest,
    row.content,
  ];
}
