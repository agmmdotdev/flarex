// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
import { Cause, Context, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { AttemptStartValidationError } from "../src/model.js";
import type { ExecutionSnapshot } from "../src/model.js";
import { RunAttemptSystem } from "../src/runAttemptSystem.js";
import {
  attemptRun,
  DATABASE_TIME_MS,
  executingSnapshot,
  failedRun,
  heartbeatTimeouts,
  latestSnapshot,
  PrimitiveFailure,
  RUN_ID,
  scriptedAttemptStart,
  startedRun,
  terminalSnapshot,
} from "./scriptedAttemptStart.js";

const engine = new RunAttemptSystem({ heartbeatTimeouts });
const input = { snapshotId: latestSnapshot.id };
const maxAttemptsError = {
  type: "INTERNAL_ERROR",
  code: "TASK_RUN_CRASHED",
  message: "Max attempts reached.",
} as const;

function causeOf<A, E>(exit: Exit.Exit<A, E>): Cause.Cause<E> {
  if (Exit.isSuccess(exit)) {
    throw new Error("Expected failure, received success");
  }
  return exit.cause;
}

function valueOf<A, E>(exit: Exit.Exit<A, E>): A {
  if (Exit.isFailure(exit)) {
    throw new Error("Expected success, received failure");
  }
  return exit.value;
}

// Source assertion family: pinned Trigger runAttemptSystem.test.ts:194-267.
// These are component witnesses; the script does not prove durable settlement.
describe("adopted RunAttemptSystem.startRunAttempt", () => {
  it("uses the source read/start path and requests the first executing attempt, snapshot and obligations", async () => {
    const { operation, requests } = scriptedAttemptStart();
    const result = await Effect.runPromise(engine.startRunAttempt(operation, input));

    expect(result).toEqual({ kind: "started", run: startedRun, snapshot: executingSnapshot });
    expect(requests).toEqual([
      { kind: "readLatestSnapshot" },
      { kind: "findRun" },
      { kind: "startAttempt", input: {
        attemptNumber: 1,
        executedAtMs: DATABASE_TIME_MS,
        isWarmStart: false,
      } },
      { kind: "createExecutionSnapshot", input: {
        run: { id: RUN_ID, status: "EXECUTING", attemptNumber: 1 },
        snapshot: { executionStatus: "EXECUTING", description: "Attempt created, starting execution" },
        previousSnapshotId: latestSnapshot.id,
        completedWaitpoints: latestSnapshot.completedWaitpoints,
      } },
      { kind: "recordIntent", intent: {
        kind: "heartbeatDue", runId: RUN_ID, snapshotId: executingSnapshot.id,
        availableAtMs: DATABASE_TIME_MS + heartbeatTimeouts.EXECUTING,
      } },
      { kind: "recordIntent", intent: {
        kind: "executionSnapshotCreated", runId: RUN_ID, snapshot: executingSnapshot,
        completedWaitpointIds: ["wait_completed"], atMs: DATABASE_TIME_MS,
      } },
      { kind: "recordIntent", intent: { kind: "expireRunRetirement", runId: RUN_ID } },
      { kind: "recordIntent", intent: {
        kind: "runAttemptStarted", runId: RUN_ID, snapshotId: executingSnapshot.id,
        attemptNumber: 1, atMs: DATABASE_TIME_MS,
      } },
    ]);
  });

  it("preserves first execution time on subsequent attempts and forwards warm worker/runner data", async () => {
    const previous = { ...latestSnapshot, attemptNumber: 4 };
    const returnedRun = { ...startedRun, attemptNumber: 5, executedAtMs: DATABASE_TIME_MS - 100_000 };
    const returnedSnapshot = { ...executingSnapshot, attemptNumber: 5 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous], run: Option.some({ ...attemptRun, attemptNumber: 4, ttl: null }),
      started: returnedRun, created: returnedSnapshot,
    });

    const result = await Effect.runPromise(engine.startRunAttempt(operation, {
      ...input, workerId: "worker_1", runnerId: "runner_1", isWarmStart: true,
    }));

    expect(result).toEqual({ kind: "started", run: returnedRun, snapshot: returnedSnapshot });
    expect(requests[2]).toEqual({
      kind: "startAttempt", input: { attemptNumber: 5, isWarmStart: true },
    });
    expect(requests[3]).toEqual({ kind: "createExecutionSnapshot", input: {
      run: { id: RUN_ID, status: "EXECUTING", attemptNumber: 5 },
      snapshot: { executionStatus: "EXECUTING", description: "Attempt created, starting execution (warm start)" },
      previousSnapshotId: previous.id,
      completedWaitpoints: previous.completedWaitpoints,
      workerId: "worker_1", runnerId: "runner_1",
    } });
    expect(requests.filter((request) => request.kind === "recordIntent").map((request) => request.intent.kind))
      .toEqual(["heartbeatDue", "executionSnapshotCreated", "runAttemptStarted"]);
  });

  it("rejects a changed snapshot before looking up even a missing run", async () => {
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [{ ...latestSnapshot, id: "snapshot_newer" }], run: Option.none(),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "snapshotChanged", message: "Snapshot changed inside startRunAttempt", statusCode: 409,
      runId: RUN_ID, snapshotId: latestSnapshot.id, latestSnapshotId: "snapshot_newer",
    })));
    expect(requests).toEqual([{ kind: "readLatestSnapshot" }]);
  });

  it("rejects a missing run before considering a finished snapshot", async () => {
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [{ ...latestSnapshot, executionStatus: "FINISHED" }], run: Option.none(),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "runNotFound", message: "Task run not found", statusCode: 404,
      runId: RUN_ID, snapshotId: latestSnapshot.id,
    })));
    expect(requests).toEqual([{ kind: "readLatestSnapshot" }, { kind: "findRun" }]);
  });

  it.each(["FINISHED", "PENDING_CANCEL"] as const)("rejects %s before an unlocked run or attempt cap", async (executionStatus) => {
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [{ ...latestSnapshot, executionStatus }],
      run: Option.some({ ...attemptRun, attemptNumber: 250, lockedById: null }),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "alreadyFinished", message: "Task run is already finished", statusCode: 400,
      runId: RUN_ID, snapshotId: latestSnapshot.id,
    })));
    expect(requests).toEqual([{ kind: "readLatestSnapshot" }, { kind: "findRun" }]);
  });

  it("rejects an unlocked run before reaching the attempt cap", async () => {
    const { operation, requests } = scriptedAttemptStart({
      run: Option.some({ ...attemptRun, attemptNumber: 250, lockedById: null }),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "runNotLocked", message: "Task run is not locked", statusCode: 400,
      runId: RUN_ID, snapshotId: latestSnapshot.id,
    })));
    expect(requests).toEqual([{ kind: "readLatestSnapshot" }, { kind: "findRun" }]);
  });

  it("starts ordinal 250 when the current ordinal is 249", async () => {
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [{ ...latestSnapshot, attemptNumber: 249 }],
      run: Option.some({ ...attemptRun, attemptNumber: 249 }),
      started: { ...startedRun, attemptNumber: 250 },
      created: { ...executingSnapshot, attemptNumber: 250 },
    });

    const result = await Effect.runPromise(engine.startRunAttempt(operation, input));

    expect(result.kind).toBe("started");
    expect(requests[2]).toEqual({ kind: "startAttempt", input: { attemptNumber: 250, isWarmStart: false } });
    expect(requests.some((request) => request.kind === "failRunPermanently")).toBe(false);
  });

  it("at ordinal 250 records permanent failure/finalization and returns a tentative terminal refusal without starting 251", async () => {
    const previous: ExecutionSnapshot = { ...latestSnapshot, attemptNumber: 250 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, previous], run: Option.some({ ...attemptRun, attemptNumber: 250 }),
      failed: failedRun, created: terminalSnapshot,
    });
    const exit = await Effect.runPromiseExit(engine.startRunAttempt(operation, input));

    expect(valueOf(exit)).toEqual({
      kind: "startRefusedAfterTerminalization", run: failedRun, snapshot: terminalSnapshot,
      refusal: { reason: "maxAttemptsReached", message: "Max attempts reached", statusCode: 400 },
    });
    expect(requests).toEqual([
      { kind: "readLatestSnapshot" },
      { kind: "findRun" },
      { kind: "readLatestSnapshot" },
      { kind: "clearBlockingWaitpoints" },
      { kind: "failRunPermanently", input: {
        status: "CRASHED", completedAtMs: DATABASE_TIME_MS, error: maxAttemptsError,
      } },
      { kind: "createExecutionSnapshot", input: {
        run: { id: RUN_ID, status: "CRASHED", attemptNumber: 250 },
        snapshot: { executionStatus: "FINISHED", description: "Run failed" },
        previousSnapshotId: previous.id,
      } },
      { kind: "recordIntent", intent: {
        kind: "executionSnapshotCreated", runId: RUN_ID, snapshot: terminalSnapshot,
        completedWaitpointIds: [], atMs: DATABASE_TIME_MS,
      } },
      { kind: "recordIntent", intent: { kind: "queueRelease", runId: RUN_ID, removeFromWorkerQueue: true } },
      { kind: "recordIntent", intent: {
        kind: "completeAssociatedWaitpoint", runId: RUN_ID, waitpointId: "wait_associated",
        output: { value: JSON.stringify(maxAttemptsError), isError: true },
      } },
      { kind: "recordIntent", intent: {
        kind: "runFailed", runId: RUN_ID, status: "CRASHED", attemptNumber: 250,
        error: maxAttemptsError, atMs: DATABASE_TIME_MS,
      } },
      { kind: "recordIntent", intent: { kind: "heartbeatRetirement", runId: RUN_ID } },
    ]);
  });

  it("does not request associated wait completion when the failed run has no waitpoint", async () => {
    const previous = { ...latestSnapshot, attemptNumber: 250 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, previous], run: Option.some({ ...attemptRun, attemptNumber: 250 }),
      failed: { ...failedRun, associatedWaitpointId: null }, created: terminalSnapshot,
    });
    await Effect.runPromise(engine.startRunAttempt(operation, input));

    expect(requests.filter((request) => request.kind === "recordIntent").map((request) => request.intent.kind))
      .toEqual(["executionSnapshotCreated", "queueRelease", "runFailed", "heartbeatRetirement"]);
  });

  it("does not forward start worker or runner bindings into the cap terminal snapshot", async () => {
    const previous = { ...latestSnapshot, attemptNumber: 250 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, previous], run: Option.some({ ...attemptRun, attemptNumber: 250 }),
      failed: failedRun, created: terminalSnapshot,
    });

    const result = await Effect.runPromise(engine.startRunAttempt(operation, {
      ...input, workerId: "start_worker", runnerId: "start_runner", isWarmStart: true,
    }));

    expect(result.kind).toBe("startRefusedAfterTerminalization");
    // The pinned cap branch calls attemptFailed without workerId/runnerId.
    expect(requests[5]).toEqual({ kind: "createExecutionSnapshot", input: {
      run: { id: RUN_ID, status: "CRASHED", attemptNumber: 250 },
      snapshot: { executionStatus: "FINISHED", description: "Run failed" },
      previousSnapshotId: previous.id,
    } });
  });

  it("retains the reached attemptFailed snapshot recheck before terminalization", async () => {
    const previous = { ...latestSnapshot, attemptNumber: 250 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, { ...previous, id: "snapshot_changed_during_failure" }],
      run: Option.some({ ...attemptRun, attemptNumber: 250 }),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "snapshotChanged", message: "Snapshot ID doesn't match the latest snapshot", statusCode: 400,
      runId: RUN_ID, snapshotId: latestSnapshot.id, latestSnapshotId: "snapshot_changed_during_failure",
    })));
    expect(requests).toEqual([
      { kind: "readLatestSnapshot" }, { kind: "findRun" }, { kind: "readLatestSnapshot" },
    ]);
  });

  it("refuses a newly finished snapshot at the reached attemptFailed recheck before writes", async () => {
    const previous = { ...latestSnapshot, attemptNumber: 250 };
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, { ...previous, executionStatus: "FINISHED" }],
      run: Option.some({ ...attemptRun, attemptNumber: 250 }),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(new AttemptStartValidationError({
      reason: "alreadyFinished", message: "Run is already finished", statusCode: 400,
      runId: RUN_ID, snapshotId: latestSnapshot.id,
    })));
    expect(requests).toEqual([
      { kind: "readLatestSnapshot" }, { kind: "findRun" }, { kind: "readLatestSnapshot" },
    ]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])("preserves a typed primitive failure at start request %i and requests nothing later", async (failAt) => {
    const failure = new PrimitiveFailure({ primitive: `start_request_${failAt}` });
    const { operation, requests } = scriptedAttemptStart({ failAt, failure: Effect.fail(failure) });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(failure));
    expect(Cause.hasDies(cause)).toBe(false);
    expect(Cause.hasInterrupts(cause)).toBe(false);
    expect(requests).toHaveLength(failAt);
  });

  it.each([3, 4, 5, 6, 7, 8, 9, 10, 11])("preserves a typed primitive failure at terminalization request %i without converting it into a domain outcome", async (failAt) => {
    const previous = { ...latestSnapshot, attemptNumber: 250 };
    const failure = new PrimitiveFailure({ primitive: `failure_request_${failAt}` });
    const { operation, requests } = scriptedAttemptStart({
      snapshots: [previous, previous], run: Option.some({ ...attemptRun, attemptNumber: 250 }),
      failed: failedRun, created: terminalSnapshot, failAt, failure: Effect.fail(failure),
    });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.findErrorOption(cause)).toEqual(Option.some(failure));
    expect(requests).toHaveLength(failAt);
  });

  it("preserves a defect after the attempt write and issues no snapshot notice or later obligation", async () => {
    const defect = new Error("snapshot adapter defect");
    const { operation, requests } = scriptedAttemptStart({ failAt: 4, failure: Effect.die(defect) });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.hasDies(cause)).toBe(true);
    expect(Cause.hasFails(cause)).toBe(false);
    expect(Cause.findDefect(cause)).toEqual(Result.succeed(defect));
    expect(requests.map((request) => request.kind)).toEqual([
      "readLatestSnapshot", "findRun", "startAttempt", "createExecutionSnapshot",
    ]);
  });

  it("preserves interruption during an intermediate primitive and requests nothing later", async () => {
    const { operation, requests } = scriptedAttemptStart({ failAt: 5, failure: Effect.interrupt });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    expect(Cause.hasInterruptsOnly(cause)).toBe(true);
    expect(requests).toHaveLength(5);
  });

  it("preserves the full mixed typed-failure, defect and interruption Cause", async () => {
    const failure = new PrimitiveFailure({ primitive: "mixed_snapshot_failure" });
    const defect = new Error("mixed adapter defect");
    const annotations = Context.make(Context.Service<string>("test/primitive-correlation"), "snapshot_write");
    const originalCause = Cause.annotate(
      Cause.combine(Cause.combine(Cause.fail(failure), Cause.die(defect)), Cause.interrupt(42)),
      annotations,
    );
    const { operation, requests } = scriptedAttemptStart({ failAt: 4, failure: Effect.failCause(originalCause) });
    const cause = causeOf(await Effect.runPromiseExit(engine.startRunAttempt(operation, input)));

    // Effect.fn adds trace annotations. Every original reason, payload and
    // annotation must survive; additional diagnostic traces are permitted.
    expect(cause.reasons.map((reason) => {
      switch (reason._tag) {
        case "Fail": return { tag: reason._tag, error: reason.error };
        case "Die": return { tag: reason._tag, defect: reason.defect };
        case "Interrupt": return { tag: reason._tag, fiberId: reason.fiberId };
      }
    })).toEqual([
      { tag: "Fail", error: failure },
      { tag: "Die", defect },
      { tag: "Interrupt", fiberId: 42 },
    ]);
    for (const reason of cause.reasons) {
      expect(reason.annotations.get("test/primitive-correlation")).toBe("snapshot_write");
      if (Cause.isFailReason(reason)) expect(reason.error).toBe(failure);
      if (Cause.isDieReason(reason)) expect(reason.defect).toBe(defect);
    }
    expect(Cause.hasFails(cause)).toBe(true);
    expect(Cause.hasDies(cause)).toBe(true);
    expect(Cause.hasInterrupts(cause)).toBe(true);
    expect(requests).toHaveLength(4);
  });
});
