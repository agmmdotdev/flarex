import { Result } from "effect";

import {
  MAX_PUBLICATION_ATTEMPT_INSTANT,
  MAX_PUBLICATION_ATTEMPT_ORDINAL,
} from "../kernel/CanonicalValue.js";
import type {
  PublicationAttemptInstant,
  PublicationAttemptOrdinal,
  QueryResultDigest,
} from "../kernel/CanonicalValue.js";
import type {
  PrecedingPublicationAttemptOutcome,
  PublicationBlockReason,
} from "../kernel/Model.js";
import {
  captureQueryPublicationArtifact,
  MAX_PENDING_PUBLICATIONS,
  queryPublicationIdentityEquals,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import {
  firstQuerySyncStateMetricLimit,
  publicationLifecycleMetricContribution,
  retainedPublicationMetricContribution,
} from "./Accounting.js";
import {
  QuerySyncTransitionFactError,
} from "./Errors.js";
import type {
  QuerySyncTransitionOperation,
} from "./Errors.js";
import type {
  PendingPublicationSelectionFacts,
  PublicationLifecycleFacts,
  PublicationOwnerQueryFacts,
} from "./PublicationFacts.js";
import type { QuerySyncScopeFacts } from "./Model.js";

type PublicationOperation = Extract<
  QuerySyncTransitionOperation,
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication"
>;

function factFailure(
  operation: PublicationOperation,
  reason: Extract<
    QuerySyncTransitionFactError["reason"],
    | "publicationLifecycleFactsInvalid"
    | "publicationOwnerFactsInvalid"
    | "publicationSelectionFactsInvalid"
  >,
): Result.Result<never, QuerySyncTransitionFactError> {
  return Result.fail(new QuerySyncTransitionFactError({ operation, reason }));
}

function identityHasScopeAuthority(
  scope: QuerySyncScopeFacts,
  identity: QueryPublicationIdentity,
): boolean {
  return identity.namespaceId === scope.cursor.namespaceId
    && identity.syncModelId === scope.cursor.syncModelId
    && identity.sourceEpoch === scope.cursor.sourceEpoch;
}

function identityMatchesOwner(
  scope: QuerySyncScopeFacts,
  owner: PublicationOwnerQueryFacts,
  identity: QueryPublicationIdentity,
): boolean {
  return identityHasScopeAuthority(scope, identity)
    && identity.queryKey === owner.descriptor.queryKey;
}

function publicationContentIsCanonical(
  publication: PendingQueryPublication,
): boolean {
  return Result.isSuccess(captureQueryPublicationArtifact({
    content: publication.content,
  }));
}

function ownerFactsValid(
  scope: QuerySyncScopeFacts,
  owner: PublicationOwnerQueryFacts,
  expectedQueryKey: QueryPublicationIdentity["queryKey"],
): boolean {
  const active = owner.active;
  const completion = owner.currentCompletion;
  if (
    owner.descriptor.queryKey !== expectedQueryKey
    || active === null
    || completion === null
    || active.freshThroughSequence > scope.cursor.appliedThroughSequence
    || !identityMatchesOwner(scope, owner, completion.identity)
    || completion.identity.generation !== active.generation
    || completion.refreshedThroughSequence !== active.freshThroughSequence
    || completion.resultDigest !== active.resultDigest
  ) {
    return false;
  }
  return completion.publicationDisposition._tag === "unchanged"
    || queryPublicationIdentityEquals(
      completion.publicationDisposition.identity,
      completion.identity,
    );
}

function retainedPublicationValid(
  scope: QuerySyncScopeFacts,
  owner: PublicationOwnerQueryFacts,
  publication: PendingQueryPublication,
  kind: "pending" | "inFlight",
): boolean {
  const active = owner.active;
  if (
    active === null
    || !publicationContentIsCanonical(publication)
    || !identityMatchesOwner(scope, owner, publication.identity)
    || publication.identity.generation > active.generation
    || publication.queryIdentity !== owner.descriptor.queryIdentity
    || publication.completedThroughSequence
      > scope.cursor.appliedThroughSequence
    || publication.completedThroughSequence > active.freshThroughSequence
    || (kind === "pending" && publication.resultDigest !== active.resultDigest)
  ) {
    return false;
  }
  if (publication.identity.generation !== active.generation) return true;
  const completion = owner.currentCompletion;
  return completion !== null
    && completion.publicationDisposition._tag === "pending"
    && queryPublicationIdentityEquals(
      publication.identity,
      completion.identity,
    )
    && publication.completedThroughSequence
      === completion.refreshedThroughSequence
    && publication.resultDigest === completion.resultDigest;
}

function deliveredPublicationValid(
  scope: QuerySyncScopeFacts,
  owner: PublicationOwnerQueryFacts,
  identity: QueryPublicationIdentity,
  resultDigest: QueryResultDigest,
): boolean {
  const active = owner.active;
  if (
    active === null
    || !identityMatchesOwner(scope, owner, identity)
    || identity.generation > active.generation
  ) {
    return false;
  }
  if (identity.generation !== active.generation) return true;
  const completion = owner.currentCompletion;
  return completion !== null
    && queryPublicationIdentityEquals(identity, completion.identity)
    && resultDigest === completion.resultDigest
    && resultDigest === active.resultDigest;
}

function isPublicationBlockReason(value: unknown): value is PublicationBlockReason {
  return value === "terminalPublisherRefusal"
    || value === "attemptLimitReached"
    || value === "ageLimitReached";
}

function ordinalIsValid(value: unknown): value is PublicationAttemptOrdinal {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= MAX_PUBLICATION_ATTEMPT_ORDINAL;
}

function attemptInstantIsValid(value: unknown): boolean {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_PUBLICATION_ATTEMPT_INSTANT;
}

function inFlightStateValid(
  lifecycle: PublicationLifecycleFacts,
): boolean {
  const inFlight = lifecycle.inFlight;
  if (inFlight === null) return true;
  if (
    !ordinalIsValid(inFlight.attemptOrdinal)
    || !attemptInstantIsValid(inFlight.firstAttemptAt)
    || !attemptInstantIsValid(inFlight.lastAttemptAt)
    || inFlight.lastAttemptAt < inFlight.firstAttemptAt
  ) {
    return false;
  }
  const disposition = inFlight.disposition;
  return disposition._tag === "ready"
    || disposition._tag === "uncertain"
    || (
      disposition._tag === "blocked"
      && isPublicationBlockReason(disposition.reason)
      && disposition.resetRequired === true
    );
}

function precedingOutcomeReceiptValid(
  preceding: PrecedingPublicationAttemptOutcome,
): boolean {
  if (
    !ordinalIsValid(preceding.attemptOrdinal)
    || (
      preceding.outcome !== "knownNotAppended"
      && preceding.outcome !== "outcomeUnknown"
      && preceding.outcome !== "terminalRefusal"
    )
  ) {
    return false;
  }
  const receipt = preceding.receipt;
  if (receipt._tag === "recorded") {
    const expectedDisposition = preceding.outcome === "knownNotAppended"
      ? "ready"
      : "uncertain";
    return preceding.outcome !== "terminalRefusal"
      && preceding.attemptOrdinal !== MAX_PUBLICATION_ATTEMPT_ORDINAL
      && receipt.nextAttemptOrdinal === preceding.attemptOrdinal + 1
      && receipt.nextDisposition === expectedDisposition;
  }
  const expectedReason: PublicationBlockReason =
    preceding.outcome === "terminalRefusal"
      ? "terminalPublisherRefusal"
      : preceding.attemptOrdinal === MAX_PUBLICATION_ATTEMPT_ORDINAL
        ? "attemptLimitReached"
        : "ageLimitReached";
  return receipt.reason === expectedReason && receipt.resetRequired === true;
}

function precedingMatchesInFlight(
  lifecycle: PublicationLifecycleFacts,
): boolean {
  return lifecycle.precedingAttemptOutcome !== null
    && lifecycle.inFlight !== null
    && queryPublicationIdentityEquals(
      lifecycle.precedingAttemptOutcome.identity,
      lifecycle.inFlight.publication.identity,
    );
}

function lifecycleLinksValid(lifecycle: PublicationLifecycleFacts): boolean {
  const inFlight = lifecycle.inFlight;
  const delivered = lifecycle.latestDelivered;
  const preceding = lifecycle.precedingAttemptOutcome;
  if (
    inFlight !== null
    && delivered !== null
    && inFlight.publication.identity.queryKey === delivered.identity.queryKey
    && inFlight.publication.identity.generation <= delivered.identity.generation
  ) {
    return false;
  }
  if (
    preceding !== null
    && delivered !== null
    && queryPublicationIdentityEquals(preceding.identity, delivered.identity)
    && preceding.resultDigest !== delivered.resultDigest
  ) {
    return false;
  }
  const precedingMatches = precedingMatchesInFlight(lifecycle);
  if (precedingMatches && preceding !== null && inFlight !== null) {
    if (preceding.resultDigest !== inFlight.publication.resultDigest) {
      return false;
    }
    const receipt = preceding.receipt;
    if (receipt._tag === "recorded") {
      const dispositionMatches = inFlight.disposition._tag === "blocked"
        ? inFlight.disposition.reason === "ageLimitReached"
        : inFlight.disposition._tag === receipt.nextDisposition;
      if (
        inFlight.attemptOrdinal !== receipt.nextAttemptOrdinal
        || !dispositionMatches
      ) {
        return false;
      }
    } else if (
      inFlight.attemptOrdinal !== preceding.attemptOrdinal
      || inFlight.disposition._tag !== "blocked"
      || inFlight.disposition.reason !== receipt.reason
    ) {
      return false;
    }
  }
  if (inFlight !== null) {
    if (inFlight.attemptOrdinal > 1 && !precedingMatches) return false;
    if (
      inFlight.disposition._tag === "uncertain"
      && inFlight.attemptOrdinal === 1
    ) {
      return false;
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
          && !precedingMatches
        )
        || (
          inFlight.disposition.reason === "ageLimitReached"
          && inFlight.attemptOrdinal > 1
          && !precedingMatches
        )
      )
    ) {
      return false;
    }
  }
  return preceding === null
    || delivered !== null
    || precedingMatches;
}

function lifecycleAuthoritiesValid(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
): boolean {
  return (
    lifecycle.inFlight === null
    || identityHasScopeAuthority(
      scope,
      lifecycle.inFlight.publication.identity,
    )
  ) && (
    lifecycle.latestDelivered === null
    || identityHasScopeAuthority(scope, lifecycle.latestDelivered.identity)
  ) && (
    lifecycle.precedingAttemptOutcome === null
    || identityHasScopeAuthority(
      scope,
      lifecycle.precedingAttemptOutcome.identity,
    )
  );
}

function lifecycleMetricsValid(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
): boolean {
  const expectedInFlightCount = lifecycle.inFlight === null ? 0 : 1;
  const lifecycleContribution = publicationLifecycleMetricContribution(
    lifecycle,
  );
  const inFlightContribution = lifecycle.inFlight === null
    ? null
    : retainedPublicationMetricContribution(
      lifecycle.inFlight.publication,
      "inFlight",
    );
  const metricValues = [
    scope.metrics.queryCount,
    scope.metrics.retainedIdentityBytes,
    scope.metrics.dependencyMemberships,
    scope.metrics.pendingPublicationCount,
    scope.metrics.inFlightPublicationCount,
    scope.metrics.retainedPublicationContentBytes,
    scope.metrics.settlementEnvelopeBytes,
    scope.metrics.countedCanonicalBytes,
  ];
  return metricValues.every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  )
    && firstQuerySyncStateMetricLimit(scope.metrics) === null
    && scope.metrics.pendingPublicationCount >= 0
    && scope.metrics.pendingPublicationCount <= MAX_PENDING_PUBLICATIONS
    && scope.metrics.inFlightPublicationCount === expectedInFlightCount
    && scope.metrics.retainedPublicationContentBytes
      >= (inFlightContribution?.retainedPublicationContentBytes ?? 0)
    && scope.metrics.settlementEnvelopeBytes
      === lifecycleContribution.settlementEnvelopeBytes
    && scope.metrics.countedCanonicalBytes
      >= lifecycleContribution.countedCanonicalBytes
        + (inFlightContribution?.countedCanonicalBytes ?? 0);
}

function lifecycleEntriesMatchOwner(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  owner: PublicationOwnerQueryFacts,
): boolean {
  const ownerQueryKey = owner.descriptor.queryKey;
  const inFlight = lifecycle.inFlight;
  if (
    inFlight !== null
    && inFlight.publication.identity.queryKey === ownerQueryKey
    && !retainedPublicationValid(
      scope,
      owner,
      inFlight.publication,
      "inFlight",
    )
  ) {
    return false;
  }
  const delivered = lifecycle.latestDelivered;
  if (
    delivered !== null
    && delivered.identity.queryKey === ownerQueryKey
    && !deliveredPublicationValid(
      scope,
      owner,
      delivered.identity,
      delivered.resultDigest,
    )
  ) {
    return false;
  }
  const preceding = lifecycle.precedingAttemptOutcome;
  return preceding === null
    || preceding.identity.queryKey !== ownerQueryKey
    || (
      owner.active !== null
      && identityMatchesOwner(scope, owner, preceding.identity)
      && preceding.identity.generation <= owner.active.generation
    );
}

export function validatePublicationLifecycleFacts(
  operation: PublicationOperation,
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
): Result.Result<void, QuerySyncTransitionFactError> {
  if (
    !inFlightStateValid(lifecycle)
    || (
      lifecycle.precedingAttemptOutcome !== null
      && !precedingOutcomeReceiptValid(lifecycle.precedingAttemptOutcome)
    )
    || !lifecycleAuthoritiesValid(scope, lifecycle)
    || !lifecycleLinksValid(lifecycle)
    || !lifecycleMetricsValid(scope, lifecycle)
  ) {
    return factFailure(operation, "publicationLifecycleFactsInvalid");
  }
  return Result.succeed(undefined);
}

export function validatePublicationOwnerFacts(
  operation: PublicationOperation,
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  owner: PublicationOwnerQueryFacts,
  expectedIdentity: QueryPublicationIdentity,
): Result.Result<void, QuerySyncTransitionFactError> {
  if (
    !ownerFactsValid(scope, owner, expectedIdentity.queryKey)
    || !identityMatchesOwner(scope, owner, expectedIdentity)
    || !lifecycleEntriesMatchOwner(scope, lifecycle, owner)
  ) {
    return factFailure(operation, "publicationOwnerFactsInvalid");
  }
  return Result.succeed(undefined);
}

export function validateInFlightPublicationOwnerFacts(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  owner: PublicationOwnerQueryFacts,
): Result.Result<void, QuerySyncTransitionFactError> {
  const inFlight = lifecycle.inFlight;
  if (inFlight === null) {
    return factFailure("claimPublication", "publicationOwnerFactsInvalid");
  }
  return Result.gen(function* () {
    yield* validatePublicationOwnerFacts(
      "claimPublication",
      scope,
      lifecycle,
      owner,
      inFlight.publication.identity,
    );
    if (!retainedPublicationValid(
      scope,
      owner,
      inFlight.publication,
      "inFlight",
    )) {
      return yield* factFailure(
        "claimPublication",
        "publicationOwnerFactsInvalid",
      );
    }
  });
}

function pendingSelectionLinksValid(
  lifecycle: PublicationLifecycleFacts,
  pending: PendingQueryPublication,
): boolean {
  const delivered = lifecycle.latestDelivered;
  const preceding = lifecycle.precedingAttemptOutcome;
  return (
    delivered === null
    || delivered.identity.queryKey !== pending.identity.queryKey
    || pending.identity.generation > delivered.identity.generation
  ) && (
    preceding === null
    || !queryPublicationIdentityEquals(preceding.identity, pending.identity)
  );
}

export function validatePendingPublicationSelectionFacts(
  scope: QuerySyncScopeFacts,
  lifecycle: PublicationLifecycleFacts,
  selection: PendingPublicationSelectionFacts,
): Result.Result<void, QuerySyncTransitionFactError> {
  if (
    lifecycle.inFlight !== null
    || !ownerFactsValid(
      scope,
      selection.owner,
      selection.publication.identity.queryKey,
    )
    || !retainedPublicationValid(
      scope,
      selection.owner,
      selection.publication,
      "pending",
    )
    || !lifecycleEntriesMatchOwner(scope, lifecycle, selection.owner)
    || !pendingSelectionLinksValid(lifecycle, selection.publication)
  ) {
    return factFailure("claimPublication", "publicationSelectionFactsInvalid");
  }
  return Result.succeed(undefined);
}

export function clampedPublicationInstant(
  observedNow: PublicationAttemptInstant,
  lastAttemptAt: PublicationAttemptInstant,
): PublicationAttemptInstant {
  return observedNow < lastAttemptAt ? lastAttemptAt : observedNow;
}

export function publicationAgeLimitReached(
  firstAttemptAt: PublicationAttemptInstant,
  clampedNow: PublicationAttemptInstant,
  maximumAgeMilliseconds: number,
): boolean {
  return clampedNow - firstAttemptAt >= maximumAgeMilliseconds;
}
