import { HttpError } from "./http";
import type { LiveQueryDeliveryChange } from "flarex";
import type { Env, Json } from "./types";

export type { LiveQueryDeliveryChange } from "flarex";

const LIVE_QUERY_DELIVERY_SKIP_REASONS = [
  "wrongDeployment",
  "wrongConnection",
  "missingQuery",
  "stale",
  "unchanged",
] as const;

export type LiveQueryDeliverySkipReason = typeof LIVE_QUERY_DELIVERY_SKIP_REASONS[number];

export type LiveQueryDeliverySkipReasons = Partial<Record<LiveQueryDeliverySkipReason, number>>;

export type LiveQueryDeliveryResult = {
  delivered: number;
  skipped: number;
  staleSkipped?: number;
  skipReasons?: LiveQueryDeliverySkipReasons;
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
  const skipReasons: LiveQueryDeliverySkipReasons = {};
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
    addLiveQueryDeliverySkipReasons(skipReasons, result.skipReasons);
  }

  return {
    delivered,
    skipped,
    ...liveQueryDeliverySkipMetadata(skipReasons),
    connections: byConnection.size,
  };
}

export function addLiveQueryDeliverySkipReason(
  reasons: LiveQueryDeliverySkipReasons,
  reason: LiveQueryDeliverySkipReason,
): void {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

export function addLiveQueryDeliverySkipReasons(
  target: LiveQueryDeliverySkipReasons,
  source: LiveQueryDeliverySkipReasons | undefined,
): void {
  if (source === undefined) return;
  for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
    const count = source[reason];
    if (count === undefined) continue;
    target[reason] = (target[reason] ?? 0) + count;
  }
}

export function liveQueryDeliverySkipMetadata(
  reasons: LiveQueryDeliverySkipReasons,
): Pick<LiveQueryDeliveryResult, "staleSkipped" | "skipReasons"> {
  const skipReasons = nonZeroLiveQueryDeliverySkipReasons(reasons);
  if (skipReasons === undefined) return {};
  return {
    ...(skipReasons.stale === undefined ? {} : { staleSkipped: skipReasons.stale }),
    skipReasons,
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

export function liveQueryDeliveryResultFromUnknown(
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
  const skipReasons = optionalLiveQueryDeliverySkipReasons(
    record.skipReasons,
    `${connectionId}.skipReasons`,
  );
  const staleSkipped = optionalResultInteger(record.staleSkipped, `${connectionId}.staleSkipped`);
  if (
    staleSkipped !== undefined &&
    skipReasons?.stale !== undefined &&
    staleSkipped !== skipReasons.stale
  ) {
    throw new HttpError(
      502,
      `${connectionId}.staleSkipped must match ${connectionId}.skipReasons.stale when both are present.`,
    );
  }
  const parsedStaleSkipped = staleSkipped ?? skipReasons?.stale;
  const parsedSkipReasons = normalizeParsedSkipReasons(skipReasons, staleSkipped);
  return {
    delivered: requiredResultInteger(record.delivered, `${connectionId}.delivered`),
    skipped: requiredResultInteger(record.skipped, `${connectionId}.skipped`),
    ...(parsedStaleSkipped === undefined ? {} : { staleSkipped: parsedStaleSkipped }),
    ...(parsedSkipReasons === undefined ? {} : { skipReasons: parsedSkipReasons }),
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

function optionalResultInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new HttpError(502, `${field} must be a non-negative integer when present.`);
}

function nonZeroLiveQueryDeliverySkipReasons(
  reasons: LiveQueryDeliverySkipReasons,
): LiveQueryDeliverySkipReasons | undefined {
  const result: LiveQueryDeliverySkipReasons = {};
  for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
    const count = reasons[reason];
    if (count === undefined || count === 0) continue;
    result[reason] = count;
  }
  return Object.keys(result).length === 0 ? undefined : result;
}

function optionalLiveQueryDeliverySkipReasons(
  value: unknown,
  field: string,
): LiveQueryDeliverySkipReasons | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, `${field} must be an object when present.`);
  }
  const record = value as Record<string, unknown>;
  const result: LiveQueryDeliverySkipReasons = {};
  for (const reason of LIVE_QUERY_DELIVERY_SKIP_REASONS) {
    const count = optionalResultInteger(record[reason], `${field}.${reason}`);
    if (count === undefined) continue;
    result[reason] = count;
  }
  return nonZeroLiveQueryDeliverySkipReasons(result);
}

function normalizeParsedSkipReasons(
  skipReasons: LiveQueryDeliverySkipReasons | undefined,
  staleSkipped: number | undefined,
): LiveQueryDeliverySkipReasons | undefined {
  if (skipReasons === undefined) {
    return staleSkipped === undefined ? undefined : { stale: staleSkipped };
  }
  if (staleSkipped === undefined || skipReasons.stale !== undefined) return skipReasons;
  return {
    ...skipReasons,
    stale: staleSkipped,
  };
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
