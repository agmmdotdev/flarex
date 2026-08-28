import { Result } from "effect";

import {
  initialQueryGeneration,
  successorQueryGeneration,
  successorQuerySyncWorkRevision,
  successorSyncSequence,
} from "./CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  CanonicalQueryKey,
  QueryGeneration,
  SyncEpoch,
  SyncModelId,
  SyncNamespaceId,
  SyncSequence,
} from "./CanonicalValue.js";
import {
  InvalidQueryCompletionReplayError,
  InvalidQueryEvidenceError,
  InvalidQueryEvaluationRequestError,
  QueryEvaluationWorkBlockedError,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncEpochMismatchError,
  QuerySyncInvariantDefect,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncSequenceExhaustedError,
  QuerySyncWorkRevisionExhaustedError,
  QuerySyncWorkLimitError,
} from "./Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncAuthorityOperation,
  QuerySyncCanonicalValueError,
} from "./Errors.js";
import {
  findDependencyDirectoryEntry,
  findQueryState,
  findRetainedQueryPublication,
  makeQueryEvaluationAttempt,
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
  readyQueryEvaluationDisposition,
  rebuildQuerySyncState,
} from "./Model.js";
import type {
  ActiveQueryState,
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryEvaluationDecision,
  BeginQueryEvaluationRequest,
  BuildQuerySyncStateError,
  CompleteQueryEvaluationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryCompletionFingerprint,
  QueryEvaluationAttempt,
  QueryEvaluationEvidence,
  QueryState,
  QuerySyncState,
  SequenceDecision,
} from "./Model.js";
import {
  captureQueryPublicationArtifact,
  makePendingQueryPublication,
  makeQueryPublicationIdentity,
  pendingPublicationDisposition,
  unchangedPublicationDisposition,
} from "./Publication.js";
import type {
  PendingQueryPublication,
  QueryCompletionPublicationDisposition,
  QueryPublicationArtifact,
} from "./Publication.js";

export type ClassifySequenceError =
  | QuerySyncNamespaceMismatchError<"classifySequence">
  | QuerySyncModelMismatchError<"classifySequence">;

export type BeginQueryEvaluationError =
  | QuerySyncAuthorityError<"beginQueryEvaluation">
  | QueryGenerationExhaustedError<"beginQueryEvaluation">
  | QueryGenerationMismatchError<"beginQueryEvaluation">
  | QueryKeyCollisionError<"beginQueryEvaluation">
  | InvalidQueryEvaluationRequestError
  | QuerySyncWorkRevisionExhaustedError<"beginQueryEvaluation">
  | QueryEvaluationWorkBlockedError<"beginQueryEvaluation">
  | BuildQuerySyncStateError;

export type ApplyInvalidationsError =
  | QuerySyncNamespaceMismatchError<"applyAdmittedInvalidations">
  | QuerySyncModelMismatchError<"applyAdmittedInvalidations">
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">
  | QuerySyncWorkRevisionExhaustedError<"applyAdmittedInvalidations">
  | BuildQuerySyncStateError;

export type CompleteQueryEvaluationError =
  | QuerySyncAuthorityError<"completeQueryEvaluation">
  | QueryKeyCollisionError<"completeQueryEvaluation">
  | QueryStateNotFoundError<"completeQueryEvaluation">
  | QueryGenerationMismatchError<"completeQueryEvaluation">
  | InvalidQueryEvidenceError
  | InvalidQueryCompletionReplayError
  | QuerySyncCanonicalValueError
  | QuerySyncWorkRevisionExhaustedError<"completeQueryEvaluation">
  | QueryEvaluationWorkBlockedError<"completeQueryEvaluation">
  | BuildQuerySyncStateError;

function namespaceMismatch<Operation extends QuerySyncAuthorityOperation>(
  operation: Operation,
  expected: NamespaceCursor,
  observedNamespaceId: string,
): QuerySyncNamespaceMismatchError<Operation> {
  return new QuerySyncNamespaceMismatchError<Operation>({
    operation,
    expectedNamespaceId: expected.namespaceId,
    observedNamespaceId,
  });
}

function modelMismatch<Operation extends QuerySyncAuthorityOperation>(
  operation: Operation,
  expected: NamespaceCursor,
  observedSyncModelId: string,
): QuerySyncModelMismatchError<Operation> {
  return new QuerySyncModelMismatchError<Operation>({
    operation,
    expectedSyncModelId: expected.syncModelId,
    observedSyncModelId,
  });
}

function epochMismatch<Operation extends QuerySyncAuthorityOperation>(
  operation: Operation,
  expected: NamespaceCursor,
  observedSourceEpoch: string,
): QuerySyncEpochMismatchError<Operation> {
  return new QuerySyncEpochMismatchError<Operation>({
    operation,
    expectedSourceEpoch: expected.sourceEpoch,
    observedSourceEpoch,
    resetRequired: true,
  });
}

export function validateQuerySyncAuthority<
  Operation extends QuerySyncAuthorityOperation,
>(
  operation: Operation,
  expected: NamespaceCursor,
  observed: {
    readonly namespaceId: string;
    readonly syncModelId: string;
    readonly sourceEpoch: string;
  },
): Result.Result<void, QuerySyncAuthorityError<Operation>> {
  if (observed.namespaceId !== expected.namespaceId) {
    return Result.fail(namespaceMismatch(
      operation,
      expected,
      observed.namespaceId,
    ));
  }
  if (observed.syncModelId !== expected.syncModelId) {
    return Result.fail(modelMismatch(
      operation,
      expected,
      observed.syncModelId,
    ));
  }
  if (observed.sourceEpoch !== expected.sourceEpoch) {
    return Result.fail(epochMismatch(
      operation,
      expected,
      observed.sourceEpoch,
    ));
  }
  return Result.succeed(undefined);
}

function invalidQueryEvidence(
  reason: InvalidQueryEvidenceError["reason"],
): InvalidQueryEvidenceError {
  return new InvalidQueryEvidenceError({
    operation: "completeQueryEvaluation",
    reason,
  });
}

function dependencyKeysEqual(
  left: readonly CanonicalDependencyKey[],
  right: readonly CanonicalDependencyKey[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function freezeSequenceDecision(
  decision: SequenceDecision,
): SequenceDecision {
  return Object.freeze(decision);
}

function freezeBeginDecision(
  decision: BeginQueryEvaluationDecision,
): BeginQueryEvaluationDecision {
  return Object.freeze(decision);
}

function freezeApplyDecision(
  decision: ApplyInvalidationsDecision,
): ApplyInvalidationsDecision {
  return Object.freeze(decision);
}

function freezeCompleteDecision(
  decision: CompleteQueryEvaluationDecision,
): CompleteQueryEvaluationDecision {
  return Object.freeze(decision);
}

function replaceQueryInArray(
  queries: readonly QueryState[],
  replacement: QueryState,
): readonly QueryState[] {
  const nextQueries = queries.map((query) => (
    query.descriptor.queryKey === replacement.descriptor.queryKey
      ? replacement
      : query
  ));
  return nextQueries.some((query) => (
      query.descriptor.queryKey === replacement.descriptor.queryKey
    ))
    ? nextQueries
    : [...nextQueries, replacement];
}

export function nextSyncSequence(
  cursor: NamespaceCursor,
): Result.Result<SyncSequence, QuerySyncSequenceExhaustedError> {
  const successor = successorSyncSequence(cursor.appliedThroughSequence);
  if (successor === null) {
    return Result.fail(new QuerySyncSequenceExhaustedError({
      operation: "nextSyncSequence",
      appliedThroughSequence: cursor.appliedThroughSequence,
    }));
  }
  return Result.succeed(successor);
}

function classifySequenceForOperation<
  Operation extends "classifySequence" | "applyAdmittedInvalidations",
>(
  operation: Operation,
  cursor: NamespaceCursor,
  position: {
    readonly namespaceId: SyncNamespaceId;
    readonly syncModelId: SyncModelId;
    readonly sourceEpoch: SyncEpoch;
    readonly sourceSequence: SyncSequence;
  },
): Result.Result<
  SequenceDecision,
  | QuerySyncNamespaceMismatchError<Operation>
  | QuerySyncModelMismatchError<Operation>
> {
  if (position.namespaceId !== cursor.namespaceId) {
    return Result.fail(namespaceMismatch(
      operation,
      cursor,
      position.namespaceId,
    ));
  }
  if (position.syncModelId !== cursor.syncModelId) {
    return Result.fail(modelMismatch(
      operation,
      cursor,
      position.syncModelId,
    ));
  }
  if (position.sourceEpoch !== cursor.sourceEpoch) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "resetRequired",
      expectedSourceEpoch: cursor.sourceEpoch,
      observedSourceEpoch: position.sourceEpoch,
    }));
  }
  if (position.sourceSequence <= cursor.appliedThroughSequence) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "duplicate",
      observedSequence: position.sourceSequence,
    }));
  }

  const expectedSequence = successorSyncSequence(
    cursor.appliedThroughSequence,
  );
  if (expectedSequence === null) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "duplicate",
      observedSequence: position.sourceSequence,
    }));
  }
  if (position.sourceSequence === expectedSequence) {
    return Result.succeed(freezeSequenceDecision({
      _tag: "exactNext",
      nextSequence: expectedSequence,
    }));
  }
  return Result.succeed(freezeSequenceDecision({
    _tag: "gap",
    expectedSequence,
    observedSequence: position.sourceSequence,
  }));
}

export function classifySequence(
  cursor: NamespaceCursor,
  position: {
    readonly namespaceId: SyncNamespaceId;
    readonly syncModelId: SyncModelId;
    readonly sourceEpoch: SyncEpoch;
    readonly sourceSequence: SyncSequence;
  },
): Result.Result<SequenceDecision, ClassifySequenceError> {
  return classifySequenceForOperation("classifySequence", cursor, position);
}

function invalidEvaluationRequest(
  request: BeginQueryEvaluationRequest,
  reason: InvalidQueryEvaluationRequestError["reason"],
  observedDirtyThroughSequence: SyncSequence | null,
): InvalidQueryEvaluationRequestError {
  return new InvalidQueryEvaluationRequestError({
    operation: "beginQueryEvaluation",
    reason,
    queryKey: request.target.descriptor.queryKey,
    requestedDirtyThroughSequence: request.requestedDirtyThroughSequence,
    observedDirtyThroughSequence,
  });
}

function evaluationAttempt(
  state: QuerySyncState,
  query: QueryState,
): QueryEvaluationAttempt {
  const provisional = query.provisional;
  if (provisional === null) {
    throw new QuerySyncInvariantDefect({
      operation: "beginQueryEvaluation",
      invariant: "rebuiltEvaluationMissing",
    });
  }
  return makeQueryEvaluationAttempt({
    namespaceId: state.cursor.namespaceId,
    syncModelId: state.cursor.syncModelId,
    sourceEpoch: state.cursor.sourceEpoch,
    descriptor: query.descriptor,
    generation: provisional.generation,
    expectedActiveGeneration: provisional.expectedActiveGeneration,
    registrationCursor: provisional.registrationCursor,
    requestedDirtyThroughSequence:
      provisional.requestedDirtyThroughSequence,
  });
}

export function beginQueryEvaluation(
  state: QuerySyncState,
  request: BeginQueryEvaluationRequest,
): Result.Result<BeginQueryEvaluationDecision, BeginQueryEvaluationError> {
  return Result.gen(function* () {
    yield* validateQuerySyncAuthority(
      "beginQueryEvaluation",
      state.cursor,
      request.target,
    );

    if (
      request.expectedActiveGeneration === null
      && request.requestedDirtyThroughSequence !== null
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "firstRegistrationHasDirtyFrontier",
        null,
      ));
    }
    if (
      request.expectedActiveGeneration !== null
      && request.requestedDirtyThroughSequence === null
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "rerunMissingDirtyFrontier",
        null,
      ));
    }
    if (
      request.requestedDirtyThroughSequence !== null
      && request.requestedDirtyThroughSequence
        > state.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "dirtyFrontierAheadOfCursor",
        null,
      ));
    }

    const target = request.target;
    const existing = findQueryState(state, target.descriptor.queryKey);
    if (
      existing !== undefined
      && existing.descriptor.queryIdentity !== target.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "beginQueryEvaluation"
      >({
        operation: "beginQueryEvaluation",
        queryKey: target.descriptor.queryKey,
      }));
    }

    const active = existing?.active ?? null;
    if (active !== null) {
      const expectedActiveGeneration = request.expectedActiveGeneration;
      if (
        expectedActiveGeneration === null
        || expectedActiveGeneration < active.generation
      ) {
        return freezeBeginDecision({
          _tag: "alreadyAdvanced",
          state,
          descriptor: existing?.descriptor ?? target.descriptor,
          requestedExpectedActiveGeneration: expectedActiveGeneration,
          activeGeneration: active.generation,
          freshThroughSequence: active.freshThroughSequence,
        });
      }
      if (expectedActiveGeneration > active.generation) {
        return yield* Result.fail(new QueryGenerationMismatchError({
          operation: "beginQueryEvaluation",
          queryKey: target.descriptor.queryKey,
          expectedGeneration: active.generation,
          observedGeneration: expectedActiveGeneration,
        }));
      }

      const requestedDirty = request.requestedDirtyThroughSequence;
      if (requestedDirty === null) {
        return yield* Result.fail(invalidEvaluationRequest(
          request,
          "rerunMissingDirtyFrontier",
          active.dirtyThroughSequence,
        ));
      }
    } else if (request.expectedActiveGeneration !== null) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "beginQueryEvaluation",
        queryKey: target.descriptor.queryKey,
        expectedGeneration: null,
        observedGeneration: request.expectedActiveGeneration,
      }));
    }

    if (existing?.provisional !== null && existing?.provisional !== undefined) {
      if (
        existing.provisional.expectedActiveGeneration
        !== request.expectedActiveGeneration
      ) {
        throw new QuerySyncInvariantDefect({
          operation: "beginQueryEvaluation",
          invariant: "provisionalFenceMismatch",
        });
      }
      if (existing.provisional.evaluationDisposition._tag === "blocked") {
        return yield* Result.fail(new QueryEvaluationWorkBlockedError<
          "beginQueryEvaluation"
        >({
          operation: "beginQueryEvaluation",
          queryKey: existing.descriptor.queryKey,
          generation: existing.provisional.generation,
          reason: existing.provisional.evaluationDisposition.reason,
          resetRequired: true,
        }));
      }
      if (
        active !== null
        && (
          request.requestedDirtyThroughSequence === null
          || active.dirtyThroughSequence === null
          || request.requestedDirtyThroughSequence
            > active.dirtyThroughSequence
        )
      ) {
        return yield* Result.fail(invalidEvaluationRequest(
          request,
          "dirtyFrontierNotObserved",
          active.dirtyThroughSequence,
        ));
      }
      const observedDirty = active?.dirtyThroughSequence ?? null;
      const currentDirty = existing.provisional.requestedDirtyThroughSequence;
      const coalescedDirty = observedDirty === null
        ? currentDirty
        : currentDirty === null || observedDirty > currentDirty
          ? observedDirty
          : currentDirty;
      let nextState = state;
      if (
        coalescedDirty
        !== existing.provisional.requestedDirtyThroughSequence
      ) {
        const revision = yield* successorQuerySyncWorkRevision(
          "beginQueryEvaluation",
          state.evaluationWork.revision,
        );
        nextState = yield* rebuildQuerySyncState(state, {
          queries: replaceQueryInArray(state.queries, {
            descriptor: existing.descriptor,
            active: existing.active,
            provisional: {
              ...existing.provisional,
              requestedDirtyThroughSequence: coalescedDirty,
            },
            currentCompletion: existing.currentCompletion,
            precedingCompletionIdentity: existing.precedingCompletionIdentity,
          }),
          evaluationWork: {
            revision,
            fairnessAnchor: state.evaluationWork.fairnessAnchor,
          },
        });
      }
      const nextQuery = findQueryState(nextState, target.descriptor.queryKey);
      if (nextQuery === undefined) {
        throw new QuerySyncInvariantDefect({
          operation: "beginQueryEvaluation",
          invariant: "rebuiltEvaluationMissing",
        });
      }
      return freezeBeginDecision({
        _tag: "replayed",
        state: nextState,
        attempt: evaluationAttempt(nextState, nextQuery),
      });
    }

    if (
      active !== null
      && request.requestedDirtyThroughSequence !== null
      && request.requestedDirtyThroughSequence
        <= active.freshThroughSequence
    ) {
      return freezeBeginDecision({
        _tag: "notDirty",
        state,
        descriptor: existing?.descriptor ?? target.descriptor,
        activeGeneration: active.generation,
        requestedDirtyThroughSequence:
          request.requestedDirtyThroughSequence,
        freshThroughSequence: active.freshThroughSequence,
      });
    }
    if (
      active !== null
      && (
        active.dirtyThroughSequence === null
        || request.requestedDirtyThroughSequence === null
        || request.requestedDirtyThroughSequence
          > active.dirtyThroughSequence
      )
    ) {
      return yield* Result.fail(invalidEvaluationRequest(
        request,
        "dirtyFrontierNotObserved",
        active.dirtyThroughSequence,
      ));
    }

    let generation: QueryGeneration;
    if (active === null) {
      generation = initialQueryGeneration();
    } else {
      const successor = successorQueryGeneration(active.generation);
      if (successor === null) {
        return yield* Result.fail(new QueryGenerationExhaustedError({
          operation: "beginQueryEvaluation",
          queryKey: existing?.descriptor.queryKey ?? target.descriptor.queryKey,
          currentGeneration: active.generation,
        }));
      }
      generation = successor;
    }

    const descriptor = existing?.descriptor ?? target.descriptor;
    const replacement: QueryState = {
      descriptor,
      active,
      provisional: {
        generation,
        expectedActiveGeneration: request.expectedActiveGeneration,
        registrationCursor: state.cursor,
        requestedDirtyThroughSequence: active?.dirtyThroughSequence ?? null,
        evaluationDisposition: readyQueryEvaluationDisposition(),
      },
      currentCompletion: existing?.currentCompletion ?? null,
      precedingCompletionIdentity:
        existing?.precedingCompletionIdentity ?? null,
    };
    const revision = yield* successorQuerySyncWorkRevision(
      "beginQueryEvaluation",
      state.evaluationWork.revision,
    );
    const nextState = yield* rebuildQuerySyncState(state, {
      queries: replaceQueryInArray(state.queries, replacement),
      evaluationWork: {
        revision,
        fairnessAnchor: state.evaluationWork.fairnessAnchor,
      },
    });
    const nextQuery = findQueryState(nextState, descriptor.queryKey);
    if (nextQuery?.provisional === null || nextQuery?.provisional === undefined) {
      throw new QuerySyncInvariantDefect({
        operation: "beginQueryEvaluation",
        invariant: "rebuiltEvaluationMissing",
      });
    }
    return freezeBeginDecision({
      _tag: "created",
      state: nextState,
      attempt: evaluationAttempt(nextState, nextQuery),
    });
  });
}

export function applyAdmittedInvalidations(
  state: QuerySyncState,
  batch: AdmittedInvalidationBatch,
): Result.Result<ApplyInvalidationsDecision, ApplyInvalidationsError> {
  return Result.gen(function* () {
    const sequenceDecision = yield* classifySequenceForOperation(
      "applyAdmittedInvalidations",
      state.cursor,
      batch,
    );
    if (sequenceDecision._tag === "duplicate") {
      return freezeApplyDecision({
        _tag: "duplicate",
        state,
        observedSequence: sequenceDecision.observedSequence,
      });
    }
    if (sequenceDecision._tag === "gap") {
      return freezeApplyDecision({
        _tag: "gap",
        state,
        expectedSequence: sequenceDecision.expectedSequence,
        observedSequence: sequenceDecision.observedSequence,
      });
    }
    if (sequenceDecision._tag === "resetRequired") {
      return freezeApplyDecision({
        _tag: "resetRequired",
        state,
        expectedSourceEpoch: sequenceDecision.expectedSourceEpoch,
        observedSourceEpoch: sequenceDecision.observedSourceEpoch,
      });
    }
    if (
      batch.dependencyKeys.length > MAX_INVALIDATION_DEPENDENCY_LOOKUPS
    ) {
      return yield* Result.fail(new QuerySyncWorkLimitError<
        "applyAdmittedInvalidations"
      >({
        operation: "applyAdmittedInvalidations",
        dimension: "dependencyLookups",
        maximum: MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
        observed: batch.dependencyKeys.length,
      }));
    }

    const affectedQueryKeys = new Set<CanonicalQueryKey>();
    for (const dependencyKey of batch.dependencyKeys) {
      const directoryEntry = findDependencyDirectoryEntry(
        state,
        dependencyKey,
      );
      if (directoryEntry === undefined) continue;
      for (const queryKey of directoryEntry.queryKeys) {
        affectedQueryKeys.add(queryKey);
        if (
          affectedQueryKeys.size > MAX_INVALIDATION_AFFECTED_QUERIES
        ) {
          return yield* Result.fail(new QuerySyncWorkLimitError<
            "applyAdmittedInvalidations"
          >({
            operation: "applyAdmittedInvalidations",
            dimension: "affectedQueries",
            maximum: MAX_INVALIDATION_AFFECTED_QUERIES,
            observed: affectedQueryKeys.size,
          }));
        }
      }
    }

    const orderedAffectedQueryKeys = [...affectedQueryKeys];
    orderedAffectedQueryKeys.sort();
    const replacements = new Map<CanonicalQueryKey, QueryState>();
    for (const queryKey of orderedAffectedQueryKeys) {
      const query = findQueryState(state, queryKey);
      if (query?.active === null || query?.active === undefined) {
        throw new QuerySyncInvariantDefect({
          operation: "applyAdmittedInvalidations",
          invariant: "dependencyDirectoryEntryMissingActiveQuery",
        });
      }
      const active: ActiveQueryState = {
        ...query.active,
        dirtyThroughSequence: sequenceDecision.nextSequence,
      };
      replacements.set(queryKey, {
        descriptor: query.descriptor,
        active,
        provisional: query.provisional,
        currentCompletion: query.currentCompletion,
        precedingCompletionIdentity: query.precedingCompletionIdentity,
      });
    }

    const cursor: NamespaceCursor = {
      namespaceId: state.cursor.namespaceId,
      syncModelId: state.cursor.syncModelId,
      sourceEpoch: state.cursor.sourceEpoch,
      appliedThroughSequence: sequenceDecision.nextSequence,
    };
    const queries = state.queries.map((query) => (
      replacements.get(query.descriptor.queryKey) ?? query
    ));
    const revision = replacements.size === 0
      ? state.evaluationWork.revision
      : yield* successorQuerySyncWorkRevision(
        "applyAdmittedInvalidations",
        state.evaluationWork.revision,
      );
    const nextState = yield* rebuildQuerySyncState(state, {
      cursor,
      queries,
      evaluationWork: {
        revision,
        fairnessAnchor: state.evaluationWork.fairnessAnchor,
      },
    });
    return freezeApplyDecision({
      _tag: "applied",
      state: nextState,
      appliedSequence: sequenceDecision.nextSequence,
      affectedQueryKeys: Object.freeze(orderedAffectedQueryKeys),
    });
  });
}

function laterRelevantSequence(
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  active: ActiveQueryState | null,
): SyncSequence | null {
  let relevant = refresh.relevantThroughSequence;
  const dirty = active?.dirtyThroughSequence ?? null;
  if (
    dirty !== null
    && dirty > evaluation.snapshotSequence
    && (relevant === null || dirty > relevant)
  ) {
    relevant = dirty;
  }
  return relevant;
}

function namespaceCursorsEqual(
  left: NamespaceCursor,
  right: NamespaceCursor,
): boolean {
  return left.namespaceId === right.namespaceId
    && left.syncModelId === right.syncModelId
    && left.sourceEpoch === right.sourceEpoch
    && left.appliedThroughSequence === right.appliedThroughSequence;
}

function completionFingerprintMatches(
  fingerprint: QueryCompletionFingerprint,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
): boolean {
  return fingerprint.identity.namespaceId === attempt.namespaceId
    && fingerprint.identity.syncModelId === attempt.syncModelId
    && fingerprint.identity.sourceEpoch === attempt.sourceEpoch
    && fingerprint.identity.queryKey === attempt.descriptor.queryKey
    && fingerprint.identity.generation === attempt.generation
    && fingerprint.queryIdentity === attempt.descriptor.queryIdentity
    && fingerprint.expectedActiveGeneration
      === attempt.expectedActiveGeneration
    && namespaceCursorsEqual(
      fingerprint.registrationCursor,
      attempt.registrationCursor,
    )
    && fingerprint.requestedDirtyThroughSequence
      === attempt.requestedDirtyThroughSequence
    && fingerprint.evaluationSnapshotSequence === evaluation.snapshotSequence
    && dependencyKeysEqual(
      fingerprint.evaluationDependencyKeys,
      evaluation.dependencyKeys,
    )
    && fingerprint.evaluationAuthorityWitness
      === evaluation.authorityWitness
    && fingerprint.refreshedThroughSequence
      === refresh.refreshedThroughSequence
    && fingerprint.relevantThroughSequence
      === refresh.relevantThroughSequence
    && fingerprint.refreshAuthorityWitness === refresh.authorityWitness
    && fingerprint.resultDigest === evaluation.resultDigest;
}

function invalidCompletionReplay(
  attempt: QueryEvaluationAttempt,
  reason: InvalidQueryCompletionReplayError["reason"],
): InvalidQueryCompletionReplayError {
  return new InvalidQueryCompletionReplayError({
    operation: "completeQueryEvaluation",
    reason,
    queryKey: attempt.descriptor.queryKey,
    generation: attempt.generation,
  });
}

export function completeQueryEvaluation(
  state: QuerySyncState,
  attempt: QueryEvaluationAttempt,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
  publication: QueryPublicationArtifact,
): Result.Result<
  CompleteQueryEvaluationDecision,
  CompleteQueryEvaluationError
> {
  return Result.gen(function* () {
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      attempt,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      evaluation,
    );
    yield* validateQuerySyncAuthority(
      "completeQueryEvaluation",
      state.cursor,
      refresh,
    );
    if (
      attempt.descriptor.queryKey !== evaluation.descriptor.queryKey
      || attempt.descriptor.queryIdentity
        !== evaluation.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationDescriptorMismatch",
      ));
    }
    if (attempt.generation !== evaluation.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptEvaluationGenerationMismatch",
      ));
    }
    if (
      evaluation.descriptor.queryKey !== refresh.descriptor.queryKey
      || evaluation.descriptor.queryIdentity
        !== refresh.descriptor.queryIdentity
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDescriptorMismatch",
      ));
    }
    if (evaluation.generation !== refresh.generation) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshGenerationMismatch",
      ));
    }
    if (
      evaluation.snapshotSequence !== refresh.evaluationSnapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshSnapshotMismatch",
      ));
    }
    if (!dependencyKeysEqual(
      evaluation.dependencyKeys,
      refresh.evaluationDependencyKeys,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "evaluationRefreshDependenciesMismatch",
      ));
    }
    const capturedPublication = yield* captureQueryPublicationArtifact(
      publication,
    );

    const query = findQueryState(state, attempt.descriptor.queryKey);
    if (query === undefined) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "completeQueryEvaluation",
        queryKey: attempt.descriptor.queryKey,
      }));
    }
    if (
      query.descriptor.queryIdentity
      !== attempt.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: attempt.descriptor.queryKey,
      }));
    }

    const currentCompletion = query.currentCompletion;
    if (
      currentCompletion !== null
      && currentCompletion.identity.generation === attempt.generation
    ) {
      if (!completionFingerprintMatches(
        currentCompletion,
        attempt,
        evaluation,
        refresh,
      )) {
        return yield* Result.fail(invalidCompletionReplay(
          attempt,
          "fingerprintMismatch",
        ));
      }
      if (currentCompletion.publicationDisposition._tag === "pending") {
        const retainedPublication = findRetainedQueryPublication(
          state,
          currentCompletion.publicationDisposition.identity,
        );
        if (
          retainedPublication !== undefined
          && retainedPublication.content !== capturedPublication.content
        ) {
          return yield* Result.fail(invalidCompletionReplay(
            attempt,
            "publicationContentMismatch",
          ));
        }
      }
      return freezeCompleteDecision({
        _tag: "replayed",
        state,
        generation: attempt.generation,
        publicationDisposition:
          currentCompletion.publicationDisposition,
      });
    }

    if (
      query.active !== null
      && attempt.generation < query.active.generation
    ) {
      if (
        query.precedingCompletionIdentity?.generation === attempt.generation
      ) {
        return freezeCompleteDecision({
          _tag: "superseded",
          state,
          generation: attempt.generation,
          activeGeneration: query.active.generation,
        });
      }
      return freezeCompleteDecision({
        _tag: "recoveryEvidenceExpired",
        state,
        generation: attempt.generation,
        activeGeneration: query.active.generation,
      });
    }

    if (query.provisional?.generation !== evaluation.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: evaluation.descriptor.queryKey,
        expectedGeneration: query.provisional?.generation ?? null,
        observedGeneration: evaluation.generation,
      }));
    }
    if (query.provisional.evaluationDisposition._tag === "blocked") {
      return yield* Result.fail(new QueryEvaluationWorkBlockedError<
        "completeQueryEvaluation"
      >({
        operation: "completeQueryEvaluation",
        queryKey: query.descriptor.queryKey,
        generation: query.provisional.generation,
        reason: query.provisional.evaluationDisposition.reason,
        resetRequired: true,
      }));
    }
    if (
      query.provisional.expectedActiveGeneration
      !== attempt.expectedActiveGeneration
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptExpectedActiveMismatch",
      ));
    }
    if (!namespaceCursorsEqual(
      query.provisional.registrationCursor,
      attempt.registrationCursor,
    )) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptRegistrationCursorMismatch",
      ));
    }
    if (
      query.provisional.requestedDirtyThroughSequence
      !== attempt.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "attemptDirtyFrontierMismatch",
      ));
    }
    if (
      evaluation.snapshotSequence
      < query.provisional.registrationCursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRegistration",
      ));
    }
    if (
      query.provisional.requestedDirtyThroughSequence !== null
      && evaluation.snapshotSequence
        < query.provisional.requestedDirtyThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "snapshotBeforeRequestedDirtyFrontier",
      ));
    }
    if (
      evaluation.snapshotSequence > refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("snapshotAfterRefresh"));
    }
    if (
      refresh.refreshedThroughSequence > state.cursor.appliedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("refreshAheadOfCursor"));
    }
    if (
      refresh.relevantThroughSequence !== null
      && refresh.relevantThroughSequence <= evaluation.snapshotSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence(
        "relevantNotAfterSnapshot",
      ));
    }
    if (
      refresh.relevantThroughSequence !== null
      && refresh.relevantThroughSequence > refresh.refreshedThroughSequence
    ) {
      return yield* Result.fail(invalidQueryEvidence("relevantAfterRefresh"));
    }

    if (
      refresh.refreshedThroughSequence < state.cursor.appliedThroughSequence
    ) {
      return freezeCompleteDecision({
        _tag: "refreshRequired",
        state,
        refreshedThroughSequence: refresh.refreshedThroughSequence,
        requiredThroughSequence: state.cursor.appliedThroughSequence,
      });
    }
    if (evaluation.authorityWitness !== refresh.authorityWitness) {
      return freezeCompleteDecision({
        _tag: "resnapshotRequired",
        state,
        generation: evaluation.generation,
      });
    }

    const relevantThroughSequence = laterRelevantSequence(
      evaluation,
      refresh,
      query.active,
    );
    if (relevantThroughSequence !== null) {
      return freezeCompleteDecision({
        _tag: "rerunRequired",
        state,
        generation: evaluation.generation,
        relevantThroughSequence,
      });
    }

    const nextActive: ActiveQueryState = {
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      freshThroughSequence: refresh.refreshedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: evaluation.resultDigest,
      authorityWitness: refresh.authorityWitness,
      dependencyKeys: evaluation.dependencyKeys,
    };
    const shouldPublish = query.active === null
      || query.active.resultDigest !== evaluation.resultDigest;
    const identity = makeQueryPublicationIdentity({
      namespaceId: state.cursor.namespaceId,
      syncModelId: state.cursor.syncModelId,
      sourceEpoch: state.cursor.sourceEpoch,
      queryKey: query.descriptor.queryKey,
      generation: evaluation.generation,
    });
    const publicationDisposition: QueryCompletionPublicationDisposition =
      shouldPublish
        ? pendingPublicationDisposition(identity)
        : unchangedPublicationDisposition();
    const completion: QueryCompletionFingerprint = {
      identity,
      queryIdentity: query.descriptor.queryIdentity,
      expectedActiveGeneration: attempt.expectedActiveGeneration,
      registrationCursor: attempt.registrationCursor,
      requestedDirtyThroughSequence:
        attempt.requestedDirtyThroughSequence,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      evaluationAuthorityWitness: evaluation.authorityWitness,
      refreshedThroughSequence: refresh.refreshedThroughSequence,
      relevantThroughSequence: refresh.relevantThroughSequence,
      refreshAuthorityWitness: refresh.authorityWitness,
      resultDigest: evaluation.resultDigest,
      publicationDisposition,
    };

    const nextPendingPublications: PendingQueryPublication[] =
      shouldPublish
        ? state.publicationWork.pending.filter((candidate) => (
          candidate.identity.queryKey !== query.descriptor.queryKey
        ))
        : [...state.publicationWork.pending];
    if (shouldPublish) {
      nextPendingPublications.push(makePendingQueryPublication({
        identity,
        queryIdentity: query.descriptor.queryIdentity,
        completedThroughSequence: refresh.refreshedThroughSequence,
        resultDigest: evaluation.resultDigest,
        content: capturedPublication.content,
      }));
    }

    const revision = yield* successorQuerySyncWorkRevision(
      "completeQueryEvaluation",
      state.evaluationWork.revision,
    );
    const nextState = yield* rebuildQuerySyncState(state, {
      queries: replaceQueryInArray(state.queries, {
        descriptor: query.descriptor,
        active: nextActive,
        provisional: null,
        currentCompletion: completion,
        precedingCompletionIdentity:
          query.currentCompletion?.identity ?? null,
      }),
      evaluationWork: {
        revision,
        fairnessAnchor: state.evaluationWork.fairnessAnchor,
      },
      publicationWork: {
        ...state.publicationWork,
        pending: nextPendingPublications,
      },
    });
    return freezeCompleteDecision({
      _tag: "completed",
      state: nextState,
      generation: evaluation.generation,
      publicationDisposition,
    });
  });
}
