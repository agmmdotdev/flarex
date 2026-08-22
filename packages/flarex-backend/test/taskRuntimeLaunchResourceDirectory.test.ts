import { copyBytes } from "@flarex/utils/bytes";
import {
  TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import { Cause, Effect, Exit, Option, Result, Schema } from "effect";
import { ReplacementScopeIdV1Schema } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  ApplicationAnalysisSourceReadError,
  type ApplicationAnalysisSourceReader,
} from "../src/sourceArtifactV2/ApplicationAnalysisReader.js";
import {
  makeTaskExecutionPrincipalStore,
  type TaskExecutionPrincipalStoreBucket,
} from "../src/taskExecutionPrincipal/TaskExecutionPrincipalStore.js";
import {
  makeTaskInputStore,
  type TaskInputStoreBucket,
} from "../src/taskInput/TaskInputStore.js";
import {
  TaskRuntimeObjectStoreInputError,
  type TaskRuntimeObjectStore,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";
import {
  makeTaskRuntimeLaunchDirectoryFromResources,
  TaskRuntimeLaunchResourceDirectoryConfigurationError,
  type TaskRuntimeLaunchLocatedResources,
  type TaskRuntimeLaunchResourceDirectory,
} from "../src/taskRuntimeLaunch/ResourceDirectory.js";
import type { TaskRuntimeLaunchLocatedSource } from
  "../src/taskRuntimeLaunch/Model.js";

const SCOPE = Result.getOrThrow(Schema.decodeUnknownResult(
  ReplacementScopeIdV1Schema,
)("scope_98000000-0000-4000-8000-000000000001"));

describe("TaskRuntimeLaunchResourceDirectory", () => {
  it("reads cold and repeat immutable resources without introducing a cache", async () => {
    const bucket = new MemoryBucket();
    const inputs = makeTaskInputStore(bucket);
    const inputReference = await Effect.runPromise(inputs.publish({ value: 1 }));
    const principals = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE,
      bucket,
    ));
    const principalReference = await Effect.runPromise(
      principals.issueAuthenticatedUser({
        kind: "user",
        user: {
          tokenIdentifier: "resource-directory-test",
          subject: "user-1",
          issuer: "https://auth.flarex.invalid",
        },
      }),
    );
    const source = new RecordingSourceReader();
    const located = new LocatedResourcesFixture(inputs, principals, source);
    const resources = new RecordingResourceDirectory(located);
    const directory = Result.getOrThrow(
      makeTaskRuntimeLaunchDirectoryFromResources(resources),
    );
    const setupGetCalls = bucket.getCalls;

    const first = await Effect.runPromise(directory.resolve(SCOPE));
    const second = await Effect.runPromise(directory.resolve(SCOPE));
    const firstInput = await Effect.runPromise(first.readInput(inputReference));
    const secondInput = await Effect.runPromise(second.readInput(inputReference));
    const firstPrincipal = await Effect.runPromise(
      requirePrincipalReader(first)(principalReference),
    );
    const secondPrincipal = await Effect.runPromise(
      requirePrincipalReader(second)(principalReference),
    );
    await Effect.runPromise(requireSourceReader(first)("a".repeat(64)));
    await Effect.runPromise(requireSourceReader(second)("a".repeat(64)));
    await Effect.runPromise(first.readEvidence(applicationRequest()));
    await Effect.runPromise(second.readEvidence(applicationRequest()));

    expect(resources.resolveCalls).toBe(2);
    expect(located.evidenceReads).toBe(2);
    expect(source.reads).toBe(2);
    expect(firstInput).toEqual(secondInput);
    expect(firstInput).not.toBe(secondInput);
    expect(firstPrincipal).toEqual(secondPrincipal);
    expect(firstPrincipal).not.toBe(secondPrincipal);
    expect(bucket.getCalls - setupGetCalls).toBe(4);
  });

  it("maps immutable input absence, corruption, and resource failure separately", async () => {
    const bucket = new MemoryBucket();
    const inputs = makeTaskInputStore(bucket);
    const reference = await Effect.runPromise(inputs.publish("input"));
    const principals = Result.getOrThrow(makeTaskExecutionPrincipalStore(
      SCOPE,
      bucket,
    ));
    const directory = Result.getOrThrow(
      makeTaskRuntimeLaunchDirectoryFromResources(
        new RecordingResourceDirectory(new LocatedResourcesFixture(
          inputs,
          principals,
          new RecordingSourceReader(),
        )),
      ),
    );
    const located = await Effect.runPromise(directory.resolve(SCOPE));

    bucket.values.delete(reference.objectKey);
    await expectPortFailure(located.readInput(reference), "not_found");

    bucket.values.set(
      reference.objectKey,
      new Uint8Array(reference.byteLength).fill(0),
    );
    await expectPortFailure(located.readInput(reference), "corrupt");

    bucket.rejectGets = true;
    await expectPortFailure(located.readInput(reference), "resource_failure");
  });

  it("preserves source missing, corruption, and resource classifications", async () => {
    for (const [sourceReason, portReason] of [
      ["notFound", "not_found"],
      ["invalidSourceArtifact", "corrupt"],
      ["sourceReadFailed", "resource_failure"],
      ["internalFailure", "invariant_failure"],
    ] as const) {
      const bucket = new MemoryBucket();
      const inputs = makeTaskInputStore(bucket);
      const principals = Result.getOrThrow(makeTaskExecutionPrincipalStore(
        SCOPE,
        bucket,
      ));
      const source: ApplicationAnalysisSourceReader = Object.freeze({
        read: () => Effect.fail(new ApplicationAnalysisSourceReadError({
          operation: "read",
          reason: sourceReason,
        })),
      });
      const directory = Result.getOrThrow(
        makeTaskRuntimeLaunchDirectoryFromResources(
          new RecordingResourceDirectory(new LocatedResourcesFixture(
            inputs,
            principals,
            source,
          )),
        ),
      );
      const located = await Effect.runPromise(directory.resolve(SCOPE));

      await expectPortFailure(
        requireSourceReader(located)("b".repeat(64)),
        portReason,
      );
    }
  });

  it("captures a throwing directory getter as typed configuration failure", () => {
    const cause = new Error("directory getter failed");
    const result = makeTaskRuntimeLaunchDirectoryFromResources(
      new ThrowingResourceDirectory(cause),
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "TaskRuntimeLaunchResourceDirectoryConfigurationError",
        reason: "invalid_directory",
        cause,
      },
    });
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(
        TaskRuntimeLaunchResourceDirectoryConfigurationError,
      );
    }
  });

  it("classifies malformed located resources as non-retryable configuration", async () => {
    const cause = new Error("runtime store getter failed");
    const directory = Result.getOrThrow(
      makeTaskRuntimeLaunchDirectoryFromResources(
        new RecordingResourceDirectory(new ThrowingLocatedResources(cause)),
      ),
    );

    const exit = await Effect.runPromiseExit(directory.resolve(SCOPE));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
        _tag: "TaskRuntimeLaunchPortError",
        operation: "resolve_source",
        reason: "invalid_configuration",
        cause,
      });
    }
  });
});

class RecordingResourceDirectory implements TaskRuntimeLaunchResourceDirectory {
  resolveCalls = 0;

  constructor(private readonly located: TaskRuntimeLaunchLocatedResources) {}

  resolve(scopeId: typeof SCOPE) {
    this.resolveCalls += 1;
    return scopeId === this.located.scopeId
      ? Effect.succeed(this.located)
      : Effect.die("Unexpected scope.");
  }
}

class ThrowingResourceDirectory implements TaskRuntimeLaunchResourceDirectory {
  constructor(private readonly cause: Error) {}

  get resolve(): TaskRuntimeLaunchResourceDirectory["resolve"] {
    throw this.cause;
  }
}

class ThrowingLocatedResources implements TaskRuntimeLaunchLocatedResources {
  readonly scopeId = SCOPE;

  constructor(private readonly cause: Error) {}

  get runtimeObjects(): TaskRuntimeLaunchLocatedResources["runtimeObjects"] {
    throw this.cause;
  }

  get inputs(): TaskRuntimeLaunchLocatedResources["inputs"] {
    throw new Error("Unreachable input store getter.");
  }

  get applicationSource(): TaskRuntimeLaunchLocatedResources[
    "applicationSource"
  ] {
    throw new Error("Unreachable source reader getter.");
  }

  get principals(): TaskRuntimeLaunchLocatedResources["principals"] {
    throw new Error("Unreachable principal reader getter.");
  }

  readEvidence(
    _request: Parameters<TaskRuntimeLaunchLocatedResources["readEvidence"]>[0],
  ) {
    return Effect.die("Unreachable evidence reader.");
  }
}

class LocatedResourcesFixture implements TaskRuntimeLaunchLocatedResources {
  readonly scopeId = SCOPE;
  readonly runtimeObjects: TaskRuntimeObjectStore = Object.freeze({
    publish: () => Effect.fail(new TaskRuntimeObjectStoreInputError({
      operation: "publish",
      field: "object",
      reason: "invalidInput",
    })),
    read: () => Effect.fail(new TaskRuntimeObjectStoreInputError({
      operation: "read",
      field: "reference",
      reason: "invalidInput",
    })),
  });
  evidenceReads = 0;

  constructor(
    readonly inputs: TaskRuntimeLaunchLocatedResources["inputs"],
    readonly principals: TaskRuntimeLaunchLocatedResources["principals"],
    readonly applicationSource: TaskRuntimeLaunchLocatedResources[
      "applicationSource"
    ],
  ) {}

  readEvidence(
    _request: Parameters<TaskRuntimeLaunchLocatedResources["readEvidence"]>[0],
  ) {
    this.evidenceReads += 1;
    return Effect.succeed(Object.freeze({
      generation: "application_v1" as const,
      preparedExecution: Object.freeze({}),
    }));
  }
}

class RecordingSourceReader implements ApplicationAnalysisSourceReader {
  reads = 0;

  read(rootSha256: string) {
    this.reads += 1;
    return Effect.succeed(Object.freeze({
      sourceArtifact: Object.freeze({
        rootSha256,
        executionModulePath: "functions/task.js",
        schemaModulePath: null,
        modules: Object.freeze([]),
      }),
      modules: Object.freeze([]),
    }));
  }
}

function requireSourceReader(
  located: TaskRuntimeLaunchLocatedSource,
) {
  const read = located.readApplicationSource;
  if (read === undefined) throw new Error("Expected Application source reader.");
  return read;
}

function requirePrincipalReader(
  located: TaskRuntimeLaunchLocatedSource,
) {
  const read = located.readPrincipal;
  if (read === undefined) throw new Error("Expected principal reader.");
  return read;
}

function applicationRequest() {
  return Result.getOrThrow(validateApplicationTaskComputeDispatchRequestV1({
    version: TASK_COMPUTE_DISPATCH_REQUEST_VERSION_V1,
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId: SCOPE,
      runId: "run_98000000-0000-4000-8000-000000000001",
      requestedEffectSequence: 1n,
      attemptId: "attempt_98000000-0000-4000-8000-000000000001",
      executionFence: 1n,
    },
    applicationTaskRuntimeTargetSha256: new Uint8Array(32).fill(7),
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile: "standard-1x",
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs: 30_000,
  }));
}

async function expectPortFailure(
  effect: Effect.Effect<unknown, unknown>,
  reason:
    | "not_found"
    | "corrupt"
    | "invariant_failure"
    | "resource_failure",
): Promise<void> {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: "TaskRuntimeLaunchPortError",
      reason,
    });
  }
}

class MemoryBucket implements TaskInputStoreBucket, TaskExecutionPrincipalStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  getCalls = 0;
  rejectGets = false;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.rejectGets) throw new Error("get unavailable");
    const value = this.values.get(key);
    if (value === undefined) return null;
    const bytes = copyBytes(value);
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(copyBytes(bytes));
          controller.close();
        },
      }),
    };
  }
}
