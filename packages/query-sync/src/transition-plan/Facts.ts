import type {
  CanonicalDependencyKey,
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
  QueryCompletionFingerprint,
  QueryDescriptor,
} from "../kernel/Model.js";
import {
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
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

export interface QueryCompletionScalarFacts {
  readonly identity: QueryPublicationIdentity;
  readonly queryIdentity: QueryCompletionFingerprint["queryIdentity"];
  readonly expectedActiveGeneration:
    QueryCompletionFingerprint["expectedActiveGeneration"];
  readonly registrationCursor:
    QueryCompletionFingerprint["registrationCursor"];
  readonly requestedDirtyThroughSequence:
    QueryCompletionFingerprint["requestedDirtyThroughSequence"];
  readonly evaluationSnapshotSequence:
    QueryCompletionFingerprint["evaluationSnapshotSequence"];
  readonly evaluationAuthorityWitness:
    QueryCompletionFingerprint["evaluationAuthorityWitness"];
  readonly refreshedThroughSequence:
    QueryCompletionFingerprint["refreshedThroughSequence"];
  readonly relevantThroughSequence:
    QueryCompletionFingerprint["relevantThroughSequence"];
  readonly refreshAuthorityWitness:
    QueryCompletionFingerprint["refreshAuthorityWitness"];
  readonly resultDigest: QueryCompletionFingerprint["resultDigest"];
  readonly publicationDisposition:
    QueryCompletionFingerprint["publicationDisposition"];
}

export interface CompleteQueryScalarFacts {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryScalarFacts | null;
  readonly provisional: ProvisionalQueryState | null;
  readonly currentCompletion: QueryCompletionScalarFacts | null;
  readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
}

export interface QueryDependencyFacts {
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly dependencyKeys: readonly CanonicalDependencyKey[];
}

export interface PublicationIdentityDigestFacts {
  readonly identity: QueryPublicationIdentity;
  readonly resultDigest: QueryResultDigest;
}

/**
 * The three process-global lifecycle slots projected only when they belong to
 * `queryKey`. An unrelated global slot must be represented as `null`.
 */
export interface CompletionPublicationLifecycleFacts {
  readonly queryKey: CanonicalQueryKey;
  readonly inFlight: PendingQueryPublication | null;
  readonly latestDelivered: PublicationIdentityDigestFacts | null;
  readonly precedingAttemptOutcome: PublicationIdentityDigestFacts | null;
}

export interface CompleteQueryReplayFactsRead {
  readonly queryKey: CanonicalQueryKey;
  readonly completionDependencies: QueryDependencyFacts;
  readonly retainedPublication: PendingQueryPublication | null;
}

export interface CompleteQueryMaterialFactsRead {
  readonly queryKey: CanonicalQueryKey;
  readonly activeDependencies: QueryDependencyFacts | null;
  readonly completionDependencies: QueryDependencyFacts | null;
  readonly pendingPublication: PendingQueryPublication | null;
  readonly lifecycle: CompletionPublicationLifecycleFacts;
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

export function freezeQueryCompletionScalarFacts(
  completion: QueryCompletionScalarFacts,
): QueryCompletionScalarFacts {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(completion.identity),
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: Object.freeze({
      namespaceId: completion.registrationCursor.namespaceId,
      syncModelId: completion.registrationCursor.syncModelId,
      sourceEpoch: completion.registrationCursor.sourceEpoch,
      appliedThroughSequence:
        completion.registrationCursor.appliedThroughSequence,
    }),
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
    evaluationSnapshotSequence: completion.evaluationSnapshotSequence,
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

export function freezeCompleteQueryScalarFacts(
  facts: CompleteQueryScalarFacts,
): CompleteQueryScalarFacts {
  return Object.freeze({
    descriptor: freezeDescriptor(facts.descriptor),
    active: facts.active === null
      ? null
      : freezeActiveScalarFacts(facts.active),
    provisional: facts.provisional === null
      ? null
      : freezeProvisionalFacts(facts.provisional),
    currentCompletion: facts.currentCompletion === null
      ? null
      : freezeQueryCompletionScalarFacts(facts.currentCompletion),
    precedingCompletionIdentity:
      facts.precedingCompletionIdentity === null
        ? null
        : freezeQueryPublicationIdentity(
          facts.precedingCompletionIdentity,
        ),
  });
}

export function freezeQueryDependencyFacts(
  facts: QueryDependencyFacts,
): QueryDependencyFacts {
  return Object.freeze({
    queryKey: facts.queryKey,
    generation: facts.generation,
    dependencyKeys: Object.freeze([...facts.dependencyKeys]),
  });
}

export function freezePendingPublicationFacts(
  publication: PendingQueryPublication,
): PendingQueryPublication {
  return makePendingQueryPublication(publication);
}

function freezePublicationIdentityDigestFacts(
  publication: PublicationIdentityDigestFacts,
): PublicationIdentityDigestFacts {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(publication.identity),
    resultDigest: publication.resultDigest,
  });
}

export function freezeCompletionPublicationLifecycleFacts(
  facts: CompletionPublicationLifecycleFacts,
): CompletionPublicationLifecycleFacts {
  return Object.freeze({
    queryKey: facts.queryKey,
    inFlight: facts.inFlight === null
      ? null
      : freezePendingPublicationFacts(facts.inFlight),
    latestDelivered: facts.latestDelivered === null
      ? null
      : freezePublicationIdentityDigestFacts(facts.latestDelivered),
    precedingAttemptOutcome: facts.precedingAttemptOutcome === null
      ? null
      : freezePublicationIdentityDigestFacts(
        facts.precedingAttemptOutcome,
      ),
  });
}

export function freezeCompleteQueryReplayFactsRead(
  read: CompleteQueryReplayFactsRead,
): CompleteQueryReplayFactsRead {
  return Object.freeze({
    queryKey: read.queryKey,
    completionDependencies: freezeQueryDependencyFacts(
      read.completionDependencies,
    ),
    retainedPublication: read.retainedPublication === null
      ? null
      : freezePendingPublicationFacts(read.retainedPublication),
  });
}

export function freezeCompleteQueryMaterialFactsRead(
  read: CompleteQueryMaterialFactsRead,
): CompleteQueryMaterialFactsRead {
  return Object.freeze({
    queryKey: read.queryKey,
    activeDependencies: read.activeDependencies === null
      ? null
      : freezeQueryDependencyFacts(read.activeDependencies),
    completionDependencies: read.completionDependencies === null
      ? null
      : freezeQueryDependencyFacts(read.completionDependencies),
    pendingPublication: read.pendingPublication === null
      ? null
      : freezePendingPublicationFacts(read.pendingPublication),
    lifecycle: freezeCompletionPublicationLifecycleFacts(read.lifecycle),
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
