import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import {
  MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
  captureQueryDescriptor,
  captureQueryOperationTarget,
  compareCanonicalBase64Url,
  type BlockedEvaluationWorkEvidence,
  type EvaluationWorkScanContinuation,
  type EvaluationWorkScanRequest,
} from "@flarex/query-sync/internal/kernel";
import type {
  QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import {
  makeEmptyQuerySyncScopeFacts,
  planBeginQueryEvaluation,
  planRecordEvaluationAttemptOutcome,
} from "@flarex/query-sync/internal/transition-plan";
import { Effect, Encoding } from "effect";

import {
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
  type EncodedDeploymentQuerySyncQueryRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "../src/deploymentSync/RowCodec";

import {
  type AffectedRowRefusalMode,
  type EvaluationSqlFault,
  type EvaluationSqlInvocation,
  type EvaluationSqlProbe,
  makeEvaluationSqlProbe,
  type PreparedEvaluationState,
  success,
} from "./deploymentSyncEvaluationStateTestSupport";

export type ClaimSqlStage =
  | "contract-read"
  | "scope-read"
  | "anchor-read"
  | "scan-read"
  | "selected-query-read"
  | "selected-query-write"
  | "scope-write";

export interface ClaimSqlStageMutation {
  readonly stage: ClaimSqlStage;
  readonly occurrence: number;
  readonly mutate: () => void;
}

export interface ClaimSqlProbe extends EvaluationSqlProbe<ClaimSqlStage> {
  readonly startStageMutation: (mutation: ClaimSqlStageMutation) => void;
}

export interface MaximumBlockedClaimState {
  readonly lowestBlockedWork: BlockedEvaluationWorkEvidence;
}

export const CLAIM_COMMON_READ_STAGES = Object.freeze([
  "contract-read",
  "scope-read",
] as const satisfies readonly ClaimSqlStage[]);

export function makeClaimSqlProbe(): ClaimSqlProbe {
  const base = makeEvaluationSqlProbe(classifyClaimSql);
  let stageMutation: ClaimSqlStageMutation | undefined;
  let matchingOccurrences = 0;
  const clearStageMutation = () => {
    stageMutation = undefined;
    matchingOccurrences = 0;
  };
  const hooks = Object.freeze({
    ...base.hooks,
    beforeExecute: (invocation: EvaluationSqlInvocation) => {
      base.hooks.beforeExecute?.(invocation);
      const activeMutation = stageMutation;
      if (
        activeMutation === undefined
        || classifyClaimSql(invocation) !== activeMutation.stage
      ) return;
      matchingOccurrences += 1;
      if (matchingOccurrences !== activeMutation.occurrence) return;
      stageMutation = undefined;
      activeMutation.mutate();
    },
  });
  return Object.freeze({
    ...base,
    hooks,
    start: (fault?: EvaluationSqlFault) => {
      clearStageMutation();
      base.start(fault);
    },
    startAffectedRowRefusal: (
      writeOrdinal: number,
      mode: AffectedRowRefusalMode,
    ) => {
      clearStageMutation();
      base.startAffectedRowRefusal(writeOrdinal, mode);
    },
    startStageMutation: (mutation: ClaimSqlStageMutation) => {
      if (!Number.isSafeInteger(mutation.occurrence) || mutation.occurrence < 1) {
        throw new Error("Claim SQL mutation occurrence must be positive.");
      }
      stageMutation = Object.freeze({ ...mutation });
      matchingOccurrences = 0;
      base.start();
    },
    stop: () => {
      clearStageMutation();
      return base.stop();
    },
  });
}

export function claimRequest(
  maximumQueryInspections: number,
  continuation: EvaluationWorkScanContinuation | null = null,
): EvaluationWorkScanRequest {
  return Object.freeze({ maximumQueryInspections, continuation });
}

export async function claimEvaluationWork(
  prepared: PreparedEvaluationState,
  request: EvaluationWorkScanRequest,
) {
  return Effect.runPromise(prepared.state.claimEvaluationWork(request));
}

export function seedMaximumBlockedClaimState(
  prepared: PreparedEvaluationState,
): MaximumBlockedClaimState {
  const database = prepared.database;
  const insertQuery = database.prepare(INSERT_QUERY_SQL);
  let scope: QuerySyncScopeFacts = makeEmptyQuerySyncScopeFacts(
    prepared.binding.bootstrapCursor,
  );
  let lowestBlockedWork: BlockedEvaluationWorkEvidence | null = null;
  database.exec("BEGIN IMMEDIATE");
  try {
    for (
      let index = 0;
      index < MAX_EVALUATION_WORK_QUERY_INSPECTIONS;
      index += 1
    ) {
      const descriptor = success(captureQueryDescriptor({
        queryKey: indexedCanonicalValue(index, 0x4b),
        queryIdentity: indexedCanonicalValue(index, 0x69),
      }));
      const target = success(captureQueryOperationTarget({
        namespaceId: prepared.binding.namespaceId,
        syncModelId: prepared.binding.syncModelId,
        sourceEpoch: prepared.binding.sourceEpoch,
        descriptor,
      }));
      const begin = success(planBeginQueryEvaluation({
        scope,
        query: null,
        request: {
          target,
          expectedActiveGeneration: null,
          requestedDirtyThroughSequence: null,
        },
      }));
      if (begin._tag !== "write" || begin.receipt._tag !== "created") {
        throw new Error(`Expected maximum fixture begin write at ${index}.`);
      }
      const query = Object.freeze({
        descriptor: begin.change.descriptor,
        active: null,
        provisional: begin.change.provisional,
        currentCompletion: null,
        precedingCompletionIdentity: null,
      });
      const blocked = success(planRecordEvaluationAttemptOutcome({
        scope: begin.nextScope,
        query,
        attempt: begin.receipt.attempt,
        outcome: "terminalRefusal",
      }));
      if (
        blocked._tag !== "write"
        || blocked.receipt._tag !== "blocked"
        || blocked.change._tag !== "replaceEvaluationAttemptDisposition"
      ) {
        throw new Error(`Expected maximum fixture block write at ${index}.`);
      }
      insertQuery.run(...queryRowValues(encodeDeploymentQuerySyncQueryRow({
        descriptor: query.descriptor,
        active: null,
        provisional: blocked.change.provisional,
      })));
      scope = blocked.nextScope;
      const evidence = blocked.receipt.blockedWork;
      if (
        lowestBlockedWork === null
        || compareCanonicalBase64Url(
          evidence.queryKey,
          lowestBlockedWork.queryKey,
        ) < 0
      ) {
        lowestBlockedWork = evidence;
      }
    }
    replaceScopeRow(database, encodeDeploymentQuerySyncScopeRow({
      scopeUuid: prepared.binding.scopeUuid,
      epochUuid: prepared.binding.epochUuid,
      storageGeneration: prepared.binding.storageGeneration,
      storageGenerationFence: prepared.binding.storageGenerationFence,
      syncModelId: prepared.binding.syncModelId,
      facts: scope,
    }));
    database.exec("COMMIT");
  } catch (cause) {
    database.exec("ROLLBACK");
    throw cause;
  }
  if (lowestBlockedWork === null) {
    throw new Error("Expected at least one maximum blocked query.");
  }
  return Object.freeze({ lowestBlockedWork });
}

export function insertUndecodableClaimScanSentinel(
  prepared: PreparedEvaluationState,
): string {
  const sentinelQueryKey = "~".repeat(43);
  prepared.database.prepare(INSERT_QUERY_SQL).run(
    sentinelQueryKey,
    indexedCanonicalValue(MAX_EVALUATION_WORK_QUERY_INSPECTIONS, 0x69),
    null,
    null,
    null,
    null,
    null,
    null,
    "1",
    null,
    prepared.binding.bootstrapCursor.appliedThroughSequence.toString(),
    null,
    "blocked",
  );
  return sentinelQueryKey;
}

export function classifyClaimSql(
  invocation: EvaluationSqlInvocation,
): ClaimSqlStage {
  const sql = invocation.query.replace(/\s+/gu, " ").trim().toLowerCase();
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_contract_state")
  ) return "contract-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_scope_state")
  ) return "scope-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
    && !sql.includes("active_generation")
  ) return "anchor-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
    && sql.includes("active_dirty_through_sequence")
    && !sql.includes("query_identity")
  ) return "scan-read";
  if (
    sql.startsWith("select")
    && sql.includes("from main.deployment_sync_queries")
    && sql.includes("query_identity")
  ) return "selected-query-read";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_queries set")
  ) return "selected-query-write";
  if (
    sql.startsWith("update")
    && sql.includes("main.deployment_sync_scope_state set")
  ) return "scope-write";
  throw new Error(`Unexpected claim SQL while tracing: ${sql}`);
}

function indexedCanonicalValue(index: number, fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  new DataView(bytes.buffer).setUint32(0, index, false);
  return Encoding.encodeBase64Url(bytes);
}

const INSERT_QUERY_SQL = `INSERT INTO deployment_sync_queries (
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
  provisional_disposition
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function queryRowValues(
  row: EncodedDeploymentQuerySyncQueryRow,
): readonly SQLInputValue[] {
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
  ];
}

function replaceScopeRow(
  database: DatabaseSync,
  row: EncodedDeploymentQuerySyncScopeRow,
): void {
  const result = database.prepare(`UPDATE deployment_sync_scope_state SET
    scope_uuid = ?,
    epoch_uuid = ?,
    storage_generation = ?,
    storage_generation_fence = ?,
    sync_model_id = ?,
    applied_through_sequence = ?,
    evaluation_work_revision = ?,
    fairness_anchor = ?,
    query_count = ?,
    retained_identity_bytes = ?,
    dependency_memberships = ?,
    pending_publication_count = ?,
    in_flight_publication_count = ?,
    retained_publication_content_bytes = ?,
    settlement_envelope_bytes = ?,
    counted_canonical_bytes = ?
    WHERE singleton = 1`).run(...scopeRowValues(row));
  if (result.changes !== 1) {
    throw new Error("Expected one maximum fixture scope row replacement.");
  }
}

function scopeRowValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): readonly SQLInputValue[] {
  return [
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
