import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import {
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Layer,
  Result,
} from "effect";

import {
  TaskComputeDeliveryConnectedRunner,
  type TaskComputeDeliveryConnectedRunnerError,
  type TaskComputeDeliveryConnectedRunnerReceipt,
  type TaskComputeDeliveryConnectedRunnerShape,
} from "./ConnectedRunner.js";
import type {
  TaskAttemptSupervisorError,
  TaskAttemptSupervisorOutcome,
} from "./TaskAttemptSupervisor.js";
import {
  TaskComputeDeliverySupervisionControl,
} from "./WorkerLoaderTaskComputeProvider.js";

export interface TaskComputeDeliveryEventHostPolicy {
  readonly maximumDrainMilliseconds: number;
  readonly maximumSupervisionExits: number;
}

export interface TaskComputeDeliveryEventExitObserver {
  readonly admit: () => void;
  readonly observe: (
    exit: Exit.Exit<
      TaskAttemptSupervisorOutcome,
      TaskAttemptSupervisorError
    >,
  ) => void;
}

export interface TaskComputeDeliveryEventLayerFactory<LayerError> {
  readonly makeLayer: (
    observer: TaskComputeDeliveryEventExitObserver,
  ) => Layer.Layer<
    TaskComputeDeliveryConnectedRunner | TaskComputeDeliverySupervisionControl,
    LayerError
  >;
}

export interface TaskComputeDeliveryEventSupervisionReceipt {
  readonly expected: number;
  readonly observed: number;
  readonly succeeded: number;
  readonly failed: number;
}

export type TaskComputeDeliveryEventRunnerReceipt = Omit<
  TaskComputeDeliveryConnectedRunnerReceipt,
  "continuation"
>;

export interface TaskComputeDeliveryEventHostReceipt {
  readonly runner: TaskComputeDeliveryEventRunnerReceipt;
  readonly supervision: TaskComputeDeliveryEventSupervisionReceipt;
}

export interface TaskComputeDeliveryEventHostOutcome {
  readonly continuation: TaskComputeDeliveryConnectedRunnerReceipt[
    "continuation"
  ];
  readonly receipt: TaskComputeDeliveryEventHostReceipt;
}

export class TaskComputeDeliveryEventHostConfigurationError
  extends Data.TaggedError("TaskComputeDeliveryEventHostConfigurationError")<{
    readonly reason: "invalid_policy" | "invalid_layer_factory";
    readonly cause?: unknown;
  }> {}

export class TaskComputeDeliveryEventHostContractError
  extends Data.TaggedError("TaskComputeDeliveryEventHostContractError")<{
    readonly reason:
      | "supervision_limit_exceeded"
      | "supervision_count_mismatch";
    readonly expected: number;
    readonly observed: number;
    readonly maximum: number;
  }> {}

export class TaskComputeDeliveryEventHostDrainTimeoutError
  extends Data.TaggedError("TaskComputeDeliveryEventHostDrainTimeoutError")<{
    readonly maximumDrainMilliseconds: number;
    readonly expected: number;
    readonly observed: number;
  }> {}

export class TaskComputeDeliveryEventHostLayerConstructionError
  extends Data.TaggedError(
    "TaskComputeDeliveryEventHostLayerConstructionError",
  )<{
    readonly reason: "layer_factory_failed";
    readonly cause: unknown;
  }> {}

export type TaskComputeDeliveryEventHostError<LayerError> =
  | LayerError
  | TaskComputeDeliveryConnectedRunnerError
  | TaskComputeDeliveryEventHostContractError
  | TaskComputeDeliveryEventHostDrainTimeoutError
  | TaskComputeDeliveryEventHostLayerConstructionError;

export interface TaskComputeDeliveryEventHostShape<LayerError> {
  readonly run: (
    continuation: Parameters<
      TaskComputeDeliveryConnectedRunnerShape["run"]
    >[0],
  ) => Effect.Effect<
    TaskComputeDeliveryEventHostOutcome,
    TaskComputeDeliveryEventHostError<LayerError>
  >;
}

interface CapturedPolicy extends TaskComputeDeliveryEventHostPolicy {}

interface SupervisionSummary {
  readonly observed: number;
  readonly succeeded: number;
  readonly failed: number;
}

interface SupervisionTracker {
  readonly observer: TaskComputeDeliveryEventExitObserver;
  readonly sealAndAwait: Effect.Effect<
    TaskComputeDeliveryEventSupervisionReceipt,
    TaskComputeDeliveryEventHostContractError
  >;
  readonly snapshot: () => Readonly<{
    readonly expected: number;
    readonly observed: number;
  }>;
}

/**
 * Creates one reusable host configuration. Each `run` owns a fresh Layer scope
 * and exactly one connected delivery cycle within that scope.
 */
export function makeTaskComputeDeliveryEventHost<LayerError>(
  factory: TaskComputeDeliveryEventLayerFactory<LayerError>,
  policy: TaskComputeDeliveryEventHostPolicy,
): Result.Result<
  TaskComputeDeliveryEventHostShape<LayerError>,
  TaskComputeDeliveryEventHostConfigurationError
> {
  return Result.gen(function* () {
    const capturedFactory = yield* captureFactory(factory);
    const capturedPolicy = yield* capturePolicy(policy);

    const run: TaskComputeDeliveryEventHostShape<LayerError>["run"] = Effect.fn(
      "TaskComputeDeliveryEventHost.run",
    )(continuation => Effect.scoped(Effect.gen(function* () {
      const tracker = makeSupervisionTracker(capturedPolicy);
      const layer = yield* Effect.try({
        try: () => capturedFactory(tracker.observer),
        catch: cause => new TaskComputeDeliveryEventHostLayerConstructionError({
          reason: "layer_factory_failed",
          cause,
        }),
      });
      return yield* Effect.gen(function* () {
        const runner = yield* TaskComputeDeliveryConnectedRunner;
        const supervisionControl = yield*
          TaskComputeDeliverySupervisionControl;
        const runnerExit = yield* Effect.exit(runner.run(continuation));
        if (
          Exit.isFailure(runnerExit) &&
          Cause.hasInterrupts(runnerExit.cause)
        ) {
          return yield* Effect.failCause(runnerExit.cause);
        }
        const supervision = yield* Effect.gen(function* () {
          yield* supervisionControl.quiesce();
          return yield* tracker.sealAndAwait;
        }).pipe(Effect.timeoutOrElse({
          duration: Duration.millis(capturedPolicy.maximumDrainMilliseconds),
          orElse: () => {
            const snapshot = tracker.snapshot();
            return Effect.fail(
              new TaskComputeDeliveryEventHostDrainTimeoutError({
                maximumDrainMilliseconds:
                  capturedPolicy.maximumDrainMilliseconds,
                expected: snapshot.expected,
                observed: snapshot.observed,
              }),
            );
          },
        }));
        if (Exit.isFailure(runnerExit)) {
          return yield* Effect.failCause(runnerExit.cause);
        }
        const projected = projectRunnerReceipt(runnerExit.value);
        return Object.freeze({
          continuation: runnerExit.value.continuation,
          receipt: Object.freeze({
            runner: projected,
            supervision,
          }),
        });
      }).pipe(Effect.provide(layer));
    })));

    return Object.freeze({ run });
  });
}

function makeSupervisionTracker(policy: CapturedPolicy): SupervisionTracker {
  const drained = Deferred.makeUnsafe<
    SupervisionSummary,
    TaskComputeDeliveryEventHostContractError
  >();
  let admitted = 0;
  let observed = 0;
  let succeeded = 0;
  let failed = 0;
  let sealedExpected: number | undefined;
  let contractError: TaskComputeDeliveryEventHostContractError | undefined;

  const completeIfReady = (): void => {
    if (contractError !== undefined || sealedExpected === undefined) return;
    if (observed > sealedExpected) {
      contractError = new TaskComputeDeliveryEventHostContractError({
        reason: "supervision_count_mismatch",
        expected: sealedExpected,
        observed,
        maximum: policy.maximumSupervisionExits,
      });
      Deferred.doneUnsafe(drained, Effect.fail(contractError));
      return;
    }
    if (observed === sealedExpected) {
      Deferred.doneUnsafe(drained, Effect.succeed(Object.freeze({
        observed,
        succeeded,
        failed,
      })));
    }
  };

  const admit: TaskComputeDeliveryEventExitObserver["admit"] = () => {
    admitted += 1;
    if (sealedExpected !== undefined && contractError === undefined) {
      contractError = new TaskComputeDeliveryEventHostContractError({
        reason: "supervision_count_mismatch",
        expected: sealedExpected,
        observed,
        maximum: policy.maximumSupervisionExits,
      });
      Deferred.doneUnsafe(drained, Effect.fail(contractError));
      return;
    }
    if (
      contractError === undefined &&
      admitted > policy.maximumSupervisionExits
    ) {
      contractError = new TaskComputeDeliveryEventHostContractError({
        reason: "supervision_limit_exceeded",
        expected: admitted,
        observed,
        maximum: policy.maximumSupervisionExits,
      });
      Deferred.doneUnsafe(drained, Effect.fail(contractError));
      return;
    }
    completeIfReady();
  };

  const observe: TaskComputeDeliveryEventExitObserver["observe"] = exit => {
    observed += 1;
    if (Exit.isSuccess(exit)) succeeded += 1;
    else failed += 1;
    if (
      contractError === undefined &&
      observed > policy.maximumSupervisionExits
    ) {
      contractError = new TaskComputeDeliveryEventHostContractError({
        reason: "supervision_limit_exceeded",
        expected: admitted,
        observed,
        maximum: policy.maximumSupervisionExits,
      });
      Deferred.doneUnsafe(drained, Effect.fail(contractError));
      return;
    }
    completeIfReady();
  };
  const observer: TaskComputeDeliveryEventExitObserver = Object.freeze({
    admit,
    observe,
  });

  const sealAndAwait: SupervisionTracker["sealAndAwait"] = Effect.suspend(() => {
    const expected = admitted;
    sealedExpected = expected;
    if (contractError !== undefined) return Effect.fail(contractError);
    if (observed > expected) {
      return Effect.fail(new TaskComputeDeliveryEventHostContractError({
        reason: "supervision_count_mismatch",
        expected,
        observed,
        maximum: policy.maximumSupervisionExits,
      }));
    }
    completeIfReady();
    return Deferred.await(drained).pipe(Effect.flatMap(summary => {
      if (contractError !== undefined || observed !== expected) {
        return Effect.fail(contractError ??
          new TaskComputeDeliveryEventHostContractError({
            reason: "supervision_count_mismatch",
            expected,
            observed,
            maximum: policy.maximumSupervisionExits,
          }));
      }
      return Effect.succeed(Object.freeze({
        expected,
        ...summary,
      }));
    }));
  });

  const snapshot: SupervisionTracker["snapshot"] = () => Object.freeze({
    expected: sealedExpected ?? admitted,
    observed,
  });

  return Object.freeze({ observer, sealAndAwait, snapshot });
}

function projectRunnerReceipt(
  receipt: TaskComputeDeliveryConnectedRunnerReceipt,
): TaskComputeDeliveryEventRunnerReceipt {
  return Object.freeze({
    version: receipt.version,
    stopReason: receipt.stopReason,
    directoryPagesCharged: receipt.directoryPagesCharged,
    scopeVisits: receipt.scopeVisits,
    scopeResolutionFailures: receipt.scopeResolutionFailures,
    discoveryFailures: receipt.discoveryFailures,
    dispatchPagesCharged: receipt.dispatchPagesCharged,
    cancellationPagesCharged: receipt.cancellationPagesCharged,
    dispatchCandidatesCharged: receipt.dispatchCandidatesCharged,
    cancellationCandidatesCharged: receipt.cancellationCandidatesCharged,
    dispatchProviderCallsCharged: receipt.dispatchProviderCallsCharged,
    cancellationProviderCallsCharged:
      receipt.cancellationProviderCallsCharged,
    totalOperationsCharged: receipt.totalOperationsCharged,
    confirmedDispatchPagesRead: receipt.confirmedDispatchPagesRead,
    confirmedCancellationPagesRead: receipt.confirmedCancellationPagesRead,
    confirmedDispatchCandidatesHandled:
      receipt.confirmedDispatchCandidatesHandled,
    confirmedCancellationCandidatesHandled:
      receipt.confirmedCancellationCandidatesHandled,
    confirmedDispatchProviderCalls: receipt.confirmedDispatchProviderCalls,
    confirmedCancellationProviderCalls:
      receipt.confirmedCancellationProviderCalls,
    candidateFailures: receipt.candidateFailures,
  });
}

function capturePolicy(
  input: TaskComputeDeliveryEventHostPolicy,
): Result.Result<
  CapturedPolicy,
  TaskComputeDeliveryEventHostConfigurationError
> {
  return Result.try({
    try: () => Object.freeze({
      maximumDrainMilliseconds: input.maximumDrainMilliseconds,
      maximumSupervisionExits: input.maximumSupervisionExits,
    }),
    catch: cause => new TaskComputeDeliveryEventHostConfigurationError({
        reason: "invalid_policy",
        cause,
      }),
  }).pipe(Result.flatMap(captured =>
    isPositiveSafeInteger(captured.maximumDrainMilliseconds) &&
      isPositiveSafeInteger(captured.maximumSupervisionExits)
      ? Result.succeed(captured)
      : Result.fail(new TaskComputeDeliveryEventHostConfigurationError({
          reason: "invalid_policy",
        }))
  ));
}

function captureFactory<LayerError>(
  input: TaskComputeDeliveryEventLayerFactory<LayerError>,
): Result.Result<
  (
    observer: TaskComputeDeliveryEventExitObserver,
  ) => Layer.Layer<
    TaskComputeDeliveryConnectedRunner | TaskComputeDeliverySupervisionControl,
    LayerError
  >,
  TaskComputeDeliveryEventHostConfigurationError
> {
  return Result.try({
    try: () => input.makeLayer,
    catch: cause => new TaskComputeDeliveryEventHostConfigurationError({
        reason: "invalid_layer_factory",
        cause,
      }),
  }).pipe(Result.flatMap(makeLayer => typeof makeLayer === "function"
    ? Result.succeed((observer: TaskComputeDeliveryEventExitObserver) =>
        Reflect.apply(makeLayer, input, [observer]))
    : Result.fail(new TaskComputeDeliveryEventHostConfigurationError({
        reason: "invalid_layer_factory",
      }))));
}
