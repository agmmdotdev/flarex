import { Data, Effect, Result } from "effect";

import {
  PointMutationRedeliverySchedulerConfigurationV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerCorruptionV1Error,
  PointMutationRedeliverySchedulerCryptoV1Error,
  PointMutationRedeliverySchedulerDecisionUncertainV1Error,
  PointMutationRedeliverySchedulerInputV1Error,
  PointMutationRedeliverySchedulerResourceExhaustedV1Error,
  PointMutationRedeliverySchedulerSqlV1Error,
  PointMutationRedeliverySchedulerStaleV1Error,
  createFencedSingletonSchedulerCheckpointEngineV1,
  type PointMutationRedeliverySchedulerAcquireV1Error,
  type PointMutationRedeliverySchedulerCheckpointV1Error,
  type PointMutationRedeliverySchedulerReleaseV1Error,
  type PointMutationRedeliverySchedulerRenewV1Error,
  type PointMutationRedeliverySchedulerRunV1,
  type PointMutationRedeliverySchedulerV1Error,
} from "./pointMutationRedeliverySchedulerCheckpoint";
import {
  MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
  TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
  TASK_REPAIR_SCHEDULER_KEY_V1,
} from "./taskRepairSchedulerModelV1";
import type {
  LocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
} from "./transactionSessionAttemptKernel";

export interface TaskRepairSchedulerRunV1 {
  readonly _tag: "TaskRepairSchedulerRunV1";
}

export interface TaskRepairSchedulerContinuationEvidenceV1 {
  readonly codecVersion: 1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export type TaskRepairSchedulerAcquireResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "acquired";
      readonly run: TaskRepairSchedulerRunV1;
      readonly claimExpiresAt: Date;
      readonly continuation: TaskRepairSchedulerContinuationEvidenceV1 | null;
    }>;

export type TaskRepairSchedulerRenewResultV1 = Readonly<{
  readonly kind: "renewed";
  readonly claimExpiresAt: Date;
}>;

export type TaskRepairSchedulerCheckpointResultV1 = Readonly<{
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}>;

export type TaskRepairSchedulerReleaseResultV1 = Readonly<{
  readonly kind: "released";
  readonly nextRunAt: Date;
}>;

type TaskRepairSchedulerOperationV1 =
  | "acquire"
  | "renew"
  | "checkpoint"
  | "release";

export class TaskRepairSchedulerConfigurationV1Error extends Data.TaggedError(
  "TaskRepairSchedulerConfigurationV1Error",
)<{ readonly reason: "invalidClaimDuration" }> {}

export class TaskRepairSchedulerInputV1Error extends Data.TaggedError(
  "TaskRepairSchedulerInputV1Error",
)<{
  readonly operation: Exclude<TaskRepairSchedulerOperationV1, "acquire">;
  readonly reason:
    | "invalidRun"
    | "runClosed"
    | "invalidContinuation"
    | "retryCommandMismatch";
}> {}

export class TaskRepairSchedulerStaleV1Error extends Data.TaggedError(
  "TaskRepairSchedulerStaleV1Error",
)<{
  readonly operation: Exclude<TaskRepairSchedulerOperationV1, "acquire">;
  readonly reason: "ownerChanged" | "claimExpired" | "checkpointChanged";
}> {}

export class TaskRepairSchedulerCorruptionV1Error extends Data.TaggedError(
  "TaskRepairSchedulerCorruptionV1Error",
)<{
  readonly operation: TaskRepairSchedulerOperationV1;
  readonly reason:
    | "singletonMissing"
    | "singletonDuplicated"
    | "rowInvalid"
    | "continuationInvalid"
    | "continuationDigestMismatch"
    | "driverResultInvalid";
  readonly cause?: unknown;
}> {}

export class TaskRepairSchedulerResourceExhaustedV1Error
  extends Data.TaggedError("TaskRepairSchedulerResourceExhaustedV1Error")<{
    readonly operation: "acquire" | "checkpoint";
    readonly dimension: "runFence" | "checkpointSequence";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class TaskRepairSchedulerConfirmedRollbackV1Error
  extends Data.TaggedError("TaskRepairSchedulerConfirmedRollbackV1Error")<{
    readonly operation: TaskRepairSchedulerOperationV1;
    readonly cause: unknown;
  }> {}

export class TaskRepairSchedulerDecisionUncertainV1Error
  extends Data.TaggedError("TaskRepairSchedulerDecisionUncertainV1Error")<{
    readonly operation: TaskRepairSchedulerOperationV1;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class TaskRepairSchedulerSqlV1Error extends Data.TaggedError(
  "TaskRepairSchedulerSqlV1Error",
)<{
  readonly operation: TaskRepairSchedulerOperationV1;
  readonly phase: "infrastructure" | "cleanup" | "statement";
  readonly cause: unknown;
}> {}

export class TaskRepairSchedulerCryptoV1Error extends Data.TaggedError(
  "TaskRepairSchedulerCryptoV1Error",
)<{
  readonly operation: "acquire" | "checkpoint";
  readonly cause: unknown;
}> {}

export type TaskRepairSchedulerV1Error =
  | TaskRepairSchedulerConfigurationV1Error
  | TaskRepairSchedulerInputV1Error
  | TaskRepairSchedulerStaleV1Error
  | TaskRepairSchedulerCorruptionV1Error
  | TaskRepairSchedulerResourceExhaustedV1Error
  | TaskRepairSchedulerConfirmedRollbackV1Error
  | TaskRepairSchedulerDecisionUncertainV1Error
  | TaskRepairSchedulerSqlV1Error
  | TaskRepairSchedulerCryptoV1Error;

export type TaskRepairSchedulerAcquireV1Error = Exclude<
  TaskRepairSchedulerV1Error,
  TaskRepairSchedulerInputV1Error | TaskRepairSchedulerStaleV1Error
>;

export type TaskRepairSchedulerRenewV1Error = Exclude<
  TaskRepairSchedulerV1Error,
  TaskRepairSchedulerCryptoV1Error | TaskRepairSchedulerResourceExhaustedV1Error
>;

export type TaskRepairSchedulerCheckpointV1Error = Exclude<
  TaskRepairSchedulerV1Error,
  TaskRepairSchedulerConfigurationV1Error
>;

export type TaskRepairSchedulerReleaseV1Error = Exclude<
  TaskRepairSchedulerV1Error,
  | TaskRepairSchedulerConfigurationV1Error
  | TaskRepairSchedulerCryptoV1Error
  | TaskRepairSchedulerResourceExhaustedV1Error
>;

export interface TaskRepairSchedulerCheckpointV1 {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    TaskRepairSchedulerConfigurationV1Error
  >;
  readonly acquireEffect: () => Effect.Effect<
    TaskRepairSchedulerAcquireResultV1,
    TaskRepairSchedulerAcquireV1Error
  >;
  readonly renewEffect: (
    run: TaskRepairSchedulerRunV1,
  ) => Effect.Effect<
    TaskRepairSchedulerRenewResultV1,
    TaskRepairSchedulerRenewV1Error
  >;
  readonly checkpointEffect: (
    run: TaskRepairSchedulerRunV1,
    continuation: TaskRepairSchedulerContinuationEvidenceV1 | null,
  ) => Effect.Effect<
    TaskRepairSchedulerCheckpointResultV1,
    TaskRepairSchedulerCheckpointV1Error
  >;
  readonly releaseEffect: (
    run: TaskRepairSchedulerRunV1,
  ) => Effect.Effect<
    TaskRepairSchedulerReleaseResultV1,
    TaskRepairSchedulerReleaseV1Error
  >;
}

export interface TaskRepairSchedulerCheckpointOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly randomUuid?: () => string;
}

const TASK_REPAIR_STORAGE_POLICY_V1 = Object.freeze({
  operationNamePrefix: "TaskRepairSchedulerCheckpoint",
  tableName: "fx_system_durable_task_repair_scheduler_v1",
  schedulerKey: TASK_REPAIR_SCHEDULER_KEY_V1,
  continuationCodecVersion: TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
  maximumContinuationBytes:
    MAX_TASK_REPAIR_SCHEDULER_CONTINUATION_BYTES_V1,
});

export function createTaskRepairSchedulerCheckpointV1(
  target: LocatedReadCommittedAttemptTargetV1,
  options: TaskRepairSchedulerCheckpointOptionsV1,
): TaskRepairSchedulerCheckpointV1 {
  const engine = createFencedSingletonSchedulerCheckpointEngineV1(
    target,
    options,
    TASK_REPAIR_STORAGE_POLICY_V1,
  );
  const runs = new WeakMap<object, PointMutationRedeliverySchedulerRunV1>();

  const configuration = engine.configuration.pipe(Result.mapError((error) =>
    new TaskRepairSchedulerConfigurationV1Error({ reason: error.reason })
  ));

  const acquireEffect: TaskRepairSchedulerCheckpointV1["acquireEffect"] =
    Effect.fn("TaskRepairSchedulerCheckpoint.acquire")(function* () {
      const result = yield* engine.acquireEffect().pipe(
        Effect.mapError(mapAcquireError),
      );
      if (result.kind === "notDue") {
        return Object.freeze({
          kind: "notDue" as const,
          nextRunAt: new Date(result.nextRunAt.getTime()),
        });
      }
      if (result.kind === "busy") {
        return Object.freeze({
          kind: "busy" as const,
          claimExpiresAt: new Date(result.claimExpiresAt.getTime()),
        });
      }
      const run = Object.freeze({ _tag: "TaskRepairSchedulerRunV1" as const });
      runs.set(run, result.run);
      return Object.freeze({
        kind: "acquired" as const,
        run,
        claimExpiresAt: new Date(result.claimExpiresAt.getTime()),
        continuation: result.continuation === null
          ? null
          : captureContinuation(result.continuation),
      });
    });

  const renewEffect: TaskRepairSchedulerCheckpointV1["renewEffect"] =
    Effect.fn("TaskRepairSchedulerCheckpoint.renew")(function* (run) {
      const engineRun = yield* lookupRun(runs, run, "renew");
      const result = yield* engine.renewEffect(engineRun).pipe(
        Effect.mapError(mapRenewError),
      );
      return Object.freeze({
        kind: "renewed" as const,
        claimExpiresAt: new Date(result.claimExpiresAt.getTime()),
      });
    });

  const checkpointEffect: TaskRepairSchedulerCheckpointV1["checkpointEffect"] =
    Effect.fn("TaskRepairSchedulerCheckpoint.checkpoint")(function* (
      run,
      continuation,
    ) {
      const engineRun = yield* lookupRun(runs, run, "checkpoint");
      const result = yield* engine.checkpointEffect(
        engineRun,
        continuation,
      ).pipe(Effect.mapError(mapCheckpointError));
      return Object.freeze({
        kind: "checkpointed" as const,
        checkpointSequence: result.checkpointSequence,
      });
    });

  const releaseEffect: TaskRepairSchedulerCheckpointV1["releaseEffect"] =
    Effect.fn("TaskRepairSchedulerCheckpoint.release")(function* (run) {
      const engineRun = yield* lookupRun(runs, run, "release");
      const result = yield* engine.releaseEffect(engineRun).pipe(
        Effect.mapError(mapReleaseError),
      );
      return Object.freeze({
        kind: "released" as const,
        nextRunAt: new Date(result.nextRunAt.getTime()),
      });
    });

  return Object.freeze({
    configuration,
    acquireEffect,
    renewEffect,
    checkpointEffect,
    releaseEffect,
  });
}

function lookupRun(
  runs: WeakMap<object, PointMutationRedeliverySchedulerRunV1>,
  run: TaskRepairSchedulerRunV1,
  operation: "renew" | "checkpoint" | "release",
): Effect.Effect<
  PointMutationRedeliverySchedulerRunV1,
  TaskRepairSchedulerInputV1Error
> {
  const found = typeof run === "object" && run !== null
    ? runs.get(run)
    : undefined;
  return found === undefined
    ? Effect.fail(new TaskRepairSchedulerInputV1Error({
      operation,
      reason: "invalidRun",
    }))
    : Effect.succeed(found);
}

function mapAcquireError(
  error: PointMutationRedeliverySchedulerAcquireV1Error,
): TaskRepairSchedulerAcquireV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof TaskRepairSchedulerInputV1Error ||
    mapped instanceof TaskRepairSchedulerStaleV1Error
  ) throw error;
  return mapped;
}

function mapRenewError(
  error: PointMutationRedeliverySchedulerRenewV1Error,
): TaskRepairSchedulerRenewV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof TaskRepairSchedulerCryptoV1Error ||
    mapped instanceof TaskRepairSchedulerResourceExhaustedV1Error
  ) throw error;
  return mapped;
}

function mapCheckpointError(
  error: PointMutationRedeliverySchedulerCheckpointV1Error,
): TaskRepairSchedulerCheckpointV1Error {
  const mapped = mapSchedulerError(error);
  if (mapped instanceof TaskRepairSchedulerConfigurationV1Error) throw error;
  return mapped;
}

function mapReleaseError(
  error: PointMutationRedeliverySchedulerReleaseV1Error,
): TaskRepairSchedulerReleaseV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof TaskRepairSchedulerConfigurationV1Error ||
    mapped instanceof TaskRepairSchedulerCryptoV1Error ||
    mapped instanceof TaskRepairSchedulerResourceExhaustedV1Error
  ) throw error;
  return mapped;
}

function mapSchedulerError(
  error: PointMutationRedeliverySchedulerV1Error,
): TaskRepairSchedulerV1Error {
  if (error instanceof PointMutationRedeliverySchedulerConfigurationV1Error) {
    return new TaskRepairSchedulerConfigurationV1Error({
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerInputV1Error) {
    return new TaskRepairSchedulerInputV1Error({
      operation: error.operation,
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerStaleV1Error) {
    return new TaskRepairSchedulerStaleV1Error({
      operation: error.operation,
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerCorruptionV1Error) {
    return new TaskRepairSchedulerCorruptionV1Error({
      operation: error.operation,
      reason: error.reason,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
  ) {
    return new TaskRepairSchedulerResourceExhaustedV1Error({
      operation: error.operation,
      dimension: error.dimension,
      observed: error.observed,
      maximum: error.maximum,
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerConfirmedRollbackV1Error
  ) {
    return new TaskRepairSchedulerConfirmedRollbackV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerDecisionUncertainV1Error
  ) {
    return new TaskRepairSchedulerDecisionUncertainV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerSqlV1Error) {
    return new TaskRepairSchedulerSqlV1Error({
      operation: error.operation,
      phase: error.phase,
      cause: error.cause,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerCryptoV1Error) {
    return new TaskRepairSchedulerCryptoV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  const exhaustive: never = error;
  throw exhaustive;
}

function captureContinuation(
  evidence: TaskRepairSchedulerContinuationEvidenceV1,
): TaskRepairSchedulerContinuationEvidenceV1 {
  const canonicalBytes = new Uint8Array(evidence.canonicalBytes);
  const sha256 = new Uint8Array(evidence.sha256);
  return Object.freeze({
    codecVersion: TASK_REPAIR_SCHEDULER_CONTINUATION_CODEC_V1,
    get canonicalBytes() {
      return new Uint8Array(canonicalBytes);
    },
    get sha256() {
      return new Uint8Array(sha256);
    },
  });
}

export function isTaskRepairSchedulerAcquireConfirmedRollbackV1Error(
  error: TaskRepairSchedulerAcquireV1Error,
): error is TaskRepairSchedulerConfirmedRollbackV1Error {
  return error instanceof TaskRepairSchedulerConfirmedRollbackV1Error &&
    error.operation === "acquire";
}

export function isTaskRepairSchedulerRenewConfirmedRollbackV1Error(
  error: TaskRepairSchedulerRenewV1Error,
): error is TaskRepairSchedulerConfirmedRollbackV1Error {
  return error instanceof TaskRepairSchedulerConfirmedRollbackV1Error &&
    error.operation === "renew";
}

export function isTaskRepairSchedulerCheckpointConfirmedRollbackV1Error(
  error: TaskRepairSchedulerCheckpointV1Error,
): error is TaskRepairSchedulerConfirmedRollbackV1Error {
  return error instanceof TaskRepairSchedulerConfirmedRollbackV1Error &&
    error.operation === "checkpoint";
}

export function isTaskRepairSchedulerReleaseConfirmedRollbackV1Error(
  error: TaskRepairSchedulerReleaseV1Error,
): error is TaskRepairSchedulerConfirmedRollbackV1Error {
  return error instanceof TaskRepairSchedulerConfirmedRollbackV1Error &&
    error.operation === "release";
}
