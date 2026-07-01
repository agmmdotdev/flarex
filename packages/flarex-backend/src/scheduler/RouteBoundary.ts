import { Effect } from "effect";
import { readJsonEffect, RequestJsonError } from "../http";
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

export const decodeSchedulerDeliveryReconcileRequest = Effect.fn(
  "SchedulerRouteBoundary.decodeDeliveryReconcileRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeliveryReconcileRoutePayload),
  );
});

export const decodeSchedulerDeliveryReconcileRoutePayload = Effect.fn(
  "SchedulerRouteBoundary.decodeDeliveryReconcilePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
  return yield* decodeSchedulerDeliveryReconcilePayload(value);
});

export const decodeSchedulerConnectionReconcileRequest = Effect.fn(
  "SchedulerRouteBoundary.decodeConnectionReconcileRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerConnectionReconcileRoutePayload),
  );
});

export const decodeSchedulerConnectionReconcileRoutePayload = Effect.fn(
  "SchedulerRouteBoundary.decodeConnectionReconcilePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
  return yield* decodeSchedulerConnectionReconcilePayload(value);
});

export const decodeSchedulerRerunSubscriptionsRequest = Effect.fn(
  "SchedulerRouteBoundary.decodeRerunSubscriptionsRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerRerunSubscriptionsRoutePayload),
  );
});

export const decodeSchedulerRerunSubscriptionsRoutePayload = Effect.fn(
  "SchedulerRouteBoundary.decodeRerunSubscriptionsPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
  return yield* decodeSchedulerRerunSubscriptionsPayload(value);
});

export const decodeSchedulerDeadLetterDeliveriesRequest = Effect.fn(
  "SchedulerRouteBoundary.decodeDeadLetterDeliveriesRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(decodeSchedulerDeadLetterDeliveriesRoutePayload),
  );
});

export const decodeSchedulerDeadLetterDeliveriesRoutePayload = Effect.fn(
  "SchedulerRouteBoundary.decodeDeadLetterDeliveriesPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
  return yield* decodeSchedulerDeadLetterDeliveriesPayload(value);
});

export const decodeSchedulerCleanupConnectionsRequest = Effect.fn(
  "SchedulerRouteBoundary.decodeCleanupConnectionsRequest",
)(function* (
  request: Request,
  env: Env,
): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return yield* readJsonEffect(request).pipe(
    Effect.flatMap(value => decodeSchedulerCleanupConnectionsRoutePayload(value, env)),
  );
});

export const decodeSchedulerCleanupConnectionsRoutePayload = Effect.fn(
  "SchedulerRouteBoundary.decodeCleanupConnectionsPayload",
)(function* (
  value: unknown,
  env: Env,
): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
  return yield* decodeSchedulerCleanupConnectionsPayload(value, env);
});
