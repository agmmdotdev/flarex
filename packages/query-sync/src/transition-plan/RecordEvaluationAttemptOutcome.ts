import { Result } from "effect";

import {
  successorQueryGeneration,
  successorQuerySyncWorkRevision,
} from "../kernel/CanonicalValue.js";
import {
  InvalidEvaluationAttemptError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncStateLimitError,
  QuerySyncWorkRevisionExhaustedError,
} from "../kernel/Errors.js";
import {
  isIssuedQueryEvaluationAttempt,
} from "../kernel/EvaluationAttempt.js";
import type {
  QueryEvaluationAttempt,
} from "../kernel/EvaluationAttempt.js";
import type {
  NamespaceCursor,
  ProvisionalQueryState,
  QueryDescriptor,
} from "../kernel/Model.js";
import { validateQuerySyncAuthority } from "../kernel/Authority.js";
import {
  freezeQueryPublicationIdentity,
  makeQueryPublicationIdentity,
  queryPublicationIdentityEquals,
} from "../kernel/Publication.js";
import type {
  QueryPublicationIdentity,
} from "../kernel/Publication.js";
import {
  applyMetricReplacement,
  provisionalMetricContribution,
  scopeMetricContribution,
  validateQuerySyncStateMetrics,
} from "./Accounting.js";
import { QuerySyncTransitionFactError } from "./Errors.js";
import {
  freezeActiveScalarFacts,
  freezeProvisionalFacts,
} from "./Facts.js";
import type { ActiveQueryScalarFacts } from "./Facts.js";
import {
  activeScalarFactsValid,
  provisionalQueryFactsValid,
} from "./LocalInvariants.js";
import { freezeScopeFacts } from "./Model.js";
import type {
  QuerySyncScopeFacts,
  TransitionPlan,
} from "./Model.js";
import {
  blockedEvaluationWorkReceipt,
  eligibleEvaluationAttemptOutcomeReceipt,
  freezeBlockedEvaluationWork,
  historicalEvaluationAttemptOutcomeReceipt,
} from "./EvaluationWork.js";
import type {
  BlockedEvaluationWorkEvidence,
  EvaluationAttemptOutcome,
  RecordEvaluationAttemptOutcomeReceipt,
} from "./EvaluationWork.js";

export interface EvaluationAttemptCompletionFacts {
  readonly identity: QueryPublicationIdentity;
  readonly queryIdentity: QueryDescriptor["queryIdentity"];
  readonly expectedActiveGeneration:
    QueryEvaluationAttempt["expectedActiveGeneration"];
  readonly registrationCursor: NamespaceCursor;
  readonly requestedDirtyThroughSequence:
    QueryEvaluationAttempt["requestedDirtyThroughSequence"];
}

export interface EvaluationAttemptOutcomeQueryFacts {
  readonly descriptor: QueryDescriptor;
  readonly active: ActiveQueryScalarFacts | null;
  readonly provisional: ProvisionalQueryState | null;
  readonly currentCompletion: EvaluationAttemptCompletionFacts | null;
  readonly precedingCompletionIdentity: QueryPublicationIdentity | null;
}

export interface AuthenticatedEvaluationAttemptOutcomeTarget {
  readonly attempt: QueryEvaluationAttempt;
  readonly queryKey: QueryEvaluationAttempt["descriptor"]["queryKey"];
}

export interface RecordEvaluationAttemptOutcomeExpectation {
  readonly scope: QuerySyncScopeFacts;
  readonly query: EvaluationAttemptOutcomeQueryFacts;
}

export interface RecordEvaluationAttemptOutcomeChange {
  readonly _tag: "replaceEvaluationAttemptDisposition";
  readonly queryKey: QueryEvaluationAttempt["descriptor"]["queryKey"];
  readonly provisional: ProvisionalQueryState;
}

export type RecordEvaluationAttemptOutcomePlan = TransitionPlan<
  RecordEvaluationAttemptOutcomeReceipt,
  RecordEvaluationAttemptOutcomeExpectation,
  RecordEvaluationAttemptOutcomeChange
>;

type IssuedEvaluationAttemptMismatch = Exclude<
  InvalidEvaluationAttemptError["reason"],
  "notStateIssued"
>;

export type PlanRecordEvaluationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordEvaluationAttemptOutcome">
  | QueryKeyCollisionError<"recordEvaluationAttemptOutcome">
  | QueryStateNotFoundError<"recordEvaluationAttemptOutcome">
  | QueryGenerationMismatchError<"recordEvaluationAttemptOutcome">
  | InvalidEvaluationAttemptError
  | QuerySyncWorkRevisionExhaustedError<"recordEvaluationAttemptOutcome">
  | QuerySyncStateLimitError
  | QuerySyncTransitionFactError;

function invalidUnissuedAttempt(): InvalidEvaluationAttemptError {
  return new InvalidEvaluationAttemptError({
    operation: "recordEvaluationAttemptOutcome",
    reason: "notStateIssued",
    queryKey: "",
    generation: 0n,
  });
}

function invalidAttempt(
  attempt: QueryEvaluationAttempt,
  reason: IssuedEvaluationAttemptMismatch,
): InvalidEvaluationAttemptError {
  return new InvalidEvaluationAttemptError({
    operation: "recordEvaluationAttemptOutcome",
    reason,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

function factFailure(): QuerySyncTransitionFactError {
  return new QuerySyncTransitionFactError({
    operation: "recordEvaluationAttemptOutcome",
    reason: "evaluationAttemptOutcomeQueryFactsInvalid",
  });
}

function freezeDescriptor(descriptor: QueryDescriptor): QueryDescriptor {
  return Object.freeze({
    queryKey: descriptor.queryKey,
    queryIdentity: descriptor.queryIdentity,
  });
}

function freezeCursor(cursor: NamespaceCursor): NamespaceCursor {
  return Object.freeze({
    namespaceId: cursor.namespaceId,
    syncModelId: cursor.syncModelId,
    sourceEpoch: cursor.sourceEpoch,
    appliedThroughSequence: cursor.appliedThroughSequence,
  });
}

function freezeCompletionFacts(
  completion: EvaluationAttemptCompletionFacts,
): EvaluationAttemptCompletionFacts {
  return Object.freeze({
    identity: freezeQueryPublicationIdentity(completion.identity),
    queryIdentity: completion.queryIdentity,
    expectedActiveGeneration: completion.expectedActiveGeneration,
    registrationCursor: freezeCursor(completion.registrationCursor),
    requestedDirtyThroughSequence:
      completion.requestedDirtyThroughSequence,
  });
}

export function freezeEvaluationAttemptOutcomeQueryFacts(
  query: EvaluationAttemptOutcomeQueryFacts,
): EvaluationAttemptOutcomeQueryFacts {
  return Object.freeze({
    descriptor: freezeDescriptor(query.descriptor),
    active: query.active === null
      ? null
      : freezeActiveScalarFacts(query.active),
    provisional: query.provisional === null
      ? null
      : freezeProvisionalFacts(query.provisional),
    currentCompletion: query.currentCompletion === null
      ? null
      : freezeCompletionFacts(query.currentCompletion),
    precedingCompletionIdentity:
      query.precedingCompletionIdentity === null
        ? null
        : freezeQueryPublicationIdentity(
          query.precedingCompletionIdentity,
        ),
  });
}

export function authenticateRecordEvaluationAttemptOutcomeAttempt(
  value: unknown,
): Result.Result<
  AuthenticatedEvaluationAttemptOutcomeTarget,
  InvalidEvaluationAttemptError
> {
  if (!isIssuedQueryEvaluationAttempt(value)) {
    return Result.fail(invalidUnissuedAttempt());
  }
  return Result.succeed(Object.freeze({
    attempt: value,
    queryKey: value.descriptor.queryKey,
  }));
}

function cursorEquals(left: NamespaceCursor, right: NamespaceCursor): boolean {
  return left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.sourceEpoch === right.sourceEpoch
    && left.appliedThroughSequence === right.appliedThroughSequence;
}

function descriptorEquals(
  left: QueryDescriptor,
  right: QueryDescriptor,
): boolean {
  return left.queryKey === right.queryKey
    && left.queryIdentity === right.queryIdentity;
}

function publicationIdentityMatchesQuery(
  scope: QuerySyncScopeFacts,
  queryKey: QueryDescriptor["queryKey"],
  identity: QueryPublicationIdentity,
): boolean {
  return identity.namespaceId === scope.cursor.namespaceId
    && identity.syncModelId === scope.cursor.syncModelId
    && identity.sourceEpoch === scope.cursor.sourceEpoch
    && identity.queryKey === queryKey;
}

function queryFactsValid(
  scope: QuerySyncScopeFacts,
  query: EvaluationAttemptOutcomeQueryFacts,
): boolean {
  const active = query.active;
  const provisional = query.provisional;
  const completion = query.currentCompletion;
  if (active === null && provisional === null) return false;
  if (active !== null && !activeScalarFactsValid(scope, active)) return false;
  if (
    provisional !== null
    && !provisionalQueryFactsValid(scope, active, provisional)
  ) {
    return false;
  }
  if (active === null) {
    return completion === null && query.precedingCompletionIdentity === null;
  }
  if (
    completion === null
    || !publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      completion.identity,
    )
    || completion.queryIdentity !== query.descriptor.queryIdentity
    || completion.identity.generation !== active.generation
    || completion.registrationCursor.namespaceId
      !== scope.cursor.namespaceId
    || completion.registrationCursor.syncModelId
      !== scope.cursor.syncModelId
    || completion.registrationCursor.sourceEpoch !== scope.cursor.sourceEpoch
    || completion.registrationCursor.appliedThroughSequence
      > scope.cursor.appliedThroughSequence
    || completion.registrationCursor.appliedThroughSequence
      > active.evaluationSnapshotSequence
  ) {
    return false;
  }
  const preceding = query.precedingCompletionIdentity;
  if (completion.expectedActiveGeneration === null) {
    return completion.identity.generation === 1n
      && completion.requestedDirtyThroughSequence === null
      && preceding === null;
  }
  return preceding !== null
    && publicationIdentityMatchesQuery(
      scope,
      query.descriptor.queryKey,
      preceding,
    )
    && preceding.generation === completion.expectedActiveGeneration
    && successorQueryGeneration(completion.expectedActiveGeneration)
      === completion.identity.generation
    && completion.requestedDirtyThroughSequence !== null
    && completion.requestedDirtyThroughSequence
      <= active.evaluationSnapshotSequence;
}

function attemptMatchesProvisional(
  attempt: QueryEvaluationAttempt,
  descriptor: QueryDescriptor,
  provisional: ProvisionalQueryState,
): IssuedEvaluationAttemptMismatch | null {
  if (!descriptorEquals(attempt.descriptor, descriptor)) {
    return "descriptorMismatch";
  }
  if (attempt.generation !== provisional.generation) {
    return "generationMismatch";
  }
  if (
    attempt.expectedActiveGeneration
      !== provisional.expectedActiveGeneration
  ) {
    return "expectedActiveMismatch";
  }
  if (!cursorEquals(attempt.registrationCursor, provisional.registrationCursor)) {
    return "registrationCursorMismatch";
  }
  return attempt.requestedDirtyThroughSequence
      !== provisional.requestedDirtyThroughSequence
    ? "requestedDirtyFrontierMismatch"
    : null;
}

function attemptMatchesCompletion(
  attempt: QueryEvaluationAttempt,
  descriptor: QueryDescriptor,
  completion: EvaluationAttemptCompletionFacts,
): IssuedEvaluationAttemptMismatch | null {
  if (!descriptorEquals(attempt.descriptor, descriptor)) {
    return "descriptorMismatch";
  }
  if (attempt.generation !== completion.identity.generation) {
    return "generationMismatch";
  }
  if (
    attempt.expectedActiveGeneration !== completion.expectedActiveGeneration
  ) {
    return "expectedActiveMismatch";
  }
  if (!cursorEquals(attempt.registrationCursor, completion.registrationCursor)) {
    return "registrationCursorMismatch";
  }
  return attempt.requestedDirtyThroughSequence
      !== completion.requestedDirtyThroughSequence
    ? "requestedDirtyFrontierMismatch"
    : null;
}

function attemptPublicationIdentity(
  attempt: QueryEvaluationAttempt,
): QueryPublicationIdentity {
  return makeQueryPublicationIdentity({
    namespaceId: attempt.namespaceId,
    syncModelId: attempt.syncModelId,
    sourceEpoch: attempt.sourceEpoch,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

function noWritePlan(
  receipt: RecordEvaluationAttemptOutcomeReceipt,
): RecordEvaluationAttemptOutcomePlan {
  return Object.freeze({ _tag: "noWrite", receipt });
}

function blockedWork(
  queryKey: QueryDescriptor["queryKey"],
  generation: ProvisionalQueryState["generation"],
): BlockedEvaluationWorkEvidence {
  return freezeBlockedEvaluationWork({
    queryKey,
    generation,
    reason: "terminalEvaluatorRefusal",
    resetRequired: true,
  });
}

export function planRecordEvaluationAttemptOutcome(input: {
  readonly scope: QuerySyncScopeFacts;
  readonly query: EvaluationAttemptOutcomeQueryFacts | null;
  readonly attempt: QueryEvaluationAttempt;
  readonly outcome: EvaluationAttemptOutcome;
}): Result.Result<
  RecordEvaluationAttemptOutcomePlan,
  PlanRecordEvaluationAttemptOutcomeError
> {
  return Result.gen(function* () {
    const authenticated = yield* authenticateRecordEvaluationAttemptOutcomeAttempt(
      input.attempt,
    );
    const attempt = authenticated.attempt;
    const scope = freezeScopeFacts(input.scope);
    yield* validateQuerySyncAuthority(
      "recordEvaluationAttemptOutcome",
      scope.cursor,
      attempt,
    );
    if (input.query === null) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: authenticated.queryKey,
      }));
    }
    const query = freezeEvaluationAttemptOutcomeQueryFacts(input.query);
    if (query.descriptor.queryKey !== authenticated.queryKey) {
      return yield* Result.fail(factFailure());
    }
    if (query.descriptor.queryIdentity !== attempt.descriptor.queryIdentity) {
      return yield* Result.fail(new QueryKeyCollisionError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: authenticated.queryKey,
      }));
    }
    if (!queryFactsValid(scope, query)) {
      return yield* Result.fail(factFailure());
    }

    const provisional = query.provisional;
    if (provisional !== null && provisional.generation === attempt.generation) {
      const mismatch = attemptMatchesProvisional(
        attempt,
        query.descriptor,
        provisional,
      );
      if (mismatch !== null) {
        return yield* Result.fail(invalidAttempt(attempt, mismatch));
      }
      const evidence = blockedWork(
        query.descriptor.queryKey,
        provisional.generation,
      );
      if (provisional.evaluationDisposition._tag === "blocked") {
        return noWritePlan(blockedEvaluationWorkReceipt(evidence));
      }
      if (input.outcome === "transientExhausted") {
        return noWritePlan(eligibleEvaluationAttemptOutcomeReceipt(
          query.descriptor.queryKey,
          provisional.generation,
        ));
      }
      const revision = yield* successorQuerySyncWorkRevision(
        "recordEvaluationAttemptOutcome",
        scope.evaluationWork.revision,
      );
      const nextProvisional = freezeProvisionalFacts({
        ...provisional,
        evaluationDisposition: {
          _tag: "blocked",
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
        },
      });
      const nextEvaluationWork = Object.freeze({
        revision,
        fairnessAnchor: scope.evaluationWork.fairnessAnchor,
      });
      let nextMetrics = applyMetricReplacement(
        scope.metrics,
        scopeMetricContribution(scope.cursor, scope.evaluationWork),
        scopeMetricContribution(scope.cursor, nextEvaluationWork),
      );
      nextMetrics = applyMetricReplacement(
        nextMetrics,
        provisionalMetricContribution(provisional),
        provisionalMetricContribution(nextProvisional),
      );
      yield* validateQuerySyncStateMetrics(nextMetrics);
      const nextScope = freezeScopeFacts({
        cursor: scope.cursor,
        evaluationWork: nextEvaluationWork,
        metrics: nextMetrics,
      });
      return Object.freeze({
        _tag: "write",
        receipt: blockedEvaluationWorkReceipt(evidence),
        expected: Object.freeze({ scope, query }),
        nextScope,
        change: Object.freeze({
          _tag: "replaceEvaluationAttemptDisposition",
          queryKey: query.descriptor.queryKey,
          provisional: nextProvisional,
        }),
      });
    }

    const active = query.active;
    if (active === null) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: query.descriptor.queryKey,
        expectedGeneration: provisional?.generation ?? null,
        observedGeneration: attempt.generation,
      }));
    }
    const identity = attemptPublicationIdentity(attempt);
    const completion = query.currentCompletion;
    if (
      completion !== null
      && queryPublicationIdentityEquals(completion.identity, identity)
    ) {
      const mismatch = attemptMatchesCompletion(
        attempt,
        query.descriptor,
        completion,
      );
      if (mismatch !== null) {
        return yield* Result.fail(invalidAttempt(attempt, mismatch));
      }
      return noWritePlan(historicalEvaluationAttemptOutcomeReceipt(
        "superseded",
        query.descriptor.queryKey,
        attempt.generation,
        active.generation,
      ));
    }
    if (
      query.precedingCompletionIdentity !== null
      && queryPublicationIdentityEquals(
        query.precedingCompletionIdentity,
        identity,
      )
    ) {
      return noWritePlan(historicalEvaluationAttemptOutcomeReceipt(
        "superseded",
        query.descriptor.queryKey,
        attempt.generation,
        active.generation,
      ));
    }
    if (attempt.generation > active.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: query.descriptor.queryKey,
        expectedGeneration: provisional?.generation ?? active.generation,
        observedGeneration: attempt.generation,
      }));
    }
    return noWritePlan(historicalEvaluationAttemptOutcomeReceipt(
      "recoveryEvidenceExpired",
      query.descriptor.queryKey,
      attempt.generation,
      active.generation,
    ));
  });
}
