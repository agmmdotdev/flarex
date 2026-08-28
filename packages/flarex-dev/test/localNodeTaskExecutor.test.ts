import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { deserialize } from "node:v8";

import {
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
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
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
  NODE_TASK_EXECUTOR_START_FORMAT_V1,
  NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
  adaptNodeTaskExecutionSession,
  makeNodeTaskCallbackGateway,
  makeNodeTaskExecutorInterruptionRequestV1,
  makeNodeTaskExecutorRecoveryKeyV1,
  makeNodeTaskExecutorStartKeyV1,
  type NodeTaskExecutorSession,
  type NodeTaskExecutorStartRequestV1,
} from "flarex-backend/internal/node-task-executor";
import { Brand, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  encodeLocalNodeTaskBundle,
  localNodeRuntimeAbiIdentity,
  makeLocalNodeTaskExecutor,
} from "../src/nodeTaskLocalExecutor/LocalNodeTaskExecutor.js";
import { LOCAL_NODE_TASK_BOOTSTRAP } from
  "../src/nodeTaskLocalExecutor/bootstrap.js";

const profile = Brand.nominal<TaskComputeProfileRefV1>()("node-1x");
const scopeId = "scope_00000000-0000-4000-8000-000000000001";

describe("local Node Task executor", () => {
  it("executes an immutable trusted fixture without host globals and cleans up", async () => {
    const fixture = makeFixture(`
      export async function run(_ctx, input) {
        return {
          input,
          processType: typeof process,
          fetchType: typeof fetch,
          requireType: typeof require,
        };
      }
    `, { input: "hello" });

    const settlement = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
      const started = yield* provider.makeClient().start(fixture.request);
      expect(started.kind).toBe("accepted");
      if (started.kind !== "accepted") return undefined;
      yield* attachWithoutCallbacks(started.session, fixture.request);
      const result = yield* adaptNodeTaskExecutionSession(
        started.session,
        1_000,
      ).settlement;
      yield* started.session.close;
      expect((yield* provider.control.snapshot).activeProcessCount).toBe(0);
      return result;
    })));

    expect(settlement?.outcome).toEqual({
      kind: "completed",
      result: {
        value: {
          fetchType: "undefined",
          input: { input: "hello" },
          processType: "undefined",
          requireType: "undefined",
        },
        valueSemanticBytes: expect.any(Number),
      },
    });
  });

  it("recovers an uncertain start on a fresh client and replays a lost callback response once", async () => {
    const fixture = makeFixture(`
      export async function run(ctx, input) {
        const queried = await ctx.runQuery("messages:get", input);
        const mutated = await ctx.runMutation("messages:put", queried);
        return mutated;
      }
    `, { id: "message-1" });
    let queries = 0;
    let mutations = 0;

    const settlement = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
      yield* provider.control.loseNextStartResponse;
      const uncertain = yield* Effect.result(
        provider.makeClient().start(fixture.request),
      );
      expect(Result.isFailure(uncertain) && uncertain.failure.reason)
        .toBe("acceptanceUnknown");
      const recovered = yield* provider.makeClient().recover({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        startKey: fixture.request.startKey,
        recoveryKey: fixture.request.recoveryKey,
        identity: fixture.request.dispatch.identity,
        executionId: fixture.request.executionId,
      });
      expect(recovered.kind).toBe("accepted");
      if (recovered.kind !== "accepted") return undefined;
      yield* provider.control.dropNextCallbackResponse;
      yield* makeNodeTaskCallbackGateway({
        start: fixture.request,
        executorSession: recovered.session,
        querySession: {
          runQuery: (_path, value) => Effect.sync(() => {
            queries += 1;
            return { queried: value };
          }),
        },
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: (_ordinal, _path, value) => Effect.sync(() => {
            mutations += 1;
            return { mutated: value };
          }),
          close: Effect.void,
        },
        credential: new Uint8Array(32).fill(0x77),
      });
      return yield* recovered.session.settlement;
    })));

    expect(queries).toBe(1);
    expect(mutations).toBe(1);
    expect(settlement?.outcome.kind).toBe("completed");
  });

  it("round-trips the canonical runtime domain through both callback kinds", async () => {
    const largeText = "🙂漢字".repeat(8_192);
    const input = {
      bigint: 9_223_372_036_854_775_000n,
      bytes: new Uint8Array([0, 1, 127, 128, 255]).buffer,
      largeText,
      nan: Number.NaN,
      negativeInfinity: Number.NEGATIVE_INFINITY,
      negativeZero: -0,
      positiveInfinity: Number.POSITIVE_INFINITY,
      wireTagLookalikes: {
        flarexBigInt: "not-a-wire-tag",
        flarexBytes: "also-not-a-wire-tag",
      },
    };
    const fixture = makeFixture(`
      export async function run(ctx, input) {
        const queried = await ctx.runQuery("values:query", input);
        const mutated = await ctx.runMutation("values:mutation", queried);
        return {
          mutated,
          vmBytes: new Uint8Array([9, 8, 7]).buffer,
          vmNaN: Number.NaN,
          vmNegativeZero: -0,
        };
      }
    `, input);
    let queryArguments: unknown;
    let mutationArguments: unknown;

    const settlement = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
      const started = yield* provider.makeClient().start(fixture.request);
      if (started.kind !== "accepted") return yield* Effect.die("not accepted");
      yield* makeNodeTaskCallbackGateway({
        start: fixture.request,
        executorSession: started.session,
        querySession: {
          runQuery: (_path, value) => Effect.sync(() => {
            queryArguments = value;
            return { queryEcho: value };
          }),
        },
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: (_ordinal, _path, value) => Effect.sync(() => {
            mutationArguments = value;
            return { mutationEcho: value };
          }),
          close: Effect.void,
        },
        credential: new Uint8Array(32).fill(0x78),
      });
      return yield* started.session.settlement;
    })));

    if (settlement.outcome.kind === "failed") {
      throw new Error(`Unexpected settlement: ${settlement.outcome.failure.code}`);
    }
    expect(settlement.outcome).toMatchObject({ kind: "completed" });
    if (settlement.outcome.kind !== "completed") return;
    assertRuntimeValue(queryArguments, input);
    const mutationRecord = expectRecord(mutationArguments);
    assertRuntimeValue(mutationRecord.queryEcho, input);
    const output = expectRecord(settlement.outcome.result.value);
    const mutated = expectRecord(output.mutated);
    const mutationEcho = expectRecord(mutated.mutationEcho);
    assertRuntimeValue(mutationEcho.queryEcho, input);
    expect([...new Uint8Array(expectArrayBuffer(output.vmBytes))])
      .toEqual([9, 8, 7]);
    expect(Number.isNaN(output.vmNaN)).toBe(true);
    expect(Object.is(output.vmNegativeZero, -0)).toBe(true);
  });

  it("classifies handler failure and cancellation as terminal outcomes", async () => {
    const failedFixture = makeFixture(`
      export async function run() { throw new Error("private detail"); }
    `, null);
    const failed = await runAttached(failedFixture);
    expect(failed.outcome).toEqual({
      kind: "failed",
      failure: { code: "handler_failed", message: null },
    });

    const invalidOutput = await runAttached(makeFixture(
      `export async function run() { return { $flarexBigInt: "invalid" }; }`,
      null,
    ));
    expect(invalidOutput.outcome).toEqual({
      kind: "failed",
      failure: { code: "output_validation_failed", message: null },
    });

    const unavailableInput = await runAttached(makeFixture(
      `export async function run(_ctx, input) { return input; }`,
      null,
      5_000,
      true,
    ));
    expect(unavailableInput.outcome).toEqual({
      kind: "failed",
      failure: { code: "runtime_input_unavailable", message: null },
    });

    const pendingFixture = makeFixture(`
      export async function run() { return await new Promise(() => {}); }
    `, null, 30_000);
    const interrupted = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(pendingFixture.options);
      const started = yield* provider.makeClient().start(pendingFixture.request);
      if (started.kind !== "accepted") return yield* Effect.die("not accepted");
      yield* attachWithoutCallbacks(started.session, pendingFixture.request);
      const neutral = adaptNodeTaskExecutionSession(started.session, 1_000);
      yield* neutral.requestInterruption({
        generation: neutral.acceptance.generation,
        identity: Object.freeze({ ...neutral.acceptance.identity }),
        executionId: neutral.acceptance.executionId,
        cancellationGeneration: Brand.nominal<NodeTaskExecutorStartRequestV1[
          "dispatch"
        ]["cancellation"]["generation"]>()(1n),
        reason: "cancellation_requested",
      });
      return yield* neutral.settlement;
    })));
    expect(interrupted.outcome).toEqual({
      kind: "interrupted",
      interruption: {
        cancellationGeneration: 1n,
        reason: "cancellation_requested",
      },
    });
  });

  it("reports unexpected process loss and enforces the duration deadline", async () => {
    const lossFixture = makeFixture(`
      export async function run() { return await new Promise(() => {}); }
    `, null, 30_000);
    const lost = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(lossFixture.options);
      const started = yield* provider.makeClient().start(lossFixture.request);
      if (started.kind !== "accepted") return yield* Effect.die("not accepted");
      yield* attachWithoutCallbacks(started.session, lossFixture.request);
      yield* provider.control.terminate(lossFixture.request.startKey);
      const result = yield* Effect.result(started.session.settlement);
      yield* started.session.close;
      const snapshot = yield* provider.control.snapshot;
      expect(snapshot.liveExecutionCount).toBe(0);
      expect(snapshot.retiredExecutionCount).toBe(1);
      return result;
    })));
    expect(Result.isFailure(lost) && lost.failure.reason).toBe("sessionLost");

    const timeoutFixture = makeFixture(`
      export async function run() { return await new Promise(() => {}); }
    `, null, 500);
    const timedOut = await runAttached(timeoutFixture);
    expect(timedOut.outcome).toEqual({
      kind: "interrupted",
      interruption: {
        cancellationGeneration: 1n,
        reason: "maximum_duration",
      },
    });
  });

  it("owns startup timeout, exact start idempotency, and close recovery", async () => {
    const startupFixture = makeFixture(`
      await new Promise(() => {});
      export async function run() { return "unreachable"; }
    `, null, 40);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(startupFixture.options);
      const start = yield* Effect.result(
        provider.makeClient().start(startupFixture.request),
      );
      expect(Result.isFailure(start) && start.failure.reason)
        .toBe("transportBeforeAcceptance");
      expect((yield* provider.control.snapshot).activeProcessCount).toBe(0);
    })));

    const pendingFixture = makeFixture(`
      export async function run() { return await new Promise(() => {}); }
    `, null, 30_000);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(pendingFixture.options);
      const client = provider.makeClient();
      const started = yield* client.start(pendingFixture.request);
      if (started.kind !== "accepted") return yield* Effect.die("not accepted");
      const changedPrincipal: NodeTaskExecutorStartRequestV1 = {
        ...pendingFixture.request,
        principal: {
          ...pendingFixture.request.principal,
          executionIdentity: {
            kind: "user",
            user: {
              ...pendingFixture.request.principal.executionIdentity.user,
              tokenIdentifier: "different-token",
            },
          },
        },
      };
      const conflicting = yield* Effect.result(client.start(changedPrincipal));
      expect(Result.isFailure(conflicting) && conflicting.failure.reason)
        .toBe("idempotencyConflict");
      const mismatchedAttachment = yield* Effect.result(
        started.session.attachCallbackCapability({
          format: NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
          version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
          capabilityId: pendingFixture.request.launchCapability.capabilityId,
          credential: new Uint8Array(32).fill(0x66) as never,
          startKey: pendingFixture.request.startKey,
          sessionId: started.session.acceptance.sessionId,
          executionId: pendingFixture.request.executionId,
          expiresAtEpochMilliseconds:
            pendingFixture.request.launchCapability.expiresAtEpochMilliseconds + 1,
        }, () => Effect.die("unexpected callback")),
      );
      expect(Result.isFailure(mismatchedAttachment) &&
        mismatchedAttachment.failure.reason).toBe("invalidRequest");
      yield* attachWithoutCallbacks(started.session, pendingFixture.request);
      yield* started.session.close;
      const settlement = yield* Effect.result(started.session.settlement);
      expect(Result.isFailure(settlement) && settlement.failure.reason)
        .toBe("clientClosed");
      const recovered = yield* client.recover({
        format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
        version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
        startKey: pendingFixture.request.startKey,
        recoveryKey: pendingFixture.request.recoveryKey,
        identity: pendingFixture.request.dispatch.identity,
        executionId: pendingFixture.request.executionId,
      });
      expect(recovered.kind).toBe("session_lost");
    })));
  });

  it("fails an attachment race when the accepted process disappears", async () => {
    const fixture = makeFixture(`
      export async function run() { return await new Promise(() => {}); }
    `, null, 30_000);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
      const started = yield* provider.makeClient().start(fixture.request);
      if (started.kind !== "accepted") return yield* Effect.die("not accepted");
      yield* provider.control.terminate(fixture.request.startKey);
      const attached = yield* Effect.result(
        attachWithoutCallbacks(started.session, fixture.request),
      );
      expect(Result.isFailure(attached) && attached.failure.reason)
        .toBe("sessionLost");
    })));
  });

  it("serializes concurrent recovery with startup readiness and failure", async () => {
    const readyFixture = makeFixture(`
      const until = Date.now() + 100;
      while (Date.now() < until) {}
      export async function run() { return await new Promise(() => {}); }
    `, null, 5_000);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(readyFixture.options);
      const client = provider.makeClient();
      const starting = yield* client.start(readyFixture.request).pipe(
        Effect.forkChild,
      );
      yield* Effect.sleep(10);
      const recovered = yield* client.recover(recoveryRequest(readyFixture.request));
      expect(recovered.kind).toBe("accepted");
      if (recovered.kind !== "accepted") return;
      yield* attachWithoutCallbacks(recovered.session, readyFixture.request);
      const started = yield* Fiber.join(starting);
      expect(started.kind).toBe("accepted");
    })));

    const failedFixture = makeFixture(`
      await new Promise(() => {});
      export async function run() { return "unreachable"; }
    `, null, 60);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(failedFixture.options);
      const client = provider.makeClient();
      const starting = yield* client.start(failedFixture.request).pipe(
        Effect.result,
        Effect.forkChild,
      );
      yield* Effect.sleep(10);
      const recovered = yield* client.recover(recoveryRequest(failedFixture.request));
      expect(recovered.kind).toBe("not_found");
      const started = yield* Fiber.join(starting);
      expect(Result.isFailure(started) && started.failure.reason)
        .toBe("transportBeforeAcceptance");
    })));
  });

  it("maps asynchronous executable spawn failure into the typed start channel", async () => {
    const fixture = makeFixture(
      `export async function run() { return "unreachable"; }`,
      null,
    );
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor({
        ...fixture.options,
        nodeExecutable: resolve(".flarex-node-does-not-exist"),
      });
      const started = yield* Effect.result(
        provider.makeClient().start(fixture.request),
      );
      expect((yield* provider.control.snapshot).activeProcessCount).toBe(0);
      return started;
    })));
    expect(Result.isFailure(result) && result.failure.reason)
      .toBe("transportBeforeAcceptance");
  });

  it("attests the child ABI and evaluates the committed execution module", async () => {
    const fixture = makeFixture(
      `export async function run() { return globalThis.executionEntryState; }`,
      null,
      5_000,
      false,
      `globalThis.executionEntryState = "evaluated";`,
    );
    const settlement = await runAttached(fixture);
    expect(settlement.outcome).toEqual({
      kind: "completed",
      result: {
        value: "evaluated",
        valueSemanticBytes: expect.any(Number),
      },
    });
  });

  it("requires the child ABI hello before sending any artifact", async () => {
    const child = spawn(process.execPath, [
      "--permission",
      "--no-warnings",
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      LOCAL_NODE_TASK_BOOTSTRAP,
    ], {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    try {
      const hello = expectRecord(await readFirstChildFrame(child));
      expect(hello).toEqual({
        type: "hello",
        nodeRuntimeAbiIdentity: localNodeRuntimeAbiIdentity(),
      });
      expect(child.exitCode).toBeNull();
    } finally {
      child.kill();
      await new Promise<void>(resolveClose => child.once("close", () => {
        resolveClose();
      }));
    }
  });

  it("fails closed at the idempotency bound and preserves equivalent retries", async () => {
    const fixture = makeFixture(
      `export async function run() { return "settled"; }`,
      null,
    );
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
      const client = provider.makeClient();
      const requests: NodeTaskExecutorStartRequestV1[] = [];
      const sessionIds = new Set<string>();
      for (let ordinal = 0; ordinal < 16; ordinal += 1) {
        const ordinalRequest = requestWithExecutionOrdinal(
          fixture.request,
          ordinal,
        );
        const request = ordinal === 0
          ? requestWithClaimOrder(ordinalRequest, false)
          : ordinalRequest;
        requests.push(request);
        const started = yield* client.start(request);
        if (started.kind !== "accepted") return yield* Effect.die("not accepted");
        sessionIds.add(started.response.sessionId);
        const liveRetry = ordinal === 0
          ? yield* client.start(requestWithClaimOrder(ordinalRequest, true))
          : undefined;
        if (liveRetry !== undefined) expect(liveRetry.kind).toBe("accepted");
        yield* attachWithoutCallbacks(started.session, request);
        yield* started.session.settlement;
        yield* started.session.close;
        if (liveRetry?.kind === "accepted") yield* liveRetry.session.close;
      }
      expect(sessionIds.size).toBe(16);
      const overCapacity = yield* client.start(
        requestWithExecutionOrdinal(fixture.request, 16),
      );
      expect(overCapacity).toMatchObject({
        kind: "rejected",
        response: { reason: "capacity_unavailable", retryable: true },
      });
      const snapshot = yield* provider.control.snapshot;
      expect(snapshot.activeProcessCount).toBe(0);
      expect(snapshot.liveExecutionCount).toBe(0);
      expect(snapshot.retiredExecutionCount).toBe(16);
      expect(snapshot.startKeys).toHaveLength(16);
      const oldest = yield* client.recover(recoveryRequest(requests[0]!));
      expect(oldest.kind).toBe("accepted");
      const newest = yield* client.recover(recoveryRequest(requests.at(-1)!));
      expect(newest.kind).toBe("accepted");
      if (newest.kind === "accepted") {
        expect((yield* newest.session.settlement).outcome.kind).toBe("completed");
      }
      const repeated = yield* client.start(requestWithClaimOrder(
        requestWithExecutionOrdinal(fixture.request, 0),
        true,
      ));
      expect(repeated.kind).toBe("accepted");
      if (repeated.kind === "accepted") {
        expect((yield* repeated.session.settlement).outcome.kind).toBe("completed");
        expect(repeated.response.sessionId).toBe(
          oldest.kind === "accepted" ? oldest.response.acceptance.sessionId : "",
        );
      }
      expect((yield* provider.control.snapshot).activeProcessCount).toBe(0);
    })));
  });
});

function makeFixture(
  source: string,
  input: unknown,
  duration = 5_000,
  inputUnavailable = false,
  executionSource?: string,
) {
  const moduleFixtures = executionSource === undefined
    ? [{
        path: "tasks/example.js",
        source,
        sourceRoles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION |
          SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      }]
    : [{
        path: "_flarex/execution.js",
        source: executionSource,
        sourceRoles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      }, {
        path: "tasks/example.js",
        source,
        sourceRoles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      }];
  const bundleBytes = encodeLocalNodeTaskBundle(moduleFixtures);
  const bundleSha = digestBytes(bundleBytes);
  const artifact = {
    version: 1 as const,
    kind: "node_task_runtime_artifact" as const,
    runtimeFamily: "node" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    moduleEntryPolicyIdentity: NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    nodeRuntimeAbiIdentity: localNodeRuntimeAbiIdentity(),
    moduleFormat: "es_module" as const,
    architecturePolicy: "portable_javascript" as const,
    nativeModules: "denied" as const,
    applicationRevisionId: "revision-local-node",
    candidateSha256: digest(0x11),
    taskId: "tasks.example.run",
    canonicalTaskManifestSha256: digest(0x22),
    computeProfileCatalogSha256: digest(0x23),
    handler: {
      logicalModulePath: "tasks/example",
      artifactModulePath: "tasks/example.js",
      exportName: "run",
    },
    executionModule: executionSource === undefined
      ? "tasks/example.js"
      : "_flarex/execution.js",
    modules: moduleFixtures.map((module, index) => {
      const moduleBytes = new TextEncoder().encode(module.source);
      return {
        moduleOrdinal: BigInt(index),
        artifactModulePath: module.path,
        sourceRoles: module.sourceRoles,
        rawByteLength: BigInt(moduleBytes.byteLength),
        sourceSha256: digestBytes(moduleBytes),
      };
    }),
    bundle: {
      storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
      kind: "node_bundle" as const,
      codecIdentity: NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
      objectKey: nodeTaskRuntimeArtifactObjectKeyV1("node_bundle", bundleSha),
      byteLength: BigInt(bundleBytes.byteLength),
      sha256: bundleSha,
    },
    dependencies: null,
    supportedComputeProfiles: [profile],
  };
  const artifactBytes = success(encodeNodeTaskRuntimeArtifactPreimageV1(artifact));
  const artifactSha = digestBytes(artifactBytes);
  const inputReference = success(makeTaskInputReferenceV1(digest(0x51), 1));
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
    computeProfile: profile,
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: duration,
  }));
  const executionId = Brand.nominal<NodeTaskExecutorStartRequestV1[
    "executionId"
  ]>()(`node-execution-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`);
  const startKey = makeNodeTaskExecutorStartKeyV1(dispatch.identity, executionId);
  const request: NodeTaskExecutorStartRequestV1 = {
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    generation: "application_v1",
    startKey,
    recoveryKey: makeNodeTaskExecutorRecoveryKeyV1(dispatch.identity, executionId),
    executionId,
    dispatch,
    nodeArtifactSha256Hex: encodeBytesToLowercaseHex(artifactSha),
    nodeArtifactCanonicalBytes: artifactBytes,
    input: inputReference,
    principal: {
      version: 1,
      scopeId: dispatch.identity.scopeId,
      executionIdentity: {
        kind: "user",
        user: {
          tokenIdentifier: "local-test-token",
          subject: "local-test-user",
          issuer: "https://local.test",
        },
      },
    },
    absoluteDeadlineEpochMilliseconds: Date.now() + duration + 10_000,
    resourcePolicy: {
      computeProfile: profile,
      resourceClassIdentity: "node-local-test",
      maximumDurationMilliseconds: duration,
      maximumCpuMilliseconds: duration,
      maximumMemoryBytes: 128 * 1_024 * 1_024,
      maximumTemporaryDiskBytes: 1,
      maximumProcesses: 1,
      maximumFileDescriptors: 64,
      maximumOutputBytes: 1_048_576,
      maximumLogBytes: 65_536,
      maximumCallbackCalls: 16,
      maximumCallbackConcurrency: 1,
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
      capabilityId: "local-test-capability",
      boundStartKey: startKey,
      expiresAtEpochMilliseconds: Date.now() + duration + 5_000,
    },
    trace: { traceId: "01".repeat(16), parentSpanId: null },
  };
  return {
    request,
    options: {
      artifactStore: { readBundle: () => Effect.succeed(bundleBytes) },
      inputStore: {
        read: () => inputUnavailable
          ? Effect.fail(undefined as never)
          : Effect.succeed({
              reference: inputReference,
              value: input as never,
              canonicalBytes: new Uint8Array([0]),
              semanticSizeBytes: 1,
            }),
      },
    },
  };
}

function attachWithoutCallbacks(
  session: NodeTaskExecutorSession,
  request: NodeTaskExecutorStartRequestV1,
) {
  return session.attachCallbackCapability({
    format: NODE_TASK_CALLBACK_ATTACHMENT_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    capabilityId: request.launchCapability.capabilityId,
    credential: new Uint8Array(32).fill(0x66) as never,
    startKey: request.startKey,
    sessionId: session.acceptance.sessionId,
    executionId: request.executionId,
    expiresAtEpochMilliseconds: request.launchCapability.expiresAtEpochMilliseconds,
  }, () => Effect.die("unexpected callback"));
}

function recoveryRequest(request: NodeTaskExecutorStartRequestV1) {
  return {
    format: NODE_TASK_EXECUTOR_RECOVERY_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    startKey: request.startKey,
    recoveryKey: request.recoveryKey,
    identity: request.dispatch.identity,
    executionId: request.executionId,
  } as const;
}

function requestWithExecutionOrdinal(
  request: NodeTaskExecutorStartRequestV1,
  ordinal: number,
): NodeTaskExecutorStartRequestV1 {
  const executionId = Brand.nominal<NodeTaskExecutorStartRequestV1[
    "executionId"
  ]>()(`node-execution-retention-${ordinal}`);
  const startKey = makeNodeTaskExecutorStartKeyV1(
    request.dispatch.identity,
    executionId,
  );
  return {
    ...request,
    executionId,
    startKey,
    recoveryKey: makeNodeTaskExecutorRecoveryKeyV1(
      request.dispatch.identity,
      executionId,
    ),
    launchCapability: {
      ...request.launchCapability,
      capabilityId: `${request.launchCapability.capabilityId}-${ordinal}`,
      boundStartKey: startKey,
    },
  };
}

function requestWithClaimOrder(
  request: NodeTaskExecutorStartRequestV1,
  reverse: boolean,
): NodeTaskExecutorStartRequestV1 {
  const claims = reverse
    ? { second: "two", first: "one" }
    : { first: "one", second: "two" };
  if (request.principal.executionIdentity.kind !== "user") return request;
  return {
    ...request,
    principal: {
      ...request.principal,
      executionIdentity: {
        ...request.principal.executionIdentity,
        user: {
          ...request.principal.executionIdentity.user,
          claims,
        },
      },
    },
  };
}

function readFirstChildFrame(
  child: ChildProcessWithoutNullStreams,
): Promise<unknown> {
  child.stdout.setEncoding("utf8");
  return new Promise((resolveFrame, rejectFrame) => {
    let buffer = "";
    const fail = (cause: unknown) => {
      clearTimeout(timeout);
      rejectFrame(cause);
    };
    const timeout = setTimeout(() => {
      fail(new Error("Timed out waiting for child ABI hello."));
    }, 2_000);
    child.once("error", fail);
    child.once("close", () => fail(new Error(
      "Child closed before its ABI hello.",
    )));
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      clearTimeout(timeout);
      const encoded = buffer.slice(0, newline);
      resolveFrame(deserialize(Buffer.from(encoded, "base64")));
    });
  });
}

function expectRecord(value: unknown): Readonly<Record<string, unknown>> {
  expect(isNonArrayRecord(value)).toBe(true);
  if (!isNonArrayRecord(value)) throw new Error("Expected a record.");
  return value;
}

function expectArrayBuffer(value: unknown): ArrayBuffer {
  expect(value).toBeInstanceOf(ArrayBuffer);
  if (!(value instanceof ArrayBuffer)) throw new Error("Expected ArrayBuffer.");
  return value;
}

function assertRuntimeValue(actual: unknown, expected: {
  readonly bigint: bigint;
  readonly bytes: ArrayBuffer;
  readonly largeText: string;
  readonly nan: number;
  readonly negativeInfinity: number;
  readonly negativeZero: number;
  readonly positiveInfinity: number;
  readonly wireTagLookalikes: Readonly<Record<string, string>>;
}): void {
  const record = expectRecord(actual);
  expect(record.bigint).toBe(expected.bigint);
  expect([...new Uint8Array(expectArrayBuffer(record.bytes))])
    .toEqual([...new Uint8Array(expected.bytes)]);
  expect(record.largeText).toBe(expected.largeText);
  expect(Number.isNaN(record.nan)).toBe(true);
  expect(record.negativeInfinity).toBe(Number.NEGATIVE_INFINITY);
  expect(Object.is(record.negativeZero, -0)).toBe(true);
  expect(record.positiveInfinity).toBe(Number.POSITIVE_INFINITY);
  expect(record.wireTagLookalikes).toEqual(expected.wireTagLookalikes);
}

async function runAttached(fixture: ReturnType<typeof makeFixture>) {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const provider = yield* makeLocalNodeTaskExecutor(fixture.options);
    const started = yield* provider.makeClient().start(fixture.request);
    if (started.kind !== "accepted") return yield* Effect.die("not accepted");
    yield* attachWithoutCallbacks(started.session, fixture.request);
    return yield* started.session.settlement;
  })));
}

function digest(byte: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
}

function digestBytes(bytes: Uint8Array): TaskDefinitionSha256V1 {
  return new Uint8Array(createHash("sha256").update(bytes).digest()) as
    TaskDefinitionSha256V1;
}

function success<Success, Failure>(result: Result.Result<Success, Failure>): Success {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}
