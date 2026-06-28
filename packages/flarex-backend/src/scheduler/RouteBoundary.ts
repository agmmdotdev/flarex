import { HttpError, readJson } from "../http";
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

export async function readSchedulerDeliveryReconcileRequest(
  request: Request,
): Promise<SchedulerDeliveryReconcileRequest> {
  return parseSchedulerDeliveryReconcileRequest(await readJson(request));
}

export function parseSchedulerDeliveryReconcileRequest(
  value: unknown,
): SchedulerDeliveryReconcileRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query delivery reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    ...(body.limit === undefined ? {} : { limit: positiveInteger(body.limit, "limit") }),
    ...(body.deliveryLimit === undefined
      ? {}
      : { deliveryLimit: positiveInteger(body.deliveryLimit, "deliveryLimit") }),
    ...(body.maxBatches === undefined
      ? {}
      : { maxBatches: positiveInteger(body.maxBatches, "maxBatches") }),
    ...(body.cursor === undefined ? {} : { cursor: pendingCursor(body.cursor) }),
  };
}

export async function readSchedulerConnectionReconcileRequest(
  request: Request,
): Promise<SchedulerConnectionReconcileRequest> {
  return parseSchedulerConnectionReconcileRequest(await readJson(request));
}

export function parseSchedulerConnectionReconcileRequest(
  value: unknown,
): SchedulerConnectionReconcileRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query connection reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    ...(body.expiredAt === undefined
      ? {}
      : { expiredAt: dateString(body.expiredAt, "expiredAt") }),
    ...(body.limit === undefined ? {} : { limit: positiveInteger(body.limit, "limit") }),
    ...(body.cursor === undefined ? {} : { cursor: expiredConnectionCursor(body.cursor) }),
  };
}

export async function readSchedulerRerunSubscriptionsRequest(
  request: Request,
): Promise<SchedulerRerunSubscriptionsRequest> {
  return parseSchedulerRerunSubscriptionsRequest(await readJson(request));
}

export function parseSchedulerRerunSubscriptionsRequest(
  value: unknown,
): SchedulerRerunSubscriptionsRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query rerun request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    deploymentId: nonEmptyString(body.deploymentId, "deploymentId"),
    ...(body.projectId === undefined
      ? {}
      : { projectId: nonEmptyString(body.projectId, "projectId") }),
    ...(body.limit === undefined ? {} : { limit: positiveInteger(body.limit, "limit") }),
    ...(body.deliveryLimit === undefined
      ? {}
      : { deliveryLimit: positiveInteger(body.deliveryLimit, "deliveryLimit") }),
    ...(body.maxBatches === undefined
      ? {}
      : { maxBatches: positiveInteger(body.maxBatches, "maxBatches") }),
  };
}

export async function readSchedulerDeadLetterDeliveriesRequest(
  request: Request,
): Promise<SchedulerDeadLetterDeliveriesRequest> {
  return parseSchedulerDeadLetterDeliveriesRequest(await readJson(request));
}

export function parseSchedulerDeadLetterDeliveriesRequest(
  value: unknown,
): SchedulerDeadLetterDeliveriesRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Dead-letter request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    ...(body.deploymentId === undefined
      ? {}
      : { deploymentId: nonEmptyString(body.deploymentId, "deploymentId") }),
    olderThan: deadLetterOlderThan(body),
    stuckAfterMs: body.olderThan === undefined
      ? deadLetterStuckAfterMs(body.stuckAfterMs)
      : DEFAULT_STUCK_AFTER_MS,
    minAttempts: body.minAttempts === undefined
      ? DEFAULT_MIN_ATTEMPTS
      : positiveInteger(body.minAttempts, "minAttempts"),
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
    limit: body.limit === undefined
      ? DEFAULT_DELIVERY_LIMIT
      : positiveInteger(body.limit, "limit"),
    reason: body.reason === undefined
      ? DEFAULT_DEAD_LETTER_REASON
      : nonEmptyString(body.reason, "reason"),
    deadLetteredAt: body.deadLetteredAt === undefined
      ? new Date().toISOString()
      : dateString(body.deadLetteredAt, "deadLetteredAt"),
    maxBatches: body.maxBatches === undefined
      ? DEFAULT_MAX_BATCHES
      : positiveInteger(body.maxBatches, "maxBatches"),
  };
}

function deadLetterOlderThan(body: Record<string, unknown>): string {
  if (body.olderThan !== undefined) {
    return dateString(body.olderThan, "olderThan");
  }
  const stuckAfterMs = deadLetterStuckAfterMs(body.stuckAfterMs);
  return new Date(Date.now() - stuckAfterMs).toISOString();
}

function deadLetterStuckAfterMs(value: unknown): number {
  return value === undefined
    ? DEFAULT_STUCK_AFTER_MS
    : positiveInteger(value, "stuckAfterMs");
}

function pendingCursor(value: unknown): SchedulerPendingDeploymentCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    oldestCreatedAt: dateString(record.oldestCreatedAt, "cursor.oldestCreatedAt"),
    deploymentId: nonEmptyString(record.deploymentId, "cursor.deploymentId"),
  };
}

function expiredConnectionCursor(value: unknown): SchedulerExpiredConnectionDeploymentCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    oldestExpiredAt: dateString(record.oldestExpiredAt, "cursor.oldestExpiredAt"),
    deploymentId: nonEmptyString(record.deploymentId, "cursor.deploymentId"),
  };
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new HttpError(400, `${field} must be a positive integer.`);
}

function dateString(value: unknown, field: string): string {
  const text = nonEmptyString(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(400, `${field} must be an ISO date string.`);
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(400, `${field} must be a non-empty string.`);
}
