import {
  compareCanonicalBase64Url,
  type AdmittedInvalidationBatch,
  type BeginQueryEvaluationRequest,
  type NamespaceCursor,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStoredStateCorruptError,
  QuerySyncStoredStateIncompatibleError,
  type QuerySyncTransitionState,
} from "@flarex/query-sync/internal/state";
import {
  QuerySyncInitializationPolicyError,
  QuerySyncTransitionFactError,
  planBeginQueryEvaluation,
  planInitializeOrInspectNamespace,
  resumeApplyAdmittedBatchActiveFacts,
  resumeApplyAdmittedBatchAffectedTargets,
  startApplyAdmittedBatchAndAdvance,
  type AffectedActiveQueryFacts,
  type AffectedActiveQueryTarget,
  type ApplyAdmittedBatchPlan,
  type ApplyAdmittedBatchReceipt,
  type BeginQueryEvaluationPlan,
  type BeginQueryEvaluationReceipt,
  type BeginQueryFacts,
  type InitializeNamespaceReceipt,
  type PlanBeginQueryEvaluationError,
  type QuerySyncScopeFacts,
  type ResumeApplyAffectedActiveFactsError,
  type ResumeApplyAffectedTargetsError,
} from "@flarex/query-sync/internal/transition-plan";
import { Data, Effect, Result } from "effect";

import {
  captureDeploymentQuerySyncBinding,
  consumeDeploymentQuerySyncFreshInitialization,
  releaseDeploymentQuerySyncFreshInitialization,
  reserveDeploymentQuerySyncFreshInitialization,
  type DeploymentQuerySyncBinding,
  type DeploymentQuerySyncBindingInput,
  type DeploymentQuerySyncFreshInitializationCapability,
  type DeploymentQuerySyncFreshReservationAttempt,
} from "./Binding";
import {
  decodeDeploymentQuerySyncAffectedActiveRowResult,
  decodeDeploymentQuerySyncAffectedTargetRowResult,
  decodeDeploymentQuerySyncDependencyRowResult,
  decodeDeploymentQuerySyncQueryRowResult,
  decodeDeploymentQuerySyncScopeRowResult,
  encodeDeploymentQuerySyncAffectedActiveRow,
  encodeDeploymentQuerySyncQueryRow,
  encodeDeploymentQuerySyncScopeRow,
  type DeploymentQuerySyncContractState,
  type DeploymentQuerySyncStoredScopeState,
  type EncodedDeploymentQuerySyncAffectedActiveRow,
  type EncodedDeploymentQuerySyncQueryRow,
  type EncodedDeploymentQuerySyncScopeRow,
} from "./RowCodec";
import {
  ensureDeploymentQuerySyncStorageReady,
  readDeploymentQuerySyncContractState,
  type DeploymentQuerySyncC1Operation,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "./StorageContract";

const MAX_SQL_DATA_KEYS = 96;

type InitializeStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["initializeOrInspectNamespace"]
>>;
type BeginStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["beginQueryEvaluation"]
>>;
type ApplyStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["applyAdmittedBatchAndAdvance"]
>>;

export type DeploymentQuerySyncStateC1 = Pick<
  QuerySyncTransitionState,
  | "initializeOrInspectNamespace"
  | "beginQueryEvaluation"
  | "applyAdmittedBatchAndAdvance"
>;

export interface DeploymentQuerySyncStateC1Input {
  readonly binding: DeploymentQuerySyncBindingInput;
  readonly storage: DeploymentQuerySyncStorage;
  readonly freshInitializationCapability?:
    DeploymentQuerySyncFreshInitializationCapability;
}

interface BoundDeploymentQuerySyncStorage {
  readonly sql: DeploymentQuerySyncSqlStorage;
  readonly transactionSync: <A>(closure: () => A) => A;
}

class DeploymentQuerySyncStoredStateIssue extends Data.TaggedError(
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

class DeploymentQuerySyncAdapterInvariantDefect extends Error {
  constructor(readonly operation: DeploymentQuerySyncC1Operation) {
    super(`Deployment query-sync ${operation} write invariant failed.`);
  }
}

interface EncodedSingletonRow {
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
}

export const makeDeploymentQuerySyncStateC1 = Effect.fn(
  "DeploymentQuerySyncStateC1.make",
)(function* (input: DeploymentQuerySyncStateC1Input) {
  const binding = yield* Effect.fromResult(
    captureDeploymentQuerySyncBinding(input.binding),
  );
  const storage = bindDeploymentQuerySyncStorage(input.storage);
  const freshInitializationCapability = input.freshInitializationCapability;
  yield* Effect.suspend(() => Effect.fromResult(
    ensureDeploymentQuerySyncStorageReady(storage, binding),
  ));
  return makeBoundState(storage, freshInitializationCapability, binding);
});

function bindDeploymentQuerySyncStorage(
  storage: DeploymentQuerySyncStorage,
): BoundDeploymentQuerySyncStorage {
  const sql = storage.sql;
  const transactionSync: DeploymentQuerySyncStorage["transactionSync"] =
    storage.transactionSync.bind(storage);
  return Object.freeze({ sql, transactionSync });
}

function makeBoundState(
  storage: BoundDeploymentQuerySyncStorage,
  freshInitializationCapability:
    DeploymentQuerySyncFreshInitializationCapability | undefined,
  binding: DeploymentQuerySyncBinding,
): DeploymentQuerySyncStateC1 {
  const initializeOrInspectNamespace = Effect.fn(
    "DeploymentQuerySyncStateC1.initializeOrInspectNamespace",
  )((cursor: NamespaceCursor) => initializeNamespace(
    storage,
    freshInitializationCapability,
    binding,
    cursor,
  ));
  const beginQueryEvaluation = Effect.fn(
    "DeploymentQuerySyncStateC1.beginQueryEvaluation",
  )((request: BeginQueryEvaluationRequest) => runTransaction(
    storage,
    sql => beginResult(sql, binding, request),
  ));
  const applyAdmittedBatchAndAdvance = Effect.fn(
    "DeploymentQuerySyncStateC1.applyAdmittedBatchAndAdvance",
  )((batch: AdmittedInvalidationBatch) => runTransaction(
    storage,
    sql => applyResult(sql, binding, batch),
  ));
  return Object.freeze({
    initializeOrInspectNamespace,
    beginQueryEvaluation,
    applyAdmittedBatchAndAdvance,
  });
}

function runTransaction<A, E>(
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
        ? Effect.fail(cause.failure)
        : Effect.die(cause);
    }
  });
}

function initializeNamespace(
  storage: BoundDeploymentQuerySyncStorage,
  freshInitializationCapability:
    DeploymentQuerySyncFreshInitializationCapability | undefined,
  binding: DeploymentQuerySyncBinding,
  bootstrapCursor: NamespaceCursor,
): Effect.Effect<InitializeNamespaceReceipt, InitializeStateError> {
  const attempt = reserveDeploymentQuerySyncFreshInitialization(
    freshInitializationCapability,
    binding,
  );
  const reservation = attempt._tag === "reserved" ? attempt.reservation : null;
  return runTransaction(
    storage,
    sql => initializeResult(sql, binding, bootstrapCursor, attempt),
    reservation === null
      ? undefined
      : () => releaseDeploymentQuerySyncFreshInitialization(reservation),
  ).pipe(Effect.map(receipt => {
    if (reservation !== null) {
      if (receipt._tag === "initialized") {
        consumeDeploymentQuerySyncFreshInitialization(reservation);
      } else {
        releaseDeploymentQuerySyncFreshInitialization(reservation);
      }
    }
    return receipt;
  }));
}

function initializeResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  bootstrapCursor: NamespaceCursor,
  attempt: DeploymentQuerySyncFreshReservationAttempt,
): Result.Result<InitializeNamespaceReceipt, InitializeStateError> {
  return Result.gen(function* () {
    if (!bootstrapCursorMatchesBinding(bootstrapCursor, binding)) {
      return yield* Result.fail(bootstrapIncompatible(
        "initializeOrInspectNamespace",
        issue("authorityMismatch", Object.freeze({
          expected: binding.bootstrapCursor,
          observed: bootstrapCursor,
        })),
      ));
    }
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "initializeOrInspectNamespace",
    );
    const scope = yield* readScope(
      sql,
      binding,
      contract,
      "initializeOrInspectNamespace",
      false,
    );
    if (scope === null && attempt._tag !== "reserved") {
      return yield* Result.fail(bootstrapIncompatible(
        "initializeOrInspectNamespace",
        issue("capabilityRequired", attempt._tag),
      ));
    }
    const plan = yield* planInitializeOrInspectNamespace({
      binding: {
        namespaceId: binding.namespaceId,
        syncModelId: binding.syncModelId,
        sourceEpoch: binding.sourceEpoch,
      },
      bootstrapCursor: binding.bootstrapCursor,
      presence: scope === null
        ? Object.freeze({ _tag: "authorizedFreshAbsence" })
        : Object.freeze({ _tag: "present", scope: scope.facts }),
    }).pipe(Result.mapError(mapInitializationPolicyError));
    if (plan._tag === "noWrite") return plan.receipt;
    assertPlannedScopeAuthority(
      binding,
      plan.nextScope,
      "initializeOrInspectNamespace",
    );
    insertScope(sql, storedFromFacts(binding, plan.nextScope));
    markInitialized(sql);
    return plan.receipt;
  });
}

function bootstrapCursorMatchesBinding(
  cursor: NamespaceCursor,
  binding: DeploymentQuerySyncBinding,
): boolean {
  return cursor.namespaceId === binding.bootstrapCursor.namespaceId
    && cursor.syncModelId === binding.bootstrapCursor.syncModelId
    && cursor.sourceEpoch === binding.bootstrapCursor.sourceEpoch
    && cursor.appliedThroughSequence
      === binding.bootstrapCursor.appliedThroughSequence;
}

function beginResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  request: BeginQueryEvaluationRequest,
): Result.Result<BeginQueryEvaluationReceipt, BeginStateError> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "beginQueryEvaluation",
    );
    const scope = yield* requireScope(
      sql,
      binding,
      contract,
      "beginQueryEvaluation",
      true,
    );
    const query = yield* readBeginQuery(
      sql,
      scope.facts,
      request.target.descriptor.queryKey,
    );
    const plan = yield* planBeginQueryEvaluation({
      scope: scope.facts,
      query,
      request,
    }).pipe(Result.mapError(mapBeginPlannerError));
    if (plan._tag === "noWrite") return plan.receipt;
    writeBeginPlan(sql, binding, scope, query, plan);
    return plan.receipt;
  });
}

function applyResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  batch: AdmittedInvalidationBatch,
): Result.Result<ApplyAdmittedBatchReceipt, ApplyStateError> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "applyAdmittedBatchAndAdvance",
    );
    const scope = yield* requireScope(
      sql,
      binding,
      contract,
      "applyAdmittedBatchAndAdvance",
      true,
    );
    const first = yield* startApplyAdmittedBatchAndAdvance({
      scope: scope.facts,
      batch,
    });
    if (first._tag === "planned") {
      writeApplyPlan(sql, binding, scope, first.plan);
      return first.plan.receipt;
    }
    const targets = yield* readAffectedTargets(
      sql,
      scope.facts,
      first.intent,
    );
    const second = yield* resumeApplyAdmittedBatchAffectedTargets(
      first.resume,
      targets,
    ).pipe(Result.mapError(mapApplyPlannerError));
    if (second._tag === "planned") {
      writeApplyPlan(sql, binding, scope, second.plan);
      return second.plan.receipt;
    }
    const active = yield* readAffectedActiveFacts(
      sql,
      scope.facts,
      second.intent.targets,
    );
    const plan = yield* resumeApplyAdmittedBatchActiveFacts(
      second.resume,
      active,
    ).pipe(Result.mapError(mapApplyPlannerError));
    writeApplyPlan(sql, binding, scope, plan);
    return plan.receipt;
  });
}

function issue(
  reason: DeploymentQuerySyncStoredStateIssue["reason"],
  evidence: unknown,
): DeploymentQuerySyncStoredStateIssue {
  return new DeploymentQuerySyncStoredStateIssue({ reason, evidence });
}

function corrupt<Operation extends DeploymentQuerySyncC1Operation>(
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

function bootstrapIncompatible<
  Operation extends DeploymentQuerySyncC1Operation,
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

function mapInitializationPolicyError(
  error: QuerySyncInitializationPolicyError,
): InitializeStateError {
  if (error.reason === "bootstrapBindingMismatch") {
    return bootstrapIncompatible(error.operation, error);
  }
  return corrupt(error.operation, error.reason, error);
}

function transitionFactCorruption<
  Operation extends
    | "beginQueryEvaluation"
    | "applyAdmittedBatchAndAdvance",
>(
  operation: Operation,
  error: QuerySyncTransitionFactError,
): QuerySyncStoredStateCorruptError<Operation> {
  return corrupt(
    operation,
    "storedAggregateInvalid",
    issue("transitionFactsRejected", error),
  );
}

function mapBeginPlannerError(
  error: PlanBeginQueryEvaluationError,
): BeginStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? transitionFactCorruption("beginQueryEvaluation", error)
    : error;
}

type ApplyResumePlannerError =
  | ResumeApplyAffectedTargetsError
  | ResumeApplyAffectedActiveFactsError;

function mapApplyPlannerError(
  error: ApplyResumePlannerError,
): ApplyStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? transitionFactCorruption("applyAdmittedBatchAndAdvance", error)
    : error;
}

function readScope<Operation extends DeploymentQuerySyncC1Operation>(
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
      ? Result.fail(corrupt(
        operation,
        "aggregateMissing",
        issue("rowMissing", "scopeAfterInitializedHistory"),
      ))
      : Result.succeed(null);
  }
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      issue("rowDuplicate", rows.length),
    ));
  }
  if (!contract.durableInitializedHistory) {
    return Result.fail(corrupt(
      operation,
      "storedAggregateInvalid",
      issue("authorityMismatch", "scopeBeforeInitializedHistory"),
    ));
  }
  return decodeDeploymentQuerySyncScopeRowResult(rows[0]).pipe(
    Result.mapError(cause => corrupt(
      operation,
      "storedAggregateInvalid",
      issue("rowInvalid", cause),
    )),
    Result.flatMap(scope => authenticateStoredScope(
      scope,
      binding,
      operation,
      enforcePortableBinding,
    )),
  );
}

function authenticateStoredScope<
  Operation extends DeploymentQuerySyncC1Operation,
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
    return Result.fail(corrupt(
      operation,
      "namespaceBindingMismatch",
      issue("authorityMismatch", Object.freeze({
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
    return Result.fail(bootstrapIncompatible(
      operation,
      issue("authorityMismatch", Object.freeze({
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
    return Result.fail(bootstrapIncompatible(
      operation,
      issue("authorityMismatch", Object.freeze({
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

function requireScope<Operation extends DeploymentQuerySyncC1Operation>(
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
  return readScope(
    sql,
    binding,
    contract,
    operation,
    enforcePortableBinding,
  ).pipe(Result.flatMap(scope => scope === null
    ? Result.fail(corrupt(
      operation,
      "aggregateMissing",
      issue("rowMissing", "scope"),
    ))
    : Result.succeed(scope)));
}

function readBeginQuery(
  sql: DeploymentQuerySyncSqlStorage,
  scope: QuerySyncScopeFacts,
  queryKey: BeginQueryEvaluationRequest["target"]["descriptor"]["queryKey"],
): Result.Result<
  BeginQueryFacts | null,
  QuerySyncStoredStateCorruptError<"beginQueryEvaluation">
> {
  const rows = sql.exec<EncodedDeploymentQuerySyncQueryRow & {
    readonly [key: string]: SqlStorageValue;
  }>(`SELECT
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
  FROM main.deployment_sync_queries
  WHERE query_key = ?
  ORDER BY query_key
  LIMIT 2`, queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(corrupt(
      "beginQueryEvaluation",
      "storedAggregateInvalid",
      issue("rowDuplicate", rows.length),
    ));
  }
  return decodeDeploymentQuerySyncQueryRowResult(rows[0], scope).pipe(
    Result.mapError(cause => corrupt(
      "beginQueryEvaluation",
      "storedAggregateInvalid",
      issue("rowInvalid", cause),
    )),
    Result.flatMap(query => scope.metrics.queryCount === 0
      ? Result.fail(corrupt(
        "beginQueryEvaluation",
        "storedAggregateInvalid",
        issue("scopeCounterMismatch", Object.freeze({
          counter: "queryCount",
          expected: "positiveWhenQueryRowPresent",
          observed: scope.metrics.queryCount,
          queryKey: query.descriptor.queryKey,
        })),
      ))
      : Result.succeed(query)),
  );
}

interface EncodedAffectedTargetRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
  readonly active_generation: string;
}

interface EncodedInvalidDependencyRoleRow {
  readonly [key: string]: SqlStorageValue;
  readonly role: string;
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}

function readAffectedTargets(
  sql: DeploymentQuerySyncSqlStorage,
  scope: QuerySyncScopeFacts,
  intent: Readonly<{
    readonly dependencyKeys: readonly string[];
    readonly maximumDistinctTargets: number;
  }>,
): Result.Result<
  Readonly<
    | { readonly _tag: "complete"; readonly targets: readonly AffectedActiveQueryTarget[] }
    | { readonly _tag: "limitExceeded"; readonly observed: number }
  >,
  QuerySyncStoredStateCorruptError<"applyAdmittedBatchAndAdvance">
> {
  return Result.gen(function* () {
    yield* rejectInvalidDependencyRole(sql);
    const byQueryKey = new Map<string, AffectedActiveQueryTarget>();
    for (const chunk of chunks(intent.dependencyKeys, MAX_SQL_DATA_KEYS)) {
      const rows = sql.exec<EncodedAffectedTargetRow>(`SELECT
        query_key,
        generation AS active_generation
      FROM main.deployment_sync_query_dependencies
      WHERE role = 'active'
        AND dependency_key IN (${placeholders(chunk.length)})
      GROUP BY query_key, generation
      ORDER BY query_key COLLATE BINARY, generation
      LIMIT ${intent.maximumDistinctTargets}`,
      ...chunk).toArray();
      for (const row of rows) {
        const target = yield* decodeDeploymentQuerySyncAffectedTargetRowResult(
          row,
        ).pipe(Result.mapError(cause => corrupt(
          "applyAdmittedBatchAndAdvance",
          "storedAggregateInvalid",
          issue("rowInvalid", cause),
        )));
        const previous = byQueryKey.get(target.queryKey);
        if (
          previous !== undefined
          && previous.activeGeneration !== target.activeGeneration
        ) {
          return yield* Result.fail(corrupt(
            "applyAdmittedBatchAndAdvance",
            "storedAggregateInvalid",
            issue("rowInvalid", Object.freeze({ previous, target })),
          ));
        }
        byQueryKey.set(target.queryKey, target);
        if (byQueryKey.size >= intent.maximumDistinctTargets) {
          return Object.freeze({
            _tag: "limitExceeded",
            observed: intent.maximumDistinctTargets,
          });
        }
      }
    }
    const targets = [...byQueryKey.values()].toSorted((left, right) =>
      compareCanonicalBase64Url(left.queryKey, right.queryKey)
    );
    if (targets.length > 0) {
      if (targets.length > scope.metrics.dependencyMemberships) {
        return yield* Result.fail(corrupt(
          "applyAdmittedBatchAndAdvance",
          "storedAggregateInvalid",
          issue("scopeCounterMismatch", Object.freeze({
            counter: "dependencyMemberships",
            expectedAtLeast: targets.length,
            observed: scope.metrics.dependencyMemberships,
            distinctAffectedTargets: targets.length,
          })),
        ));
      }
      if (targets.length > scope.metrics.queryCount) {
        return yield* Result.fail(corrupt(
          "applyAdmittedBatchAndAdvance",
          "storedAggregateInvalid",
          issue("scopeCounterMismatch", Object.freeze({
            counter: "queryCount",
            expectedAtLeast: targets.length,
            observed: scope.metrics.queryCount,
            distinctAffectedTargets: targets.length,
          })),
        ));
      }
    }
    return Object.freeze({
      _tag: "complete",
      targets: Object.freeze(targets),
    });
  });
}

function rejectInvalidDependencyRole(
  sql: DeploymentQuerySyncSqlStorage,
): Result.Result<
  void,
  QuerySyncStoredStateCorruptError<"applyAdmittedBatchAndAdvance">
> {
  const rows = sql.exec<EncodedInvalidDependencyRoleRow>(`SELECT
    role,
    query_key,
    generation,
    dependency_key
  FROM main.deployment_sync_query_dependencies
    INDEXED BY deployment_sync_query_dependencies_reverse
  WHERE role < 'active'
  UNION ALL
  SELECT
    role,
    query_key,
    generation,
    dependency_key
  FROM main.deployment_sync_query_dependencies
    INDEXED BY deployment_sync_query_dependencies_reverse
  WHERE role > 'active'
  LIMIT 1`).toArray();
  if (rows.length === 0) return Result.succeed(undefined);
  return decodeDeploymentQuerySyncDependencyRowResult(rows[0]).pipe(
    Result.match({
      onFailure: cause => Result.fail(corrupt(
        "applyAdmittedBatchAndAdvance",
        "storedAggregateInvalid",
        issue("rowInvalid", cause),
      )),
      onSuccess: decoded => Result.fail(corrupt(
        "applyAdmittedBatchAndAdvance",
        "storedAggregateInvalid",
        issue("rowInvalid", Object.freeze({
          reason: "dependencyRolePredicateContradicted",
          decoded,
        })),
      )),
    }),
  );
}

function readAffectedActiveFacts(
  sql: DeploymentQuerySyncSqlStorage,
  scope: QuerySyncScopeFacts,
  targets: readonly AffectedActiveQueryTarget[],
): Result.Result<
  readonly AffectedActiveQueryFacts[],
  QuerySyncStoredStateCorruptError<"applyAdmittedBatchAndAdvance">
> {
  return Result.gen(function* () {
    const byQueryKey = new Map<string, AffectedActiveQueryFacts>();
    for (const chunk of chunks(targets, MAX_SQL_DATA_KEYS)) {
      const rows = sql.exec<EncodedDeploymentQuerySyncAffectedActiveRow & {
        readonly [key: string]: SqlStorageValue;
      }>(`SELECT
        query_key,
        active_generation,
        active_evaluation_snapshot_sequence,
        active_fresh_through_sequence,
        active_dirty_through_sequence,
        active_result_digest,
        active_authority_witness
      FROM main.deployment_sync_queries
      WHERE query_key IN (${placeholders(chunk.length)})
      ORDER BY query_key COLLATE BINARY`,
      ...chunk.map(target => target.queryKey)).toArray();
      for (const row of rows) {
        const facts = yield* decodeDeploymentQuerySyncAffectedActiveRowResult(
          row,
          scope,
        ).pipe(Result.mapError(cause => corrupt(
          "applyAdmittedBatchAndAdvance",
          "storedAggregateInvalid",
          issue("rowInvalid", cause),
        )));
        if (byQueryKey.has(facts.queryKey)) {
          return yield* Result.fail(corrupt(
            "applyAdmittedBatchAndAdvance",
            "storedAggregateInvalid",
            issue("rowDuplicate", facts.queryKey),
          ));
        }
        byQueryKey.set(facts.queryKey, facts);
      }
    }
    return Object.freeze(targets.flatMap(target => {
      const facts = byQueryKey.get(target.queryKey);
      return facts === undefined ? [] : [facts];
    }));
  });
}

function chunks<A>(
  values: readonly A[],
  maximum: number,
): readonly (readonly A[])[] {
  const result: A[][] = [];
  for (let offset = 0; offset < values.length; offset += maximum) {
    result.push(values.slice(offset, offset + maximum));
  }
  return result;
}

function placeholders(count: number): string {
  if (count <= 0 || count > MAX_SQL_DATA_KEYS) {
    throw new Error("Invalid deployment query-sync SQL chunk size.");
  }
  return Array.from({ length: count }, () => "?").join(", ");
}

function storedFromFacts(
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

function nextStoredScope(
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

function insertScope(
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
    RETURNING singleton`, ...scopeValues(row));
  expectSingleWrite("initializeOrInspectNamespace", cursor);
}

function markInitialized(sql: DeploymentQuerySyncSqlStorage): void {
  const cursor = sql.exec<EncodedSingletonRow>(`UPDATE
    main.deployment_sync_contract_state
    SET durable_initialized_history = 1
    WHERE singleton = 1
      AND local_contract_generation = 2
      AND durable_initialized_history = 0
    RETURNING singleton`);
  expectSingleWrite("initializeOrInspectNamespace", cursor);
}

function writeBeginPlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  currentScope: DeploymentQuerySyncStoredScopeState,
  currentQuery: BeginQueryFacts | null,
  plan: BeginQueryEvaluationPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertPlannedScopeAuthority(binding, plan.nextScope, "beginQueryEvaluation");
  const nextQuery: BeginQueryFacts = Object.freeze({
    descriptor: plan.change.descriptor,
    active: currentQuery?.active ?? null,
    provisional: plan.change.provisional,
  });
  if (plan.expected.query._tag === "absent") {
    insertQuery(sql, nextQuery);
  } else {
    replaceQuery(sql, plan.expected.query.facts, nextQuery);
  }
  replaceScope(
    sql,
    "beginQueryEvaluation",
    currentScope,
    nextStoredScope(currentScope, plan.nextScope),
  );
}

function insertQuery(
  sql: DeploymentQuerySyncSqlStorage,
  facts: BeginQueryFacts,
): void {
  const row = encodeDeploymentQuerySyncQueryRow(facts);
  const cursor = sql.exec<EncodedDeploymentQuerySyncQueryRow & {
    readonly [key: string]: SqlStorageValue;
  }>(`INSERT INTO main.deployment_sync_queries (
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
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  RETURNING query_key`, ...queryValues(row));
  expectSingleWrite("beginQueryEvaluation", cursor);
}

function replaceQuery(
  sql: DeploymentQuerySyncSqlStorage,
  expectedFacts: BeginQueryFacts,
  nextFacts: BeginQueryFacts,
): void {
  const expected = encodeDeploymentQuerySyncQueryRow(expectedFacts);
  const next = encodeDeploymentQuerySyncQueryRow(nextFacts);
  const cursor = sql.exec<EncodedDeploymentQuerySyncQueryRow & {
    readonly [key: string]: SqlStorageValue;
  }>(`UPDATE main.deployment_sync_queries SET
    query_identity = ?,
    active_generation = ?,
    active_evaluation_snapshot_sequence = ?,
    active_fresh_through_sequence = ?,
    active_dirty_through_sequence = ?,
    active_result_digest = ?,
    active_authority_witness = ?,
    provisional_generation = ?,
    provisional_expected_active_generation = ?,
    provisional_registration_sequence = ?,
    provisional_requested_dirty_through_sequence = ?,
    provisional_disposition = ?
  WHERE query_key IS ?
    AND query_identity IS ?
    AND active_generation IS ?
    AND active_evaluation_snapshot_sequence IS ?
    AND active_fresh_through_sequence IS ?
    AND active_dirty_through_sequence IS ?
    AND active_result_digest IS ?
    AND active_authority_witness IS ?
    AND provisional_generation IS ?
    AND provisional_expected_active_generation IS ?
    AND provisional_registration_sequence IS ?
    AND provisional_requested_dirty_through_sequence IS ?
    AND provisional_disposition IS ?
  RETURNING query_key`,
  ...queryValues(next).slice(1),
  ...queryValues(expected));
  expectSingleWrite("beginQueryEvaluation", cursor);
}

function writeApplyPlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  currentScope: DeploymentQuerySyncStoredScopeState,
  plan: ApplyAdmittedBatchPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "applyAdmittedBatchAndAdvance",
  );
  for (const change of plan.change.active) {
    replaceAffectedActive(sql, change.expected, change.next);
  }
  replaceScope(
    sql,
    "applyAdmittedBatchAndAdvance",
    currentScope,
    nextStoredScope(currentScope, plan.nextScope),
  );
}

function assertPlannedScopeAuthority(
  binding: DeploymentQuerySyncBinding,
  scope: QuerySyncScopeFacts,
  operation: DeploymentQuerySyncC1Operation,
): void {
  if (
    scope.cursor.namespaceId !== binding.namespaceId
    || scope.cursor.syncModelId !== binding.syncModelId
    || scope.cursor.sourceEpoch !== binding.sourceEpoch
  ) {
    throw new DeploymentQuerySyncAdapterInvariantDefect(operation);
  }
}

function replaceAffectedActive(
  sql: DeploymentQuerySyncSqlStorage,
  expectedFacts: AffectedActiveQueryFacts,
  nextFacts: AffectedActiveQueryFacts,
): void {
  const expected = encodeDeploymentQuerySyncAffectedActiveRow(expectedFacts);
  const next = encodeDeploymentQuerySyncAffectedActiveRow(nextFacts);
  const cursor = sql.exec<EncodedDeploymentQuerySyncAffectedActiveRow & {
    readonly [key: string]: SqlStorageValue;
  }>(`UPDATE main.deployment_sync_queries
  SET active_dirty_through_sequence = ?
  WHERE query_key IS ?
    AND active_generation IS ?
    AND active_evaluation_snapshot_sequence IS ?
    AND active_fresh_through_sequence IS ?
    AND active_dirty_through_sequence IS ?
    AND active_result_digest IS ?
    AND active_authority_witness IS ?
  RETURNING query_key`,
  next.active_dirty_through_sequence,
  ...affectedActiveValues(expected));
  expectSingleWrite("applyAdmittedBatchAndAdvance", cursor);
}

function replaceScope(
  sql: DeploymentQuerySyncSqlStorage,
  operation:
    | "beginQueryEvaluation"
    | "applyAdmittedBatchAndAdvance",
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
  ...scopeValues(next).slice(1),
  ...scopeValues(expected));
  expectSingleWrite(operation, cursor);
}

function expectSingleWrite(
  operation: DeploymentQuerySyncC1Operation,
  cursor: Readonly<{
    readonly rowsWritten: number;
    readonly toArray: () => readonly unknown[];
  }>,
): void {
  const rows = cursor.toArray();
  if (cursor.rowsWritten !== 1 || rows.length !== 1) {
    throw new DeploymentQuerySyncAdapterInvariantDefect(operation);
  }
}

function scopeValues(
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

function queryValues(
  row: EncodedDeploymentQuerySyncQueryRow,
): SqlStorageValue[] {
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

function affectedActiveValues(
  row: EncodedDeploymentQuerySyncAffectedActiveRow,
): SqlStorageValue[] {
  return [
    row.query_key,
    row.active_generation,
    row.active_evaluation_snapshot_sequence,
    row.active_fresh_through_sequence,
    row.active_dirty_through_sequence,
    row.active_result_digest,
    row.active_authority_witness,
  ];
}
