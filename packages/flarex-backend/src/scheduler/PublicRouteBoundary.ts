import {
  decodeSchedulerCleanupConnectionsRequest,
  decodeSchedulerConnectionReconcileRequest,
  decodeSchedulerDeadLetterDeliveriesRequest,
  decodeSchedulerDeliveryReconcileRequest,
  decodeSchedulerRerunSubscriptionsRequest,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerRouteError,
  type SchedulerRerunSubscriptionsRequest,
  schedulerRouteErrorToHttpErrorEffect,
  schedulerRouteErrorToHttpError,
} from "./RouteBoundary";
import { Effect } from "effect";
import type { HttpError } from "../http";
import type { Env } from "../types";

export function decodePublicSchedulerDeliveryReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return decodeSchedulerDeliveryReconcileRequest(request);
}

export function decodePublicSchedulerConnectionReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return decodeSchedulerConnectionReconcileRequest(request);
}

export function decodePublicSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return decodeSchedulerDeadLetterDeliveriesRequest(request);
}

export function decodePublicSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return decodeSchedulerCleanupConnectionsRequest(request, env);
}

export function decodePublicSchedulerRerunSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return decodeSchedulerRerunSubscriptionsRequest(request);
}

export function decodePublicSchedulerTriggerSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return decodeSchedulerRerunSubscriptionsRequest(request);
}

export function publicSchedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  return schedulerRouteErrorToHttpError(error);
}

export const publicSchedulerRouteErrorToHttpErrorEffect = Effect.fn(
  "PublicSchedulerRouteBoundary.publicSchedulerRouteErrorToHttpError",
)(function* (
  error: SchedulerRouteError,
): Effect.fn.Return<never, HttpError> {
  return yield* schedulerRouteErrorToHttpErrorEffect(error);
});
