import type {
  CompleteAttemptCurrentReasonV1,
  CompleteAttemptOutcomeV1,
  HeartbeatAttemptOutcomeV1,
  HeartbeatAttemptCurrentReasonV1,
  ApplicationHeartbeatAttemptOutcomeV1,
  ApplicationCompleteAttemptOutcomeV1,
  ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  TaskAttemptCompletionV1,
  TaskSystemRunAttemptTransactionReceiptV1,
  TaskSystemRunAttemptTransientStoreError,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { encodeTaskAttemptCompletionV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import type {
  CurrentTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type {
  TaskAttemptLifecycleCapability,
  TaskAttemptLifecycleGatewayCompleteError,
  TaskAttemptLifecycleGatewayHeartbeatError,
  TaskAttemptLifecycleGatewayResolveError,
} from "@flarex/persistence-postgres/internal/task-attempt-lifecycle-gateway";
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from
  "@flarex/utils/numbers";
import { Cause, Data, Effect, Exit, Result } from "effect";
import {
  type TaskResultStore,
  type TaskResultStoreError,
} from "../taskResult/TaskResultStore.js";
import {
  mapTaskExecutionTerminalDisposition,
} from "./TaskWorkerTerminalCompletion.js";
import {
  type TaskExecutionSession,
  type TaskExecutionSessionAcceptance,
  TaskExecutionSessionError,
  type TaskExecutionSessionIdentity,
  type TaskExecutionSessionSettlement,
} from "./TaskExecutionSession.js";

const MAXIMUM_COMPLETION_REPLAYS = 10;

export interface TaskAttemptSupervisorPolicy {
  readonly minimumLeaseDurationMilliseconds: number;
  readonly heartbeatIntervalMilliseconds: number;
  readonly leaseSettlementReserveMilliseconds: number;
  readonly maximumLifecycleResolveMilliseconds: number;
  readonly maximumHeartbeatOperationMilliseconds: number;
  readonly maximumResultPublicationMilliseconds: number;
  readonly maximumCompletionOperationMilliseconds: number;
  readonly maximumSessionCloseMilliseconds: number;
  readonly maximumCompletionReplays: number;
  readonly completionReplayDelayMilliseconds: number;
}

interface CapturedTaskAttemptSupervisorPolicy
  extends TaskAttemptSupervisorPolicy {}

export class TaskAttemptSupervisorConfigurationError
  extends Data.TaggedError("TaskAttemptSupervisorConfigurationError")<{
    readonly reason: "invalid_policy";
  }> {}

export class TaskAttemptSupervisorContractError
  extends Data.TaggedError("TaskAttemptSupervisorContractError")<{
    readonly reason:
      | "session_identity_mismatch"
      | "session_settlement_mismatch"
      | "session_close_budget_mismatch"
      | "lifecycle_identity_mismatch"
      | "lifecycle_receipt_invalid"
      | "completion_encoding_invalid"
      | "lease_margin_invalid"
      | "heartbeat_sequence_exhausted";
  }> {}

export class TaskAttemptSupervisorOperationTimeoutError
  extends Data.TaggedError("TaskAttemptSupervisorOperationTimeoutError")<{
    readonly operation:
      | "resolve_lifecycle"
      | "heartbeat"
      | "publish_result"
      | "complete_attempt"
      | "close_session";
  }> {}

export interface TaskAttemptSupervisorLifecycleResolver {
  readonly resolve: (
    dispatch: CurrentTaskComputeDispatchRequestV1,
  ) => Effect.Effect<
    TaskAttemptLifecycleCapability,
    TaskAttemptLifecycleGatewayResolveError
  >;
}

export interface TaskAttemptSupervisorInput {
  readonly dispatch: CurrentTaskComputeDispatchRequestV1;
  readonly session: TaskExecutionSession;
}

export type TaskAttemptSupervisorOutcome =
  | Readonly<{
      readonly kind: "completed";
      readonly completionKind: TaskAttemptCompletionV1["kind"];
      readonly disposition: "accepted" | "idempotent";
      readonly lifecycleOutcome:
        | "terminal_succeeded"
        | "retry_scheduled"
        | "terminal_failed"
        | "terminal_cancelled";
    }>
  | Readonly<{
      readonly kind: "current";
      readonly stage: "heartbeat" | "completion";
      readonly reason:
        | HeartbeatAttemptCurrentReasonV1
        | CompleteAttemptCurrentReasonV1;
    }>
  | Readonly<{
      readonly kind: "unconfirmed";
      readonly reason: "host_shutdown";
    }>;

export type TaskAttemptSupervisorError =
  | TaskAttemptSupervisorContractError
  | TaskAttemptSupervisorOperationTimeoutError
  | TaskAttemptLifecycleGatewayResolveError
  | TaskAttemptLifecycleGatewayHeartbeatError
  | TaskAttemptLifecycleGatewayCompleteError
  | TaskResultStoreError
  | TaskExecutionSessionError;

export interface TaskAttemptSupervisor {
  readonly supervise: (
    input: TaskAttemptSupervisorInput,
  ) => Effect.Effect<TaskAttemptSupervisorOutcome, TaskAttemptSupervisorError>;
}

/**
 * Builds a lifecycle-free shared host capability. Each call owns one accepted
 * execution session; the injected resolver remains responsible for locating
 * the current scope without widening the provider-neutral dispatch contract.
 */
export function makeTaskAttemptSupervisor(
  suppliedResolver: TaskAttemptSupervisorLifecycleResolver,
  suppliedResultStore: TaskResultStore,
  suppliedPolicy: TaskAttemptSupervisorPolicy,
): Result.Result<
  TaskAttemptSupervisor,
  TaskAttemptSupervisorConfigurationError
> {
  return capturePolicy(suppliedPolicy).pipe(Result.map((policy) => {
    const resolverOwner = suppliedResolver;
    const resolveLifecycle = resolverOwner.resolve;
    const resultStoreOwner = suppliedResultStore;
    const publishResult = resultStoreOwner.publish;
    const supervise: TaskAttemptSupervisor["supervise"] = Effect.fn(
      "TaskAttemptSupervisor.supervise",
    )(input => Effect.uninterruptibleMask(restore => Effect.gen(function* () {
      const program = superviseAcceptedSession(
        input,
        dispatch => resolveLifecycle.call(resolverOwner, dispatch),
        value => publishResult.call(resultStoreOwner, value),
        policy,
      );
      const programExit = yield* Effect.exit(restore(program));
      const closeExit = yield* Effect.exit(withOperationDeadline(
        input.session.close,
        "close_session",
        policy.maximumSessionCloseMilliseconds,
      ));
      return yield* mergeProgramAndCloseExits(programExit, closeExit);
    })));
    return Object.freeze({ supervise });
  }));
}

type ResolveLifecycle = (
  dispatch: CurrentTaskComputeDispatchRequestV1,
) => Effect.Effect<
  TaskAttemptLifecycleCapability,
  TaskAttemptLifecycleGatewayResolveError
>;

type PublishResult = TaskResultStore["publish"];

const superviseAcceptedSession = Effect.fn(
  "TaskAttemptSupervisor.superviseAcceptedSession",
)(function* (
  input: TaskAttemptSupervisorInput,
  resolveLifecycle: ResolveLifecycle,
  publishResult: PublishResult,
  policy: CapturedTaskAttemptSupervisorPolicy,
): Effect.fn.Return<TaskAttemptSupervisorOutcome, TaskAttemptSupervisorError> {
  yield* validateSessionIdentity(input, policy);
  const lifecycle = yield* withOperationDeadline(
    resolveLifecycle(input.dispatch),
    "resolve_lifecycle",
    policy.maximumLifecycleResolveMilliseconds,
  );
  yield* validateLifecycleIdentity(input.dispatch, lifecycle);
  const observed = yield* Effect.raceFirst(
    observeTerminal(input.session),
    heartbeatLoop(lifecycle, policy),
  );
  return observed.kind === "terminal_observed"
    ? yield* settleTerminal(
        observed.disposition,
        lifecycle,
        publishResult,
        policy,
      )
    : observed;
});

type TaskExecutionTerminalDisposition = ReturnType<
  typeof mapTaskExecutionTerminalDisposition
>;

const observeTerminal = Effect.fn("TaskAttemptSupervisor.observeTerminal")(
  function* (session: TaskExecutionSession) {
    const settlement = yield* session.settlement;
    yield* validateSessionSettlement(session.acceptance, settlement);
    return Object.freeze({
      kind: "terminal_observed" as const,
      disposition: mapTaskExecutionTerminalDisposition(
        settlement,
      ),
    });
  },
);

const settleTerminal = Effect.fn("TaskAttemptSupervisor.settleTerminal")(
  function* (
    disposition: TaskExecutionTerminalDisposition,
    lifecycle: TaskAttemptLifecycleCapability,
    publishResult: PublishResult,
    policy: CapturedTaskAttemptSupervisorPolicy,
  ): Effect.fn.Return<TaskAttemptSupervisorOutcome, TaskAttemptSupervisorError> {
    if (disposition.kind === "unconfirmed") {
      return disposition;
    }
    const completion: TaskAttemptCompletionV1 =
      disposition.kind === "publish_result"
        ? Object.freeze({
            kind: "succeeded" as const,
            result: yield* withOperationDeadline(
              publishResult(disposition.result.value),
              "publish_result",
              policy.maximumResultPublicationMilliseconds,
            ),
            executionDurationMs: null,
          })
        : disposition.completion;
    const encodedCompletion = yield* Effect.fromResult(
      encodeTaskAttemptCompletionV1(completion).pipe(
        Result.mapError(() => new TaskAttemptSupervisorContractError({
          reason: "completion_encoding_invalid",
        })),
      ),
    );
    const receipt = yield* completeWithReplay(
      lifecycle,
      encodedCompletion,
      policy,
      0,
    );
    if (receipt.outcome.kind === "current") {
      return Object.freeze({
        kind: "current" as const,
        stage: "completion" as const,
        reason: receipt.outcome.reason,
      });
    }
    if (receipt.disposition === "current") {
      return yield* new TaskAttemptSupervisorContractError({
        reason: "lifecycle_receipt_invalid",
      });
    }
    return Object.freeze({
      kind: "completed" as const,
      completionKind: completion.kind,
      disposition: receipt.disposition,
      lifecycleOutcome: receipt.outcome.kind,
    });
  },
);

const heartbeatLoop = Effect.fn("TaskAttemptSupervisor.heartbeatLoop")(
  function* (
    lifecycle: TaskAttemptLifecycleCapability,
    policy: CapturedTaskAttemptSupervisorPolicy,
  ): Effect.fn.Return<TaskAttemptSupervisorOutcome, TaskAttemptSupervisorError> {
    let sequence = 1;
    while (true) {
      const receipt = yield* withOperationDeadline(
        submitHeartbeat(lifecycle, sequence),
        "heartbeat",
        policy.maximumHeartbeatOperationMilliseconds,
      );
      if (receipt.outcome.kind === "current") {
        return Object.freeze({
          kind: "current" as const,
          stage: "heartbeat" as const,
          reason: receipt.outcome.reason,
        });
      }
      const leaseWindow = receipt.outcome.lease.expiresAtMs -
        receipt.observedAtMs;
      if (leaseWindow < policy.minimumLeaseDurationMilliseconds) {
        return yield* new TaskAttemptSupervisorContractError({
          reason: "lease_margin_invalid",
        });
      }
      const availableDelay = leaseWindow -
        policy.leaseSettlementReserveMilliseconds;
      const delay = Math.min(
        policy.heartbeatIntervalMilliseconds,
        availableDelay,
      );
      if (!isPositiveSafeInteger(delay)) {
        return yield* new TaskAttemptSupervisorContractError({
          reason: "lease_margin_invalid",
        });
      }
      if (sequence === Number.MAX_SAFE_INTEGER) {
        return yield* new TaskAttemptSupervisorContractError({
          reason: "heartbeat_sequence_exhausted",
        });
      }
      sequence += 1;
      yield* Effect.sleep(delay);
    }
  },
);

type CompletionReceipt =
  | TaskSystemRunAttemptTransactionReceiptV1<CompleteAttemptOutcomeV1>
  | ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationCompleteAttemptOutcomeV1
    >;

type HeartbeatReceipt =
  | TaskSystemRunAttemptTransactionReceiptV1<HeartbeatAttemptOutcomeV1>
  | ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationHeartbeatAttemptOutcomeV1
    >;

function submitHeartbeat(
  lifecycle: TaskAttemptLifecycleCapability,
  sequence: number,
): Effect.Effect<
  HeartbeatReceipt,
  TaskAttemptLifecycleGatewayHeartbeatError
> {
  return lifecycle.generation === "legacy_dynamic_worker_v1"
    ? lifecycle.heartbeat(sequence)
    : lifecycle.heartbeat(sequence);
}

const completeWithReplay = Effect.fn("TaskAttemptSupervisor.completeWithReplay")(
  function* (
    lifecycle: TaskAttemptLifecycleCapability,
    completion: unknown,
    policy: CapturedTaskAttemptSupervisorPolicy,
    replayCount: number,
  ): Effect.fn.Return<
    CompletionReceipt,
    | TaskAttemptLifecycleGatewayCompleteError
    | TaskAttemptSupervisorOperationTimeoutError
  > {
    const operation = withOperationDeadline(
      submitCompletion(lifecycle, completion),
      "complete_attempt",
      policy.maximumCompletionOperationMilliseconds,
    );
    const replay = (
      failure:
        | TaskSystemRunAttemptTransientStoreError
        | TaskAttemptSupervisorOperationTimeoutError,
    ) => replayCount >= policy.maximumCompletionReplays
      ? Effect.fail(failure)
      : Effect.sleep(policy.completionReplayDelayMilliseconds).pipe(
        Effect.andThen(completeWithReplay(
          lifecycle,
          completion,
          policy,
          replayCount + 1,
        )),
      );
    return yield* operation.pipe(
      Effect.catchTags({
        TaskSystemRunAttemptTransientStoreError: replay,
        TaskAttemptSupervisorOperationTimeoutError: replay,
      }),
    );
  },
);

function submitCompletion(
  lifecycle: TaskAttemptLifecycleCapability,
  completion: unknown,
): Effect.Effect<
  CompletionReceipt,
  TaskAttemptLifecycleGatewayCompleteError
> {
  return lifecycle.generation === "legacy_dynamic_worker_v1"
    ? lifecycle.complete(completion)
    : lifecycle.complete(completion);
}

function validateSessionIdentity(
  input: TaskAttemptSupervisorInput,
  policy: CapturedTaskAttemptSupervisorPolicy,
): Effect.Effect<void, TaskAttemptSupervisorContractError> {
  const dispatch = input.dispatch;
  const acceptance = input.session.acceptance;
  const maximumCloseMilliseconds = input.session.maximumCloseMilliseconds;
  const expectedGeneration = "taskDefinitionRevisionId" in dispatch
    ? "legacy_dynamic_worker_v1"
    : "application_v1";
  if (!isPositiveSafeInteger(maximumCloseMilliseconds) ||
    maximumCloseMilliseconds > policy.maximumSessionCloseMilliseconds) {
    return Effect.fail(new TaskAttemptSupervisorContractError({
      reason: "session_close_budget_mismatch",
    }));
  }
  return acceptance.generation === expectedGeneration &&
      acceptance.cancellationGeneration === dispatch.cancellation.generation &&
      taskExecutionSessionIdentitiesEqual(
        acceptance.identity,
        dispatch.identity,
      )
    ? Effect.void
    : Effect.fail(new TaskAttemptSupervisorContractError({
        reason: "session_identity_mismatch",
      }));
}

function validateSessionSettlement(
  acceptance: TaskExecutionSessionAcceptance,
  settlement: TaskExecutionSessionSettlement,
): Effect.Effect<void, TaskAttemptSupervisorContractError> {
  return settlement.generation === acceptance.generation &&
      settlement.executionId === acceptance.executionId &&
      taskExecutionSessionIdentitiesEqual(
        settlement.identity,
        acceptance.identity,
      )
    ? Effect.void
    : Effect.fail(new TaskAttemptSupervisorContractError({
        reason: "session_settlement_mismatch",
      }));
}

function taskExecutionSessionIdentitiesEqual(
  left: TaskExecutionSessionIdentity,
  right: CurrentTaskComputeDispatchRequestV1["identity"],
): boolean {
  return left.version === right.version &&
    left.scopeId === right.scopeId &&
    left.runId === right.runId &&
    left.requestedEffectSequence === right.requestedEffectSequence &&
    left.attemptId === right.attemptId &&
    left.executionFence === right.executionFence;
}

function validateLifecycleIdentity(
  dispatch: CurrentTaskComputeDispatchRequestV1,
  lifecycle: TaskAttemptLifecycleCapability,
): Effect.Effect<void, TaskAttemptSupervisorContractError> {
  const expectedGeneration = "taskDefinitionRevisionId" in dispatch
    ? "legacy_dynamic_worker_v1"
    : "application_v1";
  return lifecycle.generation === expectedGeneration &&
      lifecycle.scopeId === dispatch.identity.scopeId &&
      lifecycle.runId === dispatch.identity.runId &&
      lifecycle.requestedEffectSequence ===
        dispatch.identity.requestedEffectSequence &&
      lifecycle.attemptId === dispatch.identity.attemptId &&
      lifecycle.executionFence === dispatch.identity.executionFence &&
      lifecycle.leaseVersion === dispatch.leaseVersion
    ? Effect.void
    : Effect.fail(new TaskAttemptSupervisorContractError({
        reason: "lifecycle_identity_mismatch",
      }));
}

function mergeProgramAndCloseExits<Success, Failure>(
  program: Exit.Exit<Success, Failure>,
  close: Exit.Exit<
    void,
    TaskExecutionSessionError | TaskAttemptSupervisorOperationTimeoutError
  >,
): Effect.Effect<
  Success,
  | Failure
  | TaskExecutionSessionError
  | TaskAttemptSupervisorOperationTimeoutError
> {
  return Exit.match(program, {
    onSuccess: value => Exit.match(close, {
      onSuccess: () => Effect.succeed(value),
      onFailure: closeCause => Effect.failCause(closeCause),
    }),
    onFailure: programCause => Exit.match(close, {
      onSuccess: () => Effect.failCause(programCause),
      onFailure: closeCause => Effect.failCause(
        Cause.combine(programCause, closeCause),
      ),
    }),
  });
}

function capturePolicy(
  supplied: TaskAttemptSupervisorPolicy,
): Result.Result<
  CapturedTaskAttemptSupervisorPolicy,
  TaskAttemptSupervisorConfigurationError
> {
  const captured = Result.try({
    try: () => Object.freeze({
      minimumLeaseDurationMilliseconds:
        supplied.minimumLeaseDurationMilliseconds,
      heartbeatIntervalMilliseconds: supplied.heartbeatIntervalMilliseconds,
      leaseSettlementReserveMilliseconds:
        supplied.leaseSettlementReserveMilliseconds,
      maximumCompletionReplays: supplied.maximumCompletionReplays,
      completionReplayDelayMilliseconds:
        supplied.completionReplayDelayMilliseconds,
      maximumLifecycleResolveMilliseconds:
        supplied.maximumLifecycleResolveMilliseconds,
      maximumHeartbeatOperationMilliseconds:
        supplied.maximumHeartbeatOperationMilliseconds,
      maximumResultPublicationMilliseconds:
        supplied.maximumResultPublicationMilliseconds,
      maximumCompletionOperationMilliseconds:
        supplied.maximumCompletionOperationMilliseconds,
      maximumSessionCloseMilliseconds:
        supplied.maximumSessionCloseMilliseconds,
    }),
    catch: () => new TaskAttemptSupervisorConfigurationError({
      reason: "invalid_policy",
    }),
  });
  return captured.pipe(Result.flatMap((policy) =>
    isPositiveSafeInteger(policy.minimumLeaseDurationMilliseconds) &&
      isPositiveSafeInteger(policy.heartbeatIntervalMilliseconds) &&
      isPositiveSafeInteger(policy.leaseSettlementReserveMilliseconds) &&
      isPositiveSafeInteger(policy.maximumLifecycleResolveMilliseconds) &&
      isPositiveSafeInteger(policy.maximumHeartbeatOperationMilliseconds) &&
      isPositiveSafeInteger(policy.maximumResultPublicationMilliseconds) &&
      isPositiveSafeInteger(policy.maximumCompletionOperationMilliseconds) &&
      isPositiveSafeInteger(policy.maximumSessionCloseMilliseconds) &&
      isNonNegativeSafeInteger(policy.maximumCompletionReplays) &&
      policy.maximumCompletionReplays <= MAXIMUM_COMPLETION_REPLAYS &&
      isPositiveSafeInteger(policy.completionReplayDelayMilliseconds) &&
      policy.maximumLifecycleResolveMilliseconds +
          policy.maximumHeartbeatOperationMilliseconds +
          policy.leaseSettlementReserveMilliseconds <
        policy.minimumLeaseDurationMilliseconds &&
      policy.heartbeatIntervalMilliseconds +
          policy.maximumHeartbeatOperationMilliseconds * 2 +
          policy.leaseSettlementReserveMilliseconds <
        policy.minimumLeaseDurationMilliseconds &&
      completionSettlementBudget(policy) <
        policy.leaseSettlementReserveMilliseconds
      ? Result.succeed(policy)
      : Result.fail(new TaskAttemptSupervisorConfigurationError({
          reason: "invalid_policy",
        }))
  ));
}

function completionSettlementBudget(
  policy: CapturedTaskAttemptSupervisorPolicy,
): number {
  return policy.maximumResultPublicationMilliseconds +
    policy.maximumCompletionOperationMilliseconds *
      (policy.maximumCompletionReplays + 1) +
    policy.completionReplayDelayMilliseconds * policy.maximumCompletionReplays +
    policy.maximumSessionCloseMilliseconds;
}

function withOperationDeadline<Success, Failure, Requirements>(
  effect: Effect.Effect<Success, Failure, Requirements>,
  operation: TaskAttemptSupervisorOperationTimeoutError["operation"],
  maximumMilliseconds: number,
): Effect.Effect<
  Success,
  Failure | TaskAttemptSupervisorOperationTimeoutError,
  Requirements
> {
  return effect.pipe(Effect.timeoutOrElse({
    duration: `${maximumMilliseconds} millis`,
    orElse: () => Effect.fail(new TaskAttemptSupervisorOperationTimeoutError({
      operation,
    })),
  }));
}
