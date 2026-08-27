import { Encoding, Result } from "effect";

import {
  canonicalBase64UrlDecodedLength,
  captureCanonicalDependencyKey,
  querySnapshotAsSyncSequence,
  successorSyncSequence,
} from "../kernel/CanonicalValue.js";
import type {
  CanonicalDependencyKey,
  QueryAuthorityWitness,
  SyncSequence,
} from "../kernel/CanonicalValue.js";
import {
  InvalidRefreshEvidenceError,
  QuerySyncEpochMismatchError,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncWorkLimitError,
} from "../kernel/Errors.js";
import type {
  QuerySyncAuthorityError,
  QuerySyncCanonicalValueError,
  QuerySyncWorkLimitDimension,
} from "../kernel/Errors.js";
import {
  createEmptyQuerySyncState,
  makeGenerationRefreshEvidence,
  MAX_REFRESH_BATCHES,
  MAX_REFRESH_CANONICAL_BYTES,
  MAX_REFRESH_KEY_EXAMINATIONS,
} from "../kernel/Model.js";
import type {
  AdmittedInvalidationBatch,
  ApplyInvalidationsDecision,
  BeginQueryGenerationDecision,
  BuildQuerySyncStateError,
  CompleteQueryGenerationDecision,
  GenerationRefreshEvidence,
  NamespaceCursor,
  QueryEvaluationEvidence,
  QueryOperationTarget,
  QuerySyncState,
} from "../kernel/Model.js";
import {
  applyAdmittedInvalidations,
  beginQueryGeneration,
  completeQueryGeneration,
} from "../kernel/Policy.js";
import type {
  ApplyInvalidationsError,
  BeginQueryGenerationError,
  CompleteQueryGenerationError,
} from "../kernel/Policy.js";

export interface QuerySyncReferenceModel {
  readonly state: QuerySyncState;
}

export type ReferenceModelCommand =
  | Readonly<{
    readonly _tag: "beginQueryGeneration";
    readonly target: QueryOperationTarget;
  }>
  | Readonly<{
    readonly _tag: "applyAdmittedInvalidations";
    readonly batch: AdmittedInvalidationBatch;
  }>
  | Readonly<{
    readonly _tag: "completeQueryGeneration";
    readonly evaluation: QueryEvaluationEvidence;
    readonly refresh: GenerationRefreshEvidence;
  }>;

export type ReferenceModelDecision =
  | BeginQueryGenerationDecision
  | ApplyInvalidationsDecision
  | CompleteQueryGenerationDecision;

export interface ReferenceModelTransition {
  readonly model: QuerySyncReferenceModel;
  readonly decision: ReferenceModelDecision;
}

export type ReferenceModelError =
  | BeginQueryGenerationError
  | ApplyInvalidationsError
  | CompleteQueryGenerationError;

export type RefreshEvidenceError =
  | QuerySyncAuthorityError<"deriveGenerationRefreshEvidence">
  | InvalidRefreshEvidenceError
  | QuerySyncWorkLimitError<"deriveGenerationRefreshEvidence">;

function freezeReferenceModel(
  state: QuerySyncState,
): QuerySyncReferenceModel {
  return Object.freeze({ state });
}

function freezeTransition(
  decision: ReferenceModelDecision,
): ReferenceModelTransition {
  return Object.freeze({
    model: freezeReferenceModel(decision.state),
    decision,
  });
}

function refreshError(
  reason: InvalidRefreshEvidenceError["reason"],
  expectedSequence: bigint | null,
  observedSequence: bigint | null,
): InvalidRefreshEvidenceError {
  return new InvalidRefreshEvidenceError({
    operation: "deriveGenerationRefreshEvidence",
    reason,
    expectedSequence,
    observedSequence,
  });
}

function validateRefreshAuthority(
  evaluation: QueryEvaluationEvidence,
  observed: {
    readonly namespaceId: string;
    readonly syncModelId: string;
    readonly sourceEpoch: string;
  },
): Result.Result<
  void,
  QuerySyncAuthorityError<"deriveGenerationRefreshEvidence">
> {
  if (observed.namespaceId !== evaluation.namespaceId) {
    return Result.fail(new QuerySyncNamespaceMismatchError<
      "deriveGenerationRefreshEvidence"
    >({
      operation: "deriveGenerationRefreshEvidence",
      expectedNamespaceId: evaluation.namespaceId,
      observedNamespaceId: observed.namespaceId,
    }));
  }
  if (observed.syncModelId !== evaluation.syncModelId) {
    return Result.fail(new QuerySyncModelMismatchError<
      "deriveGenerationRefreshEvidence"
    >({
      operation: "deriveGenerationRefreshEvidence",
      expectedSyncModelId: evaluation.syncModelId,
      observedSyncModelId: observed.syncModelId,
    }));
  }
  if (observed.sourceEpoch !== evaluation.sourceEpoch) {
    return Result.fail(new QuerySyncEpochMismatchError<
      "deriveGenerationRefreshEvidence"
    >({
      operation: "deriveGenerationRefreshEvidence",
      expectedSourceEpoch: evaluation.sourceEpoch,
      observedSourceEpoch: observed.sourceEpoch,
      resetRequired: true,
    }));
  }
  return Result.succeed(undefined);
}

function workLimitError(
  dimension: QuerySyncWorkLimitDimension<
    "deriveGenerationRefreshEvidence"
  >,
  maximum: number,
  observed: number,
): QuerySyncWorkLimitError<"deriveGenerationRefreshEvidence"> {
  return new QuerySyncWorkLimitError<"deriveGenerationRefreshEvidence">({
    operation: "deriveGenerationRefreshEvidence",
    dimension,
    maximum,
    observed,
  });
}

export function createReferenceModel(
  cursor: NamespaceCursor,
): Result.Result<QuerySyncReferenceModel, BuildQuerySyncStateError> {
  return createEmptyQuerySyncState(cursor).pipe(Result.map(freezeReferenceModel));
}

export function reduceReferenceModel(
  model: QuerySyncReferenceModel,
  command: ReferenceModelCommand,
): Result.Result<ReferenceModelTransition, ReferenceModelError> {
  switch (command._tag) {
    case "beginQueryGeneration":
      return beginQueryGeneration(model.state, command.target).pipe(
        Result.map(freezeTransition),
      );
    case "applyAdmittedInvalidations":
      return applyAdmittedInvalidations(model.state, command.batch).pipe(
        Result.map(freezeTransition),
      );
    case "completeQueryGeneration":
      return completeQueryGeneration(
        model.state,
        command.evaluation,
        command.refresh,
      ).pipe(Result.map(freezeTransition));
  }
}

export function deriveGenerationRefreshEvidence(
  evaluation: QueryEvaluationEvidence,
  targetCursor: NamespaceCursor,
  batches: readonly AdmittedInvalidationBatch[],
  authorityWitness: QueryAuthorityWitness,
): Result.Result<GenerationRefreshEvidence, RefreshEvidenceError> {
  return Result.gen(function* () {
    yield* validateRefreshAuthority(evaluation, targetCursor);
    if (
      targetCursor.appliedThroughSequence < evaluation.snapshotSequence
    ) {
      return yield* Result.fail(refreshError(
        "targetBeforeSnapshot",
        evaluation.snapshotSequence,
        targetCursor.appliedThroughSequence,
      ));
    }
    const batchCount = batches.length;
    if (batchCount > MAX_REFRESH_BATCHES) {
      return yield* Result.fail(workLimitError(
        "refreshBatches",
        MAX_REFRESH_BATCHES,
        batchCount,
      ));
    }

    const intervalLength = targetCursor.appliedThroughSequence
      - evaluation.snapshotSequence;
    if (intervalLength > BigInt(MAX_REFRESH_BATCHES)) {
      return yield* Result.fail(workLimitError(
        "refreshBatches",
        MAX_REFRESH_BATCHES,
        MAX_REFRESH_BATCHES + 1,
      ));
    }
    const expectedBatchCount = Number(intervalLength);
    if (batchCount < expectedBatchCount) {
      const missingIndex = batchCount;
      const expectedSequence = evaluation.snapshotSequence
        + BigInt(missingIndex + 1);
      return yield* Result.fail(refreshError(
        "missingBatch",
        expectedSequence,
        null,
      ));
    }
    if (batchCount > expectedBatchCount) {
      const extra = batches[expectedBatchCount];
      return yield* Result.fail(refreshError(
        "extraBatch",
        null,
        extra?.sourceSequence ?? null,
      ));
    }

    const candidateDependencies = new Set(evaluation.dependencyKeys);
    let expectedSequence = querySnapshotAsSyncSequence(
      evaluation.snapshotSequence,
    );
    let relevantThroughSequence: SyncSequence | null = null;
    let keyExaminations = 0;
    let canonicalBytes = 0;

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex += 1) {
      const batch = batches[batchIndex];
      if (batch === undefined) {
        const successor = successorSyncSequence(expectedSequence);
        return yield* Result.fail(refreshError(
          "missingBatch",
          successor,
          null,
        ));
      }
      yield* validateRefreshAuthority(evaluation, batch);
      const successor = successorSyncSequence(expectedSequence);
      if (successor === null || batch.sourceSequence !== successor) {
        return yield* Result.fail(refreshError(
          "nonContiguousBatch",
          successor,
          batch.sourceSequence,
        ));
      }
      expectedSequence = successor;

      let batchIsRelevant = false;
      for (const dependencyKey of batch.dependencyKeys) {
        keyExaminations += 1;
        if (keyExaminations > MAX_REFRESH_KEY_EXAMINATIONS) {
          return yield* Result.fail(workLimitError(
            "refreshKeyExaminations",
            MAX_REFRESH_KEY_EXAMINATIONS,
            keyExaminations,
          ));
        }
        canonicalBytes += canonicalBase64UrlDecodedLength(dependencyKey);
        if (canonicalBytes > MAX_REFRESH_CANONICAL_BYTES) {
          return yield* Result.fail(workLimitError(
            "refreshCanonicalBytes",
            MAX_REFRESH_CANONICAL_BYTES,
            canonicalBytes,
          ));
        }
        if (candidateDependencies.has(dependencyKey)) {
          batchIsRelevant = true;
        }
      }
      if (batchIsRelevant) {
        relevantThroughSequence = batch.sourceSequence;
      }
    }

    return makeGenerationRefreshEvidence({
      namespaceId: evaluation.namespaceId,
      syncModelId: evaluation.syncModelId,
      sourceEpoch: evaluation.sourceEpoch,
      descriptor: evaluation.descriptor,
      generation: evaluation.generation,
      evaluationSnapshotSequence: evaluation.snapshotSequence,
      evaluationDependencyKeys: evaluation.dependencyKeys,
      refreshedThroughSequence: targetCursor.appliedThroughSequence,
      relevantThroughSequence,
      authorityWitness,
    });
  });
}

function captureSyntheticDependencyKey(
  modelPrefix: "kv" | "graph",
  canonicalFragment: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureCanonicalDependencyKey(Encoding.encodeBase64Url(
    `${modelPrefix}\0${canonicalFragment}`,
  ));
}

export function captureKeyValueDependencyKey(
  key: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureSyntheticDependencyKey("kv", key);
}

export function captureGraphDependencyKey(
  edge: string,
): Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError> {
  return captureSyntheticDependencyKey("graph", edge);
}

export interface SyntheticReferenceModelFixture {
  readonly syncModelId: string;
  readonly captureDependencyKey: (
    canonicalFragment: string,
  ) => Result.Result<CanonicalDependencyKey, QuerySyncCanonicalValueError>;
}

export const KEY_VALUE_REFERENCE_MODEL_FIXTURE:
  SyntheticReferenceModelFixture = Object.freeze({
  syncModelId: "synthetic-key-value",
  captureDependencyKey: captureKeyValueDependencyKey,
});

export const GRAPH_REFERENCE_MODEL_FIXTURE:
  SyntheticReferenceModelFixture = Object.freeze({
  syncModelId: "synthetic-graph",
  captureDependencyKey: captureGraphDependencyKey,
});
