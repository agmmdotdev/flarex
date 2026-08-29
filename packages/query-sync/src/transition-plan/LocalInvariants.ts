import { Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  captureCanonicalDependencyKey,
  compareCanonicalBase64Url,
  successorQueryGeneration,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
} from "../kernel/CanonicalValue.js";
import type {
  ProvisionalQueryState,
} from "../kernel/Model.js";
import {
  MAX_QUERY_DEPENDENCY_BYTES,
  MAX_QUERY_DEPENDENCY_KEYS,
} from "./Limits.js";
import {
  captureQueryPublicationArtifact,
  queryPublicationIdentityEquals,
} from "../kernel/Publication.js";
import type {
  PendingQueryPublication,
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import type {
  ActiveQueryScalarFacts,
  BeginQueryFacts,
  CompleteQueryMaterialFactsRead,
  CompleteQueryReplayFactsRead,
  CompleteQueryScalarFacts,
  CompletionPublicationLifecycleFacts,
  QueryDependencyFacts,
} from "./Facts.js";
import type { QuerySyncScopeFacts } from "./Model.js";

function factError(
  operation: QuerySyncTransitionFactError["operation"],
  reason: QuerySyncTransitionFactError["reason"],
): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({ operation, reason });
}

function activeFactsValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts,
): boolean {
  return active.evaluationSnapshotSequence <= active.freshThroughSequence
    && active.freshThroughSequence <= scope.cursor.appliedThroughSequence
    && (
      active.dirtyThroughSequence === null
      || (
        active.dirtyThroughSequence > active.freshThroughSequence
        && active.dirtyThroughSequence
          <= scope.cursor.appliedThroughSequence
      )
    );
}

function provisionalFactsValid(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts | null,
  provisional: ProvisionalQueryState,
): boolean {
  const registration = provisional.registrationCursor;
  if (
    provisional.evaluationDisposition._tag === "blocked"
    && (
      provisional.evaluationDisposition.reason !== "terminalEvaluatorRefusal"
      || provisional.evaluationDisposition.resetRequired !== true
    )
  ) {
    return false;
  }
  if (
    registration.namespaceId !== scope.cursor.namespaceId
    || registration.syncModelId !== scope.cursor.syncModelId
    || registration.sourceEpoch !== scope.cursor.sourceEpoch
    || registration.appliedThroughSequence
      > scope.cursor.appliedThroughSequence
  ) {
    return false;
  }
  if (active === null) {
    return provisional.generation === 1n
      && provisional.expectedActiveGeneration === null
      && provisional.requestedDirtyThroughSequence === null;
  }
  return provisional.expectedActiveGeneration === active.generation
    && successorQueryGeneration(active.generation) === provisional.generation
    && provisional.requestedDirtyThroughSequence !== null
    && provisional.requestedDirtyThroughSequence
      > active.freshThroughSequence
    && active.dirtyThroughSequence !== null
    && provisional.requestedDirtyThroughSequence
      <= active.dirtyThroughSequence;
}

export function validateBeginQueryFacts(
  scope: QuerySyncScopeFacts,
  facts: BeginQueryFacts | null,
): Result.Result<void, QuerySyncTransitionFactError> {
  if (facts === null) return Result.succeed(undefined);
  if (facts.active !== null && !activeFactsValid(scope, facts.active)) {
    return Result.fail(factError(
      "beginQueryEvaluation",
      "queryFactsInvalid",
    ));
  }
  if (
    facts.active === null
    && facts.provisional === null
  ) {
    return Result.fail(factError(
      "beginQueryEvaluation",
      "queryFactsInvalid",
    ));
  }
  if (
    facts.provisional !== null
    && !provisionalFactsValid(scope, facts.active, facts.provisional)
  ) {
    return Result.fail(factError(
      "beginQueryEvaluation",
      "queryFactsInvalid",
    ));
  }
  return Result.succeed(undefined);
}

export function validateAffectedActiveFacts(
  scope: QuerySyncScopeFacts,
  active: ActiveQueryScalarFacts,
): Result.Result<void, QuerySyncTransitionFactError> {
  return activeFactsValid(scope, active)
    ? Result.succeed(undefined)
    : Result.fail(factError(
      "applyAdmittedInvalidations",
      "affectedActiveFactsInvalid",
    ));
}

function completeFactFailure(
  reason:
    | "completeQueryFactsInvalid"
    | "completeQueryReplayFactsInvalid"
    | "completeQueryMaterialFactsInvalid"
    | "activeDependenciesInvalid"
    | "completionDependenciesInvalid"
    | "retainedPublicationFactsInvalid"
    | "pendingPublicationFactsInvalid"
    | "completionPublicationLifecycleFactsInvalid",
): Result.Result<never, QuerySyncTransitionFactError> {
  return Result.fail(factError("completeQueryEvaluation", reason));
}

function publicationIdentityMatchesQuery(
  scope: QuerySyncScopeFacts,
  queryKey: CanonicalQueryKey,
  identity: QueryPublicationIdentity,
): boolean {
  return identity.namespaceId === scope.cursor.namespaceId
    && identity.syncModelId === scope.cursor.syncModelId
    && identity.sourceEpoch === scope.cursor.sourceEpoch
    && identity.queryKey === queryKey;
}

function completionScalarMatchesActive(
  active: ActiveQueryScalarFacts,
  completion: NonNullable<CompleteQueryScalarFacts["currentCompletion"]>,
): boolean {
  return completion.identity.generation === active.generation
    && completion.evaluationSnapshotSequence
      === active.evaluationSnapshotSequence
    && completion.refreshedThroughSequence === active.freshThroughSequence
    && completion.relevantThroughSequence === null
    && completion.evaluationAuthorityWitness === active.authorityWitness
    && completion.refreshAuthorityWitness === active.authorityWitness
    && completion.resultDigest === active.resultDigest;
}

function completeQueryScalarFactsValid(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts,
): boolean {
  const active = query.active;
  const provisional = query.provisional;
  const completion = query.currentCompletion;
  if (active === null && provisional === null) return false;
  if (active === null && completion !== null) return false;
  if (active !== null && completion === null) return false;
  if (active !== null && !activeFactsValid(scope, active)) return false;
  if (
    provisional !== null
    && !provisionalFactsValid(scope, active, provisional)
  ) {
    return false;
  }
  if (active === null) {
    return query.precedingCompletionIdentity === null;
  }
  if (
    completion === null
    || !publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      completion.identity,
    )
    || completion.queryIdentity !== query.descriptor.queryIdentity
    || !completionScalarMatchesActive(active, completion)
  ) {
    return false;
  }
  const registration = completion.registrationCursor;
  if (
    registration.namespaceId !== scope.cursor.namespaceId
    || registration.syncModelId !== scope.cursor.syncModelId
    || registration.sourceEpoch !== scope.cursor.sourceEpoch
    || registration.appliedThroughSequence
      > scope.cursor.appliedThroughSequence
    || registration.appliedThroughSequence
      > completion.evaluationSnapshotSequence
  ) {
    return false;
  }
  const preceding = query.precedingCompletionIdentity;
  if (completion.expectedActiveGeneration === null) {
    if (
      completion.identity.generation !== 1n
      || completion.requestedDirtyThroughSequence !== null
      || preceding !== null
    ) {
      return false;
    }
  } else if (
    preceding === null
    || !publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      preceding,
    )
    || preceding.generation !== completion.expectedActiveGeneration
    || successorQueryGeneration(completion.expectedActiveGeneration)
      !== completion.identity.generation
    || completion.requestedDirtyThroughSequence === null
    || completion.requestedDirtyThroughSequence
      > completion.evaluationSnapshotSequence
  ) {
    return false;
  }
  return completion.publicationDisposition._tag !== "pending"
    || queryPublicationIdentityEquals(
      completion.publicationDisposition.identity,
      completion.identity,
    );
}

export function validateCompleteQueryScalarFacts(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts | null,
): Result.Result<void, QuerySyncTransitionFactError> {
  return query === null || completeQueryScalarFactsValid(scope, query)
    ? Result.succeed(undefined)
    : completeFactFailure("completeQueryFactsInvalid");
}

function dependencySetIsCanonical(
  dependencyKeys: readonly QueryDependencyFacts["dependencyKeys"][number][],
): boolean {
  if (dependencyKeys.length > MAX_QUERY_DEPENDENCY_KEYS) return false;
  let decodedBytes = 0;
  let previous: QueryDependencyFacts["dependencyKeys"][number] | undefined;
  for (const dependencyKey of dependencyKeys) {
    if (Result.isFailure(captureCanonicalDependencyKey(dependencyKey))) {
      return false;
    }
    if (
      previous !== undefined
      && compareCanonicalBase64Url(previous, dependencyKey) >= 0
    ) {
      return false;
    }
    previous = dependencyKey;
    decodedBytes += canonicalBase64UrlDecodedLength(dependencyKey);
    if (decodedBytes > MAX_QUERY_DEPENDENCY_BYTES) return false;
  }
  return true;
}

function dependencyFactsValid(
  facts: QueryDependencyFacts,
  expectedQueryKey: CanonicalQueryKey,
  expectedGeneration: QueryGeneration,
): boolean {
  return facts.queryKey === expectedQueryKey
    && facts.generation === expectedGeneration
    && dependencySetIsCanonical(facts.dependencyKeys);
}

export function validateQueryDependencyFacts(
  facts: QueryDependencyFacts,
  expectedQueryKey: CanonicalQueryKey,
  expectedGeneration: QueryGeneration,
  role: "active" | "completion",
): Result.Result<void, QuerySyncTransitionFactError> {
  if (dependencyFactsValid(
    facts,
    expectedQueryKey,
    expectedGeneration,
  )) {
    return Result.succeed(undefined);
  }
  return completeFactFailure(
    role === "active"
      ? "activeDependenciesInvalid"
      : "completionDependenciesInvalid",
  );
}

function dependencyKeysEqual(
  left: readonly QueryDependencyFacts["dependencyKeys"][number][],
  right: readonly QueryDependencyFacts["dependencyKeys"][number][],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function publicationContentIsCanonical(
  publication: PendingQueryPublication,
): boolean {
  return Result.isSuccess(captureQueryPublicationArtifact({
    content: publication.content,
  }));
}

function retainedPublicationValid(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts,
  publication: PendingQueryPublication,
  kind: "pending" | "inFlight",
): boolean {
  const active = query.active;
  if (
    active === null
    || !publicationContentIsCanonical(publication)
    || !publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      publication.identity,
    )
    || publication.identity.generation > active.generation
    || publication.queryIdentity !== query.descriptor.queryIdentity
    || publication.completedThroughSequence
      > scope.cursor.appliedThroughSequence
    || publication.completedThroughSequence > active.freshThroughSequence
    || (kind === "pending" && publication.resultDigest !== active.resultDigest)
  ) {
    return false;
  }
  if (publication.identity.generation !== active.generation) return true;
  const completion = query.currentCompletion;
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
  query: CompleteQueryScalarFacts,
  delivered: CompletionPublicationLifecycleFacts["latestDelivered"],
): boolean {
  if (delivered === null) return true;
  const active = query.active;
  if (
    active === null
    || !publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      delivered.identity,
    )
    || delivered.identity.generation > active.generation
  ) {
    return false;
  }
  if (delivered.identity.generation !== active.generation) return true;
  const completion = query.currentCompletion;
  return completion !== null
    && queryPublicationIdentityEquals(delivered.identity, completion.identity)
    && delivered.resultDigest === completion.resultDigest
    && delivered.resultDigest === active.resultDigest;
}

function precedingOutcomeLinkValid(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts,
  outcome: CompletionPublicationLifecycleFacts["precedingAttemptOutcome"],
): boolean {
  if (outcome === null) return true;
  const active = query.active;
  return active !== null
    && publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      outcome.identity,
    )
    && outcome.identity.generation <= active.generation;
}

function lifecycleCrossLinksValid(
  pending: PendingQueryPublication | null,
  lifecycle: CompletionPublicationLifecycleFacts,
): boolean {
  const inFlight = lifecycle.inFlight;
  const delivered = lifecycle.latestDelivered;
  const outcome = lifecycle.precedingAttemptOutcome;
  if (
    pending !== null
    && inFlight !== null
    && (
      queryPublicationIdentityEquals(pending.identity, inFlight.identity)
      || pending.identity.generation <= inFlight.identity.generation
    )
  ) {
    return false;
  }
  if (
    pending !== null
    && delivered !== null
    && (
      queryPublicationIdentityEquals(pending.identity, delivered.identity)
      || pending.identity.generation <= delivered.identity.generation
    )
  ) {
    return false;
  }
  if (
    inFlight !== null
    && delivered !== null
    && (
      queryPublicationIdentityEquals(inFlight.identity, delivered.identity)
      || inFlight.identity.generation <= delivered.identity.generation
    )
  ) {
    return false;
  }
  if (
    outcome !== null
    && pending !== null
    && queryPublicationIdentityEquals(outcome.identity, pending.identity)
  ) {
    return false;
  }
  if (
    outcome !== null
    && delivered !== null
    && queryPublicationIdentityEquals(outcome.identity, delivered.identity)
    && outcome.resultDigest !== delivered.resultDigest
  ) {
    return false;
  }
  return outcome === null
    || inFlight === null
    || !queryPublicationIdentityEquals(outcome.identity, inFlight.identity)
    || outcome.resultDigest === inFlight.resultDigest;
}

export function validateCompleteQueryReplayFactsRead(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts,
  read: CompleteQueryReplayFactsRead,
): Result.Result<void, QuerySyncTransitionFactError> {
  const completion = query.currentCompletion;
  if (
    read.queryKey !== query.descriptor.queryKey
    || completion === null
  ) {
    return completeFactFailure("completeQueryReplayFactsInvalid");
  }
  return Result.gen(function* () {
    yield* validateQueryDependencyFacts(
      read.completionDependencies,
      read.queryKey,
      completion.identity.generation,
      "completion",
    );
    if (
      completion.publicationDisposition._tag !== "pending"
      && read.retainedPublication !== null
    ) {
      return yield* completeFactFailure("retainedPublicationFactsInvalid");
    }
    if (
      read.retainedPublication !== null
      && (
        completion.publicationDisposition._tag !== "pending"
        || !queryPublicationIdentityEquals(
          read.retainedPublication.identity,
          completion.publicationDisposition.identity,
        )
        || !retainedPublicationValid(
          scope,
          query,
          read.retainedPublication,
          "inFlight",
        )
      )
    ) {
      return yield* completeFactFailure("retainedPublicationFactsInvalid");
    }
  });
}

export const validateCompleteReplayFacts =
  validateCompleteQueryReplayFactsRead;

export function validateCompleteQueryMaterialFactsRead(
  scope: QuerySyncScopeFacts,
  query: CompleteQueryScalarFacts,
  read: CompleteQueryMaterialFactsRead,
): Result.Result<void, QuerySyncTransitionFactError> {
  if (
    read.queryKey !== query.descriptor.queryKey
    || read.lifecycle.queryKey !== read.queryKey
  ) {
    return completeFactFailure("completeQueryMaterialFactsInvalid");
  }
  return Result.gen(function* () {
    const active = query.active;
    if (active === null) {
      if (read.activeDependencies !== null) {
        return yield* completeFactFailure("activeDependenciesInvalid");
      }
    } else if (read.activeDependencies === null) {
      return yield* completeFactFailure("activeDependenciesInvalid");
    } else {
      yield* validateQueryDependencyFacts(
        read.activeDependencies,
        read.queryKey,
        active.generation,
        "active",
      );
    }

    const completion = query.currentCompletion;
    if (completion === null) {
      if (read.completionDependencies !== null) {
        return yield* completeFactFailure("completionDependenciesInvalid");
      }
    } else if (read.completionDependencies === null) {
      return yield* completeFactFailure("completionDependenciesInvalid");
    } else {
      yield* validateQueryDependencyFacts(
        read.completionDependencies,
        read.queryKey,
        completion.identity.generation,
        "completion",
      );
    }
    if (
      read.activeDependencies !== null
      && read.completionDependencies !== null
      && !dependencyKeysEqual(
        read.activeDependencies.dependencyKeys,
        read.completionDependencies.dependencyKeys,
      )
    ) {
      return yield* completeFactFailure("completionDependenciesInvalid");
    }

    if (
      read.pendingPublication !== null
      && !retainedPublicationValid(
        scope,
        query,
        read.pendingPublication,
        "pending",
      )
    ) {
      return yield* completeFactFailure("pendingPublicationFactsInvalid");
    }
    const lifecycle = read.lifecycle;
    if (
      (
        lifecycle.inFlight !== null
        && !retainedPublicationValid(
          scope,
          query,
          lifecycle.inFlight,
          "inFlight",
        )
      )
      || !deliveredPublicationValid(scope, query, lifecycle.latestDelivered)
      || !precedingOutcomeLinkValid(
        scope,
        query,
        lifecycle.precedingAttemptOutcome,
      )
      || !lifecycleCrossLinksValid(read.pendingPublication, lifecycle)
    ) {
      return yield* completeFactFailure(
        "completionPublicationLifecycleFactsInvalid",
      );
    }
  });
}

export const validateCompleteQueryMaterialFacts =
  validateCompleteQueryMaterialFactsRead;
