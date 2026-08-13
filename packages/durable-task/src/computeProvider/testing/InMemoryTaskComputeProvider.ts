import { Effect, Layer, Result } from "effect";

import {
  TaskComputeCancellationRejectedError,
  TaskComputeCancellationStaleError,
  TaskComputeCancellationTransportError,
  TaskComputeCancellationUncertainError,
  TaskComputeDispatchConflictError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  TaskComputeDispatchUncertainError,
  type InvalidTaskComputeProviderValueError,
} from "../Errors.js";
import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  type TaskComputeCancellationReceiptV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type CurrentTaskComputeDispatchRequestV1,
  type TaskComputeExecutionRefV1,
  type TaskComputeProviderDescriptorV1,
} from "../Model.js";
import {
  TaskComputeExecutionIdV1Schema,
  decodeTaskComputeProviderDescriptorV1,
  snapshotTaskComputeCancellationReceiptV1,
  snapshotTaskComputeDispatchAcceptanceV1,
  validateTaskComputeCancellationRequestV1,
  validateCurrentTaskComputeDispatchRequestV1,
} from "../Schema.js";
import {
  TaskComputeProvider,
  type TaskComputeProviderShape,
} from "../Services/TaskComputeProvider.js";
import { makeTaskComputeProviderV1 } from "../TaskComputeProviderContract.js";

export interface InMemoryTaskComputeProviderHooksV1 {
  readonly beforeDispatch?: (
    request: CurrentTaskComputeDispatchRequestV1,
  ) => Effect.Effect<
    void,
    TaskComputeDispatchRejectedError | TaskComputeDispatchTransportError
  >;
  readonly afterDispatchAccepted?: (
    acceptance: TaskComputeDispatchAcceptanceV1,
  ) => Effect.Effect<void, TaskComputeDispatchUncertainError>;
  readonly beforeCancellation?: (
    request: TaskComputeCancellationRequestV1,
  ) => Effect.Effect<
    void,
    TaskComputeCancellationRejectedError | TaskComputeCancellationTransportError
  >;
  readonly afterCancellationAccepted?: (
    receipt: TaskComputeCancellationReceiptV1,
  ) => Effect.Effect<void, TaskComputeCancellationUncertainError>;
}

export interface InMemoryTaskComputeProviderV1 extends TaskComputeProviderShape {
  readonly dispatchRequests: () => ReadonlyArray<CurrentTaskComputeDispatchRequestV1>;
  readonly acceptedDispatches: () => ReadonlyArray<TaskComputeDispatchAcceptanceV1>;
  readonly cancellationRequests: () => ReadonlyArray<TaskComputeCancellationRequestV1>;
  readonly acceptedCancellations: () => ReadonlyArray<TaskComputeCancellationReceiptV1>;
}

interface AcceptedDispatchStateV1 {
  readonly request: CurrentTaskComputeDispatchRequestV1;
  readonly acceptance: TaskComputeDispatchAcceptanceV1;
}

interface AcceptedCancellationStateV1 {
  readonly receipt: TaskComputeCancellationReceiptV1;
}

interface AcceptedMutation<Value> {
  readonly value: Value;
  readonly newlyAccepted: boolean;
}

export function makeInMemoryTaskComputeProviderV1(
  descriptor: TaskComputeProviderDescriptorV1,
  hooks: InMemoryTaskComputeProviderHooksV1 = {},
): Result.Result<
  InMemoryTaskComputeProviderV1,
  InvalidTaskComputeProviderValueError<"decode_provider_descriptor">
> {
  return decodeTaskComputeProviderDescriptorV1(descriptor).pipe(
    Result.map((capturedDescriptor) => {
      const hookOwner = hooks;
      const beforeDispatch = hooks.beforeDispatch;
      const afterDispatchAccepted = hooks.afterDispatchAccepted;
      const beforeCancellation = hooks.beforeCancellation;
      const afterCancellationAccepted = hooks.afterCancellationAccepted;
      const dispatches = new Map<string, AcceptedDispatchStateV1>();
      const cancellations = new Map<string, AcceptedCancellationStateV1>();
      const dispatchRequests: CurrentTaskComputeDispatchRequestV1[] = [];
      const cancellationRequests: TaskComputeCancellationRequestV1[] = [];
      let nextExecutionSequence = 1;

      const implementation: TaskComputeProviderShape = Object.freeze({
        dispatch: Effect.fn("InMemoryTaskComputeProvider.dispatch")(
          function* (suppliedRequest) {
            const request = yield* Effect.fromResult(
              validateCurrentTaskComputeDispatchRequestV1(suppliedRequest),
            );
            yield* Effect.sync(() => {
              dispatchRequests.push(request);
            });
            if (beforeDispatch !== undefined) {
              yield* beforeDispatch.call(hookOwner, request);
            }
            const accepted = yield* Effect.sync(() => acceptDispatch(
                request,
                capturedDescriptor,
                dispatches,
                () => nextExecutionSequence++,
              )).pipe(Effect.flatMap(Effect.fromResult));
            if (accepted.newlyAccepted && afterDispatchAccepted !== undefined) {
              yield* afterDispatchAccepted.call(hookOwner, accepted.value);
            }
            return accepted.value;
          },
        ),
        requestCancellation: Effect.fn(
          "InMemoryTaskComputeProvider.requestCancellation",
        )(function* (suppliedRequest) {
          const request = yield* Effect.fromResult(
            validateTaskComputeCancellationRequestV1(suppliedRequest),
          );
          yield* Effect.sync(() => {
            cancellationRequests.push(request);
          });
          if (beforeCancellation !== undefined) {
            yield* beforeCancellation.call(hookOwner, request);
          }
          const accepted = yield* Effect.sync(() => acceptCancellation(
              request,
              dispatches,
              cancellations,
            )).pipe(Effect.flatMap(Effect.fromResult));
          if (
            accepted.newlyAccepted &&
            afterCancellationAccepted !== undefined
          ) {
            yield* afterCancellationAccepted.call(hookOwner, accepted.value);
          }
          return accepted.value;
        }),
      });
      const provider = makeTaskComputeProviderV1(implementation);
      return Object.freeze({
        ...provider,
        dispatchRequests: () => Object.freeze([...dispatchRequests]),
        acceptedDispatches: () => Object.freeze(
          [...dispatches.values()].map((state) => state.acceptance),
        ),
        cancellationRequests: () => Object.freeze([...cancellationRequests]),
        acceptedCancellations: () => Object.freeze(
          [...cancellations.values()].map((state) => state.receipt),
        ),
      });
    }),
  );
}

export function makeInMemoryTaskComputeProviderLayerV1(
  descriptor: TaskComputeProviderDescriptorV1,
  hooks: InMemoryTaskComputeProviderHooksV1 = {},
): Layer.Layer<
  TaskComputeProvider,
  InvalidTaskComputeProviderValueError<"decode_provider_descriptor">
> {
  return Layer.effect(
    TaskComputeProvider,
    Effect.suspend(() => Effect.fromResult(
      makeInMemoryTaskComputeProviderV1(descriptor, hooks),
    )),
  );
}

function acceptDispatch(
  request: CurrentTaskComputeDispatchRequestV1,
  descriptor: TaskComputeProviderDescriptorV1,
  dispatches: Map<string, AcceptedDispatchStateV1>,
  allocateSequence: () => number,
): Result.Result<
  AcceptedMutation<TaskComputeDispatchAcceptanceV1>,
  TaskComputeDispatchConflictError
> {
  const key = dispatchIdentityKey(request);
  const existing = dispatches.get(key);
  if (existing !== undefined) {
    return dispatchRequestsEqual(existing.request, request)
      ? Result.succeed(Object.freeze({
        value: existing.acceptance,
        newlyAccepted: false,
      }))
      : Result.fail(new TaskComputeDispatchConflictError({
        identity: request.identity,
        reason: "dispatch_request_mismatch",
      }));
  }
  const sequence = allocateSequence().toString().padStart(12, "0");
  const execution: TaskComputeExecutionRefV1 = Object.freeze({
    ...descriptor,
    executionId: TaskComputeExecutionIdV1Schema.make(`memory-execution-${sequence}`),
  });
  const acceptance = snapshotTaskComputeDispatchAcceptanceV1({
    version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
    kind: "accepted",
    identity: request.identity,
    execution,
  });
  dispatches.set(key, Object.freeze({ request, acceptance }));
  return Result.succeed(Object.freeze({ value: acceptance, newlyAccepted: true }));
}

function acceptCancellation(
  request: TaskComputeCancellationRequestV1,
  dispatches: ReadonlyMap<string, AcceptedDispatchStateV1>,
  cancellations: Map<string, AcceptedCancellationStateV1>,
): Result.Result<
  AcceptedMutation<TaskComputeCancellationReceiptV1>,
  TaskComputeCancellationStaleError | TaskComputeCancellationRejectedError
> {
  const dispatch = dispatches.get(dispatchIdentityKey(request));
  if (dispatch === undefined) {
    return Result.fail(new TaskComputeCancellationRejectedError({
      operation: "request_cancellation",
      reason: "execution_not_found",
      retryable: false,
    }));
  }
  if (!executionRefsEqual(dispatch.acceptance.execution, request.execution)) {
    return Result.fail(new TaskComputeCancellationRejectedError({
      operation: "request_cancellation",
      reason: "execution_mismatch",
      retryable: false,
    }));
  }
  const key = dispatchIdentityKey(request);
  const existing = cancellations.get(key);
  const acceptedGeneration = existing?.receipt.cancellationGeneration ??
    dispatch.request.cancellation.generation;
  if (request.cancellationGeneration < acceptedGeneration) {
    return Result.fail(new TaskComputeCancellationStaleError({
      identity: request.identity,
      receivedGeneration: request.cancellationGeneration,
      acceptedGeneration,
    }));
  }
  if (existing !== undefined) {
    if (request.cancellationGeneration === existing.receipt.cancellationGeneration) {
      return Result.succeed(Object.freeze({
        value: existing.receipt,
        newlyAccepted: false,
      }));
    }
  }
  const receipt = snapshotTaskComputeCancellationReceiptV1({
    version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
    kind: "interruption_requested",
    identity: request.identity,
    execution: request.execution,
    cancellationGeneration: request.cancellationGeneration,
  });
  cancellations.set(key, Object.freeze({ receipt }));
  return Result.succeed(Object.freeze({ value: receipt, newlyAccepted: true }));
}

function dispatchIdentityKey(
  value: Pick<CurrentTaskComputeDispatchRequestV1 | TaskComputeCancellationRequestV1, "identity">,
): string {
  const identity = value.identity;
  return [
    identity.scopeId,
    identity.runId,
    identity.requestedEffectSequence.toString(),
    identity.attemptId,
    identity.executionFence.toString(),
  ].map((part) => `${part.length}:${part}`).join("|");
}

function dispatchRequestsEqual(
  left: CurrentTaskComputeDispatchRequestV1,
  right: CurrentTaskComputeDispatchRequestV1,
): boolean {
  return left.version === right.version &&
    dispatchIdentityKey(left) === dispatchIdentityKey(right) &&
    ((left.taskDefinitionRevisionId !== undefined &&
      right.taskDefinitionRevisionId !== undefined &&
      left.taskDefinitionRevisionId === right.taskDefinitionRevisionId) ||
      (left.applicationTaskRuntimeTargetSha256 !== undefined &&
        right.applicationTaskRuntimeTargetSha256 !== undefined &&
        left.applicationTaskRuntimeTargetSha256.every(
          (byte, index) =>
            byte === right.applicationTaskRuntimeTargetSha256[index],
        ))) &&
    left.attemptNumber === right.attemptNumber &&
    left.leaseVersion === right.leaseVersion &&
    left.computeProfile === right.computeProfile &&
    left.cancellation.kind === right.cancellation.kind &&
    left.cancellation.generation === right.cancellation.generation &&
    left.maximumDurationMs === right.maximumDurationMs;
}

function executionRefsEqual(
  left: TaskComputeExecutionRefV1,
  right: TaskComputeExecutionRefV1,
): boolean {
  return left.provider === right.provider &&
    left.providerVersion === right.providerVersion &&
    left.executionId === right.executionId;
}
