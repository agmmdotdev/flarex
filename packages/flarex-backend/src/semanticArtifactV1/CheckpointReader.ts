import { Data, Effect } from "effect";
import {
  semanticArtifactV1AttemptStoreResourceCause,
  SemanticArtifactV1AttemptStoreBudgetError,
  SemanticArtifactV1AttemptStoreCorruptionError,
  SemanticArtifactV1AttemptStoreResourceError,
  type SemanticArtifactV1Attempt,
  type SemanticArtifactV1AttemptReadBudget,
  type SemanticArtifactV1AttemptStore,
  type SemanticArtifactV1Budget,
} from "./AttemptStore";

export type SemanticArtifactV1CheckpointReadBudget =
  SemanticArtifactV1AttemptReadBudget;

export interface SemanticArtifactV1CompletedCheckpointSnapshot {
  readonly rootDigest: string;
  readonly selectorDigest: string;
  readonly sourceUploadId: string;
  readonly sourceGeneration: number;
  readonly sourceMutationFence: number;
  readonly sourceRootDigest: string;
  readonly sourceSelectorDigest: string;
}

export interface SemanticArtifactV1CheckpointSnapshot {
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: SemanticArtifactV1Attempt["state"];
  readonly acceptedCommandId: string;
  readonly nextBlockOrdinal: number;
  readonly usage: SemanticArtifactV1Budget;
  readonly completed: SemanticArtifactV1CompletedCheckpointSnapshot | null;
}

export class SemanticArtifactV1CheckpointReadBudgetError extends Data.TaggedError(
  "SemanticArtifactV1CheckpointReadBudgetError",
)<{
  readonly uploadId: string;
  readonly observed: number;
  readonly maximum: number;
}> {}

export class SemanticArtifactV1CheckpointReadCorruptionError
  extends Data.TaggedError(
    "SemanticArtifactV1CheckpointReadCorruptionError",
  )<{ readonly uploadId: string }> {}

export class SemanticArtifactV1CheckpointReadResourceError
  extends Data.TaggedError(
    "SemanticArtifactV1CheckpointReadResourceError",
  )<{ readonly uploadId: string }> {}

export type SemanticArtifactV1CheckpointReadError =
  | SemanticArtifactV1CheckpointReadBudgetError
  | SemanticArtifactV1CheckpointReadCorruptionError
  | SemanticArtifactV1CheckpointReadResourceError;

export interface SemanticArtifactV1CheckpointReader {
  readonly read: (
    uploadId: string,
    budget: SemanticArtifactV1CheckpointReadBudget,
  ) => Effect.Effect<
    SemanticArtifactV1CheckpointSnapshot | null,
    SemanticArtifactV1CheckpointReadError
  >;
}

const resourceCause =
  new WeakMap<SemanticArtifactV1CheckpointReadResourceError, unknown>();

export function semanticArtifactV1CheckpointReadResourceCause(
  error: SemanticArtifactV1CheckpointReadResourceError,
): unknown {
  return resourceCause.get(error);
}

export function makeSemanticArtifactV1CheckpointReader(
  attempts: Pick<SemanticArtifactV1AttemptStore, "read">,
): SemanticArtifactV1CheckpointReader {
  const read = Effect.fn("SemanticArtifactV1CheckpointReader.read")(
    (
      uploadId: string,
      budget: SemanticArtifactV1CheckpointReadBudget,
    ): Effect.Effect<
      SemanticArtifactV1CheckpointSnapshot | null,
      SemanticArtifactV1CheckpointReadError
    > => attempts.read(uploadId, budget).pipe(
      Effect.mapError(error => projectAttemptReadError(uploadId, error)),
      Effect.map(attempt => attempt === null
        ? null
        : projectSemanticArtifactV1CheckpointSnapshot(attempt)),
    ),
  );
  return Object.freeze({ read });
}

export function projectSemanticArtifactV1CheckpointSnapshot(
  attempt: SemanticArtifactV1Attempt,
): SemanticArtifactV1CheckpointSnapshot {
  const completed =
    attempt.completedRootDigest === null ||
      attempt.completedSelectorDigest === null
      ? null
      : Object.freeze({
          rootDigest: attempt.completedRootDigest,
          selectorDigest: attempt.completedSelectorDigest,
          sourceUploadId: attempt.sourceUploadId,
          sourceGeneration: attempt.sourceGeneration,
          sourceMutationFence: attempt.sourceMutationFence,
          sourceRootDigest: attempt.sourceRootSha256,
          sourceSelectorDigest: attempt.sourceSelectorSha256,
        });
  return Object.freeze({
    uploadId: attempt.semanticUploadId,
    generation: attempt.generation,
    mutationFence: attempt.mutationFence,
    state: attempt.state,
    acceptedCommandId:
      attempt.pendingCommand?.commandId ?? attempt.lastCommandId,
    nextBlockOrdinal: attempt.nextBlockOrdinal,
    usage: Object.freeze({ ...attempt.usage }),
    completed,
  });
}

function projectAttemptReadError(
  uploadId: string,
  error:
    | SemanticArtifactV1AttemptStoreBudgetError
    | SemanticArtifactV1AttemptStoreCorruptionError
    | SemanticArtifactV1AttemptStoreResourceError,
): SemanticArtifactV1CheckpointReadError {
  if (error instanceof SemanticArtifactV1AttemptStoreBudgetError) {
    return new SemanticArtifactV1CheckpointReadBudgetError({
      uploadId,
      observed: error.observed,
      maximum: error.maximum,
    });
  }
  if (error instanceof SemanticArtifactV1AttemptStoreCorruptionError) {
    return new SemanticArtifactV1CheckpointReadCorruptionError({ uploadId });
  }
  return resourceFailure(
    uploadId,
    semanticArtifactV1AttemptStoreResourceCause(error),
  );
}

function resourceFailure(
  uploadId: string,
  cause: unknown,
): SemanticArtifactV1CheckpointReadResourceError {
  const error = new SemanticArtifactV1CheckpointReadResourceError({ uploadId });
  resourceCause.set(error, cause);
  return error;
}
