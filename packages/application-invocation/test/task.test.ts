import {
  defineModule,
  sourceModule,
  task,
  type TaskReference,
  v,
} from "@flarex/application-definition";
import { inspectTaskRun } from
  "@flarex/application-invocation/internal/task-run";
import { inspectTaskReference } from
  "@flarex/application-definition/internal/task-definition";
import {
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskSystemApi,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
  type StandardApplicationTaskRunStatus,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import {
  makeStandardApplicationTaskResultQueryLayer,
  readStandardApplicationTaskResult,
  StandardApplicationTaskResultQuery,
  type StandardApplicationTaskResultQueryApi,
  type StandardApplicationTaskResultQueryLive,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-result-query";
import { Brand, Cause, Effect, Exit, Result } from "effect";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  inspectTask,
  readTaskResult,
  startTask,
  type ApplicationRequestKeyError,
  type ApplicationTaskResultContractError,
  type StartTaskError,
  type TaskRun,
  type TaskRunStatus,
} from "../src/index.js";

const tasksModule = defineModule({
  path: "tasks/cooking",
  source: sourceModule({
    path: "functions/tasks/cooking.js",
    bytes: new TextEncoder().encode("export const prepare = 1;\n"),
  }),
  functions: {},
});
const prepare = Result.getOrThrow(task({
  id: "cooking.prepare",
  handler: { module: tasksModule, exportName: "prepare" },
  payload: v.object({ recipeId: v.string(), servings: v.number() }),
  returns: v.object({ prepared: v.boolean() }),
  attempts: {
    retry: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      randomize: true,
    },
    outOfMemory: { kind: "disabled" },
  },
  maximumDurationInSeconds: 30,
  compute: "standard-1x",
  queue: { kind: "default" },
}));
const prepareWithoutOutputContract = Result.getOrThrow(task({
  id: "cooking.prepare.untyped",
  handler: { module: tasksModule, exportName: "prepare" },
  payload: v.object({ recipeId: v.string(), servings: v.number() }),
  returns: null,
  attempts: {
    retry: {
      maxAttempts: 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      randomize: true,
    },
    outOfMemory: { kind: "disabled" },
  },
  maximumDurationInSeconds: 30,
  compute: "standard-1x",
  queue: { kind: "default" },
}));

describe("clean Task invocation primitive", () => {
  it("admits a typed payload through the existing Task System", async () => {
    expectTypeOf<Extract<
      StartTaskError,
      { readonly _tag: "ApplicationRequestKeyError" }
    >>().toEqualTypeOf<ApplicationRequestKeyError<"startTask">>();
    const receipt = makeReceipt();
    const createRun = vi.fn<StandardApplicationTaskSystemApi["createRun"]>(
      () => Effect.succeed(receipt),
    );
    const system = StandardApplicationTaskSystem.of({ createRun });
    const requestKey = "task-request-1";
    const identity = Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "clean-task-test",
        subject: "user-1",
        issuer: "https://system-test.flarex.invalid",
      }),
    });

    const run = await Effect.runPromise(startTask(
      prepare.reference,
      { recipeId: "recipe-1", servings: 4 },
      { requestKey, identity },
    ).pipe(Effect.provideService(StandardApplicationTaskSystem, system)));

    expect(run).toEqual({ runId: receipt.runId });
    expect(Object.isFrozen(run)).toBe(true);
    expect(inspectTaskRun(run).receipt).toBe(receipt);
    expect(inspectTaskRun(run).standardReference).toBe(
      inspectTaskReference(prepare.reference).standard,
    );
    expect(Object.isFrozen(inspectTaskRun(run))).toBe(true);
    expect(createRun).toHaveBeenCalledWith(
      expect.any(Object),
      {
        version: 1,
        requestKey,
        payload: { recipeId: "recipe-1", servings: 4 },
        executionIdentity: identity,
      },
    );
    expectTypeOf(run).toEqualTypeOf<TaskRun<
      Readonly<{ readonly prepared: boolean }>
    >>();
  });

  it("rejects a forged run at the private metadata bridge", () => {
    const forged = Object.freeze({
      runId: makeReceipt().runId,
    }) as TaskRun<unknown>;

    expect(() => inspectTaskRun(forged)).toThrow(
      "Task run metadata is unavailable.",
    );
  });

  it("rejects an invalid plain request key before Task admission", async () => {
    const createRun = vi.fn<StandardApplicationTaskSystemApi["createRun"]>(
      () => Effect.die("Task admission must not run"),
    );
    const identity = Object.freeze({
      kind: "user" as const,
      user: Object.freeze({
        tokenIdentifier: "clean-task-invalid-key",
        subject: "user-invalid-key",
        issuer: "https://system-test.flarex.invalid",
      }),
    });

    const durableTaskOversizedRequestKey = "x".repeat(256);
    const failure = await Effect.runPromise(Effect.flip(startTask(
      prepare.reference,
      { recipeId: "recipe-invalid-key", servings: 1 },
      { requestKey: durableTaskOversizedRequestKey, identity },
    ).pipe(Effect.provideService(
      StandardApplicationTaskSystem,
      StandardApplicationTaskSystem.of({ createRun }),
    ))));

    expect(failure).toMatchObject({
      _tag: "ApplicationRequestKeyError",
      operation: "startTask",
      field: "requestKey",
      reason: "invalidRequestKey",
    });
    expect(createRun).not.toHaveBeenCalled();
  });

  it("reads a genuine run through the authoritative Task query service", async () => {
    const receipt = makeReceipt();
    const createRun = vi.fn<StandardApplicationTaskSystemApi["createRun"]>(
      () => Effect.succeed(receipt),
    );
    const system = StandardApplicationTaskSystem.of({ createRun });
    const run = await startRun(system);
    const expected = makeStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(expected),
    );
    const status = await Effect.runPromise(inspectTask(run).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
    ));

    expect(status).toBe(expected);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(receipt.runId);
    expectTypeOf(status).toEqualTypeOf<TaskRunStatus>();
  });

  it("defects on a forged handle before query I/O", async () => {
    const receipt = makeReceipt();
    const forged = Object.freeze({ runId: receipt.runId }) as TaskRun<unknown>;
    const forbiddenInspect = vi.fn<
      StandardApplicationTaskRunQueryApi["inspect"]
    >(
      () => Effect.succeed(makeStatus(receipt)),
    );
    const forgedExit = await Effect.runPromise(Effect.exit(inspectTask(forged)
      .pipe(Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect: forbiddenInspect }),
      ))));
    expect(Exit.isFailure(forgedExit)).toBe(true);
    if (Exit.isFailure(forgedExit)) {
      const defect = Cause.findDefect(forgedExit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBeInstanceOf(TypeError);
        if (defect.success instanceof TypeError) {
          expect(defect.success.message).toBe(
            "Task run metadata is unavailable.",
          );
        }
      }
    }
    expect(forbiddenInspect).not.toHaveBeenCalled();
  });

  it("reads and binds a canonical result through the genuine run handle", async () => {
    const run = await startRun(StandardApplicationTaskSystem.of({
      createRun: () => Effect.succeed(makeReceipt()),
    }));
    const expected = Object.freeze({ prepared: true });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(expected),
    );

    const result = await Effect.runPromise(readTaskResult(run).pipe(
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    ));

    expect(result).toBe(expected);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(run.runId);
    expectTypeOf(result).toEqualTypeOf<Readonly<{
      readonly prepared: boolean;
    }>>();
  });

  it("preserves an unavailable result failure without retrying", async () => {
    const receipt = makeReceipt();
    const run = await startRun(StandardApplicationTaskSystem.of({
      createRun: () => Effect.succeed(receipt),
    }));
    const inspectRunAttempt = vi.fn<
      StandardApplicationTaskResultQueryLive["runAttemptStore"][
        "inspectRunAttempt"
      ]
    >(() => Effect.succeed(makeReadyRunAttemptSnapshot(receipt)));
    const forbiddenResultRead = vi.fn<
      StandardApplicationTaskResultQueryLive["resultStore"]["read"]
    >(() => Effect.die("must not read an unavailable result"));
    const upstreamFailure = await Effect.runPromise(Effect.flip(
      readStandardApplicationTaskResult(run.runId).pipe(Effect.provide(
        makeStandardApplicationTaskResultQueryLayer({
          runAttemptStore: { inspectRunAttempt },
          resultStore: { read: forbiddenResultRead },
        }),
      )),
    ));
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.fail(upstreamFailure),
    );

    const failure = await Effect.runPromise(Effect.flip(
      readTaskResult(run).pipe(Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      )),
    ));

    expect(upstreamFailure._tag).toBe("TaskRunResultUnavailableError");
    expect(failure).toBe(upstreamFailure);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(run.runId);
    expect(inspectRunAttempt).toHaveBeenCalledOnce();
    expect(forbiddenResultRead).not.toHaveBeenCalled();
  });

  it("retains the authoritative body in a typed Task contract mismatch", async () => {
    const run = await startRun(StandardApplicationTaskSystem.of({
      createRun: () => Effect.succeed(makeReceipt()),
    }));
    const mismatched = Object.freeze({ prepared: "yes" });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(mismatched),
    );

    const failure = await Effect.runPromise(Effect.flip(
      readTaskResult(run).pipe(Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      )),
    ));

    expect(failure).toMatchObject({
      _tag: "ApplicationResultContractError",
      operation: "task",
    });
    if (
      failure._tag === "ApplicationResultContractError" &&
      failure.operation === "task"
    ) {
      expectTypeOf(failure).toEqualTypeOf<
        ApplicationTaskResultContractError
      >();
      expect(failure.result).toBe(mismatched);
      expect(failure.cause.issue.path).toBe("$result.prepared");
    }
    expect(read).toHaveBeenCalledOnce();
  });

  it("returns an unclaimed result as unknown when no output contract exists", async () => {
    const run = await startUntypedRun(StandardApplicationTaskSystem.of({
      createRun: () => Effect.succeed(makeReceipt()),
    }));
    const expected = Object.freeze({ anyCanonicalValue: 42 });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(expected),
    );

    const result = await Effect.runPromise(readTaskResult(run).pipe(
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    ));

    expect(result).toBe(expected);
    expectTypeOf(result).toEqualTypeOf<unknown>();
    expect(read).toHaveBeenCalledOnce();
  });

  it("defects on a forged handle before result I/O", async () => {
    const forged = Object.freeze({ runId: makeReceipt().runId }) as
      TaskRun<unknown>;
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.die("must not read"),
    );

    const exit = await Effect.runPromise(Effect.exit(readTaskResult(forged)
      .pipe(Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ))));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBeInstanceOf(TypeError);
      }
    }
    expect(read).not.toHaveBeenCalled();
  });
});

async function startRun(
  system: StandardApplicationTaskSystemApi,
): Promise<TaskRun<Readonly<{ readonly prepared: boolean }>>> {
  const requestKey = "task-inspection-request";
  return Effect.runPromise(startTask(
    prepare.reference,
    { recipeId: "recipe-inspection", servings: 2 },
    {
      requestKey,
      identity: Object.freeze({
        kind: "user" as const,
        user: Object.freeze({
          tokenIdentifier: "clean-task-inspection",
          subject: "user-inspection",
          issuer: "https://system-test.flarex.invalid",
        }),
      }),
    },
  ).pipe(Effect.provideService(StandardApplicationTaskSystem,
    StandardApplicationTaskSystem.of(system))));
}

async function startUntypedRun(
  system: StandardApplicationTaskSystemApi,
): Promise<TaskRun<unknown>> {
  const requestKey = "task-untyped-result-request";
  return Effect.runPromise(startTask(
    prepareWithoutOutputContract.reference,
    { recipeId: "recipe-untyped", servings: 1 },
    {
      requestKey,
      identity: Object.freeze({
        kind: "user" as const,
        user: Object.freeze({
          tokenIdentifier: "clean-task-untyped-result",
          subject: "user-untyped",
          issuer: "https://system-test.flarex.invalid",
        }),
      }),
    },
  ).pipe(Effect.provideService(StandardApplicationTaskSystem,
    StandardApplicationTaskSystem.of(system))));
}

function makeStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): StandardApplicationTaskRunStatus {
  const runVersion = Brand.nominal<
    StandardApplicationTaskRunStatus["runVersion"]
  >();
  return Object.freeze({
    runId: receipt.runId,
    createdAtMs: receipt.createdAtMs,
    observedAtMs: receipt.createdAtMs,
    runVersion: runVersion(1n),
    state: Object.freeze({
      kind: "ready" as const,
      eligibleAtMs: receipt.createdAtMs,
      retry: null,
      cancellation: Object.freeze({ kind: "not_requested" as const }),
    }),
  });
}

type RunAttemptSnapshot = Effect.Success<ReturnType<
  StandardApplicationTaskResultQueryLive["runAttemptStore"][
    "inspectRunAttempt"
  ]
>>;
type ApplicationRunAggregate = NonNullable<RunAttemptSnapshot["current"]>;

function makeReadyRunAttemptSnapshot(
  receipt: StandardApplicationTaskRunCreationReceipt,
): RunAttemptSnapshot {
  const duration = Brand.nominal<
    ApplicationRunAggregate["boundPolicy"]["maximumDurationMs"]
  >();
  const current = {
    version: "flarex.task-run-attempt-aggregate.v1" as const,
    runId: receipt.runId,
    applicationTaskRuntimeTargetSha256:
      receipt.applicationTaskRuntimeTargetSha256,
    createdAtMs: receipt.createdAtMs,
    runVersion: Brand.nominal<ApplicationRunAggregate["runVersion"]>()(1n),
    boundPolicy: {
      runAttempt: {
        version: 1 as const,
        retry: {
          maxAttempts: Brand.nominal<
            ApplicationRunAggregate["boundPolicy"]["runAttempt"]["retry"][
              "maxAttempts"
            ]
          >()(1),
          factor: Brand.nominal<
            ApplicationRunAggregate["boundPolicy"]["runAttempt"]["retry"][
              "factor"
            ]
          >()(1),
          minTimeoutInMs: duration(0),
          maxTimeoutInMs: duration(0),
          randomize: false,
        },
        outOfMemory: { kind: "disabled" as const },
      },
      maximumDurationMs: duration(1_000),
      initialComputeProfile: Brand.nominal<
        ApplicationRunAggregate["boundPolicy"]["initialComputeProfile"]
      >()("standard-1x"),
      leaseDurationMs: duration(1_000),
      immediateRetryThresholdMs: duration(1),
    },
    attemptHistory: { kind: "none" as const },
    leaseHistory: { kind: "none" as const },
    lastLifecycleAcceptance: null,
    completionReplays: Object.freeze([]),
    requestedEffectCursor: { kind: "none" as const },
    phase: "ready" as const,
    ready: { kind: "initial" as const, eligibleAtMs: receipt.createdAtMs },
    cancellation: {
      kind: "not_requested" as const,
      generation: Brand.nominal<
        Extract<ApplicationRunAggregate, { readonly phase: "ready" }>[
          "cancellation"
        ]["generation"]
      >()(0n),
    },
  } satisfies ApplicationRunAggregate;
  return Object.freeze({ observedAtMs: receipt.createdAtMs, current });
}

function makeReceipt(): StandardApplicationTaskRunCreationReceipt {
  const runId = Brand.nominal<StandardApplicationTaskRunCreationReceipt["runId"]>();
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
    runId: runId("run-clean-task-1"),
    applicationTaskRuntimeTargetSha256: runtimeTarget(new Uint8Array(32)),
    createdAtMs: databaseTime(1_000),
    requestKeySha256: requestKeySha256(new Uint8Array(32).fill(1)),
    requestSha256: requestSha256(new Uint8Array(32).fill(2)),
    creationAuthoritySha256: authoritySha256(new Uint8Array(32).fill(3)),
  });
}

function compileTimeContractChecks(): void {
  // @ts-expect-error Task payload references are invariant and cannot be widened.
  const widened: TaskReference<
    Readonly<{ readonly recipeId: string }>,
    Readonly<{ readonly prepared: boolean }>
  > = prepare.reference;
  void widened;
}

void compileTimeContractChecks;
