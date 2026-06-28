import { HttpError, readJson } from "../http";

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
