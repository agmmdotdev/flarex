import { Data } from "effect";
import { HttpError } from "../http";

export type PublicWorkerDispatchSource =
  | "execution-start"
  | "execution-start-response"
  | "execution-action"
  | "partition-commit"
  | "partition-schema-cache"
  | "live-query-delivery"
  | "delivery-wake";

export class PublicWorkerDispatchError
  extends Data.TaggedError("PublicWorkerDispatchError")<{
    readonly source: PublicWorkerDispatchSource;
    readonly status: number;
    readonly message: string;
    readonly cause: unknown;
  }> {}

export function publicWorkerDispatchError(
  source: PublicWorkerDispatchSource,
  cause: unknown,
): PublicWorkerDispatchError {
  if (cause instanceof HttpError) {
    return new PublicWorkerDispatchError({
      source,
      status: cause.status,
      message: cause.message,
      cause,
    });
  }
  return new PublicWorkerDispatchError({
    source,
    status: 500,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

export function publicWorkerDispatchErrorToHttpError(
  error: PublicWorkerDispatchError,
): HttpError {
  return new HttpError(error.status, error.message);
}
