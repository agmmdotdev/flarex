import { Effect } from "effect";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  type LiveQuerySchedulerInternalPath,
} from "../schedulerRoutes";
import type {
  SchedulerCleanupConnectionsRequest,
  SchedulerConnectionReconcileRequest,
  SchedulerDeadLetterDeliveriesRequest,
  SchedulerDeliveryReconcileRequest,
  SchedulerRerunSubscriptionsRequest,
} from "./RouteBoundary";
import {
  publicWorkerDispatchError,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicSchedulerDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export const reconcilePublicSchedulerDeliveriesEffect = Effect.fn(
  "Worker.reconcilePublicSchedulerDeliveries",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerDeliveryReconcileRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries,
    error => publicWorkerDispatchError("scheduler-delivery-reconcile", error),
  );
});

export const reconcilePublicSchedulerConnectionsEffect = Effect.fn(
  "Worker.reconcilePublicSchedulerConnections",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerConnectionReconcileRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections,
    error => publicWorkerDispatchError("scheduler-connection-reconcile", error),
  );
});

export const deadLetterPublicSchedulerDeliveriesEffect = Effect.fn(
  "Worker.deadLetterPublicSchedulerDeliveries",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerDeadLetterDeliveriesRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries,
    error => publicWorkerDispatchError("scheduler-dead-letter-deliveries", error),
  );
});

export const cleanupPublicSchedulerConnectionsEffect = Effect.fn(
  "Worker.cleanupPublicSchedulerConnections",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerCleanupConnectionsRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections,
    error => publicWorkerDispatchError("scheduler-cleanup-connections", error),
  );
});

export const rerunPublicSchedulerSubscriptionsEffect = Effect.fn(
  "Worker.rerunPublicSchedulerSubscriptions",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerRerunSubscriptionsRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
    error => publicWorkerDispatchError("scheduler-rerun-subscriptions", error),
  );
});

export const triggerPublicSchedulerSubscriptionsEffect = Effect.fn(
  "Worker.triggerPublicSchedulerSubscriptions",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerRerunSubscriptionsRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
    error => publicWorkerDispatchError("scheduler-trigger-subscriptions", error),
  );
});

function forwardLiveQuerySchedulerBodyEffect(
  scheduler: PublicSchedulerDispatchTarget,
  body: unknown,
  internalPath: LiveQuerySchedulerInternalPath,
  mapError: (error: unknown) => PublicWorkerDispatchError,
): Effect.Effect<Response, PublicWorkerDispatchError> {
  return Effect.tryPromise({
    try: () => scheduler.fetch(`https://flarex.internal${internalPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    catch: mapError,
  });
}
