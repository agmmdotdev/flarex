import {
  decodeStandardApplicationTaskCancellationReason,
  requestStandardApplicationTaskCancellation,
  StandardApplicationTaskCancellation,
  type StandardApplicationTaskCancellationError,
  type StandardApplicationTaskCancellationReceipt,
} from
  "@flarex/standard-application-invocation/internal/standard-application-task-cancellation";
import { Data, Effect, Result } from "effect";

import { inspectTaskRun, type TaskRun } from "./Task.js";

export interface CancelTaskOptions {
  readonly reason?: string;
}

class CancelTaskOptionsFailure extends Data.TaggedError(
  "CancelTaskOptionsError",
)<{
  readonly field: "reason";
  readonly reason: "invalid_message";
}> {}

export type CancelTaskOptionsError = CancelTaskOptionsFailure;
export type CancelTaskError =
  | CancelTaskOptionsError
  | StandardApplicationTaskCancellationError;

export type TaskCancellationStatus =
  | "cancellationRequested"
  | "cancelled"
  | "alreadyRequested"
  | "alreadyTerminal";

export interface CancelTaskResult {
  readonly runId: TaskRun<unknown>["runId"];
  readonly observedAtMs:
    StandardApplicationTaskCancellationReceipt["observedAtMs"];
  readonly runVersion:
    StandardApplicationTaskCancellationReceipt["runVersion"];
  readonly status: TaskCancellationStatus;
  readonly replayed: boolean;
}

/** Requests cancellation without waiting for execution to stop. */
export const cancelTask = Effect.fn("Application.cancelTask")(function* <Output>(
  run: TaskRun<Output>,
  options: CancelTaskOptions = {},
): Effect.fn.Return<
  CancelTaskResult,
  CancelTaskError,
  StandardApplicationTaskCancellation
> {
  inspectTaskRun(run);
  const reason = yield* Effect.fromResult(
    decodeStandardApplicationTaskCancellationReason(
      options.reason ?? null,
    ).pipe(Result.mapError(() => new CancelTaskOptionsFailure({
      field: "reason",
      reason: "invalid_message",
    }))),
  );
  const receipt = yield* requestStandardApplicationTaskCancellation(
    run.runId,
    reason,
  );
  return projectCancellationReceipt(run.runId, receipt);
});

function projectCancellationReceipt(
  runId: CancelTaskResult["runId"],
  receipt: StandardApplicationTaskCancellationReceipt,
): CancelTaskResult {
  let status: TaskCancellationStatus;
  switch (receipt.outcome.kind) {
    case "cancellation_requested":
      status = "cancellationRequested";
      break;
    case "terminal_cancelled":
      status = "cancelled";
      break;
    case "current": {
      switch (receipt.outcome.reason) {
        case "already_requested":
          status = "alreadyRequested";
          break;
        case "already_terminal":
          status = "alreadyTerminal";
          break;
        default: {
          const unhandledReason: never = receipt.outcome.reason;
          throw new TypeError(
            `Unhandled Task cancellation reason: ${String(unhandledReason)}`,
          );
        }
      }
      break;
    }
    default: {
      const unhandledOutcome: never = receipt.outcome;
      throw new TypeError(
        `Unhandled Task cancellation outcome: ${String(unhandledOutcome)}`,
      );
    }
  }

  return Object.freeze({
    runId,
    observedAtMs: receipt.observedAtMs,
    runVersion: receipt.runVersion,
    status,
    replayed: receipt.disposition === "idempotent",
  });
}
