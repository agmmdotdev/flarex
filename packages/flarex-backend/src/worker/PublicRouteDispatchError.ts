import { Data, Effect } from "effect";
import { HttpError } from "../http";
import { invokeErrorResponse } from "../invoke";
import { PartitionRequestError } from "../transaction";

export type PublicWorkerDispatchSource =
  | "execution-start"
  | "execution-start-response"
  | "execution-action"
  | "scheduler-delivery-reconcile"
  | "scheduler-connection-reconcile"
  | "scheduler-dead-letter-deliveries"
  | "scheduler-cleanup-connections"
  | "scheduler-rerun-subscriptions"
  | "scheduler-trigger-subscriptions"
  | "registry-deployments"
  | "deployment-active-read"
  | "deployment-read-push"
  | "deployment-start-push-analyze"
  | "deployment-start-push-store-artifact"
  | "deployment-start-push"
  | "deployment-start-analyzed-push"
  | "deployment-finish-push-artifact"
  | "deployment-finish-push"
  | "deployment-abandon-push"
  | "invoke-execute"
  | "partition-begin"
  | "partition-commit"
  | "partition-schema-cache"
  | "partition-document-read"
  | "partition-index-read"
  | "live-query-delivery"
  | "connection-sync"
  | "deployment-scheduler"
  | "delivery-wake";

export class PublicWorkerDispatchError
  extends Data.TaggedError("PublicWorkerDispatchError")<{
    readonly source: PublicWorkerDispatchSource;
    readonly status: number;
    readonly message: string;
    readonly cause: unknown;
  }> {}

export class PublicWorkerJsonRouteError
  extends Data.TaggedError("PublicWorkerJsonRouteError")<{
    readonly adapterError: HttpError;
    readonly cause: unknown;
  }> {}

export class PublicWorkerInvokeAdapterRouteError
  extends Data.TaggedError("PublicWorkerInvokeAdapterRouteError")<{
    readonly adapterError: HttpError | PartitionRequestError;
    readonly cause: unknown;
  }> {}

export type PublicWorkerRouteError =
  | PublicWorkerJsonRouteError
  | PublicWorkerInvokeAdapterRouteError;

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

export function publicWorkerJsonRouteError(
  adapterError: HttpError,
  cause: unknown = adapterError,
): PublicWorkerJsonRouteError {
  return new PublicWorkerJsonRouteError({ adapterError, cause });
}

export function publicWorkerInvokeRouteError(
  adapterError: HttpError | PartitionRequestError,
  cause: unknown = adapterError,
): PublicWorkerInvokeAdapterRouteError {
  return new PublicWorkerInvokeAdapterRouteError({ adapterError, cause });
}

export function publicWorkerRouteErrorToResponse(error: PublicWorkerRouteError): Response {
  if (error instanceof PublicWorkerInvokeAdapterRouteError) {
    return invokeErrorResponse(error.adapterError);
  }
  return Response.json(
    { error: error.adapterError.message },
    { status: error.adapterError.status },
  );
}

export const publicWorkerDispatchErrorToHttpErrorEffect = Effect.fn(
  "PublicRouteDispatchError.toHttpError",
)(function* (
  error: PublicWorkerDispatchError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(publicWorkerDispatchErrorToHttpError(error));
});

export function publicWorkerDispatchErrorToAdapterError(
  error: PublicWorkerDispatchError,
): HttpError | PartitionRequestError {
  if (error.cause instanceof PartitionRequestError) {
    return error.cause;
  }
  return publicWorkerDispatchErrorToHttpError(error);
}
