import type {
  CanonicalQueryKey,
  QueryAuthorityWitness,
  QueryGeneration,
  QueryResultDigest,
  QuerySnapshot,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  ActiveQueryState,
  ProvisionalQueryState,
  QueryDescriptor,
} from "../kernel/Model.js";
import { freezeDescriptor } from "./Receipts.js";

export interface ActiveQueryScalarFacts {
  readonly generation: QueryGeneration;
  readonly evaluationSnapshotSequence: QuerySnapshot;
  readonly freshThroughSequence: SyncSequence;
  readonly dirtyThroughSequence: SyncSequence | null;
  readonly resultDigest: QueryResultDigest;
  readonly authorityWitness: QueryAuthorityWitness;
}

export interface BeginQueryFacts {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryScalarFacts | null;
  readonly provisional: ProvisionalQueryState | null;
}

export interface AffectedActiveQueryTarget {
  readonly queryKey: CanonicalQueryKey;
  readonly activeGeneration: QueryGeneration;
}

export interface AffectedActiveQueryFacts
  extends ActiveQueryScalarFacts {
  readonly queryKey: CanonicalQueryKey;
}

export function freezeActiveScalarFacts(
  active: ActiveQueryScalarFacts,
): ActiveQueryScalarFacts {
  return Object.freeze({
    generation: active.generation,
    evaluationSnapshotSequence: active.evaluationSnapshotSequence,
    freshThroughSequence: active.freshThroughSequence,
    dirtyThroughSequence: active.dirtyThroughSequence,
    resultDigest: active.resultDigest,
    authorityWitness: active.authorityWitness,
  });
}

export function projectActiveScalarFacts(
  active: ActiveQueryState,
): ActiveQueryScalarFacts {
  return freezeActiveScalarFacts(active);
}

export function freezeProvisionalFacts(
  provisional: ProvisionalQueryState,
): ProvisionalQueryState {
  return Object.freeze({
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: Object.freeze({
      namespaceId: provisional.registrationCursor.namespaceId,
      syncModelId: provisional.registrationCursor.syncModelId,
      sourceEpoch: provisional.registrationCursor.sourceEpoch,
      appliedThroughSequence:
        provisional.registrationCursor.appliedThroughSequence,
    }),
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
    evaluationDisposition:
      provisional.evaluationDisposition._tag === "ready"
        ? Object.freeze({ _tag: "ready" })
        : Object.freeze({
          _tag: provisional.evaluationDisposition._tag,
          reason: provisional.evaluationDisposition.reason,
          resetRequired: provisional.evaluationDisposition.resetRequired,
        }),
  });
}

export function freezeBeginQueryFacts(
  facts: BeginQueryFacts,
): BeginQueryFacts {
  return Object.freeze({
    descriptor: freezeDescriptor(facts.descriptor),
    active: facts.active === null
      ? null
      : freezeActiveScalarFacts(facts.active),
    provisional: facts.provisional === null
      ? null
      : freezeProvisionalFacts(facts.provisional),
  });
}

export function freezeAffectedActiveTarget(
  target: AffectedActiveQueryTarget,
): AffectedActiveQueryTarget {
  return Object.freeze({
    queryKey: target.queryKey,
    activeGeneration: target.activeGeneration,
  });
}

export function freezeAffectedActiveFacts(
  facts: AffectedActiveQueryFacts,
): AffectedActiveQueryFacts {
  return Object.freeze({
    queryKey: facts.queryKey,
    generation: facts.generation,
    evaluationSnapshotSequence: facts.evaluationSnapshotSequence,
    freshThroughSequence: facts.freshThroughSequence,
    dirtyThroughSequence: facts.dirtyThroughSequence,
    resultDigest: facts.resultDigest,
    authorityWitness: facts.authorityWitness,
  });
}
