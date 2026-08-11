import {
  TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
  TaskComputeDispatchRejectedError,
  TaskComputeDispatchUncertainError,
  TaskComputeProvider,
  decodeTaskComputeCancellationRequestV1,
  decodeTaskComputeDispatchRequestV1,
  decodeTaskComputeProviderDescriptorV1,
  type TaskComputeDispatchRequestV1,
  type TaskComputeProviderShape,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  makeInMemoryTaskComputeProviderV1,
} from "@flarex/durable-task/internal/compute-provider-testing-v1";
import {
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import type {
  TaskComputeDeliveryCandidate,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-discovery";
import {
  TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
  decodeTaskComputePreparedExecutionV1,
  type TaskComputePreparedExecutionV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-evidence-v1";
import type {
  TaskComputeCancellationClaimHandleV1,
  TaskComputeDeliveryRepositoryV1,
  TaskComputeDispatchClaimHandleV1,
} from "@flarex/persistence-postgres/internal/task-compute-delivery-repository-v1";
import {
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeTaskDefinitionRuntimeBindingCommitmentV1,
  decodeTaskRuntimeEntryFrameV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Deferred, Effect, Exit, Fiber, Layer, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  TaskComputeDeliveryCandidateRunner,
  TaskComputeDeliveryCandidateRunnerLive,
} from "../src/taskComputeDelivery/CandidateRunner";

const PROVIDER = success(decodeTaskComputeProviderDescriptorV1({
  provider: "memory",
  providerVersion: "memory-v1",
}));
const DISPATCH_HANDLE = Object.freeze({}) as TaskComputeDispatchClaimHandleV1;
const CANCELLATION_HANDLE = Object.freeze(
  {},
) as TaskComputeCancellationClaimHandleV1;

describe("DTE06-C3 single-candidate compute-delivery runner", () => {
  it("orders dispatch acquire, delivery start, provider, and exact settlement", async () => {
    const order: string[] = [];
    const request = dispatchRequest();
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch() {
        order.push("provider");
        return Effect.void;
      },
    }));
    const repository = makeRepository({
      acquireDispatch() {
        order.push("acquire");
        return Effect.succeed(Object.freeze({
          kind: "claimed" as const,
          prepared: preparedExecution(request),
          handle: DISPATCH_HANDLE,
          deliveryMode: "initial" as const,
          claimExpiresAt: new Date("2026-08-11T00:01:00.000Z"),
        }));
      },
      markDispatchDeliveryStarted() {
        order.push("mark_started");
        return Effect.succeed(Object.freeze({
          kind: "delivery_started" as const,
          deliveryAttemptCount: 1n,
          deliveryStartedAt: new Date("2026-08-11T00:00:00.000Z"),
        }));
      },
      recordDispatchAcceptance(_handle, acceptance) {
        order.push("record_acceptance");
        return Effect.succeed(Object.freeze({
          kind: "dispatch_accepted" as const,
          acceptance,
          disposition: "current" as const,
        }));
      },
    }, order);

    const outcome = await runDispatch(provider, repository, dispatchCandidate(
      request,
    ));

    expect(order).toEqual([
      "acquire",
      "mark_started",
      "provider",
      "record_acceptance",
    ]);
    expect(outcome).toMatchObject({
      kind: "dispatch_accepted",
      deliveryMode: "initial",
      deliveryAttemptCount: 1n,
      settlement: { kind: "dispatch_accepted", disposition: "current" },
    });
    expect(provider.dispatchRequests()).toHaveLength(1);
    expect(Object.isFrozen(outcome)).toBe(true);
  });

  it("does not call the provider for a busy acquisition", async () => {
    const request = dispatchRequest();
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER));
    const repository = makeRepository({
      acquireDispatch: () => Effect.succeed(Object.freeze({
        kind: "busy" as const,
        claimExpiresAt: new Date("2026-08-11T00:01:00.000Z"),
      })),
    });

    const outcome = await runDispatch(provider, repository, dispatchCandidate(
      request,
    ));

    expect(outcome).toMatchObject({
      kind: "dispatch_not_called",
      acquisition: { kind: "busy" },
    });
    expect(provider.dispatchRequests()).toEqual([]);
  });

  it("records provider rejection as the exact C2 known failure", async () => {
    const request = dispatchRequest();
    const rejection = new TaskComputeDispatchRejectedError({
      operation: "dispatch",
      reason: "capacity_unavailable",
      retryable: true,
      computeProfile: request.computeProfile,
    });
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      beforeDispatch: () => Effect.fail(rejection),
    }));
    let observedFailure: unknown;
    const repository = claimedDispatchRepository(request, {
      recordDispatchKnownFailure(_handle, failure) {
        observedFailure = failure;
        return Effect.succeed(Object.freeze({
          kind: "retry_scheduled" as const,
          reason: "provider_capacity_unavailable" as const,
          nextAttemptAt: new Date("2026-08-11T00:01:00.000Z"),
        }));
      },
    });

    const outcome = await runDispatch(provider, repository, dispatchCandidate(
      request,
    ));

    expect(observedFailure).toBe(rejection);
    expect(outcome).toMatchObject({
      kind: "dispatch_known_failure",
      settlement: {
        kind: "retry_scheduled",
        reason: "provider_capacity_unavailable",
      },
    });
  });

  it("leaves accepted-but-response-lost dispatch unsettled for replay", async () => {
    const request = dispatchRequest();
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER, {
      afterDispatchAccepted: (acceptance) => Effect.fail(
        new TaskComputeDispatchUncertainError({
          operation: "dispatch",
          identity: acceptance.identity,
          cause: "response_lost",
        }),
      ),
    }));
    let settlementCalls = 0;
    const repository = claimedDispatchRepository(request, {
      recordDispatchAcceptance: () => {
        settlementCalls += 1;
        return Effect.die("uncertain provider result must not settle");
      },
      recordDispatchKnownFailure: () => {
        settlementCalls += 1;
        return Effect.die("uncertain provider result must not settle");
      },
    });

    const failure = await runDispatchFailure(
      provider,
      repository,
      dispatchCandidate(request),
    );

    expect(failure).toBeInstanceOf(TaskComputeDispatchUncertainError);
    expect(settlementCalls).toBe(0);
    expect(provider.acceptedDispatches()).toHaveLength(1);
  });

  it("preserves interruption after delivery start without manufacturing settlement", async () => {
    const request = dispatchRequest();
    let settlementCalls = 0;
    const repository = claimedDispatchRepository(request, {
      recordDispatchAcceptance: () => {
        settlementCalls += 1;
        return Effect.die("interrupted provider must not settle acceptance");
      },
      recordDispatchKnownFailure: () => {
        settlementCalls += 1;
        return Effect.die("interrupted provider must not settle failure");
      },
    });

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const provider: TaskComputeProviderShape = Object.freeze({
        dispatch: () => Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
        ),
        requestCancellation: () => Effect.never,
      });
      const running = Effect.gen(function* () {
        const runner = yield* TaskComputeDeliveryCandidateRunner;
        return yield* runner.runDispatch(
          repository,
          dispatchCandidate(request),
        );
      }).pipe(Effect.provide(runnerLayer(provider)));
      const fiber = yield* running.pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(settlementCalls).toBe(0);
  });

  it("captures hostile candidate access as a typed input failure", async () => {
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER));
    const candidate = Object.defineProperty({}, "operation", {
      enumerable: true,
      get() {
        throw new Error("candidate getter must not defect");
      },
    }) as TaskComputeDeliveryCandidate<"dispatch">;
    const repository = makeRepository({});

    const failure = await runDispatchFailure(provider, repository, candidate);

    expect(failure).toMatchObject({
      _tag: "TaskComputeDeliveryCandidateRunnerInputError",
      operation: "dispatch",
      reason: "invalid_candidate",
    });
  });

  it("delivers cancellation only after dispatch acceptance and records receipt", async () => {
    const request = dispatchRequest();
    const provider = success(makeInMemoryTaskComputeProviderV1(PROVIDER));
    const acceptance = await Effect.runPromise(provider.dispatch(request));
    const cancellation = success(decodeTaskComputeCancellationRequestV1({
      version: TASK_COMPUTE_CANCELLATION_REQUEST_VERSION_V1,
      identity: {
        ...request.identity,
        requestedEffectSequence:
          request.identity.requestedEffectSequence.toString(),
        executionFence: request.identity.executionFence.toString(),
      },
      execution: acceptance.execution,
      cancellationGeneration: "1",
    }));
    const repository = makeRepository({
      acquireCancellation: () => Effect.succeed(Object.freeze({
        kind: "claimed" as const,
        request: cancellation,
        handle: CANCELLATION_HANDLE,
        deliveryMode: "initial" as const,
        claimExpiresAt: new Date("2026-08-11T00:01:00.000Z"),
      })),
      markCancellationDeliveryStarted: () => Effect.succeed(Object.freeze({
        kind: "delivery_started" as const,
        deliveryAttemptCount: 1n,
        deliveryStartedAt: new Date("2026-08-11T00:00:00.000Z"),
      })),
      recordCancellationReceipt: (_handle, receipt) => Effect.succeed(
        Object.freeze({
          kind: "cancellation_delivered" as const,
          receipt,
          disposition: "current" as const,
        }),
      ),
    });
    const candidate: TaskComputeDeliveryCandidate<"cancellation"> =
      Object.freeze({
        operation: "cancellation",
        eligibleAt: "2026-08-11T00:00:00.000Z",
        runId: request.identity.runId,
        requestedEffectSequence: request.identity.requestedEffectSequence,
      });

    const outcome = await runCancellation(provider, repository, candidate);

    expect(outcome).toMatchObject({
      kind: "cancellation_delivered",
      settlement: { kind: "cancellation_delivered" },
    });
    expect(provider.acceptedCancellations()).toHaveLength(1);
  });
});

function runDispatch(
  provider: TaskComputeProviderShape,
  repository: TaskComputeDeliveryRepositoryV1,
  candidate: TaskComputeDeliveryCandidate<"dispatch">,
) {
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryCandidateRunner;
    return yield* runner.runDispatch(repository, candidate);
  }).pipe(Effect.provide(runnerLayer(provider))));
}

function runDispatchFailure(
  provider: TaskComputeProviderShape,
  repository: TaskComputeDeliveryRepositoryV1,
  candidate: TaskComputeDeliveryCandidate<"dispatch">,
) {
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryCandidateRunner;
    return yield* runner.runDispatch(repository, candidate).pipe(Effect.flip);
  }).pipe(Effect.provide(runnerLayer(provider))));
}

function runCancellation(
  provider: TaskComputeProviderShape,
  repository: TaskComputeDeliveryRepositoryV1,
  candidate: TaskComputeDeliveryCandidate<"cancellation">,
) {
  return Effect.runPromise(Effect.gen(function* () {
    const runner = yield* TaskComputeDeliveryCandidateRunner;
    return yield* runner.runCancellation(repository, candidate);
  }).pipe(Effect.provide(runnerLayer(provider))));
}

function runnerLayer(provider: TaskComputeProviderShape) {
  return TaskComputeDeliveryCandidateRunnerLive.pipe(
    Layer.provide(Layer.succeed(TaskComputeProvider, provider)),
  );
}

function claimedDispatchRepository(
  request: TaskComputeDispatchRequestV1,
  overrides: Partial<TaskComputeDeliveryRepositoryV1> = {},
) {
  return makeRepository({
    acquireDispatch: () => Effect.succeed(Object.freeze({
      kind: "claimed" as const,
      prepared: preparedExecution(request),
      handle: DISPATCH_HANDLE,
      deliveryMode: "initial" as const,
      claimExpiresAt: new Date("2026-08-11T00:01:00.000Z"),
    })),
    markDispatchDeliveryStarted: () => Effect.succeed(Object.freeze({
      kind: "delivery_started" as const,
      deliveryAttemptCount: 1n,
      deliveryStartedAt: new Date("2026-08-11T00:00:00.000Z"),
    })),
    ...overrides,
  });
}

function makeRepository(
  overrides: Partial<TaskComputeDeliveryRepositoryV1>,
  _receiverOrder?: string[],
): TaskComputeDeliveryRepositoryV1 {
  let repository: TaskComputeDeliveryRepositoryV1;
  const unexpected = (operation: string) =>
    Effect.die(`unexpected repository operation: ${operation}`);
  const methods: TaskComputeDeliveryRepositoryV1 = {
    acquireDispatch(this: unknown, request) {
      if (this !== repository) return Effect.die("acquire receiver lost");
      return overrides.acquireDispatch?.call(repository, request) ??
        unexpected("acquireDispatch");
    },
    markDispatchDeliveryStarted(this: unknown, handle) {
      if (this !== repository) return Effect.die("mark receiver lost");
      return overrides.markDispatchDeliveryStarted?.call(repository, handle) ??
        unexpected("markDispatchDeliveryStarted");
    },
    renewDispatchClaim: (handle) =>
      overrides.renewDispatchClaim?.call(repository, handle) ??
      unexpected("renewDispatchClaim"),
    releaseDispatchBeforeDelivery: (handle) =>
      overrides.releaseDispatchBeforeDelivery?.call(repository, handle) ??
      unexpected("releaseDispatchBeforeDelivery"),
    recordDispatchAcceptance(this: unknown, handle, acceptance) {
      if (this !== repository) return Effect.die("settlement receiver lost");
      return overrides.recordDispatchAcceptance?.call(
        repository,
        handle,
        acceptance,
      ) ?? unexpected("recordDispatchAcceptance");
    },
    recordDispatchKnownFailure(this: unknown, handle, failure) {
      if (this !== repository) return Effect.die("failure receiver lost");
      return overrides.recordDispatchKnownFailure?.call(
        repository,
        handle,
        failure,
      ) ?? unexpected("recordDispatchKnownFailure");
    },
    acquireCancellation: (request) =>
      overrides.acquireCancellation?.call(repository, request) ??
      unexpected("acquireCancellation"),
    markCancellationDeliveryStarted: (handle) =>
      overrides.markCancellationDeliveryStarted?.call(repository, handle) ??
      unexpected("markCancellationDeliveryStarted"),
    renewCancellationClaim: (handle) =>
      overrides.renewCancellationClaim?.call(repository, handle) ??
      unexpected("renewCancellationClaim"),
    releaseCancellationBeforeDelivery: (handle) =>
      overrides.releaseCancellationBeforeDelivery?.call(repository, handle) ??
      unexpected("releaseCancellationBeforeDelivery"),
    recordCancellationReceipt: (handle, receipt) =>
      overrides.recordCancellationReceipt?.call(repository, handle, receipt) ??
      unexpected("recordCancellationReceipt"),
    recordCancellationKnownFailure: (handle, failure) =>
      overrides.recordCancellationKnownFailure?.call(
        repository,
        handle,
        failure,
      ) ?? unexpected("recordCancellationKnownFailure"),
  };
  repository = Object.freeze(methods);
  return repository;
}

function dispatchRequest(): TaskComputeDispatchRequestV1 {
  return success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_94000000-0000-4000-8000-000000000001",
      runId: "run_94000000-0000-4000-8000-000000000002",
      requestedEffectSequence: "7",
      attemptId: "attempt_94000000-0000-4000-8000-000000000003",
      executionFence: "11",
    },
    taskDefinitionRevisionId:
      "taskdef_94000000-0000-4000-8000-000000000004",
    attemptNumber: 1,
    leaseVersion: "13",
    computeProfile: "standard-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 30_000,
  }));
}

function dispatchCandidate(
  request: TaskComputeDispatchRequestV1,
): TaskComputeDeliveryCandidate<"dispatch"> {
  return Object.freeze({
    operation: "dispatch",
    eligibleAt: "2026-08-11T00:00:00.000Z",
    runId: request.identity.runId,
    requestedEffectSequence: request.identity.requestedEffectSequence,
  });
}

function preparedExecution(
  request: TaskComputeDispatchRequestV1,
): TaskComputePreparedExecutionV1 {
  const canonicalTaskManifestSha256 = digest(0x31);
  const taskRuntimeEntrySha256 = digest(0x32);
  const taskRuntimeProjectionSha256 = digest(0x33);
  const taskRuntimeGroupManifestSha256 = digest(0x34);
  const taskRuntimeMaterializationSpecSha256 = digest(0x35);
  const taskRuntimeEntry = success(decodeTaskRuntimeEntryFrameV1({
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: "orders.process",
    canonicalTaskManifestSha256,
    logicalExecutionModule: "tasks/orders",
    artifactExecutionModule: "tasks/orders.js",
    exportName: "run",
    group: "durable_task",
    projectionSha256: taskRuntimeProjectionSha256,
  }));
  const runtimeBindingCommitment = success(
    decodeTaskDefinitionRuntimeBindingCommitmentV1({
      version: 1,
      applicationRevisionId: "apprev_task_candidate_runner",
      candidateSha256: digest(0x36),
      applicationRevisionTaskBindingSha256: digest(0x37),
      taskId: taskRuntimeEntry.taskId,
      canonicalTaskManifestSha256,
      taskRuntimeEntrySha256,
      taskRuntimeEntry,
      taskCatalogSha256: digest(0x38),
      taskEntryRootSha256: digest(0x39),
      taskRuntimeProjectionSha256,
      taskRuntimeGroupManifestSha256,
      taskRuntimeMaterializationSpecSha256,
      packageSha256: digest(0x3a),
      artifactSha256: digest(0x3b),
      sourceRootSha256: digest(0x3c),
      semanticRootSha256: digest(0x3d),
      runtimeObjects: [
        runtimeObject("runtime_projection_module", digest(0x3e), 100n),
        runtimeObject(
          "task_runtime_projection",
          taskRuntimeProjectionSha256,
          70n,
        ),
        runtimeObject("task_runtime_entry", taskRuntimeEntrySha256, 40n),
        runtimeObject(
          "task_runtime_group_manifest",
          taskRuntimeGroupManifestSha256,
          60n,
        ),
        runtimeObject(
          "task_runtime_materialization_spec",
          taskRuntimeMaterializationSpecSha256,
          50n,
        ),
      ],
    }),
  );
  const inputReference = success(makeTaskInputReferenceV1(digest(0x3f), 19));
  return success(decodeTaskComputePreparedExecutionV1({
    version: TASK_COMPUTE_PREPARED_EXECUTION_VERSION_V1,
    dispatchRequest: request,
    runtimeBindingCommitment,
    inputReference,
  }));
}

function runtimeObject(
  role:
    | "runtime_projection_module"
    | "task_runtime_projection"
    | "task_runtime_entry"
    | "task_runtime_group_manifest"
    | "task_runtime_materialization_spec",
  sha256: Uint8Array,
  byteLength: bigint,
) {
  return Object.freeze({
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey:
      `standard-application-task-runtime/v1/${role}/${hex(sha256)}`,
    byteLength,
    sha256,
  });
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.getOrThrow(result);
}
