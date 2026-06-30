import { Data, Effect } from "effect";
import type { Env } from "../types";
import {
  DEFAULT_DEAD_LETTER_REASON,
  DEFAULT_DELIVERY_LIMIT,
  DEFAULT_MAX_BATCHES,
  DEFAULT_MIN_ATTEMPTS,
  DEFAULT_STUCK_AFTER_MS,
} from "./Defaults";

export type SchedulerPendingDeploymentCursor = {
  oldestCreatedAt: string;
  deploymentId: string;
};

export type SchedulerDeliveryReconcileRequest = {
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
  cursor?: SchedulerPendingDeploymentCursor;
};

export type SchedulerExpiredConnectionDeploymentCursor = {
  oldestExpiredAt: string;
  deploymentId: string;
};

export type SchedulerConnectionReconcileRequest = {
  expiredAt?: string;
  limit?: number;
  cursor?: SchedulerExpiredConnectionDeploymentCursor;
};

export type SchedulerRerunSubscriptionsRequest = {
  deploymentId: string;
  projectId?: string;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
};

export type SchedulerDeadLetterDeliveriesRequest = {
  deploymentId?: string;
  olderThan: string;
  stuckAfterMs: number;
  minAttempts: number;
  cursor?: unknown;
  limit: number;
  reason: string;
  deadLetteredAt: string;
  maxBatches: number;
};

export type SchedulerCleanupConnectionsRequest = {
  deploymentId: string;
  projectId: string;
  expiredAt?: string;
};

export class SchedulerRoutePayloadError extends Data.TaggedError("SchedulerRoutePayloadError")<{
  readonly message: string;
}> {}

export const decodeSchedulerDeliveryReconcilePayload = Effect.fn(
  "SchedulerRequests.decodeDeliveryReconcilePayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
    return yield* schedulerRoutePayloadValidationResultToEffect(
      normalizeSchedulerDeliveryReconcilePayload(value),
    );
  },
);

export const decodeSchedulerConnectionReconcilePayload = Effect.fn(
  "SchedulerRequests.decodeConnectionReconcilePayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
    return yield* schedulerRoutePayloadValidationResultToEffect(
      normalizeSchedulerConnectionReconcilePayload(value),
    );
  },
);

export const decodeSchedulerRerunSubscriptionsPayload = Effect.fn(
  "SchedulerRequests.decodeRerunSubscriptionsPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
    return yield* schedulerRoutePayloadValidationResultToEffect(
      normalizeSchedulerRerunSubscriptionsPayload(value),
    );
  },
);

export const decodeSchedulerDeadLetterDeliveriesPayload = Effect.fn(
  "SchedulerRequests.decodeDeadLetterDeliveriesPayload",
)(
  function* (
    value: unknown,
  ): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
    return yield* schedulerRoutePayloadValidationResultToEffect(
      normalizeSchedulerDeadLetterDeliveriesPayload(value),
    );
  },
);

export const decodeSchedulerCleanupConnectionsPayload = Effect.fn(
  "SchedulerRequests.decodeCleanupConnectionsPayload",
)(
  function* (
    value: unknown,
    env: Env,
  ): Effect.fn.Return<SchedulerCleanupConnectionsRequest, SchedulerRoutePayloadError> {
    return yield* schedulerRoutePayloadValidationResultToEffect(
      normalizeSchedulerCleanupConnectionsPayload(value, env),
    );
  },
);

function normalizeSchedulerDeliveryReconcilePayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerDeliveryReconcileRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("Live query delivery reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  const cursor = body.cursor === undefined
    ? schedulerRoutePayloadValidationSuccess(undefined)
    : pendingCursor(body.cursor);
  if (!cursor.success) return cursor;
  return schedulerRoutePayloadValidationSuccess({
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(deliveryLimit.value === undefined ? {} : { deliveryLimit: deliveryLimit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  });
}

function normalizeSchedulerConnectionReconcilePayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerConnectionReconcileRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (!expiredAt.success) return expiredAt;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const cursor = body.cursor === undefined
    ? schedulerRoutePayloadValidationSuccess(undefined)
    : expiredConnectionCursor(body.cursor);
  if (!cursor.success) return cursor;
  return schedulerRoutePayloadValidationSuccess({
    ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  });
}

function normalizeSchedulerRerunSubscriptionsPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerRerunSubscriptionsRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("Live query rerun request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const projectId = body.projectId === undefined
    ? schedulerRoutePayloadValidationSuccess(undefined)
    : nonEmptyString(body.projectId, "projectId");
  if (!projectId.success) return projectId;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  return schedulerRoutePayloadValidationSuccess({
    deploymentId: deploymentId.value,
    ...(projectId.value === undefined ? {} : { projectId: projectId.value }),
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(deliveryLimit.value === undefined ? {} : { deliveryLimit: deliveryLimit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
  });
}

function normalizeSchedulerDeadLetterDeliveriesPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerDeadLetterDeliveriesRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("Dead-letter request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = body.deploymentId === undefined
    ? schedulerRoutePayloadValidationSuccess(undefined)
    : nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const olderThan = deadLetterOlderThan(body);
  if (!olderThan.success) return olderThan;
  const stuckAfterMs = body.olderThan === undefined
    ? deadLetterStuckAfterMs(body.stuckAfterMs)
    : schedulerRoutePayloadValidationSuccess(DEFAULT_STUCK_AFTER_MS);
  if (!stuckAfterMs.success) return stuckAfterMs;
  const minAttempts = body.minAttempts === undefined
    ? schedulerRoutePayloadValidationSuccess(DEFAULT_MIN_ATTEMPTS)
    : positiveInteger(body.minAttempts, "minAttempts");
  if (!minAttempts.success) return minAttempts;
  const limit = body.limit === undefined
    ? schedulerRoutePayloadValidationSuccess(DEFAULT_DELIVERY_LIMIT)
    : positiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const reason = body.reason === undefined
    ? schedulerRoutePayloadValidationSuccess(DEFAULT_DEAD_LETTER_REASON)
    : nonEmptyString(body.reason, "reason");
  if (!reason.success) return reason;
  const deadLetteredAt = body.deadLetteredAt === undefined
    ? schedulerRoutePayloadValidationSuccess(new Date().toISOString())
    : dateString(body.deadLetteredAt, "deadLetteredAt");
  if (!deadLetteredAt.success) return deadLetteredAt;
  const maxBatches = body.maxBatches === undefined
    ? schedulerRoutePayloadValidationSuccess(DEFAULT_MAX_BATCHES)
    : positiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  return schedulerRoutePayloadValidationSuccess({
    ...(deploymentId.value === undefined ? {} : { deploymentId: deploymentId.value }),
    olderThan: olderThan.value,
    stuckAfterMs: stuckAfterMs.value,
    minAttempts: minAttempts.value,
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
    limit: limit.value,
    reason: reason.value,
    deadLetteredAt: deadLetteredAt.value,
    maxBatches: maxBatches.value,
  });
}

function normalizeSchedulerCleanupConnectionsPayload(
  value: unknown,
  env: Env,
): SchedulerRoutePayloadValidationResult<SchedulerCleanupConnectionsRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection cleanup request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const projectId = projectIdFromRequestOrEnvPayload(body.projectId, env);
  if (!projectId.success) return projectId;
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (!expiredAt.success) return expiredAt;
  return schedulerRoutePayloadValidationSuccess({
    deploymentId: deploymentId.value,
    projectId: projectId.value,
    ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
  });
}

function deadLetterOlderThan(body: Record<string, unknown>): SchedulerRoutePayloadValidationResult<string> {
  if (body.olderThan !== undefined) {
    return dateString(body.olderThan, "olderThan");
  }
  const stuckAfterMs = deadLetterStuckAfterMs(body.stuckAfterMs);
  if (!stuckAfterMs.success) return stuckAfterMs;
  return schedulerRoutePayloadValidationSuccess(new Date(Date.now() - stuckAfterMs.value).toISOString());
}

function deadLetterStuckAfterMs(value: unknown): SchedulerRoutePayloadValidationResult<number> {
  return value === undefined
    ? schedulerRoutePayloadValidationSuccess(DEFAULT_STUCK_AFTER_MS)
    : positiveInteger(value, "stuckAfterMs");
}

function pendingCursor(value: unknown): SchedulerRoutePayloadValidationResult<SchedulerPendingDeploymentCursor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  const oldestCreatedAt = dateString(record.oldestCreatedAt, "cursor.oldestCreatedAt");
  if (!oldestCreatedAt.success) return oldestCreatedAt;
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (!deploymentId.success) return deploymentId;
  return schedulerRoutePayloadValidationSuccess({
    oldestCreatedAt: oldestCreatedAt.value,
    deploymentId: deploymentId.value,
  });
}

function expiredConnectionCursor(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerExpiredConnectionDeploymentCursor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRoutePayloadValidationFailure("cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  const oldestExpiredAt = dateString(record.oldestExpiredAt, "cursor.oldestExpiredAt");
  if (!oldestExpiredAt.success) return oldestExpiredAt;
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (!deploymentId.success) return deploymentId;
  return schedulerRoutePayloadValidationSuccess({
    oldestExpiredAt: oldestExpiredAt.value,
    deploymentId: deploymentId.value,
  });
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): SchedulerRoutePayloadValidationResult<number | undefined> {
  return value === undefined ? schedulerRoutePayloadValidationSuccess(undefined) : positiveInteger(value, field);
}

function positiveInteger(value: unknown, field: string): SchedulerRoutePayloadValidationResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return schedulerRoutePayloadValidationSuccess(value);
  }
  return schedulerRoutePayloadValidationFailure(`${field} must be a positive integer.`);
}

function optionalDateString(
  value: unknown,
  field: string,
): SchedulerRoutePayloadValidationResult<string | undefined> {
  return value === undefined ? schedulerRoutePayloadValidationSuccess(undefined) : dateString(value, field);
}

function dateString(value: unknown, field: string): SchedulerRoutePayloadValidationResult<string> {
  const text = nonEmptyString(value, field);
  if (!text.success) return text;
  const date = new Date(text.value);
  if (!Number.isNaN(date.getTime())) return schedulerRoutePayloadValidationSuccess(date.toISOString());
  return schedulerRoutePayloadValidationFailure(`${field} must be an ISO date string.`);
}

function nonEmptyString(value: unknown, field: string): SchedulerRoutePayloadValidationResult<string> {
  if (typeof value === "string" && value.length > 0) return schedulerRoutePayloadValidationSuccess(value);
  return schedulerRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
}

function projectIdFromRequestOrEnvPayload(
  value: unknown,
  env: Env,
): SchedulerRoutePayloadValidationResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return schedulerRoutePayloadValidationSuccess(value);
  }
  if (value !== undefined) {
    return schedulerRoutePayloadValidationFailure("projectId must be a non-empty string.");
  }
  if (env.FLAREX_PROJECT_ID !== undefined && env.FLAREX_PROJECT_ID.length > 0) {
    return schedulerRoutePayloadValidationSuccess(env.FLAREX_PROJECT_ID);
  }
  return schedulerRoutePayloadValidationFailure(
    "projectId is required when FLAREX_PROJECT_ID is not configured.",
  );
}

type SchedulerRoutePayloadValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: SchedulerRoutePayloadError;
    };

function schedulerRoutePayloadValidationSuccess<A>(value: A): SchedulerRoutePayloadValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function schedulerRoutePayloadValidationFailure<A = never>(
  message: string,
): SchedulerRoutePayloadValidationResult<A> {
  return {
    success: false,
    error: new SchedulerRoutePayloadError({ message }),
  };
}

function schedulerRoutePayloadValidationResultToEffect<A>(
  result: SchedulerRoutePayloadValidationResult<A>,
): Effect.Effect<A, SchedulerRoutePayloadError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}
