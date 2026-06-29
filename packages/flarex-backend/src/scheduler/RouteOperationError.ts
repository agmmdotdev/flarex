import { Data } from "effect";
import { HttpError } from "../http";

export type SchedulerRouteOperation =
  | "delivery-reconcile"
  | "connection-reconcile"
  | "dead-letter-deliveries"
  | "cleanup-connections"
  | "rerun-subscriptions"
  | "continue-deliveries"
  | "continue-reruns"
  | "continue-connection-cleanup";

export class SchedulerRouteOperationError extends Data.TaggedError(
  "SchedulerRouteOperationError",
)<{
  readonly operation: SchedulerRouteOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export function schedulerRouteOperationError(
  operation: SchedulerRouteOperation,
  cause: unknown,
): SchedulerRouteOperationError {
  if (cause instanceof HttpError) {
    return new SchedulerRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new SchedulerRouteOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export function schedulerRouteOperationErrorToHttpError(
  error: SchedulerRouteOperationError,
): HttpError {
  return new HttpError(error.status, error.message);
}
