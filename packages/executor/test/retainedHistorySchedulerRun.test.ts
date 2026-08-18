import type {
  RetainedHistorySchedulerDirectoryItem,
  RetainedHistorySchedulerDirectory,
} from "@flarex/persistence-postgres/internal/retained-history-scheduler-directory";
import { Data, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  replacementScopeIdV1FromUuid,
} from "flarex-protocol/storage-authority";
import { describe, expect, it } from "vitest";

import {
  createRetainedHistoryMultiScopeMaintenance,
  type RetainedHistoryMultiScopeMaintenanceReceiptV1,
  type RetainedHistoryMultiScopeMaintenance,
} from "../src/retainedHistoryMultiScopeMaintenance";
import type {
  EncodedRetainedHistorySchedulerContinuationV1,
  RetainedHistorySchedulerContinuationV1,
} from "../src/retainedHistorySchedulerContinuationCodecV1";
import {
  createRetainedHistorySchedulerRun,
  type RetainedHistorySchedulerCheckpointPort,
} from "../src/retainedHistorySchedulerRun";
import { runEffect } from "./effectTestRuntime";

const SCOPE_ONE = replacementScopeIdV1FromUuid(
  "94000000-0000-0000-0000-000000000001",
);
const SCOPE_TWO = replacementScopeIdV1FromUuid(
  "94000000-0000-0000-0000-000000000002",
);
const HIGH_WATER = SCOPE_TWO;
const LATER = new Date("2030-01-01T00:00:00.000Z");

type RetainedHistoryMaintenanceReceipt = Effect.Success<ReturnType<Extract<
  RetainedHistorySchedulerDirectoryItem,
  { readonly kind: "ready" }
>["maintenance"]["runEffect"]>>["receipt"];

class TestCheckpointError extends Data.TaggedError("TestCheckpointError")<{
  readonly operation: "acquire" | "renew" | "checkpoint" | "release";
}> {}

class TestConfirmedRollback extends Data.TaggedError("TestConfirmedRollback")<{
  readonly operation: "acquire" | "renew" | "checkpoint" | "release";
}> {}

describe("O11-F2 retained-history scheduler run", () => {
  it("skips an inert failed scope, persists exact scope progress, then resumes cold", async () => {
    const maintenanceInputs: unknown[] = [];
    let completed = false;
    const directory = directoryFixture({
      first: failedItem("deployment_one", SCOPE_ONE),
      second: readyItem("deployment_two", SCOPE_TWO, (input) => {
        maintenanceInputs.push(input);
        if (!completed) {
          completed = true;
          return Effect.succeed(Object.freeze({
            receipt: maintenanceReceipt(
              "deployment_two",
              SCOPE_TWO,
              "maintenancePaused",
              "pageBudget",
            ),
            continuation: maintenanceEvidence("deployment_two", SCOPE_TWO),
          }));
        }
        return Effect.succeed(Object.freeze({
          receipt: maintenanceReceipt(
            "deployment_two",
            SCOPE_TWO,
            "maintenanceComplete",
            "exhausted",
          ),
          continuation: null,
        }));
      }),
    });
    const multiScope = Result.getOrThrow(
      createRetainedHistoryMultiScopeMaintenance(directory, {
        maximumDirectoryPagesPerInvocation: 3,
        maximumMaintenancePagesPerInvocation: 1,
      }),
    );

    const first = await runEffect(multiScope.runEffect(null));
    expect(first).toMatchObject({
      stopReason: "maintenanceSettled",
      directoryPagesRead: 2,
      scopeVisits: 2,
      scopesFailed: 1,
      maintenanceRuns: 1,
      continuation: {
        activeScope: {
          deploymentId: "deployment_two",
          scopeId: SCOPE_TWO,
        },
      },
    });
    const encoded = await import(
      "../src/retainedHistorySchedulerContinuationCodecV1"
    ).then(({ encodeRetainedHistorySchedulerContinuationV1 }) =>
      runEffect(encodeRetainedHistorySchedulerContinuationV1(
        first.continuation!,
      ))
    );
    const decoded = await import(
      "../src/retainedHistorySchedulerContinuationCodecV1"
    ).then(({ decodeRetainedHistorySchedulerContinuationV1 }) =>
      runEffect(decodeRetainedHistorySchedulerContinuationV1(encoded))
    );
    const second = await runEffect(multiScope.runEffect(decoded));
    expect(second).toMatchObject({
      stopReason: "cycleExhausted",
      directoryPagesRead: 0,
      scopeVisits: 1,
      maintenanceRuns: 1,
      continuation: null,
    });
    expect(maintenanceInputs).toEqual([
      null,
      maintenanceEvidence("deployment_two", SCOPE_TWO),
    ]);
  });

  it("checkpoints every settled invocation before renewal and release", async () => {
    const events: string[] = [];
    const checkpointInputs:
      Array<EncodedRetainedHistorySchedulerContinuationV1 | null> = [];
    const checkpoint = checkpointFixture(events, checkpointInputs);
    const continuation = schedulerContinuation();
    let invocations = 0;
    const multiScope: RetainedHistoryMultiScopeMaintenance = Object.freeze({
      configuration: Object.freeze({
        maximumDirectoryPagesPerInvocation: 1,
        maximumMaintenancePagesPerInvocation: 1,
      }),
      runEffect: () => Effect.sync(() => {
        invocations += 1;
        return multiScopeReceipt(invocations === 1 ? continuation : null);
      }),
    });
    const runner = Result.getOrThrow(createRetainedHistorySchedulerRun(
      checkpoint,
      multiScope,
      {
        maximumInvocations: 2,
        maximumDirectoryPages: 2,
        maximumMaintenancePages: 2,
        maximumRunMilliseconds: 1_000,
        maximumInvocationMilliseconds: 100,
        settlementReserveMilliseconds: 10,
      },
    ));

    const result = await runEffect(runner.runEffect());
    expect(result).toMatchObject({
      kind: "completed",
      reason: "cycleExhausted",
      invocations: 2,
      directoryPagesRead: 2,
      maintenancePagesExecuted: 2,
    });
    expect(events).toEqual([
      "acquire",
      "checkpoint:evidence",
      "renew",
      "checkpoint:null",
      "release",
    ]);
    expect(checkpointInputs).toHaveLength(2);
    expect(checkpointInputs[0]).not.toBeNull();
    expect(checkpointInputs[1]).toBeNull();
  });

  it("projects duplicate wakes as busy without running maintenance", async () => {
    let runs = 0;
    const checkpoint = checkpointFixture([], [], {
      kind: "busy",
      claimExpiresAt: LATER,
    });
    const multiScope: RetainedHistoryMultiScopeMaintenance = Object.freeze({
      configuration: Object.freeze({
        maximumDirectoryPagesPerInvocation: 1,
        maximumMaintenancePagesPerInvocation: 1,
      }),
      runEffect: () => Effect.sync(() => {
        runs += 1;
        return multiScopeReceipt(null);
      }),
    });
    const runner = Result.getOrThrow(createRetainedHistorySchedulerRun(
      checkpoint,
      multiScope,
      {
        maximumInvocations: 1,
        maximumDirectoryPages: 1,
        maximumMaintenancePages: 1,
        maximumRunMilliseconds: 1_000,
        maximumInvocationMilliseconds: 100,
        settlementReserveMilliseconds: 10,
      },
    ));

    await expect(runEffect(runner.runEffect())).resolves.toMatchObject({
      kind: "busy",
    });
    expect(runs).toBe(0);
  });

  it("does not renew when the next operation lacks overall-run headroom", async () => {
    const events: string[] = [];
    const checkpoint = checkpointFixture(events, []);
    const multiScope: RetainedHistoryMultiScopeMaintenance = Object.freeze({
      configuration: Object.freeze({
        maximumDirectoryPagesPerInvocation: 1,
        maximumMaintenancePagesPerInvocation: 1,
      }),
      runEffect: () => TestClock.adjust("895 millis").pipe(
        Effect.as(multiScopeReceipt(schedulerContinuation())),
      ),
    });
    const runner = Result.getOrThrow(createRetainedHistorySchedulerRun(
      checkpoint,
      multiScope,
      {
        maximumInvocations: 2,
        maximumDirectoryPages: 2,
        maximumMaintenancePages: 2,
        maximumRunMilliseconds: 1_000,
        maximumInvocationMilliseconds: 100,
        settlementReserveMilliseconds: 10,
      },
    ));

    await expect(runEffect(
      runner.runEffect().pipe(Effect.provide(TestClock.layer())),
    )).resolves.toMatchObject({ kind: "completed", reason: "timeBudget" });
    expect(events).toEqual(["acquire", "checkpoint:evidence", "release"]);
  });

  it("captures mutable policy and capability members exactly once", async () => {
    const events: string[] = [];
    const baseCheckpoint = checkpointFixture(events, []);
    const mutableCheckpoint = { ...baseCheckpoint };
    const mutableConfiguration = {
      maximumDirectoryPagesPerInvocation: 1,
      maximumMaintenancePagesPerInvocation: 1,
    };
    const mutableMultiScope = {
      configuration: mutableConfiguration,
      runEffect: () => Effect.succeed(multiScopeReceipt(null)),
    };
    const mutablePolicy = {
      maximumInvocations: 1,
      maximumDirectoryPages: 1,
      maximumMaintenancePages: 1,
      maximumRunMilliseconds: 1_000,
      maximumInvocationMilliseconds: 100,
      settlementReserveMilliseconds: 10,
    };
    const runner = Result.getOrThrow(createRetainedHistorySchedulerRun(
      mutableCheckpoint,
      mutableMultiScope,
      mutablePolicy,
    ));

    mutableCheckpoint.acquireEffect = () => Effect.die("late acquire");
    mutableCheckpoint.checkpointEffect = () => Effect.die("late checkpoint");
    mutableCheckpoint.releaseEffect = () => Effect.die("late release");
    mutableMultiScope.runEffect = () => Effect.die("late maintenance");
    mutableConfiguration.maximumDirectoryPagesPerInvocation = 100;
    mutableConfiguration.maximumMaintenancePagesPerInvocation = 100;
    mutablePolicy.maximumInvocations = 100;
    mutablePolicy.maximumDirectoryPages = 100;
    mutablePolicy.maximumMaintenancePages = 100;

    await expect(runEffect(runner.runEffect())).resolves.toMatchObject({
      kind: "completed",
      reason: "cycleExhausted",
      invocations: 1,
    });
    expect(events).toEqual(["acquire", "checkpoint:null", "release"]);
  });
});

function directoryFixture(options: {
  readonly first: RetainedHistorySchedulerDirectoryItem;
  readonly second: RetainedHistorySchedulerDirectoryItem;
}): RetainedHistorySchedulerDirectory {
  return Object.freeze({
    discoverEffect: (input: unknown) => Effect.sync(() => {
      const continuing = typeof input === "object" && input !== null &&
        "continuation" in input;
      return continuing
        ? Object.freeze({ items: Object.freeze([options.second]), continuation: null })
        : Object.freeze({
          items: Object.freeze([options.first]),
          continuation: Object.freeze({
            codecVersion: 1 as const,
            highWaterScopeId: HIGH_WATER,
            lastScopeId: SCOPE_ONE,
          }),
        });
    }),
    resolveEffect: () => Effect.succeed(options.second),
  });
}

function failedItem(
  deploymentId: string,
  scopeId: typeof SCOPE_ONE,
): Extract<RetainedHistorySchedulerDirectoryItem, { kind: "failed" }> {
  return Object.freeze({
    kind: "failed",
    deploymentId,
    scopeId,
    reason: "authorityUnavailable",
  });
}

function readyItem(
  deploymentId: string,
  scopeId: typeof SCOPE_TWO,
  runEffect: Extract<
    RetainedHistorySchedulerDirectoryItem,
    { readonly kind: "ready" }
  >["maintenance"]["runEffect"],
): Extract<RetainedHistorySchedulerDirectoryItem, { kind: "ready" }> {
  return Object.freeze({
    kind: "ready",
    deploymentId,
    scopeId,
    maximumPagesPerRun: 1,
    maintenance: Object.freeze({ runEffect }),
  });
}

function maintenanceReceipt(
  deploymentId: string,
  scopeId: typeof SCOPE_TWO,
  status: RetainedHistoryMaintenanceReceipt["status"],
  stopReason: RetainedHistoryMaintenanceReceipt["stopReason"],
): RetainedHistoryMaintenanceReceipt {
  return Object.freeze({
    status,
    stopReason,
    deploymentId,
    scopeId,
    retainedFloor: CommitSeqSchema.make(3n),
    elapsedMilliseconds: 1,
    pagesExecuted: 1,
    commitPagesExecuted: 1,
    indexPagesExecuted: 0,
    appRowPagesExecuted: 0,
    deletedCommitCount: 1,
    deletedChangeCount: 1,
    deletedIndexRevisionCount: 0,
    deletedAppRowRevisionCount: 0,
    continuation: null,
  });
}

function maintenanceEvidence(
  deploymentId: string,
  scopeId: typeof SCOPE_TWO,
) {
  return Object.freeze({
    version: "flarex.retained-history-maintenance-continuation.v1" as const,
    deploymentId,
    scopeId,
    retainedFloor: "3",
    authority: Object.freeze({
      physicalLocator: Object.freeze({
        kind: "shared_database" as const,
        databaseKey: "retained-history-run-test",
        schemaName: "public",
      }),
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: "1",
      epoch: ScopeEpochSchema.make("epoch-retained-history-run-test"),
    }),
    phase: Object.freeze({ kind: "commitHistory" as const }),
  });
}

interface TestRun {
  readonly kind: "testRun";
}

type TestOperationError = TestCheckpointError | TestConfirmedRollback;

function checkpointFixture(
  events: string[],
  checkpointInputs: Array<EncodedRetainedHistorySchedulerContinuationV1 | null>,
  acquireResult: Effect.Success<ReturnType<RetainedHistorySchedulerCheckpointPort<
    TestRun,
    never,
    TestOperationError,
    TestOperationError,
    TestOperationError,
    TestOperationError,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback
  >["acquireEffect"]>> = Object.freeze({
    kind: "acquired",
    run: Object.freeze({ kind: "testRun" }),
    claimExpiresAt: LATER,
    continuation: null,
  }),
) {
  const port: RetainedHistorySchedulerCheckpointPort<
    TestRun,
    never,
    TestOperationError,
    TestOperationError,
    TestOperationError,
    TestOperationError,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback,
    TestConfirmedRollback
  > = Object.freeze({
    configuration: Result.succeed(Object.freeze({
      claimDurationMilliseconds: 1_000,
    })),
    acquireEffect: () => Effect.sync(() => {
      events.push("acquire");
      return acquireResult;
    }),
    renewEffect: () => Effect.sync(() => {
      events.push("renew");
      return Object.freeze({ kind: "renewed" as const, claimExpiresAt: LATER });
    }),
    checkpointEffect: (
      _run: TestRun,
      continuation: EncodedRetainedHistorySchedulerContinuationV1 | null,
    ) => Effect.sync(() => {
      events.push(`checkpoint:${continuation === null ? "null" : "evidence"}`);
      checkpointInputs.push(continuation);
      return Object.freeze({ kind: "checkpointed" as const, checkpointSequence: 1n });
    }),
    releaseEffect: () => Effect.sync(() => {
      events.push("release");
      return Object.freeze({ kind: "released" as const, nextRunAt: LATER });
    }),
    isAcquireConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "acquire",
    isRenewConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "renew",
    isCheckpointConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "checkpoint",
    isReleaseConfirmedRollback: (
      error: TestOperationError,
    ): error is TestConfirmedRollback =>
      error instanceof TestConfirmedRollback && error.operation === "release",
  });
  return port;
}

function schedulerContinuation(): RetainedHistorySchedulerContinuationV1 {
  return Object.freeze({
    version: "flarex.retained-history-scheduler-continuation.v1",
    directory: Object.freeze({
      kind: "continuing",
      continuation: Object.freeze({
        codecVersion: 1,
        highWaterScopeId: HIGH_WATER,
        lastScopeId: SCOPE_ONE,
      }),
    }),
    activeScope: null,
  });
}

function multiScopeReceipt(
  continuation: RetainedHistorySchedulerContinuationV1 | null,
): RetainedHistoryMultiScopeMaintenanceReceiptV1 {
  return Object.freeze({
    version: "flarex.retained-history-multi-scope-maintenance-receipt.v1",
    stopReason: continuation === null ? "cycleExhausted" : "maintenanceSettled",
    directoryPagesRead: 1,
    scopeVisits: 1,
    scopesFailed: 0,
    maintenanceRuns: 1,
    maintenance: maintenanceReceipt(
      "deployment_two",
      SCOPE_TWO,
      continuation === null ? "maintenanceComplete" : "maintenancePaused",
      continuation === null ? "exhausted" : "pageBudget",
    ),
    continuation,
  });
}
