import { Data, Effect } from "effect";
import type { HttpError } from "../http";
import {
  routeOperationErrorFields,
  routeOperationErrorToHttpError as sharedRouteOperationErrorToHttpError,
  type RouteOperationErrorFields,
} from "../routeOperationError";

export type ConnectionRouteOperation =
  | "invalidate"
  | "deliver-live-query";

export class ConnectionRouteOperationError extends Data.TaggedError(
  "ConnectionRouteOperationError",
)<RouteOperationErrorFields<ConnectionRouteOperation>> {}

export function connectionRouteOperationError(
  operation: ConnectionRouteOperation,
  cause: unknown,
): ConnectionRouteOperationError {
  return new ConnectionRouteOperationError(
    routeOperationErrorFields(operation, cause),
  );
}

export function connectionRouteOperationErrorToHttpError(
  error: ConnectionRouteOperationError,
): HttpError {
  return sharedRouteOperationErrorToHttpError(error);
}

export const connectionRouteOperationErrorToHttpErrorEffect = Effect.fn(
  "ConnectionRouteOperationError.toHttpError",
)(function* (
  error: ConnectionRouteOperationError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(connectionRouteOperationErrorToHttpError(error));
});
