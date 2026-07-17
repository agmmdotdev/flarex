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
  return Result.gen(function* () {
    const limit = yield* optionalPositiveInteger(body.limit, "limit");
    const deliveryLimit = yield* optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
    const maxBatches = yield* optionalPositiveInteger(body.maxBatches, "maxBatches");
    const cursor = yield* (body.cursor === undefined
      ? Result.succeed(undefined)
      : pendingCursor(body.cursor));
    return {
      ...(limit === undefined ? {} : { limit }),
      ...(deliveryLimit === undefined ? {} : { deliveryLimit }),
      ...(maxBatches === undefined ? {} : { maxBatches }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function normalizeSchedulerConnectionReconcilePayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerConnectionReconcileRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection reconcile request body must be an object.");
  }
  const body = value;
  return Result.gen(function* () {
    const expiredAt = yield* optionalDateString(body.expiredAt, "expiredAt");
    const limit = yield* optionalPositiveInteger(body.limit, "limit");
    const cursor = yield* (body.cursor === undefined
      ? Result.succeed(undefined)
      : expiredConnectionCursor(body.cursor));
    return {
      ...(expiredAt === undefined ? {} : { expiredAt }),
      ...(limit === undefined ? {} : { limit }),
      ...(cursor === undefined ? {} : { cursor }),
    };
  });
}

function normalizeSchedulerRerunSubscriptionsPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerRerunSubscriptionsRequest> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query rerun request body must be an object.");
  }
  const body = value;
  return Result.gen(function* () {
    const deploymentId = yield* nonEmptyString(body.deploymentId, "deploymentId");
    const projectId = yield* (body.projectId === undefined
      ? Result.succeed(undefined)
      : nonEmptyString(body.projectId, "projectId"));
    const limit = yield* optionalPositiveInteger(body.limit, "limit");
    const deliveryLimit = yield* optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
    const maxBatches = yield* optionalPositiveInteger(body.maxBatches, "maxBatches");
    return {
      deploymentId,
      ...(projectId === undefined ? {} : { projectId }),
      ...(limit === undefined ? {} : { limit }),
      ...(deliveryLimit === undefined ? {} : { deliveryLimit }),
      ...(maxBatches === undefined ? {} : { maxBatches }),
    };
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
  return Result.gen(function* () {
    const deploymentId = yield* (body.deploymentId === undefined
      ? Result.succeed(undefined)
      : nonEmptyString(body.deploymentId, "deploymentId"));
    const olderThan = yield* deadLetterOlderThan(body, nowMillis);
    const stuckAfterMs = yield* (body.olderThan === undefined
      ? deadLetterStuckAfterMs(body.stuckAfterMs)
      : Result.succeed(SCHEDULER_DEFAULT_STUCK_AFTER_MS));
    const minAttempts = yield* (body.minAttempts === undefined
      ? Result.succeed(SCHEDULER_DEFAULT_MIN_ATTEMPTS)
      : positiveInteger(body.minAttempts, "minAttempts"));
    const limit = yield* (body.limit === undefined
      ? Result.succeed(SCHEDULER_DEFAULT_DELIVERY_LIMIT)
      : positiveInteger(body.limit, "limit"));
    const reason = yield* (body.reason === undefined
      ? Result.succeed(SCHEDULER_DEFAULT_DEAD_LETTER_REASON)
      : nonEmptyString(body.reason, "reason"));
    const deadLetteredAt = yield* (body.deadLetteredAt === undefined
      ? Result.succeed(new Date(nowMillis).toISOString())
      : dateString(body.deadLetteredAt, "deadLetteredAt"));
    const maxBatches = yield* (body.maxBatches === undefined
      ? Result.succeed(SCHEDULER_DEFAULT_MAX_BATCHES)
      : positiveInteger(body.maxBatches, "maxBatches"));
    return {
      ...(deploymentId === undefined ? {} : { deploymentId }),
      olderThan,
      stuckAfterMs,
      minAttempts,
      ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
      limit,
      reason,
      deadLetteredAt,
      maxBatches,
    };
  });
}

function normalizeSchedulerCleanupConnectionsPayload(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerCleanupConnectionsRouteBody> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("Live query connection cleanup request body must be an object.");
  }
  const body = value;
  return Result.gen(function* () {
    const deploymentId = yield* nonEmptyString(body.deploymentId, "deploymentId");
    const expiredAt = yield* optionalDateString(body.expiredAt, "expiredAt");
    return {
      deploymentId,
      projectId: body.projectId,
      ...(expiredAt === undefined ? {} : { expiredAt }),
    };
  });
}

function deadLetterOlderThan(
  body: UnknownRecord,
  nowMillis: number,
): SchedulerRoutePayloadValidationResult<string> {
  if (body.olderThan !== undefined) {
    return dateString(body.olderThan, "olderThan");
  }
  return deadLetterStuckAfterMs(body.stuckAfterMs).pipe(
    Result.map(stuckAfterMs => new Date(nowMillis - stuckAfterMs).toISOString()),
  );
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
  return Result.gen(function* () {
    const oldestCreatedAt = yield* dateString(record.oldestCreatedAt, "cursor.oldestCreatedAt");
    const deploymentId = yield* nonEmptyString(record.deploymentId, "cursor.deploymentId");
    return { oldestCreatedAt, deploymentId };
  });
}

function expiredConnectionCursor(
  value: unknown,
): SchedulerRoutePayloadValidationResult<SchedulerExpiredConnectionDeploymentCursor> {
  if (!isNonArrayRecord(value)) {
    return schedulerRoutePayloadValidationFailure("cursor must be an object.");
  }
  const record = value;
  return Result.gen(function* () {
    const oldestExpiredAt = yield* dateString(record.oldestExpiredAt, "cursor.oldestExpiredAt");
    const deploymentId = yield* nonEmptyString(record.deploymentId, "cursor.deploymentId");
    return { oldestExpiredAt, deploymentId };
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
  return nonEmptyString(value, field).pipe(
    Result.flatMap(text => {
      const date = new Date(text);
      return !Number.isNaN(date.getTime())
        ? Result.succeed(date.toISOString())
        : schedulerRoutePayloadValidationFailure(`${field} must be an ISO date string.`);
    }),
  );
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
