import {
  type ApplicationCompleteAttemptOutcomeV1,
  type ApplicationHeartbeatAttemptOutcomeV1,
  type ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type ApplicationTaskSystemRunAttemptTransactionV1,
  type ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  type CompleteAttemptOutcomeV1,
  type HeartbeatAttemptOutcomeV1,
  type RunAttemptDecisionErrorV1,
  type TaskAttemptCompletionV1,
  type TaskHeartbeatSequenceV1,
  type TaskSystemRunAttemptInspectionSnapshotV1,
  type TaskSystemRunAttemptStoreErrorV1,
  type TaskSystemRunAttemptStoreShape,
  type TaskSystemRunAttemptTransactionV1,
  type TaskSystemRunAttemptTransactionReceiptV1,
  decideApplicationCompleteAttemptV1,
  decideApplicationHeartbeatAttemptV1,
  decideCompleteAttemptV1,
  decideHeartbeatAttemptV1,
  decodeTaskAttemptCompletionV1,
  decodeTaskHeartbeatSequenceV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  type CurrentTaskComputeDispatchRequestV1,
  validateCurrentTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  copyBytes,
  isUint8ArrayWithByteLength,
  uint8ArrayByteLength,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";

import {
  captureTrustedScopeAuthorityResolutionPorts,
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  makeApplicationTaskSystemRunAttemptStoreV1,
  makeTaskSystemRunAttemptStoreV1,
  type LocatedTaskSystemRunAttemptTargetV1,
} from "./taskSystemRunAttemptStoreV1";

export type TaskAttemptLifecycleGatewayInputOperation =
  | "resolve"
  | "heartbeat"
  | "complete";

type TaskAttemptLifecycleGatewayInputReason<
  Operation extends TaskAttemptLifecycleGatewayInputOperation,
> = Operation extends "resolve"
  ? "invalid_deployment_id" | "invalid_dispatch" | "scope_mismatch"
  : Operation extends "heartbeat"
    ? "invalid_heartbeat_sequence"
    : "invalid_completion";

export class TaskAttemptLifecycleGatewayInputError<
  Operation extends TaskAttemptLifecycleGatewayInputOperation,
> extends Data.TaggedError("TaskAttemptLifecycleGatewayInputError")<{
  readonly operation: Operation;
  readonly reason: TaskAttemptLifecycleGatewayInputReason<Operation>;
  readonly cause: unknown | undefined;
}> {}

export type TaskAttemptLifecycleGatewayResolveError =
  | TaskAttemptLifecycleGatewayInputError<"resolve">
  | TrustedScopeAuthorityError;

export type TaskAttemptLifecycleGatewayHeartbeatError =
  | TaskAttemptLifecycleGatewayInputError<"heartbeat">
  | RunAttemptDecisionErrorV1
  | TaskSystemRunAttemptStoreErrorV1;

export type TaskAttemptLifecycleGatewayCompleteError =
  | TaskAttemptLifecycleGatewayInputError<"complete">
  | RunAttemptDecisionErrorV1
  | TaskSystemRunAttemptStoreErrorV1;

interface TaskAttemptLifecycleCapabilityIdentity {
  readonly deploymentId: string;
  readonly scopeId: CurrentTaskComputeDispatchRequestV1["identity"]["scopeId"];
  readonly runId: CurrentTaskComputeDispatchRequestV1["identity"]["runId"];
  readonly requestedEffectSequence:
    CurrentTaskComputeDispatchRequestV1["identity"]["requestedEffectSequence"];
  readonly attemptId:
    CurrentTaskComputeDispatchRequestV1["identity"]["attemptId"];
  readonly executionFence:
    CurrentTaskComputeDispatchRequestV1["identity"]["executionFence"];
  readonly leaseVersion: CurrentTaskComputeDispatchRequestV1["leaseVersion"];
}

export interface LegacyTaskAttemptLifecycleCapability
  extends TaskAttemptLifecycleCapabilityIdentity {
  readonly generation: "legacy_dynamic_worker_v1";
  readonly inspect: () => Effect.Effect<
    TaskSystemRunAttemptInspectionSnapshotV1,
    TaskSystemRunAttemptStoreErrorV1
  >;
  readonly heartbeat: (
    heartbeatSequence: unknown,
  ) => Effect.Effect<
    TaskSystemRunAttemptTransactionReceiptV1<HeartbeatAttemptOutcomeV1>,
    TaskAttemptLifecycleGatewayHeartbeatError
  >;
  readonly complete: (
    completion: unknown,
  ) => Effect.Effect<
    TaskSystemRunAttemptTransactionReceiptV1<CompleteAttemptOutcomeV1>,
    TaskAttemptLifecycleGatewayCompleteError
  >;
}

export interface ApplicationTaskAttemptLifecycleCapability
  extends TaskAttemptLifecycleCapabilityIdentity {
  readonly generation: "application_v1";
  readonly inspect: () => Effect.Effect<
    ApplicationTaskSystemRunAttemptInspectionSnapshotV1,
    TaskSystemRunAttemptStoreErrorV1
  >;
  readonly heartbeat: (
    heartbeatSequence: unknown,
  ) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationHeartbeatAttemptOutcomeV1
    >,
    TaskAttemptLifecycleGatewayHeartbeatError
  >;
  readonly complete: (
    completion: unknown,
  ) => Effect.Effect<
    ApplicationTaskSystemRunAttemptTransactionReceiptV1<
      ApplicationCompleteAttemptOutcomeV1
    >,
    TaskAttemptLifecycleGatewayCompleteError
  >;
}

export type TaskAttemptLifecycleCapability =
  | LegacyTaskAttemptLifecycleCapability
  | ApplicationTaskAttemptLifecycleCapability;

export interface TaskAttemptLifecycleGateway {
  readonly resolve: (
    deploymentId: unknown,
    dispatch: unknown,
  ) => Effect.Effect<
    TaskAttemptLifecycleCapability,
    TaskAttemptLifecycleGatewayResolveError
  >;
}

/**
 * Creates a lifecycle-free resolver over the trusted scope directory. The
 * returned per-attempt values are dynamic, scope-bound capabilities and are
 * deliberately not installed as process-global Context services.
 */
export function createTaskAttemptLifecycleGateway(
  suppliedAuthority: TrustedScopeAuthorityResolutionPorts<
    LocatedTaskSystemRunAttemptTargetV1
  >,
): TaskAttemptLifecycleGateway {
  const authority = captureTrustedScopeAuthorityResolutionPorts(
    suppliedAuthority,
  );
  const resolve: TaskAttemptLifecycleGateway["resolve"] = Effect.fn(
    "TaskAttemptLifecycleGateway.resolve",
  )(function* (suppliedDeploymentId, suppliedDispatch) {
    const deploymentId = yield* Effect.fromResult(
      captureDeploymentId(suppliedDeploymentId),
    );
    const dispatch = yield* Effect.fromResult(
      validateCurrentTaskComputeDispatchRequestV1(suppliedDispatch).pipe(
        Result.mapError((cause) => new TaskAttemptLifecycleGatewayInputError({
          operation: "resolve",
          reason: "invalid_dispatch",
          cause,
        })),
      ),
    );
    const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
      deploymentId,
      authority,
    );
    if (located.authority.scopeId !== dispatch.identity.scopeId) {
      return yield* Effect.fail(new TaskAttemptLifecycleGatewayInputError({
        operation: "resolve",
        reason: "scope_mismatch",
        cause: undefined,
      }));
    }
    return "taskDefinitionRevisionId" in dispatch
      ? makeLegacyCapability(
        deploymentId,
        dispatch,
        makeTaskSystemRunAttemptStoreV1(located),
      )
      : makeApplicationCapability(
        deploymentId,
        dispatch,
        makeApplicationTaskSystemRunAttemptStoreV1(located),
      );
  });
  return Object.freeze({ resolve });
}

function makeLegacyCapability(
  deploymentId: string,
  dispatch: CurrentTaskComputeDispatchRequestV1,
  store: TaskSystemRunAttemptStoreShape,
): LegacyTaskAttemptLifecycleCapability {
  const identity = captureCapabilityIdentity(deploymentId, dispatch);
  const storeOwner = store;
  const inspectRunAttempt = storeOwner.inspectRunAttempt;
  const transactRunAttempt = storeOwner.transactRunAttempt;
  const transact = <Outcome>(
    request: TaskSystemRunAttemptTransactionV1<Outcome>,
  ) => transactRunAttempt(request);
  return Object.freeze({
    generation: "legacy_dynamic_worker_v1",
    ...identity,
    inspect: Effect.fn("TaskAttemptLifecycleGateway.legacy.inspect")(() =>
      inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: identity.runId,
      })
    ),
    heartbeat: Effect.fn("TaskAttemptLifecycleGateway.legacy.heartbeat")(
      function* (suppliedHeartbeatSequence) {
        const heartbeatSequence = yield* captureHeartbeatSequence(
          suppliedHeartbeatSequence,
        );
        return yield* transact<HeartbeatAttemptOutcomeV1>({
          operation: "heartbeat_attempt",
          runId: identity.runId,
          decide: input => decideHeartbeatAttemptV1({
            type: "heartbeat_attempt",
            runId: identity.runId,
            attemptId: identity.attemptId,
            executionFence: identity.executionFence,
            heartbeatSequence,
          }, input),
        });
      },
    ),
    complete: Effect.fn("TaskAttemptLifecycleGateway.legacy.complete")(
      function* (suppliedCompletion) {
        const completion = yield* captureCompletion(suppliedCompletion);
        return yield* transact<CompleteAttemptOutcomeV1>({
          operation: "complete_attempt",
          runId: identity.runId,
          decide: input => decideCompleteAttemptV1({
            type: "complete_attempt",
            runId: identity.runId,
            attemptId: identity.attemptId,
            executionFence: identity.executionFence,
            completion,
          }, input),
        });
      },
    ),
  });
}

function makeApplicationCapability(
  deploymentId: string,
  dispatch: CurrentTaskComputeDispatchRequestV1,
  store: ApplicationTaskSystemRunAttemptStoreShape,
): ApplicationTaskAttemptLifecycleCapability {
  const identity = captureCapabilityIdentity(deploymentId, dispatch);
  const storeOwner = store;
  const inspectRunAttempt = storeOwner.inspectRunAttempt;
  const transactRunAttempt = storeOwner.transactRunAttempt;
  const transact = <Outcome>(
    request: ApplicationTaskSystemRunAttemptTransactionV1<Outcome>,
  ) => transactRunAttempt(request);
  return Object.freeze({
    generation: "application_v1",
    ...identity,
    inspect: Effect.fn("TaskAttemptLifecycleGateway.application.inspect")(() =>
      inspectRunAttempt({
        operation: "inspect_current_attempt",
        runId: identity.runId,
      })
    ),
    heartbeat: Effect.fn("TaskAttemptLifecycleGateway.application.heartbeat")(
      function* (suppliedHeartbeatSequence) {
        const heartbeatSequence = yield* captureHeartbeatSequence(
          suppliedHeartbeatSequence,
        );
        return yield* transact<ApplicationHeartbeatAttemptOutcomeV1>({
          operation: "heartbeat_attempt",
          runId: identity.runId,
          decide: input => decideApplicationHeartbeatAttemptV1({
            type: "heartbeat_attempt",
            runId: identity.runId,
            attemptId: identity.attemptId,
            executionFence: identity.executionFence,
            heartbeatSequence,
          }, input),
        });
      },
    ),
    complete: Effect.fn("TaskAttemptLifecycleGateway.application.complete")(
      function* (suppliedCompletion) {
        const completion = yield* captureCompletion(suppliedCompletion);
        return yield* transact<ApplicationCompleteAttemptOutcomeV1>({
          operation: "complete_attempt",
          runId: identity.runId,
          decide: input => decideApplicationCompleteAttemptV1({
            type: "complete_attempt",
            runId: identity.runId,
            attemptId: identity.attemptId,
            executionFence: identity.executionFence,
            completion,
          }, input),
        });
      },
    ),
  });
}

function captureCapabilityIdentity(
  deploymentId: string,
  dispatch: CurrentTaskComputeDispatchRequestV1,
): TaskAttemptLifecycleCapabilityIdentity {
  return Object.freeze({
    deploymentId,
    scopeId: dispatch.identity.scopeId,
    runId: dispatch.identity.runId,
    requestedEffectSequence: dispatch.identity.requestedEffectSequence,
    attemptId: dispatch.identity.attemptId,
    executionFence: dispatch.identity.executionFence,
    leaseVersion: dispatch.leaseVersion,
  });
}

function captureDeploymentId(
  supplied: unknown,
): Result.Result<string, TaskAttemptLifecycleGatewayInputError<"resolve">> {
  return isNonBlankString(supplied)
    ? Result.succeed(supplied)
    : Result.fail(new TaskAttemptLifecycleGatewayInputError({
      operation: "resolve",
      reason: "invalid_deployment_id",
      cause: undefined,
    }));
}

function captureHeartbeatSequence(
  supplied: unknown,
): Effect.Effect<
  TaskHeartbeatSequenceV1,
  TaskAttemptLifecycleGatewayInputError<"heartbeat">
> {
  return Effect.fromResult(decodeTaskHeartbeatSequenceV1(supplied).pipe(
    Result.mapError((cause) => new TaskAttemptLifecycleGatewayInputError({
      operation: "heartbeat",
      reason: "invalid_heartbeat_sequence",
      cause,
    })),
  ));
}

function captureCompletion(
  supplied: unknown,
): Effect.Effect<
  TaskAttemptCompletionV1,
  TaskAttemptLifecycleGatewayInputError<"complete">
> {
  return Effect.fromResult(captureCompletionPlainData(
    supplied,
    0,
    { remainingProperties: 16 },
  ).pipe(
    Result.flatMap(decodeTaskAttemptCompletionV1),
    Result.map(ownCompletion),
    Result.mapError((cause) => new TaskAttemptLifecycleGatewayInputError({
      operation: "complete",
      reason: "invalid_completion",
      cause,
    })),
  ));
}

interface CompletionCaptureBudget {
  remainingProperties: number;
}

function captureCompletionPlainData(
  value: unknown,
  depth: number,
  budget: CompletionCaptureBudget,
): Result.Result<unknown, unknown> {
  const byteLength = uint8ArrayByteLength(value);
  if (byteLength !== undefined) {
    if (byteLength !== 32) {
      return Result.fail("Expected a 32-byte completion digest");
    }
    if (!isUint8ArrayWithByteLength(value, 32)) {
      return Result.fail("Expected an intrinsic completion digest");
    }
    return Result.try({
      try: () => copyBytes(value),
      catch: (cause) => cause,
    });
  }
  if (
    value === null || typeof value === "string" ||
    typeof value === "number" || typeof value === "bigint" ||
    typeof value === "boolean" || typeof value === "undefined"
  ) {
    return Result.succeed(value);
  }
  if (typeof value !== "object") {
    return Result.fail("Expected completion plain data");
  }
  return Result.gen(function* () {
    const isArray = yield* Result.try({
      try: () => Array.isArray(value),
      catch: (cause) => cause,
    });
    if (isArray || depth >= 3) {
      return yield* Result.fail("Expected bounded completion records");
    }
    const keys = yield* Result.try({
      try: () => Reflect.ownKeys(value),
      catch: (cause) => cause,
    });
    if (keys.length > budget.remainingProperties) {
      return yield* Result.fail("Expected bounded completion properties");
    }
    budget.remainingProperties -= keys.length;
    const captured: Record<string, unknown> = {};
    for (const key of keys) {
      if (typeof key !== "string") {
        return yield* Result.fail("Expected string completion fields");
      }
      const descriptor = yield* Result.try({
        try: () => Object.getOwnPropertyDescriptor(value, key),
        catch: (cause) => cause,
      });
      if (
        descriptor === undefined || descriptor.enumerable !== true ||
        !("value" in descriptor)
      ) {
        return yield* Result.fail("Expected enumerable completion data fields");
      }
      const child = yield* captureCompletionPlainData(
        descriptor.value,
        depth + 1,
        budget,
      );
      Object.defineProperty(captured, key, {
        value: child,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return captured;
  });
}

function ownCompletion(
  completion: TaskAttemptCompletionV1,
): TaskAttemptCompletionV1 {
  return completion.kind === "succeeded" && completion.result !== null
    ? Object.freeze({
      ...completion,
      result: Object.freeze({
        ...completion.result,
        sha256: completion.result.sha256.slice(),
      }),
    })
    : Object.freeze({ ...completion });
}
