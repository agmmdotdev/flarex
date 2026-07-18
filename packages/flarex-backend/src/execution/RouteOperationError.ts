import { Data } from "effect";
import type { HttpError } from "../http";
import {
  routeOperationErrorFields,
  routeOperationErrorToHttpError as sharedRouteOperationErrorToHttpError,
  type RouteOperationErrorFields,
} from "../routeOperationError";
import {
  isTransactionOperationError,
  PartitionRequestError,
  PartitionResponseError,
  transactionOperationErrorMessage,
} from "../transaction";

export type ExecutionRouteOperation =
  | "start"
  | "syscall"
  | "finish";

export class ExecutionRouteOperationError extends Data.TaggedError(
  "ExecutionRouteOperationError",
)<RouteOperationErrorFields<ExecutionRouteOperation>> {}

export function executionRouteOperationError(
  operation: ExecutionRouteOperation,
  cause: unknown,
): ExecutionRouteOperationError {
  if (isTransactionOperationError(cause)) {
    return new ExecutionRouteOperationError({
      operation,
      status: cause instanceof PartitionResponseError ? cause.status : 500,
      message: transactionOperationErrorMessage(cause),
      cause,
    });
  }
  return new ExecutionRouteOperationError(
    routeOperationErrorFields(operation, cause),
  );
}

export function executionRouteOperationErrorToHttpError(
  error: ExecutionRouteOperationError,
): HttpError {
  return sharedRouteOperationErrorToHttpError(error);
}

export function executionRouteOperationErrorToAdapterError(
  error: ExecutionRouteOperationError,
): HttpError | PartitionRequestError {
  if (error.cause instanceof PartitionRequestError) {
    return error.cause;
  }
  if (error.cause instanceof PartitionResponseError) {
    return new PartitionRequestError(error.cause.status, error.cause.body);
  }
  return executionRouteOperationErrorToHttpError(error);
}
