import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
} from "@flarex/query-sync/internal/state";
import {
  QuerySyncTransitionFactError,
  type QuerySyncScopeFacts,
} from "@flarex/query-sync/internal/transition-plan";
import { Data, Effect, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  decodeDeploymentQuerySyncScopeRowResult,
  encodeDeploymentQuerySyncScopeRow,
  type DeploymentQuerySyncContractState,
  type DeploymentQuerySyncStoredScopeState,
  type EncodedDeploymentQuerySyncScopeRow,
} from "./RowCodec";
import type {
  DeploymentQuerySyncSqlStorage,
  DeploymentQuerySyncStateOperation,
  DeploymentQuerySyncStorage,
} from "./StorageContract";

export const MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS = 96;

export interface BoundDeploymentQuerySyncStorage {
  readonly sql: DeploymentQuerySyncSqlStorage;
  readonly transactionSync: <A>(closure: () => A) => A;
}

export class DeploymentQuerySyncStoredStateIssue extends Data.TaggedError(
  "DeploymentQuerySyncStoredStateIssue",
)<{
  readonly reason:
    | "authorityMismatch"
    | "capabilityRequired"
    | "rowInvalid"
    | "rowMissing"
    | "rowDuplicate"
    | "scopeCounterMismatch"
    | "transitionFactsRejected";
  readonly evidence: unknown;
}> {}

export class DeploymentQuerySyncAdapterInvariantDefect extends Error {
  constructor(
    readonly operation: DeploymentQuerySyncStateOperation,
    readonly stage = "write",
  ) {
    super(
      `Deployment query-sync ${operation} ${stage} invariant failed.`,
    );
  }
}

interface EncodedSingletonRow {
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
}

export function bindDeploymentQuerySyncStorage(
  storage: DeploymentQuerySyncStorage,
): BoundDeploymentQuerySyncStorage {
  const sql = storage.sql;
  const transactionSync: DeploymentQuerySyncStorage["transactionSync"] =
    storage.transactionSync.bind(storage);
  return Object.freeze({ sql, transactionSync });
}

export function runDeploymentQuerySyncTransaction<A, E>(
  storage: BoundDeploymentQuerySyncStorage,
  program: (sql: DeploymentQuerySyncSqlStorage) => Result.Result<A, E>,
  onRollback?: () => void,
): Effect.Effect<A, E> {
  class TransactionRollback extends Error {
    constructor(readonly failure: E) {
      super("Deployment query-sync transaction rolled back.");
    }
  }

  return Effect.suspend(() => {
    try {
      const value = storage.transactionSync(() => Result.match(
        program(storage.sql),
        {
          onFailure: failure => {
            throw new TransactionRollback(failure);
          },
          onSuccess: success => success,
        },
      ));
      return Effect.succeed(value);
    } catch (cause) {
      onRollback?.();
      return cause instanceof TransactionRollback
        ? Effect.fromResult(Result.fail(cause.failure))
        : Effect.die(cause);
    }
  });
}

export function deploymentQuerySyncStoredStateIssue(
  reason: DeploymentQuerySyncStoredStateIssue["reason"],
  evidence: unknown,
): DeploymentQuerySyncStoredStateIssue {
  return new DeploymentQuerySyncStoredStateIssue({ reason, evidence });
}

export function deploymentQuerySyncStoredStateCorrupt<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  operation: Operation,
  reason: QuerySyncStoredStateCorruptError<Operation>["reason"],
  cause: unknown,
): QuerySyncStoredStateCorruptError<Operation> {
  return new QuerySyncStoredStateCorruptError({
    operation,
    commitCertainty: "notCommitted",
    reason,
    cause,
  });
}

export function deploymentQuerySyncStoredStateIncompatible<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  operation: Operation,
  cause: unknown,
): QuerySyncStoredStateIncompatibleError<Operation> {
  return new QuerySyncStoredStateIncompatibleError({
    operation,
    commitCertainty: "notCommitted",
    reason: "bootstrapBindingMismatch",
    cause,
  });
}

export function mapDeploymentQuerySyncTransitionFactError<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  operation: Operation,
  error: QuerySyncTransitionFactError,
): QuerySyncStoredStateCorruptError<Operation> {
  return deploymentQuerySyncStoredStateCorrupt(
    operation,
    "storedAggregateInvalid",
    deploymentQuerySyncStoredStateIssue("transitionFactsRejected", error),
  );
}

export function readDeploymentQuerySyncScope<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  contract: DeploymentQuerySyncContractState,
  operation: Operation,
  enforcePortableBinding: boolean,
): Result.Result<
  DeploymentQuerySyncStoredScopeState | null,
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>
> {
  const rows = sql.exec<EncodedDeploymentQuerySyncScopeRow & {
    readonly [key: string]: SqlStorageValue;
  }>(`SELECT
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
  FROM main.deployment_sync_scope_state
  ORDER BY singleton
  LIMIT 2`).toArray();

  if (rows.length === 0) {
    return contract.durableInitializedHistory
      ? Result.fail(deploymentQuerySyncStoredStateCorrupt(
        operation,
        "aggregateMissing",
        deploymentQuerySyncStoredStateIssue(
          "rowMissing",
          "scopeAfterInitializedHistory",
        ),
      ))
      : Result.succeed(null);
  }
  if (rows.length !== 1) {
    return Result.fail(deploymentQuerySyncStoredStateCorrupt(
      operation,
      "storedAggregateInvalid",
      deploymentQuerySyncStoredStateIssue("rowDuplicate", rows.length),
    ));
  }
  if (!contract.durableInitializedHistory) {
    return Result.fail(deploymentQuerySyncStoredStateCorrupt(
      operation,
      "storedAggregateInvalid",
      deploymentQuerySyncStoredStateIssue(
        "authorityMismatch",
        "scopeBeforeInitializedHistory",
      ),
    ));
  }
  return decodeDeploymentQuerySyncScopeRowResult(rows[0]).pipe(
    Result.mapError(cause => deploymentQuerySyncStoredStateCorrupt(
      operation,
      "storedAggregateInvalid",
      deploymentQuerySyncStoredStateIssue("rowInvalid", cause),
    )),
    Result.flatMap(scope => authenticateDeploymentQuerySyncStoredScope(
      scope,
      binding,
      operation,
      enforcePortableBinding,
    )),
  );
}

function authenticateDeploymentQuerySyncStoredScope<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  scope: DeploymentQuerySyncStoredScopeState,
  binding: DeploymentQuerySyncBinding,
  operation: Operation,
  enforcePortableBinding: boolean,
): Result.Result<
  DeploymentQuerySyncStoredScopeState,
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>
> {
  if (scope.scopeUuid !== binding.scopeUuid) {
    return Result.fail(deploymentQuerySyncStoredStateCorrupt(
      operation,
      "namespaceBindingMismatch",
      deploymentQuerySyncStoredStateIssue("authorityMismatch", Object.freeze({
        field: "scopeUuid",
        expected: binding.scopeUuid,
        observed: scope.scopeUuid,
      })),
    ));
  }
  if (
    scope.storageGeneration !== binding.storageGeneration
    || scope.storageGenerationFence !== binding.storageGenerationFence
  ) {
    return Result.fail(deploymentQuerySyncStoredStateIncompatible(
      operation,
      deploymentQuerySyncStoredStateIssue("authorityMismatch", Object.freeze({
        expected: Object.freeze({
          storageGeneration: binding.storageGeneration,
          storageGenerationFence: binding.storageGenerationFence.toString(),
        }),
        observed: Object.freeze({
          storageGeneration: scope.storageGeneration,
          storageGenerationFence: scope.storageGenerationFence.toString(),
        }),
      })),
    ));
  }
  if (
    enforcePortableBinding
    && (
      scope.syncModelId !== binding.syncModelId
      || scope.epochUuid !== binding.epochUuid
    )
  ) {
    return Result.fail(deploymentQuerySyncStoredStateIncompatible(
      operation,
      deploymentQuerySyncStoredStateIssue("authorityMismatch", Object.freeze({
        expected: Object.freeze({
          syncModelId: binding.syncModelId,
          epochUuid: binding.epochUuid,
        }),
        observed: Object.freeze({
          syncModelId: scope.syncModelId,
          epochUuid: scope.epochUuid,
        }),
      })),
    ));
  }
  return Result.succeed(scope);
}

export function requireDeploymentQuerySyncScope<
  Operation extends DeploymentQuerySyncStateOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  contract: DeploymentQuerySyncContractState,
  operation: Operation,
  enforcePortableBinding: boolean,
): Result.Result<
  DeploymentQuerySyncStoredScopeState,
  | QuerySyncStoredStateCorruptError<Operation>
  | QuerySyncStoredStateIncompatibleError<Operation>
> {
  return readDeploymentQuerySyncScope(
    sql,
    binding,
    contract,
    operation,
    enforcePortableBinding,
  ).pipe(Result.flatMap(scope => scope === null
    ? Result.fail(deploymentQuerySyncStoredStateCorrupt(
      operation,
      "aggregateMissing",
      deploymentQuerySyncStoredStateIssue("rowMissing", "scope"),
    ))
    : Result.succeed(scope)));
}

export function storedDeploymentQuerySyncScopeFromFacts(
  binding: DeploymentQuerySyncBinding,
  facts: QuerySyncScopeFacts,
): DeploymentQuerySyncStoredScopeState {
  return Object.freeze({
    scopeUuid: binding.scopeUuid,
    epochUuid: binding.epochUuid,
    storageGeneration: binding.storageGeneration,
    storageGenerationFence: binding.storageGenerationFence,
    syncModelId: facts.cursor.syncModelId,
    facts,
  });
}

export function nextStoredDeploymentQuerySyncScope(
  current: DeploymentQuerySyncStoredScopeState,
  facts: QuerySyncScopeFacts,
): DeploymentQuerySyncStoredScopeState {
  return Object.freeze({
    scopeUuid: current.scopeUuid,
    epochUuid: current.epochUuid,
    storageGeneration: current.storageGeneration,
    storageGenerationFence: current.storageGenerationFence,
    syncModelId: facts.cursor.syncModelId,
    facts,
  });
}

export function assertDeploymentQuerySyncPlannedScopeAuthority(
  binding: DeploymentQuerySyncBinding,
  scope: QuerySyncScopeFacts,
  operation: DeploymentQuerySyncStateOperation,
): void {
  if (
    scope.cursor.namespaceId !== binding.namespaceId
    || scope.cursor.syncModelId !== binding.syncModelId
    || scope.cursor.sourceEpoch !== binding.sourceEpoch
  ) {
    throw new DeploymentQuerySyncAdapterInvariantDefect(operation);
  }
}

export function insertDeploymentQuerySyncScope(
  sql: DeploymentQuerySyncSqlStorage,
  state: DeploymentQuerySyncStoredScopeState,
): void {
  const row = encodeDeploymentQuerySyncScopeRow(state);
  const cursor = sql.exec<EncodedSingletonRow>(`INSERT INTO
    main.deployment_sync_scope_state (
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING singleton`, ...deploymentQuerySyncScopeValues(row));
  expectSingleDeploymentQuerySyncWrite(
    "initializeOrInspectNamespace",
    cursor,
  );
}

export function markDeploymentQuerySyncInitialized(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  const cursor = sql.exec<EncodedSingletonRow>(`UPDATE
    main.deployment_sync_contract_state
    SET durable_initialized_history = 1
    WHERE singleton = 1
      AND local_contract_generation = 4
      AND durable_initialized_history = 0
    RETURNING singleton`);
  expectSingleDeploymentQuerySyncWrite(
    "initializeOrInspectNamespace",
    cursor,
  );
}

export function replaceDeploymentQuerySyncScope(
  sql: DeploymentQuerySyncSqlStorage,
  operation: DeploymentQuerySyncStateOperation,
  expectedState: DeploymentQuerySyncStoredScopeState,
  nextState: DeploymentQuerySyncStoredScopeState,
): void {
  const expected = encodeDeploymentQuerySyncScopeRow(expectedState);
  const next = encodeDeploymentQuerySyncScopeRow(nextState);
  const cursor = sql.exec<EncodedSingletonRow>(`UPDATE
    main.deployment_sync_scope_state SET
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
    WHERE singleton IS ?
      AND scope_uuid IS ?
      AND epoch_uuid IS ?
      AND storage_generation IS ?
      AND storage_generation_fence IS ?
      AND sync_model_id IS ?
      AND applied_through_sequence IS ?
      AND evaluation_work_revision IS ?
      AND fairness_anchor IS ?
      AND query_count IS ?
      AND retained_identity_bytes IS ?
      AND dependency_memberships IS ?
      AND pending_publication_count IS ?
      AND in_flight_publication_count IS ?
      AND retained_publication_content_bytes IS ?
      AND settlement_envelope_bytes IS ?
      AND counted_canonical_bytes IS ?
    RETURNING singleton`,
  ...deploymentQuerySyncScopeValues(next).slice(1),
  ...deploymentQuerySyncScopeValues(expected));
  expectSingleDeploymentQuerySyncWrite(operation, cursor);
}

export function expectSingleDeploymentQuerySyncWrite(
  operation: DeploymentQuerySyncStateOperation,
  cursor: Readonly<{
    readonly rowsWritten: number;
    readonly toArray: () => readonly unknown[];
  }>,
  stage = "write",
): void {
  const rows = cursor.toArray();
  if (
    rows.length !== 1
    || !Number.isSafeInteger(cursor.rowsWritten)
    || cursor.rowsWritten < 1
  ) {
    throw new DeploymentQuerySyncAdapterInvariantDefect(operation, stage);
  }
}

export function expectDeploymentQuerySyncWrites(
  operation: DeploymentQuerySyncStateOperation,
  expectedRows: number,
  cursor: Readonly<{
    readonly rowsWritten: number;
    readonly toArray: () => readonly unknown[];
  }>,
  stage = "write",
): void {
  const rows = cursor.toArray();
  const physicalWriteCountIsCoherent = Number.isSafeInteger(
    cursor.rowsWritten,
  ) && (expectedRows === 0
    ? cursor.rowsWritten === 0
    : cursor.rowsWritten >= expectedRows);
  if (rows.length !== expectedRows || !physicalWriteCountIsCoherent) {
    throw new DeploymentQuerySyncAdapterInvariantDefect(operation, stage);
  }
}

export function deploymentQuerySyncSqlChunks<A>(
  values: readonly A[],
  maximum = MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS,
): readonly (readonly A[])[] {
  const result: A[][] = [];
  for (let offset = 0; offset < values.length; offset += maximum) {
    result.push(values.slice(offset, offset + maximum));
  }
  return result;
}

export function deploymentQuerySyncSqlPlaceholders(count: number): string {
  if (
    count <= 0
    || count > MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS
  ) {
    throw new Error("Invalid deployment query-sync SQL chunk size.");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function deploymentQuerySyncScopeValues(
  row: EncodedDeploymentQuerySyncScopeRow,
): SqlStorageValue[] {
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
