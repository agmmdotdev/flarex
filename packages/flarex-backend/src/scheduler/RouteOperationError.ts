import { Data } from "effect";
import type { HttpError } from "../http";
import {
  routeOperationErrorFields,
  routeOperationErrorToHttpError as sharedRouteOperationErrorToHttpError,
  type RouteOperationErrorFields,
} from "../routeOperationError";

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
)<RouteOperationErrorFields<SchedulerRouteOperation>> {}

export function schedulerRouteOperationError(
  operation: SchedulerRouteOperation,
  cause: unknown,
): SchedulerRouteOperationError {
  return new SchedulerRouteOperationError(
    routeOperationErrorFields(operation, cause),
  );
}

export function schedulerRouteOperationErrorToHttpError(
  error: SchedulerRouteOperationError,
): HttpError {
  return sharedRouteOperationErrorToHttpError(error);
}
