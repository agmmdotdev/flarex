import { Data, Effect } from "effect";
import {
  HttpError,
  readJsonEffect,
  RequestJsonError,
  requestJsonErrorToHttpError,
} from "../http";
import { projectIdFromRequestOrEnv } from "../project";
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

export class SchedulerRouteValidationError extends Data.TaggedError("SchedulerRouteValidationError")<{
  readonly message: string;
}> {}

export type SchedulerRouteError = RequestJsonError | SchedulerRouteValidationError;

export async function readSchedulerDeliveryReconcileRequest(
  request: Request,
): Promise<SchedulerDeliveryReconcileRequest> {
  return runSchedulerRouteEffect(decodeSchedulerDeliveryReconcileRequest(request));
}

export function decodeSchedulerDeliveryReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseSchedulerDeliveryReconcileRequestEffect),
  );
}

export function parseSchedulerDeliveryReconcileRequest(
  value: unknown,
): SchedulerDeliveryReconcileRequest {
  return unwrapSchedulerRouteValidation(normalizeSchedulerDeliveryReconcileRequest(value));
}

export function parseSchedulerDeliveryReconcileRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerDeliveryReconcileRequest, SchedulerRouteValidationError> {
  return schedulerRouteValidationResultToEffect(normalizeSchedulerDeliveryReconcileRequest(value));
}

function normalizeSchedulerDeliveryReconcileRequest(
  value: unknown,
): SchedulerRouteValidationResult<SchedulerDeliveryReconcileRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("Live query delivery reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  const cursor = body.cursor === undefined
    ? schedulerRouteValidationSuccess(undefined)
    : pendingCursor(body.cursor);
  if (!cursor.success) return cursor;
  return schedulerRouteValidationSuccess({
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(deliveryLimit.value === undefined ? {} : { deliveryLimit: deliveryLimit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  });
}

export async function readSchedulerConnectionReconcileRequest(
  request: Request,
): Promise<SchedulerConnectionReconcileRequest> {
  return runSchedulerRouteEffect(decodeSchedulerConnectionReconcileRequest(request));
}

export function decodeSchedulerConnectionReconcileRequest(
  request: Request,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseSchedulerConnectionReconcileRequestEffect),
  );
}

export function parseSchedulerConnectionReconcileRequest(
  value: unknown,
): SchedulerConnectionReconcileRequest {
  return unwrapSchedulerRouteValidation(normalizeSchedulerConnectionReconcileRequest(value));
}

export function parseSchedulerConnectionReconcileRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerConnectionReconcileRequest, SchedulerRouteValidationError> {
  return schedulerRouteValidationResultToEffect(normalizeSchedulerConnectionReconcileRequest(value));
}

function normalizeSchedulerConnectionReconcileRequest(
  value: unknown,
): SchedulerRouteValidationResult<SchedulerConnectionReconcileRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("Live query connection reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (!expiredAt.success) return expiredAt;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const cursor = body.cursor === undefined
    ? schedulerRouteValidationSuccess(undefined)
    : expiredConnectionCursor(body.cursor);
  if (!cursor.success) return cursor;
  return schedulerRouteValidationSuccess({
    ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  });
}

export async function readSchedulerRerunSubscriptionsRequest(
  request: Request,
): Promise<SchedulerRerunSubscriptionsRequest> {
  return runSchedulerRouteEffect(decodeSchedulerRerunSubscriptionsRequest(request));
}

export function decodeSchedulerRerunSubscriptionsRequest(
  request: Request,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseSchedulerRerunSubscriptionsRequestEffect),
  );
}

export function parseSchedulerRerunSubscriptionsRequest(
  value: unknown,
): SchedulerRerunSubscriptionsRequest {
  return unwrapSchedulerRouteValidation(normalizeSchedulerRerunSubscriptionsRequest(value));
}

export function parseSchedulerRerunSubscriptionsRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerRerunSubscriptionsRequest, SchedulerRouteValidationError> {
  return schedulerRouteValidationResultToEffect(normalizeSchedulerRerunSubscriptionsRequest(value));
}

function normalizeSchedulerRerunSubscriptionsRequest(
  value: unknown,
): SchedulerRouteValidationResult<SchedulerRerunSubscriptionsRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("Live query rerun request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const projectId = body.projectId === undefined
    ? schedulerRouteValidationSuccess(undefined)
    : nonEmptyString(body.projectId, "projectId");
  if (!projectId.success) return projectId;
  const limit = optionalPositiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const deliveryLimit = optionalPositiveInteger(body.deliveryLimit, "deliveryLimit");
  if (!deliveryLimit.success) return deliveryLimit;
  const maxBatches = optionalPositiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  return schedulerRouteValidationSuccess({
    deploymentId: deploymentId.value,
    ...(projectId.value === undefined ? {} : { projectId: projectId.value }),
    ...(limit.value === undefined ? {} : { limit: limit.value }),
    ...(deliveryLimit.value === undefined ? {} : { deliveryLimit: deliveryLimit.value }),
    ...(maxBatches.value === undefined ? {} : { maxBatches: maxBatches.value }),
  });
}

export async function readSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Promise<SchedulerDeadLetterDeliveriesRequest> {
  return runSchedulerRouteEffect(decodeSchedulerDeadLetterDeliveriesRequest(request));
}

export function decodeSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(parseSchedulerDeadLetterDeliveriesRequestEffect),
  );
}

export function parseSchedulerDeadLetterDeliveriesRequest(
  value: unknown,
): SchedulerDeadLetterDeliveriesRequest {
  return unwrapSchedulerRouteValidation(normalizeSchedulerDeadLetterDeliveriesRequest(value));
}

export function parseSchedulerDeadLetterDeliveriesRequestEffect(
  value: unknown,
): Effect.Effect<SchedulerDeadLetterDeliveriesRequest, SchedulerRouteValidationError> {
  return schedulerRouteValidationResultToEffect(normalizeSchedulerDeadLetterDeliveriesRequest(value));
}

function normalizeSchedulerDeadLetterDeliveriesRequest(
  value: unknown,
): SchedulerRouteValidationResult<SchedulerDeadLetterDeliveriesRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("Dead-letter request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = body.deploymentId === undefined
    ? schedulerRouteValidationSuccess(undefined)
    : nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const olderThan = deadLetterOlderThan(body);
  if (!olderThan.success) return olderThan;
  const stuckAfterMs = body.olderThan === undefined
    ? deadLetterStuckAfterMs(body.stuckAfterMs)
    : schedulerRouteValidationSuccess(DEFAULT_STUCK_AFTER_MS);
  if (!stuckAfterMs.success) return stuckAfterMs;
  const minAttempts = body.minAttempts === undefined
    ? schedulerRouteValidationSuccess(DEFAULT_MIN_ATTEMPTS)
    : positiveInteger(body.minAttempts, "minAttempts");
  if (!minAttempts.success) return minAttempts;
  const limit = body.limit === undefined
    ? schedulerRouteValidationSuccess(DEFAULT_DELIVERY_LIMIT)
    : positiveInteger(body.limit, "limit");
  if (!limit.success) return limit;
  const reason = body.reason === undefined
    ? schedulerRouteValidationSuccess(DEFAULT_DEAD_LETTER_REASON)
    : nonEmptyString(body.reason, "reason");
  if (!reason.success) return reason;
  const deadLetteredAt = body.deadLetteredAt === undefined
    ? schedulerRouteValidationSuccess(new Date().toISOString())
    : dateString(body.deadLetteredAt, "deadLetteredAt");
  if (!deadLetteredAt.success) return deadLetteredAt;
  const maxBatches = body.maxBatches === undefined
    ? schedulerRouteValidationSuccess(DEFAULT_MAX_BATCHES)
    : positiveInteger(body.maxBatches, "maxBatches");
  if (!maxBatches.success) return maxBatches;
  return schedulerRouteValidationSuccess({
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

export async function readSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Promise<SchedulerCleanupConnectionsRequest> {
  return runSchedulerRouteEffect(decodeSchedulerCleanupConnectionsRequest(request, env));
}

export function decodeSchedulerCleanupConnectionsRequest(
  request: Request,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteError> {
  return readJsonEffect(request).pipe(
    Effect.flatMap(value => parseSchedulerCleanupConnectionsRequestEffect(value, env)),
  );
}

export function parseSchedulerCleanupConnectionsRequest(
  value: unknown,
  env: Env,
): SchedulerCleanupConnectionsRequest {
  return unwrapSchedulerRouteValidation(normalizeSchedulerCleanupConnectionsRequest(value, env));
}

export function parseSchedulerCleanupConnectionsRequestEffect(
  value: unknown,
  env: Env,
): Effect.Effect<SchedulerCleanupConnectionsRequest, SchedulerRouteValidationError> {
  return schedulerRouteValidationResultToEffect(normalizeSchedulerCleanupConnectionsRequest(value, env));
}

function normalizeSchedulerCleanupConnectionsRequest(
  value: unknown,
  env: Env,
): SchedulerRouteValidationResult<SchedulerCleanupConnectionsRequest> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("Live query connection cleanup request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  const deploymentId = nonEmptyString(body.deploymentId, "deploymentId");
  if (!deploymentId.success) return deploymentId;
  const projectId = projectIdFromRequestOrEnvEffect(body.projectId, env);
  if (!projectId.success) return projectId;
  const expiredAt = optionalDateString(body.expiredAt, "expiredAt");
  if (!expiredAt.success) return expiredAt;
  return schedulerRouteValidationSuccess({
    deploymentId: deploymentId.value,
    projectId: projectId.value,
    ...(expiredAt.value === undefined ? {} : { expiredAt: expiredAt.value }),
  });
}

function deadLetterOlderThan(body: Record<string, unknown>): SchedulerRouteValidationResult<string> {
  if (body.olderThan !== undefined) {
    return dateString(body.olderThan, "olderThan");
  }
  const stuckAfterMs = deadLetterStuckAfterMs(body.stuckAfterMs);
  if (!stuckAfterMs.success) return stuckAfterMs;
  return schedulerRouteValidationSuccess(new Date(Date.now() - stuckAfterMs.value).toISOString());
}

function deadLetterStuckAfterMs(value: unknown): SchedulerRouteValidationResult<number> {
  return value === undefined
    ? schedulerRouteValidationSuccess(DEFAULT_STUCK_AFTER_MS)
    : positiveInteger(value, "stuckAfterMs");
}

function pendingCursor(value: unknown): SchedulerRouteValidationResult<SchedulerPendingDeploymentCursor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  const oldestCreatedAt = dateString(record.oldestCreatedAt, "cursor.oldestCreatedAt");
  if (!oldestCreatedAt.success) return oldestCreatedAt;
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (!deploymentId.success) return deploymentId;
  return schedulerRouteValidationSuccess({
    oldestCreatedAt: oldestCreatedAt.value,
    deploymentId: deploymentId.value,
  });
}

function expiredConnectionCursor(value: unknown): SchedulerRouteValidationResult<SchedulerExpiredConnectionDeploymentCursor> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return schedulerRouteValidationFailure("cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  const oldestExpiredAt = dateString(record.oldestExpiredAt, "cursor.oldestExpiredAt");
  if (!oldestExpiredAt.success) return oldestExpiredAt;
  const deploymentId = nonEmptyString(record.deploymentId, "cursor.deploymentId");
  if (!deploymentId.success) return deploymentId;
  return schedulerRouteValidationSuccess({
    oldestExpiredAt: oldestExpiredAt.value,
    deploymentId: deploymentId.value,
  });
}

function optionalPositiveInteger(
  value: unknown,
  field: string,
): SchedulerRouteValidationResult<number | undefined> {
  return value === undefined ? schedulerRouteValidationSuccess(undefined) : positiveInteger(value, field);
}

function positiveInteger(value: unknown, field: string): SchedulerRouteValidationResult<number> {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return schedulerRouteValidationSuccess(value);
  }
  return schedulerRouteValidationFailure(`${field} must be a positive integer.`);
}

function optionalDateString(
  value: unknown,
  field: string,
): SchedulerRouteValidationResult<string | undefined> {
  return value === undefined ? schedulerRouteValidationSuccess(undefined) : dateString(value, field);
}

function dateString(value: unknown, field: string): SchedulerRouteValidationResult<string> {
  const text = nonEmptyString(value, field);
  if (!text.success) return text;
  const date = new Date(text.value);
  if (!Number.isNaN(date.getTime())) return schedulerRouteValidationSuccess(date.toISOString());
  return schedulerRouteValidationFailure(`${field} must be an ISO date string.`);
}

function nonEmptyString(value: unknown, field: string): SchedulerRouteValidationResult<string> {
  if (typeof value === "string" && value.length > 0) return schedulerRouteValidationSuccess(value);
  return schedulerRouteValidationFailure(`${field} must be a non-empty string.`);
}

function projectIdFromRequestOrEnvEffect(
  value: unknown,
  env: Env,
): SchedulerRouteValidationResult<string> {
  try {
    return schedulerRouteValidationSuccess(projectIdFromRequestOrEnv(value, env));
  } catch (error) {
    if (error instanceof HttpError && error.status === 400) {
      return schedulerRouteValidationFailure(error.message);
    }
    throw error;
  }
}

type SchedulerRouteValidationResult<A> =
  | {
      readonly success: true;
      readonly value: A;
    }
  | {
      readonly success: false;
      readonly error: SchedulerRouteValidationError;
    };

function schedulerRouteValidationSuccess<A>(value: A): SchedulerRouteValidationResult<A> {
  return {
    success: true,
    value,
  };
}

function schedulerRouteValidationFailure<A = never>(message: string): SchedulerRouteValidationResult<A> {
  return {
    success: false,
    error: new SchedulerRouteValidationError({ message }),
  };
}

function schedulerRouteValidationResultToEffect<A>(
  result: SchedulerRouteValidationResult<A>,
): Effect.Effect<A, SchedulerRouteValidationError> {
  return result.success ? Effect.succeed(result.value) : Effect.fail(result.error);
}

function unwrapSchedulerRouteValidation<A>(result: SchedulerRouteValidationResult<A>): A {
  if (result.success) return result.value;
  throw schedulerRouteErrorToHttpError(result.error);
}

function runSchedulerRouteEffect<A>(
  effect: Effect.Effect<A, SchedulerRouteError>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(
    Effect.mapError(schedulerRouteErrorToHttpError),
  ));
}

export function schedulerRouteErrorToHttpError(error: SchedulerRouteError): HttpError {
  if (error instanceof RequestJsonError) {
    return requestJsonErrorToHttpError(error);
  }
  return new HttpError(400, error.message);
}
