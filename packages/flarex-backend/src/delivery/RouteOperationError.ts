import { Data } from "effect";
import { HttpError } from "../http";

export type DeliveryRouteOperation =
  | "wake"
  | "continue";

export class DeliveryRouteOperationError extends Data.TaggedError(
  "DeliveryRouteOperationError",
)<{
  readonly operation: DeliveryRouteOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export function deliveryRouteOperationError(
  operation: DeliveryRouteOperation,
  cause: unknown,
): DeliveryRouteOperationError {
  if (cause instanceof HttpError) {
    return new DeliveryRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new DeliveryRouteOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export function deliveryRouteOperationErrorToHttpError(
  error: DeliveryRouteOperationError,
): HttpError {
  return new HttpError(error.status, error.message);
}
