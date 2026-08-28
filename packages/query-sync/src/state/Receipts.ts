import type {
  CanonicalQueryKey,
  PublicationAttemptOrdinal,
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  BlockedEvaluationWorkEvidence,
  ClaimEvaluationWorkDecision,
  EvaluationWorkScanContinuation,
  RecordEvaluationAttemptOutcomeDecision,
} from "../kernel/EvaluationWork.js";
import type {
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  CompleteQueryEvaluationDecision,
  NamespaceCursor,
  PublicationBlockReason,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QuerySyncStateMetrics,
} from "../kernel/Model.js";
import { makeQueryEvaluationAttempt } from "../kernel/Model.js";
import {
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
} from "../kernel/Publication.js";
import type {
  QueryCompletionPublicationDisposition,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import type {
  ClaimPublicationDecision,
  CompletePublicationDecision,
  PublicationAttempt,
  RecordPublicationAttemptOutcomeDecision,
} from "../kernel/PublicationWork.js";

export type InitializeNamespaceReceipt =
  | Readonly<{
    readonly _tag: "initialized";
    readonly cursor: NamespaceCursor;
    readonly metrics: QuerySyncStateMetrics;
  }>
  | Readonly<{
    readonly _tag: "existing";
    readonly cursor: NamespaceCursor;
    readonly metrics: QuerySyncStateMetrics;
  }>
  | Readonly<{
    readonly _tag: "modelReplaced";
    readonly existingCursor: NamespaceCursor;
    readonly requestedSyncModelId: SyncModelId;
  }>
  | Readonly<{
    readonly _tag: "epochReplaced";
    readonly existingCursor: NamespaceCursor;
    readonly requestedSourceEpoch: SyncEpoch;
  }>;

export type BeginQueryEvaluationReceipt =
  | Readonly<{
    readonly _tag: "created";
    readonly attempt: QueryEvaluationAttempt;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly attempt: QueryEvaluationAttempt;
  }>
  | Readonly<{
    readonly _tag: "alreadyAdvanced";
    readonly descriptor: QueryDescriptor;
    readonly requestedExpectedActiveGeneration: QueryGeneration | null;
    readonly activeGeneration: QueryGeneration;
    readonly freshThroughSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "notDirty";
    readonly descriptor: QueryDescriptor;
    readonly activeGeneration: QueryGeneration;
    readonly requestedDirtyThroughSequence: SyncSequence;
    readonly freshThroughSequence: SyncSequence;
  }>;

export type ApplyAdmittedBatchReceipt =
  | Readonly<{
    readonly _tag: "duplicate";
    readonly observedSequence: SyncSequence;
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
  }>
  | Readonly<{
    readonly _tag: "applied";
    readonly appliedSequence: SyncSequence;
    readonly affectedQueryKeys: readonly CanonicalQueryKey[];
  }>;

export type CompleteQueryEvaluationReceipt =
  | Readonly<{
    readonly _tag: "refreshRequired";
    readonly refreshedThroughSequence: SyncSequence;
    readonly requiredThroughSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "resnapshotRequired";
    readonly generation: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "rerunRequired";
    readonly generation: QueryGeneration;
    readonly relevantThroughSequence: SyncSequence;
  }>
  | Readonly<{
    readonly _tag: "completed";
    readonly generation: QueryGeneration;
    readonly publicationDisposition: QueryCompletionPublicationDisposition;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly generation: QueryGeneration;
    readonly publicationDisposition: QueryCompletionPublicationDisposition;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>;

export type ClaimEvaluationWorkReceipt =
  | Readonly<{
    readonly _tag: "claimed";
    readonly attempt: QueryEvaluationAttempt;
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "continued";
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "scanRestarted";
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly blockedWork: BlockedEvaluationWorkEvidence;
  }>
  | Readonly<{
    readonly _tag: "none";
  }>;

export type RecordEvaluationAttemptOutcomeReceipt =
  | Readonly<{
    readonly _tag: "eligible";
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly blockedWork: BlockedEvaluationWorkEvidence;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>;

export type ClaimPublicationReceipt =
  | Readonly<{
    readonly _tag: "claimed";
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly attempt: PublicationAttempt;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "none";
  }>;

export type RecordPublicationAttemptOutcomeReceipt =
  | Readonly<{
    readonly _tag: "recorded";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly nextAttemptOrdinal: PublicationAttemptOrdinal;
    readonly nextDisposition: "ready" | "uncertain";
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
    readonly reason: PublicationBlockReason;
    readonly resetRequired: true;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly identity: QueryPublicationIdentity;
    readonly attemptOrdinal: PublicationAttemptOrdinal;
  }>;

export type CompletePublicationReceipt =
  | Readonly<{
    readonly _tag: "completed";
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly identity: QueryPublicationIdentity;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly identity: QueryPublicationIdentity;
  }>;

function freezeCursor(cursor: NamespaceCursor): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

function freezeMetrics(metrics: QuerySyncStateMetrics): QuerySyncStateMetrics {
  return Object.freeze({
    queryCount: metrics.queryCount,
    retainedIdentityBytes: metrics.retainedIdentityBytes,
    dependencyMemberships: metrics.dependencyMemberships,
    pendingPublicationCount: metrics.pendingPublicationCount,
    inFlightPublicationCount: metrics.inFlightPublicationCount,
    retainedPublicationContentBytes:
      metrics.retainedPublicationContentBytes,
    settlementEnvelopeBytes: metrics.settlementEnvelopeBytes,
    countedCanonicalBytes: metrics.countedCanonicalBytes,
  });
}

function freezeDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezeBlockedEvaluationWork(
  blockedWork: BlockedEvaluationWorkEvidence,
): BlockedEvaluationWorkEvidence {
  return Object.freeze({
    queryKey: blockedWork.queryKey,
    generation: blockedWork.generation,
    reason: "terminalEvaluatorRefusal",
    resetRequired: true,
  });
}

export function initializedNamespaceReceipt(
  tag: "initialized" | "existing",
  cursor: NamespaceCursor,
  metrics: QuerySyncStateMetrics,
): InitializeNamespaceReceipt {
  return Object.freeze({
    _tag: tag,
    cursor: freezeCursor(cursor),
    metrics: freezeMetrics(metrics),
  });
}

export function modelReplacedReceipt(
  existingCursor: NamespaceCursor,
  requestedSyncModelId: SyncModelId,
): InitializeNamespaceReceipt {
  return Object.freeze({
    _tag: "modelReplaced",
    existingCursor: freezeCursor(existingCursor),
    requestedSyncModelId,
  });
}

export function epochReplacedReceipt(
  existingCursor: NamespaceCursor,
  requestedSourceEpoch: SyncEpoch,
): InitializeNamespaceReceipt {
  return Object.freeze({
    _tag: "epochReplaced",
    existingCursor: freezeCursor(existingCursor),
    requestedSourceEpoch,
  });
}

export function projectBeginReceipt(
  decision: BeginQueryEvaluationDecision,
): BeginQueryEvaluationReceipt {
  switch (decision._tag) {
    case "created":
    case "replayed":
      return Object.freeze({
        _tag: decision._tag,
        attempt: makeQueryEvaluationAttempt(decision.attempt),
      });
    case "alreadyAdvanced":
      return Object.freeze({
        _tag: "alreadyAdvanced",
        descriptor: freezeDescriptor(decision.descriptor),
        requestedExpectedActiveGeneration:
          decision.requestedExpectedActiveGeneration,
        activeGeneration: decision.activeGeneration,
        freshThroughSequence: decision.freshThroughSequence,
      });
    case "notDirty":
      return Object.freeze({
        _tag: "notDirty",
        descriptor: freezeDescriptor(decision.descriptor),
        activeGeneration: decision.activeGeneration,
        requestedDirtyThroughSequence:
          decision.requestedDirtyThroughSequence,
        freshThroughSequence: decision.freshThroughSequence,
      });
  }
}

export function projectApplyReceipt(
  decision: ApplyInvalidationsDecision,
): ApplyAdmittedBatchReceipt {
  switch (decision._tag) {
    case "duplicate":
      return Object.freeze({
        _tag: "duplicate",
        observedSequence: decision.observedSequence,
      });
    case "gap":
      return Object.freeze({
        _tag: "gap",
        expectedSequence: decision.expectedSequence,
        observedSequence: decision.observedSequence,
      });
    case "resetRequired":
      return Object.freeze({
        _tag: "resetRequired",
        expectedSourceEpoch: decision.expectedSourceEpoch,
        observedSourceEpoch: decision.observedSourceEpoch,
      });
    case "applied":
      return Object.freeze({
        _tag: "applied",
        appliedSequence: decision.appliedSequence,
        affectedQueryKeys: Object.freeze([...decision.affectedQueryKeys]),
      });
  }
}

export function projectCompleteReceipt(
  decision: CompleteQueryEvaluationDecision,
): CompleteQueryEvaluationReceipt {
  switch (decision._tag) {
    case "refreshRequired":
      return Object.freeze({
        _tag: "refreshRequired",
        refreshedThroughSequence: decision.refreshedThroughSequence,
        requiredThroughSequence: decision.requiredThroughSequence,
      });
    case "resnapshotRequired":
      return Object.freeze({
        _tag: "resnapshotRequired",
        generation: decision.generation,
      });
    case "rerunRequired":
      return Object.freeze({
        _tag: "rerunRequired",
        generation: decision.generation,
        relevantThroughSequence: decision.relevantThroughSequence,
      });
    case "completed":
    case "replayed":
      return Object.freeze({
        _tag: decision._tag,
        generation: decision.generation,
        publicationDisposition: freezePublicationDisposition(
          decision.publicationDisposition,
        ),
      });
    case "superseded":
    case "recoveryEvidenceExpired":
      return Object.freeze({
        _tag: decision._tag,
        generation: decision.generation,
        activeGeneration: decision.activeGeneration,
      });
  }
}

export function projectClaimEvaluationWorkReceipt(
  decision: ClaimEvaluationWorkDecision,
): ClaimEvaluationWorkReceipt {
  switch (decision._tag) {
    case "claimed":
      return Object.freeze({
        _tag: "claimed",
        // These are process-local state-issued capabilities. Preserve their
        // exact identities so their private runtime authenticity remains valid.
        attempt: decision.attempt,
        continuation: decision.continuation,
      });
    case "continued":
    case "scanRestarted":
      return Object.freeze({
        _tag: decision._tag,
        continuation: decision.continuation,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        blockedWork: freezeBlockedEvaluationWork(decision.blockedWork),
      });
    case "none":
      return Object.freeze({ _tag: "none" });
  }
}

export function projectRecordEvaluationAttemptOutcomeReceipt(
  decision: RecordEvaluationAttemptOutcomeDecision,
): RecordEvaluationAttemptOutcomeReceipt {
  switch (decision._tag) {
    case "eligible":
      return Object.freeze({
        _tag: "eligible",
        queryKey: decision.queryKey,
        generation: decision.generation,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        blockedWork: freezeBlockedEvaluationWork(decision.blockedWork),
      });
    case "superseded":
    case "recoveryEvidenceExpired":
      return Object.freeze({
        _tag: decision._tag,
        queryKey: decision.queryKey,
        generation: decision.generation,
        activeGeneration: decision.activeGeneration,
      });
  }
}

export function projectClaimPublicationReceipt(
  decision: ClaimPublicationDecision,
): ClaimPublicationReceipt {
  switch (decision._tag) {
    case "claimed":
    case "replayed":
      return Object.freeze({
        _tag: decision._tag,
        // Publication attempts are nominal state-issued capabilities. Keep the
        // exact frozen value instead of manufacturing a structural copy.
        attempt: decision.attempt,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        reason: decision.reason,
        resetRequired: true,
      });
    case "none":
      return Object.freeze({ _tag: "none" });
  }
}

export function projectRecordPublicationAttemptOutcomeReceipt(
  decision: RecordPublicationAttemptOutcomeDecision,
): RecordPublicationAttemptOutcomeReceipt {
  switch (decision._tag) {
    case "recorded":
      return Object.freeze({
        _tag: "recorded",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        nextAttemptOrdinal: decision.nextAttemptOrdinal,
        nextDisposition: decision.nextDisposition,
      });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
        reason: decision.reason,
        resetRequired: true,
      });
    case "superseded":
    case "recoveryEvidenceExpired":
      return Object.freeze({
        _tag: decision._tag,
        identity: freezeQueryPublicationIdentity(decision.identity),
        attemptOrdinal: decision.attemptOrdinal,
      });
  }
}

export function projectCompletePublicationReceipt(
  decision: CompletePublicationDecision,
): CompletePublicationReceipt {
  return Object.freeze({
    _tag: decision._tag,
    identity: freezeQueryPublicationIdentity(decision.identity),
  });
}
