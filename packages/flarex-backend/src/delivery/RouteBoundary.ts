import { HttpError, readJson } from "../http";

export type DeliveryWakeRequest = {
  deploymentId: string;
  limit?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
};

export async function readDeliveryWakeRequest(
  request: Request,
): Promise<DeliveryWakeRequest> {
  return parseDeliveryWakeRequest(await readJson(request));
}

export function parseDeliveryWakeRequest(value: unknown): DeliveryWakeRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Delivery wake request body must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    deploymentId: requiredWakeString(record.deploymentId, "deploymentId"),
    ...(record.limit === undefined
      ? {}
      : { limit: positiveInteger(record.limit, "limit") }),
    ...(record.maxBatches === undefined
      ? {}
      : { maxBatches: positiveInteger(record.maxBatches, "maxBatches") }),
    ...(record.leaseDurationMs === undefined
      ? {}
      : {
          leaseDurationMs: positiveInteger(
            record.leaseDurationMs,
            "leaseDurationMs",
          ),
        }),
  };
}

function requiredWakeString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(400, `${field} must be a non-empty string.`);
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new HttpError(400, `${field} must be a positive integer.`);
}
