import { Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TaskComputeCancellationUncertainError,
  TaskComputeCancellationStaleError,
  TaskComputeDispatchConflictError,
  TaskComputeDispatchContractError,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchTransportError,
  TaskComputeDispatchUncertainError,
  TaskComputeProvider,
  TaskComputeExecutionIdV1Schema,
  decodeTaskComputeCancellationReceiptV1,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchAcceptanceV1,
  decodeTaskComputeDispatchRequestV1,
  decodeTaskComputeProviderDescriptorV1,
  encodeTaskComputeCancellationReceiptV1,
  encodeTaskComputeCancellationRequestV1,
  encodeTaskComputeDispatchAcceptanceV1,
  encodeTaskComputeDispatchRequestV1,
  makeTaskComputeProviderV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchRequestV1,
  type TaskComputeProviderShape,
} from "../src/computeProvider/v1.js";
import {
  makeInMemoryTaskComputeProviderLayerV1,
  makeInMemoryTaskComputeProviderV1,
} from "../src/computeProvider/testing-v1.js";

const PROVIDER = success(decodeTaskComputeProviderDescriptorV1({
  provider: "memory",
  providerVersion: "in-memory-v1",
}));

describe("TaskComputeProvider V1", () => {
  it("decodes, owns, freezes, and canonically re-encodes dispatch values", () => {
    const wire = dispatchWire();
    const request = success(decodeTaskComputeDispatchRequestV1(wire));

    expect(request).toMatchObject({
      version: "flarex.task-compute-dispatch-request.v1",
      identity: {
        requestedEffectSequence: 7n,
        executionFence: 11n,
      },
      leaseVersion: 13n,
      cancellation: { kind: "not_requested", generation: 0n },
      maximumDurationMs: 30_000,
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(Object.isFrozen(request.identity)).toBe(true);
    expect(Object.isFrozen(request.cancellation)).toBe(true);
    expect(request.identity).not.toBe(wire.identity);
    expect(request.cancellation).not.toBe(wire.cancellation);

    wire.identity.runId = "run_00000000-0000-4000-8000-000000000099";
    wire.cancellation.generation = "9";
    expect(request.identity.runId).toBe("run_00000000-0000-4000-8000-000000000001");
    expect(request.cancellation.generation).toBe(0n);

    const encoded = success(encodeTaskComputeDispatchRequestV1(request));
    expect(encoded).toEqual(dispatchWire());
    expect(success(decodeTaskComputeDispatchRequestV1(encoded))).toEqual(request);
  });

  it("rejects excess keys, accessors, symbols, invalid cancellation, and zero duration", () => {
    expect(failure(decodeTaskComputeDispatchRequestV1({
      ...dispatchWire(),
      extra: true,
    }))).toMatchObject({
      _tag: "InvalidTaskComputeProviderValueError",
      operation: "decode_dispatch_request",
    });

    let getterReads = 0;
    const accessorIdentity = dispatchWire().identity;
    Object.defineProperty(accessorIdentity, "runId", {
      enumerable: true,
      get() {
        getterReads += 1;
        return "run_00000000-0000-4000-8000-000000000001";
      },
    });
    expect(Result.isFailure(decodeTaskComputeDispatchRequestV1({
      ...dispatchWire(),
      identity: accessorIdentity,
    }))).toBe(true);
    expect(getterReads).toBe(0);

    const symbolValue = dispatchWire();
    Object.defineProperty(symbolValue, Symbol("authority"), {
      enumerable: true,
      value: "hidden",
    });
    expect(Result.isFailure(decodeTaskComputeDispatchRequestV1(symbolValue))).toBe(true);

    expect(Result.isFailure(decodeTaskComputeDispatchRequestV1({
      ...dispatchWire(),
      cancellation: { kind: "not_requested", generation: "1" },
    }))).toBe(true);
    expect(Result.isFailure(decodeTaskComputeDispatchRequestV1({
      ...dispatchWire(),
      maximumDurationMs: 0,
    }))).toBe(true);
  });

  it("attributes invalid runtime values to each encode boundary", async () => {
    const validRequest = request();
    const provider = makeProvider();
    const validAcceptance = await Effect.runPromise(provider.dispatch(validRequest));
    const validCancellationRequest = cancellationRequest(
      validAcceptance.execution,
      1n,
    );
    const validCancellationReceipt = await Effect.runPromise(
      provider.requestCancellation(validCancellationRequest),
    );

    const invalidRequest = {
      ...validRequest,
      unexpected: true,
    };
    const invalidAcceptance = {
      ...validAcceptance,
      unexpected: true,
    };
    const invalidCancellationRequest = {
      ...validCancellationRequest,
      unexpected: true,
    };
    const invalidCancellationReceipt = {
      ...validCancellationReceipt,
      unexpected: true,
    };
    expect(failure(encodeTaskComputeDispatchRequestV1(invalidRequest)))
      .toMatchObject({ operation: "encode_dispatch_request" });
    expect(failure(encodeTaskComputeDispatchAcceptanceV1(invalidAcceptance)))
      .toMatchObject({ operation: "encode_dispatch_acceptance" });
    expect(failure(encodeTaskComputeCancellationRequestV1(invalidCancellationRequest)))
      .toMatchObject({ operation: "encode_cancellation_request" });
    expect(failure(encodeTaskComputeCancellationReceiptV1(invalidCancellationReceipt)))
      .toMatchObject({ operation: "encode_cancellation_receipt" });
  });

  it("returns one stable acceptance for duplicate dispatch and separates identities", async () => {
    const provider = makeProvider();
    const firstRequest = request();
    const first = await Effect.runPromise(provider.dispatch(firstRequest));
    const replay = await Effect.runPromise(provider.dispatch(firstRequest));
    const second = await Effect.runPromise(provider.dispatch(request(2)));

    expect(replay).toEqual(first);
    expect(first.execution.executionId).toBe("memory-execution-000000000001");
    expect(second.execution.executionId).toBe("memory-execution-000000000002");
    expect(provider.dispatchRequests()).toHaveLength(3);
    expect(provider.acceptedDispatches()).toHaveLength(2);
    expect(Object.isFrozen(provider.acceptedDispatches())).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.execution)).toBe(true);

    const encoded = success(encodeTaskComputeDispatchAcceptanceV1(first));
    expect(success(decodeTaskComputeDispatchAcceptanceV1(encoded))).toEqual(first);
  });

  it("fails a same-identity semantic mismatch without allocating another execution", async () => {
    const provider = makeProvider();
    const original = request();
    await Effect.runPromise(provider.dispatch(original));

    const changedRequest = success(decodeTaskComputeDispatchRequestV1({
      ...dispatchWire(),
      maximumDurationMs: 45_000,
    }));
    const failureValue = await Effect.runPromise(provider.dispatch(
      changedRequest,
    ).pipe(Effect.flip));

    expect(failureValue).toBeInstanceOf(TaskComputeDispatchConflictError);
    expect(provider.acceptedDispatches()).toHaveLength(1);
  });

  it("preserves hook receivers and distinguishes definite and transport failures", async () => {
    const receiverHook = {
      calls: 0,
      beforeDispatch(this: { calls: number }) {
        this.calls += 1;
        return Effect.void;
      },
    };
    const receiverProvider = success(makeInMemoryTaskComputeProviderV1(
      PROVIDER,
      receiverHook,
    ));
    await Effect.runPromise(receiverProvider.dispatch(request()));
    expect(receiverHook.calls).toBe(1);

    const rejected = new TaskComputeDispatchRejectedError({
      operation: "dispatch",
      reason: "provider_disabled",
      retryable: false,
      computeProfile: request().computeProfile,
    });
    const rejectingProvider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch: () => Effect.fail(rejected),
    }));
    expect(await Effect.runPromise(
      rejectingProvider.dispatch(request()).pipe(Effect.flip),
    )).toBe(rejected);
    expect(rejectingProvider.dispatchRequests()).toHaveLength(1);
    expect(rejectingProvider.acceptedDispatches()).toHaveLength(0);

    const transport = new TaskComputeDispatchTransportError({
      operation: "dispatch",
      retryable: true,
      cause: new Error("connection reset"),
    });
    const transportProvider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch: () => Effect.fail(transport),
    }));
    expect(await Effect.runPromise(
      transportProvider.dispatch(request()).pipe(Effect.flip),
    )).toBe(transport);
    expect(transportProvider.dispatchRequests()).toHaveLength(1);
    expect(transportProvider.acceptedDispatches()).toHaveLength(0);
  });

  it("recovers the original acceptance after an accepted-but-unknown response", async () => {
    let afterCalls = 0;
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      afterDispatchAccepted: (acceptance) => {
        afterCalls += 1;
        return Effect.fail(new TaskComputeDispatchUncertainError({
          operation: "dispatch",
          identity: acceptance.identity,
          cause: new Error("response lost"),
        }));
      },
    }));

    const uncertain = await Effect.runPromise(
      provider.dispatch(request()).pipe(Effect.flip),
    );
    expect(uncertain).toBeInstanceOf(TaskComputeDispatchUncertainError);
    expect(provider.acceptedDispatches()).toHaveLength(1);

    const recovered = await Effect.runPromise(provider.dispatch(request()));
    expect(recovered).toEqual(provider.acceptedDispatches()[0]);
    expect(afterCalls).toBe(1);
    expect(provider.acceptedDispatches()).toHaveLength(1);
  });

  it("makes cancellation generation-correlated, idempotent, and not a Task acknowledgement", async () => {
    const provider = makeProvider();
    const acceptance = await Effect.runPromise(provider.dispatch(request()));
    const generationOne = cancellationRequest(acceptance.execution, 1n);
    const first = await Effect.runPromise(provider.requestCancellation(generationOne));
    const replay = await Effect.runPromise(provider.requestCancellation(generationOne));
    const generationTwo = await Effect.runPromise(provider.requestCancellation(
      cancellationRequest(acceptance.execution, 2n),
    ));

    expect(replay).toEqual(first);
    expect(generationTwo.cancellationGeneration).toBe(2n);
    expect(generationTwo.kind).toBe("interruption_requested");
    expect(generationTwo).not.toHaveProperty("cancellationAcknowledged");
    expect(provider.cancellationRequests()).toHaveLength(3);
    expect(provider.acceptedCancellations()).toEqual([generationTwo]);

    const stale = await Effect.runPromise(provider.requestCancellation(
      generationOne,
    ).pipe(Effect.flip));
    expect(stale).toBeInstanceOf(TaskComputeCancellationStaleError);

    const encodedRequest = success(encodeTaskComputeCancellationRequestV1(generationOne));
    expect(success(decodeTaskComputeCancellationRequestV1(encodedRequest))).toEqual(generationOne);
    const encodedReceipt = success(encodeTaskComputeCancellationReceiptV1(generationTwo));
    expect(success(decodeTaskComputeCancellationReceiptV1(encodedReceipt))).toEqual(generationTwo);
  });

  it("treats the dispatch cancellation projection as the initial generation watermark", async () => {
    const provider = makeProvider();
    const wire = dispatchWire();
    wire.cancellation = { kind: "requested", generation: "2" };
    const dispatchRequest = success(decodeTaskComputeDispatchRequestV1(wire));
    const acceptance = await Effect.runPromise(provider.dispatch(dispatchRequest));

    const stale = await Effect.runPromise(provider.requestCancellation(
      cancellationRequest(acceptance.execution, 1n),
    ).pipe(Effect.flip));
    expect(stale).toMatchObject({
      _tag: "TaskComputeCancellationStaleError",
      receivedGeneration: 1n,
      acceptedGeneration: 2n,
    });
    expect(provider.acceptedCancellations()).toHaveLength(0);

    const current = await Effect.runPromise(provider.requestCancellation(
      cancellationRequest(acceptance.execution, 2n),
    ));
    expect(current.cancellationGeneration).toBe(2n);
  });

  it("rejects missing or mismatched cancellation executions", async () => {
    const provider = makeProvider();
    const existing = await Effect.runPromise(provider.dispatch(request()));
    const missing = await Effect.runPromise(provider.requestCancellation({
      ...cancellationRequest(existing.execution, 1n),
      identity: request(2).identity,
    }).pipe(Effect.flip));
    expect(missing).toMatchObject({
      _tag: "TaskComputeCancellationRejectedError",
      reason: "execution_not_found",
    });

    const mismatch = await Effect.runPromise(provider.requestCancellation(
      cancellationRequest({
        ...existing.execution,
        executionId: TaskComputeExecutionIdV1Schema.make(
          "memory-execution-999999999999",
        ),
      }, 1n),
    ).pipe(Effect.flip));
    expect(mismatch).toMatchObject({
      _tag: "TaskComputeCancellationRejectedError",
      reason: "execution_mismatch",
    });
  });

  it("recovers cancellation after uncertainty without requesting interruption twice", async () => {
    let afterCalls = 0;
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      afterCancellationAccepted: (receipt) => {
        afterCalls += 1;
        return Effect.fail(new TaskComputeCancellationUncertainError({
          operation: "request_cancellation",
          identity: receipt.identity,
          cause: new Error("response lost"),
        }));
      },
    }));
    const acceptance = await Effect.runPromise(provider.dispatch(request()));
    const cancellation = cancellationRequest(acceptance.execution, 1n);

    expect(await Effect.runPromise(
      provider.requestCancellation(cancellation).pipe(Effect.flip),
    )).toBeInstanceOf(TaskComputeCancellationUncertainError);
    const recovered = await Effect.runPromise(provider.requestCancellation(cancellation));
    expect(recovered).toEqual(provider.acceptedCancellations()[0]);
    expect(afterCalls).toBe(1);
  });

  it("composes as an Effect service and interruption before acceptance leaves no dispatch", async () => {
    const layerResult = makeInMemoryTaskComputeProviderLayerV1(PROVIDER);
    const accepted = await Effect.runPromise(Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      return yield* provider.dispatch(request());
    }).pipe(Effect.provide(layerResult)));
    expect(accepted.kind).toBe("accepted");

    const blocked = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch: () => Effect.never,
    }));
    await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* blocked.dispatch(request()).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
    }));
    expect(blocked.dispatchRequests()).toHaveLength(1);
    expect(blocked.acceptedDispatches()).toHaveLength(0);

    const timed = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch: () => Effect.never,
    }));
    expect(await Effect.runPromise(timed.dispatch(request()).pipe(
      Effect.timeout("10 millis"),
      Effect.flip,
    ))).toMatchObject({ _tag: "TimeoutError" });
    expect(timed.dispatchRequests()).toHaveLength(1);
    expect(timed.acceptedDispatches()).toHaveLength(0);
  });

  it("builds isolated in-memory state for each use of one Layer value", async () => {
    const layer = makeInMemoryTaskComputeProviderLayerV1(PROVIDER);
    const dispatch = Effect.gen(function* () {
      const provider = yield* TaskComputeProvider;
      return yield* provider.dispatch(request());
    }).pipe(Effect.provide(layer));

    const first = await Effect.runPromise(dispatch);
    const second = await Effect.runPromise(dispatch);
    expect(first.execution.executionId).toBe("memory-execution-000000000001");
    expect(second.execution.executionId).toBe("memory-execution-000000000001");
  });

  it("captures provider methods once, preserves their receiver, and rejects bad receipts", async () => {
    const expectedRequest = request();
    const expectedAcceptance = await Effect.runPromise(
      makeProvider().dispatch(expectedRequest),
    );

    class ReceiverProvider implements TaskComputeProviderShape {
      dispatchReads = 0;
      dispatchCalls = 0;

      get dispatch(): TaskComputeProviderShape["dispatch"] {
        this.dispatchReads += 1;
        return function (this: ReceiverProvider) {
          this.dispatchCalls += 1;
          return Effect.succeed(expectedAcceptance);
        };
      }

      requestCancellation(): ReturnType<TaskComputeProviderShape["requestCancellation"]> {
        return Effect.never;
      }
    }

    const receiverImplementation = new ReceiverProvider();
    const receiverProvider = makeTaskComputeProviderV1(receiverImplementation);
    expect(receiverImplementation.dispatchReads).toBe(1);
    expect(await Effect.runPromise(receiverProvider.dispatch(expectedRequest)))
      .toEqual(expectedAcceptance);
    expect(receiverImplementation.dispatchReads).toBe(1);
    expect(receiverImplementation.dispatchCalls).toBe(1);

    const malformedAcceptance = Object.freeze({
      ...expectedAcceptance,
      unexpectedAuthority: true,
    });
    const malformedProvider = makeTaskComputeProviderV1({
      dispatch: () => Effect.succeed(malformedAcceptance),
      requestCancellation: () => Effect.never,
    });
    expect(await Effect.runPromise(
      malformedProvider.dispatch(expectedRequest).pipe(Effect.flip),
    )).toMatchObject({
      _tag: "TaskComputeDispatchContractError",
      reason: "malformed_receipt",
    });

    const mismatchedAcceptance = await Effect.runPromise(
      makeProvider().dispatch(request(2)),
    );
    const mismatchedProvider = makeTaskComputeProviderV1({
      dispatch: () => Effect.succeed(mismatchedAcceptance),
      requestCancellation: () => Effect.never,
    });
    const mismatch = await Effect.runPromise(
      mismatchedProvider.dispatch(expectedRequest).pipe(Effect.flip),
    );
    expect(mismatch).toBeInstanceOf(TaskComputeDispatchContractError);
    expect(mismatch).toMatchObject({ reason: "receipt_correlation_mismatch" });
  });
});

function dispatchWire(sequence = 1) {
  return {
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: `run_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      requestedEffectSequence: "7",
      attemptId: `attempt_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      executionFence: "11",
    },
    taskDefinitionRevisionId: "taskdef_00000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    leaseVersion: "13",
    computeProfile: "standard-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 30_000,
  };
}

function request(sequence = 1): TaskComputeDispatchRequestV1 {
  return success(decodeTaskComputeDispatchRequestV1(dispatchWire(sequence)));
}

function cancellationRequest(
  execution: TaskComputeCancellationRequestV1["execution"],
  generation: bigint,
): TaskComputeCancellationRequestV1 {
  const base = request();
  return success(decodeTaskComputeCancellationRequestV1({
    version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
    identity: {
      ...base.identity,
      requestedEffectSequence: base.identity.requestedEffectSequence.toString(),
      executionFence: base.identity.executionFence.toString(),
    },
    execution,
    cancellationGeneration: generation.toString(),
  }));
}

function makeProvider() {
  return success(makeInMemoryTaskComputeProviderV1(PROVIDER));
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}

function failure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  return Result.getOrThrow(Result.flip(result));
}
