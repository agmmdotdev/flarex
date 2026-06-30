import { Data, Effect } from "effect";
import { HttpError } from "../http";
import {
  decodeSchedulerCleanupConnectionsPayload,
  decodeSchedulerCleanupConnectionsResponse,
  decodeSchedulerExpiredConnectionDeploymentsPayload,
  decodeSchedulerExpiredConnectionDeploymentsResponse,
  SchedulerResponseError,
  schedulerResponseErrorToHttpError,
  SchedulerResponsePayloadError,
  schedulerResponsePayloadErrorToHttpError,
  type ExecutorCleanupLiveQueryConnectionsResult,
  type ExpiredConnectionDeploymentsResult,
} from "./Responses";

export type SchedulerMaintenanceOperation =
  | "cleanupConnections"
  | "expiredConnectionDeployments";

export type SchedulerMaintenanceFetch = (
  path: string,
  body: unknown,
) => Promise<Response>;

export class SchedulerMaintenanceRequestError extends Data.TaggedError(
  "SchedulerMaintenanceRequestError",
)<{
  readonly operation: SchedulerMaintenanceOperation;
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}

export type SchedulerMaintenanceBoundaryError =
  | SchedulerMaintenanceRequestError
  | SchedulerResponseError
  | SchedulerResponsePayloadError;

export const expiredConnectionDeploymentsEffect = Effect.fn(
  "SchedulerMaintenance.expiredConnectionDeployments",
)(
  function* (
    schedulerFetch: SchedulerMaintenanceFetch,
    body: Record<string, unknown>,
  ): Effect.fn.Return<
    ExpiredConnectionDeploymentsResult,
    SchedulerMaintenanceBoundaryError
  > {
    const response = yield* requestSchedulerMaintenance(
      schedulerFetch,
      "expiredConnectionDeployments",
      "/maintenance/live-queries/expired-connection-deployments",
      body,
    );
    const payload = yield* decodeSchedulerExpiredConnectionDeploymentsResponse<unknown>(
      response,
    );
    return yield* decodeSchedulerExpiredConnectionDeploymentsPayload(payload);
  },
);

export const cleanupExpiredLiveQueryConnectionsEffect = Effect.fn(
  "SchedulerMaintenance.cleanupExpiredLiveQueryConnections",
)(
  function* (
    schedulerFetch: SchedulerMaintenanceFetch,
    body: {
      deploymentId: string;
      projectId: string;
      expiredAt?: string;
    },
  ): Effect.fn.Return<
    ExecutorCleanupLiveQueryConnectionsResult,
    SchedulerMaintenanceBoundaryError
  > {
    const response = yield* requestSchedulerMaintenance(
      schedulerFetch,
      "cleanupConnections",
      "/maintenance/live-queries/connections/cleanup",
      body,
    );
    const payload = yield* decodeSchedulerCleanupConnectionsResponse<unknown>(
      response,
    );
    return yield* decodeSchedulerCleanupConnectionsPayload(payload);
  },
);

export function isSchedulerMaintenanceBoundaryError(
  error: unknown,
): error is SchedulerMaintenanceBoundaryError {
  return error instanceof SchedulerMaintenanceRequestError ||
    error instanceof SchedulerResponseError ||
    error instanceof SchedulerResponsePayloadError;
}

export function schedulerMaintenanceBoundaryErrorToHttpError(
  error: SchedulerMaintenanceBoundaryError,
): HttpError {
  if (error instanceof SchedulerMaintenanceRequestError) {
    return new HttpError(error.status, error.message);
  }
  if (error instanceof SchedulerResponseError) {
    return schedulerResponseErrorToHttpError(error);
  }
  return schedulerResponsePayloadErrorToHttpError(error);
}

function requestSchedulerMaintenance(
  schedulerFetch: SchedulerMaintenanceFetch,
  operation: SchedulerMaintenanceOperation,
  path: string,
  body: unknown,
): Effect.Effect<Response, SchedulerMaintenanceRequestError> {
  return Effect.tryPromise({
    try: () => schedulerFetch(path, body),
    catch: error =>
      new SchedulerMaintenanceRequestError({
        operation,
        status: 500,
        message: errorMessage(error),
        cause: error,
      }),
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
