import {
  canonicalBase64UrlDecodedLength,
  canonicalPublicationContentDecodedLength,
  queryPublicationIdentityEquals,
  type CanonicalQueryKey,
  type InFlightQueryPublication,
  type PendingQueryPublication,
  type QueryPublicationIdentity,
} from "@flarex/query-sync/internal/kernel";
import {
  QuerySyncStoredStateCorruptError,
} from "@flarex/query-sync/internal/state";
import {
  publicationLifecycleFactsAreValid,
  type ClaimPublicationPlan,
  type CompletePublicationPlan,
  type CompletionPublicationLifecycleFacts,
  type PendingPublicationSelectionFacts,
  type PublicationLifecycleFacts,
  type PublicationOwnerQueryFacts,
  type RecordPublicationAttemptOutcomePlan,
} from "@flarex/query-sync/internal/transition-plan";
import { Result } from "effect";

import type { DeploymentQuerySyncBinding } from "./Binding";
import {
  decodeDeploymentQuerySyncCompleteQueryRowResult,
  DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS,
} from "./EvaluationRowCodec";
import {
  decodeDeploymentQuerySyncInFlightPublicationRowResult,
  decodeDeploymentQuerySyncPendingPublicationRowResult,
  decodeDeploymentQuerySyncPublicationStateRowResult,
  encodeDeploymentQuerySyncInFlightPublicationRow,
  encodeDeploymentQuerySyncPendingPublicationRow,
  encodeDeploymentQuerySyncPublicationStateRow,
  type EncodedDeploymentQuerySyncInFlightPublicationRow,
  type EncodedDeploymentQuerySyncPendingPublicationRow,
  type EncodedDeploymentQuerySyncPublicationStateRow,
} from "./PublicationRowCodec";
import type {
  DeploymentQuerySyncStoredScopeState,
} from "./RowCodec";
import {
  DeploymentQuerySyncAdapterInvariantDefect,
  assertDeploymentQuerySyncPlannedScopeAuthority,
  deploymentQuerySyncStoredStateCorrupt,
  deploymentQuerySyncStoredStateIssue,
  expectSingleDeploymentQuerySyncWrite,
  nextStoredDeploymentQuerySyncScope,
  replaceDeploymentQuerySyncScope,
} from "./StateStorage";
import type {
  DeploymentQuerySyncSqlStorage,
} from "./StorageContract";

type PublicationStorageOperation =
  | "initializeOrInspectNamespace"
  | "completeQueryEvaluation"
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication";

interface EncodedSingletonRow {
  readonly [key: string]: SqlStorageValue;
  readonly singleton: number;
}

const PUBLICATION_STATE_COLUMNS = `
  singleton,
  attempt_ordinal,
  first_attempt_at,
  last_attempt_at,
  attempt_disposition,
  attempt_block_reason,
  latest_delivered_query_key,
  latest_delivered_generation,
  latest_delivered_result_digest,
  preceding_query_key,
  preceding_generation,
  preceding_result_digest,
  preceding_attempt_ordinal,
  preceding_outcome,
  preceding_receipt_tag,
  preceding_next_attempt_ordinal,
  preceding_next_disposition,
  preceding_block_reason`;

const IN_FLIGHT_PUBLICATION_COLUMNS = `
  singleton,
  query_key,
  generation,
  query_identity,
  completed_through_sequence,
  result_digest,
  content`;

const PENDING_PUBLICATION_COLUMNS = `
  query_key,
  generation,
  query_identity,
  completed_through_sequence,
  result_digest,
  content`;

function storedCorrupt<Operation extends PublicationStorageOperation>(
  operation: Operation,
  evidence: unknown,
): QuerySyncStoredStateCorruptError<Operation> {
  return deploymentQuerySyncStoredStateCorrupt(
    operation,
    "storedAggregateInvalid",
    deploymentQuerySyncStoredStateIssue("rowInvalid", evidence),
  );
}

function publicationLifecycleCorruptionEvidence(
  scope: DeploymentQuerySyncStoredScopeState,
  lifecycle: PublicationLifecycleFacts,
) {
  const inFlight = lifecycle.inFlight;
  const latestDelivered = lifecycle.latestDelivered;
  const precedingAttemptOutcome = lifecycle.precedingAttemptOutcome;
  const precedingReceipt = precedingAttemptOutcome?.receipt ?? null;
  return Object.freeze({
    reason: "publicationLifecycleFactsInvalid" as const,
    scopeMetrics: Object.freeze({
      queryCount: scope.facts.metrics.queryCount,
      retainedIdentityBytes: scope.facts.metrics.retainedIdentityBytes,
      dependencyMemberships: scope.facts.metrics.dependencyMemberships,
      pendingPublicationCount: scope.facts.metrics.pendingPublicationCount,
      inFlightPublicationCount: scope.facts.metrics.inFlightPublicationCount,
      retainedPublicationContentBytes:
        scope.facts.metrics.retainedPublicationContentBytes,
      settlementEnvelopeBytes: scope.facts.metrics.settlementEnvelopeBytes,
      countedCanonicalBytes: scope.facts.metrics.countedCanonicalBytes,
    }),
    inFlight: inFlight === null
      ? null
      : Object.freeze({
        queryKey: inFlight.publication.identity.queryKey,
        generation: inFlight.publication.identity.generation,
        resultDigest: inFlight.publication.resultDigest,
        completedThroughSequence:
          inFlight.publication.completedThroughSequence,
        queryIdentityBytes: canonicalBase64UrlDecodedLength(
          inFlight.publication.queryIdentity,
        ),
        contentBytes: canonicalPublicationContentDecodedLength(
          inFlight.publication.content,
        ),
        attemptOrdinal: inFlight.attemptOrdinal,
        firstAttemptAt: inFlight.firstAttemptAt,
        lastAttemptAt: inFlight.lastAttemptAt,
        dispositionTag: inFlight.disposition._tag,
        blockReason: inFlight.disposition._tag === "blocked"
          ? inFlight.disposition.reason
          : null,
      }),
    latestDelivered: latestDelivered === null
      ? null
      : Object.freeze({
        queryKey: latestDelivered.identity.queryKey,
        generation: latestDelivered.identity.generation,
        resultDigest: latestDelivered.resultDigest,
      }),
    precedingAttemptOutcome: precedingAttemptOutcome === null
      ? null
      : Object.freeze({
        queryKey: precedingAttemptOutcome.identity.queryKey,
        generation: precedingAttemptOutcome.identity.generation,
        resultDigest: precedingAttemptOutcome.resultDigest,
        attemptOrdinal: precedingAttemptOutcome.attemptOrdinal,
        outcome: precedingAttemptOutcome.outcome,
        receiptTag: precedingReceipt?._tag ?? null,
        nextAttemptOrdinal: precedingReceipt?._tag === "recorded"
          ? precedingReceipt.nextAttemptOrdinal
          : null,
        nextDisposition: precedingReceipt?._tag === "recorded"
          ? precedingReceipt.nextDisposition
          : null,
        blockReason: precedingReceipt?._tag === "blocked"
          ? precedingReceipt.reason
          : null,
      }),
  });
}

export function readDeploymentQuerySyncPublicationLifecycle<
  Operation extends PublicationStorageOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  operation: Operation,
): Result.Result<
  PublicationLifecycleFacts,
  QuerySyncStoredStateCorruptError<Operation>
> {
  return Result.gen(function* () {
    const inFlightRows = sql.exec<
      EncodedDeploymentQuerySyncInFlightPublicationRow & {
        readonly [key: string]: SqlStorageValue;
      }
    >(`SELECT ${IN_FLIGHT_PUBLICATION_COLUMNS}
      FROM main.deployment_sync_in_flight_publication
      ORDER BY singleton
      LIMIT 2`).toArray();
    if (inFlightRows.length > 1) {
      return yield* Result.fail(storedCorrupt(operation, Object.freeze({
        reason: "inFlightPublicationRowDuplicate",
        observed: inFlightRows.length,
      })));
    }
    const inFlightPublication = inFlightRows[0] === undefined
      ? null
      : yield* decodeDeploymentQuerySyncInFlightPublicationRowResult(
        inFlightRows[0],
        scope.facts,
      ).pipe(Result.mapError(cause => storedCorrupt(operation, cause)));

    const stateRows = sql.exec<
      EncodedDeploymentQuerySyncPublicationStateRow & {
        readonly [key: string]: SqlStorageValue;
      }
    >(`SELECT ${PUBLICATION_STATE_COLUMNS}
      FROM main.deployment_sync_publication_state
      ORDER BY singleton
      LIMIT 2`).toArray();
    if (stateRows.length === 0) {
      return yield* Result.fail(storedCorrupt(operation, Object.freeze({
        reason: "publicationStateRowMissing",
      })));
    }
    if (stateRows.length !== 1) {
      return yield* Result.fail(storedCorrupt(operation, Object.freeze({
        reason: "publicationStateRowDuplicate",
        observed: stateRows.length,
      })));
    }
    const lifecycle = yield*
      decodeDeploymentQuerySyncPublicationStateRowResult(
        stateRows[0],
        scope.facts,
        inFlightPublication,
      ).pipe(Result.mapError(cause => storedCorrupt(operation, cause)));
    if (!publicationLifecycleFactsAreValid(scope.facts, lifecycle)) {
      return yield* Result.fail(storedCorrupt(
        operation,
        publicationLifecycleCorruptionEvidence(scope, lifecycle),
      ));
    }
    return lifecycle;
  });
}

export function readDeploymentQuerySyncPublicationOwner<
  Operation extends PublicationStorageOperation,
>(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  queryKey: CanonicalQueryKey,
  operation: Operation,
): Result.Result<
  PublicationOwnerQueryFacts | null,
  QuerySyncStoredStateCorruptError<Operation>
> {
  const rows = sql.exec<Record<string, SqlStorageValue>>(`SELECT
    ${DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS}
  FROM main.deployment_sync_queries
  WHERE query_key = ?
  ORDER BY query_key COLLATE BINARY
  LIMIT 2`, queryKey).toArray();
  return decodeOwnerRows(rows, scope, operation, queryKey);
}

function decodeOwnerRows<Operation extends PublicationStorageOperation>(
  rows: readonly unknown[],
  scope: DeploymentQuerySyncStoredScopeState,
  operation: Operation,
  expectedQueryKey: CanonicalQueryKey | null,
): Result.Result<
  PublicationOwnerQueryFacts | null,
  QuerySyncStoredStateCorruptError<Operation>
> {
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt(operation, Object.freeze({
      reason: "publicationOwnerRowDuplicate",
      observed: rows.length,
      expectedQueryKey,
    })));
  }
  return decodeDeploymentQuerySyncCompleteQueryRowResult(
    rows[0],
    scope.facts,
  ).pipe(
    Result.mapError(cause => storedCorrupt(operation, cause)),
    Result.flatMap(query => {
      if (
        expectedQueryKey !== null
        && query.descriptor.queryKey !== expectedQueryKey
      ) {
        return Result.fail(storedCorrupt(operation, Object.freeze({
          reason: "publicationOwnerQueryKeyMismatch",
          expectedQueryKey,
          observed: query.descriptor.queryKey,
        })));
      }
      return Result.succeed(Object.freeze({
        descriptor: query.descriptor,
        active: query.active === null
          ? null
          : Object.freeze({
            generation: query.active.generation,
            freshThroughSequence: query.active.freshThroughSequence,
            resultDigest: query.active.resultDigest,
          }),
        currentCompletion: query.currentCompletion === null
          ? null
          : Object.freeze({
            identity: query.currentCompletion.identity,
            refreshedThroughSequence:
              query.currentCompletion.refreshedThroughSequence,
            resultDigest: query.currentCompletion.resultDigest,
            publicationDisposition:
              query.currentCompletion.publicationDisposition,
          }),
      }));
    }),
  );
}

export function readDeploymentQuerySyncLowestPendingPublication(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
): Result.Result<
  PendingPublicationSelectionFacts | null,
  QuerySyncStoredStateCorruptError<"claimPublication">
> {
  return Result.gen(function* () {
    const publicationRows = sql.exec<
      EncodedDeploymentQuerySyncPendingPublicationRow & {
        readonly [key: string]: SqlStorageValue;
      }
    >(`SELECT ${PENDING_PUBLICATION_COLUMNS}
      FROM main.deployment_sync_pending_publications
      ORDER BY query_key COLLATE BINARY
      LIMIT 1`).toArray();
    if (publicationRows.length === 0) return null;
    const ownerRows = sql.exec<Record<string, SqlStorageValue>>(`SELECT
      ${DEPLOYMENT_QUERY_SYNC_COMPLETE_QUERY_COLUMNS}
    FROM main.deployment_sync_queries
    WHERE query_key = (
      SELECT query_key
      FROM main.deployment_sync_pending_publications
      ORDER BY query_key COLLATE BINARY
      LIMIT 1
    )
    ORDER BY query_key COLLATE BINARY
    LIMIT 2`).toArray();
    const owner = yield* decodeOwnerRows(
      ownerRows,
      scope,
      "claimPublication",
      null,
    );
    if (owner === null) {
      return yield* Result.fail(storedCorrupt(
        "claimPublication",
        Object.freeze({ reason: "pendingPublicationOwnerMissing" }),
      ));
    }
    const publication = yield*
      decodeDeploymentQuerySyncPendingPublicationRowResult(
        publicationRows[0],
        scope.facts,
        owner,
      ).pipe(Result.mapError(cause => storedCorrupt(
        "claimPublication",
        cause,
      )));
    return Object.freeze({ publication, owner });
  });
}

function readPendingPublicationForOwner<Operation extends PublicationStorageOperation>(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  owner: PublicationOwnerQueryFacts,
  operation: Operation,
): Result.Result<
  PendingQueryPublication | null,
  QuerySyncStoredStateCorruptError<Operation>
> {
  const rows = sql.exec<
    EncodedDeploymentQuerySyncPendingPublicationRow & {
      readonly [key: string]: SqlStorageValue;
    }
  >(`SELECT ${PENDING_PUBLICATION_COLUMNS}
    FROM main.deployment_sync_pending_publications
    WHERE query_key = ?
    ORDER BY query_key COLLATE BINARY
    LIMIT 2`, owner.descriptor.queryKey).toArray();
  if (rows.length === 0) return Result.succeed(null);
  if (rows.length !== 1) {
    return Result.fail(storedCorrupt(operation, Object.freeze({
      reason: "pendingPublicationRowDuplicate",
      observed: rows.length,
      queryKey: owner.descriptor.queryKey,
    })));
  }
  return decodeDeploymentQuerySyncPendingPublicationRowResult(
    rows[0],
    scope.facts,
    owner,
  ).pipe(Result.mapError(cause => storedCorrupt(operation, cause)));
}

export function readDeploymentQuerySyncRetainedPublication(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  owner: PublicationOwnerQueryFacts,
  identity: QueryPublicationIdentity,
): Result.Result<
  PendingQueryPublication | null,
  QuerySyncStoredStateCorruptError<"completeQueryEvaluation">
> {
  return Result.gen(function* () {
    const pending = yield* readPendingPublicationForOwner(
      sql,
      scope,
      owner,
      "completeQueryEvaluation",
    );
    if (
      pending !== null
      && queryPublicationIdentityEquals(pending.identity, identity)
    ) {
      return pending;
    }
    const lifecycle = yield* readDeploymentQuerySyncPublicationLifecycle(
      sql,
      scope,
      "completeQueryEvaluation",
    );
    const inFlight = lifecycle.inFlight?.publication ?? null;
    return inFlight !== null
        && queryPublicationIdentityEquals(inFlight.identity, identity)
      ? inFlight
      : null;
  });
}

export function readDeploymentQuerySyncCompletionPublicationLifecycle(
  sql: DeploymentQuerySyncSqlStorage,
  scope: DeploymentQuerySyncStoredScopeState,
  queryKey: CanonicalQueryKey,
): Result.Result<
  CompletionPublicationLifecycleFacts,
  QuerySyncStoredStateCorruptError<"completeQueryEvaluation">
> {
  return readDeploymentQuerySyncPublicationLifecycle(
    sql,
    scope,
    "completeQueryEvaluation",
  ).pipe(Result.map(lifecycle => {
    const inFlight = lifecycle.inFlight;
    const delivered = lifecycle.latestDelivered;
    const preceding = lifecycle.precedingAttemptOutcome;
    return Object.freeze({
      queryKey,
      inFlight: inFlight?.publication.identity.queryKey === queryKey
        ? inFlight.publication
        : null,
      latestDelivered: delivered?.identity.queryKey === queryKey
        ? delivered
        : null,
      precedingAttemptOutcome: preceding?.identity.queryKey === queryKey
        ? Object.freeze({
          identity: preceding.identity,
          resultDigest: preceding.resultDigest,
        })
        : null,
    });
  }));
}

export function insertEmptyDeploymentQuerySyncPublicationState(
  sql: DeploymentQuerySyncSqlStorage,
): void {
  const cursor = sql.exec<EncodedSingletonRow>(`INSERT INTO
    main.deployment_sync_publication_state (singleton)
    VALUES (1)
    RETURNING singleton`);
  expectSingleDeploymentQuerySyncWrite(
    "initializeOrInspectNamespace",
    cursor,
    "publication-state-insert",
  );
}

export function writeDeploymentQuerySyncClaimPublicationPlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: ClaimPublicationPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "claimPublication",
  );
  const nextLifecycle: PublicationLifecycleFacts = Object.freeze({
    ...plan.expected.lifecycle,
    inFlight: plan.change.inFlight,
  });
  if (plan.change._tag === "claimPendingPublication") {
    const expectedPending = plan.expected.selectedPending;
    if (expectedPending === null) {
      throw new DeploymentQuerySyncAdapterInvariantDefect(
        "claimPublication",
        "pending-publication-expected",
      );
    }
    deletePendingPublication(sql, expectedPending);
    insertInFlightPublication(sql, plan.change.inFlight, "claimPublication");
  }
  replacePublicationState(
    sql,
    "claimPublication",
    plan.expected.lifecycle,
    nextLifecycle,
  );
  replaceDeploymentQuerySyncScope(
    sql,
    "claimPublication",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

export function writeDeploymentQuerySyncPublicationOutcomePlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: RecordPublicationAttemptOutcomePlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "recordPublicationAttemptOutcome",
  );
  const nextLifecycle: PublicationLifecycleFacts = Object.freeze({
    ...plan.expected.lifecycle,
    inFlight: plan.change.inFlight,
    precedingAttemptOutcome: plan.change.precedingAttemptOutcome,
  });
  replacePublicationState(
    sql,
    "recordPublicationAttemptOutcome",
    plan.expected.lifecycle,
    nextLifecycle,
  );
  replaceDeploymentQuerySyncScope(
    sql,
    "recordPublicationAttemptOutcome",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

export function writeDeploymentQuerySyncCompletePublicationPlan(
  sql: DeploymentQuerySyncSqlStorage,
  binding: DeploymentQuerySyncBinding,
  scope: DeploymentQuerySyncStoredScopeState,
  plan: CompletePublicationPlan,
): void {
  if (plan._tag === "noWrite") return;
  assertDeploymentQuerySyncPlannedScopeAuthority(
    binding,
    plan.nextScope,
    "completePublication",
  );
  const nextLifecycle: PublicationLifecycleFacts = Object.freeze({
    ...plan.expected.lifecycle,
    inFlight: null,
    latestDelivered: plan.change.latestDelivered,
  });
  deleteInFlightPublication(sql, plan.change.inFlight);
  replacePublicationState(
    sql,
    "completePublication",
    plan.expected.lifecycle,
    nextLifecycle,
  );
  replaceDeploymentQuerySyncScope(
    sql,
    "completePublication",
    scope,
    nextStoredDeploymentQuerySyncScope(scope, plan.nextScope),
  );
}

function replacePublicationState(
  sql: DeploymentQuerySyncSqlStorage,
  operation:
    | "claimPublication"
    | "recordPublicationAttemptOutcome"
    | "completePublication",
  expectedLifecycle: PublicationLifecycleFacts,
  nextLifecycle: PublicationLifecycleFacts,
): void {
  const expected = encodeDeploymentQuerySyncPublicationStateRow(
    expectedLifecycle,
  );
  const next = encodeDeploymentQuerySyncPublicationStateRow(nextLifecycle);
  const cursor = sql.exec<EncodedSingletonRow>(`UPDATE
    main.deployment_sync_publication_state SET
      attempt_ordinal = ?,
      first_attempt_at = ?,
      last_attempt_at = ?,
      attempt_disposition = ?,
      attempt_block_reason = ?,
      latest_delivered_query_key = ?,
      latest_delivered_generation = ?,
      latest_delivered_result_digest = ?,
      preceding_query_key = ?,
      preceding_generation = ?,
      preceding_result_digest = ?,
      preceding_attempt_ordinal = ?,
      preceding_outcome = ?,
      preceding_receipt_tag = ?,
      preceding_next_attempt_ordinal = ?,
      preceding_next_disposition = ?,
      preceding_block_reason = ?
    WHERE singleton IS ?
      AND attempt_ordinal IS ?
      AND first_attempt_at IS ?
      AND last_attempt_at IS ?
      AND attempt_disposition IS ?
      AND attempt_block_reason IS ?
      AND latest_delivered_query_key IS ?
      AND latest_delivered_generation IS ?
      AND latest_delivered_result_digest IS ?
      AND preceding_query_key IS ?
      AND preceding_generation IS ?
      AND preceding_result_digest IS ?
      AND preceding_attempt_ordinal IS ?
      AND preceding_outcome IS ?
      AND preceding_receipt_tag IS ?
      AND preceding_next_attempt_ordinal IS ?
      AND preceding_next_disposition IS ?
      AND preceding_block_reason IS ?
    RETURNING singleton`,
  ...publicationStateValues(next).slice(1),
  ...publicationStateValues(expected));
  expectSingleDeploymentQuerySyncWrite(
    operation,
    cursor,
    "publication-state-cas",
  );
}

function insertInFlightPublication(
  sql: DeploymentQuerySyncSqlStorage,
  inFlight: InFlightQueryPublication,
  operation: "claimPublication",
): void {
  const row = encodeDeploymentQuerySyncInFlightPublicationRow(inFlight);
  const cursor = sql.exec<EncodedSingletonRow>(`INSERT INTO
    main.deployment_sync_in_flight_publication (
      singleton,
      query_key,
      generation,
      query_identity,
      completed_through_sequence,
      result_digest,
      content
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING singleton`, ...inFlightPublicationValues(row));
  expectSingleDeploymentQuerySyncWrite(
    operation,
    cursor,
    "in-flight-publication-insert",
  );
}

function deleteInFlightPublication(
  sql: DeploymentQuerySyncSqlStorage,
  inFlight: NonNullable<PublicationLifecycleFacts["inFlight"]>,
): void {
  const row = encodeDeploymentQuerySyncInFlightPublicationRow(inFlight);
  const cursor = sql.exec<EncodedSingletonRow>(`DELETE FROM
    main.deployment_sync_in_flight_publication
    WHERE singleton IS ?
      AND query_key IS ?
      AND generation IS ?
      AND query_identity IS ?
      AND completed_through_sequence IS ?
      AND result_digest IS ?
      AND content IS ?
    RETURNING singleton`, ...inFlightPublicationValues(row));
  expectSingleDeploymentQuerySyncWrite(
    "completePublication",
    cursor,
    "in-flight-publication-delete",
  );
}

function deletePendingPublication(
  sql: DeploymentQuerySyncSqlStorage,
  publication: PendingQueryPublication,
): void {
  const row = encodeDeploymentQuerySyncPendingPublicationRow(publication);
  const cursor = sql.exec<{ readonly query_key: string }>(`DELETE FROM
    main.deployment_sync_pending_publications
    WHERE query_key IS ?
      AND generation IS ?
      AND query_identity IS ?
      AND completed_through_sequence IS ?
      AND result_digest IS ?
      AND content IS ?
    RETURNING query_key`, ...pendingPublicationValues(row));
  expectSingleDeploymentQuerySyncWrite(
    "claimPublication",
    cursor,
    "pending-publication-delete",
  );
}

function publicationStateValues(
  row: EncodedDeploymentQuerySyncPublicationStateRow,
): SqlStorageValue[] {
  return [
    row.singleton,
    row.attempt_ordinal,
    row.first_attempt_at,
    row.last_attempt_at,
    row.attempt_disposition,
    row.attempt_block_reason,
    row.latest_delivered_query_key,
    row.latest_delivered_generation,
    row.latest_delivered_result_digest,
    row.preceding_query_key,
    row.preceding_generation,
    row.preceding_result_digest,
    row.preceding_attempt_ordinal,
    row.preceding_outcome,
    row.preceding_receipt_tag,
    row.preceding_next_attempt_ordinal,
    row.preceding_next_disposition,
    row.preceding_block_reason,
  ];
}

function inFlightPublicationValues(
  row: EncodedDeploymentQuerySyncInFlightPublicationRow,
): SqlStorageValue[] {
  return [
    row.singleton,
    row.query_key,
    row.generation,
    row.query_identity,
    row.completed_through_sequence,
    row.result_digest,
    row.content,
  ];
}

function pendingPublicationValues(
  row: EncodedDeploymentQuerySyncPendingPublicationRow,
): SqlStorageValue[] {
  return [
    row.query_key,
    row.generation,
    row.query_identity,
    row.completed_through_sequence,
    row.result_digest,
    row.content,
  ];
}
