import {
  type TaskComputeDispatchIdentityV1,
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import { makeTaskInputReferenceV1 } from
  "@flarex/durable-task/internal/run-creation-v1";
import type {
  TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
  NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
  NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  encodeNodeTaskRuntimeArtifactPreimageV1,
  nodeTaskRuntimeArtifactObjectKeyV1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { Brand, Cause, Effect, Exit, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  decodeNodeTaskCallbackAttachmentV1,
} from "../src/taskComputeDelivery/NodeTaskCallbackProtocolV1.js";

import {
  NodeTaskExecutorClientError,
  makeDeterministicNodeTaskExecutor,
  makeNodeTaskExecutorInterruptionRequestV1,
  makeNodeTaskExecutorSettlementV1,
  nodeTaskExecutorStartRequestEquivalencePreimageV1,
  type NodeTaskExecutorClientApi,
  type NodeTaskExecutorSession,
} from "../src/taskComputeDelivery/NodeTaskExecutorClient.js";
import {
  NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
  NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
  NODE_TASK_EXECUTOR_START_FORMAT_V1,
  authenticateNodeTaskExecutorStartRequestV1,
  decodeNodeTaskExecutorStartRequestV1,
  makeNodeTaskExecutorInterruptionKeyV1,
  makeNodeTaskExecutorRecoveryKeyV1,
  makeNodeTaskExecutorStartKeyV1,
  type NodeTaskExecutorInterruptionRequestV1,
  type NodeTaskExecutorRecoveryRequestV1,
  type NodeTaskExecutorStartRequestV1,
} from "../src/taskComputeDelivery/NodeTaskExecutorProtocolV1.js";

const scopeId = "scope_00000000-0000-4000-8000-000000000001";
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("node-1x");

describe("Node Task executor protocol and client", () => {
  it("makes the compact start-equivalence preimage independent of claim order", () => {
    const request = startRequest();
    if (request.principal.executionIdentity.kind !== "user") {
      throw new Error("Expected user principal fixture.");
    }
    const withClaims = (reverse: boolean): NodeTaskExecutorStartRequestV1 => ({
      ...request,
      principal: {
        ...request.principal,
        executionIdentity: {
          ...request.principal.executionIdentity,
          user: {
            ...request.principal.executionIdentity.user,
            claims: reverse
              ? { second: "two", first: "one" }
              : { first: "one", second: "two" },
          },
        },
      },
    });
    expect(nodeTaskExecutorStartRequestEquivalencePreimageV1(withClaims(false)))
      .toBe(nodeTaskExecutorStartRequestEquivalencePreimageV1(withClaims(true)));
    expect(nodeTaskExecutorStartRequestEquivalencePreimageV1({
      ...withClaims(false),
      absoluteDeadlineEpochMilliseconds:
        request.absoluteDeadlineEpochMilliseconds + 1,
    })).not.toBe(nodeTaskExecutorStartRequestEquivalencePreimageV1(
      withClaims(false),
    ));
  });

  it("strictly decodes owned launch evidence and rejects key or policy drift", () => {
    const request = startRequest();
    const decoded = success(decodeNodeTaskExecutorStartRequestV1(request));

    request.nodeArtifactCanonicalBytes[0] = 0xff;
    expect(decoded.nodeArtifactCanonicalBytes[0]).not.toBe(0xff);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.principal)).toBe(true);
    expect(Object.isFrozen(decoded.principal.executionIdentity.user)).toBe(true);

    expect(failure(decodeNodeTaskExecutorStartRequestV1({
      ...startRequest(),
      unexpected: true,
    }))).toMatchObject({ boundary: "start", reason: "invalid_shape" });
    expect(failure(decodeNodeTaskExecutorStartRequestV1({
      ...startRequest(),
      startKey: "caller-selected-key",
    }))).toMatchObject({
      boundary: "start",
      reason: "invalid_key",
      path: "startKey",
    });
    expect(failure(decodeNodeTaskExecutorStartRequestV1({
      ...startRequest(),
      resourcePolicy: {
        ...startRequest().resourcePolicy,
        outbound: "allowed",
      },
    }))).toMatchObject({
      boundary: "start",
      reason: "policy_mismatch",
      path: "resourcePolicy",
    });
  });

  it("replays one start key and rejects contradictory idempotent starts", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const first = yield* fake.client.start(request);
      const replay = yield* fake.client.start(request);
      expect(first.kind).toBe("accepted");
      expect(replay.kind).toBe("accepted");
      if (first.kind !== "accepted" || replay.kind !== "accepted") return;
      expect(replay.response.sessionId).toBe(first.response.sessionId);

      const conflicting = success(decodeNodeTaskExecutorStartRequestV1({
        ...startRequest(),
        trace: {
          ...startRequest().trace,
          parentSpanId: "03".repeat(8),
        },
      }));
      const exit = yield* Effect.exit(fake.client.start(conflicting));
      expectFailure(exit, "idempotencyConflict");
    })));
  });

  it("attaches one strict callback credential after executor acceptance", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const started = yield* fake.client.start(request);
      if (started.kind !== "accepted") throw new Error("Expected acceptance");
      const attachment = success(decodeNodeTaskCallbackAttachmentV1({
        format: NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
        version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
        capabilityId: request.launchCapability.capabilityId,
        credential: digest(0x91),
        startKey: request.startKey,
        sessionId: started.response.sessionId,
        executionId: request.executionId,
        expiresAtEpochMilliseconds:
          request.launchCapability.expiresAtEpochMilliseconds,
      }));
      const first = yield* started.session.attachCallbackCapability(
        attachment,
        () => Effect.die("unused deterministic callback channel"),
      );
      expect(first).toMatchObject({
        kind: "attached",
        capabilityId: attachment.capabilityId,
        sessionId: attachment.sessionId,
      });
      expect(yield* started.session.attachCallbackCapability(
        attachment,
        () => Effect.die("unused deterministic callback channel"),
      ))
        .toEqual(first);
      const conflict = success(decodeNodeTaskCallbackAttachmentV1({
        ...attachment,
        credential: digest(0x92),
      }));
      expectFailure(
        yield* Effect.exit(
          started.session.attachCallbackCapability(
            conflict,
            () => Effect.die("unused deterministic callback channel"),
          ),
        ),
        "idempotencyConflict",
      );
      const snapshot = yield* fake.control.snapshot;
      expect(snapshot.events.filter(
        event => event.operation === "attachCallbackCapability",
      )).toHaveLength(1);
    })));
  });

  it("separates pre-acceptance transport failure from uncertain acceptance", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));

      yield* fake.control.failNextStart("transportBeforeAcceptance");
      const beforeAcceptance = yield* Effect.exit(fake.client.start(request));
      expectFailure(beforeAcceptance, "transportBeforeAcceptance");
      const missing = yield* fake.client.recover(recoveryRequest(request));
      expect(missing.kind).toBe("not_found");

      yield* fake.control.failNextStart("acceptanceUnknown");
      const uncertain = yield* Effect.exit(fake.client.start(request));
      const failureValue = expectFailure(uncertain, "acceptanceUnknown");
      expect(failureValue.recoveryKey).toBe(request.recoveryKey);
      yield* Effect.scoped(Effect.gen(function* () {
        const recovered = yield* fake.client.recover(recoveryRequest(request));
        expect(recovered.kind).toBe("accepted");
      }));
      expect(yield* fake.control.snapshot).toMatchObject({
        activeSessionCount: 0,
      });
    })));
  });

  it("constructs definite rejections from the current request correlation", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      yield* fake.control.rejectNextStart(Object.freeze({
        reason: "capacity_unavailable",
        retryable: true,
      }));
      const rejected = yield* fake.client.start(request);
      expect(rejected).toMatchObject({
        kind: "rejected",
        response: {
          startKey: request.startKey,
          recoveryKey: request.recoveryKey,
          reason: "capacity_unavailable",
          retryable: true,
        },
      });
    })));
  });

  it("keeps the authoritative session live across replay and recovery leases", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const original = yield* fake.client.start(request);
      if (original.kind !== "accepted") throw new Error("Expected acceptance");

      yield* Effect.scoped(Effect.gen(function* () {
        const replay = yield* fake.client.start(request);
        if (replay.kind !== "accepted") throw new Error("Expected replay");
        expect((yield* replay.session.health).kind).toBe("healthy");
      }));
      expect((yield* original.session.health).kind).toBe("healthy");

      yield* Effect.scoped(Effect.gen(function* () {
        const recovered = yield* fake.client.recover(recoveryRequest(request));
        if (recovered.kind !== "accepted") throw new Error("Expected recovery");
        expect((yield* recovered.session.health).kind).toBe("healthy");
      }));
      expect((yield* original.session.health).kind).toBe("healthy");
    })));
  });

  it("models health, generation-idempotent interruption, settlement, and cleanup", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const started = yield* fake.client.start(request);
      if (started.kind !== "accepted") throw new Error("Expected acceptance");

      const firstHealth = yield* started.session.health;
      expect(firstHealth).toMatchObject({
        heartbeatSequence: 1n,
        state: "running",
      });

      const generationTwo = makeNodeTaskExecutorInterruptionRequestV1(
        started.response,
        Brand.nominal<NodeTaskExecutorInterruptionGeneration>()(2n),
        "cancellation_requested",
      );
      expect((yield* started.session.requestInterruption(generationTwo)).kind)
        .toBe("interruption_requested");
      const conflictingReason = makeNodeTaskExecutorInterruptionRequestV1(
        started.response,
        generationTwo.cancellationGeneration,
        "maximum_duration",
      );
      expectFailure(
        yield* Effect.exit(
          started.session.requestInterruption(conflictingReason),
        ),
        "idempotencyConflict",
      );
      expect((yield* started.session.requestInterruption(generationTwo)).kind)
        .toBe("interruption_requested");
      const stale = makeNodeTaskExecutorInterruptionRequestV1(
        started.response,
        Brand.nominal<NodeTaskExecutorInterruptionGeneration>()(1n),
        "cancellation_requested",
      );
      expect((yield* started.session.requestInterruption(stale)).kind)
        .toBe("stale_generation");
      expect((yield* started.session.health).state)
        .toBe("interruption_requested");

      const settlement = makeNodeTaskExecutorSettlementV1(
        started.response,
        Object.freeze({
          kind: "interrupted" as const,
          interruption: Object.freeze({
            cancellationGeneration: generationTwo.cancellationGeneration,
            reason: "cancellation_requested" as const,
          }),
        }),
      );
      expect(yield* fake.control.settle(settlement)).toBe(true);
      expect(yield* started.session.settlement).toEqual(settlement);
      expect((yield* started.session.close).kind).toBe("cleaned");
      expect((yield* started.session.close).kind).toBe("already_clean");
    })));
  });

  it("reports session loss and closes accepted sessions with their Scope", async () => {
    let snapshotAfterScope: Effect.Effect<{
      readonly closed: boolean;
      readonly activeSessionCount: number;
    }> | undefined;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      snapshotAfterScope = fake.control.snapshot;
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const started = yield* fake.client.start(request);
      if (started.kind !== "accepted") throw new Error("Expected acceptance");
      expect(yield* fake.control.lose(request.startKey)).toBe(true);
      const lost = yield* Effect.exit(started.session.settlement);
      expectFailure(lost, "sessionLost");
      expect((yield* started.session.close).kind).toBe("session_lost");
    })));
    const snapshot = await Effect.runPromise(snapshotAfterScope!);
    expect(snapshot).toMatchObject({ closed: true, activeSessionCount: 0 });
  });

  it("authenticates artifact bytes and safely rejects hostile byte views", async () => {
    const mismatch = await Effect.runPromise(Effect.exit(
      authenticateNodeTaskExecutorStartRequestV1(
        startRequest(),
        () => Effect.succeed(digest(0xbb)),
      ),
    ));
    expect(Exit.isFailure(mismatch)).toBe(true);
    if (Exit.isFailure(mismatch)) {
      expect(Option.getOrThrow(Cause.findErrorOption(mismatch.cause)))
        .toMatchObject({ reason: "artifact_digest_mismatch" });
    }

    const hostileBytes = new Proxy(new Uint8Array(1), {});
    expect(() => decodeNodeTaskExecutorStartRequestV1({
      ...startRequest(),
      nodeArtifactCanonicalBytes: hostileBytes,
    })).not.toThrow();
    expect(failure(decodeNodeTaskExecutorStartRequestV1({
      ...startRequest(),
      nodeArtifactCanonicalBytes: hostileBytes,
    }))).toMatchObject({ reason: "invalid_artifact" });
  });

  it("binds interruption identity to the accepted execution", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      const request = success(decodeNodeTaskExecutorStartRequestV1(
        startRequest(),
      ));
      const started = yield* fake.client.start(request);
      if (started.kind !== "accepted") throw new Error("Expected acceptance");
      const base = started.response.identity;
      const identities = [
        validatedIdentity(request, {
          ...base,
          scopeId: "scope_00000000-0000-4000-8000-000000000002",
        }),
        validatedIdentity(request, {
          ...base,
          runId: "run_00000000-0000-4000-8000-000000000002",
        }),
        validatedIdentity(request, {
          ...base,
          requestedEffectSequence: 2n,
        }),
        validatedIdentity(request, {
          ...base,
          attemptId: "attempt_00000000-0000-4000-8000-000000000002",
        }),
        validatedIdentity(request, { ...base, executionFence: 2n }),
      ];
      for (const identity of identities) {
        const interruption = interruptionForIdentity(started.response, identity);
        expectFailure(
          yield* Effect.exit(
            started.session.requestInterruption(interruption),
          ),
          "idempotencyConflict",
        );
      }
    })));
  });

  it("wakes settlement waiters when a session or its Scope closes", async () => {
    let leakedClient: NodeTaskExecutorClientApi | undefined;
    let leakedSession: NodeTaskExecutorSession | undefined;
    const request = success(decodeNodeTaskExecutorStartRequestV1(
      startRequest(),
    ));
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(testSha256);
      leakedClient = fake.client;
      const started = yield* fake.client.start(request);
      if (started.kind !== "accepted") throw new Error("Expected acceptance");
      leakedSession = started.session;
      const waiter = yield* started.session.settlement.pipe(Effect.forkChild);
      expect((yield* started.session.close).kind).toBe("cleaned");
      expectFailure(yield* Fiber.await(waiter), "clientClosed");
      expectFailure(
        yield* Effect.exit(started.session.settlement),
        "clientClosed",
      );
    })));
    if (leakedSession === undefined) throw new Error("Expected leaked session");
    expectFailure(
      await Effect.runPromise(Effect.exit(leakedSession.settlement)),
      "clientClosed",
    );
    if (leakedClient === undefined) throw new Error("Expected leaked client");
    expectFailure(
      await Effect.runPromise(Effect.scoped(Effect.exit(
        leakedClient.start(request),
      ))),
      "clientClosed",
    );
  });

  it("rejects a closed client before invoking artifact authentication", async () => {
    let leakedClient: NodeTaskExecutorClientApi | undefined;
    let hashCalls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const fake = yield* makeDeterministicNodeTaskExecutor(input => {
        hashCalls += 1;
        return Effect.succeed(input.slice(0, 32));
      });
      leakedClient = fake.client;
    })));
    if (leakedClient === undefined) throw new Error("Expected leaked client");
    expectFailure(
      await Effect.runPromise(Effect.scoped(Effect.exit(
        leakedClient.start(startRequest()),
      ))),
      "clientClosed",
    );
    expect(hashCalls).toBe(0);
  });
});

type NodeTaskExecutorInterruptionGeneration =
  Parameters<typeof makeNodeTaskExecutorInterruptionRequestV1>[1];

function startRequest(
  options: Readonly<{ readonly cancellationGeneration?: bigint }> = {},
): NodeTaskExecutorStartRequestV1 {
  const cancellationGeneration = options.cancellationGeneration ?? 0n;
  const maximumDurationMs = 300_000;
  const dispatch = success(validateApplicationTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId,
      runId: "run_00000000-0000-4000-8000-000000000001",
      requestedEffectSequence: 1n,
      attemptId: "attempt_00000000-0000-4000-8000-000000000001",
      executionFence: 1n,
    },
    applicationTaskRuntimeTargetSha256: digest(0x12),
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile,
    cancellation: cancellationGeneration === 0n
      ? { kind: "not_requested", generation: 0n }
      : { kind: "requested", generation: cancellationGeneration },
    maximumDurationMs,
  }));
  const identity = dispatch.identity;
  const executionId = Brand.nominal<
    NodeTaskExecutorStartRequestV1["executionId"]
  >()("node-execution-1");
  const startKey = makeNodeTaskExecutorStartKeyV1(identity, executionId);
  const recoveryKey = makeNodeTaskExecutorRecoveryKeyV1(identity, executionId);
  return {
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    generation: "application_v1",
    startKey,
    recoveryKey,
    executionId,
    dispatch,
    nodeArtifactSha256Hex: "aa".repeat(32),
    nodeArtifactCanonicalBytes: success(
      encodeNodeTaskRuntimeArtifactPreimageV1(artifact()),
    ),
    input: success(makeTaskInputReferenceV1(digest(0x51), 1)),
    principal: {
      version: 1,
      scopeId: dispatch.identity.scopeId,
      executionIdentity: {
        kind: "user",
        user: {
          tokenIdentifier: "token-1",
          subject: "user-1",
          issuer: "https://issuer.example",
        },
      },
    },
    absoluteDeadlineEpochMilliseconds: 10_000_000,
    resourcePolicy: {
      computeProfile,
      resourceClassIdentity: "node-standard-1x",
      maximumDurationMilliseconds: maximumDurationMs,
      maximumCpuMilliseconds: 120_000,
      maximumMemoryBytes: 536_870_912,
      maximumTemporaryDiskBytes: 1_073_741_824,
      maximumProcesses: 1,
      maximumFileDescriptors: 256,
      maximumOutputBytes: 33_554_432,
      maximumLogBytes: 8_388_608,
      maximumCallbackCalls: 1_000,
      maximumCallbackConcurrency: 16,
      outbound: "denied",
      filesystem: "none",
      nativeModules: "denied",
      environmentVariables: "platform_only",
      secrets: "denied",
      childProcesses: "denied",
    },
    launchCapability: {
      format: "flarex.node-task-launch-capability-reference",
      version: 1,
      capabilityId: "launch-capability-1",
      boundStartKey: startKey,
      expiresAtEpochMilliseconds: 9_999_000,
    },
    trace: {
      traceId: "01".repeat(16),
      parentSpanId: "02".repeat(8),
    },
  };
}

const testSha256 = (_input: Uint8Array) => Effect.succeed(digest(0xaa));

function validatedIdentity(
  request: NodeTaskExecutorStartRequestV1,
  identity: unknown,
): TaskComputeDispatchIdentityV1 {
  return success(validateApplicationTaskComputeDispatchRequestV1({
    ...request.dispatch,
    identity,
  })).identity;
}

function interruptionForIdentity(
  acceptance: Parameters<typeof makeNodeTaskExecutorInterruptionRequestV1>[0],
  identity: TaskComputeDispatchIdentityV1,
): NodeTaskExecutorInterruptionRequestV1 {
  const cancellationGeneration = Brand.nominal<
    NodeTaskExecutorInterruptionGeneration
  >()(1n);
  return Object.freeze({
    ...makeNodeTaskExecutorInterruptionRequestV1(
      acceptance,
      cancellationGeneration,
      "cancellation_requested",
    ),
    identity,
    recoveryKey: makeNodeTaskExecutorRecoveryKeyV1(
      identity,
      acceptance.executionId,
    ),
    interruptionKey: makeNodeTaskExecutorInterruptionKeyV1(
      identity,
      acceptance.executionId,
      cancellationGeneration,
    ),
  });
}

function recoveryRequest(
  request: NodeTaskExecutorStartRequestV1,
): NodeTaskExecutorRecoveryRequestV1 {
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    startKey: request.startKey,
    recoveryKey: request.recoveryKey,
    identity: request.dispatch.identity,
    executionId: request.executionId,
  });
}

function artifact() {
  const bundleSha256 = digest(0x31);
  return {
    version: 1 as const,
    kind: "node_task_runtime_artifact" as const,
    runtimeFamily: "node" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    moduleEntryPolicyIdentity:
      NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    nodeRuntimeAbiIdentity: "nodejs-24-linux-x64",
    moduleFormat: "es_module" as const,
    architecturePolicy: "portable_javascript" as const,
    nativeModules: "denied" as const,
    applicationRevisionId: "revision-orders-v3",
    candidateSha256: digest(0x11),
    taskId: "tasks.orders.process",
    canonicalTaskManifestSha256: digest(0x22),
    computeProfileCatalogSha256: digest(0x23),
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    executionModule: "index.js",
    modules: [{
      moduleOrdinal: 0n,
      artifactModulePath: "index.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      rawByteLength: 100n,
      sourceSha256: digest(0x41),
    }, {
      moduleOrdinal: 1n,
      artifactModulePath: "tasks/orders.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      rawByteLength: 200n,
      sourceSha256: digest(0x42),
    }],
    bundle: {
      storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
      kind: "node_bundle" as const,
      codecIdentity: NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
      objectKey: nodeTaskRuntimeArtifactObjectKeyV1(
        "node_bundle",
        bundleSha256,
      ),
      byteLength: 8_192n,
      sha256: bundleSha256,
    },
    dependencies: null,
    supportedComputeProfiles: [computeProfile],
  };
}

function digest(byte: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  if (Result.isSuccess(result)) throw new Error("Expected failure");
  return result.failure;
}

function expectFailure<Success>(
  exit: Exit.Exit<Success, NodeTaskExecutorClientError>,
  reason: NodeTaskExecutorClientError["reason"],
): NodeTaskExecutorClientError {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected failure");
  const value = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(value).toBeInstanceOf(NodeTaskExecutorClientError);
  if (!(value instanceof NodeTaskExecutorClientError)) {
    throw new Error("Expected NodeTaskExecutorClientError");
  }
  expect(value).toMatchObject({ reason });
  return value;
}
