import type {
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
  QueryGeneration,
  QueryResultDigest,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  DeliveredQueryPublication,
  InFlightQueryPublication,
  PrecedingPublicationAttemptOutcome,
  PublicationAttemptDisposition,
  PublicationAttemptOutcomeReceiptCore,
  QueryDescriptor,
} from "../kernel/Model.js";
import {
  freezePublicationDisposition,
  freezeQueryPublicationIdentity,
  makePendingQueryPublication,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryCompletionPublicationDisposition,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";

export interface PublicationOwnerActiveFacts {
  readonly generation: QueryGeneration;
  readonly freshThroughSequence: SyncSequence;
  readonly resultDigest: QueryResultDigest;
}

export interface PublicationOwnerCompletionFacts {
  readonly identity: QueryPublicationIdentity;
  readonly refreshedThroughSequence: SyncSequence;
  readonly resultDigest: QueryResultDigest;
  readonly publicationDisposition: QueryCompletionPublicationDisposition;
}

export interface PublicationOwnerQueryFacts {
  readonly descriptor: QueryDescriptor;
  readonly active: PublicationOwnerActiveFacts | null;
  readonly currentCompletion: PublicationOwnerCompletionFacts | null;
}

export interface PublicationLifecycleFacts {
  readonly inFlight: InFlightQueryPublication | null;
  readonly latestDelivered: DeliveredQueryPublication | null;
  readonly precedingAttemptOutcome:
    PrecedingPublicationAttemptOutcome | null;
}

export interface PendingPublicationSelectionFacts {
  readonly publication: PendingQueryPublication;
  readonly owner: PublicationOwnerQueryFacts;
}

function freezeDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezePublicationAttemptDisposition(
  disposition: PublicationAttemptDisposition,
): PublicationAttemptDisposition {
  switch (disposition._tag) {
    case "ready":
      return Object.freeze({ _tag: "ready" });
    case "uncertain":
      return Object.freeze({ _tag: "uncertain" });
    case "blocked":
      return Object.freeze({
        _tag: "blocked",
        reason: disposition.reason,
        resetRequired: true,
      });
  }
}

function freezeOutcomeReceiptCore(
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

export function freezeInFlightQueryPublicationFacts(
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

export function freezeDeliveredQueryPublicationFacts(
  delivered: DeliveredQueryPublication,
): DeliveredQueryPublication {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(delivered.identity),
    resultDigest: delivered.resultDigest,
  });
}

export function freezePrecedingPublicationAttemptOutcomeFacts(
  preceding: PrecedingPublicationAttemptOutcome,
): PrecedingPublicationAttemptOutcome {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(preceding.identity),
    resultDigest: preceding.resultDigest,
    attemptOrdinal: preceding.attemptOrdinal,
    outcome: preceding.outcome,
    receipt: freezeOutcomeReceiptCore(preceding.receipt),
  });
}

export function freezePublicationOwnerQueryFacts(
  owner: PublicationOwnerQueryFacts,
): PublicationOwnerQueryFacts {
  return Object.freeze({
    descriptor: freezeDescriptor(owner.descriptor),
    active: owner.active === null
      ? null
      : Object.freeze({
        generation: owner.active.generation,
        freshThroughSequence: owner.active.freshThroughSequence,
        resultDigest: owner.active.resultDigest,
      }),
    currentCompletion: owner.currentCompletion === null
      ? null
      : Object.freeze({
        identity: freezeQueryPublicationIdentity(
          owner.currentCompletion.identity,
        ),
        refreshedThroughSequence:
          owner.currentCompletion.refreshedThroughSequence,
        resultDigest: owner.currentCompletion.resultDigest,
        publicationDisposition: freezePublicationDisposition(
          owner.currentCompletion.publicationDisposition,
        ),
      }),
  });
}

export function freezePublicationLifecycleFacts(
  lifecycle: PublicationLifecycleFacts,
): PublicationLifecycleFacts {
  return Object.freeze({
    inFlight: lifecycle.inFlight === null
      ? null
      : freezeInFlightQueryPublicationFacts(lifecycle.inFlight),
    latestDelivered: lifecycle.latestDelivered === null
      ? null
      : freezeDeliveredQueryPublicationFacts(lifecycle.latestDelivered),
    precedingAttemptOutcome: lifecycle.precedingAttemptOutcome === null
      ? null
      : freezePrecedingPublicationAttemptOutcomeFacts(
        lifecycle.precedingAttemptOutcome,
      ),
  });
}

export function freezePendingPublicationSelectionFacts(
  selection: PendingPublicationSelectionFacts,
): PendingPublicationSelectionFacts {
  return Object.freeze({
    publication: makePendingQueryPublication(selection.publication),
    owner: freezePublicationOwnerQueryFacts(selection.owner),
  });
}

export function makeInFlightQueryPublication(input: {
  readonly publication: PendingQueryPublication;
  readonly attemptOrdinal: PublicationAttemptOrdinal;
  readonly firstAttemptAt: PublicationAttemptInstant;
  readonly lastAttemptAt: PublicationAttemptInstant;
  readonly disposition: PublicationAttemptDisposition;
}): InFlightQueryPublication {
  return freezeInFlightQueryPublicationFacts(input);
}
