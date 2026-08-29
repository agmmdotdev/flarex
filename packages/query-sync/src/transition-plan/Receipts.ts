import type {
  CanonicalQueryKey,
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  makeQueryEvaluationAttempt,
} from "../kernel/EvaluationAttempt.js";
import type {
  QueryEvaluationAttempt,
  QueryEvaluationAttemptInput,
} from "../kernel/EvaluationAttempt.js";
import type {
  NamespaceCursor,
  QueryDescriptor,
  QuerySyncStateMetrics,
} from "../kernel/Model.js";
import { freezePublicationDisposition } from "../kernel/Publication.js";
import type {
  QueryCompletionPublicationDisposition,
} from "../kernel/Publication.js";
import { freezeMetrics } from "./Model.js";

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

function freezeCursor(cursor: NamespaceCursor): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

export function freezeDescriptor(
  descriptor: QueryDescriptor,
): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
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

export function attemptedBeginReceipt(
  tag: "created" | "replayed",
  attempt: QueryEvaluationAttemptInput,
): BeginQueryEvaluationReceipt {
  return Object.freeze({
    _tag: tag,
    attempt: makeQueryEvaluationAttempt(attempt),
  });
}

export function alreadyAdvancedBeginReceipt(input: {
  readonly descriptor: QueryDescriptor;
  readonly requestedExpectedActiveGeneration: QueryGeneration | null;
  readonly activeGeneration: QueryGeneration;
  readonly freshThroughSequence: SyncSequence;
}): BeginQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "alreadyAdvanced",
    descriptor: freezeDescriptor(input.descriptor),
    requestedExpectedActiveGeneration:
      input.requestedExpectedActiveGeneration,
    activeGeneration: input.activeGeneration,
    freshThroughSequence: input.freshThroughSequence,
  });
}

export function notDirtyBeginReceipt(input: {
  readonly descriptor: QueryDescriptor;
  readonly activeGeneration: QueryGeneration;
  readonly requestedDirtyThroughSequence: SyncSequence;
  readonly freshThroughSequence: SyncSequence;
}): BeginQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "notDirty",
    descriptor: freezeDescriptor(input.descriptor),
    activeGeneration: input.activeGeneration,
    requestedDirtyThroughSequence: input.requestedDirtyThroughSequence,
    freshThroughSequence: input.freshThroughSequence,
  });
}

export function duplicateApplyReceipt(
  observedSequence: SyncSequence,
): ApplyAdmittedBatchReceipt {
  return Object.freeze({ _tag: "duplicate", observedSequence });
}

export function gapApplyReceipt(
  expectedSequence: SyncSequence,
  observedSequence: SyncSequence,
): ApplyAdmittedBatchReceipt {
  return Object.freeze({
    _tag: "gap",
    expectedSequence,
    observedSequence,
  });
}

export function resetRequiredApplyReceipt(
  expectedSourceEpoch: SyncEpoch,
  observedSourceEpoch: SyncEpoch,
): ApplyAdmittedBatchReceipt {
  return Object.freeze({
    _tag: "resetRequired",
    expectedSourceEpoch,
    observedSourceEpoch,
  });
}

export function appliedBatchReceipt(
  appliedSequence: SyncSequence,
  affectedQueryKeys: readonly CanonicalQueryKey[],
): ApplyAdmittedBatchReceipt {
  return Object.freeze({
    _tag: "applied",
    appliedSequence,
    affectedQueryKeys: Object.freeze([...affectedQueryKeys]),
  });
}

export function refreshRequiredCompleteReceipt(
  refreshedThroughSequence: SyncSequence,
  requiredThroughSequence: SyncSequence,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "refreshRequired",
    refreshedThroughSequence,
    requiredThroughSequence,
  });
}

export function resnapshotRequiredCompleteReceipt(
  generation: QueryGeneration,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({ _tag: "resnapshotRequired", generation });
}

export function rerunRequiredCompleteReceipt(
  generation: QueryGeneration,
  relevantThroughSequence: SyncSequence,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "rerunRequired",
    generation,
    relevantThroughSequence,
  });
}

export function completedCompleteReceipt(
  tag: "completed" | "replayed",
  generation: QueryGeneration,
  publicationDisposition: QueryCompletionPublicationDisposition,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({
    _tag: tag,
    generation,
    publicationDisposition: freezePublicationDisposition(
      publicationDisposition,
    ),
  });
}

export function supersededCompleteReceipt(
  generation: QueryGeneration,
  activeGeneration: QueryGeneration,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "superseded",
    generation,
    activeGeneration,
  });
}

export function recoveryEvidenceExpiredCompleteReceipt(
  generation: QueryGeneration,
  activeGeneration: QueryGeneration,
): CompleteQueryEvaluationReceipt {
  return Object.freeze({
    _tag: "recoveryEvidenceExpired",
    generation,
    activeGeneration,
  });
}
