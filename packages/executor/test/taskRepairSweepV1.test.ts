import { isNonArrayRecord } from "@flarex/utils/records";
import { Cause, Data, Effect, Exit, Result } from "effect";
import { TestClock } from "effect/testing";
import { replacementScopeIdV1FromUuid } from
  "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createTaskRepairSweepV1,
  TaskRepairSweepDirectoryContractV1Error,
  TaskRepairSweepOperationTimeoutV1Error,
  type TaskRepairSweepDirectoryItemV1,
  type TaskRepairSweepDirectoryV1,
  type TaskRepairSweepOptionsV1,
  type TaskRepairSweepSchedulerV1,
} from "../src/taskRepairSweepV1";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

class TestDirectoryError extends Data.TaggedError("TestDirectoryError")<{
  readonly reason: "sql";
}> {}

class TestSchedulerError extends Data.TaggedError("TestSchedulerError")<{
  readonly reason: "transient";
}> {}

type TestDirectory = TaskRepairSweepDirectoryV1<
  TestDirectoryError,
  TestSchedulerError
>;
type TestItem = TaskRepairSweepDirectoryItemV1<TestSchedulerError>;
type TestScheduler = TaskRepairSweepSchedulerV1<TestSchedulerError>;
type TestRequest = Parameters<TestScheduler["run"]>[0];
type TestReceipt = Effect.Success<ReturnType<TestScheduler["run"]>>;
type TestCursor = NonNullable<TestRequest["cursor"]>;

const NEXT = Object.freeze({
  codecVersion: 1 as const,
  highWaterScopeId: replacementScopeIdV1FromUuid(
    "91000000-0000-0000-0000-000000000002",
  ),
  lastScopeId: replacementScopeIdV1FromUuid(
    "91000000-0000-0000-0000-000000000001",
  ),
});

const HIGH_WATER_NEXT = Object.freeze({
  codecVersion: 1 as const,
  highWaterScopeId: replacementScopeIdV1FromUuid(
    "92000000-0000-0000-0000-000000000003",
  ),
  lastScopeId: replacementScopeIdV1FromUuid(
    "92000000-0000-0000-0000-000000000002",
  ),
});

describe("DTE05-E1 inert Task repair sweep", () => {
  it("runs start-attempt before lease-expiry and exhausts one fresh cycle", async () => {
    const observed: TestRequest[] = [];
    const ready = readyItem("one", scheduler((request) => {
      observed.push(request);
      return Effect.succeed(receipt(request, null));
    }));
    const directory = repeatingDirectory(ready, null);

    const result = await runEffect(runner(directory).runEffect(null));

    expect(observed.map(({ dueKind }) => dueKind)).toEqual([
      "start_attempt",
      "handle_lease_expiry",
    ]);
    expect(result).toMatchObject({
      stopReason: "cycle_exhausted",
      schedulerRuns: 2,
      taskPagesCharged: 2,
      candidatesCharged: 0,
      confirmedTaskPagesRead: 2,
      confirmedCandidatesHandled: 0,
      continuation: null,
    });
    expect(directory.calls()).toBe(1);
    expect(directory.resolutions()).toBe(1);
  });

  it("preserves a scheduler method receiver through ready-item capture", async () => {
    interface ReceiverScheduler extends TestScheduler {
      calls: number;
    }
    const receiver: ReceiverScheduler = {
      calls: 0,
      run(request) {
        this.calls += 1;
        return Effect.succeed(receipt(request, null));
      },
    };
    const directory = repeatingDirectory(
      readyItem("receiver", receiver),
      null,
    );

    const result = await runEffect(runner(directory).runEffect(null));

    expect(result.stopReason).toBe("cycle_exhausted");
    expect(receiver.calls).toBe(2);
  });

  it("executes the same owned resolution snapshot that passed identity validation", async () => {
    let correctCalls = 0;
    let wrongCalls = 0;
    let startCalls = 0;
    let deploymentReads = 0;
    let scopeReads = 0;
    const correctScheduler = scheduler((request) => {
      correctCalls += 1;
      return Effect.succeed(receipt(
        request,
        request.dueKind === "start_attempt" && startCalls++ === 0
          ? dueCursor(request.dueKind, "run_owned_resolution")
          : null,
      ));
    });
    const wrongScheduler = scheduler((request) => {
      wrongCalls += 1;
      return Effect.succeed(receipt(request, null));
    });
    const expected = readyItem("owned_resolution", correctScheduler);
    const wrong = readyItem("wrong_resolution", wrongScheduler);
    const changing: Extract<TestItem, { readonly kind: "ready" }> = {
      get kind() {
        return "ready" as const;
      },
      get deploymentId() {
        deploymentReads += 1;
        return deploymentReads === 1
          ? expected.deploymentId
          : wrong.deploymentId;
      },
      get scopeId() {
        scopeReads += 1;
        return scopeReads === 1 ? expected.scopeId : wrong.scopeId;
      },
      get maximumPagesPerRun() {
        return 1;
      },
      get maximumCandidatesPerRun() {
        return 1;
      },
      get scheduler() {
        return deploymentReads === 1 ? correctScheduler : wrongScheduler;
      },
    };
    const discovered = repeatingDirectory(expected, null);
    const directory: TestDirectory = Object.freeze({
      discoverEffect: discovered.discoverEffect,
      resolveEffect: () => Effect.succeed(changing),
    });
    const operation = runner(directory, { maximumSchedulerRuns: 1 });

    const first = await runEffect(operation.runEffect(null));
    const second = await runEffect(operation.runEffect(first.continuation));

    expect(second.continuation?.partition?.dueKind).toBe("handle_lease_expiry");
    expect(deploymentReads).toBe(1);
    expect(scopeReads).toBe(1);
    expect(correctCalls).toBe(2);
    expect(wrongCalls).toBe(0);
  });

  it("freshly resolves current authority before resuming an inner cursor", async () => {
    const cursor = dueCursor("start_attempt", "run_resume");
    const observed: TestRequest[] = [];
    let startCalls = 0;
    const ready = readyItem("resume", scheduler((request) => {
      observed.push(request);
      if (request.dueKind === "start_attempt" && startCalls++ === 0) {
        return Effect.succeed(receipt(request, cursor));
      }
      return Effect.succeed(receipt(request, null));
    }));
    const directory = repeatingDirectory(ready, null);
    const operation = runner(directory, { maximumSchedulerRuns: 1 });

    const first = await runEffect(operation.runEffect(null));
    expect(first.stopReason).toBe("scheduler_budget");
    expect(first.continuation?.partition?.cursor).toEqual(cursor);

    const second = await runEffect(operation.runEffect(first.continuation));
    expect(second.stopReason).toBe("scheduler_budget");
    expect(second.continuation?.partition).toMatchObject({
      dueKind: "handle_lease_expiry",
      cursor: null,
    });

    const third = await runEffect(operation.runEffect(second.continuation));
    expect(third.stopReason).toBe("cycle_exhausted");
    expect(observed).toHaveLength(3);
    expect(observed[1]?.cursor).toEqual(cursor);
    expect(directory.calls()).toBe(1);
    expect(directory.resolutions()).toBe(2);
  });

  it("finishes the original snapshot while ignoring a newly earlier scope", async () => {
    const cursor = dueCursor("start_attempt", "run_high_water");
    let startCalls = 0;
    let discoveryCalls = 0;
    let resolutionCalls = 0;
    let earlierCalls = 0;
    let laterCalls = 0;
    const snapshotted = readyItem("snapshotted", scheduler((request) => {
      if (request.dueKind === "start_attempt" && startCalls++ === 0) {
        return Effect.succeed(receipt(request, cursor));
      }
      return Effect.succeed(receipt(request, null));
    }));
    const newlyEarlier = Object.freeze({
      ...readyItem("newly_earlier", scheduler((request) => {
        earlierCalls += 1;
        return Effect.succeed(receipt(request, null));
      })),
      scopeId: replacementScopeIdV1FromUuid(
        "92000000-0000-0000-0000-000000000001",
      ),
    });
    const originalLater = Object.freeze({
      ...readyItem("original_later", scheduler((request) => {
        laterCalls += 1;
        return Effect.succeed(receipt(request, null));
      })),
      scopeId: replacementScopeIdV1FromUuid(
        "92000000-0000-0000-0000-000000000003",
      ),
    });
    let inserted = false;
    const directory: TestDirectory = Object.freeze({
      discoverEffect: (input: unknown) => {
        discoveryCalls += 1;
        const continuation = isNonArrayRecord(input)
          ? input.continuation
          : undefined;
        if (continuation !== undefined) {
          expect(continuation).toEqual(HIGH_WATER_NEXT);
          return Effect.succeed(page([originalLater], null));
        }
        return Effect.succeed(page(
          [inserted ? newlyEarlier : snapshotted],
          inserted ? null : HIGH_WATER_NEXT,
        ));
      },
      resolveEffect: (
        candidate: Parameters<TestDirectory["resolveEffect"]>[0],
      ) => {
        resolutionCalls += 1;
        const item = candidate.deploymentId === snapshotted.deploymentId
          ? snapshotted
          : originalLater;
        expect(candidate).toEqual({
          deploymentId: item.deploymentId,
          scopeId: item.scopeId,
        });
        return Effect.succeed(item);
      },
    });
    const operation = runner(directory, { maximumSchedulerRuns: 1 });

    const first = await runEffect(operation.runEffect(null));
    inserted = true;
    const second = await runEffect(operation.runEffect(first.continuation));
    const third = await runEffect(operation.runEffect(second.continuation));
    const fourth = await runEffect(operation.runEffect(third.continuation));
    const fifth = await runEffect(operation.runEffect(fourth.continuation));

    expect(first.continuation?.partition).toMatchObject({
      expectedDeploymentId: snapshotted.deploymentId,
      cursor,
      directoryAfter: {
        kind: "continuing",
        continuation: HIGH_WATER_NEXT,
      },
    });
    expect(second.continuation?.partition).toMatchObject({
      expectedDeploymentId: snapshotted.deploymentId,
      dueKind: "handle_lease_expiry",
      directoryAfter: {
        kind: "continuing",
        continuation: HIGH_WATER_NEXT,
      },
    });
    expect(third).toMatchObject({
      stopReason: "scheduler_budget",
      continuation: {
        directory: { kind: "continuing", continuation: HIGH_WATER_NEXT },
        partition: {
          expectedDeploymentId: originalLater.deploymentId,
          dueKind: "start_attempt",
          directoryAfter: {
            kind: "exhausted",
            highWaterScopeId: originalLater.scopeId,
          },
        },
      },
    });
    expect(fourth.continuation?.partition).toMatchObject({
      expectedDeploymentId: originalLater.deploymentId,
      dueKind: "handle_lease_expiry",
      directoryAfter: {
        kind: "exhausted",
        highWaterScopeId: originalLater.scopeId,
      },
    });
    expect(fifth).toMatchObject({
      stopReason: "cycle_exhausted",
      continuation: null,
    });
    expect(discoveryCalls).toBe(2);
    expect(resolutionCalls).toBe(4);
    expect(earlierCalls).toBe(0);
    expect(laterCalls).toBe(2);
  });

  it("preserves the repair-directory receiver during exact resolution", async () => {
    interface ReceiverDirectory extends TestDirectory {
      readonly ready: TestItem;
      resolutionCalls: number;
    }
    let startCalls = 0;
    const ready = readyItem("directory_receiver", scheduler((request) =>
      Effect.succeed(receipt(
        request,
        request.dueKind === "start_attempt" && startCalls++ === 0
          ? dueCursor(request.dueKind, "run_directory_receiver")
          : null,
      ))
    ));
    const directory: ReceiverDirectory = {
      ready,
      resolutionCalls: 0,
      discoverEffect() {
        return Effect.succeed(page([this.ready], null));
      },
      resolveEffect() {
        this.resolutionCalls += 1;
        return Effect.succeed(this.ready);
      },
    };
    const operation = runner(directory, { maximumSchedulerRuns: 1 });

    const first = await runEffect(operation.runEffect(null));
    const second = await runEffect(operation.runEffect(first.continuation));

    expect(second.continuation?.partition?.dueKind).toBe("handle_lease_expiry");
    expect(directory.resolutionCalls).toBe(1);
  });

  it("rejects a resolved item that does not match the persisted identity", async () => {
    const expected = readyItem("expected", scheduler((request) =>
      Effect.succeed(receipt(
        request,
        dueCursor(request.dueKind, "run_resolved_mismatch"),
      ))
    ));
    const wrong = readyItem("wrong", scheduler((request) =>
      Effect.succeed(receipt(request, null))
    ));
    const discovered = repeatingDirectory(expected, null);
    const directory: TestDirectory = Object.freeze({
      discoverEffect: discovered.discoverEffect,
      resolveEffect: () => Effect.succeed(wrong),
    });
    const operation = runner(directory, { maximumSchedulerRuns: 1 });
    const first = await runEffect(operation.runEffect(null));

    const failure = await runEffectFailure(
      operation.runEffect(first.continuation),
    );

    expect(failure).toBeInstanceOf(TaskRepairSweepDirectoryContractV1Error);
    expect(failure).toMatchObject({ reason: "resolved_item_mismatch" });
  });

  it("isolates a failed exact re-resolution and advances the original snapshot", async () => {
    const expected = Object.freeze({
      ...readyItem("authority_lost", scheduler((request) =>
        Effect.succeed(receipt(
          request,
          dueCursor(request.dueKind, "run_authority_lost"),
        ))
      )),
      scopeId: NEXT.lastScopeId,
    });
    let healthyCalls = 0;
    const healthy = readyItem("after_authority_loss", scheduler((request) => {
      healthyCalls += 1;
      return Effect.succeed(receipt(request, null));
    }));
    const failedResolution = Object.freeze({
      kind: "failed" as const,
      deploymentId: expected.deploymentId,
      scopeId: expected.scopeId,
      reason: "authority_unavailable" as const,
    });
    let discoveryCalls = 0;
    const directory: TestDirectory = Object.freeze({
      discoverEffect: () => Effect.succeed(
        discoveryCalls++ === 0
          ? page([expected], NEXT)
          : page([healthy], null),
      ),
      resolveEffect: (
        candidate: Parameters<TestDirectory["resolveEffect"]>[0],
      ) =>
        candidate.deploymentId === expected.deploymentId
          ? Effect.succeed(failedResolution)
          : Effect.succeed(healthy),
    });
    const operation = runner(directory, { maximumSchedulerRuns: 1 });

    const first = await runEffect(operation.runEffect(null));
    const second = await runEffect(operation.runEffect(first.continuation));
    const third = await runEffect(operation.runEffect(second.continuation));

    expect(second).toMatchObject({
      stopReason: "scheduler_budget",
      partitionsFailed: 1,
      continuation: {
        partition: {
          expectedDeploymentId: healthy.deploymentId,
          dueKind: "handle_lease_expiry",
        },
      },
    });
    expect(third.stopReason).toBe("cycle_exhausted");
    expect(discoveryCalls).toBe(2);
    expect(healthyCalls).toBe(2);
  });

  it("advances past a failed candidate instead of starving a later scope", async () => {
    const observed: TestRequest[] = [];
    const healthy = readyItem("healthy", scheduler((request) => {
      observed.push(request);
      return Effect.succeed(receipt(request, null));
    }));
    const failed = Object.freeze({
      kind: "failed" as const,
      deploymentId: "deployment_failed",
      scopeId: replacementScopeIdV1FromUuid(
        "92000000-0000-0000-0000-000000000001",
      ),
      reason: "authority_unavailable" as const,
    });
    const directory = sequencedDirectory([
      page([failed], NEXT),
      page([healthy], null),
      page([healthy], null),
    ]);

    const result = await runEffect(runner(directory).runEffect(null));

    expect(result).toMatchObject({
      stopReason: "cycle_exhausted",
      partitionsFailed: 1,
      schedulerRuns: 2,
    });
    expect(observed.map(({ dueKind }) => dueKind)).toEqual([
      "start_attempt",
      "handle_lease_expiry",
    ]);
  });

  it("counts a typed scheduler failure but preserves a scheduler defect", async () => {
    let partialProgress = 0;
    const typed = readyItem("typed", scheduler(() => Effect.sync(() => {
      partialProgress += 1;
    }).pipe(Effect.andThen(
      Effect.fail(new TestSchedulerError({ reason: "transient" })),
    ))));
    const typedResult = await runEffect(
      runner(repeatingDirectory(typed, null)).runEffect(null),
    );
    expect(typedResult).toMatchObject({
      stopReason: "cycle_exhausted",
      partitionsFailed: 1,
      schedulerRuns: 1,
      taskPagesCharged: 1,
      candidatesCharged: 1,
      confirmedTaskPagesRead: 0,
      confirmedCandidatesHandled: 0,
    });
    expect(partialProgress).toBe(1);

    const defect = new Error("scheduler defect");
    const defective = readyItem("defect", scheduler(() => Effect.die(defect)));
    const defectExit = await runEffect(Effect.exit(
      runner(repeatingDirectory(defective, null)).runEffect(null),
    ));
    expect(Exit.isFailure(defectExit)).toBe(true);
    if (Exit.isFailure(defectExit)) {
      const observed = Cause.findDefect(defectExit.cause);
      expect(Result.isSuccess(observed)).toBe(true);
      if (Result.isSuccess(observed)) expect(observed.success).toBe(defect);
    }
  });

  it("retains an unknown-progress charge and resumes the blocked next scope", async () => {
    let healthyCalls = 0;
    const failing = Object.freeze({
      ...readyItem("failing", scheduler(() =>
        Effect.fail(new TestSchedulerError({ reason: "transient" }))
      )),
      scopeId: NEXT.lastScopeId,
    });
    const healthy = readyItem("after_failure", scheduler((request) => {
      healthyCalls += 1;
      return Effect.succeed(receipt(request, null));
    }));
    const directory = sequencedDirectory([
      page([failing], NEXT),
      page([healthy], null),
      page([healthy], null),
      page([healthy], null),
      page([healthy], null),
    ]);
    const operation = runner(directory, {
      maximumTaskPages: 1,
      maximumCandidates: 1,
    });

    const first = await runEffect(operation.runEffect(null));
    expect(first).toMatchObject({
      stopReason: "task_page_budget",
      taskPagesCharged: 1,
      candidatesCharged: 1,
      confirmedTaskPagesRead: 0,
      confirmedCandidatesHandled: 0,
    });
    expect(first.continuation?.partition).toMatchObject({
      expectedDeploymentId: "deployment_after_failure",
      dueKind: "start_attempt",
      cursor: null,
    });
    expect(healthyCalls).toBe(0);

    const resumed = await runEffect(
      operation.runEffect(first.continuation),
    );
    expect(resumed).toMatchObject({
      stopReason: "task_page_budget",
      schedulerRuns: 1,
      confirmedTaskPagesRead: 1,
    });
    expect(resumed.continuation?.partition).toMatchObject({
      dueKind: "handle_lease_expiry",
      cursor: null,
    });
    expect(healthyCalls).toBe(1);

    const completed = await runEffect(
      operation.runEffect(resumed.continuation),
    );
    expect(completed.stopReason).toBe("cycle_exhausted");
    expect(healthyCalls).toBe(2);
  });

  it("rejects invalid policy before touching the directory", () => {
    const directory = repeatingDirectory(
      readyItem("unused", scheduler((request) =>
        Effect.succeed(receipt(request, null))
      )),
      null,
    );
    const constructed = createTaskRepairSweepV1(directory, options({
      maximumOperationMilliseconds: 90,
      settlementReserveMilliseconds: 20,
      maximumRunMilliseconds: 100,
    }));
    expect(Result.isFailure(constructed)).toBe(true);
    expect(directory.calls()).toBe(0);
  });

  it("bounds a directory operation before the host-return reserve", async () => {
    const ready = readyItem("timed", scheduler((request) =>
      Effect.succeed(receipt(request, null))
    ));
    const directory: TestDirectory = Object.freeze({
      discoverEffect: () => TestClock.adjust("100 millis").pipe(
        Effect.andThen(Effect.succeed(page([ready], null))),
      ),
      resolveEffect: () => Effect.succeed(ready),
    });
    const operation = runner(directory, {
      maximumRunMilliseconds: 100,
      maximumOperationMilliseconds: 90,
      settlementReserveMilliseconds: 10,
    });

    const failure = await runEffectFailure(operation.runEffect(null).pipe(
      Effect.provide(TestClock.layer()),
    ));

    expect(failure).toBeInstanceOf(TaskRepairSweepOperationTimeoutV1Error);
    expect(failure).toMatchObject({
      operation: "directory",
      budgetNanoseconds: 90_000_000n,
    });
  });

  it("bounds fresh partition resolution before resuming its cursor", async () => {
    const ready = readyItem("resolve_timed", scheduler((request) =>
      Effect.succeed(receipt(
        request,
        dueCursor(request.dueKind, "run_resolve_timed"),
      ))
    ));
    const discovered = repeatingDirectory(ready, null);
    const directory: TestDirectory = Object.freeze({
      discoverEffect: discovered.discoverEffect,
      resolveEffect: () => TestClock.adjust("100 millis").pipe(
        Effect.andThen(Effect.succeed(ready)),
      ),
    });
    const operation = runner(directory, {
      maximumSchedulerRuns: 1,
      maximumRunMilliseconds: 100,
      maximumOperationMilliseconds: 90,
      settlementReserveMilliseconds: 10,
    });
    const first = await runEffect(operation.runEffect(null).pipe(
      Effect.provide(TestClock.layer()),
    ));

    const failure = await runEffectFailure(
      operation.runEffect(first.continuation).pipe(
        Effect.provide(TestClock.layer()),
      ),
    );

    expect(failure).toBeInstanceOf(TaskRepairSweepOperationTimeoutV1Error);
    expect(failure).toMatchObject({
      operation: "resolve",
      budgetNanoseconds: 90_000_000n,
    });
  });

  it("advances a valid filtered directory page with no repair item", async () => {
    const observed: TestRequest[] = [];
    const healthy = readyItem("after_legacy", scheduler((request) => {
      observed.push(request);
      return Effect.succeed(receipt(request, null));
    }));
    const directory = sequencedDirectory([
      page([], NEXT),
      page([healthy], null),
      page([healthy], null),
    ]);

    const result = await runEffect(runner(directory).runEffect(null));

    expect(result).toMatchObject({
      stopReason: "cycle_exhausted",
      directoryPagesRead: 2,
      schedulerRuns: 2,
      continuation: null,
    });
    expect(observed.map(({ dueKind }) => dueKind)).toEqual([
      "start_attempt",
      "handle_lease_expiry",
    ]);
  });

  it("fails explicitly when a partition can never fit the host policy", async () => {
    const oversized = readyItem(
      "oversized",
      scheduler((request) => Effect.succeed(receipt(request, null))),
      { maximumPagesPerRun: 2 },
    );
    const failure = await runEffectFailure(
      runner(
        repeatingDirectory(oversized, null),
        { maximumTaskPages: 1 },
      ).runEffect(null),
    );

    expect(failure).toMatchObject({
      _tag: "TaskRepairSweepSchedulerContractV1Error",
      reason: "partition_budget_exceeds_policy",
    });
  });

  it("rejects malformed ready-item ceilings before invoking its scheduler", async () => {
    let schedulerCalls = 0;
    const malformed = readyItem(
      "malformed",
      scheduler((request) => {
        schedulerCalls += 1;
        return Effect.succeed(receipt(request, null));
      }),
      { maximumCandidatesPerRun: Number.NaN },
    );
    const failure = await runEffectFailure(
      runner(repeatingDirectory(malformed, null)).runEffect(null),
    );

    expect(failure).toMatchObject({
      _tag: "TaskRepairSweepSchedulerContractV1Error",
      reason: "ready_budget_invalid",
    });
    expect(schedulerCalls).toBe(0);
  });

  it("rejects a budget stop that omits its required continuation", async () => {
    const invalid = readyItem("missing_cursor", scheduler((request) =>
      Effect.succeed(Object.freeze({
        ...receipt(request, null),
        stopReason: "page_budget" as const,
      }))
    ));
    const failure = await runEffectFailure(
      runner(repeatingDirectory(invalid, null)).runEffect(null),
    );

    expect(failure).toMatchObject({
      _tag: "TaskRepairSweepSchedulerContractV1Error",
      reason: "stop_continuation_mismatch",
    });
  });

  it("rejects a continuation for another due-kind", async () => {
    const invalid = readyItem("wrong_cursor", scheduler((request) => {
      const wrongKind = request.dueKind === "start_attempt"
        ? "handle_lease_expiry"
        : "start_attempt";
      return Effect.succeed(receipt(
        request,
        dueCursor(wrongKind, "run_wrong_kind"),
      ));
    }));
    const failure = await runEffectFailure(
      runner(repeatingDirectory(invalid, null)).runEffect(null),
    );

    expect(failure).toMatchObject({
      _tag: "TaskRepairSweepSchedulerContractV1Error",
      reason: "continuation_kind_mismatch",
    });
  });

  it("validates and retains one captured continuation snapshot", async () => {
    let throughReads = 0;
    const changingCursor: TestCursor = Object.freeze({
      version: 1,
      dueKind: "start_attempt",
      get throughMs() {
        throughReads += 1;
        return (throughReads === 1 ? 1 : 2) as TestCursor["throughMs"];
      },
      dueAtMs: 1 as TestCursor["dueAtMs"],
      runId: "run_changing_cursor" as TestCursor["runId"],
    });
    const item = readyItem("changing_cursor", scheduler((request) =>
      Effect.succeed(receipt(request, changingCursor))
    ));
    const result = await runEffect(runner(
      repeatingDirectory(item, null),
      { maximumSchedulerRuns: 1 },
    ).runEffect(null));

    expect(result.stopReason).toBe("scheduler_budget");
    expect(result.continuation?.partition?.cursor?.throughMs).toBe(1);
    expect(throughReads).toBe(1);
  });
});

function runner(
  directory: TestDirectory,
  overrides: Partial<TaskRepairSweepOptionsV1> = {},
) {
  return Result.getOrThrow(createTaskRepairSweepV1(
    directory,
    options(overrides),
  ));
}

function options(
  overrides: Partial<TaskRepairSweepOptionsV1> = {},
): TaskRepairSweepOptionsV1 {
  return {
    maximumDirectoryPages: 10,
    maximumSchedulerRuns: 10,
    maximumTaskPages: 10,
    maximumCandidates: 10,
    maximumRunMilliseconds: 1_000,
    maximumOperationMilliseconds: 100,
    settlementReserveMilliseconds: 10,
    ...overrides,
  };
}

function scheduler(
  run: TestScheduler["run"],
): TestScheduler {
  return Object.freeze({ run });
}

function readyItem(
  suffix: string,
  taskScheduler: TestScheduler,
  overrides: Partial<Readonly<{
    readonly maximumPagesPerRun: number;
    readonly maximumCandidatesPerRun: number;
  }>> = {},
): Extract<TestItem, { readonly kind: "ready" }> {
  return Object.freeze({
    kind: "ready",
    deploymentId: `deployment_${suffix}`,
    scopeId: replacementScopeIdV1FromUuid(
      "92000000-0000-0000-0000-000000000002",
    ),
    maximumPagesPerRun: 1,
    maximumCandidatesPerRun: 1,
    scheduler: taskScheduler,
    ...overrides,
  });
}

function receipt(
  request: TestRequest,
  continuation: TestCursor | null,
): TestReceipt {
  return Object.freeze({
    version: "flarex.task-wake-scheduler-run-receipt.v1",
    dueKind: request.dueKind,
    throughMs: 1 as TestReceipt["throughMs"],
    stopReason: continuation === null ? "source_exhausted" : "page_budget",
    pagesRead: 1,
    candidatesHandled: 0,
    handled: Object.freeze([]),
    continuation,
  });
}

function dueCursor(dueKind: TestRequest["dueKind"], runId: string): TestCursor {
  return Object.freeze({
    version: 1,
    dueKind,
    throughMs: 1 as TestCursor["throughMs"],
    dueAtMs: 1 as TestCursor["dueAtMs"],
    runId: runId as TestCursor["runId"],
  });
}

function repeatingDirectory(
  item: TestItem,
  continuation: typeof NEXT | null,
): TestDirectory & Readonly<{
  readonly calls: () => number;
  readonly resolutions: () => number;
}> {
  let calls = 0;
  let resolutions = 0;
  return Object.freeze({
    discoverEffect: () => {
      calls += 1;
      return Effect.succeed(page([item], continuation));
    },
    resolveEffect: (
      candidate: Parameters<TestDirectory["resolveEffect"]>[0],
    ) => {
      resolutions += 1;
      return item.deploymentId === candidate.deploymentId
          && item.scopeId === candidate.scopeId
        ? Effect.succeed(item)
        : Effect.fail(new TestDirectoryError({ reason: "sql" }));
    },
    calls: () => calls,
    resolutions: () => resolutions,
  });
}

function sequencedDirectory(
  pages: ReadonlyArray<Effect.Success<ReturnType<TestDirectory["discoverEffect"]>>>,
): TestDirectory {
  let index = 0;
  const items = pages.flatMap((directoryPage) => directoryPage.items);
  return Object.freeze({
    discoverEffect: () => {
      const current = pages[index++];
      return current === undefined
        ? Effect.fail(new TestDirectoryError({ reason: "sql" }))
        : Effect.succeed(current);
    },
    resolveEffect: (
      candidate: Parameters<TestDirectory["resolveEffect"]>[0],
    ) => {
      const item = items.find((candidateItem) =>
        candidateItem.deploymentId === candidate.deploymentId
        && candidateItem.scopeId === candidate.scopeId
      );
      return item === undefined
        ? Effect.fail(new TestDirectoryError({ reason: "sql" }))
        : Effect.succeed(item);
    },
  });
}

function page(
  items: ReadonlyArray<TestItem>,
  continuation: typeof NEXT | null,
): Effect.Success<ReturnType<TestDirectory["discoverEffect"]>> {
  return Object.freeze({
    items: Object.freeze([...items]),
    continuation,
  });
}
