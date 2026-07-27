import { Data, Effect } from "effect";
import type { DeploymentSqlStorage } from "../deployment/Store";
import {
  makeSourceArtifactV2BoundedAttemptReader,
  sourceArtifactV2AttemptStoreResourceCause,
  SourceArtifactV2AttemptStoreBudgetError,
  SourceArtifactV2AttemptStoreCorruptionError,
  SourceArtifactV2AttemptStoreResourceError,
  type SourceArtifactV2Attempt,
  type SourceArtifactV2AttemptLifecycle,
  type SourceArtifactV2AttemptReadBudget,
  type SourceArtifactV2ResourceBudget,
} from "./AttemptStore";

export type SourceArtifactV2CheckpointReadBudget =
  SourceArtifactV2AttemptReadBudget;

export interface SourceArtifactV2CheckpointCurrentModule {
  readonly path: string;
  readonly nextSourceBlockIndex: number;
  readonly nextSourceMapBlockIndex: number;
  readonly sourceMapStarted: boolean;
}

export interface SourceArtifactV2CheckpointSnapshot {
  readonly uploadId: string;
  readonly generation: number;
  readonly mutationFence: number;
  readonly state: SourceArtifactV2AttemptLifecycle;
  readonly acceptedCommandId: string;
  readonly nextModuleOrdinal: number;
  readonly currentModule: SourceArtifactV2CheckpointCurrentModule | null;
  readonly usage: SourceArtifactV2ResourceBudget;
  readonly completedRootDigest: string | null;
  readonly completedSelectorDigest: string | null;
}

export class SourceArtifactV2CheckpointReadBudgetError extends Data.TaggedError(
  "SourceArtifactV2CheckpointReadBudgetError",
)<{
  readonly uploadId: string;
  readonly dimension: "calls" | "storedBytes";
  readonly observed: number;
  readonly maximum: number;
}> {}

export class SourceArtifactV2CheckpointReadCorruptionError extends Data.TaggedError(
  "SourceArtifactV2CheckpointReadCorruptionError",
)<{ readonly uploadId: string }> {}

export class SourceArtifactV2CheckpointReadResourceError extends Data.TaggedError(
  "SourceArtifactV2CheckpointReadResourceError",
)<{ readonly uploadId: string }> {}

export type SourceArtifactV2CheckpointReadError =
  | SourceArtifactV2CheckpointReadBudgetError
  | SourceArtifactV2CheckpointReadCorruptionError
  | SourceArtifactV2CheckpointReadResourceError;

export interface SourceArtifactV2CheckpointReader {
  readonly read: (
    uploadId: string,
    budget: SourceArtifactV2CheckpointReadBudget,
  ) => Effect.Effect<
    SourceArtifactV2CheckpointSnapshot | null,
    SourceArtifactV2CheckpointReadError
  >;
}

const resourceCause =
  new WeakMap<SourceArtifactV2CheckpointReadResourceError, unknown>();

export function sourceArtifactV2CheckpointReadResourceCause(
  error: SourceArtifactV2CheckpointReadResourceError,
): unknown {
  return resourceCause.get(error);
}

export function makeSourceArtifactV2CheckpointReader(
  sql: Pick<DeploymentSqlStorage, "exec">,
): SourceArtifactV2CheckpointReader {
  const attemptReader = makeSourceArtifactV2BoundedAttemptReader(sql);
  const read = Effect.fn("SourceArtifactV2CheckpointReader.read")(
    (
      uploadId: string,
      budget: SourceArtifactV2CheckpointReadBudget,
    ): Effect.Effect<
      SourceArtifactV2CheckpointSnapshot | null,
      SourceArtifactV2CheckpointReadError
    > => attemptReader.read(uploadId, budget).pipe(
      Effect.mapError(error => projectAttemptReadError(uploadId, error)),
      Effect.map(attempt => attempt === null
        ? null
        : projectSourceArtifactV2CheckpointSnapshot(attempt)),
    ),
  );
  return Object.freeze({ read });
}

export function projectSourceArtifactV2CheckpointSnapshot(
  attempt: SourceArtifactV2Attempt,
): SourceArtifactV2CheckpointSnapshot {
  return Object.freeze({
    uploadId: attempt.uploadId,
    generation: attempt.generation,
    mutationFence: attempt.mutationFence,
    state: attempt.state,
    acceptedCommandId:
      attempt.pendingCommand?.commandId ?? attempt.lastCommandId,
    nextModuleOrdinal: attempt.nextModuleOrdinal,
    currentModule: attempt.currentModule === null
      ? null
      : Object.freeze({
          path: attempt.currentModule.path,
          nextSourceBlockIndex: attempt.currentModule.source.blockCount,
          nextSourceMapBlockIndex:
            attempt.currentModule.sourceMap.blockCount,
          sourceMapStarted: attempt.currentModule.sourceMapStarted,
        }),
    usage: Object.freeze({ ...attempt.usage }),
    completedRootDigest: attempt.completedRootDigest,
    completedSelectorDigest: attempt.completedSelectorDigest,
  });
}

function projectAttemptReadError(
  uploadId: string,
  error:
    | SourceArtifactV2AttemptStoreBudgetError
    | SourceArtifactV2AttemptStoreCorruptionError
    | SourceArtifactV2AttemptStoreResourceError,
): SourceArtifactV2CheckpointReadError {
  if (error instanceof SourceArtifactV2AttemptStoreBudgetError) {
    return new SourceArtifactV2CheckpointReadBudgetError({
      uploadId,
      dimension: error.dimension,
      observed: error.observed,
      maximum: error.maximum,
    });
  }
  if (error instanceof SourceArtifactV2AttemptStoreCorruptionError) {
    return new SourceArtifactV2CheckpointReadCorruptionError({ uploadId });
  }
  return resourceFailure(
    uploadId,
    sourceArtifactV2AttemptStoreResourceCause(error),
  );
}

function resourceFailure(
  uploadId: string,
  cause: unknown,
): SourceArtifactV2CheckpointReadResourceError {
  const error = new SourceArtifactV2CheckpointReadResourceError({ uploadId });
  resourceCause.set(error, cause);
  return error;
}
