import { Result } from "effect";

import {
  compareCanonicalBase64Url,
  successorQueryGeneration,
  successorQuerySyncWorkRevision,
} from "./CanonicalValue.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
  QuerySyncWorkRevision,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
} from "./CanonicalValue.js";
import {
  InvalidEvaluationAttemptError,
  InvalidEvaluationWorkContinuationError,
  InvalidEvaluationWorkScanRequestError,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncInvariantDefect,
} from "./Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncWorkRevisionExhaustedError,
} from "./Errors.js";
import {
  blockedQueryEvaluationDisposition,
  findQueryState,
  isIssuedQueryEvaluationAttempt,
  makeQueryEvaluationAttempt,
  readyQueryEvaluationDisposition,
  rebuildQuerySyncState,
} from "./Model.js";
import type {
  BuildQuerySyncStateError,
  NamespaceCursor,
  ProvisionalQueryState,
  QueryCompletionFingerprint,
  QueryDescriptor,
  QueryEvaluationAttempt,
  QueryState,
  QuerySyncState,
} from "./Model.js";
import { validateQuerySyncAuthority } from "./Policy.js";
import { makeQueryPublicationIdentity } from "./Publication.js";
import type { QueryPublicationIdentity } from "./Publication.js";

export const MAX_EVALUATION_WORK_QUERY_INSPECTIONS = 4_096;

export interface BlockedEvaluationWorkEvidence {
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
  readonly reason: "terminalEvaluatorRefusal";
  readonly resetRequired: true;
}

interface EvaluationWorkScanContinuationFields {
  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly observedWorkRevision: QuerySyncWorkRevision;
  readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
  readonly lastInspectedQueryKey: CanonicalQueryKey | null;
  readonly wrapped: boolean;
  readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;
}

const issuedContinuations = new WeakSet<object>();

class IssuedEvaluationWorkScanContinuation
  implements EvaluationWorkScanContinuationFields {
  declare private readonly issuedEvaluationWorkScanContinuation: void;

  readonly namespaceId: SyncNamespaceId;
  readonly syncModelId: SyncModelId;
  readonly sourceEpoch: SyncEpoch;
  readonly observedWorkRevision: QuerySyncWorkRevision;
  readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
  readonly lastInspectedQueryKey: CanonicalQueryKey | null;
  readonly wrapped: boolean;
  readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;

  constructor(input: EvaluationWorkScanContinuationFields) {
    this.namespaceId = input.namespaceId;
    this.syncModelId = input.syncModelId;
    this.sourceEpoch = input.sourceEpoch;
    this.observedWorkRevision = input.observedWorkRevision;
    this.scanStartFairnessAnchor = input.scanStartFairnessAnchor;
    this.lastInspectedQueryKey = input.lastInspectedQueryKey;
    this.wrapped = input.wrapped;
    this.lowestBlockedWork = input.lowestBlockedWork === null
      ? null
      : freezeBlockedWork(input.lowestBlockedWork);
    issuedContinuations.add(this);
    Object.freeze(this);
  }
}

export type EvaluationWorkScanContinuation =
  IssuedEvaluationWorkScanContinuation;

export interface EvaluationWorkScanRequest {
  readonly maximumQueryInspections: unknown;
  readonly continuation: EvaluationWorkScanContinuation | null;
}

export type EvaluationAttemptOutcome =
  | "transientExhausted"
  | "terminalRefusal";

export type ClaimEvaluationWorkDecision =
  | Readonly<{
    readonly _tag: "claimed";
    readonly state: QuerySyncState;
    readonly attempt: QueryEvaluationAttempt;
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "continued";
    readonly state: QuerySyncState;
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "scanRestarted";
    readonly state: QuerySyncState;
    readonly continuation: EvaluationWorkScanContinuation;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly state: QuerySyncState;
    readonly blockedWork: BlockedEvaluationWorkEvidence;
  }>
  | Readonly<{
    readonly _tag: "none";
    readonly state: QuerySyncState;
  }>;

export type RecordEvaluationAttemptOutcomeDecision =
  | Readonly<{
    readonly _tag: "eligible";
    readonly state: QuerySyncState;
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "blocked";
    readonly state: QuerySyncState;
    readonly blockedWork: BlockedEvaluationWorkEvidence;
  }>
  | Readonly<{
    readonly _tag: "superseded";
    readonly state: QuerySyncState;
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>
  | Readonly<{
    readonly _tag: "recoveryEvidenceExpired";
    readonly state: QuerySyncState;
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly activeGeneration: QueryGeneration;
  }>;

export type ClaimEvaluationWorkError =
  | InvalidEvaluationWorkScanRequestError
  | QuerySyncAuthorityError<"claimEvaluationWork">
  | InvalidEvaluationWorkContinuationError
  | QueryGenerationExhaustedError<"claimEvaluationWork">
  | QuerySyncWorkRevisionExhaustedError<"claimEvaluationWork">
  | BuildQuerySyncStateError;

export type RecordEvaluationAttemptOutcomeError =
  | QuerySyncAuthorityError<"recordEvaluationAttemptOutcome">
  | QueryKeyCollisionError<"recordEvaluationAttemptOutcome">
  | QueryStateNotFoundError<"recordEvaluationAttemptOutcome">
  | QueryGenerationMismatchError<"recordEvaluationAttemptOutcome">
  | InvalidEvaluationAttemptError
  | QuerySyncWorkRevisionExhaustedError<"recordEvaluationAttemptOutcome">
  | BuildQuerySyncStateError;

type IssuedEvaluationAttemptMismatch = Exclude<
  InvalidEvaluationAttemptError["reason"],
  "notStateIssued"
>;

function freezeBlockedWork(
  blockedWork: BlockedEvaluationWorkEvidence,
): BlockedEvaluationWorkEvidence {
  return Object.freeze({
    queryKey: blockedWork.queryKey,
    generation: blockedWork.generation,
    reason: "terminalEvaluatorRefusal",
    resetRequired: true,
  });
}

function issueContinuation(
  state: QuerySyncState,
  input: {
    readonly scanStartFairnessAnchor: CanonicalQueryKey | null;
    readonly lastInspectedQueryKey: CanonicalQueryKey | null;
    readonly wrapped: boolean;
    readonly lowestBlockedWork: BlockedEvaluationWorkEvidence | null;
  },
): EvaluationWorkScanContinuation {
  return new IssuedEvaluationWorkScanContinuation({
    namespaceId: state.cursor.namespaceId,
    syncModelId: state.cursor.syncModelId,
    sourceEpoch: state.cursor.sourceEpoch,
    observedWorkRevision: state.evaluationWork.revision,
    scanStartFairnessAnchor: input.scanStartFairnessAnchor,
    lastInspectedQueryKey: input.lastInspectedQueryKey,
    wrapped: input.wrapped,
    lowestBlockedWork: input.lowestBlockedWork,
  });
}

function freshContinuation(
  state: QuerySyncState,
): EvaluationWorkScanContinuation {
  return issueContinuation(state, {
    scanStartFairnessAnchor: state.evaluationWork.fairnessAnchor,
    lastInspectedQueryKey: null,
    wrapped: false,
    lowestBlockedWork: null,
  });
}

function scanOrder(
  state: QuerySyncState,
  anchor: CanonicalQueryKey | null,
): readonly QueryState[] {
  if (anchor === null || state.queries.length === 0) return state.queries;
  const anchorIndex = state.queries.findIndex(
    (query) => query.descriptor.queryKey === anchor,
  );
  if (anchorIndex < 0) {
    throw new QuerySyncInvariantDefect({
      operation: "claimEvaluationWork",
      invariant: "fairnessAnchorQueryMissing",
    });
  }
  return Object.freeze([
    ...state.queries.slice(anchorIndex + 1),
    ...state.queries.slice(0, anchorIndex + 1),
  ]);
}

function isWrapped(
  anchor: CanonicalQueryKey | null,
  queryKey: CanonicalQueryKey,
): boolean {
  return anchor !== null
    && compareCanonicalBase64Url(queryKey, anchor) <= 0;
}

function blockedWorkForQuery(
  query: QueryState,
): BlockedEvaluationWorkEvidence | null {
  const provisional = query.provisional;
  return provisional?.evaluationDisposition._tag === "blocked"
    ? freezeBlockedWork({
      queryKey: query.descriptor.queryKey,
      generation: provisional.generation,
      reason: "terminalEvaluatorRefusal",
      resetRequired: true,
    })
    : null;
}

function lowerBlockedWork(
  current: BlockedEvaluationWorkEvidence | null,
  candidate: BlockedEvaluationWorkEvidence | null,
): BlockedEvaluationWorkEvidence | null {
  if (candidate === null) return current;
  if (current === null) return candidate;
  return compareCanonicalBase64Url(candidate.queryKey, current.queryKey) < 0
    ? candidate
    : current;
}

function blockedWorkEquals(
  left: BlockedEvaluationWorkEvidence | null,
  right: BlockedEvaluationWorkEvidence | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.queryKey === right.queryKey
    && left.generation === right.generation
    && left.reason === right.reason
    && left.resetRequired === right.resetRequired;
}

function invalidContinuation(): InvalidEvaluationWorkContinuationError {
  return new InvalidEvaluationWorkContinuationError({
    operation: "claimEvaluationWork",
    reason: "notStateIssued",
  });
}

function revalidateContinuation(
  state: QuerySyncState,
  continuation: EvaluationWorkScanContinuation,
): Result.Result<
  { readonly order: readonly QueryState[]; readonly nextIndex: number },
  InvalidEvaluationWorkContinuationError
> {
  if (!issuedContinuations.has(continuation)) {
    return Result.fail(invalidContinuation());
  }
  const order = scanOrder(state, continuation.scanStartFairnessAnchor);
  if (continuation.lastInspectedQueryKey === null) {
    return continuation.wrapped || continuation.lowestBlockedWork !== null
      ? Result.fail(invalidContinuation())
      : Result.succeed({ order, nextIndex: 0 });
  }
  const lastIndex = order.findIndex((query) => (
    query.descriptor.queryKey === continuation.lastInspectedQueryKey
  ));
  if (lastIndex < 0) return Result.fail(invalidContinuation());
  const expectedWrapped = isWrapped(
    continuation.scanStartFairnessAnchor,
    continuation.lastInspectedQueryKey,
  );
  let expectedBlocked: BlockedEvaluationWorkEvidence | null = null;
  for (let index = 0; index <= lastIndex; index += 1) {
    const query = order[index];
    if (query === undefined) return Result.fail(invalidContinuation());
    expectedBlocked = lowerBlockedWork(
      expectedBlocked,
      blockedWorkForQuery(query),
    );
  }
  return continuation.wrapped !== expectedWrapped
      || !blockedWorkEquals(
        continuation.lowestBlockedWork,
        expectedBlocked,
      )
    ? Result.fail(invalidContinuation())
    : Result.succeed({ order, nextIndex: lastIndex + 1 });
}

function replaceQuery(
  state: QuerySyncState,
  replacement: QueryState,
): readonly QueryState[] {
  return state.queries.map((query) => (
    query.descriptor.queryKey === replacement.descriptor.queryKey
      ? replacement
      : query
  ));
}

function makeProvisionalAttempt(
  state: QuerySyncState,
  query: QueryState,
  provisional: ProvisionalQueryState,
): QueryEvaluationAttempt {
  return makeQueryEvaluationAttempt({
    namespaceId: state.cursor.namespaceId,
    syncModelId: state.cursor.syncModelId,
    sourceEpoch: state.cursor.sourceEpoch,
    descriptor: query.descriptor,
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: provisional.registrationCursor,
    requestedDirtyThroughSequence: provisional.requestedDirtyThroughSequence,
  });
}

function claimExistingProvisional(
  state: QuerySyncState,
  query: QueryState,
  provisional: ProvisionalQueryState,
): Result.Result<ClaimEvaluationWorkDecision, BuildQuerySyncStateError> {
  return rebuildQuerySyncState(state, {
    evaluationWork: {
      revision: state.evaluationWork.revision,
      fairnessAnchor: query.descriptor.queryKey,
    },
  }).pipe(Result.map((nextState) => Object.freeze({
    _tag: "claimed" as const,
    state: nextState,
    attempt: makeProvisionalAttempt(nextState, query, provisional),
    continuation: freshContinuation(nextState),
  })));
}

function claimDirtyActive(
  state: QuerySyncState,
  query: QueryState,
): Result.Result<
  ClaimEvaluationWorkDecision,
  | QueryGenerationExhaustedError<"claimEvaluationWork">
  | QuerySyncWorkRevisionExhaustedError<"claimEvaluationWork">
  | BuildQuerySyncStateError
> {
  const active = query.active;
  if (active === null || active.dirtyThroughSequence === null) {
    throw new QuerySyncInvariantDefect({
      operation: "claimEvaluationWork",
      invariant: "dirtyEvaluationClaimUnexpectedDecision",
    });
  }
  const generation = successorQueryGeneration(active.generation);
  if (generation === null) {
    return Result.fail(new QueryGenerationExhaustedError({
      operation: "claimEvaluationWork",
      queryKey: query.descriptor.queryKey,
      currentGeneration: active.generation,
    }));
  }
  return successorQuerySyncWorkRevision(
    "claimEvaluationWork",
    state.evaluationWork.revision,
  ).pipe(Result.flatMap((revision) => {
    const provisional: ProvisionalQueryState = {
      generation,
      expectedActiveGeneration: active.generation,
      registrationCursor: state.cursor,
      requestedDirtyThroughSequence: active.dirtyThroughSequence,
      evaluationDisposition: readyQueryEvaluationDisposition(),
    };
    const replacement: QueryState = {
      ...query,
      provisional,
    };
    return rebuildQuerySyncState(state, {
      queries: replaceQuery(state, replacement),
      evaluationWork: {
        revision,
        fairnessAnchor: query.descriptor.queryKey,
      },
    }).pipe(Result.map((nextState) => Object.freeze({
      _tag: "claimed" as const,
      state: nextState,
      attempt: makeProvisionalAttempt(nextState, replacement, provisional),
      continuation: freshContinuation(nextState),
    })));
  }));
}

export function claimEvaluationWork(
  state: QuerySyncState,
  request: EvaluationWorkScanRequest,
): Result.Result<ClaimEvaluationWorkDecision, ClaimEvaluationWorkError> {
  const maximumQueryInspections = request.maximumQueryInspections;
  if (
    typeof maximumQueryInspections !== "number"
    || !Number.isSafeInteger(maximumQueryInspections)
    || maximumQueryInspections < 1
    || maximumQueryInspections > MAX_EVALUATION_WORK_QUERY_INSPECTIONS
  ) {
    return Result.fail(new InvalidEvaluationWorkScanRequestError({
      operation: "claimEvaluationWork",
      reason: "maximumQueryInspectionsOutOfRange",
      maximum: MAX_EVALUATION_WORK_QUERY_INSPECTIONS,
      observed: maximumQueryInspections,
    }));
  }

  return Result.gen(function* () {
    let continuation: EvaluationWorkScanContinuation;
    if (request.continuation === null) {
      continuation = freshContinuation(state);
    } else {
      if (!issuedContinuations.has(request.continuation)) {
        return yield* Result.fail(invalidContinuation());
      }
      yield* validateQuerySyncAuthority(
        "claimEvaluationWork",
        state.cursor,
        request.continuation,
      );
      if (
        request.continuation.observedWorkRevision
          !== state.evaluationWork.revision
        || request.continuation.scanStartFairnessAnchor
          !== state.evaluationWork.fairnessAnchor
      ) {
        return Object.freeze({
          _tag: "scanRestarted" as const,
          state,
          continuation: freshContinuation(state),
        });
      }
      continuation = request.continuation;
    }

    const { order, nextIndex } = yield* revalidateContinuation(
      state,
      continuation,
    );
    if (order.length === 0) {
      return Object.freeze({ _tag: "none" as const, state });
    }

    let lowestBlocked = continuation.lowestBlockedWork;
    const stopIndex = Math.min(
      order.length,
      nextIndex + maximumQueryInspections,
    );
    for (let index = nextIndex; index < stopIndex; index += 1) {
      const query = order[index];
      if (query === undefined) {
        throw new QuerySyncInvariantDefect({
          operation: "claimEvaluationWork",
          invariant: "dirtyEvaluationClaimUnexpectedDecision",
        });
      }
      const provisional = query.provisional;
      if (provisional !== null) {
        if (provisional.evaluationDisposition._tag === "ready") {
          return yield* claimExistingProvisional(state, query, provisional);
        }
        lowestBlocked = lowerBlockedWork(
          lowestBlocked,
          blockedWorkForQuery(query),
        );
      } else if (
        query.active !== null
        && query.active.dirtyThroughSequence !== null
      ) {
        return yield* claimDirtyActive(state, query);
      }
    }

    if (stopIndex === order.length) {
      return lowestBlocked === null
        ? Object.freeze({ _tag: "none" as const, state })
        : Object.freeze({
          _tag: "blocked" as const,
          state,
          blockedWork: freezeBlockedWork(lowestBlocked),
        });
    }

    const lastInspected = order[stopIndex - 1];
    if (lastInspected === undefined) {
      throw new QuerySyncInvariantDefect({
        operation: "claimEvaluationWork",
        invariant: "dirtyEvaluationClaimUnexpectedDecision",
      });
    }
    return Object.freeze({
      _tag: "continued" as const,
      state,
      continuation: issueContinuation(state, {
        scanStartFairnessAnchor: continuation.scanStartFairnessAnchor,
        lastInspectedQueryKey: lastInspected.descriptor.queryKey,
        wrapped: isWrapped(
          continuation.scanStartFairnessAnchor,
          lastInspected.descriptor.queryKey,
        ),
        lowestBlockedWork: lowestBlocked,
      }),
    });
  });
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

function attemptMismatchWithCurrentCompletion(
  attempt: QueryEvaluationAttempt,
  descriptor: QueryDescriptor,
  completion: QueryCompletionFingerprint,
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

function publicationIdentityForAttempt(
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

export function recordEvaluationAttemptOutcome(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  outcome: EvaluationAttemptOutcome,
): Result.Result<
  RecordEvaluationAttemptOutcomeDecision,
  RecordEvaluationAttemptOutcomeError
> {
  return Result.gen(function* () {
    if (!isIssuedQueryEvaluationAttempt(attempt)) {
      return yield* Result.fail(invalidUnissuedAttempt());
    }
    yield* validateQuerySyncAuthority(
      "recordEvaluationAttemptOutcome",
      state.cursor,
      attempt,
    );
    const query = findQueryState(state, attempt.descriptor.queryKey);
    if (query === undefined) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: attempt.descriptor.queryKey,
      }));
    }
    if (query.descriptor.queryIdentity !== attempt.descriptor.queryIdentity) {
      return yield* Result.fail(new QueryKeyCollisionError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: attempt.descriptor.queryKey,
      }));
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
      if (provisional.evaluationDisposition._tag === "blocked") {
        return Object.freeze({
          _tag: "blocked" as const,
          state,
          blockedWork: freezeBlockedWork({
            queryKey: query.descriptor.queryKey,
            generation: provisional.generation,
            reason: "terminalEvaluatorRefusal",
            resetRequired: true,
          }),
        });
      }
      if (outcome === "transientExhausted") {
        return Object.freeze({
          _tag: "eligible" as const,
          state,
          queryKey: query.descriptor.queryKey,
          generation: provisional.generation,
        });
      }
      const revision = yield* successorQuerySyncWorkRevision(
        "recordEvaluationAttemptOutcome",
        state.evaluationWork.revision,
      );
      const replacement: QueryState = {
        ...query,
        provisional: {
          ...provisional,
          evaluationDisposition: blockedQueryEvaluationDisposition(),
        },
      };
      const nextState = yield* rebuildQuerySyncState(state, {
        queries: replaceQuery(state, replacement),
        evaluationWork: {
          ...state.evaluationWork,
          revision,
        },
      });
      return Object.freeze({
        _tag: "blocked" as const,
        state: nextState,
        blockedWork: freezeBlockedWork({
          queryKey: query.descriptor.queryKey,
          generation: provisional.generation,
          reason: "terminalEvaluatorRefusal",
          resetRequired: true,
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
    const attemptIdentity = publicationIdentityForAttempt(attempt);
    const currentCompletion = query.currentCompletion;
    const matchesCurrent = currentCompletion !== null
      && currentCompletion.identity.namespaceId === attemptIdentity.namespaceId
      && currentCompletion.identity.syncModelId === attemptIdentity.syncModelId
      && currentCompletion.identity.sourceEpoch === attemptIdentity.sourceEpoch
      && currentCompletion.identity.queryKey === attemptIdentity.queryKey
      && currentCompletion.identity.generation === attemptIdentity.generation;
    if (matchesCurrent) {
      const mismatch = attemptMismatchWithCurrentCompletion(
        attempt,
        query.descriptor,
        currentCompletion,
      );
      if (mismatch !== null) {
        return yield* Result.fail(invalidAttempt(attempt, mismatch));
      }
      return Object.freeze({
        _tag: "superseded" as const,
        state,
        queryKey: query.descriptor.queryKey,
        generation: attempt.generation,
        activeGeneration: active.generation,
      });
    }
    const preceding = query.precedingCompletionIdentity;
    if (
      preceding !== null
      && preceding.namespaceId === attemptIdentity.namespaceId
      && preceding.syncModelId === attemptIdentity.syncModelId
      && preceding.sourceEpoch === attemptIdentity.sourceEpoch
      && preceding.queryKey === attemptIdentity.queryKey
      && preceding.generation === attemptIdentity.generation
    ) {
      return Object.freeze({
        _tag: "superseded" as const,
        state,
        queryKey: query.descriptor.queryKey,
        generation: attempt.generation,
        activeGeneration: active.generation,
      });
    }
    if (attempt.generation > active.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "recordEvaluationAttemptOutcome",
        queryKey: query.descriptor.queryKey,
        expectedGeneration: provisional?.generation ?? active.generation,
        observedGeneration: attempt.generation,
      }));
    }
    return Object.freeze({
      _tag: "recoveryEvidenceExpired" as const,
      state,
      queryKey: query.descriptor.queryKey,
      generation: attempt.generation,
      activeGeneration: active.generation,
    });
  });
}
