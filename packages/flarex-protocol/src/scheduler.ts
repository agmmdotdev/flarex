import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { Data, DateTime, Effect, Result, Schema } from "effect";

export const SCHEDULER_DEFAULT_DELIVERY_LIMIT = 100;
export const SCHEDULER_DEFAULT_MAX_BATCHES = 3;
export const SCHEDULER_DEFAULT_STUCK_AFTER_MS = 5 * 60 * 1000;
export const SCHEDULER_DEFAULT_MIN_ATTEMPTS = 3;
export const SCHEDULER_DEFAULT_DEAD_LETTER_REASON = "live query delivery stuck";

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

export type SchedulerCleanupConnectionsRouteBody = {
  deploymentId: string;
  projectId?: unknown;
  expiredAt?: string;
};

export type SchedulerCleanupConnectionsRequest = {
  deploymentId: string;
  projectId: string;
  expiredAt?: string;
};

export class SchedulerRoutePayloadError extends Data.TaggedError("SchedulerRoutePayloadError")<{
  readonly message: string;
}> {}

export const SchedulerPendingDeploymentCursorSchema = Schema.Struct({
  oldestCreatedAt: Schema.String,
  deploymentId: Schema.String,
});

export const SchedulerDeliveryReconcileRequestSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  deliveryLimit: Schema.optional(Schema.Number),
  maxBatches: Schema.optional(Schema.Number),
  cursor: Schema.optional(SchedulerPendingDeploymentCursorSchema),
});

export const SchedulerExpiredConnectionDeploymentCursorSchema = Schema.Struct({
  oldestExpiredAt: Schema.String,
  deploymentId: Schema.String,
});

export const SchedulerConnectionReconcileRequestSchema = Schema.Struct({
  expiredAt: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  cursor: Schema.optional(SchedulerExpiredConnectionDeploymentCursorSchema),
});

export const SchedulerRerunSubscriptionsRequestSchema = Schema.Struct({
  deploymentId: Schema.String,
  projectId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number),
  deliveryLimit: Schema.optional(Schema.Number),
  maxBatches: Schema.optional(Schema.Number),
});

export const SchedulerDeadLetterDeliveriesRequestSchema = Schema.Struct({
  deploymentId: Schema.optional(Schema.String),
  olderThan: Schema.String,
  stuckAfterMs: Schema.Number,
  minAttempts: Schema.Number,
  cursor: Schema.optional(Schema.Unknown),
  limit: Schema.Number,
  reason: Schema.String,
  deadLetteredAt: Schema.String,
  maxBatches: Schema.Number,
});

export const SchedulerCleanupConnectionsRouteBodySchema = Schema.Struct({
  deploymentId: Schema.String,
  projectId: Schema.optional(Schema.Unknown),
  expiredAt: Schema.optional(Schema.String),
});

const decodeUnknownSchedulerDeliveryReconcileRequest = Schema.decodeUnknownEffect(
  SchedulerDeliveryReconcileRequestSchema,
);
const decodeUnknownSchedulerConnectionReconcileRequest = Schema.decodeUnknownEffect(
  SchedulerConnectionReconcileRequestSchema,
);
const decodeUnknownSchedulerRerunSubscriptionsRequest = Schema.decodeUnknownEffect(
  SchedulerRerunSubscriptionsRequestSchema,
);
const decodeUnknownSchedulerDeadLetterDeliveriesRequest = Schema.decodeUnknownEffect(
  SchedulerDeadLetterDeliveriesRequestSchema,
);
const decodeUnknownSchedulerCleanupConnectionsRouteBody = Schema.decodeUnknownEffect(
  SchedulerCleanupConnectionsRouteBodySchema,
);

export const decodeSchedulerDeliveryReconcilePayloadEffect = Effect.fn(
  "SchedulerProtocol.decodeDeliveryReconcilePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerDeliveryReconcileRequest, SchedulerRoutePayloadError> {
  const request = yield* Effect.fromResult(
    normalizeSchedulerDeliveryReconcilePayload(value),
  );
  yield* decodeUnknownSchedulerDeliveryReconcileRequest(request).pipe(
    Effect.mapError(cause =>
      new SchedulerRoutePayloadError({
        message: `Live query delivery reconcile request body did not match the scheduler protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

export const decodeSchedulerConnectionReconcilePayloadEffect = Effect.fn(
  "SchedulerProtocol.decodeConnectionReconcilePayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerConnectionReconcileRequest, SchedulerRoutePayloadError> {
  const request = yield* Effect.fromResult(
    normalizeSchedulerConnectionReconcilePayload(value),
  );
  yield* decodeUnknownSchedulerConnectionReconcileRequest(request).pipe(
    Effect.mapError(cause =>
      new SchedulerRoutePayloadError({
        message: `Live query connection reconcile request body did not match the scheduler protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

export const decodeSchedulerRerunSubscriptionsPayloadEffect = Effect.fn(
  "SchedulerProtocol.decodeRerunSubscriptionsPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerRerunSubscriptionsRequest, SchedulerRoutePayloadError> {
  const request = yield* Effect.fromResult(
    normalizeSchedulerRerunSubscriptionsPayload(value),
  );
  yield* decodeUnknownSchedulerRerunSubscriptionsRequest(request).pipe(
    Effect.mapError(cause =>
      new SchedulerRoutePayloadError({
        message: `Live query rerun request body did not match the scheduler protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

export const decodeSchedulerDeadLetterDeliveriesPayloadEffect = Effect.fn(
  "SchedulerProtocol.decodeDeadLetterDeliveriesPayload",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerDeadLetterDeliveriesRequest, SchedulerRoutePayloadError> {
  const nowMillis = yield* DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
  const request = yield* Effect.fromResult(
    normalizeSchedulerDeadLetterDeliveriesPayload(value, nowMillis),
  );
  yield* decodeUnknownSchedulerDeadLetterDeliveriesRequest(request).pipe(
    Effect.mapError(cause =>
      new SchedulerRoutePayloadError({
        message: `Dead-letter request body did not match the scheduler protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

export const decodeSchedulerCleanupConnectionsRouteBodyEffect = Effect.fn(
  "SchedulerProtocol.decodeCleanupConnectionsRouteBody",
)(function* (
  value: unknown,
): Effect.fn.Return<SchedulerCleanupConnectionsRouteBody, SchedulerRoutePayloadError> {
  const request = yield* Effect.fromResult(
    normalizeSchedulerCleanupConnectionsPayload(value),
  );
  yield* decodeUnknownSchedulerCleanupConnectionsRouteBody(request).pipe(
    Effect.mapError(cause =>
      new SchedulerRoutePayloadError({
        message: `Live query connection cleanup request body did not match the scheduler protocol: ${String(cause)}`,
      })
    ),
  );
  return request;
});

function normalizeSchedulerDeliveryReconcilePayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerDeliveryReconcileRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query delivery reconcile request body must be an object.");
  }
  const body = value;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (Result.isFailure(limit)) return Result.fail(limit.failure);
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (Result.isFailure(deliveryLimit)) return Result.fail(deliveryLimit.failure);
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (Result.isFailure(maxBatches)) return Result.fail(maxBatches.failure);
  const cursor = body.cursor === undefined
    ? Result.succeed(undefined)
    : pendingCursor(body.cursor);
  if (Result.isFailure(cursor)) return Result.fail(cursor.failure);
  return Result.succeed({
    ...(limit.success === undefined ? {} : { limit: limit.success }),
    ...(deliveryLimit.success === undefined ? {} : { deliveryLimit: deliveryLimit.success }),
    ...(maxBatches.success === undefined ? {} : { maxBatches: maxBatches.success }),
    ...(cursor.success === undefined ? {} : { cursor: cursor.success }),
  });
}

function normalizeSchedulerConnectionReconcilePayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerConnectionReconcileRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection reconcile request body must be an object.");
  }
  const body = value;
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (Result.isFailure(expiredAt)) return Result.fail(expiredAt.failure);
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (Result.isFailure(limit)) return Result.fail(limit.failure);
  const cursor = body.cursor === undefined
    ? Result.succeed(undefined)
    : expiredConnectionCursor(body.cursor);
  if (Result.isFailure(cursor)) return Result.fail(cursor.failure);
  return Result.succeed({
    ...(expiredAt.success === undefined ? {} : { expiredAt: expiredAt.success }),
    ...(limit.success === undefined ? {} : { limit: limit.success }),
    ...(cursor.success === undefined ? {} : { cursor: cursor.success }),
  });
}

function normalizeSchedulerRerunSubscriptionsPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerRerunSubscriptionsRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query rerun request body must be an object.");
  }
  const body = value;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (Result.isFailure(deploymentId)) return Result.fail(deploymentId.failure);
  const projectId = body.projectId === undefined
    ? Result.succeed(undefined)
    : nonEmptyString(body.projectId, "projectId");
  if (Result.isFailure(projectId)) return Result.fail(projectId.failure);
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (Result.isFailure(limit)) return Result.fail(limit.failure);
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (Result.isFailure(deliveryLimit)) return Result.fail(deliveryLimit.failure);
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (Result.isFailure(maxBatches)) return Result.fail(maxBatches.failure);
  return Result.succeed({
    deploymentId: deploymentId.success,
    ...(projectId.success === undefined ? {} : { projectId: projectId.success }),
    ...(limit.success === undefined ? {} : { limit: limit.success }),
    ...(deliveryLimit.success === undefined ? {} : { deliveryLimit: deliveryLimit.success }),
    ...(maxBatches.success === undefined ? {} : { maxBatches: maxBatches.success }),
  });
}

function normalizeSchedulerDeadLetterDeliveriesPayload(
  value: unknown,
  nowMillis: number,
): SchedulerRoutePayloadValidationResult<SchedulerDeadLetterDeliveriesRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Dead-letter request body must be an object.");
  }
  const body = value;
  const deploymentId = body.deploymentId === undefined
    ? Result.succeed(undefined)
    : nonEmptyString(body.deploymentId, "deploymentId");
  if (Result.isFailure(deploymentId)) return Result.fail(deploymentId.failure);
  const olderThan = deadLetterOlderThan(body, nowMillis);
  if (Result.isFailure(olderThan)) return Result.fail(olderThan.failure);
  const stuckAfterMs = body.olderThan === undefined
    ? deadLetterStuckAfterMs(body.stuckAfterMs)
    : Result.succeed(SCHEDULER_DEFAULT_STUCK_AFTER_MS);
  if (Result.isFailure(stuckAfterMs)) return Result.fail(stuckAfterMs.failure);
  const minAttempts = body.minAttempts === undefined
    ? Result.succeed(SCHEDULER_DEFAULT_MIN_ATTEMPTS)
    : positiveInteger(body.minAttempts, "minAttempts");
  if (Result.isFailure(minAttempts)) return Result.fail(minAttempts.failure);
  const limit = body.limit === undefined
    ? Result.succeed(SCHEDULER_DEFAULT_DELIVERY_LIMIT)
    : positiveInteger(body.limit, "limit");
  if (Result.isFailure(limit)) return Result.fail(limit.failure);
  const reason = body.reason === undefined
    ? Result.succeed(SCHEDULER_DEFAULT_DEAD_LETTER_REASON)
    : nonEmptyString(body.reason, "reason");
  if (Result.isFailure(reason)) return Result.fail(reason.failure);
  const deadLetteredAt = body.deadLetteredAt === undefined
    ? Result.succeed(new Date(nowMillis).toISOString())
    : dateString(body.deadLetteredAt, "deadLetteredAt");
  if (Result.isFailure(deadLetteredAt)) {
    return Result.fail(deadLetteredAt.failure);
  }
  const maxBatches = body.maxBatches === undefined
    ? Result.succeed(SCHEDULER_DEFAULT_MAX_BATCHES)
    : positiveInteger(body.maxBatches, "maxBatches");
  if (Result.isFailure(maxBatches)) return Result.fail(maxBatches.failure);
  return Result.succeed({
    ...(deploymentId.success === undefined ? {} : { deploymentId: deploymentId.success }),
    olderThan: olderThan.success,
    stuckAfterMs: stuckAfterMs.success,
    minAttempts: minAttempts.success,
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
    limit: limit.success,
    reason: reason.success,
    deadLetteredAt: deadLetteredAt.success,
    maxBatches: maxBatches.success,
  });
}

function normalizeSchedulerCleanupConnectionsPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerCleanupConnectionsRouteBody> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection cleanup request body must be an object.");
  }
  const body = value;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (Result.isFailure(deploymentId)) return Result.fail(deploymentId.failure);
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (Result.isFailure(expiredAt)) return Result.fail(expiredAt.failure);
  return Result.succeed({
    deploymentId: deploymentId.success,
    projectId: body.projectId,
    ...(expiredAt.success === undefined ? {} : { expiredAt: expiredAt.success }),
  });
}

function deadLetterOlderThan(
  body: UnknownRecord,
  nowMillis: number,
): SchedulerRoutePayloadValidationResult<string> {
  if (body.olderThan !== undefined) {
    return dateString(body.olderThan, "olderThan");
  }
  const stuckAfterMs = deadLetterStuckAfterMs(body.stuckAfterMs);
  if (Result.isFailure(stuckAfterMs)) return Result.fail(stuckAfterMs.failure);
  return Result.succeed(new Date(nowMillis - stuckAfterMs.success).toISOString());
}

function deadLetterStuckAfterMs(value: unknown): SchedulerRoutePayloadValidationResult<number> {
  return value === undefined
    ? Result.succeed(SCHEDULER_DEFAULT_STUCK_AFTER_MS)
    : positiveInteger(value, "stuckAfterMs");
}

function pendingCursor(value: unknown): SchedulerRoutePayloadValidationResult<SchedulerPendingDeploymentCursor> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("cursor must be an object.");
  }
  const record = value;
  const oldestCreatedAt = dateString(record.oldestCreatedAt, "cursor.oldestCreatedAt");
  if (Result.isFailure(oldestCreatedAt)) {
    return Result.fail(oldestCreatedAt.failure);
  }
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (Result.isFailure(deploymentId)) return Result.fail(deploymentId.failure);
  return Result.succeed({
    oldestCreatedAt: oldestCreatedAt.success,
    deploymentId: deploymentId.success,
  });
}

function expiredConnectionCursor(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerExpiredConnectionDeploymentCursor> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("cursor must be an object.");
  }
  const record = value;
  const oldestExpiredAt = dateString(record.oldestExpiredAt, "cursor.oldestExpiredAt");
  if (Result.isFailure(oldestExpiredAt)) {
    return Result.fail(oldestExpiredAt.failure);
  }
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (Result.isFailure(deploymentId)) return Result.fail(deploymentId.failure);
  return Result.succeed({
    oldestExpiredAt: oldestExpiredAt.success,
    deploymentId: deploymentId.success,
  });
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): SchedulerRoutePayloadValidationResult<number | undefined> {
  return value === undefined ? Result.succeed(undefined) : positiveInteger(value, field);
}

function positiveInteger(value: unknown, field: string): SchedulerRoutePayloadValidationResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Result.succeed(value);
  }
  return schedulerRoutePayloadValidationFailure(`${field} must be a positive integer.`);
}

function optionalDateString(
  value: unknown,
  field: string,
): SchedulerRoutePayloadValidationResult<string | undefined> {
  return value === undefined ? Result.succeed(undefined) : dateString(value, field);
}

function dateString(value: unknown, field: string): SchedulerRoutePayloadValidationResult<string> {
  const text = nonEmptyString(value, field);
  if (Result.isFailure(text)) return Result.fail(text.failure);
  const date = new Date(text.success);
  if (!Number.isNaN(date.getTime())) return Result.succeed(date.toISOString());
  return schedulerRoutePayloadValidationFailure(`${field} must be an ISO date string.`);
}

function nonEmptyString(value: unknown, field: string): SchedulerRoutePayloadValidationResult<string> {
  if (typeof value === "string" && value.length > 0) return Result.succeed(value);
  return schedulerRoutePayloadValidationFailure(`${field} must be a non-empty string.`);
}

type SchedulerRoutePayloadValidationResult<A> = Result.Result<
  A,
  SchedulerRoutePayloadError
>;

function schedulerRoutePayloadValidationFailure<A = never>(
  message: string,
): SchedulerRoutePayloadValidationResult<A> {
  return Result.fail(new SchedulerRoutePayloadError({ message }));
}
