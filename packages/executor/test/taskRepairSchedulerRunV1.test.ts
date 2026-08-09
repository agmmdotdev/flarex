import { Cause, Data, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { replacementScopeIdV1FromUuid } from
  "flarex-protocol/storage-authority";
import { describe, expect, expectTypeOf, it } from "vitest";

import * as executorRoot from "../src";
import {
  type EncodedTaskRepairSweepContinuationV1,
  encodeTaskRepairSweepContinuationV1,
} from "../src/taskRepairSweepContinuationCodecV1";
import {
  type TaskRepairSweepContinuationV1,
  type TaskRepairSweepReceiptV1,
  type TaskRepairSweepV1,
} from "../src/taskRepairSweepV1";
import {
  type TaskRepairSchedulerCheckpointPortV1,
  TaskRepairSchedulerRunTimeBudgetV1Error,
  createTaskRepairSchedulerRunV1,
} from "../src/taskRepairSchedulerRunV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

class TestConfigurationError extends Data.TaggedError(
  "TestConfigurationError",
)<{ readonly reason: "invalid" }> {}

class TestOperationError extends Data.TaggedError("TestOperationError")<{
  readonly operation: "acquire" | "checkpoint" | "release" | "sweep";
  readonly reason: "rollback" | "uncertain" | "failed";
}> {}

class TestConfirmedRollback extends Data.TaggedError(
  "TestConfirmedRollback",
)<{ readonly operation: "acquire" | "checkpoint" | "release" }> {}

type TestError = TestOperationError | TestConfirmedRollback;
type TestRun = Readonly<{ readonly id: "run" }>;

const RUN = Object.freeze({ id: "run" as const });
const NOW = new Date("2026-08-09T00:00:00.000Z");
const LATER = new Date("2026-08-09T00:01:00.000Z");
const CONTINUATION = Object.freeze({
  version: "flarex.task-repair-sweep-continuation.v1" as const,
  directory: Object.freeze({ kind: "unstarted" as const }),
  partition: null,
}) satisfies TaskRepairSweepContinuationV1;

describe("DTE05-E2C1 connected Task repair scheduler runner", () => {
  it("stays private and rejects claim/sweep timing without acquiring", () => {
    type RootLeak = Extract<
      keyof typeof executorRoot,
      "createTaskRepairSchedulerRunV1" | "TaskRepairSchedulerCheckpointPortV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createTaskRepairSchedulerRunV1" in executorRoot).toBe(false);

    const checkpoint = fixture({ claimDurationMilliseconds: 100 });
    const constructed = createTaskRepairSchedulerRunV1(
      checkpoint.port,
      sweep(() => Effect.succeed(receipt(null)), {
        maximumRunMilliseconds: 90,
        settlementReserveMilliseconds: 11,
      }),
    );
    expect(Result.isFailure(constructed)).toBe(true);
    expect(checkpoint.events).toEqual([]);
  });

  it("decodes the stored cursor, checkpoints its exact successor, then releases", async () => {
    const persisted = await runEffect(
      encodeTaskRepairSweepContinuationV1(CONTINUATION),
    );
    const successor = Object.freeze({
      ...CONTINUATION,
      directory: Object.freeze({
        kind: "continuing" as const,
        continuation: Object.freeze({
          codecVersion: 1 as const,
          highWaterScopeId: replacementScopeIdV1FromUuid(
            "92000000-0000-0000-0000-000000000002",
          ),
          lastScopeId: replacementScopeIdV1FromUuid(
            "92000000-0000-0000-0000-000000000001",
          ),
        }),
      }),
    }) satisfies TaskRepairSweepContinuationV1;
    let observed: TaskRepairSweepContinuationV1 | null | undefined;
    const checkpoint = fixture({ persistedContinuation: persisted });
    const runner = makeRunner(checkpoint, sweep(function (
      this: Readonly<{ marker: string }>,
      input,
    ) {
      expect(this.marker).toBe("sweep-owner");
      observed = input;
      return Effect.succeed(receipt(successor));
    }));

    const result = await runEffect(runner.runEffect());
    expect(observed).toEqual(CONTINUATION);
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "release",
    ]);
    expect(result).toMatchObject({
      kind: "completed",
      reason: "sweep_completed",
      sweep: { continuation: successor },
    });
    expect(checkpoint.checkpointInputs).toHaveLength(1);
    expect(checkpoint.checkpointInputs[0]).toEqual(
      await runEffect(encodeTaskRepairSweepContinuationV1(successor)),
    );
  });

  it("persists exhausted null before release", async () => {
    const checkpoint = fixture();
    const result = await runEffect(
      makeRunner(checkpoint, sweep(() => Effect.succeed(receipt(null))))
        .runEffect(),
    );
    expect(result).toMatchObject({
      kind: "completed",
      reason: "sweep_completed",
      sweep: { continuation: null },
    });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:null",
      "release",
    ]);
    expect(checkpoint.checkpointInputs).toEqual([null]);
  });

  it("admits the sweep only after stored-continuation preparation", async () => {
    const encoded = await runEffect(
      encodeTaskRepairSweepContinuationV1(CONTINUATION),
    );
    const delayed = { ...encoded };
    Object.defineProperty(delayed, "canonicalBytes", {
      enumerable: true,
      get() {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          25,
        );
        return encoded.canonicalBytes;
      },
    });
    let sweeps = 0;
    const checkpoint = fixture({
      claimDurationMilliseconds: 30,
      persistedContinuation: delayed,
    });
    const result = await runEffect(makeRunner(
      checkpoint,
      sweep(() => {
        sweeps += 1;
        return Effect.succeed(receipt(null));
      }, {
        maximumRunMilliseconds: 10,
        settlementReserveMilliseconds: 10,
      }),
    ).runEffect());
    expect(result).toMatchObject({
      kind: "completed",
      reason: "no_time_to_start",
      sweep: null,
    });
    expect(sweeps).toBe(0);
    expect(checkpoint.events).toEqual(["acquire", "release"]);
  });

  it("does not dispatch a checkpoint after encoding consumes its reserve", async () => {
    const delayed = { ...CONTINUATION };
    Object.defineProperty(delayed, "directory", {
      enumerable: true,
      get() {
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          40,
        );
        return CONTINUATION.directory;
      },
    });
    const checkpoint = fixture({ claimDurationMilliseconds: 55 });
    const failure = await runEffectFailure(makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(receipt(delayed)), {
        maximumRunMilliseconds: 10,
        settlementReserveMilliseconds: 20,
      }),
    ).runEffect());
    expect(failure).toBeInstanceOf(TaskRepairSchedulerRunTimeBudgetV1Error);
    expect(checkpoint.events).toEqual(["acquire", "release"]);
  });

  it("preserves classifier receivers across checkpoint and release retries", async () => {
    const checkpoint = fixture({
      checkpointSteps: [
        Effect.fail(new TestConfirmedRollback({ operation: "checkpoint" })),
        Effect.succeed(Object.freeze({
          kind: "checkpointed" as const,
          checkpointSequence: 1n,
        })),
      ],
      releaseSteps: [
        Effect.fail(new TestConfirmedRollback({ operation: "release" })),
        Effect.succeed(Object.freeze({
          kind: "released" as const,
          nextRunAt: NOW,
        })),
      ],
    });
    await expect(runEffect(makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(receipt(null))),
    ).runEffect())).resolves.toMatchObject({ kind: "completed" });
    expect(checkpoint.events).toEqual([
      "acquire",
      "checkpoint:null",
      "checkpoint:null",
      "release",
      "release",
    ]);
  });

  it("releases a known claim when decoding or sweep execution fails", async () => {
    const corrupt = Object.freeze({
      codecVersion: 1 as const,
      canonicalBytes: new Uint8Array([0]),
      sha256: new Uint8Array(32),
    });
    const decodeCheckpoint = fixture({ persistedContinuation: corrupt });
    await runEffectFailure(
      makeRunner(
        decodeCheckpoint,
        sweep(() => Effect.die("must not sweep")),
      ).runEffect(),
    );
    expect(decodeCheckpoint.events).toEqual(["acquire", "release"]);

    const sweepCheckpoint = fixture();
    const failure = new TestOperationError({
      operation: "sweep",
      reason: "failed",
    });
    expect(await runEffectFailure(makeRunner(
      sweepCheckpoint,
      sweep(() => Effect.fail(failure)),
    ).runEffect())).toBe(failure);
    expect(sweepCheckpoint.events).toEqual(["acquire", "release"]);
  });

  it("retries only a confirmed direct rollback and never guesses after checkpoint uncertainty", async () => {
    const rollback = new TestConfirmedRollback({ operation: "acquire" });
    const checkpoint = fixture({
      acquireSteps: [
        Effect.fail(rollback),
        Effect.succeed(acquired(null)),
      ],
      checkpointSteps: [Effect.fail(new TestOperationError({
        operation: "checkpoint",
        reason: "uncertain",
      }))],
    });
    const failure = await runEffectFailure(makeRunner(
      checkpoint,
      sweep(() => Effect.succeed(receipt(CONTINUATION))),
    ).runEffect());
    expect(failure).toMatchObject({
      operation: "checkpoint",
      reason: "uncertain",
    });
    expect(checkpoint.events).toEqual([
      "acquire",
      "acquire",
      "checkpoint:evidence",
    ]);
  });

  it("leaves expiry takeover as the only recovery after checkpoint dispatch is interrupted", async () => {
    const dispatched = await runEffect(Deferred.make<void>());
    const checkpoint = fixture({
      checkpointSteps: [Deferred.succeed(dispatched, undefined).pipe(
        Effect.andThen(Effect.never),
      )],
    });
    const exit = await runEffect(Effect.gen(function* () {
      const fiber = yield* makeRunner(
        checkpoint,
        sweep(() => Effect.succeed(receipt(CONTINUATION))),
      ).runEffect().pipe(Effect.forkChild);
      yield* Deferred.await(dispatched);
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    }
    expect(checkpoint.events).toEqual(["acquire", "checkpoint:evidence"]);
  });
});

function makeRunner(
  checkpoint: ReturnType<typeof fixture>,
  taskSweep: TaskRepairSweepV1<TestOperationError>,
) {
  return Result.getOrThrow(createTaskRepairSchedulerRunV1(
    checkpoint.port,
    taskSweep,
  ));
}

function fixture(options: Readonly<{
  claimDurationMilliseconds?: number;
  persistedContinuation?: EncodedTaskRepairSweepContinuationV1;
  acquireSteps?: Array<Effect.Effect<ReturnType<typeof acquired>, TestError>>;
  checkpointSteps?: Array<Effect.Effect<
    Readonly<{ readonly kind: "checkpointed"; readonly checkpointSequence: bigint }>,
    TestError
  >>;
  releaseSteps?: Array<Effect.Effect<
    Readonly<{ readonly kind: "released"; readonly nextRunAt: Date }>,
    TestError
  >>;
}> = {}) {
  const events: string[] = [];
  const checkpointInputs: Array<unknown> = [];
  const acquireSteps = [...(options.acquireSteps ?? [
    Effect.succeed(acquired(options.persistedContinuation ?? null)),
  ])];
  const checkpointSteps = [...(options.checkpointSteps ?? [Effect.succeed(
    Object.freeze({ kind: "checkpointed" as const, checkpointSequence: 1n }),
  )])];
  const releaseSteps = [...(options.releaseSteps ?? [Effect.succeed(
    Object.freeze({ kind: "released" as const, nextRunAt: NOW }),
  )])];

  const owner = {
    marker: "checkpoint-owner",
    configuration: Result.succeed(Object.freeze({
      claimDurationMilliseconds: options.claimDurationMilliseconds ?? 100,
    })),
    acquireEffect() {
      expect(this.marker).toBe("checkpoint-owner");
      return Effect.suspend(() => {
        events.push("acquire");
        return take(acquireSteps);
      });
    },
    checkpointEffect(_run: TestRun, evidence: unknown) {
      expect(this.marker).toBe("checkpoint-owner");
      return Effect.suspend(() => {
        events.push(evidence === null
          ? "checkpoint:null"
          : "checkpoint:evidence");
        checkpointInputs.push(evidence);
        return take(checkpointSteps);
      });
    },
    releaseEffect(_run: TestRun) {
      expect(this.marker).toBe("checkpoint-owner");
      return Effect.suspend(() => {
        events.push("release");
        return take(releaseSteps);
      });
    },
    isAcquireConfirmedRollback(error: TestError): error is TestConfirmedRollback {
      expect(this.marker).toBe("checkpoint-owner");
      return error instanceof TestConfirmedRollback &&
        error.operation === "acquire";
    },
    isCheckpointConfirmedRollback(error: TestError): error is TestConfirmedRollback {
      expect(this.marker).toBe("checkpoint-owner");
      return error instanceof TestConfirmedRollback &&
        error.operation === "checkpoint";
    },
    isReleaseConfirmedRollback(error: TestError): error is TestConfirmedRollback {
      expect(this.marker).toBe("checkpoint-owner");
      return error instanceof TestConfirmedRollback &&
        error.operation === "release";
    },
  };
  const port = owner satisfies TaskRepairSchedulerCheckpointPortV1<
    TestRun,
    TestConfigurationError,
    TestError,
    TestError,
    TestError,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback
  >;
  return Object.freeze({ port, events, checkpointInputs });
}

function take<A, E>(steps: Array<Effect.Effect<A, E>>): Effect.Effect<A, E> {
  const step = steps.length > 1 ? steps.shift() : steps[0];
  return step ?? Effect.die(new Error("Missing fixture step."));
}

function acquired(
  continuation: EncodedTaskRepairSweepContinuationV1 | null,
) {
  return Object.freeze({
    kind: "acquired" as const,
    run: RUN,
    claimExpiresAt: LATER,
    continuation,
  });
}

function receipt(
  continuation: TaskRepairSweepContinuationV1 | null,
): TaskRepairSweepReceiptV1 {
  return Object.freeze({
    version: "flarex.task-repair-sweep-receipt.v1",
    stopReason: continuation === null ? "cycle_exhausted" : "directory_budget",
    directoryPagesRead: 1,
    partitionVisits: 1,
    partitionsFailed: 0,
    schedulerRuns: 1,
    taskPagesCharged: 1,
    candidatesCharged: 1,
    confirmedTaskPagesRead: 1,
    confirmedCandidatesHandled: 1,
    continuation,
  });
}

function sweep(
  runEffect: TaskRepairSweepV1<TestOperationError>["runEffect"],
  configuration: TaskRepairSweepV1<TestOperationError>["configuration"] =
    Object.freeze({
      maximumRunMilliseconds: 50,
      settlementReserveMilliseconds: 10,
    }),
): TaskRepairSweepV1<TestOperationError> & Readonly<{ marker: string }> {
  return Object.freeze({
    marker: "sweep-owner",
    configuration,
    runEffect,
  });
}
