import { DurableObject } from "cloudflare:workers";
import {
  decodeDeliveryWakeRequest,
  deliveryWakeRouteErrorToHttpError,
  type DeliveryWakeRequest,
  type DeliveryWakeRouteError,
} from "./delivery/RouteBoundary";
import {
  DeliveryRouteOperationError,
  deliveryRouteOperationError,
  deliveryRouteOperationErrorToHttpError,
  type DeliveryRouteOperation,
} from "./delivery/RouteOperationError";
import { HttpError, errorResponse, json } from "./http";
import { Effect } from "effect";
import {
  addLiveQueryDeliverySkipReasons,
  deliverLiveQueryChangesToConnections,
  liveQueryDeliveryChangesFromBody,
  liveQueryDeliverySkipMetadata,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryResult,
  type LiveQueryDeliverySkipReasons,
} from "./liveQueryDelivery";
import {
  decodeLiveQueryDeliveryAckResponse,
  decodeLiveQueryDeliveryClaimResponse,
  liveQueryDeliveryResponseErrorToHttpError,
} from "./liveQueryDeliveryResponses";
import type { Env } from "./types";

type PendingDeliveryDrain = {
  deploymentId: string;
  limit: number;
  maxBatches: number;
  leaseDurationMs: number;
  claimOwner: string;
  retryAttempt: number;
  cursor?: LiveQueryDeliveryCursor;
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
} & (
  | { hasMore: true; nextCursor: LiveQueryDeliveryCursor }
  | { hasMore: false; nextCursor: LiveQueryDeliveryCursor | null }
);

type DeliveryDrainResult = LiveQueryDeliveryResult & {
  deploymentId: string;
  batches: number;
  claimed: number;
  acked: number;
  hasMore: boolean;
  summary: DeliveryDrainSummary;
};

type DeliveryDrainRunResult = DeliveryDrainResult & (
  | { hasMore: true; continuationCursor: LiveQueryDeliveryCursor }
  | { hasMore: false; continuationCursor?: never }
);

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
      return runDeliveryRoute(
        routeDeliveryWake(request, body => this.wake(body)),
      );
    }
    if (url.pathname === "/continue" && request.method === "POST") {
      return runDeliveryRoute(
        routeDeliveryContinue(() => this.continuePendingDrain()),
      );
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
    const storedPending = await this.ctx.storage.get(PENDING_DRAIN_KEY);
    if (storedPending === undefined) return { skipped: true };
    const pending = pendingDeliveryDrainFromStorage(storedPending);

    try {
      const result = await this.drain(pending);
      await this.persistDrainContinuation(pending, result);
      return publicDrainResult(result);
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
      return publicDrainResult(result);
    }).finally(() => {
      this.drainInFlight = undefined;
    });
    this.drainInFlight = drain;
    return drain;
  }

  private async drain(body: PendingDeliveryDrain): Promise<DeliveryDrainRunResult> {
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
    let cursor = body.cursor;
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
      if (page.hasMore) {
        cursor = page.nextCursor ?? undefined;
      }
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
    }

    const resultBase = {
      deploymentId,
      batches,
      claimed,
      acked,
      delivered,
      skipped,
      ...liveQueryDeliverySkipMetadata(skipReasons),
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
    if (hasMore && cursor !== undefined) {
      return {
        ...resultBase,
        hasMore: true,
        continuationCursor: cursor,
        summary: {
          ...resultBase.summary,
          hasMore: true,
        },
      };
    }
    return {
      ...resultBase,
      hasMore: false,
      summary: {
        ...resultBase.summary,
        hasMore: false,
      },
    };
  }

  private async persistDrainContinuation(
    pending: PendingDeliveryDrain,
    result: DeliveryDrainRunResult,
  ): Promise<void> {
    if (!result.hasMore) {
      await this.ctx.storage.delete(PENDING_DRAIN_KEY);
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const nextPending = {
      deploymentId: pending.deploymentId,
      limit: pending.limit,
      maxBatches: pending.maxBatches,
      leaseDurationMs: pending.leaseDurationMs,
      claimOwner: pending.claimOwner,
      ...(result.continuationCursor === undefined
        ? {}
        : { cursor: result.continuationCursor }),
      retryAttempt: 0,
    } satisfies PendingDeliveryDrain;
    await this.ctx.storage.put(PENDING_DRAIN_KEY, nextPending);
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
    const payload = await Effect.runPromise(
      decodeLiveQueryDeliveryClaimResponse<unknown>(response).pipe(
        Effect.mapError(liveQueryDeliveryResponseErrorToHttpError),
      ),
    );
    return claimResultFromUnknown(payload);
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
    const payload = await Effect.runPromise(
      decodeLiveQueryDeliveryAckResponse<unknown>(response).pipe(
        Effect.mapError(liveQueryDeliveryResponseErrorToHttpError),
      ),
    );
    return ackResultFromUnknown(payload);
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

const routeDeliveryWake = Effect.fn("DeliveryDO.routeWake")(
  function* (
    request: Request,
    wake: (body: DeliveryWakeRequest) => Promise<DeliveryDrainResult>,
  ) {
    const decoded = yield* decodeDeliveryWakeRequest(request);
    return yield* routeDeliveryDrainResult("wake", () => wake(decoded));
  },
);

const routeDeliveryContinue = Effect.fn("DeliveryDO.routeContinue")(
  function* (
    continuePendingDrain: () => Promise<DeliveryDrainResult | { skipped: true }>,
  ) {
    return yield* routeDeliveryDrainResult("continue", continuePendingDrain);
  },
);

function routeDeliveryDrainResult<A extends object>(
  operation: DeliveryRouteOperation,
  execute: () => Promise<A>,
): Effect.Effect<Response, DeliveryRouteOperationError | DeliveryDrainFailureError> {
  return Effect.tryPromise({
    try: execute,
    catch: error =>
      error instanceof DeliveryDrainFailureError
        ? error
        : deliveryRouteOperationError(operation, error),
  }).pipe(
    Effect.map(result => json(result)),
  );
}

type DeliveryInternalRouteError =
  | DeliveryWakeRouteError
  | DeliveryRouteOperationError
  | DeliveryDrainFailureError;

function runDeliveryRoute(
  effect: Effect.Effect<Response, DeliveryInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catch(error =>
        Effect.succeed(deliveryInternalRouteErrorToResponse(error))
      ),
    ),
  );
}

function deliveryInternalRouteErrorToResponse(
  error: DeliveryInternalRouteError,
): Response {
  if (error instanceof DeliveryDrainFailureError) {
    return json(error.result, { status: 500 });
  }
  if (error instanceof DeliveryRouteOperationError) {
    return errorResponse(deliveryRouteOperationErrorToHttpError(error));
  }
  return errorResponse(deliveryWakeRouteErrorToHttpError(error));
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

function publicDrainResult(result: DeliveryDrainRunResult): DeliveryDrainResult {
  const { continuationCursor: _continuationCursor, ...publicResult } = result;
  return publicResult;
}

function pendingDeliveryDrainFromStorage(value: unknown): PendingDeliveryDrain {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(500, "Pending delivery drain state must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    deploymentId: storageString(record.deploymentId, "pending delivery drain deploymentId"),
    limit: storagePositiveInteger(record.limit, "pending delivery drain limit"),
    maxBatches: storagePositiveInteger(record.maxBatches, "pending delivery drain maxBatches"),
    leaseDurationMs: storagePositiveInteger(
      record.leaseDurationMs,
      "pending delivery drain leaseDurationMs",
    ),
    claimOwner: storageString(record.claimOwner, "pending delivery drain claimOwner"),
    retryAttempt: storageNonNegativeInteger(
      record.retryAttempt,
      "pending delivery drain retryAttempt",
    ),
    ...(record.cursor === undefined
      ? {}
      : { cursor: storageCursor(record.cursor, "pending delivery drain cursor") }),
  };
}

function pendingDrainFromWake(body: DeliveryWakeRequest): PendingDeliveryDrain {
  const deploymentId = body.deploymentId;
  return {
    deploymentId,
    limit: body.limit ?? DEFAULT_DELIVERY_LIMIT,
    maxBatches: body.maxBatches ?? DEFAULT_MAX_BATCHES,
    leaseDurationMs: body.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
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

function claimResultFromUnknown(value: unknown): ClaimLiveQueryDeliveryBatchResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Live query delivery claim response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.deliveries)) {
    throw new HttpError(502, "Live query delivery claim response.deliveries must be an array.");
  }
  const nextCursor = cursorFromUnknown(record.nextCursor);
  const hasMore = booleanFromUnknown(record.hasMore, "hasMore");
  if (hasMore && nextCursor === null) {
    throw new HttpError(
      502,
      "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
    );
  }
  const deliveries = record.deliveries.map((delivery, index) =>
    deliveryRecordFromUnknown(delivery, `deliveries[${index}]`),
  );
  if (hasMore && nextCursor !== null) {
    return {
      deliveries,
      nextCursor,
      hasMore: true,
    };
  }
  return {
    deliveries,
    nextCursor,
    hasMore: false,
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
    createdAt: dateStringFromUnknown(record.createdAt, "nextCursor.createdAt"),
    deliveryId: stringFromUnknown(record.deliveryId, "nextCursor.deliveryId"),
  };
}

function storageCursor(value: unknown, field: string): LiveQueryDeliveryCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(500, `${field} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    createdAt: dateStringFromStorage(record.createdAt, `${field}.createdAt`),
    deliveryId: storageString(record.deliveryId, `${field}.deliveryId`),
  };
}

function storageString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(500, `${field} must be a non-empty string.`);
}

function storagePositiveInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new HttpError(500, `${field} must be a positive integer.`);
}

function storageNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  throw new HttpError(500, `${field} must be a non-negative integer.`);
}

function stringFromUnknown(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(502, `${field} must be a non-empty string.`);
}

function dateStringFromUnknown(value: unknown, field: string): string {
  const text = stringFromUnknown(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(502, `${field} must be an ISO date string.`);
}

function dateStringFromStorage(value: unknown, field: string): string {
  const text = storageString(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(500, `${field} must be an ISO date string.`);
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
