import { HttpError } from "./http";

export type RouteOperationErrorFields<Operation extends string> = {
  readonly operation: Operation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
};

/** Preserves the common backend route policy for one foreign operation cause. */
export function routeOperationErrorFields<Operation extends string>(
  operation: Operation,
  cause: unknown,
): RouteOperationErrorFields<Operation> {
  if (cause instanceof HttpError) {
    return {
      operation,
      status: cause.status,
      message: cause.message,
      cause,
    };
  }
  return {
    operation,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  };
}

export function routeOperationErrorToHttpError(
  error: Pick<RouteOperationErrorFields<string>, "status" | "message">,
): HttpError {
  return new HttpError(error.status, error.message);
}
