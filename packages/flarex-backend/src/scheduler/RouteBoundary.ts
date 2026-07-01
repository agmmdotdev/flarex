import { Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import type { Env } from "../types";
import {
  decodeSchedulerCleanupConnectionsPayload,
  decodeSchedulerConnectionReconcilePayload,
  decodeSchedulerDeadLetterDeliveriesPayload,
  decodeSchedulerDeliveryReconcilePayload,
  decodeSchedulerRerunSubscriptionsPayload,
  SchedulerRoutePayloadError,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerRerunSubscriptionsRequest,
} from "./Requests";

export {
  SchedulerRoutePayloadError,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerExpiredConnectionDeploymentCursor,
  type SchedulerPendingDeploymentCursor,
  type SchedulerRerunSubscriptionsRequest,
} from "./Requests";

export type SchedulerRouteError = RequestJsonError | SchedulerRoutePayloadError;

export function decodeSchedulerDeliveryReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeliveryReconcileRoutePayload),
  );
}

export function decodeSchedulerDeliveryReconcileRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeliveryReconcilePayload(value);
}

export function decodeSchedulerConnectionReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerConnectionReconcileRoutePayload),
  );
}

export function decodeSchedulerConnectionReconcileRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerConnectionReconcilePayload(value);
}

export function decodeSchedulerRerunSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerRerunSubscriptionsRoutePayload),
  );
}

export function decodeSchedulerRerunSubscriptionsRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerRerunSubscriptionsPayload(value);
}

export function decodeSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeadLetterDeliveriesRoutePayload),
  );
}

export function decodeSchedulerDeadLetterDeliveriesRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeadLetterDeliveriesPayload(value);
}

export function decodeSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodeSchedulerCleanupConnectionsRoutePayload(value, env)),
  );
}

export function decodeSchedulerCleanupConnectionsRoutePayload(
  value: unknown,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerCleanupConnectionsPayload(value, env);
}

export function schedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}

export const schedulerRouteErrorToHttpErrorEffect = Effect.fn(
  "SchedulerRouteBoundary.schedulerRouteErrorToHttpError",
)(function* (
  error: SchedulerRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* Effect.fail(schedulerRouteErrorToHttpError(error));
});
