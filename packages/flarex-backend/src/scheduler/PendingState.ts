import { isNonArrayRecord, type UnknownRecord } from "@flarex/utils/records";
import { isNonEmptyString } from "@flarex/utils/strings";
import { Data, Effect, Result } from "effect";
import { normalizeDateString } from "../dateStringNormalization";
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
  (value: unknown): Effect.Effect<PendingLiveQueryDeliveryReconcile, SchedulerPendingStateError> =>
    Effect.fromResult(normalizePendingDeliveryReconcile(value)),
);

export const decodePendingConnectionCleanupFromStorage = Effect.fn(
  "SchedulerPendingState.decodePendingConnectionCleanupFromStorage",
)(
  (value: unknown): Effect.Effect<PendingLiveQueryConnectionCleanup, SchedulerPendingStateError> =>
    Effect.fromResult(normalizePendingConnectionCleanup(value)),
);

export const decodePendingRerunFromStorage = Effect.fn(
  "SchedulerPendingState.decodePendingRerunFromStorage",
)(
  (value: unknown): Effect.Effect<PendingLiveQueryRerun, SchedulerPendingStateError> =>
    Effect.fromResult(normalizePendingRerun(value)),
);

export function continuationNextRunAtFromStorage(
  value: unknown,
  fallbackDelayMs: number,
): number | null {
  if (value === undefined) return null;
  if (!isNonArrayRecord(value)) {
    return Date.now() + fallbackDelayMs;
  }
  const record = value;
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
  return Result.gen(function* () {
    const record = yield* storageRecord(value, "pending live query delivery reconcile");
    const limit = yield* positiveIntegerFromStorage(
      record.limit,
      "pending delivery reconcile limit",
    );
    const deliveryLimit = yield* positiveIntegerFromStorage(
      record.deliveryLimit,
      "pending delivery reconcile deliveryLimit",
    );
    const maxBatches = yield* positiveIntegerFromStorage(
      record.maxBatches,
      "pending delivery reconcile maxBatches",
    );
    const cursor = yield* pendingCursorFromStorage(
      record.cursor,
      "pending delivery reconcile cursor",
    );
    const retryAttempt = yield* nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending delivery reconcile retryAttempt",
    );
    const nextRunAt = yield* (record.nextRunAt === undefined
      ? Result.succeed(new Date(0).toISOString())
      : dateStringFromStorage(record.nextRunAt, "pending delivery reconcile nextRunAt"));
    return {
      limit,
      deliveryLimit,
      maxBatches,
      cursor,
      retryAttempt,
      nextRunAt,
    };
  });
}

function normalizePendingConnectionCleanup(
  value: unknown,
): SchedulerPendingStateResult<PendingLiveQueryConnectionCleanup> {
  return Result.gen(function* () {
    const record = yield* storageRecord(value, "pending live query connection cleanup");
    const expiredAt = yield* dateStringFromStorage(
      record.expiredAt,
      "pending connection cleanup expiredAt",
    );
    const limit = yield* positiveIntegerFromStorage(
      record.limit,
      "pending connection cleanup limit",
    );
    const cursor = yield* expiredConnectionCursorFromStorage(
      record.cursor,
      "pending connection cleanup cursor",
    );
    const retryAttempt = yield* nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending connection cleanup retryAttempt",
    );
    const nextRunAt = yield* (record.nextRunAt === undefined
      ? Result.succeed(new Date(0).toISOString())
      : dateStringFromStorage(record.nextRunAt, "pending connection cleanup nextRunAt"));
    return {
      expiredAt,
      limit,
      cursor,
      retryAttempt,
      nextRunAt,
    };
  });
}

function normalizePendingRerun(value: unknown): SchedulerPendingStateResult<PendingLiveQueryRerun> {
  return Result.gen(function* () {
    const record = yield* storageRecord(value, "pending live query rerun");
    const projectId = yield* (record.projectId === undefined
      ? Result.succeed(undefined)
      : nonEmptyStringFromStorage(record.projectId, "pending rerun projectId"));
    const deploymentId = yield* nonEmptyStringFromStorage(
      record.deploymentId,
      "pending rerun deploymentId",
    );
    const limit = yield* positiveIntegerFromStorage(record.limit, "pending rerun limit");
    const deliveryLimit = yield* positiveIntegerFromStorage(
      record.deliveryLimit,
      "pending rerun deliveryLimit",
    );
    const maxBatches = yield* positiveIntegerFromStorage(
      record.maxBatches,
      "pending rerun maxBatches",
    );
    const retryAttempt = yield* nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending rerun retryAttempt",
    );
    const nextRunAt = yield* (record.nextRunAt === undefined
      ? Result.succeed(undefined)
      : dateStringFromStorage(record.nextRunAt, "pending rerun nextRunAt"));
    return {
      deploymentId,
      ...(projectId === undefined ? {} : { projectId }),
      limit,
      deliveryLimit,
      maxBatches,
      retryAttempt,
      ...(nextRunAt === undefined ? {} : { nextRunAt }),
    };
  });
}

type SchedulerPendingStateResult<A> = Result.Result<A, SchedulerPendingStateError>;

function schedulerPendingStateFailure<A = never>(message: string): SchedulerPendingStateResult<A> {
  return Result.fail(new SchedulerPendingStateError({ message }));
}

function pendingCursorFromStorage(
  value: unknown,
  path: string,
): SchedulerPendingStateResult<PendingDeploymentCursor> {
  return Result.gen(function* () {
    const record = yield* storageRecord(value, path);
    const oldestCreatedAt = yield* dateStringFromStorage(
      record.oldestCreatedAt,
      `${path}.oldestCreatedAt`,
    );
    const deploymentId = yield* nonEmptyStringFromStorage(
      record.deploymentId,
      `${path}.deploymentId`,
    );
    return { oldestCreatedAt, deploymentId };
  });
}

function expiredConnectionCursorFromStorage(
  value: unknown,
  path: string,
): SchedulerPendingStateResult<ExpiredConnectionDeploymentCursor> {
  return Result.gen(function* () {
    const record = yield* storageRecord(value, path);
    const oldestExpiredAt = yield* dateStringFromStorage(
      record.oldestExpiredAt,
      `${path}.oldestExpiredAt`,
    );
    const deploymentId = yield* nonEmptyStringFromStorage(
      record.deploymentId,
      `${path}.deploymentId`,
    );
    return { oldestExpiredAt, deploymentId };
  });
}

function storageRecord(value: unknown, field: string): SchedulerPendingStateResult<UnknownRecord> {
  if (isNonArrayRecord(value)) {
    return Result.succeed(value);
  }
  return schedulerPendingStateFailure(`${field} must be an object.`);
}

function dateStringFromStorage(value: unknown, field: string): SchedulerPendingStateResult<string> {
  return nonEmptyStringFromStorage(value, field).pipe(
    Result.flatMap(text => {
      const normalized = normalizeDateString(text);
      return normalized !== undefined
        ? Result.succeed(normalized)
        : schedulerPendingStateFailure(`${field} must be an ISO date string.`);
    }),
  );
}

function nonEmptyStringFromStorage(value: unknown, field: string): SchedulerPendingStateResult<string> {
  if (isNonEmptyString(value)) {
    return Result.succeed(value);
  }
  return schedulerPendingStateFailure(`${field} must be a non-empty string.`);
}

function positiveIntegerFromStorage(value: unknown, field: string): SchedulerPendingStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Result.succeed(value);
  }
  return schedulerPendingStateFailure(`${field} must be a positive integer.`);
}

function nonNegativeIntegerFromStorage(value: unknown, field: string): SchedulerPendingStateResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Result.succeed(value);
  }
  return schedulerPendingStateFailure(`${field} must be a non-negative integer.`);
}
