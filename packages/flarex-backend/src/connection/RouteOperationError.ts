import { Data, Effect } from "effect";
import { HttpError } from "../http";

export type ConnectionRouteOperation =
  | "invalidate"
  | "deliver-live-query";

export class ConnectionRouteOperationError extends Data.TaggedError(
  "ConnectionRouteOperationError",
)<{
  readonly operation: ConnectionRouteOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export function connectionRouteOperationError(
  operation: ConnectionRouteOperation,
  cause: unknown,
): ConnectionRouteOperationError {
  if (cause instanceof HttpError) {
    return new ConnectionRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new ConnectionRouteOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export function connectionRouteOperationErrorToHttpError(
  error: ConnectionRouteOperationError,
): HttpError {
  return new HttpError(error.status, error.message);
}

export const connectionRouteOperationErrorToHttpErrorEffect = Effect.fn(
  "ConnectionRouteOperationError.toHttpError",
)(function* (
  error: ConnectionRouteOperationError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(connectionRouteOperationErrorToHttpError(error));
});
