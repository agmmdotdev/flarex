import {
  canonicalBase64UrlDecodedLength,
  compareCanonicalBase64Url,
  MAX_QUERY_DEPENDENCY_BYTES,
  type EvaluationAttemptOutcome,
  type EvaluationWorkScanRequest,
  type GenerationRefreshEvidence,
  type PendingQueryPublication,
  type QueryEvaluationAttempt,
  type QueryEvaluationEvidence,
  type QueryPublicationArtifact,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStoredStateCorruptError,
  type QuerySyncTransitionState,
} from "@flarex/query-sync/internal/state";
import {
  authenticateRecordEvaluationAttemptOutcomeAttempt,
  resumeClaimEvaluationWorkScan,
  resumeClaimEvaluationWorkSelectedQuery,
  resumeCompleteQueryEvaluationMaterial,
  resumeCompleteQueryEvaluationReplay,
  startClaimEvaluationWork,
  startCompleteQueryEvaluation,
  planRecordEvaluationAttemptOutcome,
  type ClaimEvaluationWorkPlan,
  type CompleteQueryEvaluationPlan,
  type CompleteQueryMaterialFactsRead,
  type CompleteQueryReplayFactsRead,
  type CompleteQueryScalarFacts,
  type CompletionPublicationLifecycleFacts,
  type EvaluationAttemptOutcomeQueryFacts,
  type EvaluationSelectedQueryFacts,
  type EvaluationWorkScanFacts,
  type EvaluationWorkScanFactsRead,
  type PlanRecordEvaluationAttemptOutcomeError,
  type QueryDependencyFacts,
  type ReadEvaluationWorkScanFactsIntent,
  type RecordEvaluationAttemptOutcomePlan,
  type ResumeClaimEvaluationWorkScanError,
  type ResumeClaimEvaluationWorkSelectedQueryError,
  type ResumeCompleteQueryMaterialError,
  type ResumeCompleteQueryReplayError,
  type StartClaimEvaluationWorkError,
  type StartCompleteQueryEvaluationError,
} from "@flarex/query-sync/internal/transition-plan";
import { Effect, Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  decodeDeploymentQuerySyncDependencyRowResult,
  encodeDeploymentQuerySyncDependencyRow,
  type DeploymentQuerySyncDependency,
  type DeploymentQuerySyncDependencyRole,
} from "./DependencyRowCodec";
import {
  decodeDeploymentQuerySyncCompleteQueryRowResult,
  decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult,
  decodeDeploymentQuerySyncEvaluationWorkScanRowResult,
  encodeDeploymentQuerySyncCompleteQueryRow,
  DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS,
} from "./EvaluationRowCodec";
import {
  decodeDeploymentQuerySyncPendingPublicationRowResult,
  encodeDeploymentQuerySyncPendingPublicationRow,
} from "./PublicationRowCodec";
import {
  readDeploymentQuerySyncCompletionPublicationLifecycle,
  readDeploymentQuerySyncRetainedPublication,
} from "./PublicationStorage";
import {
  decodeDeploymentQuerySyncQueryRowResult,
  encodeDeploymentQuerySyncQueryRow,
  type DeploymentQuerySyncStoredScopeState,
  type EncodedDeploymentQuerySyncQueryRow,
} from "./RowCodec";
import {
  assertDeploymentQuerySyncPlannedScopeAuthority,
  deploymentQuerySyncStoredStateCorrupt,
  deploymentQuerySyncStoredStateIssue,
  expectDeploymentQuerySyncWrites,
  expectSingleDeploymentQuerySyncWrite,
  mapDeploymentQuerySyncTransitionFactError,
  nextStoredDeploymentQuerySyncScope,
  replaceDeploymentQuerySyncScope,
  requireDeploymentQuerySyncScope,
  runDeploymentQuerySyncTransaction,
  type BoundDeploymentQuerySyncStorage,
} from "./StateStorage";
import {
  readDeploymentQuerySyncContractState,
  type DeploymentQuerySyncSqlStorage,
} from "./StorageContract";

type EvaluationOperations = Pick<
  QuerySyncTransitionState,
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
>;

type CompleteStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["completeQueryEvaluation"]
>>;
type ClaimStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["claimEvaluationWork"]
>>;
type OutcomeStateError = Effect.Error<ReturnType<
  QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
>>;

type CompletePlannerError =
  | StartCompleteQueryEvaluationError
  | ResumeCompleteQueryReplayError
  | ResumeCompleteQueryMaterialError;
type ClaimPlannerError =
  | StartClaimEvaluationWorkError
  | ResumeClaimEvaluationWorkScanError
  | ResumeClaimEvaluationWorkSelectedQueryError;

const SCAN_QUERY_COLUMNS = `
  query_key,
  active_generation,
  active_dirty_through_sequence,
  provisional_generation,
  provisional_disposition`;

interface EncodedQueryKeyRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
}

interface EncodedEvaluationWorkScanRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
  readonly active_generation: string | null;
  readonly active_dirty_through_sequence: string | null;
  readonly provisional_generation: string | null;
  readonly provisional_disposition: string | null;
}

interface EncodedDependencyRow {
  readonly [key: string]: SqlStorageValue;
  readonly role: string;
  readonly query_key: string;
  readonly generation: string;
  readonly dependency_key: string;
}

interface EncodedPendingPublicationRow {
  readonly [key: string]: SqlStorageValue;
  readonly query_key: string;
  readonly generation: string;
  readonly query_identity: string;
  readonly completed_through_sequence: string;
  readonly result_digest: string;
  readonly content: string;
}

export function makeDeploymentQuerySyncEvaluationOperations(
  storage: BoundDeploymentQuerySyncStorage,
  binding: DeploymentQuerySyncBinding,
): EvaluationOperations {
  const completeQueryEvaluation = Effect.fn(
    "DeploymentQuerySyncState.completeQueryEvaluation",
  )((
    attempt: QueryEvaluationAttempt,
    evaluation: QueryEvaluationEvidence,
    refresh: GenerationRefreshEvidence,
    publication: QueryPublicationArtifact,
  ) => runDeploymentQuerySyncTransaction(
    storage,
    sql => completeQueryEvaluationResult(
      sql,
      binding,
      attempt,
      evaluation,
      refresh,
      publication,
    ),
  ));

  const claimEvaluationWork = Effect.fn(
    "DeploymentQuerySyncState.claimEvaluationWork",
  )((request: EvaluationWorkScanRequest) => runDeploymentQuerySyncTransaction(
    storage,
    sql => claimEvaluationWorkResult(sql, binding, request),
  ));

  const recordEvaluationAttemptOutcome = Effect.fn(
    "DeploymentQuerySyncState.recordEvaluationAttemptOutcome",
  )((attempt: QueryEvaluationAttempt, outcome: EvaluationAttemptOutcome) =>
    runDeploymentQuerySyncTransaction(
      storage,
      sql => recordEvaluationAttemptOutcomeResult(
        sql,
        binding,
        attempt,
        outcome,
      ),
    )
  );

  return Object.freeze({
    completeQueryEvaluation,
    claimEvaluationWork,
    recordEvaluationAttemptOutcome,
  });
}

function completeQueryEvaluationResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  publication: QueryPublicationArtifact,
): Result.Result<
  Effect.Success<ReturnType<QuerySyncTransitionState["completeQueryEvaluation"]>>,
  CompleteStateError
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "completeQueryEvaluation",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "completeQueryEvaluation",
      true,
    );
    const query = yield* readCompleteQuery(
      sql,
      scope,
      attempt.descriptor.queryKey,
      "completeQueryEvaluation",
    );
    const start = yield* startCompleteQueryEvaluation({
      scope: scope.facts,
      query,
      attempt,
      evaluation,
      refresh,
      publication,
    }).pipe(Result.mapError(mapCompletePlannerError));

    if (start._tag === "planned") {
      return start.plan.receipt;
    }
    if (start.stage === "replay") {
      const completionDependencies = yield* readDeploymentQuerySyncDependencies(
        sql,
        "completeQueryEvaluation",
        "completion",
        start.intent.queryKey,
        start.intent.completionGeneration,
        start.intent.maximumCompletionDependencyMembers,
      );
      if (completionDependencies === null) {
        return yield* Result.fail(storedCorrupt(
          "completeQueryEvaluation",
          "completionDependenciesMissing",
        ));
      }
      const retainedPublication =
        start.intent.retainedPublicationIdentity === null
          ? null
          : query === null
            ? yield* Result.fail(storedCorrupt(
              "completeQueryEvaluation",
              "retainedPublicationOwnerMissing",
            ))
            : yield* readDeploymentQuerySyncRetainedPublication(
              sql,
              scope,
              query,
              start.intent.retainedPublicationIdentity,
            );
      const read: CompleteQueryReplayFactsRead = Object.freeze({
        queryKey: start.intent.queryKey,
        completionDependencies,
        retainedPublication,
      });
      const plan = yield* resumeCompleteQueryEvaluationReplay(
        start.resume,
        read,
      ).pipe(Result.mapError(mapCompletePlannerError));
      return plan.receipt;
    }

    const activeDependencies = yield* readDeploymentQuerySyncDependencies(
      sql,
      "completeQueryEvaluation",
      "active",
      start.intent.queryKey,
      start.intent.activeGeneration,
      start.intent.maximumActiveDependencyMembers,
    );
    const completionDependencies = yield* readDeploymentQuerySyncDependencies(
      sql,
      "completeQueryEvaluation",
      "completion",
      start.intent.queryKey,
      start.intent.completionGeneration,
      start.intent.maximumCompletionDependencyMembers,
    );
    const pendingPublication = yield* readPendingPublication(
      sql,
      scope,
      query,
      start.intent.pendingPublicationQueryKey,
      "completeQueryEvaluation",
    );
    const lifecycle: CompletionPublicationLifecycleFacts = yield*
      readDeploymentQuerySyncCompletionPublicationLifecycle(
        sql,
        scope,
        start.intent.publicationLifecycleQueryKey,
      );
    const read: CompleteQueryMaterialFactsRead = Object.freeze({
      queryKey: start.intent.queryKey,
      activeDependencies,
      completionDependencies,
      pendingPublication,
      lifecycle,
    });
    const plan = yield* resumeCompleteQueryEvaluationMaterial(
      start.resume,
      read,
    ).pipe(Result.mapError(mapCompletePlannerError));
    writeCompletePlan(sql, binding, scope, plan);
    return plan.receipt;
  });
}

function claimEvaluationWorkResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  request: EvaluationWorkScanRequest,
): Result.Result<
  Effect.Success<ReturnType<QuerySyncTransitionState["claimEvaluationWork"]>>,
  ClaimStateError
> {
  return Result.gen(function* () {
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "claimEvaluationWork",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "claimEvaluationWork",
      true,
    );
    const start = yield* startClaimEvaluationWork({
      scope: scope.facts,
      request,
    }).pipe(Result.mapError(mapClaimPlannerError));
    if (start._tag === "planned") return start.plan.receipt;

    const scan = yield* readEvaluationWorkScan(
      sql,
      scope,
      start.intent,
    );
    const afterScan = yield* resumeClaimEvaluationWorkScan(
      start.resume,
      scan,
    ).pipe(Result.mapError(mapClaimPlannerError));
    if (afterScan._tag === "planned") return afterScan.plan.receipt;

    const selected = yield* readEvaluationSelectedQuery(
      sql,
      scope,
      afterScan.intent.queryKey,
    );
    const plan = yield* resumeClaimEvaluationWorkSelectedQuery(
      afterScan.resume,
      selected,
    ).pipe(Result.mapError(mapClaimPlannerError));
    writeClaimPlan(sql, binding, scope, plan);
    return plan.receipt;
  });
}

function recordEvaluationAttemptOutcomeResult(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
): Result.Result<
  Effect.Success<ReturnType<
    QuerySyncTransitionState["recordEvaluationAttemptOutcome"]
  >>,
  OutcomeStateError
> {
  return Result.gen(function* () {
    const authenticated = yield*
      authenticateRecordEvaluationAttemptOutcomeAttempt(attempt);
    const contract = yield* readDeploymentQuerySyncContractState(
      sql,
      "recordEvaluationAttemptOutcome",
    );
    const scope = yield* requireDeploymentQuerySyncScope(
      sql,
      binding,
      contract,
      "recordEvaluationAttemptOutcome",
      true,
    );
    const query = yield* readEvaluationAttemptOutcomeQuery(
      sql,
      scope,
      authenticated.queryKey,
    );
    const plan = yield* planRecordEvaluationAttemptOutcome({
      scope: scope.facts,
      query,
      attempt: authenticated.attempt,
      outcome,
    }).pipe(Result.mapError(mapOutcomePlannerError));
    writeOutcomePlan(sql, binding, scope, plan);
    return plan.receipt;
  });
}

function readCompleteQuery<
  Operation extends
    | "completeQueryEvaluation"
    | "claimEvaluationWork"
    | "recordEvaluationAttemptOutcome",
>(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  queryKey: string,
  operation: Operation,
): Result.Result<
  CompleteQueryScalarFacts | null,
  QuerySyncStoredStateCorruptError<Operation>
> {
  const rows = sql.exec<Record<string, SqlStorageValue>>(`SELECT
    ${DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS}
  FROM main.deployment_sync_queries
  WHERE query_key = ?
  ORDER BY query_key COLLATE BINARY
  LIMIT 2`, queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt(operation, {
      reason: "queryRowDuplicate",
      observed: rows.length,
      queryKey,
    }));
  }
  return decodeDeploymentQuerySyncCompleteQueryRowResult(
    rows[0],
    scope.facts,
  ).pipe(Result.mapError(cause => storedCorrupt(operation, cause)));
}

function readEvaluationSelectedQuery(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  queryKey: string,
): Result.Result<
  EvaluationSelectedQueryFacts | null,
  QuerySyncStoredStateCorruptError<"claimEvaluationWork">
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
  ORDER BY query_key COLLATE BINARY
  LIMIT 2`, queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt("claimEvaluationWork", {
      reason: "selectedQueryRowDuplicate",
      queryKey,
      observed: rows.length,
    }));
  }
  return decodeDeploymentQuerySyncQueryRowResult(
    rows[0],
    scope.facts,
  ).pipe(Result.mapError(cause => storedCorrupt(
    "claimEvaluationWork",
    cause,
  )));
}

function readEvaluationAttemptOutcomeQuery(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  queryKey: string,
): Result.Result<
  EvaluationAttemptOutcomeQueryFacts | null,
  QuerySyncStoredStateCorruptError<"recordEvaluationAttemptOutcome">
> {
  const rows = sql.exec<Record<string, SqlStorageValue>>(`SELECT
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
    preceding_completion_generation
  FROM main.deployment_sync_queries
  WHERE query_key = ?
  ORDER BY query_key COLLATE BINARY
  LIMIT 2`, queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt(
      "recordEvaluationAttemptOutcome",
      {
        reason: "attemptOutcomeQueryRowDuplicate",
        queryKey,
        observed: rows.length,
      },
    ));
  }
  return decodeDeploymentQuerySyncEvaluationAttemptOutcomeRowResult(
    rows[0],
    scope.facts,
  ).pipe(Result.mapError(cause => storedCorrupt(
    "recordEvaluationAttemptOutcome",
    cause,
  )));
}

export function readDeploymentQuerySyncDependencies(
  sql: DeploymentQuerySyncSqlStorage,
  operation: "completeQueryEvaluation",
  role: DeploymentQuerySyncDependencyRole,
  queryKey: QueryDependencyFacts["queryKey"],
  expectedGeneration: QueryDependencyFacts["generation"] | null,
  maximumMembers: number,
): Result.Result<
  QueryDependencyFacts | null,
  QuerySyncStoredStateCorruptError<"completeQueryEvaluation">
> {
  const cursor = sql.exec<EncodedDependencyRow>(`SELECT
    role,
    query_key,
    generation,
    dependency_key
  FROM main.deployment_sync_query_dependencies
  WHERE role = ? AND query_key = ?
  ORDER BY generation, dependency_key COLLATE BINARY
  LIMIT ${maximumMembers}`, role, queryKey);
  let observedMembers = 0;
  let decodedBytes = 0;
  let previousDependencyKey:
    DeploymentQuerySyncDependency["dependencyKey"] | undefined;
  let firstFailure:
    QuerySyncStoredStateCorruptError<"completeQueryEvaluation"> | undefined;
  const dependencyKeys: DeploymentQuerySyncDependency["dependencyKey"][] = [];

  for (const row of cursor) {
    observedMembers += 1;
    if (firstFailure !== undefined) continue;
    if (observedMembers >= maximumMembers) {
      firstFailure = storedCorrupt(operation, {
        reason: "dependencyMemberLimitExceeded",
        role,
        queryKey,
        observed: observedMembers,
      });
      continue;
    }
    const decoded = Result.match(
      decodeDeploymentQuerySyncDependencyRowResult(row),
      {
        onFailure: cause => {
          firstFailure = storedCorrupt(operation, cause);
          return undefined;
        },
        onSuccess: dependency => dependency,
      },
    );
    if (decoded === undefined) continue;
    if (
      expectedGeneration === null
      || decoded.role !== role
      || decoded.queryKey !== queryKey
      || decoded.generation !== expectedGeneration
      || (
        previousDependencyKey !== undefined
        && compareCanonicalBase64Url(
          previousDependencyKey,
          decoded.dependencyKey,
        ) >= 0
      )
    ) {
      firstFailure = storedCorrupt(operation, {
        reason: "dependencyCrossLinkInvalid",
        role,
        queryKey,
        expectedGeneration,
      });
      continue;
    }
    decodedBytes += canonicalBase64UrlDecodedLength(decoded.dependencyKey);
    if (decodedBytes > MAX_QUERY_DEPENDENCY_BYTES) {
      firstFailure = storedCorrupt(operation, {
        reason: "dependencyByteLimitExceeded",
        role,
        queryKey,
        observed: decodedBytes,
      });
      continue;
    }
    dependencyKeys.push(decoded.dependencyKey);
    previousDependencyKey = decoded.dependencyKey;
  }

  if (firstFailure !== undefined) return Result.fail(firstFailure);
  if (observedMembers === 0) {
    return expectedGeneration === null
      ? Result.succeed(null)
      : Result.succeed(Object.freeze({
        queryKey,
        generation: expectedGeneration,
        dependencyKeys: Object.freeze([]),
      }));
  }
  if (expectedGeneration === null) {
    return Result.fail(storedCorrupt(operation, {
      reason: "dependencyCrossLinkInvalid",
      role,
      queryKey,
      expectedGeneration,
    }));
  }
  return Result.succeed(Object.freeze({
    queryKey,
    generation: expectedGeneration,
    dependencyKeys: Object.freeze(dependencyKeys),
  }));
}

function readPendingPublication(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  query: CompleteQueryScalarFacts | null,
  queryKey: string,
  operation: "completeQueryEvaluation",
) {
  if (query === null) {
    return Result.fail(storedCorrupt(operation, {
      reason: "pendingOwnerMissing",
      queryKey,
    }));
  }
  const rows = sql.exec<EncodedPendingPublicationRow>(`SELECT
    query_key,
    generation,
    query_identity,
    completed_through_sequence,
    result_digest,
    content
  FROM main.deployment_sync_pending_publications
  WHERE query_key = ?
  ORDER BY query_key COLLATE BINARY
  LIMIT 2`, queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt(operation, {
      reason: "pendingRowDuplicate",
      queryKey,
      observed: rows.length,
    }));
  }
  return decodeDeploymentQuerySyncPendingPublicationRowResult(
    rows[0],
    scope.facts,
    query,
  ).pipe(Result.mapError(cause => storedCorrupt(operation, cause)));
}

function readEvaluationWorkScan(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  intent: ReadEvaluationWorkScanFactsIntent,
): Result.Result<
  EvaluationWorkScanFactsRead,
  QuerySyncStoredStateCorruptError<"claimEvaluationWork">
> {
  const anchor = intent.scanStartFairnessAnchor;
  const fairnessAnchorPresent = anchor !== null
    && sql.exec<EncodedQueryKeyRow>(`SELECT query_key
      FROM main.deployment_sync_queries
      WHERE query_key = ?
      LIMIT 1`, anchor).toArray().length === 1;

  const prefixRows = intent.lastInspectedQueryKey === null
    ? Object.freeze([])
    : readScanPrefixRows(
      sql,
      anchor,
      intent.lastInspectedQueryKey,
      intent.maximumCombinedQueryFacts,
    );
  if (prefixRows.length >= intent.maximumCombinedQueryFacts) {
    return Result.succeed(Object.freeze({
      _tag: "limitExceeded",
      observed: prefixRows.length,
    }));
  }

  const pageRows = readScanPageRows(
    sql,
    anchor,
    intent.lastInspectedQueryKey,
    intent.maximumPageQueryInspections + 1,
  );
  const hasMore = pageRows.length > intent.maximumPageQueryInspections;
  const admittedPageRows = hasMore
    ? pageRows.slice(0, intent.maximumPageQueryInspections)
    : pageRows;
  if (
    prefixRows.length + admittedPageRows.length
      >= intent.maximumCombinedQueryFacts
  ) {
    return Result.succeed(Object.freeze({
      _tag: "limitExceeded",
      observed: intent.maximumCombinedQueryFacts,
    }));
  }

  return Result.gen(function* () {
    const revalidationPrefix: EvaluationWorkScanFacts[] = [];
    for (const row of prefixRows) {
      revalidationPrefix.push(
        yield* decodeDeploymentQuerySyncEvaluationWorkScanRowResult(
          row,
          scope.facts,
        ).pipe(Result.mapError(cause => storedCorrupt(
          "claimEvaluationWork",
          cause,
        ))),
      );
    }
    const page: EvaluationWorkScanFacts[] = [];
    for (const row of admittedPageRows) {
      page.push(yield* decodeDeploymentQuerySyncEvaluationWorkScanRowResult(
        row,
        scope.facts,
      ).pipe(Result.mapError(cause => storedCorrupt(
        "claimEvaluationWork",
        cause,
      ))));
    }
    return Object.freeze({
      _tag: "complete" as const,
      fairnessAnchorPresent,
      revalidationPrefix: Object.freeze(revalidationPrefix),
      page: Object.freeze(page),
      hasMore,
    });
  });
}

function readScanPrefixRows(
  sql: DeploymentQuerySyncSqlStorage,
  anchor: ReadEvaluationWorkScanFactsIntent["scanStartFairnessAnchor"],
  last: NonNullable<
    ReadEvaluationWorkScanFactsIntent["lastInspectedQueryKey"]
  >,
  maximum: number,
): readonly EncodedEvaluationWorkScanRow[] {
  if (anchor === null) {
    return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
      ${SCAN_QUERY_COLUMNS}
    FROM main.deployment_sync_queries
    WHERE query_key COLLATE BINARY <= ? COLLATE BINARY
    ORDER BY query_key COLLATE BINARY
    LIMIT ${maximum}`, last).toArray();
  }
  if (compareCanonicalBase64Url(last, anchor) > 0) {
    return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
      ${SCAN_QUERY_COLUMNS}
    FROM main.deployment_sync_queries
    WHERE query_key COLLATE BINARY > ? COLLATE BINARY
      AND query_key COLLATE BINARY <= ? COLLATE BINARY
    ORDER BY query_key COLLATE BINARY
    LIMIT ${maximum}`, anchor, last).toArray();
  }
  return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
    ${SCAN_QUERY_COLUMNS}
  FROM main.deployment_sync_queries
  WHERE query_key COLLATE BINARY > ? COLLATE BINARY
     OR query_key COLLATE BINARY <= ? COLLATE BINARY
  ORDER BY CASE WHEN query_key COLLATE BINARY > ? COLLATE BINARY
    THEN 0 ELSE 1 END, query_key COLLATE BINARY
  LIMIT ${maximum}`, anchor, last, anchor).toArray();
}

function readScanPageRows(
  sql: DeploymentQuerySyncSqlStorage,
  anchor: ReadEvaluationWorkScanFactsIntent["scanStartFairnessAnchor"],
  last: ReadEvaluationWorkScanFactsIntent["lastInspectedQueryKey"],
  maximum: number,
): readonly EncodedEvaluationWorkScanRow[] {
  if (anchor === null) {
    return last === null
      ? sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
          ${SCAN_QUERY_COLUMNS}
        FROM main.deployment_sync_queries
        ORDER BY query_key COLLATE BINARY
        LIMIT ${maximum}`).toArray()
      : sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
          ${SCAN_QUERY_COLUMNS}
        FROM main.deployment_sync_queries
        WHERE query_key COLLATE BINARY > ? COLLATE BINARY
        ORDER BY query_key COLLATE BINARY
        LIMIT ${maximum}`, last).toArray();
  }
  if (last === null) {
    return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
      ${SCAN_QUERY_COLUMNS}
    FROM main.deployment_sync_queries
    ORDER BY CASE WHEN query_key COLLATE BINARY > ? COLLATE BINARY
      THEN 0 ELSE 1 END, query_key COLLATE BINARY
    LIMIT ${maximum}`, anchor).toArray();
  }
  if (compareCanonicalBase64Url(last, anchor) > 0) {
    return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
      ${SCAN_QUERY_COLUMNS}
    FROM main.deployment_sync_queries
    WHERE query_key COLLATE BINARY > ? COLLATE BINARY
       OR query_key COLLATE BINARY <= ? COLLATE BINARY
    ORDER BY CASE WHEN query_key COLLATE BINARY > ? COLLATE BINARY
      THEN 0 ELSE 1 END, query_key COLLATE BINARY
    LIMIT ${maximum}`, last, anchor, last).toArray();
  }
  return sql.exec<EncodedEvaluationWorkScanRow>(`SELECT
    ${SCAN_QUERY_COLUMNS}
  FROM main.deployment_sync_queries
  WHERE query_key COLLATE BINARY > ? COLLATE BINARY
    AND query_key COLLATE BINARY <= ? COLLATE BINARY
  ORDER BY query_key COLLATE BINARY
  LIMIT ${maximum}`, last, anchor).toArray();
}

function writeCompletePlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: CompleteQueryEvaluationPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "completeQueryEvaluation",
  );
  const nextQuery: CompleteQueryScalarFacts = Object.freeze({
    descriptor: plan.expected.query.descriptor,
    active: plan.change.active,
    provisional: null,
    currentCompletion: plan.change.currentCompletion,
    precedingCompletionIdentity: plan.change.precedingCompletionIdentity,
  });
  replaceCompleteQuery(sql, plan.expected.query, nextQuery);
  replaceDependencyRole(
    sql,
    "active",
    plan.expected.activeDependencies,
    plan.change.queryKey,
    plan.change.active.generation,
    plan.change.active.dependencyKeys,
  );
  replaceDependencyRole(
    sql,
    "completion",
    plan.expected.completionDependencies,
    plan.change.queryKey,
    plan.change.currentCompletion.identity.generation,
    plan.change.currentCompletion.evaluationDependencyKeys,
  );
  if (plan.change.pendingPublication._tag === "replaceTargetPending") {
    replacePendingPublication(
      sql,
      plan.expected.pendingPublication,
      plan.change.pendingPublication.publication,
    );
  }
  replaceDeploymentQuerySyncScope(
    sql,
    "completeQueryEvaluation",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

function writeClaimPlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: ClaimEvaluationWorkPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "claimEvaluationWork",
  );
  if (plan.change._tag === "claimDirtyEvaluationWork") {
    replaceEvaluationSelectedQuery(sql, plan.expected.query, Object.freeze({
      ...plan.expected.query,
      provisional: plan.change.provisional,
    }));
  }
  replaceDeploymentQuerySyncScope(
    sql,
    "claimEvaluationWork",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

function writeOutcomePlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: RecordEvaluationAttemptOutcomePlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "recordEvaluationAttemptOutcome",
  );
  replaceEvaluationAttemptOutcomeQuery(
    sql,
    plan.expected.query,
    plan.change.provisional,
  );
  replaceDeploymentQuerySyncScope(
    sql,
    "recordEvaluationAttemptOutcome",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

function replaceCompleteQuery(
  sql: DeploymentQuerySyncSqlStorage,
  expectedFacts: CompleteQueryScalarFacts,
  nextFacts: CompleteQueryScalarFacts,
): void {
  const expected = encodeDeploymentQuerySyncCompleteQueryRow(expectedFacts);
  const next = encodeDeploymentQuerySyncCompleteQueryRow(nextFacts);
  const cursor = sql.exec<EncodedQueryKeyRow>(`UPDATE
    main.deployment_sync_queries SET
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
      provisional_disposition = ?,
      completion_generation = ?,
      completion_expected_active_generation = ?,
      completion_registration_sequence = ?,
      completion_requested_dirty_through_sequence = ?,
      completion_evaluation_snapshot_sequence = ?,
      completion_evaluation_authority_witness = ?,
      completion_refreshed_through_sequence = ?,
      completion_relevant_through_sequence = ?,
      completion_refresh_authority_witness = ?,
      completion_result_digest = ?,
      completion_publication_disposition = ?,
      preceding_completion_generation = ?
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
      AND completion_generation IS ?
      AND completion_expected_active_generation IS ?
      AND completion_registration_sequence IS ?
      AND completion_requested_dirty_through_sequence IS ?
      AND completion_evaluation_snapshot_sequence IS ?
      AND completion_evaluation_authority_witness IS ?
      AND completion_refreshed_through_sequence IS ?
      AND completion_relevant_through_sequence IS ?
      AND completion_refresh_authority_witness IS ?
      AND completion_result_digest IS ?
      AND completion_publication_disposition IS ?
      AND preceding_completion_generation IS ?
    RETURNING query_key`,
  ...completeQueryValues(next).slice(1),
  ...completeQueryValues(expected));
  expectSingleDeploymentQuerySyncWrite(
    "completeQueryEvaluation",
    cursor,
    "complete-query-cas",
  );
}

function replaceDependencyRole(
  sql: DeploymentQuerySyncSqlStorage,
  role: DeploymentQuerySyncDependencyRole,
  expected: QueryDependencyFacts | null,
  queryKey: QueryDependencyFacts["queryKey"],
  generation: QueryDependencyFacts["generation"],
  dependencyKeys: QueryDependencyFacts["dependencyKeys"],
): void {
  const removed = sql.exec<EncodedDependencyRow>(`DELETE FROM
    main.deployment_sync_query_dependencies
    WHERE role = ? AND query_key = ?
    RETURNING role, query_key, generation, dependency_key`, role, queryKey);
  expectDeploymentQuerySyncWrites(
    "completeQueryEvaluation",
    expected?.dependencyKeys.length ?? 0,
    removed,
    `${role}-dependency-delete`,
  );
  for (const dependencyKey of dependencyKeys) {
    const row = encodeDeploymentQuerySyncDependencyRow({
      role,
      queryKey,
      generation,
      dependencyKey,
    });
    const inserted = sql.exec<EncodedDependencyRow>(`INSERT INTO
      main.deployment_sync_query_dependencies (
        role,
        query_key,
        generation,
        dependency_key
      ) VALUES (?, ?, ?, ?)
      RETURNING role, query_key, generation, dependency_key`,
    row.role, row.query_key, row.generation, row.dependency_key);
    expectSingleDeploymentQuerySyncWrite(
      "completeQueryEvaluation",
      inserted,
      `${role}-dependency-insert`,
    );
  }
}

function replacePendingPublication(
  sql: DeploymentQuerySyncSqlStorage,
  expected: PendingQueryPublication | null,
  next: PendingQueryPublication,
): void {
  const removed = expected === null
    ? sql.exec<EncodedPendingPublicationRow>(`DELETE FROM
      main.deployment_sync_pending_publications
      WHERE query_key IS ?
      RETURNING query_key, generation, query_identity,
        completed_through_sequence, result_digest, content`,
    next.identity.queryKey)
    : (() => {
      const row = encodeDeploymentQuerySyncPendingPublicationRow(expected);
      return sql.exec<EncodedPendingPublicationRow>(`DELETE FROM
        main.deployment_sync_pending_publications
        WHERE query_key IS ?
          AND generation IS ?
          AND query_identity IS ?
          AND completed_through_sequence IS ?
          AND result_digest IS ?
          AND content IS ?
        RETURNING query_key, generation, query_identity,
          completed_through_sequence, result_digest, content`,
      row.query_key,
      row.generation,
      row.query_identity,
      row.completed_through_sequence,
      row.result_digest,
      row.content);
    })();
  expectDeploymentQuerySyncWrites(
    "completeQueryEvaluation",
    expected === null ? 0 : 1,
    removed,
    "pending-publication-delete",
  );
  const row = encodeDeploymentQuerySyncPendingPublicationRow(next);
  const inserted = sql.exec<EncodedPendingPublicationRow>(`INSERT INTO
    main.deployment_sync_pending_publications (
      query_key,
      generation,
      query_identity,
      completed_through_sequence,
      result_digest,
      content
    ) VALUES (?, ?, ?, ?, ?, ?)
    RETURNING query_key, generation, query_identity,
      completed_through_sequence, result_digest, content`,
  row.query_key,
  row.generation,
  row.query_identity,
  row.completed_through_sequence,
  row.result_digest,
  row.content);
  expectSingleDeploymentQuerySyncWrite(
    "completeQueryEvaluation",
    inserted,
    "pending-publication-insert",
  );
}

function replaceEvaluationSelectedQuery(
  sql: DeploymentQuerySyncSqlStorage,
  expectedFacts: EvaluationSelectedQueryFacts,
  nextFacts: EvaluationSelectedQueryFacts,
): void {
  const expected = encodeDeploymentQuerySyncQueryRow(expectedFacts);
  const next = encodeDeploymentQuerySyncQueryRow(nextFacts);
  const cursor = sql.exec<EncodedQueryKeyRow>(`UPDATE
    main.deployment_sync_queries SET
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
  next.provisional_generation,
  next.provisional_expected_active_generation,
  next.provisional_registration_sequence,
  next.provisional_requested_dirty_through_sequence,
  next.provisional_disposition,
  ...queryValues(expected));
  expectSingleDeploymentQuerySyncWrite("claimEvaluationWork", cursor);
}

function replaceEvaluationAttemptOutcomeQuery(
  sql: DeploymentQuerySyncSqlStorage,
  expectedFacts: EvaluationAttemptOutcomeQueryFacts,
  nextProvisional: NonNullable<EvaluationAttemptOutcomeQueryFacts["provisional"]>,
): void {
  const expected = encodeDeploymentQuerySyncQueryRow(expectedFacts);
  const next = encodeDeploymentQuerySyncQueryRow(Object.freeze({
    descriptor: expectedFacts.descriptor,
    active: expectedFacts.active,
    provisional: nextProvisional,
  }));
  const completion = expectedFacts.currentCompletion;
  const cursor = sql.exec<EncodedQueryKeyRow>(`UPDATE
    main.deployment_sync_queries SET
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
      AND completion_generation IS ?
      AND completion_expected_active_generation IS ?
      AND completion_registration_sequence IS ?
      AND completion_requested_dirty_through_sequence IS ?
      AND preceding_completion_generation IS ?
    RETURNING query_key`,
  next.provisional_generation,
  next.provisional_expected_active_generation,
  next.provisional_registration_sequence,
  next.provisional_requested_dirty_through_sequence,
  next.provisional_disposition,
  ...queryValues(expected),
  completion?.identity.generation.toString() ?? null,
  completion?.expectedActiveGeneration?.toString() ?? null,
  completion?.registrationCursor.appliedThroughSequence.toString() ?? null,
  completion?.requestedDirtyThroughSequence?.toString() ?? null,
  expectedFacts.precedingCompletionIdentity?.generation.toString() ?? null);
  expectSingleDeploymentQuerySyncWrite(
    "recordEvaluationAttemptOutcome",
    cursor,
  );
}

function completeQueryValues(
  row: ReturnType<typeof encodeDeploymentQuerySyncCompleteQueryRow>,
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

function queryValues(row: EncodedDeploymentQuerySyncQueryRow): SqlStorageValue[] {
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

function mapCompletePlannerError(
  error: CompletePlannerError,
): CompleteStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "completeQueryEvaluation",
      error,
    )
    : error;
}

function mapClaimPlannerError(error: ClaimPlannerError): ClaimStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "claimEvaluationWork",
      error,
    )
    : error;
}

function mapOutcomePlannerError(
  error: PlanRecordEvaluationAttemptOutcomeError,
): OutcomeStateError {
  return error._tag === "QuerySyncTransitionFactError"
    ? mapDeploymentQuerySyncTransitionFactError(
      "recordEvaluationAttemptOutcome",
      error,
    )
    : error;
}

function storedCorrupt<
  Operation extends
    | "completeQueryEvaluation"
    | "claimEvaluationWork"
    | "recordEvaluationAttemptOutcome",
>(
  operation: Operation,
  evidence: unknown,
): QuerySyncStoredStateCorruptError<Operation> {
  return deploymentQuerySyncStoredStateCorrupt(
    operation,
    "storedAggregateInvalid",
    deploymentQuerySyncStoredStateIssue("rowInvalid", evidence),
  );
}
