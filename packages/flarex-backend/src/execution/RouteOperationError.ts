import { Data } from "effect";
import { HttpError } from "../http";
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
)<{
  readonly operation: ExecutionRouteOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

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
  if (cause instanceof HttpError) {
    return new ExecutionRouteOperationError({
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new ExecutionRouteOperationError({
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export function executionRouteOperationErrorToHttpError(
  error: ExecutionRouteOperationError,
): HttpError {
  return new HttpError(error.status, error.message);
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
