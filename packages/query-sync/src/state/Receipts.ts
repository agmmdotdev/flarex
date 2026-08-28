import type {
  CanonicalQueryKey,
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  ApplyInvalidationsDecision,
  BeginQueryGenerationDecision,
  CompleteQueryGenerationDecision,
  NamespaceCursor,
  QueryDescriptor,
  QuerySyncStateMetrics,
} from "../kernel/Model.js";

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

export type BeginQueryGenerationReceipt =
  | Readonly<{
    readonly _tag: "created";
    readonly descriptor: QueryDescriptor;
    readonly generation: QueryGeneration;
    readonly registrationCursor: NamespaceCursor;
  }>
  | Readonly<{
    readonly _tag: "replayed";
    readonly descriptor: QueryDescriptor;
    readonly generation: QueryGeneration;
    readonly registrationCursor: NamespaceCursor;
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

export type CompleteQueryGenerationReceipt =
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
    readonly publicationRequired: boolean;
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
    countedCanonicalBytes: metrics.countedCanonicalBytes,
  });
}

function freezeDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
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

export function projectBeginReceipt(
  decision: BeginQueryGenerationDecision,
): BeginQueryGenerationReceipt {
  return Object.freeze({
    _tag: decision._tag,
    descriptor: freezeDescriptor(decision.descriptor),
    generation: decision.generation,
    registrationCursor: freezeCursor(decision.registrationCursor),
  });
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
  decision: CompleteQueryGenerationDecision,
): CompleteQueryGenerationReceipt {
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
      return Object.freeze({
        _tag: "completed",
        generation: decision.generation,
        publicationRequired: decision.publicationRequired,
      });
  }
}
