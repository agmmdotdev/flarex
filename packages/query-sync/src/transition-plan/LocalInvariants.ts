import { Result } from "effect";

import { successorQueryGeneration } from "../kernel/CanonicalValue.js";
import type {
  ProvisionalQueryState,
} from "../kernel/Model.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import type {
  ActiveQueryScalarFacts,
  BeginQueryFacts,
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
