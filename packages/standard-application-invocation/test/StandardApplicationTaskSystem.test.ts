import { copyBytes } from "@flarex/utils/bytes";
import {
  makeTaskInputStore,
  TaskInputStoreInputError,
  type TaskInputStoreBucket,
} from "flarex-backend/internal/task-input-store";
import { Brand, Effect, Layer, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  defineStandardApplicationTaskV1,
  type StandardApplicationTaskReferenceV1,
} from "@flarex/standard-application-definition/internal/task-authoring-v1";
import { standardV1 } from "@flarex/standard-application-definition/v1";
import {
  ApplicationTaskSystem,
  ApplicationTaskSystemCompositionError,
  type ApplicationTaskRunRequest,
  type ApplicationTaskSystemApi,
} from "../src/ApplicationTaskSystem.js";
import {
  createStandardApplicationTaskRun,
  makeStandardApplicationTaskSystemLayer,
  type StandardApplicationTaskRunCreationReceipt,
} from "../src/StandardApplicationTaskSystem.js";

type CreateRun = ApplicationTaskSystemApi["createRun"];

describe("Standard Application Task System", () => {
  it("publishes the typed payload before exact ApplicationTaskSystem delegation", async () => {
    const bucket = new MemoryBucket();
    const inputStore = makeTaskInputStore(bucket);
    const receipt = makeReceipt();
    const createRun = vi.fn<CreateRun>(() => Effect.succeed(receipt));
    const reference = taskReference();
    const request = runRequest({ recipeId: "recipe-1", servings: 4 });

    const result = await Effect.runPromise(
      createStandardApplicationTaskRun(reference, request).pipe(
        Effect.provide(makeLayer(inputStore, createRun)),
      ),
    );

    expectTypeOf(result).toEqualTypeOf<
      StandardApplicationTaskRunCreationReceipt
    >();
    expect(result).toBe(receipt);
    expect(bucket.putCalls).toBe(1);
    expect(createRun).toHaveBeenCalledOnce();
    const [observedTaskId, observedRequest] = createRun.mock.calls[0]!;
    expect(observedTaskId).toBe(reference.taskId);
    expect(observedRequest).toMatchObject({
      version: 1,
      requestKey: request.requestKey,
      executionIdentity: request.executionIdentity,
      input: {
        codec: "flarex.task-input-reference.v1",
        store: "flarex.task-input-object-store.v1",
        valueCodec: "flarex-value/v1",
        retention: { kind: "run_lifetime" },
      },
    });
    expect("payload" in observedRequest).toBe(false);
    expect(Object.isFrozen(observedRequest)).toBe(true);
    const stored = await Effect.runPromise(inputStore.read(observedRequest.input));
    expect(stored.value).toEqual(request.payload);
  });

  it("preserves exact replay ownership in ApplicationTaskSystem", async () => {
    const bucket = new MemoryBucket();
    const inputStore = makeTaskInputStore(bucket);
    const receipt = makeReceipt();
    const createRun = vi.fn<CreateRun>(() => Effect.succeed(receipt));
    const reference = taskReference();
    const request = runRequest({ recipeId: "recipe-1", servings: 4 });
    const layer = makeLayer(inputStore, createRun);

    const first = await Effect.runPromise(
      createStandardApplicationTaskRun(reference, request).pipe(
        Effect.provide(layer),
      ),
    );
    const replay = await Effect.runPromise(
      createStandardApplicationTaskRun(reference, request).pipe(
        Effect.provide(layer),
      ),
    );

    expect(first).toBe(receipt);
    expect(replay).toBe(receipt);
    expect(createRun).toHaveBeenCalledTimes(2);
    expect(bucket.values.size).toBe(1);
  });

  it("short-circuits on Task input failure and preserves the exact error", async () => {
    const failure = new TaskInputStoreInputError({
      operation: "publish",
      reason: "invalidValue",
    });
    const createRun = vi.fn<CreateRun>(() => Effect.die("must not delegate"));
    const inputStore = {
      publish: () => Effect.fail(failure),
    };

    const observed = await Effect.runPromise(Effect.flip(
      createStandardApplicationTaskRun(
        taskReference(),
        runRequest({ recipeId: "recipe-1", servings: Number.NaN }),
      ).pipe(Effect.provide(makeLayer(inputStore, createRun))),
    ));

    expect(observed).toBe(failure);
    expect(createRun).not.toHaveBeenCalled();
  });

  it("preserves ApplicationTaskSystem typed failures without wrapping", async () => {
    const failure = new ApplicationTaskSystemCompositionError({
      reason: "principalScopeMismatch",
    });
    const createRun = vi.fn<CreateRun>(() => Effect.fail(failure));

    const observed = await Effect.runPromise(Effect.flip(
      createStandardApplicationTaskRun(
        taskReference(),
        runRequest({ recipeId: "recipe-1", servings: 4 }),
      ).pipe(Effect.provide(makeLayer(
        makeTaskInputStore(new MemoryBucket()),
        createRun,
      ))),
    ));

    expect(observed).toBe(failure);
  });
});

function taskReference(): StandardApplicationTaskReferenceV1<
  Readonly<{ readonly recipeId: string; readonly servings: number }>,
  Readonly<{ readonly prepared: boolean }>
> {
  return Result.getOrThrow(defineStandardApplicationTaskV1({
    taskId: "cooking.prepareRecipe",
    handler: {
      logicalModulePath: "tasks/cooking",
      artifactModulePath: "tasks/cooking.js",
      exportName: "prepareRecipe",
    },
    payload: standardV1.object({
      recipeId: standardV1.string(),
      servings: standardV1.number(),
    }),
    output: standardV1.object({ prepared: standardV1.boolean() }),
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  })).reference;
}

function runRequest(
  payload: Readonly<{ readonly recipeId: string; readonly servings: number }>,
) {
  const requestKey = Brand.nominal<ApplicationTaskRunRequest["requestKey"]>();
  return Object.freeze({
    version: 1 as const,
    requestKey: requestKey("standard-task-request-1"),
    payload,
    executionIdentity: Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "standard-task-test",
        subject: "user-1",
        issuer: "https://system-test.flarex.invalid",
      }),
    }),
  });
}

function makeReceipt(): StandardApplicationTaskRunCreationReceipt {
  const runId = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["runId"]
  >();
  const runtimeTarget = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt[
      "applicationTaskRuntimeTargetSha256"
    ]
  >();
  const databaseTime = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["createdAtMs"]
  >();
  const requestKeySha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["requestKeySha256"]
  >();
  const requestSha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["requestSha256"]
  >();
  const authoritySha256 = Brand.nominal<
    StandardApplicationTaskRunCreationReceipt["creationAuthoritySha256"]
  >();
  return Object.freeze({
    status: "created",
    version: 1,
    runId: runId("run-standard-task-1"),
    applicationTaskRuntimeTargetSha256: runtimeTarget(new Uint8Array(32)),
    createdAtMs: databaseTime(1_000),
    requestKeySha256: requestKeySha256(new Uint8Array(32).fill(1)),
    requestSha256: requestSha256(new Uint8Array(32).fill(2)),
    creationAuthoritySha256: authoritySha256(new Uint8Array(32).fill(3)),
  });
}

function makeLayer(
  inputStore: Parameters<typeof makeStandardApplicationTaskSystemLayer>[0],
  createRun: CreateRun,
) {
  return makeStandardApplicationTaskSystemLayer(inputStore).pipe(
    Layer.provide(Layer.succeed(
      ApplicationTaskSystem,
      ApplicationTaskSystem.of({ createRun }),
    )),
  );
}

class MemoryBucket implements TaskInputStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    return {};
  }

  async get(key: string): Promise<unknown> {
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
