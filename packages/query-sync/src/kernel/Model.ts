import { Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  captureCanonicalDependencyKey,
  captureCanonicalQueryIdentity,
  captureCanonicalQueryKey,
  captureQueryAuthorityWitness,
  captureQueryGeneration,
  captureQueryResultDigest,
  captureQuerySnapshot,
  captureSyncEpoch,
  captureSyncModelId,
  captureSyncNamespaceId,
  captureSyncSequence,
  compareCanonicalBase64Url,
  initialQuerySyncWorkRevision,
  MAX_PUBLICATION_ATTEMPT_INSTANT,
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
  MAX_QUERY_SYNC_WORK_REVISION,
  successorQueryGeneration,
} from "./CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryIdentity,
  CanonicalQueryKey,
  QueryAuthorityWitness,
  QueryGeneration,
  QueryResultDigest,
  QuerySnapshot,
  QuerySyncWorkRevision,
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import {
  QueryDependencyLimitError,
  QueryKeyCollisionError,
  QuerySyncCanonicalValueError,
  QuerySyncInvariantDefect,
} from "./Errors.js";
import type {
  QueryDependencyLimitOperation,
  QuerySyncStateLimitError,
} from "./Errors.js";
import {
  compareQueryPublicationIdentity,
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
  queryPublicationIdentityEquals,
} from "./Publication.js";
import type {
  PendingQueryPublication,
  QueryCompletionPublicationDisposition,
  QueryPublicationIdentity,
} from "./Publication.js";
import type {
  ApplyAdmittedBatchReceipt,
  BeginQueryEvaluationReceipt,
  CompleteQueryEvaluationReceipt,
} from "../transition-plan/Receipts.js";
export {
  isIssuedQueryEvaluationAttempt,
  makeQueryEvaluationAttempt,
} from "./EvaluationAttempt.js";
export type { QueryEvaluationAttempt } from "./EvaluationAttempt.js";
import {
  addMetricContribution,
  calculateQuerySyncStateMetrics,
  emptyMetricContribution,
  firstQuerySyncStateMetricLimit,
  publicationLifecycleMetricContribution,
  queryMetricContribution,
  retainedPublicationMetricContribution,
  scopeMetricContribution,
} from "../transition-plan/Accounting.js";
import {
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
} from "../transition-plan/Limits.js";

export {
  MAX_AGGREGATE_DEPENDENCY_MEMBERSHIPS,
  MAX_COUNTED_CANONICAL_BYTES,
  MAX_REFERENCE_QUERIES,
  MAX_RETAINED_QUERY_IDENTITY_BYTES,
  PUBLICATION_SETTLEMENT_LIFECYCLE_BYTES,
} from "../transition-plan/Accounting.js";
export {
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
} from "../transition-plan/Limits.js";

export const MAX_INVALIDATION_KEYS = 65_536;
export const MAX_INVALIDATION_BATCH_BYTES = 16 * 1_024 * 1_024;
export const MAX_REFRESH_BATCHES = 65_536;
export const MAX_REFRESH_KEY_EXAMINATIONS = 65_536;
export const MAX_REFRESH_CANONICAL_BYTES = 16 * 1_024 * 1_024;


export interface NamespaceCursor {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly appliedThroughSequence: SyncSequence;
}

export interface NamespaceCursorInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly appliedThroughSequence: unknown;
}

export interface QueryDescriptor {
  readonly queryKey: CanonicalQueryKey;
  readonly queryIdentity: CanonicalQueryIdentity;
}

export interface QueryDescriptorInput {
  readonly queryKey: unknown;
  readonly queryIdentity: unknown;
}

export interface QueryOperationTarget {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
}

export interface QueryOperationTargetInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly descriptor: QueryDescriptorInput;
}

export interface AdmittedInvalidationBatch {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly sourceSequence: SyncSequence;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface AdmittedInvalidationBatchInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly sourceSequence: unknown;
  readonly dependencyKeys: unknown;
}

export interface QueryEvaluationEvidence {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly snapshotSequence: QuerySnapshot;
  readonly resultDigest: QueryResultDigest;
  readonly authorityWitness: QueryAuthorityWitness;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface QueryEvaluationEvidenceInput {
  readonly namespaceId: unknown;
  readonly syncModelId: unknown;
  readonly sourceEpoch: unknown;
  readonly descriptor: QueryDescriptorInput;
  readonly generation: unknown;
  readonly snapshotSequence: unknown;
  readonly resultDigest: unknown;
  readonly authorityWitness: unknown;
  readonly dependencyKeys: unknown;
}

interface GenerationRefreshEvidenceFields {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;
}

class AdmittedGenerationRefreshEvidence
  implements GenerationRefreshEvidenceFields
{
  declare private readonly admittedGenerationRefreshEvidence: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;

  constructor(input: GenerationRefreshEvidenceFields) {
    this.namespaceId = input.namespaceId;
    this.syncModelId = input.syncModelId;
    this.sourceEpoch = input.sourceEpoch;
    this.descriptor = freezeQueryDescriptor(input.descriptor);
    this.generation = input.generation;
    this.evaluationSnapshotSequence = input.evaluationSnapshotSequence;
    this.evaluationDependencyKeys = freezeDependencyKeys(
      input.evaluationDependencyKeys,
    );
    this.refreshedThroughSequence = input.refreshedThroughSequence;
    this.relevantThroughSequence = input.relevantThroughSequence;
    this.authorityWitness = input.authorityWitness;
    Object.freeze(this);
  }
}

export type GenerationRefreshEvidence = AdmittedGenerationRefreshEvidence;

export interface ProvisionalQueryState {
  readonly generation: QueryGeneration;
  readonly expectedActiveGeneration: QueryGeneration | null;
  readonly registrationCursor: NamespaceCursor;
  readonly requestedDirtyThroughSequence: SyncSequence | null;
  readonly evaluationDisposition: QueryEvaluationDisposition;
}

export type QueryEvaluationDisposition =
  | Readonly<{
    readonly _tag: "ready";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly reason: "terminalEvaluatorRefusal";
    readonly resetRequired: true;
  }>;

export interface QueryCompletionFingerprint {
  readonly identity: QueryPublicationIdentity;
  readonly queryIdentity: CanonicalQueryIdentity;
  readonly expectedActiveGeneration: QueryGeneration | null;
  readonly registrationCursor: NamespaceCursor;
  readonly requestedDirtyThroughSequence: SyncSequence | null;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly evaluationAuthorityWitness: QueryAuthorityWitness;
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly refreshAuthorityWitness: QueryAuthorityWitness;
  readonly resultDigest: QueryResultDigest;
  readonly publicationDisposition: QueryCompletionPublicationDisposition;
}

export interface ActiveQueryState {
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly freshThroughSequence: SyncSequence;
  readonly dirtyThroughSequence: SyncSequence | null;
  readonly resultDigest: QueryResultDigest;
  readonly authorityWitness: QueryAuthorityWitness;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface QueryState {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryState | null;
  readonly provisional: ProvisionalQueryState | null;
  readonly currentCompletion: QueryCompletionFingerprint | null;
  readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
}

export interface DependencyDirectoryEntry {
  readonly dependencyKey: CanonicalDependencyKey;
  readonly queryKeys: readonly CanonicalQueryKey[];
}

export interface QuerySyncEvaluationWorkState {
  readonly revision: QuerySyncWorkRevision;
  readonly fairnessAnchor: CanonicalQueryKey | null;
}

export type PublicationBlockReason =
  | "terminalPublisherRefusal"
  | "attemptLimitReached"
  | "ageLimitReached";

export type PublicationAttemptDisposition =
  | Readonly<{
    readonly _tag: "ready";
  }>
  | Readonly<{
    readonly _tag: "uncertain";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>;

export interface InFlightQueryPublication {
  readonly publication: PendingQueryPublication;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly firstAttemptAt: PublicationAttemptInstant;
  readonly lastAttemptAt: PublicationAttemptInstant;
  readonly disposition: PublicationAttemptDisposition;
}

export interface DeliveredQueryPublication {
  readonly identity: QueryPublicationIdentity;
  readonly resultDigest: QueryResultDigest;
}

export type PublicationAttemptOutcome =
  | "knownNotAppended"
  | "outcomeUnknown"
  | "terminalRefusal";

export type PublicationAttemptOutcomeReceiptCore =
  | Readonly<{
    readonly _tag: "recorded";
    readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
    readonly nextDisposition: "ready" | "uncertain";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>;

export interface PrecedingPublicationAttemptOutcome {
  readonly identity: QueryPublicationIdentity;
  readonly resultDigest: QueryResultDigest;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly outcome: PublicationAttemptOutcome;
  readonly receipt: PublicationAttemptOutcomeReceiptCore;
}

export interface QuerySyncPublicationWorkState {
  readonly pending: readonly PendingQueryPublication[];
  readonly inFlight: InFlightQueryPublication | null;
  readonly latestDelivered: DeliveredQueryPublication | null;
  readonly precedingAttemptOutcome: PrecedingPublicationAttemptOutcome | null;
}

export interface QuerySyncStateMetrics {
  readonly queryCount: number;
  readonly retainedIdentityBytes: number;
  readonly dependencyMemberships: number;
  readonly pendingPublicationCount: number;
  readonly inFlightPublicationCount: number;
  readonly retainedPublicationContentBytes: number;
  readonly settlementEnvelopeBytes: number;
  readonly countedCanonicalBytes: number;
}

export interface QuerySyncState {
  readonly cursor: NamespaceCursor;
  readonly queries: readonly QueryState[];
  readonly dependencyDirectory: readonly DependencyDirectoryEntry[];
  readonly evaluationWork: QuerySyncEvaluationWorkState;
  readonly publicationWork: QuerySyncPublicationWorkState;
  readonly metrics: QuerySyncStateMetrics;
}

export interface QuerySyncStateBuildInput {
  readonly cursor: NamespaceCursor;
  readonly queries: readonly QueryState[];
  readonly evaluationWork: QuerySyncEvaluationWorkState;
  readonly publicationWork: QuerySyncPublicationWorkState;
}

export interface QuerySyncStatePatch {
  readonly cursor?: NamespaceCursor;
  readonly queries?: readonly QueryState[];
  readonly evaluationWork?: QuerySyncEvaluationWorkState;
  readonly publicationWork?: QuerySyncPublicationWorkState;
}

export interface BeginQueryEvaluationRequest {
  readonly target: QueryOperationTarget;
  readonly expectedActiveGeneration: QueryGeneration | null;
  readonly requestedDirtyThroughSequence: SyncSequence | null;
}

export type SequenceDecision =
  | Readonly<{
    readonly _tag: "duplicate";
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "exactNext";
    readonly nextSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "gap";
    readonly expectedSequence: SyncSequence;
    readonly observedSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "resetRequired";
    readonly expectedSourceEpoch: SyncEpoch;
    readonly observedSourceEpoch: SyncEpoch;
  }>;

type StateBearingDecision<Receipt> = Receipt extends unknown
  ? Readonly<Receipt & { readonly state: QuerySyncState }>
  : never;

export type BeginQueryEvaluationDecision =
  StateBearingDecision<BeginQueryEvaluationReceipt>;

export type ApplyInvalidationsDecision =
  StateBearingDecision<ApplyAdmittedBatchReceipt>;


export type CompleteQueryEvaluationDecision =
  StateBearingDecision<CompleteQueryEvaluationReceipt>;

export type CaptureNamespaceCursorError = QuerySyncCanonicalValueError;
export type CaptureQueryDescriptorError = QuerySyncCanonicalValueError;
export type CaptureInvalidationBatchError =
  | QuerySyncCanonicalValueError
  | QueryDependencyLimitError<"captureInvalidationBatch">;
export type CaptureEvaluationEvidenceError =
  | QuerySyncCanonicalValueError
  | QueryDependencyLimitError<"captureEvaluationEvidence">;
export type BuildQuerySyncStateError =
  | QueryKeyCollisionError<"buildQuerySyncState">
  | QuerySyncStateLimitError;

const READY_QUERY_EVALUATION_DISPOSITION = Object.freeze({
  _tag: "ready" as const,
});

const READY_PUBLICATION_ATTEMPT_DISPOSITION = Object.freeze({
  _tag: "ready" as const,
});

const UNCERTAIN_PUBLICATION_ATTEMPT_DISPOSITION = Object.freeze({
  _tag: "uncertain" as const,
});

export function readyQueryEvaluationDisposition(): QueryEvaluationDisposition {
  return READY_QUERY_EVALUATION_DISPOSITION;
}

export function blockedQueryEvaluationDisposition(): QueryEvaluationDisposition {
  return Object.freeze({
    _tag: "blocked",
    reason: "terminalEvaluatorRefusal",
    resetRequired: true,
  });
}

export function readyPublicationAttemptDisposition(): PublicationAttemptDisposition {
  return READY_PUBLICATION_ATTEMPT_DISPOSITION;
}

export function uncertainPublicationAttemptDisposition(): PublicationAttemptDisposition {
  return UNCERTAIN_PUBLICATION_ATTEMPT_DISPOSITION;
}

export function blockedPublicationAttemptDisposition(
  reason: PublicationBlockReason,
): PublicationAttemptDisposition {
  return Object.freeze({
    _tag: "blocked",
    reason,
    resetRequired: true,
  });
}

function freezeNamespaceCursor(cursor: NamespaceCursor): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

function freezeQueryDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezeDependencyKeys(
  dependencyKeys: readonly CanonicalDependencyKey[],
): readonly CanonicalDependencyKey[] {
  return Object.freeze([...dependencyKeys]);
}

function freezeProvisionalQueryState(
  provisional: ProvisionalQueryState,
): ProvisionalQueryState {
  return Object.freeze({
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: freezeNamespaceCursor(provisional.registrationCursor),
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
    evaluationDisposition: provisional.evaluationDisposition._tag === "ready"
      ? readyQueryEvaluationDisposition()
      : blockedQueryEvaluationDisposition(),
  });
}

function freezeQueryCompletionFingerprint(
  completion: QueryCompletionFingerprint,
): QueryCompletionFingerprint {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(completion.identity),
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: freezeNamespaceCursor(completion.registrationCursor),
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
    evaluationSnapshotSequence: completion.evaluationSnapshotSequence,
    evaluationDependencyKeys: freezeDependencyKeys(
      completion.evaluationDependencyKeys,
    ),
    evaluationAuthorityWitness: completion.evaluationAuthorityWitness,
    refreshedThroughSequence: completion.refreshedThroughSequence,
    relevantThroughSequence: completion.relevantThroughSequence,
    refreshAuthorityWitness: completion.refreshAuthorityWitness,
    resultDigest: completion.resultDigest,
    publicationDisposition: freezePublicationDisposition(
      completion.publicationDisposition,
    ),
  });
}

function freezeActiveQueryState(active: ActiveQueryState): ActiveQueryState {
  return Object.freeze({
    generation: active.generation,
    evaluationSnapshotSequence: active.evaluationSnapshotSequence,
    freshThroughSequence: active.freshThroughSequence,
    dirtyThroughSequence: active.dirtyThroughSequence,
    resultDigest: active.resultDigest,
    authorityWitness: active.authorityWitness,
    dependencyKeys: freezeDependencyKeys(active.dependencyKeys),
  });
}

function freezeQueryState(query: QueryState): QueryState {
  return Object.freeze({
    descriptor: freezeQueryDescriptor(query.descriptor),
    active: query.active === null ? null : freezeActiveQueryState(query.active),
    provisional: query.provisional === null
      ? null
      : freezeProvisionalQueryState(query.provisional),
    currentCompletion: query.currentCompletion === null
      ? null
      : freezeQueryCompletionFingerprint(query.currentCompletion),
    precedingCompletionIdentity: query.precedingCompletionIdentity === null
      ? null
      : freezeQueryPublicationIdentity(query.precedingCompletionIdentity),
  });
}

function freezeEvaluationWorkState(
  evaluationWork: QuerySyncEvaluationWorkState,
): QuerySyncEvaluationWorkState {
  return Object.freeze({
    revision: evaluationWork.revision,
    fairnessAnchor: evaluationWork.fairnessAnchor,
  });
}

function freezePublicationAttemptDisposition(
  disposition: PublicationAttemptDisposition,
): PublicationAttemptDisposition {
  switch (disposition._tag) {
    case "ready":
      return readyPublicationAttemptDisposition();
    case "uncertain":
      return uncertainPublicationAttemptDisposition();
    case "blocked":
      return blockedPublicationAttemptDisposition(disposition.reason);
  }
}

function freezeInFlightQueryPublication(
  inFlight: InFlightQueryPublication,
): InFlightQueryPublication {
  return Object.freeze({
    publication: makePendingQueryPublication(inFlight.publication),
    attemptOrdinal: inFlight.attemptOrdinal,
    firstAttemptAt: inFlight.firstAttemptAt,
    lastAttemptAt: inFlight.lastAttemptAt,
    disposition: freezePublicationAttemptDisposition(inFlight.disposition),
  });
}

function freezeDeliveredQueryPublication(
  delivered: DeliveredQueryPublication,
): DeliveredQueryPublication {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(delivered.identity),
    resultDigest: delivered.resultDigest,
  });
}

function freezePublicationAttemptOutcomeReceiptCore(
  receipt: PublicationAttemptOutcomeReceiptCore,
): PublicationAttemptOutcomeReceiptCore {
  return receipt._tag === "recorded"
    ? Object.freeze({
      _tag: "recorded",
      nextAttemptOrdinal: receipt.nextAttemptOrdinal,
      nextDisposition: receipt.nextDisposition,
    })
    : Object.freeze({
      _tag: "blocked",
      reason: receipt.reason,
      resetRequired: true,
    });
}

function freezePrecedingPublicationAttemptOutcome(
  preceding: PrecedingPublicationAttemptOutcome,
): PrecedingPublicationAttemptOutcome {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(preceding.identity),
    resultDigest: preceding.resultDigest,
    attemptOrdinal: preceding.attemptOrdinal,
    outcome: preceding.outcome,
    receipt: freezePublicationAttemptOutcomeReceiptCore(preceding.receipt),
  });
}

function freezePublicationWorkState(
  publicationWork: QuerySyncPublicationWorkState,
): QuerySyncPublicationWorkState {
  const pending = publicationWork.pending.map(makePendingQueryPublication);
  pending.sort((left, right) => compareQueryPublicationIdentity(
    left.identity,
    right.identity,
  ));
  return Object.freeze({
    pending: Object.freeze(pending),
    inFlight: publicationWork.inFlight === null
      ? null
      : freezeInFlightQueryPublication(publicationWork.inFlight),
    latestDelivered: publicationWork.latestDelivered === null
      ? null
      : freezeDeliveredQueryPublication(publicationWork.latestDelivered),
    precedingAttemptOutcome:
      publicationWork.precedingAttemptOutcome === null
        ? null
        : freezePrecedingPublicationAttemptOutcome(
          publicationWork.precedingAttemptOutcome,
        ),
  });
}

function dependencyLimitError<Operation extends QueryDependencyLimitOperation>(
  operation: Operation,
  dimension: QueryDependencyLimitError["dimension"],
  maximum: number,
  observed: number,
): QueryDependencyLimitError<Operation> {
  return new QueryDependencyLimitError<Operation>({
    operation,
    dimension,
    maximum,
    observed,
  });
}

function normalizeDependencyKeys<
  Operation extends QueryDependencyLimitOperation,
>(
  input: unknown,
  operation: Operation,
  maximumEntries: number,
  maximumDecodedBytes: number,
): Result.Result<
  readonly CanonicalDependencyKey[],
  QuerySyncCanonicalValueError | QueryDependencyLimitError<Operation>
> {
  if (!Array.isArray(input)) {
    return Result.fail(new QuerySyncCanonicalValueError({
      field: "dependencyKey",
      reason: "invalidType",
      maximum: null,
      observed: null,
    }));
  }
  const dependencyInputs: readonly unknown[] = input;
  const inputLength = dependencyInputs.length;
  if (inputLength > maximumEntries) {
    return Result.fail(dependencyLimitError(
      operation,
      "rawEntries",
      maximumEntries,
      inputLength,
    ));
  }

  return Result.gen(function* () {
    const captured = new Set<CanonicalDependencyKey>();
    const admittedSpellings = new Set<string>();
    let decodedBytes = 0;
    for (let index = 0; index < inputLength; index += 1) {
      const rawDependencyKey = dependencyInputs[index];
      if (
        typeof rawDependencyKey === "string"
        && admittedSpellings.has(rawDependencyKey)
      ) {
        continue;
      }
      const dependencyKey = yield* captureCanonicalDependencyKey(
        rawDependencyKey,
      );
      admittedSpellings.add(dependencyKey);
      decodedBytes += canonicalBase64UrlDecodedLength(dependencyKey);
      if (decodedBytes > maximumDecodedBytes) {
        return yield* Result.fail(dependencyLimitError(
          operation,
          "decodedBytes",
          maximumDecodedBytes,
          decodedBytes,
        ));
      }
      captured.add(dependencyKey);
      if (captured.size > maximumEntries) {
        return yield* Result.fail(dependencyLimitError(
          operation,
          "distinctEntries",
          maximumEntries,
          captured.size,
        ));
      }
    }
    const normalized = [...captured];
    normalized.sort(compareCanonicalBase64Url);
    return freezeDependencyKeys(normalized);
  });
}

export function captureNamespaceCursor(
  input: NamespaceCursorInput,
): Result.Result<NamespaceCursor, CaptureNamespaceCursorError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const appliedThroughSequence = yield* captureSyncSequence(
      input.appliedThroughSequence,
    );
    return freezeNamespaceCursor({
      namespaceId,
      syncModelId,
      sourceEpoch,
      appliedThroughSequence,
    });
  });
}

export function captureQueryDescriptor(
  input: QueryDescriptorInput,
): Result.Result<QueryDescriptor, CaptureQueryDescriptorError> {
  return Result.gen(function* () {
    const queryKey = yield* captureCanonicalQueryKey(input.queryKey);
    const queryIdentity = yield* captureCanonicalQueryIdentity(
      input.queryIdentity,
    );
    return freezeQueryDescriptor({ queryKey, queryIdentity });
  });
}

export function captureQueryOperationTarget(
  input: QueryOperationTargetInput,
): Result.Result<QueryOperationTarget, QuerySyncCanonicalValueError> {
  return Result.gen(function* () {
    const capturedNamespaceId = yield* captureSyncNamespaceId(
      input.namespaceId,
    );
    const capturedSyncModelId = yield* captureSyncModelId(input.syncModelId);
    const capturedSourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const capturedDescriptor = yield* captureQueryDescriptor(input.descriptor);
    return Object.freeze({
      namespaceId: capturedNamespaceId,
      syncModelId: capturedSyncModelId,
      sourceEpoch: capturedSourceEpoch,
      descriptor: capturedDescriptor,
    });
  });
}

export function captureAdmittedInvalidationBatch(
  input: AdmittedInvalidationBatchInput,
): Result.Result<AdmittedInvalidationBatch, CaptureInvalidationBatchError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const sourceSequence = yield* captureSyncSequence(input.sourceSequence);
    const dependencyKeys = yield* normalizeDependencyKeys(
      input.dependencyKeys,
      "captureInvalidationBatch",
      MAX_INVALIDATION_KEYS,
      MAX_INVALIDATION_BATCH_BYTES,
    );
    return Object.freeze({
      namespaceId,
      syncModelId,
      sourceEpoch,
      sourceSequence,
      dependencyKeys,
    });
  });
}

export function captureQueryEvaluationEvidence(
  input: QueryEvaluationEvidenceInput,
): Result.Result<QueryEvaluationEvidence, CaptureEvaluationEvidenceError> {
  return Result.gen(function* () {
    const namespaceId = yield* captureSyncNamespaceId(input.namespaceId);
    const syncModelId = yield* captureSyncModelId(input.syncModelId);
    const sourceEpoch = yield* captureSyncEpoch(input.sourceEpoch);
    const descriptor = yield* captureQueryDescriptor(input.descriptor);
    const generation = yield* captureQueryGeneration(input.generation);
    const snapshotSequence = yield* captureQuerySnapshot(
      input.snapshotSequence,
    );
    const resultDigest = yield* captureQueryResultDigest(input.resultDigest);
    const authorityWitness = yield* captureQueryAuthorityWitness(
      input.authorityWitness,
    );
    const dependencyKeys = yield* normalizeDependencyKeys(
      input.dependencyKeys,
      "captureEvaluationEvidence",
      MAX_QUERY_DEPENDENCY_KEYS,
      MAX_QUERY_DEPENDENCY_BYTES,
    );
    return Object.freeze({
      namespaceId,
      syncModelId,
      sourceEpoch,
      descriptor,
      generation,
      snapshotSequence,
      resultDigest,
      authorityWitness,
      dependencyKeys,
    });
  });
}

export function createEmptyQuerySyncState(
  cursor: NamespaceCursor,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  return buildQuerySyncState({
    cursor,
    queries: [],
    evaluationWork: {
      revision: initialQuerySyncWorkRevision(),
      fairnessAnchor: null,
    },
    publicationWork: {
      pending: [],
      inFlight: null,
      latestDelivered: null,
      precedingAttemptOutcome: null,
    },
  });
}

function stateInvariantDefect(
  invariant: QuerySyncInvariantDefect["invariant"],
): QuerySyncInvariantDefect {
  return new QuerySyncInvariantDefect({
    operation: "buildQuerySyncState",
    invariant,
  });
}

function publicationIdentityMatchesQuery(
  cursor: NamespaceCursor,
  query: QueryState,
  identity: QueryPublicationIdentity,
): boolean {
  return identity.namespaceId === cursor.namespaceId
    && identity.syncModelId === cursor.syncModelId
    && identity.sourceEpoch === cursor.sourceEpoch
    && identity.queryKey === query.descriptor.queryKey;
}

function completionMatchesActive(
  active: ActiveQueryState,
  completion: QueryCompletionFingerprint,
): boolean {
  if (
    completion.identity.generation !== active.generation
    || completion.evaluationSnapshotSequence
      !== active.evaluationSnapshotSequence
    || completion.refreshedThroughSequence !== active.freshThroughSequence
    || completion.relevantThroughSequence !== null
    || completion.evaluationAuthorityWitness !== active.authorityWitness
    || completion.refreshAuthorityWitness !== active.authorityWitness
    || completion.resultDigest !== active.resultDigest
    || completion.evaluationDependencyKeys.length
      !== active.dependencyKeys.length
  ) {
    return false;
  }
  for (let index = 0; index < active.dependencyKeys.length; index += 1) {
    if (
      completion.evaluationDependencyKeys[index]
      !== active.dependencyKeys[index]
    ) {
      return false;
    }
  }
  return true;
}

function assertQueryStateInvariants(
  cursor: NamespaceCursor,
  query: QueryState,
): void {
  if (query.active === null && query.provisional === null) {
    throw stateInvariantDefect("emptyQuerySlots");
  }
  if (query.active === null && query.currentCompletion !== null) {
    throw stateInvariantDefect("completionWithoutActive");
  }
  if (query.active !== null && query.currentCompletion === null) {
    throw stateInvariantDefect("activeCompletionMissing");
  }
  if (query.provisional !== null) {
    const registration = query.provisional.registrationCursor;
    if (
      registration.namespaceId !== cursor.namespaceId
      || registration.syncModelId !== cursor.syncModelId
      || registration.sourceEpoch !== cursor.sourceEpoch
    ) {
      throw stateInvariantDefect("provisionalRegistrationAuthorityMismatch");
    }
    if (registration.appliedThroughSequence > cursor.appliedThroughSequence) {
      throw stateInvariantDefect("provisionalRegistrationAheadOfCursor");
    }
    if (query.active === null && query.provisional.generation !== 1n) {
      throw stateInvariantDefect("initialProvisionalGenerationNotOne");
    }
    if (
      query.active === null
      && query.provisional.expectedActiveGeneration !== null
    ) {
      throw stateInvariantDefect("initialProvisionalFenceNotNull");
    }
    if (
      query.active === null
      && query.provisional.requestedDirtyThroughSequence !== null
    ) {
      throw stateInvariantDefect("initialProvisionalDirtyFrontierNotNull");
    }
    if (
      query.active !== null
      && query.provisional.generation <= query.active.generation
    ) {
      throw stateInvariantDefect("provisionalGenerationNotAfterActive");
    }
    if (query.active !== null) {
      if (
        successorQueryGeneration(query.active.generation)
        !== query.provisional.generation
      ) {
        throw stateInvariantDefect("provisionalGenerationNotSuccessor");
      }
      if (
        query.provisional.expectedActiveGeneration
        !== query.active.generation
      ) {
        throw stateInvariantDefect("provisionalFenceMismatch");
      }
      const requestedDirty =
        query.provisional.requestedDirtyThroughSequence;
      if (requestedDirty === null) {
        throw stateInvariantDefect("provisionalDirtyFrontierMissing");
      }
      if (requestedDirty <= query.active.freshThroughSequence) {
        throw stateInvariantDefect(
          "provisionalDirtyFrontierNotAfterFreshness",
        );
      }
      if (
        query.active.dirtyThroughSequence === null
        || requestedDirty > query.active.dirtyThroughSequence
      ) {
        throw stateInvariantDefect(
          "provisionalDirtyFrontierAheadOfObservedDirty",
        );
      }
    }
  }
  if (query.active === null) {
    if (query.precedingCompletionIdentity !== null) {
      throw stateInvariantDefect("completionPrecedingIdentityInvalid");
    }
    return;
  }
  if (
    query.active.evaluationSnapshotSequence
    > query.active.freshThroughSequence
  ) {
    throw stateInvariantDefect("activeSnapshotAfterFreshness");
  }
  if (query.active.freshThroughSequence > cursor.appliedThroughSequence) {
    throw stateInvariantDefect("activeFreshnessAheadOfCursor");
  }
  if (query.active.dirtyThroughSequence !== null) {
    if (
      query.active.dirtyThroughSequence <= query.active.freshThroughSequence
    ) {
      throw stateInvariantDefect("activeDirtyNotAfterFreshness");
    }
    if (
      query.active.dirtyThroughSequence > cursor.appliedThroughSequence
    ) {
      throw stateInvariantDefect("activeDirtyAheadOfCursor");
    }
  }
  if (query.active.dependencyKeys.length > MAX_QUERY_DEPENDENCY_KEYS) {
    throw stateInvariantDefect("activeDependencyCountExceeded");
  }

  let dependencyBytes = 0;
  let previousDependencyKey: CanonicalDependencyKey | undefined;
  for (const dependencyKey of query.active.dependencyKeys) {
    if (
      previousDependencyKey !== undefined
      && compareCanonicalBase64Url(previousDependencyKey, dependencyKey) >= 0
    ) {
      throw stateInvariantDefect("activeDependenciesNotCanonicalSet");
    }
    previousDependencyKey = dependencyKey;
    dependencyBytes += canonicalBase64UrlDecodedLength(dependencyKey);
    if (dependencyBytes > MAX_QUERY_DEPENDENCY_BYTES) {
      throw stateInvariantDefect("activeDependencyBytesExceeded");
    }
  }

  const completion = query.currentCompletion;
  if (completion === null) {
    throw stateInvariantDefect("activeCompletionMissing");
  }
  if (
    !publicationIdentityMatchesQuery(cursor, query, completion.identity)
    || completion.queryIdentity !== query.descriptor.queryIdentity
  ) {
    throw stateInvariantDefect("completionIdentityMismatch");
  }
  if (!completionMatchesActive(query.active, completion)) {
    throw stateInvariantDefect("completionActiveStateMismatch");
  }
  const completionRegistration = completion.registrationCursor;
  if (
    completionRegistration.namespaceId !== cursor.namespaceId
    || completionRegistration.syncModelId !== cursor.syncModelId
    || completionRegistration.sourceEpoch !== cursor.sourceEpoch
  ) {
    throw stateInvariantDefect("completionRegistrationAuthorityMismatch");
  }
  if (
    completionRegistration.appliedThroughSequence
    > cursor.appliedThroughSequence
  ) {
    throw stateInvariantDefect("completionRegistrationAheadOfCursor");
  }
  if (
    completionRegistration.appliedThroughSequence
    > completion.evaluationSnapshotSequence
  ) {
    throw stateInvariantDefect("completionSnapshotBeforeRegistration");
  }
  if (completion.expectedActiveGeneration === null) {
    if (
      completion.identity.generation !== 1n
      || completion.requestedDirtyThroughSequence !== null
      || query.precedingCompletionIdentity !== null
    ) {
      throw stateInvariantDefect("completionPrecedingIdentityInvalid");
    }
  } else if (
    query.precedingCompletionIdentity === null
    || !publicationIdentityMatchesQuery(
      cursor,
      query,
      query.precedingCompletionIdentity,
    )
    || query.precedingCompletionIdentity.generation
      !== completion.expectedActiveGeneration
    || successorQueryGeneration(completion.expectedActiveGeneration)
      !== completion.identity.generation
    || completion.requestedDirtyThroughSequence === null
    || completion.requestedDirtyThroughSequence
      > completion.evaluationSnapshotSequence
  ) {
    throw stateInvariantDefect("completionPrecedingIdentityInvalid");
  }
  if (
    completion.publicationDisposition._tag === "pending"
    && !queryPublicationIdentityEquals(
      completion.publicationDisposition.identity,
      completion.identity,
    )
  ) {
    throw stateInvariantDefect("completionIdentityMismatch");
  }
}

export function buildQuerySyncState(
  input: QuerySyncStateBuildInput,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  const queryCountLimit = firstQuerySyncStateMetricLimit(Object.freeze({
    ...emptyMetricContribution(),
    queryCount: input.queries.length,
  }));
  if (queryCountLimit !== null) return Result.fail(queryCountLimit);
  const calculatedMetrics = calculateQuerySyncStateMetrics(input);
  return buildQuerySyncStateWithValidatedMetrics(
    input,
    calculatedMetrics,
    firstQuerySyncStateMetricLimit(calculatedMetrics),
  );
}

function winningMetricLimitReached(
  limit: QuerySyncStateLimitError | null,
  metrics: QuerySyncStateMetrics,
  dimensions: readonly QuerySyncStateLimitError["dimension"][],
): limit is QuerySyncStateLimitError {
  return limit !== null
    && dimensions.includes(limit.dimension)
    && metrics[limit.dimension] > limit.maximum;
}

function buildQuerySyncStateWithValidatedMetrics(
  input: QuerySyncStateBuildInput,
  calculatedMetrics: QuerySyncStateMetrics,
  winningMetricLimit: QuerySyncStateLimitError | null,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  const cursor = input.cursor;
  const queryStates = input.queries;
  const evaluationWork = input.evaluationWork;
  const publicationWork = input.publicationWork;
  const observedQueryKeys = new Set<CanonicalQueryKey>();
  const queryByKey = new Map<CanonicalQueryKey, QueryState>();
  let observedMetrics = scopeMetricContribution(cursor, evaluationWork);

  if (
    typeof evaluationWork.revision !== "bigint"
    || evaluationWork.revision < 0n
    || evaluationWork.revision > MAX_QUERY_SYNC_WORK_REVISION
  ) {
    throw stateInvariantDefect("workRevisionInvalid");
  }

  for (const query of queryStates) {
    assertQueryStateInvariants(cursor, query);
    if (observedQueryKeys.has(query.descriptor.queryKey)) {
      return Result.fail(new QueryKeyCollisionError<"buildQuerySyncState">({
        operation: "buildQuerySyncState",
        queryKey: query.descriptor.queryKey,
      }));
    }
    observedQueryKeys.add(query.descriptor.queryKey);
    queryByKey.set(query.descriptor.queryKey, query);

    if (query.provisional !== null) {
      if (
        query.provisional.evaluationDisposition._tag !== "ready"
        && query.provisional.evaluationDisposition._tag !== "blocked"
      ) {
        throw stateInvariantDefect("evaluationDispositionInvalid");
      }
      if (query.provisional.evaluationDisposition._tag === "blocked") {
        if (
          query.provisional.evaluationDisposition.reason
            !== "terminalEvaluatorRefusal"
          || query.provisional.evaluationDisposition.resetRequired !== true
        ) {
          throw stateInvariantDefect("evaluationDispositionInvalid");
        }
      }
    }
    observedMetrics = addMetricContribution(
      observedMetrics,
      queryMetricContribution(query),
    );
    if (winningMetricLimitReached(
      winningMetricLimit,
      observedMetrics,
      [
        "retainedIdentityBytes",
        "dependencyMemberships",
        "countedCanonicalBytes",
      ],
    )) {
      return Result.fail(winningMetricLimit);
    }
  }

  if (
    evaluationWork.fairnessAnchor !== null
    && !observedQueryKeys.has(evaluationWork.fairnessAnchor)
  ) {
    throw stateInvariantDefect("fairnessAnchorQueryMissing");
  }

  if (winningMetricLimitReached(
    winningMetricLimit,
    calculatedMetrics,
    ["pendingPublicationCount"],
  )) {
    return Result.fail(winningMetricLimit);
  }

  const pendingByQuery = new Map<CanonicalQueryKey, PendingQueryPublication>();
  const validatePublicationIdentity = (
    identity: QueryPublicationIdentity,
  ): QueryState => {
    if (
      identity.namespaceId !== cursor.namespaceId
      || identity.syncModelId !== cursor.syncModelId
      || identity.sourceEpoch !== cursor.sourceEpoch
    ) {
      throw stateInvariantDefect("publicationWorkAuthorityMismatch");
    }
    const query = queryByKey.get(identity.queryKey);
    if (query === undefined || query.active === null) {
      throw stateInvariantDefect("publicationWorkQueryMissing");
    }
    if (identity.generation > query.active.generation) {
      throw stateInvariantDefect("publicationWorkGenerationAhead");
    }
    return query;
  };
  const validatePublication = (
    publication: PendingQueryPublication,
    kind: "pending" | "inFlight",
  ): QueryState => {
    const identity = publication.identity;
    const query = validatePublicationIdentity(identity);
    const active = query.active;
    if (active === null) {
      throw stateInvariantDefect("publicationWorkQueryMissing");
    }
    if (
      publication.queryIdentity !== query.descriptor.queryIdentity
      || publication.completedThroughSequence > cursor.appliedThroughSequence
      || publication.completedThroughSequence > active.freshThroughSequence
    ) {
      throw stateInvariantDefect("publicationWorkIdentityMismatch");
    }
    if (
      kind === "pending"
      && publication.resultDigest !== active.resultDigest
    ) {
      throw stateInvariantDefect("publicationWorkIdentityMismatch");
    }
    if (identity.generation === active.generation) {
      const completion = query.currentCompletion;
      if (
        completion === null
        || completion.publicationDisposition._tag !== "pending"
        || !queryPublicationIdentityEquals(completion.identity, identity)
        || publication.completedThroughSequence
          !== completion.refreshedThroughSequence
        || publication.resultDigest !== completion.resultDigest
      ) {
        throw stateInvariantDefect("publicationWorkIdentityMismatch");
      }
    }
    return query;
  };
  for (const publication of publicationWork.pending) {
    const identity = publication.identity;
    validatePublication(publication, "pending");
    if (pendingByQuery.has(identity.queryKey)) {
      throw stateInvariantDefect("publicationWorkDuplicateQuery");
    }

    pendingByQuery.set(identity.queryKey, publication);
    observedMetrics = addMetricContribution(
      observedMetrics,
      retainedPublicationMetricContribution(publication, "pending"),
    );
    if (winningMetricLimitReached(
      winningMetricLimit,
      observedMetrics,
      ["countedCanonicalBytes"],
    )) {
      return Result.fail(winningMetricLimit);
    }
  }

  const inFlight = publicationWork.inFlight;
  if (inFlight !== null) {
    const publication = inFlight.publication;
    validatePublication(publication, "inFlight");
    for (const pending of publicationWork.pending) {
      if (queryPublicationIdentityEquals(
        pending.identity,
        publication.identity,
      )) {
        throw stateInvariantDefect("publicationWorkIdentityDuplicated");
      }
      if (
        pending.identity.queryKey === publication.identity.queryKey
        && pending.identity.generation <= publication.identity.generation
      ) {
        throw stateInvariantDefect("publicationWorkQueuedGenerationInvalid");
      }
    }
    if (
      typeof inFlight.attemptOrdinal !== "number"
      || !Number.isSafeInteger(inFlight.attemptOrdinal)
      || inFlight.attemptOrdinal < 1
      || inFlight.attemptOrdinal > MAX_PUBLICATION_ATTEMPT_ORDINAL
    ) {
      throw stateInvariantDefect("publicationAttemptStateInvalid");
    }
    if (
      typeof inFlight.firstAttemptAt !== "number"
      || !Number.isSafeInteger(inFlight.firstAttemptAt)
      || inFlight.firstAttemptAt < 0
      || inFlight.firstAttemptAt > MAX_PUBLICATION_ATTEMPT_INSTANT
      || typeof inFlight.lastAttemptAt !== "number"
      || !Number.isSafeInteger(inFlight.lastAttemptAt)
      || inFlight.lastAttemptAt < inFlight.firstAttemptAt
      || inFlight.lastAttemptAt > MAX_PUBLICATION_ATTEMPT_INSTANT
    ) {
      throw stateInvariantDefect("publicationAttemptTimeInvalid");
    }
    if (
      inFlight.disposition._tag !== "ready"
      && inFlight.disposition._tag !== "uncertain"
      && inFlight.disposition._tag !== "blocked"
    ) {
      throw stateInvariantDefect("publicationAttemptStateInvalid");
    }
    if (
      inFlight.disposition._tag === "blocked"
      && (
        ![
          "terminalPublisherRefusal",
          "attemptLimitReached",
          "ageLimitReached",
        ].includes(inFlight.disposition.reason)
        || inFlight.disposition.resetRequired !== true
      )
    ) {
      throw stateInvariantDefect("publicationAttemptStateInvalid");
    }
    observedMetrics = addMetricContribution(
      observedMetrics,
      retainedPublicationMetricContribution(publication, "inFlight"),
    );
  }

  if (winningMetricLimitReached(
    winningMetricLimit,
    observedMetrics,
    ["retainedPublicationContentBytes"],
  )) {
    return Result.fail(winningMetricLimit);
  }

  const latestDelivered = publicationWork.latestDelivered;
  if (latestDelivered !== null) {
    const query = validatePublicationIdentity(latestDelivered.identity);
    const active = query.active;
    if (active === null) {
      throw stateInvariantDefect("publicationDeliveredStateInvalid");
    }
    if (latestDelivered.identity.generation === active.generation) {
      const completion = query.currentCompletion;
      if (
        completion === null
        || !queryPublicationIdentityEquals(
          latestDelivered.identity,
          completion.identity,
        )
        || latestDelivered.resultDigest !== completion.resultDigest
        || latestDelivered.resultDigest !== active.resultDigest
      ) {
        throw stateInvariantDefect("publicationDeliveredStateInvalid");
      }
    }
    if (
      inFlight !== null
      && queryPublicationIdentityEquals(
        latestDelivered.identity,
        inFlight.publication.identity,
      )
    ) {
      throw stateInvariantDefect("publicationWorkIdentityDuplicated");
    }
    for (const pending of publicationWork.pending) {
      if (
        queryPublicationIdentityEquals(
          latestDelivered.identity,
          pending.identity,
        )
        || (
          latestDelivered.identity.queryKey === pending.identity.queryKey
          && pending.identity.generation <= latestDelivered.identity.generation
        )
      ) {
        throw stateInvariantDefect("publicationLifecycleLinkInvalid");
      }
    }
    if (
      inFlight !== null
      && latestDelivered.identity.queryKey
        === inFlight.publication.identity.queryKey
      && inFlight.publication.identity.generation
        <= latestDelivered.identity.generation
    ) {
      throw stateInvariantDefect("publicationLifecycleLinkInvalid");
    }
  }

  const precedingAttemptOutcome = publicationWork.precedingAttemptOutcome;
  if (precedingAttemptOutcome !== null) {
    validatePublicationIdentity(precedingAttemptOutcome.identity);
    if (
      typeof precedingAttemptOutcome.attemptOrdinal !== "number"
      || !Number.isSafeInteger(precedingAttemptOutcome.attemptOrdinal)
      || precedingAttemptOutcome.attemptOrdinal < 1
      || precedingAttemptOutcome.attemptOrdinal
        > MAX_PUBLICATION_ATTEMPT_ORDINAL
    ) {
      throw stateInvariantDefect("publicationOutcomeStateInvalid");
    }
    if (
      precedingAttemptOutcome.outcome !== "knownNotAppended"
      && precedingAttemptOutcome.outcome !== "outcomeUnknown"
      && precedingAttemptOutcome.outcome !== "terminalRefusal"
    ) {
      throw stateInvariantDefect("publicationOutcomeStateInvalid");
    }

    const receipt = precedingAttemptOutcome.receipt;
    if (receipt._tag === "recorded") {
      const expectedNextOrdinal = precedingAttemptOutcome.attemptOrdinal + 1;
      const expectedDisposition = precedingAttemptOutcome.outcome
          === "knownNotAppended"
        ? "ready"
        : "uncertain";
      if (
        precedingAttemptOutcome.outcome === "terminalRefusal"
        || precedingAttemptOutcome.attemptOrdinal
          === MAX_PUBLICATION_ATTEMPT_ORDINAL
        || receipt.nextAttemptOrdinal !== expectedNextOrdinal
        || receipt.nextDisposition !== expectedDisposition
      ) {
        throw stateInvariantDefect("publicationOutcomeReceiptInvalid");
      }
    } else if (receipt._tag === "blocked") {
      const expectedReason: PublicationBlockReason =
        precedingAttemptOutcome.outcome === "terminalRefusal"
          ? "terminalPublisherRefusal"
          : precedingAttemptOutcome.attemptOrdinal
              === MAX_PUBLICATION_ATTEMPT_ORDINAL
          ? "attemptLimitReached"
          : "ageLimitReached";
      if (
        receipt.reason !== expectedReason
        || receipt.resetRequired !== true
      ) {
        throw stateInvariantDefect("publicationOutcomeReceiptInvalid");
      }
    } else {
      throw stateInvariantDefect("publicationOutcomeReceiptInvalid");
    }

    for (const pending of publicationWork.pending) {
      if (queryPublicationIdentityEquals(
        precedingAttemptOutcome.identity,
        pending.identity,
      )) {
        throw stateInvariantDefect("publicationLifecycleLinkInvalid");
      }
    }

    if (
      latestDelivered !== null
      && queryPublicationIdentityEquals(
        precedingAttemptOutcome.identity,
        latestDelivered.identity,
      )
      && precedingAttemptOutcome.resultDigest !== latestDelivered.resultDigest
    ) {
      throw stateInvariantDefect("publicationLifecycleLinkInvalid");
    }

    if (
      inFlight !== null
      && queryPublicationIdentityEquals(
        precedingAttemptOutcome.identity,
        inFlight.publication.identity,
      )
    ) {
      if (
        precedingAttemptOutcome.resultDigest
          !== inFlight.publication.resultDigest
      ) {
        throw stateInvariantDefect("publicationLifecycleLinkInvalid");
      }
      if (receipt._tag === "recorded") {
        const dispositionMatches = inFlight.disposition._tag === "blocked"
          ? inFlight.disposition.reason === "ageLimitReached"
          : inFlight.disposition._tag === receipt.nextDisposition;
        if (
          inFlight.attemptOrdinal !== receipt.nextAttemptOrdinal
          || !dispositionMatches
        ) {
          throw stateInvariantDefect("publicationLifecycleLinkInvalid");
        }
      } else if (
        inFlight.attemptOrdinal !== precedingAttemptOutcome.attemptOrdinal
        || inFlight.disposition._tag !== "blocked"
        || inFlight.disposition.reason !== receipt.reason
      ) {
        throw stateInvariantDefect("publicationLifecycleLinkInvalid");
      }
    }
  }

  const precedingMatchesInFlight = precedingAttemptOutcome !== null
    && inFlight !== null
    && queryPublicationIdentityEquals(
      precedingAttemptOutcome.identity,
      inFlight.publication.identity,
    );
  if (inFlight !== null) {
    if (
      inFlight.attemptOrdinal > 1
      && !precedingMatchesInFlight
    ) {
      throw stateInvariantDefect("publicationLifecycleLinkInvalid");
    }
    if (
      inFlight.disposition._tag === "uncertain"
      && inFlight.attemptOrdinal === 1
    ) {
      throw stateInvariantDefect("publicationLifecycleLinkInvalid");
    }
    if (
      inFlight.disposition._tag === "blocked"
      && (
        (
          inFlight.disposition.reason === "attemptLimitReached"
          && inFlight.attemptOrdinal !== MAX_PUBLICATION_ATTEMPT_ORDINAL
        )
        || (
          inFlight.disposition.reason !== "ageLimitReached"
          && !precedingMatchesInFlight
        )
        || (
          inFlight.disposition.reason === "ageLimitReached"
          && inFlight.attemptOrdinal > 1
          && !precedingMatchesInFlight
        )
      )
    ) {
      throw stateInvariantDefect("publicationLifecycleLinkInvalid");
    }
  }
  if (
    precedingAttemptOutcome !== null
    && latestDelivered === null
    && !precedingMatchesInFlight
  ) {
    throw stateInvariantDefect("publicationLifecycleLinkInvalid");
  }

  observedMetrics = addMetricContribution(
    observedMetrics,
    publicationLifecycleMetricContribution(publicationWork),
  );
  if (winningMetricLimitReached(
    winningMetricLimit,
    observedMetrics,
    ["countedCanonicalBytes"],
  )) {
    return Result.fail(winningMetricLimit);
  }
  if (winningMetricLimit !== null) {
    return Result.fail(winningMetricLimit);
  }

  const queries = queryStates.map(freezeQueryState);
  queries.sort((left, right) => compareCanonicalBase64Url(
    left.descriptor.queryKey,
    right.descriptor.queryKey,
  ));
  const dependencyDirectory = new Map<
    CanonicalDependencyKey,
    CanonicalQueryKey[]
  >();
  for (const query of queries) {
    if (query.active === null) continue;
    for (const dependencyKey of query.active.dependencyKeys) {
      const existing = dependencyDirectory.get(dependencyKey);
      if (existing === undefined) {
        dependencyDirectory.set(dependencyKey, [query.descriptor.queryKey]);
      } else {
        existing.push(query.descriptor.queryKey);
      }
    }
  }

  const orderedDirectoryEntries = [...dependencyDirectory.entries()];
  orderedDirectoryEntries.sort(([left], [right]) => (
    compareCanonicalBase64Url(left, right)
  ));
  const directory = orderedDirectoryEntries
    .map(([dependencyKey, queryKeys]): DependencyDirectoryEntry => (
      Object.freeze({
        dependencyKey,
        queryKeys: Object.freeze([...queryKeys]),
      })
    ));
  const frozenEvaluationWork = freezeEvaluationWorkState(evaluationWork);
  const frozenPublicationWork = freezePublicationWorkState(publicationWork);
  const frozenCursor = freezeNamespaceCursor(cursor);
  const frozenQueries = Object.freeze(queries);
  return Result.succeed(Object.freeze({
    cursor: frozenCursor,
    queries: frozenQueries,
    dependencyDirectory: Object.freeze(directory),
    evaluationWork: frozenEvaluationWork,
    publicationWork: frozenPublicationWork,
    metrics: calculatedMetrics,
  }));
}

export function findQueryState(
  state: QuerySyncState,
  queryKey: CanonicalQueryKey,
): QueryState | undefined {
  let lower = 0;
  let upper = state.queries.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const query = state.queries[middle];
    if (query === undefined) return undefined;
    const comparison = compareCanonicalBase64Url(
      query.descriptor.queryKey,
      queryKey,
    );
    if (comparison === 0) return query;
    if (comparison < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

export function findDependencyDirectoryEntry(
  state: QuerySyncState,
  dependencyKey: CanonicalDependencyKey,
): DependencyDirectoryEntry | undefined {
  let lower = 0;
  let upper = state.dependencyDirectory.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const entry = state.dependencyDirectory[middle];
    if (entry === undefined) return undefined;
    const comparison = compareCanonicalBase64Url(
      entry.dependencyKey,
      dependencyKey,
    );
    if (comparison === 0) return entry;
    if (comparison < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

export function findPendingQueryPublication(
  state: QuerySyncState,
  queryKey: CanonicalQueryKey,
): PendingQueryPublication | undefined {
  let lower = 0;
  let upper = state.publicationWork.pending.length - 1;
  while (lower <= upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    const publication = state.publicationWork.pending[middle];
    if (publication === undefined) return undefined;
    const comparison = compareCanonicalBase64Url(
      publication.identity.queryKey,
      queryKey,
    );
    if (comparison === 0) return publication;
    if (comparison < 0) lower = middle + 1;
    else upper = middle - 1;
  }
  return undefined;
}

export function findRetainedQueryPublication(
  state: QuerySyncState,
  identity: QueryPublicationIdentity,
): PendingQueryPublication | undefined {
  const pending = findPendingQueryPublication(state, identity.queryKey);
  if (
    pending !== undefined
    && queryPublicationIdentityEquals(pending.identity, identity)
  ) {
    return pending;
  }
  const inFlight = state.publicationWork.inFlight;
  return inFlight !== null
      && queryPublicationIdentityEquals(inFlight.publication.identity, identity)
    ? inFlight.publication
    : undefined;
}

export function makeGenerationRefreshEvidence(input: {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly descriptor: QueryDescriptor;
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly evaluationDependencyKeys: readonly CanonicalDependencyKey[];
  readonly refreshedThroughSequence: SyncSequence;
  readonly relevantThroughSequence: SyncSequence | null;
  readonly authorityWitness: QueryAuthorityWitness;
}): GenerationRefreshEvidence {
  return new AdmittedGenerationRefreshEvidence({
    namespaceId: input.namespaceId,
    syncModelId: input.syncModelId,
    sourceEpoch: input.sourceEpoch,
    descriptor: input.descriptor,
    generation: input.generation,
    evaluationSnapshotSequence: input.evaluationSnapshotSequence,
    evaluationDependencyKeys: input.evaluationDependencyKeys,
    refreshedThroughSequence: input.refreshedThroughSequence,
    relevantThroughSequence: input.relevantThroughSequence,
    authorityWitness: input.authorityWitness,
  });
}

export function rebuildQuerySyncState(
  state: QuerySyncState,
  patch: QuerySyncStatePatch,
): Result.Result<QuerySyncState, BuildQuerySyncStateError> {
  return buildQuerySyncState({
    cursor: patch.cursor ?? state.cursor,
    queries: patch.queries ?? state.queries,
    evaluationWork: patch.evaluationWork ?? state.evaluationWork,
    publicationWork: patch.publicationWork ?? state.publicationWork,
  });
}
