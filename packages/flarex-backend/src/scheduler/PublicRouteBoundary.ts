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
} from "./RouteBoundary";
import { Effect } from "effect";
import type { Env } from "../types";

export const decodePublicSchedulerDeliveryReconcileRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeDeliveryReconcileRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return yield* decodeSchedulerDeliveryReconcileRequest(request);
});

export const decodePublicSchedulerConnectionReconcileRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeConnectionReconcileRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return yield* decodeSchedulerConnectionReconcileRequest(request);
});

export const decodePublicSchedulerDeadLetterDeliveriesRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeDeadLetterDeliveriesRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return yield* decodeSchedulerDeadLetterDeliveriesRequest(request);
});

export const decodePublicSchedulerCleanupConnectionsRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeCleanupConnectionsRequest",
)(function* (
  request: Request,
  env: Env,
): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return yield* decodeSchedulerCleanupConnectionsRequest(request, env);
});

export const decodePublicSchedulerRerunSubscriptionsRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeRerunSubscriptionsRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return yield* decodeSchedulerRerunSubscriptionsRequest(request);
});

export const decodePublicSchedulerTriggerSubscriptionsRequest = Effect.fn(
  "PublicSchedulerRouteBoundary.decodeTriggerSubscriptionsRequest",
)(function* (
  request: Request,
): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return yield* decodeSchedulerRerunSubscriptionsRequest(request);
});
