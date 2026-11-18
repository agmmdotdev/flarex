// Adapted from Trigger.dev commit f10bc23785e569e5d917318cf2033aabdbe96a0b,
// multiple mapped upstream paths. See trigger-source-map.json and THIRD_PARTY_NOTICES.md.
// Copyright (c) 2023 Trigger.dev.
import { Effect, Option } from "effect";
import type { BorrowedAttemptStart } from "./borrowedAttemptStart.js";
import { MAX_TASK_RUN_ATTEMPTS } from "./consts.js";
import { ExecutionSnapshotSystem, type ExecutionSnapshotSystemOptions } from "./executionSnapshotSystem.js";
import {
  AttemptStartValidationError,
  type AttemptStartOutcome, type ExecutionSnapshot, type FailedRun,
  type MaxAttemptsRunError, type StartRunAttemptInput,
} from "./model.js";
import { isFinishedOrPendingFinished } from "./statuses.js";

export class RunAttemptSystem {
  readonly startRunAttempt: <StoreError, StoreEnvironment>(
    operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
    input: StartRunAttemptInput,
  ) => Effect.Effect<AttemptStartOutcome, AttemptStartValidationError | StoreError, StoreEnvironment>;

  constructor(options: ExecutionSnapshotSystemOptions) {
    const executionSnapshotSystem = new ExecutionSnapshotSystem(options);

    this.startRunAttempt = Effect.fn("RunAttemptSystem.startRunAttempt")(
      function* <StoreError, StoreEnvironment>(
        operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
        input: StartRunAttemptInput,
      ): Effect.fn.Return<AttemptStartOutcome, AttemptStartValidationError | StoreError, StoreEnvironment> {
        // The source destructures these primitive arguments before awaiting.
        const { snapshotId, workerId, runnerId, isWarmStart } = input;
        const latestSnapshot = yield* operation.readLatestSnapshot();

        if (latestSnapshot.id !== snapshotId) {
          return yield* new AttemptStartValidationError({
            reason: "snapshotChanged", message: "Snapshot changed inside startRunAttempt", statusCode: 409,
            runId: operation.runId, snapshotId, latestSnapshotId: latestSnapshot.id,
          });
        }

        const taskRunOption = yield* operation.findRun();
        if (Option.isNone(taskRunOption)) {
          return yield* new AttemptStartValidationError({
            reason: "runNotFound", message: "Task run not found", statusCode: 404,
            runId: operation.runId, snapshotId,
          });
        }
        const taskRun = taskRunOption.value;

        if (isFinishedOrPendingFinished(latestSnapshot.executionStatus)) {
          return yield* new AttemptStartValidationError({
            reason: "alreadyFinished", message: "Task run is already finished", statusCode: 400,
            runId: operation.runId, snapshotId,
          });
        }

        if (!taskRun.lockedById) {
          return yield* new AttemptStartValidationError({
            reason: "runNotLocked", message: "Task run is not locked", statusCode: 400,
            runId: operation.runId, snapshotId,
          });
        }

        const nextAttemptNumber = (taskRun.attemptNumber ?? 0) + 1;

        if (nextAttemptNumber > MAX_TASK_RUN_ATTEMPTS) {
          // The source synthetic completion forwards run/snapshot only; start
          // worker/runner bindings must not reach its terminal snapshot.
          const result = yield* attemptFailed(executionSnapshotSystem, operation, snapshotId);
          // The source terminalizes then throws. The trusted outer owner must
          // settle this tentative result before projecting the expected refusal.
          return {
            kind: "startRefusedAfterTerminalization", ...result,
            refusal: { reason: "maxAttemptsReached", message: "Max attempts reached", statusCode: 400 },
          };
        }

        // The operation is already live/locked. Start, snapshot and durable
        // obligations share its one outer settlement, without a new transaction.
        const updatedRun = yield* operation.startAttempt({
          attemptNumber: nextAttemptNumber,
          ...(taskRun.attemptNumber === null ? { executedAtMs: operation.databaseTimeMs } : {}),
          isWarmStart: isWarmStart ?? false,
        });

        const snapshot = yield* executionSnapshotSystem.createExecutionSnapshot(operation, {
          run: { id: updatedRun.id, status: updatedRun.status, attemptNumber: updatedRun.attemptNumber },
          snapshot: {
            executionStatus: "EXECUTING",
            description: `Attempt created, starting execution${isWarmStart ? " (warm start)" : ""}`,
          },
          previousSnapshotId: latestSnapshot.id,
          completedWaitpoints: latestSnapshot.completedWaitpoints,
          ...(workerId === undefined ? {} : { workerId }),
          ...(runnerId === undefined ? {} : { runnerId }),
        });

        if (taskRun.ttl) {
          yield* operation.recordIntent({ kind: "expireRunRetirement", runId: taskRun.id });
        }

        // Product/environment hydration is excluded. The core issuer has
        // already bound an admitted definition/runtime to this borrowed run.
        yield* operation.recordIntent({
          kind: "runAttemptStarted", atMs: operation.databaseTimeMs, runId: updatedRun.id,
          snapshotId: snapshot.id, attemptNumber: nextAttemptNumber,
        });

        return { kind: "started", run: updatedRun, snapshot };
      },
    );
  }
}

/** Only the synthetic max-attempt completion reached by start is admitted. */
const attemptFailed = Effect.fn("RunAttemptSystem.attemptFailed.maxAttempts")(
  function* <StoreError, StoreEnvironment>(
    executionSnapshotSystem: ExecutionSnapshotSystem,
    operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
    snapshotId: string,
  ): Effect.fn.Return<{ readonly run: FailedRun; readonly snapshot: ExecutionSnapshot },
    AttemptStartValidationError | StoreError, StoreEnvironment> {
    const latestSnapshot = yield* operation.readLatestSnapshot();

    if (latestSnapshot.id !== snapshotId) {
      return yield* new AttemptStartValidationError({
        reason: "snapshotChanged", message: "Snapshot ID doesn't match the latest snapshot", statusCode: 400,
        runId: operation.runId, snapshotId, latestSnapshotId: latestSnapshot.id,
      });
    }

    if (latestSnapshot.executionStatus === "FINISHED") {
      return yield* new AttemptStartValidationError({
        reason: "alreadyFinished", message: "Run is already finished", statusCode: 400,
        runId: operation.runId, snapshotId,
      });
    }

    yield* operation.clearBlockingWaitpoints();
    const failedAt = operation.databaseTimeMs;
    const error: MaxAttemptsRunError = {
      type: "INTERNAL_ERROR", code: "TASK_RUN_CRASHED", message: "Max attempts reached.",
    };

    // At the pin this error is neither cancellation nor OOM; it has no retry
    // settings and shouldLookupRetrySettings is false. The reached branch is
    // permanentlyFailRun, with runStatusFromError = CRASHED. Other retry policy
    // and product usage/machine reads are not exposed as an adapter callback.
    return yield* permanentlyFailRun(executionSnapshotSystem, operation, latestSnapshot, failedAt, error);
  },
);

const permanentlyFailRun = Effect.fn("RunAttemptSystem.permanentlyFailRun.maxAttempts")(
  function* <StoreError, StoreEnvironment>(
    executionSnapshotSystem: ExecutionSnapshotSystem,
    operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
    latestSnapshot: ExecutionSnapshot,
    failedAt: number,
    error: MaxAttemptsRunError,
  ): Effect.fn.Return<{ readonly run: FailedRun; readonly snapshot: ExecutionSnapshot }, StoreError, StoreEnvironment> {
    const run = yield* operation.failRunPermanently({ status: "CRASHED", completedAtMs: failedAt, error });

    const snapshot = yield* executionSnapshotSystem.createExecutionSnapshot(operation, {
      run: { id: run.id, status: run.status, attemptNumber: run.attemptNumber },
      snapshot: { executionStatus: "FINISHED", description: "Run failed" },
      previousSnapshotId: latestSnapshot.id,
    });

    yield* operation.recordIntent({ kind: "queueRelease", runId: run.id, removeFromWorkerQueue: true });

    if (run.associatedWaitpointId !== null) {
      yield* operation.recordIntent({
        kind: "completeAssociatedWaitpoint", runId: run.id, waitpointId: run.associatedWaitpointId,
        output: { value: JSON.stringify(error), isError: true },
      });
    }

    yield* operation.recordIntent({
      kind: "runFailed", atMs: failedAt, runId: run.id, status: run.status,
      error, attemptNumber: run.attemptNumber ?? 1,
    });

    yield* finalizeRun(operation);
    return { run, snapshot };
  },
);

const finalizeRun = Effect.fn("RunAttemptSystem.finalizeRun.unbatched")(
  function* <StoreError, StoreEnvironment>(
    operation: BorrowedAttemptStart<StoreError, StoreEnvironment>,
  ): Effect.fn.Return<void, StoreError, StoreEnvironment> {
    // Batches/Task hierarchies are outside the admitted single-run borrower.
    yield* operation.recordIntent({ kind: "heartbeatRetirement", runId: operation.runId });
  },
);
