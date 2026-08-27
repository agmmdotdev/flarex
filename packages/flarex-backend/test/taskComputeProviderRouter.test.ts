import {
  TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  TaskComputeCancellationContractError,
  TaskComputeCancellationRejectedError,
  TaskComputeDispatchContractError,
  TaskComputeDispatchRejectedError,
  TaskComputeExecutionIdV1Schema,
  TaskComputeProvider,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchRequestV1,
  decodeTaskComputeProviderDescriptorV1,
  type TaskComputeCancellationRequestV1,
  type TaskComputeDispatchAcceptanceV1,
  type TaskComputeProviderDescriptorV1,
  type TaskComputeProviderShape,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  TaskComputeProfileRefV1Schema,
  type TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Effect, Layer, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  TaskComputeProviderRouterConfigurationError,
  makeTaskComputeProviderRouter,
  makeTaskComputeProviderRouterLayer,
  type TaskComputeProviderRoute,
} from "../src/taskComputeDelivery/TaskComputeProviderRouter";

const PROVIDER_A = descriptor("provider-a", "2026-08-27");
const PROVIDER_B = descriptor("provider-b", "2026-08-27");
const SMALL = computeProfile("standard-small");
const MEDIUM = computeProfile("standard-medium");
const LARGE = computeProfile("standard-large");

describe("Task compute provider router", () => {
  it("dispatches by exact compute profile and allows one provider route to own several profiles", async () => {
    const calls: string[] = [];
    const providerA = provider(PROVIDER_A, "execution-a", calls);
    const providerB = provider(PROVIDER_B, "execution-b", calls);
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL, MEDIUM], providerA),
      route(PROVIDER_B, [LARGE], providerB),
    ]));

    const medium = await Effect.runPromise(router.dispatch(request(MEDIUM, 1)));
    const large = await Effect.runPromise(router.dispatch(request(LARGE, 2)));

    expect(calls).toEqual(["provider-a:dispatch", "provider-b:dispatch"]);
    expect(medium.execution).toMatchObject({
      provider: "provider-a",
      providerVersion: "2026-08-27",
      executionId: "execution-a",
    });
    expect(large.execution).toMatchObject({
      provider: "provider-b",
      providerVersion: "2026-08-27",
      executionId: "execution-b",
    });
  });

  it("routes cancellation by the accepted provider descriptor", async () => {
    const calls: string[] = [];
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL], provider(PROVIDER_A, "execution-a", calls)),
      route(PROVIDER_B, [LARGE], provider(PROVIDER_B, "execution-b", calls)),
    ]));
    const dispatchRequest = request(SMALL, 1);
    const cancellationRequest = cancellation(
      dispatchRequest,
      PROVIDER_B,
      "execution-b",
    );

    const receipt = await Effect.runPromise(
      router.requestCancellation(cancellationRequest),
    );

    expect(calls).toEqual(["provider-b:cancellation"]);
    expect(receipt.execution).toEqual(cancellationRequest.execution);
  });

  it("fails closed for unknown profiles and provider descriptors without invoking a provider", async () => {
    const calls: string[] = [];
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL], provider(PROVIDER_A, "execution-a", calls)),
    ]));

    const dispatchFailure = await Effect.runPromise(
      router.dispatch(request(LARGE, 1)).pipe(Effect.flip),
    );
    expect(dispatchFailure).toBeInstanceOf(TaskComputeDispatchRejectedError);
    expect(dispatchFailure).toMatchObject({
      reason: "unsupported_compute_profile",
      retryable: false,
      computeProfile: LARGE,
    });

    const cancellationFailure = await Effect.runPromise(
      router.requestCancellation(cancellation(
        request(SMALL, 1),
        PROVIDER_B,
        "execution-b",
      )).pipe(Effect.flip),
    );
    expect(cancellationFailure)
      .toBeInstanceOf(TaskComputeCancellationRejectedError);
    expect(cancellationFailure).toMatchObject({
      reason: "execution_not_found",
      retryable: false,
    });
    expect(calls).toEqual([]);
  });

  it("rejects an acceptance whose descriptor differs from its selected route", async () => {
    const calls: string[] = [];
    const router = success(makeTaskComputeProviderRouter([
      route(
        PROVIDER_A,
        [SMALL],
        provider(PROVIDER_B, "execution-b", calls, "provider-a"),
      ),
    ]));

    const failure = await Effect.runPromise(
      router.dispatch(request(SMALL, 1)).pipe(Effect.flip),
    );

    expect(calls).toEqual(["provider-a:dispatch"]);
    expect(failure).toBeInstanceOf(TaskComputeDispatchContractError);
    expect(failure).toMatchObject({
      reason: "receipt_correlation_mismatch",
      execution: {
        provider: "provider-b",
        providerVersion: "2026-08-27",
        executionId: "execution-b",
      },
    });
  });

  it("turns a malformed raw-provider acceptance into a contract error", async () => {
    const validProvider = provider(PROVIDER_A, "execution-a", []);
    const malformedProvider: TaskComputeProviderShape = {
      // @ts-expect-error Deliberately exercises validation of a foreign provider.
      dispatch: () => Effect.succeed(Object.freeze({ kind: "accepted" })),
      requestCancellation: validProvider.requestCancellation,
    };
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL], malformedProvider),
    ]));

    const failure = await Effect.runPromise(
      router.dispatch(request(SMALL, 1)).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(TaskComputeDispatchContractError);
    expect(failure).toMatchObject({
      reason: "malformed_receipt",
      execution: null,
    });
  });

  it("preserves provider method receivers", async () => {
    const calls: string[] = [];
    const providerWithReceiver = provider(
      PROVIDER_A,
      "execution-a",
      calls,
      "receiver-a",
    );
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL], providerWithReceiver),
    ]));
    const dispatchRequest = request(SMALL, 1);
    const acceptance = await Effect.runPromise(router.dispatch(dispatchRequest));
    await Effect.runPromise(router.requestCancellation(cancellation(
      dispatchRequest,
      PROVIDER_A,
      acceptance.execution.executionId,
    )));

    expect(calls).toEqual([
      "receiver-a:dispatch",
      "receiver-a:cancellation",
    ]);
  });

  it("validates cancellation receipts returned by a raw provider", async () => {
    const calls: string[] = [];
    const baseProvider = provider(PROVIDER_A, "execution-a", calls);
    const wrongIdentity = request(SMALL, 2).identity;
    const miscorrelatingProvider = Object.freeze({
      receiverName: baseProvider.receiverName,
      dispatch: baseProvider.dispatch,
      requestCancellation(requestValue: TaskComputeCancellationRequestV1) {
        calls.push("provider-a:cancellation");
        return Effect.succeed(Object.freeze({
          version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
          kind: "interruption_requested" as const,
          identity: wrongIdentity,
          execution: requestValue.execution,
          cancellationGeneration: requestValue.cancellationGeneration,
        }));
      },
    }) satisfies TaskComputeProviderShape & Readonly<{
      readonly receiverName: string;
    }>;
    const router = success(makeTaskComputeProviderRouter([
      route(PROVIDER_A, [SMALL], miscorrelatingProvider),
    ]));
    const dispatchRequest = request(SMALL, 1);

    const failure = await Effect.runPromise(
      router.requestCancellation(cancellation(
        dispatchRequest,
        PROVIDER_A,
        "execution-a",
      )).pipe(Effect.flip),
    );

    expect(calls).toEqual(["provider-a:cancellation"]);
    expect(failure).toBeInstanceOf(TaskComputeCancellationContractError);
    expect(failure).toMatchObject({
      reason: "receipt_correlation_mismatch",
    });
  });

  it("accepts structurally valid routes with additional metadata", async () => {
    const calls: string[] = [];
    const extendedRoute = Object.freeze({
      ...route(PROVIDER_A, [SMALL], provider(
        PROVIDER_A,
        "execution-a",
        calls,
      )),
      placement: "cloudflare-worker",
    });
    const router = success(makeTaskComputeProviderRouter([extendedRoute]));

    const acceptance = await Effect.runPromise(
      router.dispatch(request(SMALL, 1)),
    );

    expect(acceptance.execution.provider).toBe(PROVIDER_A.provider);
    expect(calls).toEqual(["provider-a:dispatch"]);
  });

  it.each([
    ["empty routes", [], "invalid_routes"],
    [
      "empty route profiles",
      [route(PROVIDER_A, [], inertProvider(PROVIDER_A))],
      "invalid_route",
    ],
    [
      "duplicate profiles within one route",
      [route(PROVIDER_A, [SMALL, SMALL], inertProvider(PROVIDER_A))],
      "duplicate_compute_profile",
    ],
    [
      "duplicate profiles across routes",
      [
        route(PROVIDER_A, [SMALL], inertProvider(PROVIDER_A)),
        route(PROVIDER_B, [SMALL], inertProvider(PROVIDER_B)),
      ],
      "duplicate_compute_profile",
    ],
    [
      "duplicate provider descriptors",
      [
        route(PROVIDER_A, [SMALL], inertProvider(PROVIDER_A)),
        route(PROVIDER_A, [LARGE], inertProvider(PROVIDER_A)),
      ],
      "duplicate_provider",
    ],
  ] as const)("rejects %s", (_name, routes, reason) => {
    const failure = Result.getOrThrow(Result.flip(
      makeTaskComputeProviderRouter(routes),
    ));
    expect(failure).toBeInstanceOf(
      TaskComputeProviderRouterConfigurationError,
    );
    expect(failure.reason).toBe(reason);
  });

  it("rejects invalid route values, provider members, and accessors", () => {
    const invalidDescriptor = {
      ...route(PROVIDER_A, [SMALL], inertProvider(PROVIDER_A)),
      descriptor: { provider: "", providerVersion: "2026-08-27" },
    };
    // @ts-expect-error Intentionally exercises runtime configuration decoding.
    expect(configurationFailure([invalidDescriptor]).reason)
      .toBe("invalid_route");

    const invalidProfile = {
      ...route(PROVIDER_A, [SMALL], inertProvider(PROVIDER_A)),
      computeProfiles: [""],
    };
    // @ts-expect-error Intentionally exercises runtime configuration decoding.
    expect(configurationFailure([invalidProfile]).reason)
      .toBe("invalid_route");

    const invalidProvider = {
      ...route(PROVIDER_A, [SMALL], inertProvider(PROVIDER_A)),
      provider: { dispatch: () => Effect.die("unused") },
    };
    // @ts-expect-error Intentionally exercises runtime configuration decoding.
    expect(configurationFailure([invalidProvider]).reason)
      .toBe("invalid_provider");

    let providerGetterReads = 0;
    const accessorProvider = Object.create(null);
    Object.defineProperties(accessorProvider, {
      dispatch: {
        enumerable: true,
        get: () => {
          providerGetterReads += 1;
          throw new Error("must not run");
        },
      },
      requestCancellation: {
        enumerable: true,
        value: () => Effect.die("unused"),
      },
    });
    const providerAccessorRoute = {
      descriptor: PROVIDER_A,
      computeProfiles: [SMALL],
      provider: accessorProvider,
    };
    expect(configurationFailure([providerAccessorRoute]).reason)
      .toBe("invalid_provider");
    expect(providerGetterReads).toBe(0);

    let routeGetterReads = 0;
    const accessorRoute = Object.create(null);
    Object.defineProperties(accessorRoute, {
      descriptor: {
        enumerable: true,
        get: () => {
          routeGetterReads += 1;
          throw new Error("must not run");
        },
      },
      computeProfiles: { enumerable: true, value: [SMALL] },
      provider: { enumerable: true, value: inertProvider(PROVIDER_A) },
    });
    expect(configurationFailure([accessorRoute]).reason)
      .toBe("invalid_route");
    expect(routeGetterReads).toBe(0);
  });

  it("provides the existing TaskComputeProvider service through a Layer", async () => {
    const calls: string[] = [];
    const layer = makeTaskComputeProviderRouterLayer([
      route(PROVIDER_A, [SMALL], provider(PROVIDER_A, "execution-a", calls)),
    ]);
    const acceptance = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* TaskComputeProvider;
      return yield* service.dispatch(request(SMALL, 1));
    }).pipe(Effect.provide(layer)));

    expect(acceptance.execution.provider).toBe(PROVIDER_A.provider);
    expect(calls).toEqual(["provider-a:dispatch"]);
  });
});

function provider(
  receiptDescriptor: TaskComputeProviderDescriptorV1,
  executionIdText: string,
  calls: string[],
  receiverName: string = receiptDescriptor.provider,
): TaskComputeProviderShape & Readonly<{ readonly receiverName: string }> {
  const executionId = success(
    Schema.decodeUnknownResult(TaskComputeExecutionIdV1Schema)(executionIdText),
  );
  return Object.freeze({
    receiverName,
    dispatch(
      this: Readonly<{ readonly receiverName: string }>,
      requestValue: Parameters<TaskComputeProviderShape["dispatch"]>[0],
    ) {
      calls.push(`${this.receiverName}:dispatch`);
      return Effect.succeed(Object.freeze({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted" as const,
        identity: requestValue.identity,
        execution: Object.freeze({ ...receiptDescriptor, executionId }),
      }) satisfies TaskComputeDispatchAcceptanceV1);
    },
    requestCancellation(
      this: Readonly<{ readonly receiverName: string }>,
      requestValue: TaskComputeCancellationRequestV1,
    ) {
      calls.push(`${this.receiverName}:cancellation`);
      return Effect.succeed(Object.freeze({
        version: TASK_COMPUTE_CANCELLATION_RECEIPT_VERSION_V1,
        kind: "interruption_requested" as const,
        identity: requestValue.identity,
        execution: requestValue.execution,
        cancellationGeneration: requestValue.cancellationGeneration,
      }));
    },
  }) satisfies TaskComputeProviderShape & Readonly<{
    readonly receiverName: string;
  }>;
}

function inertProvider(
  providerDescriptor: TaskComputeProviderDescriptorV1,
): TaskComputeProviderShape {
  return provider(providerDescriptor, "execution-inert", []);
}

function route(
  providerDescriptor: TaskComputeProviderDescriptorV1,
  computeProfiles: ReadonlyArray<TaskComputeProfileRefV1>,
  providerValue: TaskComputeProviderShape,
): TaskComputeProviderRoute {
  return Object.freeze({
    descriptor: providerDescriptor,
    computeProfiles: Object.freeze([...computeProfiles]),
    provider: providerValue,
  });
}

function request(computeProfileValue: TaskComputeProfileRefV1, sequence: number) {
  return success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_00000000-0000-4000-8000-000000000001",
      runId: `run_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      requestedEffectSequence: "7",
      attemptId:
        `attempt_00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
      executionFence: "11",
    },
    taskDefinitionRevisionId:
      "taskdef_00000000-0000-4000-8000-000000000001",
    attemptNumber: 1,
    leaseVersion: "13",
    computeProfile: computeProfileValue,
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 30_000,
  }));
}

function cancellation(
  dispatchRequest: ReturnType<typeof request>,
  providerDescriptor: TaskComputeProviderDescriptorV1,
  executionIdText: string,
): TaskComputeCancellationRequestV1 {
  return success(decodeTaskComputeCancellationRequestV1({
    version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
    identity: {
      ...dispatchRequest.identity,
      requestedEffectSequence:
        dispatchRequest.identity.requestedEffectSequence.toString(),
      executionFence: dispatchRequest.identity.executionFence.toString(),
    },
    execution: {
      ...providerDescriptor,
      executionId: executionIdText,
    },
    cancellationGeneration: "1",
  }));
}

function descriptor(
  provider: string,
  providerVersion: string,
): TaskComputeProviderDescriptorV1 {
  return success(decodeTaskComputeProviderDescriptorV1({
    provider,
    providerVersion,
  }));
}

function computeProfile(value: string): TaskComputeProfileRefV1 {
  return success(Schema.decodeUnknownResult(TaskComputeProfileRefV1Schema)(value));
}

function configurationFailure(
  routes: ReadonlyArray<TaskComputeProviderRoute>,
): TaskComputeProviderRouterConfigurationError {
  return Result.getOrThrow(Result.flip(makeTaskComputeProviderRouter(routes)));
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
