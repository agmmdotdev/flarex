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

export async function readSchedulerDeliveryReconcileRequest(
  request: Request,
): Promise<SchedulerDeliveryReconcileRequest> {
  return runSchedulerRouteEffect(decodeSchedulerDeliveryReconcileRequest(request));
}

export function decodeSchedulerDeliveryReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeliveryReconcileRoutePayload),
  );
}

export function parseSchedulerDeliveryReconcileRequest(
  value: unknown,
): SchedulerDeliveryReconcileRequest {
  return Effect.runSync(parseSchedulerDeliveryReconcileRequestEffect(value).pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function parseSchedulerDeliveryReconcileRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeliveryReconcileRoutePayload(value);
}

export function decodeSchedulerDeliveryReconcileRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeliveryReconcilePayload(value);
}

export async function readSchedulerConnectionReconcileRequest(
  request: Request,
): Promise<SchedulerConnectionReconcileRequest> {
  return runSchedulerRouteEffect(decodeSchedulerConnectionReconcileRequest(request));
}

export function decodeSchedulerConnectionReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerConnectionReconcileRoutePayload),
  );
}

export function parseSchedulerConnectionReconcileRequest(
  value: unknown,
): SchedulerConnectionReconcileRequest {
  return Effect.runSync(parseSchedulerConnectionReconcileRequestEffect(value).pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function parseSchedulerConnectionReconcileRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerConnectionReconcileRoutePayload(value);
}

export function decodeSchedulerConnectionReconcileRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerConnectionReconcilePayload(value);
}

export async function readSchedulerRerunSubscriptionsRequest(
  request: Request,
): Promise<SchedulerRerunSubscriptionsRequest> {
  return runSchedulerRouteEffect(decodeSchedulerRerunSubscriptionsRequest(request));
}

export function decodeSchedulerRerunSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerRerunSubscriptionsRoutePayload),
  );
}

export function parseSchedulerRerunSubscriptionsRequest(
  value: unknown,
): SchedulerRerunSubscriptionsRequest {
  return Effect.runSync(parseSchedulerRerunSubscriptionsRequestEffect(value).pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function parseSchedulerRerunSubscriptionsRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerRerunSubscriptionsRoutePayload(value);
}

export function decodeSchedulerRerunSubscriptionsRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerRerunSubscriptionsPayload(value);
}

export async function readSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Promise<SchedulerDeadLetterDeliveriesRequest> {
  return runSchedulerRouteEffect(decodeSchedulerDeadLetterDeliveriesRequest(request));
}

export function decodeSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeadLetterDeliveriesRoutePayload),
  );
}

export function parseSchedulerDeadLetterDeliveriesRequest(
  value: unknown,
): SchedulerDeadLetterDeliveriesRequest {
  return Effect.runSync(parseSchedulerDeadLetterDeliveriesRequestEffect(value).pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function parseSchedulerDeadLetterDeliveriesRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeadLetterDeliveriesRoutePayload(value);
}

export function decodeSchedulerDeadLetterDeliveriesRoutePayload(
  value: unknown,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerDeadLetterDeliveriesPayload(value);
}

export async function readSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Promise<SchedulerCleanupConnectionsRequest> {
  return runSchedulerRouteEffect(decodeSchedulerCleanupConnectionsRequest(request, env));
}

export function decodeSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => decodeSchedulerCleanupConnectionsRoutePayload(value, env)),
  );
}

export function parseSchedulerCleanupConnectionsRequest(
  value: unknown,
  env: Env,
): SchedulerCleanupConnectionsRequest {
  return Effect.runSync(parseSchedulerCleanupConnectionsRequestEffect(value, env).pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function parseSchedulerCleanupConnectionsRequestEffect(
  value: unknown,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerCleanupConnectionsRoutePayload(value, env);
}

export function decodeSchedulerCleanupConnectionsRoutePayload(
  value: unknown,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
  return decodeSchedulerCleanupConnectionsPayload(value, env);
}

function runSchedulerRouteEffect<A>(
  effect: Effect.Effect<A, SchedulerRouteError>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function schedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
