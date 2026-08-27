import { Result } from "effect";

import {
  initialQueryGeneration,
  successorQueryGeneration,
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
  InvalidQueryEvidenceError,
  QueryGenerationExhaustedError,
  QueryGenerationMismatchError,
  QueryKeyCollisionError,
  QueryStateNotFoundError,
  QuerySyncEpochMismatchError,
  QuerySyncInvariantDefect,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncSequenceExhaustedError,
  QuerySyncWorkLimitError,
} from "./Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncAuthorityOperation,
} from "./Errors.js";
import {
  findDependencyDirectoryEntry,
  findQueryState,
  MAX_INVALIDATION_AFFECTED_QUERIES,
  MAX_INVALIDATION_DEPENDENCY_LOOKUPS,
  replaceQueryState,
  replaceQueryStatesAndCursor,
} from "./Model.js";
import type {
  ActiveQueryState,
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryGenerationDecision,
  BuildQuerySyncStateError,
  CompleteQueryGenerationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
  QueryState,
  QuerySyncState,
  SequenceDecision,
} from "./Model.js";

export type ClassifySequenceError =
  | QuerySyncNamespaceMismatchError<"classifySequence">
  | QuerySyncModelMismatchError<"classifySequence">;

export type BeginQueryGenerationError =
  | QuerySyncAuthorityError<"beginQueryGeneration">
  | QueryGenerationExhaustedError
  | QueryKeyCollisionError<"beginQueryGeneration">
  | BuildQuerySyncStateError;

export type ApplyInvalidationsError =
  | QuerySyncNamespaceMismatchError<"applyAdmittedInvalidations">
  | QuerySyncModelMismatchError<"applyAdmittedInvalidations">
  | QuerySyncWorkLimitError<"applyAdmittedInvalidations">
  | BuildQuerySyncStateError;

export type CompleteQueryGenerationError =
  | QuerySyncAuthorityError<"completeQueryGeneration">
  | QueryKeyCollisionError<"completeQueryGeneration">
  | QueryStateNotFoundError
  | QueryGenerationMismatchError
  | InvalidQueryEvidenceError
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

function validateAuthority<Operation extends QuerySyncAuthorityOperation>(
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
    operation: "completeQueryGeneration",
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
  decision: BeginQueryGenerationDecision,
): BeginQueryGenerationDecision {
  return Object.freeze(decision);
}

function freezeApplyDecision(
  decision: ApplyInvalidationsDecision,
): ApplyInvalidationsDecision {
  return Object.freeze(decision);
}

function freezeCompleteDecision(
  decision: CompleteQueryGenerationDecision,
): CompleteQueryGenerationDecision {
  return Object.freeze(decision);
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

export function beginQueryGeneration(
  state: QuerySyncState,
  target: QueryOperationTarget,
): Result.Result<BeginQueryGenerationDecision, BeginQueryGenerationError> {
  return Result.gen(function* () {
    yield* validateAuthority(
      "beginQueryGeneration",
      state.cursor,
      target,
    );

    const existing = findQueryState(state, target.descriptor.queryKey);
    if (
      existing !== undefined
      && existing.descriptor.queryIdentity !== target.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "beginQueryGeneration"
      >({
        operation: "beginQueryGeneration",
        queryKey: target.descriptor.queryKey,
      }));
    }
    if (existing?.provisional !== null && existing?.provisional !== undefined) {
      return freezeBeginDecision({
        _tag: "replayed",
        state,
        descriptor: existing.descriptor,
        generation: existing.provisional.generation,
        registrationCursor: existing.provisional.registrationCursor,
      });
    }

    let generation: QueryGeneration;
    if (existing?.active === null || existing?.active === undefined) {
      generation = initialQueryGeneration();
    } else {
      const successor = successorQueryGeneration(existing.active.generation);
      if (successor === null) {
        return yield* Result.fail(new QueryGenerationExhaustedError({
          operation: "beginQueryGeneration",
          queryKey: existing.descriptor.queryKey,
          currentGeneration: existing.active.generation,
        }));
      }
      generation = successor;
    }

    const descriptor = existing?.descriptor ?? target.descriptor;
    const replacement: QueryState = {
      descriptor,
      active: existing?.active ?? null,
      provisional: {
        generation,
        registrationCursor: state.cursor,
      },
    };
    const nextState = yield* replaceQueryState(state, replacement);
    const nextQuery = findQueryState(nextState, descriptor.queryKey);
    if (nextQuery?.provisional === null || nextQuery?.provisional === undefined) {
      throw new QuerySyncInvariantDefect({
        operation: "beginQueryGeneration",
        invariant: "rebuiltGenerationMissing",
      });
    }
    return freezeBeginDecision({
      _tag: "created",
      state: nextState,
      descriptor: nextQuery.descriptor,
      generation: nextQuery.provisional.generation,
      registrationCursor: nextQuery.provisional.registrationCursor,
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
      });
    }

    const cursor: NamespaceCursor = {
      namespaceId: state.cursor.namespaceId,
      syncModelId: state.cursor.syncModelId,
      sourceEpoch: state.cursor.sourceEpoch,
      appliedThroughSequence: sequenceDecision.nextSequence,
    };
    const nextState = yield* replaceQueryStatesAndCursor(
      state,
      cursor,
      replacements,
    );
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

export function completeQueryGeneration(
  state: QuerySyncState,
  evaluation: QueryEvaluationEvidence,
  refresh: GenerationRefreshEvidence,
): Result.Result<
  CompleteQueryGenerationDecision,
  CompleteQueryGenerationError
> {
  return Result.gen(function* () {
    yield* validateAuthority(
      "completeQueryGeneration",
      state.cursor,
      evaluation,
    );
    yield* validateAuthority(
      "completeQueryGeneration",
      state.cursor,
      refresh,
    );
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

    const query = findQueryState(state, evaluation.descriptor.queryKey);
    if (query === undefined) {
      return yield* Result.fail(new QueryStateNotFoundError({
        operation: "completeQueryGeneration",
        queryKey: evaluation.descriptor.queryKey,
      }));
    }
    if (
      query.descriptor.queryIdentity
      !== evaluation.descriptor.queryIdentity
    ) {
      return yield* Result.fail(new QueryKeyCollisionError<
        "completeQueryGeneration"
      >({
        operation: "completeQueryGeneration",
        queryKey: evaluation.descriptor.queryKey,
      }));
    }
    if (query.provisional?.generation !== evaluation.generation) {
      return yield* Result.fail(new QueryGenerationMismatchError({
        operation: "completeQueryGeneration",
        queryKey: evaluation.descriptor.queryKey,
        expectedGeneration: query.provisional?.generation ?? null,
        observedGeneration: evaluation.generation,
      }));
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

    const active: ActiveQueryState = {
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      freshThroughSequence: refresh.refreshedThroughSequence,
      dirtyThroughSequence: null,
      resultDigest: evaluation.resultDigest,
      authorityWitness: refresh.authorityWitness,
      dependencyKeys: evaluation.dependencyKeys,
    };
    const publicationRequired = query.active === null
      || query.active.resultDigest !== evaluation.resultDigest;
    const nextState = yield* replaceQueryState(state, {
      descriptor: query.descriptor,
      active,
      provisional: null,
    });
    return freezeCompleteDecision({
      _tag: "completed",
      state: nextState,
      generation: evaluation.generation,
      publicationRequired,
    });
  });
}
