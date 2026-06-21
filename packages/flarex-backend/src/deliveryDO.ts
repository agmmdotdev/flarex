import { DurableObject } from "cloudflare:workers";
import { HttpError, json, readJson } from "./http";
import {
  deliverLiveQueryChangesToConnections,
  liveQueryDeliveryChangesFromBody,
  type LiveQueryDeliveryChange,
} from "./liveQueryDelivery";
import type { Env } from "./types";

type DeliveryWakeRequest = {
  deploymentId?: string;
  limit?: number;
  maxBatches?: number;
};

type LiveQueryDeliveryRecord = {
  deploymentId: string;
  deliveryId: string;
  connectionId: string;
  queryId: number;
  payloadJson: unknown;
};

type LiveQueryDeliveryCursor = {
  createdAt: string;
  deliveryId: string;
};

type ClaimLiveQueryDeliveryBatchResult = {
  deliveries: LiveQueryDeliveryRecord[];
  nextCursor: LiveQueryDeliveryCursor | null;
  hasMore: boolean;
};

type DeliveryDrainResult = {
  deploymentId: string;
  batches: number;
  claimed: number;
  acked: number;
  delivered: number;
  skipped: number;
  hasMore: boolean;
};

const DEFAULT_DELIVERY_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 3;

export class DeliveryDO extends DurableObject<Env> {
  private drainInFlight: Promise<DeliveryDrainResult> | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/wake" && request.method === "POST") {
      return json(await this.wake(await readJson<DeliveryWakeRequest>(request)));
    }
    return json({ service: "flarex-delivery", status: "ok" });
  }

  private async wake(body: DeliveryWakeRequest): Promise<DeliveryDrainResult> {
    if (this.drainInFlight !== undefined) {
      return this.drainInFlight;
    }
    const drain = this.drain(body).finally(() => {
      this.drainInFlight = undefined;
    });
    this.drainInFlight = drain;
    return drain;
  }

  private async drain(body: DeliveryWakeRequest): Promise<DeliveryDrainResult> {
    const deploymentId = requiredWakeString(body.deploymentId, "deploymentId");
    const limit = optionalPositiveInteger(body.limit, DEFAULT_DELIVERY_LIMIT, "limit");
    const maxBatches = optionalPositiveInteger(
      body.maxBatches,
      DEFAULT_MAX_BATCHES,
      "maxBatches",
    );

    let batches = 0;
    let claimed = 0;
    let acked = 0;
    let delivered = 0;
    let skipped = 0;
    let hasMore = false;
    let cursor: LiveQueryDeliveryCursor | undefined;

    while (batches < maxBatches) {
      const page = await this.claim(deploymentId, limit, cursor);
      batches += 1;
      if (page.deliveries.length === 0) {
        hasMore = page.hasMore;
        break;
      }

      claimed += page.deliveries.length;
      const changes = deliveryChangesFromRecords(page.deliveries);
      const fanout = await deliverLiveQueryChangesToConnections(
        this.env,
        deploymentId,
        changes,
      );
      delivered += fanout.delivered;
      skipped += fanout.skipped;

      const ack = await this.ack(
        deploymentId,
        page.deliveries.map(delivery => delivery.deliveryId),
      );
      acked += ack.delivered;
      hasMore = page.hasMore;
      if (!page.hasMore) break;
      cursor = page.nextCursor ?? undefined;
    }

    return {
      deploymentId,
      batches,
      claimed,
      acked,
      delivered,
      skipped,
      hasMore,
    };
  }

  private async claim(
    deploymentId: string,
    limit: number,
    cursor: LiveQueryDeliveryCursor | undefined,
  ): Promise<ClaimLiveQueryDeliveryBatchResult> {
    const body = {
      deploymentId,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    };
    const response = await this.executorFetch("/maintenance/live-queries/claim", body);
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query delivery claim failed with status ${response.status}.`,
      );
    }
    return claimResultFromUnknown(await response.json().catch(() => null));
  }

  private async ack(
    deploymentId: string,
    deliveryIds: string[],
  ): Promise<{ delivered: number }> {
    const response = await this.executorFetch("/maintenance/live-queries/ack", {
      deploymentId,
      deliveryIds,
    });
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query delivery ack failed with status ${response.status}.`,
      );
    }
    return ackResultFromUnknown(await response.json().catch(() => null));
  }

  private async executorFetch(path: string, body: unknown): Promise<Response> {
    const url = executorUrl(this.env, path);
    const headers = new Headers({ "content-type": "application/json" });
    if (this.env.FLAREX_EXECUTOR_TOKEN !== undefined) {
      headers.set("authorization", `Bearer ${this.env.FLAREX_EXECUTOR_TOKEN}`);
    }
    const request = new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (this.env.FLAREX_EXECUTOR !== undefined) {
      return this.env.FLAREX_EXECUTOR.fetch(request);
    }
    return fetch(request);
  }
}

function deliveryChangesFromRecords(
  deliveries: LiveQueryDeliveryRecord[],
): LiveQueryDeliveryChange[] {
  return liveQueryDeliveryChangesFromBody({
    deliveries: deliveries.map(delivery => delivery.payloadJson),
  });
}

function executorUrl(env: Env, path: string): string {
  const base = env.FLAREX_EXECUTOR_URL ?? "https://flarex-executor.internal";
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function requiredWakeString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(400, `${field} must be a non-empty string.`);
}

function optionalPositiveInteger(
  value: unknown,
  fallback: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  throw new HttpError(400, `${field} must be a positive integer.`);
}

function claimResultFromUnknown(value: unknown): ClaimLiveQueryDeliveryBatchResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Live query delivery claim response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.deliveries)) {
    throw new HttpError(502, "Live query delivery claim response.deliveries must be an array.");
  }
  return {
    deliveries: record.deliveries.map((delivery, index) =>
      deliveryRecordFromUnknown(delivery, `deliveries[${index}]`),
    ),
    nextCursor: cursorFromUnknown(record.nextCursor),
    hasMore: booleanFromUnknown(record.hasMore, "hasMore"),
  };
}

function deliveryRecordFromUnknown(
  value: unknown,
  path: string,
): LiveQueryDeliveryRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, `${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    deploymentId: stringFromUnknown(record.deploymentId, `${path}.deploymentId`),
    deliveryId: stringFromUnknown(record.deliveryId, `${path}.deliveryId`),
    connectionId: stringFromUnknown(record.connectionId, `${path}.connectionId`),
    queryId: integerFromUnknown(record.queryId, `${path}.queryId`),
    payloadJson: record.payloadJson,
  };
}

function cursorFromUnknown(value: unknown): LiveQueryDeliveryCursor | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(502, "Live query delivery claim response.nextCursor must be null or an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    createdAt: stringFromUnknown(record.createdAt, "nextCursor.createdAt"),
    deliveryId: stringFromUnknown(record.deliveryId, "nextCursor.deliveryId"),
  };
}

function stringFromUnknown(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(502, `${field} must be a non-empty string.`);
}

function integerFromUnknown(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new HttpError(502, `${field} must be an integer.`);
}

function booleanFromUnknown(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new HttpError(502, `${field} must be a boolean.`);
}

function ackResultFromUnknown(value: unknown): { delivered: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Live query delivery ack response must be an object.");
  }
  const delivered = (value as { delivered?: unknown }).delivered;
  if (typeof delivered === "number" && Number.isInteger(delivered) && delivered >= 0) {
    return { delivered };
  }
  throw new HttpError(502, "Live query delivery ack response.delivered must be a non-negative integer.");
}
