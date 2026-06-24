import { HttpError } from "./http";
import type { LiveQueryDeliveryChange } from "flarex";
import type { Env, Json } from "./types";

export type { LiveQueryDeliveryChange } from "flarex";

export type LiveQueryDeliveryResult = {
  delivered: number;
  skipped: number;
  staleSkipped?: number;
};

export type ConnectionLiveQueryDeliveryResult = LiveQueryDeliveryResult & {
  connections: number;
};

export function liveQueryDeliveryChangesFromBody(
  body: unknown,
): LiveQueryDeliveryChange[] {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !Array.isArray((body as { deliveries?: unknown }).deliveries)
  ) {
    throw new Error("Live query delivery body must be an object with a deliveries array.");
  }
  return (body as { deliveries: unknown[] }).deliveries.map((value, index) =>
    liveQueryDeliveryChangeFromUnknown(value, `deliveries[${index}]`),
  );
}

export async function deliverLiveQueryChangesToConnections(
  env: Env,
  deploymentId: string,
  deliveries: LiveQueryDeliveryChange[],
): Promise<ConnectionLiveQueryDeliveryResult> {
  const byConnection = new Map<string, LiveQueryDeliveryChange[]>();
  for (const delivery of deliveries) {
    validateDeliveryTarget(deploymentId, delivery);
    const existing = byConnection.get(delivery.connectionId);
    if (existing === undefined) {
      byConnection.set(delivery.connectionId, [delivery]);
    } else {
      existing.push(delivery);
    }
  }

  let delivered = 0;
  let skipped = 0;
  let staleSkipped = 0;
  for (const [connectionId, connectionDeliveries] of byConnection) {
    const response = await env.CONNECTIONS.getByName(connectionId).fetch(
      "https://flarex.internal/deliver/live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveries: connectionDeliveries }),
      },
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `ConnectionDO live query delivery failed for ${connectionId} with status ${response.status}.`,
      );
    }
    const result = liveQueryDeliveryResultFromUnknown(
      await response.json().catch(() => null),
      connectionId,
    );
    delivered += result.delivered;
    skipped += result.skipped;
    staleSkipped += result.staleSkipped ?? 0;
  }

  return {
    delivered,
    skipped,
    ...(staleSkipped > 0 ? { staleSkipped } : {}),
    connections: byConnection.size,
  };
}

function validateDeliveryTarget(
  deploymentId: string,
  delivery: LiveQueryDeliveryChange,
): void {
  if (delivery.deploymentId !== deploymentId) {
    throw new HttpError(
      400,
      `Live query delivery deploymentId ${delivery.deploymentId} does not match route deploymentId ${deploymentId}.`,
    );
  }
  if (!delivery.connectionId.startsWith(`connection:${deploymentId}:`)) {
    throw new HttpError(
      400,
      `Live query delivery connectionId ${delivery.connectionId} is not scoped to deployment ${deploymentId}.`,
    );
  }
}

function liveQueryDeliveryChangeFromUnknown(
  value: unknown,
  path: string,
): LiveQueryDeliveryChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const kind = record.kind;
  if (kind === "failed") {
    return {
      kind: "failed",
      deploymentId: requiredDeliveryString(record.deploymentId, `${path}.deploymentId`),
      connectionId: requiredDeliveryString(record.connectionId, `${path}.connectionId`),
      queryId: requiredDeliveryInteger(record.queryId, `${path}.queryId`),
      functionPath: requiredDeliveryString(record.functionPath, `${path}.functionPath`),
      argsJson: deliveryJson(record.argsJson, `${path}.argsJson`),
      previousResultHash: requiredDeliveryString(
        record.previousResultHash,
        `${path}.previousResultHash`,
      ),
      errorMessage: requiredDeliveryString(record.errorMessage, `${path}.errorMessage`),
      errorData:
        record.errorData === undefined
          ? null
          : deliveryJson(record.errorData, `${path}.errorData`),
    };
  }
  if (kind !== undefined && kind !== "updated") {
    throw new Error(`${path}.kind must be "updated" or "failed".`);
  }
  return {
    kind: "updated",
    deploymentId: requiredDeliveryString(record.deploymentId, `${path}.deploymentId`),
    connectionId: requiredDeliveryString(record.connectionId, `${path}.connectionId`),
    queryId: requiredDeliveryInteger(record.queryId, `${path}.queryId`),
    functionPath: requiredDeliveryString(record.functionPath, `${path}.functionPath`),
    argsJson: deliveryJson(record.argsJson, `${path}.argsJson`),
    resultJson: deliveryJson(record.resultJson, `${path}.resultJson`),
    previousResultHash: requiredDeliveryString(
      record.previousResultHash,
      `${path}.previousResultHash`,
    ),
    resultHash: requiredDeliveryString(record.resultHash, `${path}.resultHash`),
  };
}

function liveQueryDeliveryResultFromUnknown(
  value: unknown,
  connectionId: string,
): LiveQueryDeliveryResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(
      502,
      `ConnectionDO live query delivery for ${connectionId} did not return a JSON object.`,
    );
  }
  const record = value as Record<string, unknown>;
  return {
    delivered: requiredResultInteger(record.delivered, `${connectionId}.delivered`),
    skipped: requiredResultInteger(record.skipped, `${connectionId}.skipped`),
    ...optionalResultInteger(record.staleSkipped, `${connectionId}.staleSkipped`),
  };
}

function requiredDeliveryString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${field} must be a non-empty string.`);
}

function requiredDeliveryInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${field} must be an integer.`);
}

function requiredResultInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new HttpError(502, `${field} must be a non-negative integer.`);
}

function optionalResultInteger(
  value: unknown,
  field: string,
): Pick<LiveQueryDeliveryResult, "staleSkipped"> {
  if (value === undefined) return {};
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { staleSkipped: value };
  }
  throw new HttpError(502, `${field} must be a non-negative integer when present.`);
}

function deliveryJson(value: unknown, field: string): Json {
  if (isDeliveryJson(value)) return value;
  throw new Error(`${field} must be a JSON value.`);
}

function isDeliveryJson(value: unknown): value is Json {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isDeliveryJson);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(isDeliveryJson);
}
