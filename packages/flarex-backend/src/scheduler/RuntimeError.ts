import { Data } from "effect";
import { HttpError } from "../http";

export type SchedulerContinuationOperation =
  | "delivery-reconcile"
  | "connection-cleanup";

export class SchedulerContinuationCursorError extends Data.TaggedError(
  "SchedulerContinuationCursorError",
)<{
  readonly operation: SchedulerContinuationOperation;
  readonly message: string;
}> {}

export class SchedulerConnectionTargetError extends Data.TaggedError(
  "SchedulerConnectionTargetError",
)<{
  readonly connectionId: string;
  readonly message: string;
}> {}

export type SchedulerRuntimeError =
  | SchedulerContinuationCursorError
  | SchedulerConnectionTargetError;

export function missingSchedulerContinuationCursor(
  operation: SchedulerContinuationOperation,
): SchedulerContinuationCursorError {
  return new SchedulerContinuationCursorError({
    operation,
    message: schedulerContinuationCursorMessage(operation),
  });
}

export function invalidSchedulerConnectionTarget(
  connectionId: string,
): SchedulerConnectionTargetError {
  return new SchedulerConnectionTargetError({
    connectionId,
    message: `Invalid live query connection id ${connectionId}.`,
  });
}

export function isSchedulerRuntimeError(
  error: unknown,
): error is SchedulerRuntimeError {
  return (
    error instanceof SchedulerContinuationCursorError ||
    error instanceof SchedulerConnectionTargetError
  );
}

export function schedulerRuntimeErrorToHttpError(
  error: SchedulerRuntimeError,
): HttpError {
  return new HttpError(502, error.message);
}

function schedulerContinuationCursorMessage(
  operation: SchedulerContinuationOperation,
): string {
  if (operation === "delivery-reconcile") {
    return "Pending delivery deployment scan returned hasMore without nextCursor.";
  }
  return "Expired connection deployment scan returned hasMore without nextCursor.";
}
