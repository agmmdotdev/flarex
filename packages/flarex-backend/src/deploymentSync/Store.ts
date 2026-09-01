import {
  compareCanonicalBase64Url,
  type AdmittedInvalidationBatch,
  type BeginQueryEvaluationRequest,
  type NamespaceCursor,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStoredStateCorruptError,
  type QuerySyncTransitionState,
} from "@flarex/query-sync/internal/state";
import {
  QuerySyncInitializationPolicyError,
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
import { Effect, Result } from "effect";

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
  decodeDeploymentQuerySyncQueryRowResult,
  encodeDeploymentQuerySyncAffectedActiveRow,
  encodeDeploymentQuerySyncQueryRow,
  type DeploymentQuerySyncStoredScopeState,
  type EncodedDeploymentQuerySyncAffectedActiveRow,
  type EncodedDeploymentQuerySyncQueryRow,
} from "./RowCodec";
import {
  decodeDeploymentQuerySyncDependencyRowResult,
} from "./DependencyRowCodec";
import { makeDeploymentQuerySyncEvaluationOperations } from "./EvaluationState";
import { makeDeploymentQuerySyncPublicationOperations } from "./PublicationState";
import {
  insertEmptyDeploymentQuerySyncPublicationState,
} from "./PublicationStorage";
import {
  MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS,
  assertDeploymentQuerySyncPlannedScopeAuthority,
  bindDeploymentQuerySyncStorage,
  deploymentQuerySyncSqlChunks,
  deploymentQuerySyncSqlPlaceholders,
  deploymentQuerySyncStoredStateCorrupt,
  deploymentQuerySyncStoredStateIncompatible,
  deploymentQuerySyncStoredStateIssue,
  expectSingleDeploymentQuerySyncWrite,
  insertDeploymentQuerySyncScope,
  mapDeploymentQuerySyncTransitionFactError,
  markDeploymentQuerySyncInitialized,
  nextStoredDeploymentQuerySyncScope,
  readDeploymentQuerySyncScope,
  replaceDeploymentQuerySyncScope,
  requireDeploymentQuerySyncScope,
  runDeploymentQuerySyncTransaction,
  storedDeploymentQuerySyncScopeFromFacts,
  type BoundDeploymentQuerySyncStorage,
} from "./StateStorage";
import {
  ensureDeploymentQuerySyncStorageReady,
  readDeploymentQuerySyncContractState,
  type DeploymentQuerySyncSqlStorage,
  type DeploymentQuerySyncStorage,
} from "./StorageContract";

const issue = deploymentQuerySyncStoredStateIssue;
const corrupt = deploymentQuerySyncStoredStateCorrupt;
const chunks = deploymentQuerySyncSqlChunks;
const placeholders = deploymentQuerySyncSqlPlaceholders;
const assertPlannedScopeAuthority =
  assertDeploymentQuerySyncPlannedScopeAuthority;
const nextStoredScope = nextStoredDeploymentQuerySyncScope;
const replaceScope = replaceDeploymentQuerySyncScope;
const expectSingleWrite = expectSingleDeploymentQuerySyncWrite;

type InitializeStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["initializeOrInspectNamespace"]
>>;
type BeginStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["beginQueryEvaluation"]
>>;
type ApplyStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["applyAdmittedBatchAndAdvance"]
>>;

export type DeploymentQuerySyncState = QuerySyncTransitionState;

export interface DeploymentQuerySyncStateInput {
  readonly binding: DeploymentQuerySyncBindingInput;
  readonly storage: DeploymentQuerySyncStorage;
  readonly freshInitializationCapability?:
    DeploymentQuerySyncFreshInitializationCapability;
}

export interface BoundDeploymentQuerySyncStateInput {
  readonly binding: DeploymentQuerySyncBinding;
  readonly storage: DeploymentQuerySyncStorage;
  readonly freshInitializationCapability?:
    DeploymentQuerySyncFreshInitializationCapability;
}

export const makeDeploymentQuerySyncState = Effect.fn(
  "DeploymentQuerySyncState.make",
)(function* (input: DeploymentQuerySyncStateInput) {
  const binding = yield* Effect.fromResult(
    captureDeploymentQuerySyncBinding(input.binding),
  );
  return yield* makeDeploymentQuerySyncStateFromBinding({
    binding,
    storage: input.storage,
    ...(input.freshInitializationCapability === undefined
      ? {}
      : {
        freshInitializationCapability: input.freshInitializationCapability,
      }),
  });
});

export const makeDeploymentQuerySyncStateFromBinding = Effect.fn(
  "DeploymentQuerySyncState.makeFromBinding",
)(function* (input: BoundDeploymentQuerySyncStateInput) {
  const binding = input.binding;
  const storage = bindDeploymentQuerySyncStorage(input.storage);
  const freshInitializationCapability = input.freshInitializationCapability;
  yield* Effect.suspend(() => Effect.fromResult(
    ensureDeploymentQuerySyncStorageReady(storage, binding),
  ));
  return makeBoundState(storage, freshInitializationCapability, binding);
});

function makeBoundState(
  storage: BoundDeploymentQuerySyncStorage,
  freshInitializationCapability:
    DeploymentQuerySyncFreshInitializationCapability | undefined,
  binding: DeploymentQuerySyncBinding,
): DeploymentQuerySyncState {
  const initializeOrInspectNamespace = Effect.fn(
    "DeploymentQuerySyncState.initializeOrInspectNamespace",
  )((cursor: NamespaceCursor) => initializeNamespace(
    storage,
    freshInitializationCapability,
    binding,
    cursor,
  ));
  const beginQueryEvaluation = Effect.fn(
    "DeploymentQuerySyncState.beginQueryEvaluation",
  )((request: BeginQueryEvaluationRequest) => runDeploymentQuerySyncTransaction(
    storage,
    sql => beginResult(sql, binding, request),
  ));
  const applyAdmittedBatchAndAdvance = Effect.fn(
    "DeploymentQuerySyncState.applyAdmittedBatchAndAdvance",
  )((batch: AdmittedInvalidationBatch) => runDeploymentQuerySyncTransaction(
    storage,
    sql => applyResult(sql, binding, batch),
  ));
  return Object.freeze({
    initializeOrInspectNamespace,
    beginQueryEvaluation,
    applyAdmittedBatchAndAdvance,
    ...makeDeploymentQuerySyncEvaluationOperations(storage, binding),
    ...makeDeploymentQuerySyncPublicationOperations(storage, binding),
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
  return runDeploymentQuerySyncTransaction(
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
      return yield* Result.fail(deploymentQuerySyncStoredStateIncompatible(
        "initializeOrInspectNamespace",
        deploymentQuerySyncStoredStateIssue("authorityMismatch", Object.freeze({
          expected: binding.bootstrapCursor,
          observed: bootstrapCursor,
        })),
      ));
    }
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "initializeOrInspectNamespace",
    );
    const scope = yield* readDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "initializeOrInspectNamespace",
      false,
    );
    if (scope === null && attempt._tag !== "reserved") {
      return yield* Result.fail(deploymentQuerySyncStoredStateIncompatible(
        "initializeOrInspectNamespace",
        deploymentQuerySyncStoredStateIssue("capabilityRequired", attempt._tag),
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
    assertDeploymentQuerySyncPlannedScopeAuthority(
      binding,
      plan.nextScope,
      "initializeOrInspectNamespace",
    );
    insertDeploymentQuerySyncScope(
      sql,
      storedDeploymentQuerySyncScopeFromFacts(binding, plan.nextScope),
    );
    insertEmptyDeploymentQuerySyncPublicationState(sql);
    markDeploymentQuerySyncInitialized(sql);
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
    const scope = yield* requireDeploymentQuerySyncScope(
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
    const scope = yield* requireDeploymentQuerySyncScope(
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

function mapInitializationPolicyError(
  error: QuerySyncInitializationPolicyError,
): InitializeStateError {
  if (error.reason === "bootstrapBindingMismatch") {
    return deploymentQuerySyncStoredStateIncompatible(
      error.operation,
      error,
    );
  }
  return deploymentQuerySyncStoredStateCorrupt(
    error.operation,
    error.reason,
    error,
  );
}

function mapBeginPlannerError(
  error: PlanBeginQueryEvaluationError,
): BeginStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "beginQueryEvaluation",
      error,
    )
    : error;
}

type ApplyResumePlannerError =
  | ResumeApplyAffectedTargetsError
  | ResumeApplyAffectedActiveFactsError;

function mapApplyPlannerError(
  error: ApplyResumePlannerError,
): ApplyStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "applyAdmittedBatchAndAdvance",
      error,
    )
    : error;
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
    for (const chunk of chunks(
      intent.dependencyKeys,
      MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS,
    )) {
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
  WHERE role NOT IN ('active', 'completion')
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
    for (const chunk of chunks(
      targets,
      MAX_DEPLOYMENT_QUERY_SYNC_SQL_DATA_KEYS,
    )) {
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
