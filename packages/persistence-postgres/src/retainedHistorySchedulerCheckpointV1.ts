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
  MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
  RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
  RETAINED_HISTORY_SCHEDULER_KEY_V1,
} from "./retainedHistorySchedulerModelV1";
import type {
  LocatedReadCommittedAttemptTargetV1,
  LocatedReadCommittedTransactionFailureV1,
} from "./transactionSessionAttemptKernel";

export interface RetainedHistorySchedulerRunV1 {
  readonly _tag: "RetainedHistorySchedulerRunV1";
}

export interface RetainedHistorySchedulerContinuationEvidenceV1 {
  readonly codecVersion: 1;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: Uint8Array;
}

export type RetainedHistorySchedulerAcquireResultV1 =
  | Readonly<{ readonly kind: "notDue"; readonly nextRunAt: Date }>
  | Readonly<{ readonly kind: "busy"; readonly claimExpiresAt: Date }>
  | Readonly<{
      readonly kind: "acquired";
      readonly run: RetainedHistorySchedulerRunV1;
      readonly claimExpiresAt: Date;
      readonly continuation: RetainedHistorySchedulerContinuationEvidenceV1 | null;
    }>;

export type RetainedHistorySchedulerRenewResultV1 = Readonly<{
  readonly kind: "renewed";
  readonly claimExpiresAt: Date;
}>;

export type RetainedHistorySchedulerCheckpointResultV1 = Readonly<{
  readonly kind: "checkpointed";
  readonly checkpointSequence: bigint;
}>;

export type RetainedHistorySchedulerReleaseResultV1 = Readonly<{
  readonly kind: "released";
  readonly nextRunAt: Date;
}>;

type RetainedHistorySchedulerOperationV1 =
  | "acquire"
  | "renew"
  | "checkpoint"
  | "release";

export class RetainedHistorySchedulerConfigurationV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerConfigurationV1Error",
)<{ readonly reason: "invalidClaimDuration" }> {}

export class RetainedHistorySchedulerInputV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerInputV1Error",
)<{
  readonly operation: Exclude<RetainedHistorySchedulerOperationV1, "acquire">;
  readonly reason:
    | "invalidRun"
    | "runClosed"
    | "invalidContinuation"
    | "retryCommandMismatch";
}> {}

export class RetainedHistorySchedulerStaleV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerStaleV1Error",
)<{
  readonly operation: Exclude<RetainedHistorySchedulerOperationV1, "acquire">;
  readonly reason: "ownerChanged" | "claimExpired" | "checkpointChanged";
}> {}

export class RetainedHistorySchedulerCorruptionV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerCorruptionV1Error",
)<{
  readonly operation: RetainedHistorySchedulerOperationV1;
  readonly reason:
    | "singletonMissing"
    | "singletonDuplicated"
    | "rowInvalid"
    | "continuationInvalid"
    | "continuationDigestMismatch"
    | "driverResultInvalid";
  readonly cause?: unknown;
}> {}

export class RetainedHistorySchedulerResourceExhaustedV1Error
  extends Data.TaggedError("RetainedHistorySchedulerResourceExhaustedV1Error")<{
    readonly operation: "acquire" | "checkpoint";
    readonly dimension: "runFence" | "checkpointSequence";
    readonly observed: bigint;
    readonly maximum: bigint;
  }> {}

export class RetainedHistorySchedulerConfirmedRollbackV1Error
  extends Data.TaggedError("RetainedHistorySchedulerConfirmedRollbackV1Error")<{
    readonly operation: RetainedHistorySchedulerOperationV1;
    readonly cause: unknown;
  }> {}

export class RetainedHistorySchedulerDecisionUncertainV1Error
  extends Data.TaggedError("RetainedHistorySchedulerDecisionUncertainV1Error")<{
    readonly operation: RetainedHistorySchedulerOperationV1;
    readonly cause: LocatedReadCommittedTransactionFailureV1;
  }> {}

export class RetainedHistorySchedulerSqlV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerSqlV1Error",
)<{
  readonly operation: RetainedHistorySchedulerOperationV1;
  readonly phase: "infrastructure" | "cleanup" | "statement";
  readonly cause: unknown;
}> {}

export class RetainedHistorySchedulerCryptoV1Error extends Data.TaggedError(
  "RetainedHistorySchedulerCryptoV1Error",
)<{
  readonly operation: "acquire" | "checkpoint";
  readonly cause: unknown;
}> {}

export type RetainedHistorySchedulerV1Error =
  | RetainedHistorySchedulerConfigurationV1Error
  | RetainedHistorySchedulerInputV1Error
  | RetainedHistorySchedulerStaleV1Error
  | RetainedHistorySchedulerCorruptionV1Error
  | RetainedHistorySchedulerResourceExhaustedV1Error
  | RetainedHistorySchedulerConfirmedRollbackV1Error
  | RetainedHistorySchedulerDecisionUncertainV1Error
  | RetainedHistorySchedulerSqlV1Error
  | RetainedHistorySchedulerCryptoV1Error;

export type RetainedHistorySchedulerAcquireV1Error = Exclude<
  RetainedHistorySchedulerV1Error,
  RetainedHistorySchedulerInputV1Error | RetainedHistorySchedulerStaleV1Error
>;

export type RetainedHistorySchedulerRenewV1Error = Exclude<
  RetainedHistorySchedulerV1Error,
  RetainedHistorySchedulerCryptoV1Error | RetainedHistorySchedulerResourceExhaustedV1Error
>;

export type RetainedHistorySchedulerCheckpointV1Error = Exclude<
  RetainedHistorySchedulerV1Error,
  RetainedHistorySchedulerConfigurationV1Error
>;

export type RetainedHistorySchedulerReleaseV1Error = Exclude<
  RetainedHistorySchedulerV1Error,
  | RetainedHistorySchedulerConfigurationV1Error
  | RetainedHistorySchedulerCryptoV1Error
  | RetainedHistorySchedulerResourceExhaustedV1Error
>;

export interface RetainedHistorySchedulerCheckpointV1 {
  readonly configuration: Result.Result<
    Readonly<{ readonly claimDurationMilliseconds: number }>,
    RetainedHistorySchedulerConfigurationV1Error
  >;
  readonly acquireEffect: () => Effect.Effect<
    RetainedHistorySchedulerAcquireResultV1,
    RetainedHistorySchedulerAcquireV1Error
  >;
  readonly renewEffect: (
    run: RetainedHistorySchedulerRunV1,
  ) => Effect.Effect<
    RetainedHistorySchedulerRenewResultV1,
    RetainedHistorySchedulerRenewV1Error
  >;
  readonly checkpointEffect: (
    run: RetainedHistorySchedulerRunV1,
    continuation: RetainedHistorySchedulerContinuationEvidenceV1 | null,
  ) => Effect.Effect<
    RetainedHistorySchedulerCheckpointResultV1,
    RetainedHistorySchedulerCheckpointV1Error
  >;
  readonly releaseEffect: (
    run: RetainedHistorySchedulerRunV1,
  ) => Effect.Effect<
    RetainedHistorySchedulerReleaseResultV1,
    RetainedHistorySchedulerReleaseV1Error
  >;
}

export interface RetainedHistorySchedulerCheckpointOptionsV1 {
  readonly claimDurationMilliseconds: number;
  readonly randomUuid?: () => string;
}

const RETAINED_HISTORY_STORAGE_POLICY_V1 = Object.freeze({
  operationNamePrefix: "RetainedHistorySchedulerCheckpoint",
  tableName: "fx_system_retained_history_scheduler",
  schedulerKey: RETAINED_HISTORY_SCHEDULER_KEY_V1,
  continuationCodecVersion: RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
  maximumContinuationBytes:
    MAX_RETAINED_HISTORY_SCHEDULER_CONTINUATION_BYTES_V1,
});

export function createRetainedHistorySchedulerCheckpointV1(
  target: LocatedReadCommittedAttemptTargetV1,
  options: RetainedHistorySchedulerCheckpointOptionsV1,
): RetainedHistorySchedulerCheckpointV1 {
  const engine = createFencedSingletonSchedulerCheckpointEngineV1(
    target,
    options,
    RETAINED_HISTORY_STORAGE_POLICY_V1,
  );
  const runs = new WeakMap<object, PointMutationRedeliverySchedulerRunV1>();

  const configuration = engine.configuration.pipe(Result.mapError((error) =>
    new RetainedHistorySchedulerConfigurationV1Error({ reason: error.reason })
  ));

  const acquireEffect: RetainedHistorySchedulerCheckpointV1["acquireEffect"] =
    Effect.fn("RetainedHistorySchedulerCheckpoint.acquire")(function* () {
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
      const run = Object.freeze({ _tag: "RetainedHistorySchedulerRunV1" as const });
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

  const renewEffect: RetainedHistorySchedulerCheckpointV1["renewEffect"] =
    Effect.fn("RetainedHistorySchedulerCheckpoint.renew")(function* (run) {
      const engineRun = yield* lookupRun(runs, run, "renew");
      const result = yield* engine.renewEffect(engineRun).pipe(
        Effect.mapError(mapRenewError),
      );
      return Object.freeze({
        kind: "renewed" as const,
        claimExpiresAt: new Date(result.claimExpiresAt.getTime()),
      });
    });

  const checkpointEffect: RetainedHistorySchedulerCheckpointV1["checkpointEffect"] =
    Effect.fn("RetainedHistorySchedulerCheckpoint.checkpoint")(function* (
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

  const releaseEffect: RetainedHistorySchedulerCheckpointV1["releaseEffect"] =
    Effect.fn("RetainedHistorySchedulerCheckpoint.release")(function* (run) {
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
  run: RetainedHistorySchedulerRunV1,
  operation: "renew" | "checkpoint" | "release",
): Effect.Effect<
  PointMutationRedeliverySchedulerRunV1,
  RetainedHistorySchedulerInputV1Error
> {
  const found = typeof run === "object" && run !== null
    ? runs.get(run)
    : undefined;
  return found === undefined
    ? Effect.fail(new RetainedHistorySchedulerInputV1Error({
      operation,
      reason: "invalidRun",
    }))
    : Effect.succeed(found);
}

function mapAcquireError(
  error: PointMutationRedeliverySchedulerAcquireV1Error,
): RetainedHistorySchedulerAcquireV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof RetainedHistorySchedulerInputV1Error ||
    mapped instanceof RetainedHistorySchedulerStaleV1Error
  ) throw error;
  return mapped;
}

function mapRenewError(
  error: PointMutationRedeliverySchedulerRenewV1Error,
): RetainedHistorySchedulerRenewV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof RetainedHistorySchedulerCryptoV1Error ||
    mapped instanceof RetainedHistorySchedulerResourceExhaustedV1Error
  ) throw error;
  return mapped;
}

function mapCheckpointError(
  error: PointMutationRedeliverySchedulerCheckpointV1Error,
): RetainedHistorySchedulerCheckpointV1Error {
  const mapped = mapSchedulerError(error);
  if (mapped instanceof RetainedHistorySchedulerConfigurationV1Error) throw error;
  return mapped;
}

function mapReleaseError(
  error: PointMutationRedeliverySchedulerReleaseV1Error,
): RetainedHistorySchedulerReleaseV1Error {
  const mapped = mapSchedulerError(error);
  if (
    mapped instanceof RetainedHistorySchedulerConfigurationV1Error ||
    mapped instanceof RetainedHistorySchedulerCryptoV1Error ||
    mapped instanceof RetainedHistorySchedulerResourceExhaustedV1Error
  ) throw error;
  return mapped;
}

function mapSchedulerError(
  error: PointMutationRedeliverySchedulerV1Error,
): RetainedHistorySchedulerV1Error {
  if (error instanceof PointMutationRedeliverySchedulerConfigurationV1Error) {
    return new RetainedHistorySchedulerConfigurationV1Error({
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerInputV1Error) {
    return new RetainedHistorySchedulerInputV1Error({
      operation: error.operation,
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerStaleV1Error) {
    return new RetainedHistorySchedulerStaleV1Error({
      operation: error.operation,
      reason: error.reason,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerCorruptionV1Error) {
    return new RetainedHistorySchedulerCorruptionV1Error({
      operation: error.operation,
      reason: error.reason,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerResourceExhaustedV1Error
  ) {
    return new RetainedHistorySchedulerResourceExhaustedV1Error({
      operation: error.operation,
      dimension: error.dimension,
      observed: error.observed,
      maximum: error.maximum,
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerConfirmedRollbackV1Error
  ) {
    return new RetainedHistorySchedulerConfirmedRollbackV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  if (
    error instanceof PointMutationRedeliverySchedulerDecisionUncertainV1Error
  ) {
    return new RetainedHistorySchedulerDecisionUncertainV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerSqlV1Error) {
    return new RetainedHistorySchedulerSqlV1Error({
      operation: error.operation,
      phase: error.phase,
      cause: error.cause,
    });
  }
  if (error instanceof PointMutationRedeliverySchedulerCryptoV1Error) {
    return new RetainedHistorySchedulerCryptoV1Error({
      operation: error.operation,
      cause: error.cause,
    });
  }
  const exhaustive: never = error;
  throw exhaustive;
}

function captureContinuation(
  evidence: RetainedHistorySchedulerContinuationEvidenceV1,
): RetainedHistorySchedulerContinuationEvidenceV1 {
  const canonicalBytes = new Uint8Array(evidence.canonicalBytes);
  const sha256 = new Uint8Array(evidence.sha256);
  return Object.freeze({
    codecVersion: RETAINED_HISTORY_SCHEDULER_CONTINUATION_CODEC_V1,
    get canonicalBytes() {
      return new Uint8Array(canonicalBytes);
    },
    get sha256() {
      return new Uint8Array(sha256);
    },
  });
}

export function isRetainedHistorySchedulerAcquireConfirmedRollbackV1Error(
  error: RetainedHistorySchedulerAcquireV1Error,
): error is RetainedHistorySchedulerConfirmedRollbackV1Error {
  return error instanceof RetainedHistorySchedulerConfirmedRollbackV1Error &&
    error.operation === "acquire";
}

export function isRetainedHistorySchedulerRenewConfirmedRollbackV1Error(
  error: RetainedHistorySchedulerRenewV1Error,
): error is RetainedHistorySchedulerConfirmedRollbackV1Error {
  return error instanceof RetainedHistorySchedulerConfirmedRollbackV1Error &&
    error.operation === "renew";
}

export function isRetainedHistorySchedulerCheckpointConfirmedRollbackV1Error(
  error: RetainedHistorySchedulerCheckpointV1Error,
): error is RetainedHistorySchedulerConfirmedRollbackV1Error {
  return error instanceof RetainedHistorySchedulerConfirmedRollbackV1Error &&
    error.operation === "checkpoint";
}

export function isRetainedHistorySchedulerReleaseConfirmedRollbackV1Error(
  error: RetainedHistorySchedulerReleaseV1Error,
): error is RetainedHistorySchedulerConfirmedRollbackV1Error {
  return error instanceof RetainedHistorySchedulerConfirmedRollbackV1Error &&
    error.operation === "release";
}
