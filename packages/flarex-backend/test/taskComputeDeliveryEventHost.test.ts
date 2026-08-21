import {
  Cause,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Result,
} from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  TaskAttemptSupervisorContractError,
  type TaskAttemptSupervisorOutcome,
} from "../src/taskComputeDelivery/TaskAttemptSupervisor";
import {
  TaskComputeDeliveryConnectedRunner,
  TaskComputeDeliveryConnectedRunnerContractError,
  type TaskComputeDeliveryConnectedRunnerReceipt,
  type TaskComputeDeliveryConnectedRunnerShape,
} from "../src/taskComputeDelivery/ConnectedRunner";
import {
  makeTaskComputeDeliveryEventHost,
  TaskComputeDeliveryEventHostContractError,
  TaskComputeDeliveryEventHostDrainTimeoutError,
  TaskComputeDeliveryEventHostLayerConstructionError,
  type TaskComputeDeliveryEventExitObserver,
  type TaskComputeDeliveryEventLayerFactory,
} from "../src/taskComputeDelivery/TaskComputeDeliveryEventHost";
import {
  TaskComputeDeliverySupervisionControl,
} from "../src/taskComputeDelivery/WorkerLoaderTaskComputeProvider";

const successOutcome: TaskAttemptSupervisorOutcome = Object.freeze({
  kind: "unconfirmed",
  reason: "host_shutdown",
});

describe("Task compute delivery event host", () => {
  it("rejects invalid policy before any event Layer is constructed", () => {
    let constructed = false;
    const result = makeTaskComputeDeliveryEventHost({
      makeLayer() {
        constructed = true;
        return runnerLayer(() => Effect.succeed(runnerReceipt(0)));
      },
    }, {
      maximumDrainMilliseconds: 0,
      maximumSupervisionExits: 1,
    });

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "TaskComputeDeliveryEventHostConfigurationError",
        reason: "invalid_policy",
      });
    }
    expect(constructed).toBe(false);
  });

  it("captures host policy and preserves the layer factory receiver", async () => {
    const policy = {
      maximumDrainMilliseconds: 10,
      maximumSupervisionExits: 2,
    };
    let receiverPreserved = false;
    const factory = {
      marker: "owned",
      makeLayer(this: { readonly marker: string }) {
        receiverPreserved = this.marker === "owned";
        return runnerLayer(() => Effect.succeed(runnerReceipt(0)));
      },
    };
    const host = makeTaskComputeDeliveryEventHost(factory, policy).pipe(
      Result.getOrThrow,
    );
    policy.maximumDrainMilliseconds = 0;
    policy.maximumSupervisionExits = 0;

    const outcome = await Effect.runPromise(host.run(null));

    expect(receiverPreserved).toBe(true);
    expect(outcome.receipt.supervision).toEqual({
      expected: 0,
      observed: 0,
      succeeded: 0,
      failed: 0,
    });
  });

  it("aggregates full supervision exits without retaining their causes", async () => {
    const secretCause = new TaskAttemptSupervisorContractError({
      reason: "lifecycle_identity_mismatch",
    });
    const host = hostFor(observer => Effect.sync(() => {
      observer.admit();
      observer.admit();
      observer.observe(Exit.succeed(successOutcome));
      observer.observe(Exit.fail(secretCause));
      return runnerReceipt(2);
    }));

    const outcome = await Effect.runPromise(host.run(null));

    expect(outcome.receipt.supervision).toEqual({
      expected: 2,
      observed: 2,
      succeeded: 1,
      failed: 1,
    });
    expect(Object.keys(outcome.receipt.supervision)).toEqual([
      "expected",
      "observed",
      "succeeded",
      "failed",
    ]);
    expect(JSON.stringify(outcome.receipt)).not.toContain(
      "lifecycle_identity_mismatch",
    );
    expect("continuation" in outcome.receipt.runner).toBe(false);
  });

  it("keeps the Layer scope alive until delayed supervision drains", async () => {
    let released = false;
    const host = hostFor(
      observer => Effect.gen(function* () {
        observer.admit();
        yield* Effect.sleep("5 millis").pipe(
          Effect.tap(() => Effect.sync(() => {
            observer.observe(Exit.succeed(successOutcome));
          })),
          Effect.forkChild,
        );
        return runnerReceipt(1);
      }),
      () => {
        released = true;
      },
    );

    const outcome = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* host.run(null).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(released).toBe(false);
      yield* TestClock.adjust("5 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(outcome.receipt.supervision.observed).toBe(1);
    expect(released).toBe(true);
  });

  it("fails closed when observation count exceeds confirmed admissions", async () => {
    const host = hostFor(observer => Effect.sync(() => {
      observer.admit();
      observer.observe(Exit.succeed(successOutcome));
      observer.observe(Exit.succeed(successOutcome));
      return runnerReceipt(1);
    }));

    const exit = await Effect.runPromiseExit(host.run(null));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause).pipe(
        Option.getOrThrow,
      )).toMatchObject({
        _tag: "TaskComputeDeliveryEventHostContractError",
        reason: "supervision_count_mismatch",
        expected: 1,
        observed: 2,
      });
    }
  });

  it("does not infer admissions from the runner provider-call count", async () => {
    const host = hostFor(
      _observer => Effect.succeed(runnerReceipt(2)),
      undefined,
      { maximumDrainMilliseconds: 10, maximumSupervisionExits: 1 },
    );

    const outcome = await Effect.runPromise(host.run(null));

    expect(outcome.receipt.runner.confirmedDispatchProviderCalls).toBe(2);
    expect(outcome.receipt.supervision).toMatchObject({
      expected: 0,
      observed: 0,
    });
  });

  it("includes an in-flight admission completed during provider quiescence", async () => {
    const host = hostFor(
      _observer => Effect.succeed(runnerReceipt(0)),
      undefined,
      undefined,
      observer => Effect.sync(() => {
        observer.admit();
        observer.observe(Exit.succeed(successOutcome));
      }),
    );

    const outcome = await Effect.runPromise(host.run(null));

    expect(outcome.receipt.supervision).toEqual({
      expected: 1,
      observed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("rejects exact admissions beyond the event supervision ceiling", async () => {
    const host = hostFor(observer => Effect.sync(() => {
      observer.admit();
      observer.admit();
      return runnerReceipt(0);
    }), undefined, {
      maximumDrainMilliseconds: 10,
      maximumSupervisionExits: 1,
    });

    await expect(Effect.runPromise(host.run(null))).rejects.toBeInstanceOf(
      TaskComputeDeliveryEventHostContractError,
    );
  });

  it("times out the drain and releases the Layer scope", async () => {
    let released = false;
    const host = hostFor(
      observer => Effect.sync(() => {
        observer.admit();
        return runnerReceipt(0);
      }),
      () => {
        released = true;
      },
      { maximumDrainMilliseconds: 10, maximumSupervisionExits: 1 },
    );

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* host.run(null).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("10 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause).pipe(
        Option.getOrThrow,
      )).toMatchObject({
        _tag: "TaskComputeDeliveryEventHostDrainTimeoutError",
        maximumDrainMilliseconds: 10,
        expected: 1,
        observed: 0,
      });
    }
    expect(released).toBe(true);
  });

  it("drains an admitted session before re-emitting a runner failure", async () => {
    const runnerFailure = new TaskComputeDeliveryConnectedRunnerContractError({
      operation: "directory",
      reason: "directory_continuation_invalid",
    });
    let released = false;
    const host = hostFor(
      observer => Effect.gen(function* () {
        observer.admit();
        yield* Effect.sleep("5 millis").pipe(
          Effect.tap(() => Effect.sync(() => {
            observer.observe(Exit.succeed(successOutcome));
          })),
          Effect.forkChild,
        );
        return yield* Effect.fail(runnerFailure);
      }),
      () => {
        released = true;
      },
    );

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* host.run(null).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(released).toBe(false);
      yield* TestClock.adjust("5 millis");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause).pipe(
        Option.getOrThrow,
      )).toBe(runnerFailure);
    }
    expect(released).toBe(true);
  });

  it("preserves external interruption while releasing the Layer scope", async () => {
    let released = false;
    const host = hostFor(
      observer => Effect.sync(() => {
        observer.admit();
        return runnerReceipt(0);
      }),
      () => {
        released = true;
      },
    );

    const exit = await Effect.runPromise(Effect.gen(function* () {
      const fiber = yield* host.run(null).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
      return yield* Fiber.await(fiber);
    }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
    expect(released).toBe(true);
  });

  it("maps a throwing layer factory to its typed construction boundary", async () => {
    const factory: TaskComputeDeliveryEventLayerFactory<never> = {
      makeLayer() {
        throw new Error("construction failed");
      },
    };
    const host = makeTaskComputeDeliveryEventHost(factory, {
      maximumDrainMilliseconds: 10,
      maximumSupervisionExits: 1,
    }).pipe(Result.getOrThrow);

    await expect(Effect.runPromise(host.run(null))).rejects.toBeInstanceOf(
      TaskComputeDeliveryEventHostLayerConstructionError,
    );
  });
});

function hostFor(
  run: (
    observer: TaskComputeDeliveryEventExitObserver,
  ) => ReturnType<TaskComputeDeliveryConnectedRunnerShape["run"]>,
  onRelease?: () => void,
  policy = {
    maximumDrainMilliseconds: 10,
    maximumSupervisionExits: 2,
  },
  quiesce?: (
    observer: TaskComputeDeliveryEventExitObserver,
  ) => Effect.Effect<void>,
) {
  return makeTaskComputeDeliveryEventHost({
    makeLayer(observer) {
      return runnerLayer(
        () => run(observer),
        onRelease,
        quiesce === undefined ? undefined : () => quiesce(observer),
      );
    },
  }, policy).pipe(Result.getOrThrow);
}

function runnerLayer(
  run: TaskComputeDeliveryConnectedRunnerShape["run"],
  onRelease?: () => void,
  quiesce: () => Effect.Effect<void> = () => Effect.void,
) {
  return Layer.merge(
    Layer.effect(
      TaskComputeDeliveryConnectedRunner,
      Effect.gen(function* () {
        if (onRelease !== undefined) {
          yield* Effect.addFinalizer(() => Effect.sync(onRelease));
        }
        return TaskComputeDeliveryConnectedRunner.of(Object.freeze({ run }));
      }),
    ),
    Layer.succeed(
      TaskComputeDeliverySupervisionControl,
      TaskComputeDeliverySupervisionControl.of(Object.freeze({
        quiesce,
      })),
    ),
  );
}

function runnerReceipt(
  confirmedDispatchProviderCalls: number,
): TaskComputeDeliveryConnectedRunnerReceipt {
  return Object.freeze({
    version: "flarex.task-compute-delivery-connected-runner-receipt.v1",
    stopReason: "cycle_exhausted",
    directoryPagesCharged: 0,
    scopeVisits: 0,
    scopeResolutionFailures: 0,
    discoveryFailures: 0,
    dispatchPagesCharged: 0,
    cancellationPagesCharged: 0,
    dispatchCandidatesCharged: 0,
    cancellationCandidatesCharged: 0,
    dispatchProviderCallsCharged: confirmedDispatchProviderCalls,
    cancellationProviderCallsCharged: 0,
    totalOperationsCharged: confirmedDispatchProviderCalls,
    confirmedDispatchPagesRead: 0,
    confirmedCancellationPagesRead: 0,
    confirmedDispatchCandidatesHandled: confirmedDispatchProviderCalls,
    confirmedCancellationCandidatesHandled: 0,
    confirmedDispatchProviderCalls,
    confirmedCancellationProviderCalls: 0,
    candidateFailures: 0,
    continuation: null,
  });
}
