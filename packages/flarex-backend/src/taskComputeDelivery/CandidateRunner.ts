import {
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeCancellationTransportError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  TaskComputeProvider,
  type TaskComputeCancellationErrorV1,
  type TaskComputeDispatchErrorV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type {
  TaskComputeDeliveryCandidate,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import type {
  TaskComputeCancellationAcquireResultV1,
  TaskComputeCancellationReceiptRecordedV1,
  TaskComputeCancellationKnownFailureRecordedV1,
  TaskComputeDeliveryModeV1,
  TaskComputeDeliveryRepositoryErrorV1,
  TaskComputeDeliveryRepositoryV1,
  TaskComputeDispatchAcceptanceRecordedV1,
  TaskComputeDispatchAcquireResultV1,
  TaskComputeDispatchKnownFailureRecordedV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import { Context, Data, Effect, Layer, Result } from "effect";

type DispatchAcquireWithoutClaim = Exclude<
  TaskComputeDispatchAcquireResultV1,
  { readonly kind: "claimed" }
>;
type CancellationAcquireWithoutClaim = Exclude<
  TaskComputeCancellationAcquireResultV1,
  { readonly kind: "claimed" }
>;

export type TaskComputeDispatchCandidateOutcome =
  | Readonly<{
      readonly kind: "dispatch_not_called";
      readonly acquisition: DispatchAcquireWithoutClaim;
    }>
  | Readonly<{
      readonly kind: "dispatch_accepted";
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly deliveryAttemptCount: bigint;
      readonly settlement: TaskComputeDispatchAcceptanceRecordedV1;
    }>
  | Readonly<{
      readonly kind: "dispatch_known_failure";
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly deliveryAttemptCount: bigint;
      readonly settlement: TaskComputeDispatchKnownFailureRecordedV1;
    }>;

export type TaskComputeCancellationCandidateOutcome =
  | Readonly<{
      readonly kind: "cancellation_not_called";
      readonly acquisition: CancellationAcquireWithoutClaim;
    }>
  | Readonly<{
      readonly kind: "cancellation_delivered";
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly deliveryAttemptCount: bigint;
      readonly settlement: TaskComputeCancellationReceiptRecordedV1;
    }>
  | Readonly<{
      readonly kind: "cancellation_known_failure";
      readonly deliveryMode: TaskComputeDeliveryModeV1;
      readonly deliveryAttemptCount: bigint;
      readonly settlement: TaskComputeCancellationKnownFailureRecordedV1;
    }>;

export class TaskComputeDeliveryCandidateRunnerInputError
  extends Data.TaggedError("TaskComputeDeliveryCandidateRunnerInputError")<{
    readonly operation: "dispatch" | "cancellation";
    readonly reason: "invalid_candidate" | "operation_mismatch";
    readonly cause?: unknown;
  }> {}

type DispatchProviderUnsettledError = Exclude<
  TaskComputeDispatchErrorV1,
  TaskComputeDispatchRejectedError | TaskComputeDispatchTransportError
>;
type CancellationProviderUnsettledError = Exclude<
  TaskComputeCancellationErrorV1,
  | TaskComputeCancellationRejectedError
  | TaskComputeCancellationStaleError
  | TaskComputeCancellationTransportError
>;

export type TaskComputeDispatchCandidateRunnerError =
  | TaskComputeDeliveryCandidateRunnerInputError
  | DispatchProviderUnsettledError
  | TaskComputeDeliveryRepositoryErrorV1<
      | "acquire_dispatch"
      | "mark_dispatch_delivery_started"
      | "record_dispatch_acceptance"
      | "record_dispatch_known_failure"
    >;

export type TaskComputeCancellationCandidateRunnerError =
  | TaskComputeDeliveryCandidateRunnerInputError
  | CancellationProviderUnsettledError
  | TaskComputeDeliveryRepositoryErrorV1<
      | "acquire_cancellation"
      | "mark_cancellation_delivery_started"
      | "record_cancellation_receipt"
      | "record_cancellation_known_failure"
    >;

export interface TaskComputeDeliveryCandidateRunnerShape {
  readonly runDispatch: (
    repository: TaskComputeDeliveryRepositoryV1,
    candidate: TaskComputeDeliveryCandidate<"dispatch">,
  ) => Effect.Effect<
    TaskComputeDispatchCandidateOutcome,
    TaskComputeDispatchCandidateRunnerError
  >;
  readonly runCancellation: (
    repository: TaskComputeDeliveryRepositoryV1,
    candidate: TaskComputeDeliveryCandidate<"cancellation">,
  ) => Effect.Effect<
    TaskComputeCancellationCandidateOutcome,
    TaskComputeCancellationCandidateRunnerError
  >;
}

export class TaskComputeDeliveryCandidateRunner
  extends Context.Service<
    TaskComputeDeliveryCandidateRunner,
    TaskComputeDeliveryCandidateRunnerShape
  >()("flarex-backend/taskComputeDelivery/CandidateRunner") {}

export const TaskComputeDeliveryCandidateRunnerLive = Layer.effect(
  TaskComputeDeliveryCandidateRunner,
  Effect.gen(function* () {
    const provider = yield* TaskComputeProvider;
    const providerOwner = provider;
    const dispatch = provider.dispatch;
    const requestCancellation = provider.requestCancellation;

    const runDispatch: TaskComputeDeliveryCandidateRunnerShape["runDispatch"] =
      Effect.fn("TaskComputeDeliveryCandidateRunner.runDispatch")(
        function* (repository, suppliedCandidate) {
          const candidate = yield* Effect.fromResult(
            captureCandidate(suppliedCandidate, "dispatch"),
          );
          const repositoryOwner = repository;
          const acquireDispatch = repository.acquireDispatch;
          const markDeliveryStarted = repository.markDispatchDeliveryStarted;
          const recordAcceptance = repository.recordDispatchAcceptance;
          const recordKnownFailure = repository.recordDispatchKnownFailure;
          const acquisition = yield* acquireDispatch.call(repositoryOwner, {
            runId: candidate.runId,
            requestedEffectSequence: candidate.requestedEffectSequence,
          });
          if (acquisition.kind !== "claimed") {
            return Object.freeze({
              kind: "dispatch_not_called" as const,
              acquisition,
            });
          }

          const started = yield* markDeliveryStarted.call(
            repositoryOwner,
            acquisition.handle,
          );
          const providerOutcome = yield* dispatch.call(
            providerOwner,
            acquisition.prepared.dispatchRequest,
          ).pipe(
            Effect.map((acceptance) => Object.freeze({
              kind: "accepted" as const,
              acceptance,
            })),
            Effect.catchTags({
              TaskComputeDispatchRejectedError: (failure) => Effect.succeed(
                Object.freeze({ kind: "known_failure" as const, failure }),
              ),
              TaskComputeDispatchTransportError: (failure) => Effect.succeed(
                Object.freeze({ kind: "known_failure" as const, failure }),
              ),
            }),
          );

          if (providerOutcome.kind === "known_failure") {
            const settlement = yield* recordKnownFailure.call(
              repositoryOwner,
              acquisition.handle,
              providerOutcome.failure,
            );
            return Object.freeze({
              kind: "dispatch_known_failure" as const,
              deliveryMode: acquisition.deliveryMode,
              deliveryAttemptCount: started.deliveryAttemptCount,
              settlement,
            });
          }

          const settlement = yield* recordAcceptance.call(
            repositoryOwner,
            acquisition.handle,
            providerOutcome.acceptance,
          );
          return Object.freeze({
            kind: "dispatch_accepted" as const,
            deliveryMode: acquisition.deliveryMode,
            deliveryAttemptCount: started.deliveryAttemptCount,
            settlement,
          });
        },
      );

    const runCancellation:
      TaskComputeDeliveryCandidateRunnerShape["runCancellation"] = Effect.fn(
        "TaskComputeDeliveryCandidateRunner.runCancellation",
      )(function* (repository, suppliedCandidate) {
        const candidate = yield* Effect.fromResult(
          captureCandidate(suppliedCandidate, "cancellation"),
        );
        const repositoryOwner = repository;
        const acquireCancellation = repository.acquireCancellation;
        const markDeliveryStarted =
          repository.markCancellationDeliveryStarted;
        const recordReceipt = repository.recordCancellationReceipt;
        const recordKnownFailure =
          repository.recordCancellationKnownFailure;
        const acquisition = yield* acquireCancellation.call(repositoryOwner, {
          runId: candidate.runId,
          requestedEffectSequence: candidate.requestedEffectSequence,
        });
        if (acquisition.kind !== "claimed") {
          return Object.freeze({
            kind: "cancellation_not_called" as const,
            acquisition,
          });
        }

        const started = yield* markDeliveryStarted.call(
          repositoryOwner,
          acquisition.handle,
        );
        const providerOutcome = yield* requestCancellation.call(
          providerOwner,
          acquisition.request,
        ).pipe(
          Effect.map((receipt) => Object.freeze({
            kind: "delivered" as const,
            receipt,
          })),
          Effect.catchTags({
            TaskComputeCancellationRejectedError: (failure) => Effect.succeed(
              Object.freeze({ kind: "known_failure" as const, failure }),
            ),
            TaskComputeCancellationStaleError: (failure) => Effect.succeed(
              Object.freeze({ kind: "known_failure" as const, failure }),
            ),
            TaskComputeCancellationTransportError: (failure) => Effect.succeed(
              Object.freeze({ kind: "known_failure" as const, failure }),
            ),
          }),
        );

        if (providerOutcome.kind === "known_failure") {
          const settlement = yield* recordKnownFailure.call(
            repositoryOwner,
            acquisition.handle,
            providerOutcome.failure,
          );
          return Object.freeze({
            kind: "cancellation_known_failure" as const,
            deliveryMode: acquisition.deliveryMode,
            deliveryAttemptCount: started.deliveryAttemptCount,
            settlement,
          });
        }

        const settlement = yield* recordReceipt.call(
          repositoryOwner,
          acquisition.handle,
          providerOutcome.receipt,
        );
        return Object.freeze({
          kind: "cancellation_delivered" as const,
          deliveryMode: acquisition.deliveryMode,
          deliveryAttemptCount: started.deliveryAttemptCount,
          settlement,
        });
      });

    return TaskComputeDeliveryCandidateRunner.of(Object.freeze({
      runDispatch,
      runCancellation,
    }));
  }),
);

function captureCandidate<
  Operation extends "dispatch" | "cancellation",
>(
  input: TaskComputeDeliveryCandidate<Operation>,
  expectedOperation: Operation,
): Result.Result<
  Readonly<{
    readonly runId: TaskComputeDeliveryCandidate<Operation>["runId"];
    readonly requestedEffectSequence:
      TaskComputeDeliveryCandidate<Operation>["requestedEffectSequence"];
  }>,
  TaskComputeDeliveryCandidateRunnerInputError
> {
  return Result.try({
    try: () => {
      const operation = input.operation;
      const runId = input.runId;
      const requestedEffectSequence = input.requestedEffectSequence;
      return Object.freeze({ operation, runId, requestedEffectSequence });
    },
    catch: (cause) =>
      new TaskComputeDeliveryCandidateRunnerInputError({
        operation: expectedOperation,
        reason: "invalid_candidate",
        cause,
      }),
  }).pipe(
    Result.flatMap((captured) =>
      captured.operation === expectedOperation
        ? Result.succeed(Object.freeze({
          runId: captured.runId,
          requestedEffectSequence: captured.requestedEffectSequence,
        }))
        : Result.fail(
          new TaskComputeDeliveryCandidateRunnerInputError({
            operation: expectedOperation,
            reason: "operation_mismatch",
          }),
        )
    ),
  );
}
