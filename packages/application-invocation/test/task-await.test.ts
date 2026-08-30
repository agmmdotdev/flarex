import {
  defineModule,
  sourceModule,
  task,
  v,
} from "@flarex/application-definition";
import {
  type StandardApplicationTaskRunCreationReceipt,
  type StandardApplicationTaskSystemApi,
  StandardApplicationTaskSystem,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-system";
import {
  StandardApplicationTaskRunQuery,
  type StandardApplicationTaskRunQueryApi,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-run-query";
import {
  StandardApplicationTaskResultQuery,
  type StandardApplicationTaskResultQueryApi,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-result-query";
import {
  Brand,
  Cause,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  awaitTask,
  startTask,
  type AwaitTaskOptions,
  type TaskAwaitOptionsError,
  type TaskAwaitTimeoutError,
  type TaskRun,
  type TaskRunCancelledError,
  type TaskRunFailedError,
  type TaskRunStatus,
} from "../src/index.js";

const tasksModule = defineModule({
  path: "tasks/awaiting",
  source: sourceModule({
    path: "functions/tasks/awaiting.js",
    bytes: new TextEncoder().encode("export const finish = 1;\n"),
  }),
  functions: {},
});
const finish = Result.getOrThrow(task({
  id: "awaiting.finish",
  handler: { module: tasksModule, exportName: "finish" },
  payload: v.object({ jobId: v.string() }),
  returns: v.object({ finished: v.boolean() }),
  attempts: {
    retry: {
      maxAttempts: 1,
      factor: 1,
      minTimeoutInMs: 0,
      maxTimeoutInMs: 0,
      randomize: false,
    },
    outOfMemory: { kind: "disabled" },
  },
  maximumDurationInSeconds: 30,
  compute: "standard-1x",
  queue: { kind: "default" },
}));

class TestTaskRunQueryError extends Data.TaggedError(
  "TaskSystemRunAttemptUnavailableError",
)<{
  readonly operation: "inspect_current_attempt";
  readonly runId: Parameters<
    StandardApplicationTaskRunQueryApi["inspect"]
  >[0];
  readonly reason: "unavailable";
}> {}

class TestTaskResultQueryError extends Data.TaggedError(
  "TaskRunResultUnavailableError",
)<{
  readonly runId: Parameters<
    StandardApplicationTaskResultQueryApi["read"]
  >[0];
  readonly reason: "run_incomplete";
}> {}

describe("clean Task await primitive", () => {
  it("inspects immediately and reads one validated result on success", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const status = succeededStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(status),
    );
    const expected = Object.freeze({ finished: true });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(expected),
    );

    const result = await Effect.runPromise(awaitTask(run, {
      timeout: 2 ** 31 - 1,
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    ));

    expect(result).toBe(expected);
    expect(inspect).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledWith(run.runId);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(run.runId);
    expectTypeOf(result).toEqualTypeOf<Readonly<{
      readonly finished: boolean;
    }>>();
  });

  it("polls incomplete status only after each configured interval", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const ready = readyStatus(receipt);
    const succeeded = succeededStatus(receipt);
    let inspections = 0;
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(++inspections < 3 ? ready : succeeded),
    );
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(Object.freeze({ finished: true })),
    );

    const result = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* awaitTask(run, {
        timeout: "1 second",
        pollInterval: "10 millis",
      }).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      expect(inspect).toHaveBeenCalledTimes(1);
      yield* TestClock.adjust("9 millis");
      expect(inspect).toHaveBeenCalledTimes(1);
      yield* TestClock.adjust("1 milli");
      expect(inspect).toHaveBeenCalledTimes(2);
      yield* TestClock.adjust("10 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(result).toEqual({ finished: true });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(read).toHaveBeenCalledOnce();
  });

  it("uses the documented 250 millisecond default poll interval", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    let inspections = 0;
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(++inspections === 1
        ? readyStatus(receipt)
        : succeededStatus(receipt)),
    );
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(Object.freeze({ finished: true })),
    );

    const result = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* awaitTask(run, {
        timeout: "1 second",
      }).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("249 millis");
      expect(inspect).toHaveBeenCalledOnce();
      yield* TestClock.adjust("1 milli");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(result).toEqual({ finished: true });
    expect(inspect).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledOnce();
  });

  it("returns the failed terminal projection without reading a result", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const status = failedStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(status),
    );
    const read = forbiddenResultRead();

    const failure = await Effect.runPromise(Effect.flip(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(failure).toMatchObject({
      _tag: "TaskRunFailedError",
      runId: receipt.runId,
      observedAtMs: status.observedAtMs,
      runVersion: status.runVersion,
    });
    if (failure._tag === "TaskRunFailedError") {
      expectTypeOf(failure).toEqualTypeOf<TaskRunFailedError>();
      expect(failure.state).toBe(status.state);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("returns the cancelled terminal projection without reading a result", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const status = cancelledStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(status),
    );
    const read = forbiddenResultRead();

    const failure = await Effect.runPromise(Effect.flip(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(failure).toMatchObject({
      _tag: "TaskRunCancelledError",
      runId: receipt.runId,
      observedAtMs: status.observedAtMs,
      runVersion: status.runVersion,
    });
    if (failure._tag === "TaskRunCancelledError") {
      expectTypeOf(failure).toEqualTypeOf<TaskRunCancelledError>();
      expect(failure.state).toBe(status.state);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("interrupts the wait at its deadline and retains the last status", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const status = readyStatus(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(status),
    );
    const read = forbiddenResultRead();

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.flip(awaitTask(run, {
        timeout: "30 millis",
        pollInterval: "100 millis",
      }).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
      )).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(inspect).toHaveBeenCalledOnce();
      yield* TestClock.adjust("29 millis");
      expect(inspect).toHaveBeenCalledOnce();
      yield* TestClock.adjust("1 milli");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure._tag).toBe("TaskAwaitTimeoutError");
    if (failure._tag === "TaskAwaitTimeoutError") {
      expectTypeOf(failure).toEqualTypeOf<TaskAwaitTimeoutError>();
      expect(failure.runId).toBe(run.runId);
      expect(Duration.toMillis(failure.timeout)).toBe(30);
      expect(failure.lastStatus).toBe(status);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("waits for uninterruptible query cleanup before reporting timeout", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as(readyStatus(receipt)),
        Effect.uninterruptible,
      ),
    );
    const read = forbiddenResultRead();

    const failure = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* Effect.flip(awaitTask(run, {
        timeout: "30 millis",
        pollInterval: "100 millis",
      }).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
      )).pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const timeoutAdvance = yield* TestClock.adjust("30 millis").pipe(
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      expect(fiber.pollUnsafe()).toBeUndefined();
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(timeoutAdvance);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure._tag).toBe("TaskAwaitTimeoutError");
    if (failure._tag === "TaskAwaitTimeoutError") {
      expect(failure.lastStatus).toEqual(readyStatus(receipt));
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves caller interruption instead of returning a typed failure", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(readyStatus(receipt)),
    );
    const read = forbiddenResultRead();

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* awaitTask(run, {
        timeout: "1 second",
        pollInterval: "10 millis",
      }).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
        Effect.forkChild,
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not retry a result-contract failure", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(succeededStatus(receipt)),
    );
    const mismatched = Object.freeze({ finished: "yes" });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.succeed(mismatched),
    );

    const failure = await Effect.runPromise(Effect.flip(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(failure).toMatchObject({
      _tag: "ApplicationResultContractError",
      operation: "task",
    });
    if (
      failure._tag === "ApplicationResultContractError" &&
      failure.operation === "task"
    ) {
      expect(failure.result).toBe(mismatched);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });

  it("preserves a typed status-query failure by identity without retrying", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const expected = new TestTaskRunQueryError({
      operation: "inspect_current_attempt",
      runId: run.runId,
      reason: "unavailable",
    });
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.fail(expected),
    );
    const read = forbiddenResultRead();

    const failure = await Effect.runPromise(Effect.flip(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(failure).toBe(expected);
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("preserves a typed result-query failure by identity without retrying", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.succeed(succeededStatus(receipt)),
    );
    const expected = new TestTaskResultQueryError({
      runId: run.runId,
      reason: "run_incomplete",
    });
    const read = vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
      () => Effect.fail(expected),
    );

    const failure = await Effect.runPromise(Effect.flip(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(failure).toBe(expected);
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
  });

  it("preserves a status-query defect without retrying or reading a result", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const queryDefect = new Error("status query defect");
    const inspect = vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
      () => Effect.die(queryDefect),
    );
    const read = forbiddenResultRead();

    const exit = await Effect.runPromise(Effect.exit(awaitTask(run, {
      timeout: "1 second",
    }).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) expect(defect.success).toBe(queryDefect);
    }
    expect(inspect).toHaveBeenCalledOnce();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invalid wait policy before query I/O", async () => {
    const receipt = makeReceipt();
    const run = await startRun(receipt);
    const inspect = forbiddenStatusInspect();
    const read = forbiddenResultRead();
    const invalidDuration: Duration.DurationObject = Object.defineProperty(
      {},
      "seconds",
      { get: () => { throw new Error("invalid duration"); } },
    );
    const cases: ReadonlyArray<{
      readonly options: AwaitTaskOptions;
      readonly field: TaskAwaitOptionsError["field"];
      readonly reason: TaskAwaitOptionsError["reason"];
    }> = [
      {
        options: { timeout: 0 },
        field: "timeout",
        reason: "not_positive",
      },
      {
        options: { timeout: "1 second", pollInterval: "Infinity" },
        field: "pollInterval",
        reason: "not_finite",
      },
      {
        options: { timeout: invalidDuration },
        field: "timeout",
        reason: "invalid_duration",
      },
      {
        options: { timeout: "1 nano" },
        field: "timeout",
        reason: "outside_timer_range",
      },
      {
        options: { timeout: 2 ** 31 },
        field: "timeout",
        reason: "outside_timer_range",
      },
    ];

    for (const testCase of cases) {
      const failure = await Effect.runPromise(Effect.flip(awaitTask(
        run,
        testCase.options,
      ).pipe(
        Effect.provideService(
          StandardApplicationTaskRunQuery,
          StandardApplicationTaskRunQuery.of({ inspect }),
        ),
        Effect.provideService(
          StandardApplicationTaskResultQuery,
          StandardApplicationTaskResultQuery.of({ read }),
        ),
      )));
      expect(failure).toMatchObject({
        _tag: "TaskAwaitOptionsError",
        field: testCase.field,
        reason: testCase.reason,
      });
      if (failure._tag === "TaskAwaitOptionsError") {
        expectTypeOf(failure).toEqualTypeOf<TaskAwaitOptionsError>();
      }
    }
    expect(inspect).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("defects on a forged handle before reading wait options or services", async () => {
    const forged = Object.freeze({ runId: makeReceipt().runId }) as
      TaskRun<unknown>;
    const timeoutRead = vi.fn<() => Duration.Input>(() => {
      throw new Error("must not read timeout");
    });
    const options: AwaitTaskOptions = {
      get timeout() {
        return timeoutRead();
      },
    };
    const inspect = forbiddenStatusInspect();
    const read = forbiddenResultRead();

    const exit = await Effect.runPromise(Effect.exit(awaitTask(
      forged,
      options,
    ).pipe(
      Effect.provideService(
        StandardApplicationTaskRunQuery,
        StandardApplicationTaskRunQuery.of({ inspect }),
      ),
      Effect.provideService(
        StandardApplicationTaskResultQuery,
        StandardApplicationTaskResultQuery.of({ read }),
      ),
    )));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const defect = Cause.findDefect(exit.cause);
      expect(Result.isSuccess(defect)).toBe(true);
      if (Result.isSuccess(defect)) {
        expect(defect.success).toBeInstanceOf(TypeError);
      }
    }
    expect(timeoutRead).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

async function startRun(
  receipt: StandardApplicationTaskRunCreationReceipt,
): Promise<TaskRun<Readonly<{ readonly finished: boolean }>>> {
  const requestKey = "task-await-request";
  return Effect.runPromise(startTask(
    finish.reference,
    { jobId: "job-await-1" },
    {
      requestKey,
      identity: Object.freeze({
        kind: "user" as const,
        user: Object.freeze({
          tokenIdentifier: "clean-task-await",
          subject: "user-await",
          issuer: "https://system-test.flarex.invalid",
        }),
      }),
    },
  ).pipe(Effect.provideService(
    StandardApplicationTaskSystem,
    StandardApplicationTaskSystem.of({
      createRun: () => Effect.succeed(receipt),
    }),
  )));
}

function readyStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): TaskRunStatus {
  return makeStatus(receipt, Object.freeze({
    kind: "ready" as const,
    eligibleAtMs: receipt.createdAtMs,
    retry: null,
    cancellation: Object.freeze({ kind: "not_requested" as const }),
  }));
}

function succeededStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): TaskRunStatus {
  const attemptNumber = Brand.nominal<Extract<
    TaskRunStatus["state"],
    { readonly kind: "succeeded" }
  >["attemptNumber"]>();
  return makeStatus(receipt, Object.freeze({
    kind: "succeeded" as const,
    completedAtMs: receipt.createdAtMs,
    attemptNumber: attemptNumber(1),
    executionDurationMs: null,
    result: Object.freeze({
      codec: "flarex.task-result.v1" as const,
      byteLength: 1,
      sha256Hex: "00".repeat(32),
    }),
    cancellation: Object.freeze({ kind: "not_requested" as const }),
  }));
}

function failedStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): TaskRunStatus {
  return makeStatus(receipt, Object.freeze({
    kind: "failed" as const,
    completedAtMs: receipt.createdAtMs,
    attemptNumber: null,
    executionDurationMs: null,
    failure: Object.freeze({
      kind: "task_failure" as const,
      code: "uncaught_exception" as const,
    }),
    cancellation: Object.freeze({ kind: "not_requested" as const }),
  }));
}

function cancelledStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
): TaskRunStatus {
  return makeStatus(receipt, Object.freeze({
    kind: "cancelled" as const,
    completedAtMs: receipt.createdAtMs,
    attemptNumber: null,
    executionDurationMs: null,
    cancellation: Object.freeze({
      kind: "resolved" as const,
      code: "requested" as const,
      requestedAtMs: receipt.createdAtMs,
      resolvedAtMs: receipt.createdAtMs,
      resolution: "without_active_attempt" as const,
    }),
  }));
}

function makeStatus(
  receipt: StandardApplicationTaskRunCreationReceipt,
  state: TaskRunStatus["state"],
): TaskRunStatus {
  return Object.freeze({
    runId: receipt.runId,
    createdAtMs: receipt.createdAtMs,
    observedAtMs: receipt.createdAtMs,
    runVersion: Brand.nominal<TaskRunStatus["runVersion"]>()(1n),
    state,
  });
}

function forbiddenStatusInspect(): ReturnType<typeof vi.fn<
  StandardApplicationTaskRunQueryApi["inspect"]
>> {
  return vi.fn<StandardApplicationTaskRunQueryApi["inspect"]>(
    () => Effect.die("must not inspect"),
  );
}

function forbiddenResultRead(): ReturnType<typeof vi.fn<
  StandardApplicationTaskResultQueryApi["read"]
>> {
  return vi.fn<StandardApplicationTaskResultQueryApi["read"]>(
    () => Effect.die("must not read"),
  );
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
    runId: runId("run-clean-task-await-1"),
    applicationTaskRuntimeTargetSha256: runtimeTarget(new Uint8Array(32)),
    createdAtMs: databaseTime(1_000),
    requestKeySha256: requestKeySha256(new Uint8Array(32).fill(1)),
    requestSha256: requestSha256(new Uint8Array(32).fill(2)),
    creationAuthoritySha256: authoritySha256(new Uint8Array(32).fill(3)),
  });
}
