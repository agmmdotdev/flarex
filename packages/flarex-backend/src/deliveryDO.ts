import { DurableObject } from "cloudflare:workers";
import { HttpError, json, readJson } from "./http";
import {
  addLiveQueryDeliverySkipReasons,
  deliverLiveQueryChangesToConnections,
  liveQueryDeliveryChangesFromBody,
  liveQueryDeliverySkipMetadata,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryResult,
  type LiveQueryDeliverySkipReasons,
} from "./liveQueryDelivery";
import type { Env } from "./types";

type DeliveryWakeRequest = {
  deploymentId?: string;
  limit?: number;
  maxBatches?: number;
  leaseDurationMs?: number;
};

type PendingDeliveryDrain = {
  deploymentId: string;
  limit: number;
  maxBatches: number;
  leaseDurationMs: number;
  claimOwner: string;
  retryAttempt: number;
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

type DeliveryDrainResult = LiveQueryDeliveryResult & {
  deploymentId: string;
  batches: number;
  claimed: number;
  acked: number;
  hasMore: boolean;
  summary: DeliveryDrainSummary;
};

type DeliveryFailureStage = "fanout" | "ack";

type DeliveryDrainSummary = LiveQueryDeliveryResult & {
  batches: number;
  claimed: number;
  acked: number;
  pendingAck: number;
  hasMore: boolean;
};

export type DeliveryDrainFailureStage = "claim" | DeliveryFailureStage;

export type DeliveryDrainFailureDetail = {
  stage: DeliveryDrainFailureStage;
  status: number;
  error: string;
};

export type DeliveryDrainFailureSummary = DeliveryDrainSummary & {
  failure: DeliveryDrainFailureDetail;
};

export type DeliveryDrainFailureResult = {
  deploymentId: string;
  error: string;
  failure: DeliveryDrainFailureDetail;
  summary: DeliveryDrainFailureSummary;
};

const DEFAULT_DELIVERY_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 3;
const DEFAULT_LEASE_DURATION_MS = 30_000;
const PENDING_DRAIN_KEY = "pendingDrain";
const CONTINUE_ALARM_DELAY_MS = 100;
const RETRY_ALARM_BASE_DELAY_MS = 250;
const RETRY_ALARM_MAX_DELAY_MS = 30_000;

export class DeliveryDO extends DurableObject<Env> {
  private drainInFlight: Promise<DeliveryDrainResult> | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/wake" && request.method === "POST") {
      try {
        return json(await this.wake(await readJson<DeliveryWakeRequest>(request)));
      } catch (error) {
        if (error instanceof DeliveryDrainFailureError) {
          return json(error.result, { status: 500 });
        }
        throw error;
      }
    }
    if (url.pathname === "/continue" && request.method === "POST") {
      try {
        return json(await this.continuePendingDrain());
      } catch (error) {
        if (error instanceof DeliveryDrainFailureError) {
          return json(error.result, { status: 500 });
        }
        throw error;
      }
    }
    return json({ service: "flarex-delivery", status: "ok" });
  }

  async alarm(): Promise<void> {
    try {
      await this.continuePendingDrain();
    } catch {
      // Retry state is persisted by continuePendingDrain().
    }
  }

  private async continuePendingDrain(): Promise<DeliveryDrainResult | { skipped: true }> {
    const pending = await this.ctx.storage.get<PendingDeliveryDrain>(
      PENDING_DRAIN_KEY,
    );
    if (pending === undefined) return { skipped: true };

    try {
      const result = await this.drain(pending);
      await this.persistDrainContinuation(pending, result);
      return result;
    } catch (error) {
      await this.scheduleDrainRetry(pending);
      throw error;
    }
  }

  private async wake(body: DeliveryWakeRequest): Promise<DeliveryDrainResult> {
    if (this.drainInFlight !== undefined) {
      return this.drainInFlight;
    }
    const pending = pendingDrainFromWake(body);
    const drain = this.drain(pending).then(async result => {
      await this.persistDrainContinuation(pending, result);
      return result;
    }).finally(() => {
      this.drainInFlight = undefined;
    });
    this.drainInFlight = drain;
    return drain;
  }

  private async drain(body: PendingDeliveryDrain): Promise<DeliveryDrainResult> {
    const deploymentId = body.deploymentId;
    const limit = body.limit;
    const maxBatches = body.maxBatches;

    let batches = 0;
    let claimed = 0;
    let acked = 0;
    let delivered = 0;
    let skipped = 0;
    const skipReasons: LiveQueryDeliverySkipReasons = {};
    let hasMore = false;
    let cursor: LiveQueryDeliveryCursor | undefined;
    const leaseDurationMs = body.leaseDurationMs;
    const claimOwner = body.claimOwner;

    while (batches < maxBatches) {
      let page: ClaimLiveQueryDeliveryBatchResult;
      try {
        page = await this.claim(
          deploymentId,
          limit,
          leaseDurationMs,
          claimOwner,
          cursor,
        );
      } catch (error) {
        throw new DeliveryDrainFailureError(deliveryDrainFailureResult({
          deploymentId,
          stage: "claim",
          error,
          batches,
          claimed,
          acked,
          delivered,
          skipped,
          skipReasons,
          hasMore,
        }));
      }
      batches += 1;
      if (page.deliveries.length === 0) {
        hasMore = page.hasMore;
        break;
      }

      claimed += page.deliveries.length;
      const changes = deliveryChangesFromRecords(page.deliveries);
      let fanout;
      try {
        fanout = await deliverLiveQueryChangesToConnections(
          this.env,
          deploymentId,
          changes,
        );
      } catch (error) {
        await this.reportDeliveryFailure(
          deploymentId,
          page.deliveries,
          claimOwner,
          "fanout",
          error,
        );
        throw new DeliveryDrainFailureError(deliveryDrainFailureResult({
          deploymentId,
          stage: "fanout",
          error,
          batches,
          claimed,
          acked,
          delivered,
          skipped,
          skipReasons,
          hasMore: page.hasMore,
        }));
      }
      delivered += fanout.delivered;
      skipped += fanout.skipped;
      addLiveQueryDeliverySkipReasons(skipReasons, fanout.skipReasons);

      let ack;
      try {
        ack = await this.ack(
          deploymentId,
          page.deliveries.map(delivery => delivery.deliveryId),
          claimOwner,
        );
      } catch (error) {
        await this.reportDeliveryFailure(
          deploymentId,
          page.deliveries,
          claimOwner,
          "ack",
          error,
        );
        throw new DeliveryDrainFailureError(deliveryDrainFailureResult({
          deploymentId,
          stage: "ack",
          error,
          batches,
          claimed,
          acked,
          delivered,
          skipped,
          skipReasons,
          hasMore: page.hasMore,
        }));
      }
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
      ...liveQueryDeliverySkipMetadata(skipReasons),
      hasMore,
      summary: {
        batches,
        claimed,
        acked,
        delivered,
        skipped,
        ...liveQueryDeliverySkipMetadata(skipReasons),
        pendingAck: Math.max(0, claimed - acked),
        hasMore,
      },
    };
  }

  private async persistDrainContinuation(
    pending: PendingDeliveryDrain,
    result: DeliveryDrainResult,
  ): Promise<void> {
    if (!result.hasMore) {
      await this.ctx.storage.delete(PENDING_DRAIN_KEY);
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.put(PENDING_DRAIN_KEY, {
      ...pending,
      retryAttempt: 0,
    });
    await this.ctx.storage.setAlarm(Date.now() + CONTINUE_ALARM_DELAY_MS);
  }

  private async scheduleDrainRetry(pending: PendingDeliveryDrain): Promise<void> {
    const retryAttempt = pending.retryAttempt + 1;
    await this.ctx.storage.put(PENDING_DRAIN_KEY, {
      ...pending,
      retryAttempt,
    });
    await this.ctx.storage.setAlarm(
      Date.now() + retryDelayMs(retryAttempt),
    );
  }

  private async claim(
    deploymentId: string,
    limit: number,
    leaseDurationMs: number,
    claimOwner: string,
    cursor: LiveQueryDeliveryCursor | undefined,
  ): Promise<ClaimLiveQueryDeliveryBatchResult> {
    const body = {
      deploymentId,
      limit,
      leaseDurationMs,
      claimOwner,
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
    claimOwner: string,
  ): Promise<{ delivered: number }> {
    const response = await this.executorFetch("/maintenance/live-queries/ack", {
      deploymentId,
      deliveryIds,
      claimOwner,
    });
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query delivery ack failed with status ${response.status}.`,
      );
    }
    return ackResultFromUnknown(await response.json().catch(() => null));
  }

  private async reportDeliveryFailure(
    deploymentId: string,
    deliveries: LiveQueryDeliveryRecord[],
    claimOwner: string,
    stage: DeliveryFailureStage,
    error: unknown,
  ): Promise<void> {
    try {
      const response = await this.executorFetch(
        "/maintenance/live-queries/failure",
        {
          deploymentId,
          deliveryIds: deliveries.map(delivery => delivery.deliveryId),
          claimOwner,
          stage,
          error: errorMessage(error),
          failedAt: new Date().toISOString(),
        },
      );
      if (!response.ok) {
        console.error(
          `Live query delivery failure report failed with status ${response.status}.`,
        );
      }
    } catch (reportError) {
      console.error("Live query delivery failure report failed.", reportError);
    }
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class DeliveryDrainFailureError extends Error {
  constructor(readonly result: DeliveryDrainFailureResult) {
    super(result.error);
    this.name = "DeliveryDrainFailureError";
  }
}

function deliveryDrainFailureResult(input: {
  deploymentId: string;
  stage: DeliveryDrainFailureStage;
  error: unknown;
  batches: number;
  claimed: number;
  acked: number;
  delivered: number;
  skipped: number;
  skipReasons: LiveQueryDeliverySkipReasons;
  hasMore: boolean;
}): DeliveryDrainFailureResult {
  const detail = {
    stage: input.stage,
    status: input.error instanceof HttpError ? input.error.status : 500,
    error: errorMessage(input.error),
  };
  return {
    deploymentId: input.deploymentId,
    error: detail.error,
    failure: detail,
    summary: {
      batches: input.batches,
      claimed: input.claimed,
      acked: input.acked,
      delivered: input.delivered,
      skipped: input.skipped,
      ...liveQueryDeliverySkipMetadata(input.skipReasons),
      pendingAck: Math.max(0, input.claimed - input.acked),
      hasMore: input.hasMore,
      failure: detail,
    },
  };
}

function pendingDrainFromWake(body: DeliveryWakeRequest): PendingDeliveryDrain {
  const deploymentId = requiredWakeString(body.deploymentId, "deploymentId");
  return {
    deploymentId,
    limit: optionalPositiveInteger(body.limit, DEFAULT_DELIVERY_LIMIT, "limit"),
    maxBatches: optionalPositiveInteger(
      body.maxBatches,
      DEFAULT_MAX_BATCHES,
      "maxBatches",
    ),
    leaseDurationMs: optionalPositiveInteger(
      body.leaseDurationMs,
      DEFAULT_LEASE_DURATION_MS,
      "leaseDurationMs",
    ),
    claimOwner: newDeliveryClaimOwner(deploymentId),
    retryAttempt: 0,
  };
}

function newDeliveryClaimOwner(deploymentId: string): string {
  const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `delivery:${deploymentId}:${token}`;
}

function retryDelayMs(retryAttempt: number): number {
  return Math.min(
    RETRY_ALARM_BASE_DELAY_MS * 2 ** Math.max(0, retryAttempt - 1),
    RETRY_ALARM_MAX_DELAY_MS,
  );
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
