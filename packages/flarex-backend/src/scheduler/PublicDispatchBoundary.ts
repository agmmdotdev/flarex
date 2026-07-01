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
  type PublicWorkerDispatchSource,
  type PublicWorkerDispatchError,
} from "../worker/PublicRouteDispatchError";

export interface PublicSchedulerDispatchTarget {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export type PublicSchedulerDispatchOperation = Extract<
  PublicWorkerDispatchSource,
  | "scheduler-delivery-reconcile"
  | "scheduler-connection-reconcile"
  | "scheduler-dead-letter-deliveries"
  | "scheduler-cleanup-connections"
  | "scheduler-rerun-subscriptions"
  | "scheduler-trigger-subscriptions"
>;

export const reconcilePublicSchedulerDeliveriesEffect = Effect.fn(
  "Worker.reconcilePublicSchedulerDeliveries",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  body: SchedulerDeliveryReconcileRequest,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* forwardLiveQuerySchedulerBodyEffect(
    scheduler,
    "scheduler-delivery-reconcile",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries,
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
    "scheduler-connection-reconcile",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections,
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
    "scheduler-dead-letter-deliveries",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries,
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
    "scheduler-cleanup-connections",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections,
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
    "scheduler-rerun-subscriptions",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
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
    "scheduler-trigger-subscriptions",
    body,
    LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions,
  );
});

export const dispatchPublicSchedulerEffect = Effect.fn(
  "Worker.dispatchPublicScheduler",
)(function* (
  scheduler: PublicSchedulerDispatchTarget,
  operation: PublicSchedulerDispatchOperation,
  body: unknown,
  internalPath: LiveQuerySchedulerInternalPath,
): Effect.fn.Return<Response, PublicWorkerDispatchError> {
  return yield* Effect.tryPromise({
    try: () => scheduler.fetch(`https://flarex.internal${internalPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    catch: error => publicWorkerDispatchError(operation, error),
  });
});

function forwardLiveQuerySchedulerBodyEffect(
  scheduler: PublicSchedulerDispatchTarget,
  operation: PublicSchedulerDispatchOperation,
  body: unknown,
  internalPath: LiveQuerySchedulerInternalPath,
): Effect.Effect<Response, PublicWorkerDispatchError> {
  return dispatchPublicSchedulerEffect(scheduler, operation, body, internalPath);
}
