import {
  decodeSchedulerCleanupConnectionsRouteBodyEffect,
  decodeSchedulerConnectionReconcilePayloadEffect,
  decodeSchedulerDeadLetterDeliveriesPayloadEffect,
  decodeSchedulerDeliveryReconcilePayloadEffect,
  decodeSchedulerRerunSubscriptionsPayloadEffect,
  SchedulerRoutePayloadError,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerCleanupConnectionsRouteBody,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerExpiredConnectionDeploymentCursor,
  type SchedulerPendingDeploymentCursor,
  type SchedulerRerunSubscriptionsRequest,
} from "flarex-protocol/scheduler";
import { Effect } from "effect";
import { projectIdFromRequestOrEnvEffect } from "../project";
import type { Env } from "../types";

export {
  SchedulerRoutePayloadError,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerExpiredConnectionDeploymentCursor,
  type SchedulerPendingDeploymentCursor,
  type SchedulerRerunSubscriptionsRequest,
};

export const decodeSchedulerDeliveryReconcilePayload = Effect.fn(
  "SchedulerRequests.decodeDeliveryReconcilePayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
    return yield* decodeSchedulerDeliveryReconcilePayloadEffect(value);
  },
);

export const decodeSchedulerConnectionReconcilePayload = Effect.fn(
  "SchedulerRequests.decodeConnectionReconcilePayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
    return yield* decodeSchedulerConnectionReconcilePayloadEffect(value);
  },
);

export const decodeSchedulerRerunSubscriptionsPayload = Effect.fn(
  "SchedulerRequests.decodeRerunSubscriptionsPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
    return yield* decodeSchedulerRerunSubscriptionsPayloadEffect(value);
  },
);

export const decodeSchedulerDeadLetterDeliveriesPayload = Effect.fn(
  "SchedulerRequests.decodeDeadLetterDeliveriesPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
    return yield* decodeSchedulerDeadLetterDeliveriesPayloadEffect(value);
  },
);

export const decodeSchedulerCleanupConnectionsPayload = Effect.fn(
  "SchedulerRequests.decodeCleanupConnectionsPayload",
)(
  function* (
    value: unknown,
    env: Env,
  ): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
    const normalized = yield* decodeSchedulerCleanupConnectionsRouteBodyEffect(value);
    return yield* resolveSchedulerCleanupConnectionsProject(normalized, env);
  },
);

const resolveSchedulerCleanupConnectionsProject = Effect.fn(
  "SchedulerRequests.resolveCleanupConnectionsProject",
)(function* (
  normalized: SchedulerCleanupConnectionsRouteBody,
  env: Env,
): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
  const projectId = yield* projectIdFromRequestOrEnvEffect(normalized.projectId, env).pipe(
    Effect.mapError(error => new SchedulerRoutePayloadError({ message: error.message })),
  );
  return {
    deploymentId: normalized.deploymentId,
    projectId,
    ...(normalized.expiredAt === undefined ? {} : { expiredAt: normalized.expiredAt }),
  };
});
