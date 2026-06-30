import { Data, Effect } from "effect";
import { HttpError } from "../http";
import type {
  ExpiredConnectionDeploymentCursor,
  PendingDeploymentCursor,
} from "./Responses";

export type PendingLiveQueryDeliveryReconcile = {
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  cursor: PendingDeploymentCursor;
  retryAttempt: number;
  nextRunAt: string;
};

export type PendingLiveQueryConnectionCleanup = {
  expiredAt: string;
  limit: number;
  cursor: ExpiredConnectionDeploymentCursor;
  retryAttempt: number;
  nextRunAt: string;
};

export type PendingLiveQueryRerun = {
  deploymentId: string;
  projectId?: string;
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  retryAttempt: number;
  nextRunAt?: string;
};

export class SchedulerPendingStateError extends Data.TaggedError(
  "SchedulerPendingStateError",
)<{
  readonly message: string;
}> {}

export const decodePendingDeliveryReconcileFromStorage = Effect.fn(
  "SchedulerPendingState.decodePendingDeliveryReconcileFromStorage",
)(
  function* (value: unknown): Effect.fn.Return<
    PendingLiveQueryDeliveryReconcile,
    SchedulerPendingStateError
  > {
    return yield* schedulerPendingStateResultToEffect(normalizePendingDeliveryReconcile(value));
  },
);

export const decodePendingConnectionCleanupFromStorage = Effect.fn(
  "SchedulerPendingState.decodePendingConnectionCleanupFromStorage",
)(
  function* (value: unknown): Effect.fn.Return<
    PendingLiveQueryConnectionCleanup,
    SchedulerPendingStateError
  > {
    return yield* schedulerPendingStateResultToEffect(normalizePendingConnectionCleanup(value));
  },
);

export const decodePendingRerunFromStorage = Effect.fn(
  "SchedulerPendingState.decodePendingRerunFromStorage",
)(
  function* (value: unknown): Effect.fn.Return<PendingLiveQueryRerun, SchedulerPendingStateError> {
    return yield* schedulerPendingStateResultToEffect(normalizePendingRerun(value));
  },
);

export function pendingDeliveryReconcileFromStorage(value: unknown): PendingLiveQueryDeliveryReconcile {
  return unwrapSchedulerPendingState(normalizePendingDeliveryReconcile(value));
}

export function pendingConnectionCleanupFromStorage(value: unknown): PendingLiveQueryConnectionCleanup {
  return unwrapSchedulerPendingState(normalizePendingConnectionCleanup(value));
}

export function pendingRerunFromStorage(value: unknown): PendingLiveQueryRerun {
  return unwrapSchedulerPendingState(normalizePendingRerun(value));
}

export function continuationNextRunAtFromStorage(
  value: unknown,
  fallbackDelayMs: number,
): number | null {
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Date.now() + fallbackDelayMs;
  }
  const record = value as Record<string, unknown>;
  if (record.nextRunAt === undefined) {
    return Date.now() + fallbackDelayMs;
  }
  if (typeof record.nextRunAt !== "string") {
    return Date.now() + fallbackDelayMs;
  }
  const nextRunAt = new Date(record.nextRunAt).getTime();
  if (Number.isNaN(nextRunAt)) return Date.now() + fallbackDelayMs;
  return nextRunAt;
}

export function schedulerPendingStateErrorToHttpError(
  error: SchedulerPendingStateError,
): HttpError {
  return new HttpError(500, error.message);
}

function normalizePendingDeliveryReconcile(
  value: unknown,
): SchedulerPendingStateResult<PendingLiveQueryDeliveryReconcile> {
  const record = storageRecord(value, "pending live query delivery reconcile");
  if (!record.success) return record;
  const limit = positiveIntegerFromStorage(record.value.limit, "pending delivery reconcile limit");
  if (!limit.success) return limit;
  const deliveryLimit = positiveIntegerFromStorage(
    record.value.deliveryLimit,
    "pending delivery reconcile deliveryLimit",
  );
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = positiveIntegerFromStorage(
    record.value.maxBatches,
    "pending delivery reconcile maxBatches",
  );
  if (!maxBatches.success) return maxBatches;
  const cursor = pendingCursorFromStorage(record.value.cursor, "pending delivery reconcile cursor");
  if (!cursor.success) return cursor;
  const retryAttempt = nonNegativeIntegerFromStorage(
    record.value.retryAttempt,
    "pending delivery reconcile retryAttempt",
  );
  if (!retryAttempt.success) return retryAttempt;
  const nextRunAt = record.value.nextRunAt === undefined
    ? schedulerPendingStateSuccess(new Date(0).toISOString())
    : dateStringFromStorage(record.value.nextRunAt, "pending delivery reconcile nextRunAt");
  if (!nextRunAt.success) return nextRunAt;
  return schedulerPendingStateSuccess({
    limit: limit.value,
    deliveryLimit: deliveryLimit.value,
    maxBatches: maxBatches.value,
    cursor: cursor.value,
    retryAttempt: retryAttempt.value,
    nextRunAt: nextRunAt.value,
  });
}

function normalizePendingConnectionCleanup(
  value: unknown,
): SchedulerPendingStateResult<PendingLiveQueryConnectionCleanup> {
  const record = storageRecord(value, "pending live query connection cleanup");
  if (!record.success) return record;
  const expiredAt = dateStringFromStorage(record.value.expiredAt, "pending connection cleanup expiredAt");
  if (!expiredAt.success) return expiredAt;
  const limit = positiveIntegerFromStorage(record.value.limit, "pending connection cleanup limit");
  if (!limit.success) return limit;
  const cursor = expiredConnectionCursorFromStorage(
    record.value.cursor,
    "pending connection cleanup cursor",
  );
  if (!cursor.success) return cursor;
  const retryAttempt = nonNegativeIntegerFromStorage(
    record.value.retryAttempt,
    "pending connection cleanup retryAttempt",
  );
  if (!retryAttempt.success) return retryAttempt;
  const nextRunAt = record.value.nextRunAt === undefined
    ? schedulerPendingStateSuccess(new Date(0).toISOString())
    : dateStringFromStorage(record.value.nextRunAt, "pending connection cleanup nextRunAt");
  if (!nextRunAt.success) return nextRunAt;
  return schedulerPendingStateSuccess({
    expiredAt: expiredAt.value,
    limit: limit.value,
    cursor: cursor.value,
    retryAttempt: retryAttempt.value,
    nextRunAt: nextRunAt.value,
  });
}

function normalizePendingRerun(value: unknown): SchedulerPendingStateResult<PendingLiveQueryRerun> {
  const record = storageRecord(value, "pending live query rerun");
  if (!record.success) return record;
  const projectId = record.value.projectId === undefined
    ? schedulerPendingStateSuccess(undefined)
    : nonEmptyStringFromStorage(record.value.projectId, "pending rerun projectId");
  if (!projectId.success) return projectId;
  const deploymentId = nonEmptyStringFromStorage(record.value.deploymentId, "pending rerun deploymentId");
  if (!deploymentId.success) return deploymentId;
  const limit = positiveIntegerFromStorage(record.value.limit, "pending rerun limit");
  if (!limit.success) return limit;
  const deliveryLimit = positiveIntegerFromStorage(
    record.value.deliveryLimit,
    "pending rerun deliveryLimit",
  );
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = positiveIntegerFromStorage(record.value.maxBatches, "pending rerun maxBatches");
  if (!maxBatches.success) return maxBatches;
  const retryAttempt = nonNegativeIntegerFromStorage(
    record.value.retryAttempt,
    "pending rerun retryAttempt",
  );
  if (!retryAttempt.success) return retryAttempt;
  const nextRunAt = record.value.nextRunAt === undefined
    ? schedulerPendingStateSuccess(undefined)
    : dateStringFromStorage(record.value.nextRunAt, "pending rerun nextRunAt");
  if (!nextRunAt.success) return nextRunAt;
  return schedulerPendingStateSuccess({
    deploymentId: deploymentId.value,
    ...(projectId.value === undefined ? {} : { projectId: projectId.value }),
    limit: limit.value,
    deliveryLimit: deliveryLimit.value,
    maxBatches: maxBatches.value,
    retryAttempt: retryAttempt.value,
    ...(nextRunAt.value === undefined ? {} : { nextRunAt: nextRunAt.value }),
  });
}

type SchedulerPendingStateResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: SchedulerPendingStateError;
    };

function schedulerPendingStateSuccess<A>(value: A): SchedulerPendingStateResult<A> {
  return {
    success: true,
    value,
  };
}

function schedulerPendingStateFailure<A = never>(message: string): SchedulerPendingStateResult<A> {
  return {
    success: false,
    error: new SchedulerPendingStateError({ message }),
  };
}

function schedulerPendingStateResultToEffect<A>(
  result: SchedulerPendingStateResult<A>,
): Effect.Effect<A, SchedulerPendingStateError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapSchedulerPendingState<A>(result: SchedulerPendingStateResult<A>): A {
  if (result.success) return result.value;
  throw result.error;
}

function pendingCursorFromStorage(
  value: unknown,
  path: string,
): SchedulerPendingStateResult<PendingDeploymentCursor> {
  const record = storageRecord(value, path);
  if (!record.success) return record;
  const oldestCreatedAt = dateStringFromStorage(
    record.value.oldestCreatedAt,
    `${path}.oldestCreatedAt`,
  );
  if (!oldestCreatedAt.success) return oldestCreatedAt;
  const deploymentId = nonEmptyStringFromStorage(record.value.deploymentId, `${path}.deploymentId`);
  if (!deploymentId.success) return deploymentId;
  return schedulerPendingStateSuccess({
    oldestCreatedAt: oldestCreatedAt.value,
    deploymentId: deploymentId.value,
  });
}

function expiredConnectionCursorFromStorage(
  value: unknown,
  path: string,
): SchedulerPendingStateResult<ExpiredConnectionDeploymentCursor> {
  const record = storageRecord(value, path);
  if (!record.success) return record;
  const oldestExpiredAt = dateStringFromStorage(
    record.value.oldestExpiredAt,
    `${path}.oldestExpiredAt`,
  );
  if (!oldestExpiredAt.success) return oldestExpiredAt;
  const deploymentId = nonEmptyStringFromStorage(record.value.deploymentId, `${path}.deploymentId`);
  if (!deploymentId.success) return deploymentId;
  return schedulerPendingStateSuccess({
    oldestExpiredAt: oldestExpiredAt.value,
    deploymentId: deploymentId.value,
  });
}

function storageRecord(value: unknown, field: string): SchedulerPendingStateResult<Record<string, unknown>> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return schedulerPendingStateSuccess(value as Record<string, unknown>);
  }
  return schedulerPendingStateFailure(`${field} must be an object.`);
}

function dateStringFromStorage(value: unknown, field: string): SchedulerPendingStateResult<string> {
  const text = nonEmptyStringFromStorage(value, field);
  if (!text.success) return text;
  const date = new Date(text.value);
  if (!Number.isNaN(date.getTime())) return schedulerPendingStateSuccess(date.toISOString());
  return schedulerPendingStateFailure(`${field} must be an ISO date string.`);
}

function nonEmptyStringFromStorage(value: unknown, field: string): SchedulerPendingStateResult<string> {
  if (typeof value === "string" && value.length > 0) {
    return schedulerPendingStateSuccess(value);
  }
  return schedulerPendingStateFailure(`${field} must be a non-empty string.`);
}

function positiveIntegerFromStorage(value: unknown, field: string): SchedulerPendingStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return schedulerPendingStateSuccess(value);
  }
  return schedulerPendingStateFailure(`${field} must be a positive integer.`);
}

function nonNegativeIntegerFromStorage(value: unknown, field: string): SchedulerPendingStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return schedulerPendingStateSuccess(value);
  }
  return schedulerPendingStateFailure(`${field} must be a non-negative integer.`);
}
