import {
  decodeTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  encodeTaskRuntimeEntryPreimageV1,
  makeLiveStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Brand, Cause, Effect, Exit, Option, Result } from "effect";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  TaskRunInputStoreCorruptionError,
  TaskRunInputStoreNotFoundError,
  type TaskRunInputStore,
} from "../src/taskRunInput/TaskRunInputStore.js";
import {
  TaskRuntimeLaunchLocatedSourceConfigurationError,
  makeTaskRuntimeLaunchLocatedSource,
  validateStandardApplicationTaskRuntimeObject,
  type TaskRuntimeLaunchLocatedEvidenceSource,
  type TaskRuntimeLaunchLocatedStores,
} from "../src/taskRuntimeLaunch/LocatedSource.js";
import { TaskRuntimeLaunchObjectCodecError } from
  "../src/taskRuntimeLaunch/Model.js";
import {
  TaskRuntimeObjectStoreCorruptionError,
  TaskRuntimeObjectStoreNotFoundError,
  type TaskRuntimeObjectStore,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";

const UTF8 = new TextEncoder();
const SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_98000000-0000-4000-8000-000000000001",
);
const OTHER_SCOPE_ID = ReplacementScopeIdV1Schema.make(
  "scope_98000000-0000-4000-8000-000000000002",
);

describe("Task runtime launch located source", () => {
  it("composes same-scope readers and preserves every capability receiver", async () => {
    const fixture = await makeFixture();
    let evidenceReceiver = false;
    let runtimeReceiver = false;
    let inputReceiver = false;

    let evidence: TaskRuntimeLaunchLocatedEvidenceSource;
    evidence = {
      scopeId: SCOPE_ID,
      readEvidence(request) {
        evidenceReceiver = this === evidence;
        expect(request).toEqual(fixture.request);
        return Effect.succeed({
          preparedExecution: "prepared",
          runtimeBinding: "binding",
          runtimeBindingCanonicalBytes: new Uint8Array([1]),
        });
      },
    };
    let runtimeObjects: Pick<TaskRuntimeObjectStore, "read">;
    runtimeObjects = {
      read(reference) {
        runtimeReceiver = this === runtimeObjects;
        expect(reference).toEqual(fixture.runtimeReference);
        return Effect.succeed(Object.freeze({
          reference: fixture.runtimeReference,
          bytes: new Uint8Array([1, 2, 3]),
        }));
      },
    };
    let runInputs: Pick<TaskRunInputStore, "read">;
    runInputs = {
      read(reference) {
        inputReceiver = this === runInputs;
        expect(reference).toEqual(fixture.inputReference);
        return Effect.succeed(Object.freeze({
          reference: fixture.inputReference,
          canonicalBytes: fixture.inputBytes,
          value: fixture.inputValue,
        }));
      },
    };

    const source = success(makeTaskRuntimeLaunchLocatedSource(evidence, {
      scopeId: SCOPE_ID,
      runtimeObjects,
      runInputs,
    }));

    await Effect.runPromise(source.readEvidence(fixture.request));
    await expect(Effect.runPromise(
      source.readRuntimeObject(fixture.runtimeReference),
    )).resolves.toEqual(new Uint8Array([1, 2, 3]));
    await expect(Effect.runPromise(source.readInput(fixture.inputReference)))
      .resolves.toEqual(fixture.inputBytes);
    expect({ evidenceReceiver, runtimeReceiver, inputReceiver }).toEqual({
      evidenceReceiver: true,
      runtimeReceiver: true,
      inputReceiver: true,
    });
    expect(Object.isFrozen(source)).toBe(true);
  });

  it("rejects a store bundle located for a different trusted scope", async () => {
    const fixture = await makeFixture();
    const result = makeTaskRuntimeLaunchLocatedSource(
      evidenceSource(fixture.request),
      locatedStores(fixture, OTHER_SCOPE_ID),
    );

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toEqual(
        new TaskRuntimeLaunchLocatedSourceConfigurationError({
          reason: "scope_mismatch",
        }),
      );
    }
  });

  it("captures each located owner once and types hostile configuration", async () => {
    const fixture = await makeFixture();
    const runtimeObjects = locatedStores(fixture, SCOPE_ID).runtimeObjects;
    const runInputs = locatedStores(fixture, SCOPE_ID).runInputs;
    let runtimeOwnerReads = 0;
    let inputOwnerReads = 0;
    const stores = {
      scopeId: SCOPE_ID,
      get runtimeObjects() {
        runtimeOwnerReads += 1;
        return runtimeObjects;
      },
      get runInputs() {
        inputOwnerReads += 1;
        return runInputs;
      },
    };

    expect(Result.isSuccess(makeTaskRuntimeLaunchLocatedSource(
      evidenceSource(fixture.request),
      stores,
    ))).toBe(true);
    expect({ runtimeOwnerReads, inputOwnerReads }).toEqual({
      runtimeOwnerReads: 1,
      inputOwnerReads: 1,
    });

    const hostile: TaskRuntimeLaunchLocatedEvidenceSource = {
      get scopeId(): never {
        throw new Error("hostile scope getter");
      },
      readEvidence: () => Effect.die("unreachable"),
    };
    const result = makeTaskRuntimeLaunchLocatedSource(
      hostile,
      locatedStores(fixture, SCOPE_ID),
    );
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskRuntimeLaunchLocatedSourceConfigurationError",
        reason: "invalid_source",
      });
    }
  });

  it("preserves missing and corrupt input and runtime-object distinctions", async () => {
    const fixture = await makeFixture();
    const runtimeNotFound = new TaskRuntimeObjectStoreNotFoundError({
      reference: fixture.runtimeReference,
    });
    const inputCorrupt = new TaskRunInputStoreCorruptionError({
      reference: fixture.inputReference,
      reason: "digestMismatch",
    });
    const source = success(makeTaskRuntimeLaunchLocatedSource(
      evidenceSource(fixture.request),
      {
        scopeId: SCOPE_ID,
        runtimeObjects: {
          read: () => Effect.fail(runtimeNotFound),
        },
        runInputs: {
          read: () => Effect.fail(inputCorrupt),
        },
      },
    ));

    await expectFailure(
      source.readRuntimeObject(fixture.runtimeReference),
      "read_runtime_object",
      "not_found",
      runtimeNotFound,
    );
    await expectFailure(
      source.readInput(fixture.inputReference),
      "read_input",
      "corrupt",
      inputCorrupt,
    );

    const inverse = success(makeTaskRuntimeLaunchLocatedSource(
      evidenceSource(fixture.request),
      {
        scopeId: SCOPE_ID,
        runtimeObjects: {
          read: () => Effect.fail(
            new TaskRuntimeObjectStoreCorruptionError({
              reference: fixture.runtimeReference,
              reason: "digestMismatch",
            }),
          ),
        },
        runInputs: {
          read: () => Effect.fail(
            new TaskRunInputStoreNotFoundError({
              reference: fixture.inputReference,
            }),
          ),
        },
      },
    ));
    await expectFailure(
      inverse.readRuntimeObject(fixture.runtimeReference),
      "read_runtime_object",
      "corrupt",
    );
    await expectFailure(
      inverse.readInput(fixture.inputReference),
      "read_input",
      "not_found",
    );
  });

  it("uses the Standard Application role codec at the launch boundary", async () => {
    const fixture = await makeFixture();
    const entryBytes = success(encodeTaskRuntimeEntryPreimageV1({
      kind: "task_runtime_entry",
      taskOrdinal: 0n,
      taskId: "orders.process",
      canonicalTaskManifestSha256: fixture.digest,
      logicalExecutionModule: "tasks/orders",
      artifactExecutionModule: "tasks/orders.js",
      exportName: "run",
      group: "durable_task",
      projectionSha256: fixture.digest,
    }));
    const entryReference: TaskRuntimeObjectReferenceV1 = Object.freeze({
      ...fixture.runtimeReference,
      role: "task_runtime_entry",
      objectKey: taskRuntimeObjectKeyV1(
        "task_runtime_entry",
        encodeBytesToLowercaseHex(fixture.digest),
      ),
      byteLength: BigInt(entryBytes.byteLength),
    });

    await expect(Effect.runPromise(
      validateStandardApplicationTaskRuntimeObject(entryReference, entryBytes),
    )).resolves.toBeUndefined();
    const failure = await Effect.runPromiseExit(
      validateStandardApplicationTaskRuntimeObject(
        entryReference,
        UTF8.encode(JSON.stringify({
          codec: TASK_RUNTIME_ENTRY_CODEC_V1,
          entry: { kind: "wrong" },
        })),
      ),
    );
    expect(Exit.isFailure(failure)).toBe(true);
    if (Exit.isFailure(failure)) {
      expect(Option.getOrThrow(Cause.findErrorOption(failure.cause)))
        .toBeInstanceOf(
        TaskRuntimeLaunchObjectCodecError,
      );
    }
  });
});

function evidenceSource(
  request: Awaited<ReturnType<typeof makeFixture>>["request"],
): TaskRuntimeLaunchLocatedEvidenceSource {
  return {
    scopeId: SCOPE_ID,
    readEvidence: (actual) => {
      expect(actual).toEqual(request);
      return Effect.succeed({
        preparedExecution: "prepared",
        runtimeBinding: "binding",
        runtimeBindingCanonicalBytes: new Uint8Array([1]),
      });
    },
  };
}

function locatedStores(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  scopeId: TaskRuntimeLaunchLocatedStores["scopeId"],
): TaskRuntimeLaunchLocatedStores {
  return {
    scopeId,
    runtimeObjects: {
      read: () => Effect.succeed({
        reference: fixture.runtimeReference,
        bytes: new Uint8Array([1]),
      }),
    },
    runInputs: {
      read: () => Effect.succeed({
        reference: fixture.inputReference,
        canonicalBytes: fixture.inputBytes,
        value: fixture.inputValue,
      }),
    },
  };
}

async function makeFixture() {
  const request = success(decodeTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: SCOPE_ID,
      runId: "run_98000000-0000-4000-8000-000000000003",
      requestedEffectSequence: "1",
      attemptId: "attempt_98000000-0000-4000-8000-000000000004",
      executionFence: "1",
    },
    taskDefinitionRevisionId:
      "taskdef_98000000-0000-4000-8000-000000000005",
    attemptNumber: 1,
    leaseVersion: "1",
    computeProfile: "standard-small",
    cancellation: { kind: "not_requested", generation: "0" },
    maximumDurationMs: 30_000,
  }));
  const canonicalInput = await canonicalizeFlarexValueV1({ order: "A-1" });
  const inputReference = success(makeTaskInputReferenceV1(
    canonicalInput.sha256,
    canonicalInput.canonicalBytes.byteLength,
  ));
  const digest = await Effect.runPromise(
    makeLiveStandardApplicationTaskSha256V1()(
      UTF8.encode("runtime object"),
      { maximumInputBytes: 1_024 },
    ),
  );
  const taskDigest = Brand.nominal<TaskDefinitionSha256V1>()(digest);
  const runtimeReference: TaskRuntimeObjectReferenceV1 = Object.freeze({
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role: "task_runtime_projection",
    objectKey: taskRuntimeObjectKeyV1(
      "task_runtime_projection",
      encodeBytesToLowercaseHex(taskDigest),
    ),
    byteLength: 3n,
    sha256: taskDigest,
  });
  return {
    request,
    inputReference,
    inputBytes: canonicalInput.canonicalBytes,
    inputValue: canonicalInput.value,
    runtimeReference,
    digest: taskDigest,
  };
}

async function expectFailure(
  effect: Effect.Effect<unknown, {
    readonly operation: string;
    readonly reason: string;
    readonly cause?: unknown;
  }>,
  operation: string,
  reason: string,
  cause?: unknown,
) {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
    expect(failure).toMatchObject({ operation, reason });
    if (cause !== undefined) {
      expect(failure).toMatchObject({ cause });
    }
  }
}

function success<Value, Failure>(result: Result.Result<Value, Failure>): Value {
  return Result.getOrThrow(result);
}
