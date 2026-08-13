import {
  decodeTaskComputeDispatchRequestV1,
  TaskComputeExecutionIdV1Schema,
} from "@flarex/durable-task/internal/compute-provider-v1";
import { TaskCancellationGenerationV1Schema } from
  "@flarex/durable-task/internal/run-attempt-v1";
import {
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskRuntimeEntryFrameV1,
  hashCanonicalTaskManifestV1,
  hashTaskRuntimeEntryFrameV1,
  makeStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Effect, Result, Schema } from "effect";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";

import {
  TASK_RUNTIME_START_REQUEST_VERSION_V1,
  type TaskRuntimeCancellationRequestV1,
  type TaskRuntimeStartRequestV1,
} from "../src/taskRuntime/Abi.js";

const UTF8 = new TextEncoder();
const sha256 = makeStandardApplicationTaskSha256V1((owned) =>
  crypto.subtle.digest("SHA-256", owned)
);

export interface TaskRuntimeD2Fixture {
  readonly startRequest: TaskRuntimeStartRequestV1;
  readonly inputBytes: Uint8Array;
  readonly cancellationRequest: TaskRuntimeCancellationRequestV1;
}

export async function makeTaskRuntimeD2Fixture(
  changes: Readonly<{
    readonly payloadValidator?: TaskDefinitionRuntimeBindingV1["manifest"]["payloadValidator"];
    readonly initialCancellationGeneration?: bigint;
  }> = {},
): Promise<TaskRuntimeD2Fixture> {
  const binding = await makeBinding(changes.payloadValidator);
  const initialGeneration = changes.initialCancellationGeneration ?? 0n;
  const request = fixtureSuccess(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: "scope_97000000-0000-4000-8000-000000000001",
      runId: "run_97000000-0000-4000-8000-000000000002",
      requestedEffectSequence: "7",
      attemptId: "attempt_97000000-0000-4000-8000-000000000003",
      executionFence: "11",
    },
    taskDefinitionRevisionId:
      "taskdef_97000000-0000-4000-8000-000000000004",
    attemptNumber: 1,
    leaseVersion: "13",
    computeProfile: "standard-small",
    cancellation: initialGeneration === 0n
      ? { kind: "not_requested", generation: "0" }
      : { kind: "requested", generation: String(initialGeneration) },
    maximumDurationMs: 30_000,
  }));
  const inputCanonical = await canonicalizeFlarexValueV1({ orderId: "A-1" });
  const inputBytes = copyBytes(inputCanonical.canonicalBytes);
  const inputReference = fixtureSuccess(makeTaskInputReferenceV1(
    inputCanonical.sha256,
    inputBytes.byteLength,
  ));
  const startRequest = Object.freeze({
    version: TASK_RUNTIME_START_REQUEST_VERSION_V1,
    bridgeAbiIdentity: "flarex.task-runtime-rpc/v1" as const,
    dispatch: request,
    executionId: Schema.decodeUnknownSync(TaskComputeExecutionIdV1Schema)(
      "execution-d2-1",
    ),
    runtimeBinding: binding,
    inputReference,
    correlationToken: "correlation-d2-1",
  });
  return Object.freeze({
    startRequest,
    inputBytes,
    cancellationRequest: Object.freeze({
      version: 1,
      bridgeAbiIdentity: "flarex.task-runtime-rpc/v1" as const,
      identity: request.identity,
      executionId: startRequest.executionId,
      cancellationGeneration: Schema.decodeUnknownSync(
        Schema.toType(TaskCancellationGenerationV1Schema),
      )(2n),
      correlationToken: startRequest.correlationToken,
    }),
  });
}

async function makeBinding(
  payloadValidator: TaskDefinitionRuntimeBindingV1["manifest"]["payloadValidator"] =
    { type: "any" },
): Promise<TaskDefinitionRuntimeBindingV1> {
  const manifestInput = {
    version: 1,
    taskId: "orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator,
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" as const },
    },
    maximumDurationInSeconds: 30,
    computeProfile: "standard-small",
    queue: { kind: "default" as const },
  };
  const manifestSha256 = await Effect.runPromise(
    hashCanonicalTaskManifestV1(manifestInput, sha256),
  );
  const projectionSha256 = await hashBytes(runtimeBody("projection"));
  const entry = fixtureSuccess(decodeTaskRuntimeEntryFrameV1({
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: manifestInput.taskId,
    canonicalTaskManifestSha256: manifestSha256,
    logicalExecutionModule: manifestInput.handler.logicalModulePath,
    artifactExecutionModule: manifestInput.handler.artifactModulePath,
    exportName: manifestInput.handler.exportName,
    group: "durable_task",
    projectionSha256,
  }));
  const entrySha256 = await Effect.runPromise(
    hashTaskRuntimeEntryFrameV1(entry, sha256),
  );
  const moduleSha256 = await hashBytes(runtimeBody("projection-module"));
  const groupSha256 = await hashBytes(runtimeBody("group-manifest"));
  const materializationSha256 = await hashBytes(
    runtimeBody("materialization-spec"),
  );
  return fixtureSuccess(decodeTaskDefinitionRuntimeBindingV1({
    version: 1,
    applicationRevisionId: "apprev_task_runtime_d2",
    candidateSha256: digest(0x11),
    applicationRevisionTaskBindingSha256: digest(0x12),
    taskId: entry.taskId,
    manifest: manifestInput,
    canonicalTaskManifestSha256: manifestSha256,
    taskRuntimeEntrySha256: entrySha256,
    taskRuntimeEntry: entry,
    taskCatalogSha256: digest(0x13),
    taskEntryRootSha256: digest(0x14),
    taskRuntimeProjectionSha256: projectionSha256,
    taskRuntimeGroupManifestSha256: groupSha256,
    taskRuntimeMaterializationSpecSha256: materializationSha256,
    packageSha256: digest(0x15),
    artifactSha256: digest(0x16),
    sourceRootSha256: digest(0x17),
    semanticRootSha256: digest(0x18),
    runtimeObjects: [
      runtimeReference("runtime_projection_module", moduleSha256),
      runtimeReference("task_runtime_projection", projectionSha256),
      runtimeReference("task_runtime_entry", entrySha256),
      runtimeReference("task_runtime_group_manifest", groupSha256),
      runtimeReference(
        "task_runtime_materialization_spec",
        materializationSha256,
      ),
    ],
  }));
}

function runtimeReference(
  role: TaskRuntimeObjectRoleV1,
  digestValue: Uint8Array,
) {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(
      role,
      encodeBytesToLowercaseHex(digestValue),
    ),
    byteLength: 64n,
    sha256: digestValue,
  };
}

function runtimeBody(label: string): Uint8Array {
  return UTF8.encode(`task-runtime-d2:${label}`);
}

async function hashBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
}

function digest(seed: number): Uint8Array {
  return new Uint8Array(32).fill(seed);
}

function fixtureSuccess<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return Result.match(result, {
    onFailure: (cause) => {
      throw new Error("Expected canonical DTE06-D2 fixture data.", { cause });
    },
    onSuccess: (value) => value,
  });
}
