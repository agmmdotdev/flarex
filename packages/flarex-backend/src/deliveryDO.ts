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
import {
  ackLiveQueryDeliveryBatchEffect,
  claimLiveQueryDeliveryBatchEffect,
  deliveryExecutorBoundaryErrorToHttpError,
  isDeliveryExecutorBoundaryError,
} from "./delivery/ExecutorBoundary";
import {
  decodePendingDeliveryDrainFromStorage,
  DeliveryPendingDrainStateError,
  deliveryPendingDrainStateErrorToHttpError,
  type PendingDeliveryDrain,
} from "./delivery/PendingDrainState";
import { HttpError, errorResponse, json } from "./http";
import { Data, Effect } from "effect";
import {
  addLiveQueryDeliverySkipReasons,
  deliverLiveQueryChangesToConnectionsEffect,
  liveQueryDeliveryTargetErrorToHttpError,
  LiveQueryDeliveryTargetError,
  liveQueryDeliveryChangesFromBody,
  liveQueryDeliverySkipMetadata,
  type LiveQueryDeliveryChange,
  type LiveQueryDeliveryResult,
  type LiveQueryDeliverySkipReasons,
} from "./liveQueryDelivery";
import {
  type ClaimLiveQueryDeliveryBatchResult,
  type LiveQueryDeliveryCursor,
  type LiveQueryDeliveryRecord,
} from "./liveQueryDeliveryResponses";
import type { Env } from "./types";

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
    if (request.method === "POST" && isDeliveryJsonRoutePath(url.pathname)) {
      return runDeliveryRoute(routeDeliveryDurableObject(request, url.pathname, {
        wake: body => this.wakeEffect(body),
        continuePendingDrain: () => this.continuePendingDrainEffect(),
      }));
    }
    return json({ service: "flarex-delivery", status: "ok" });
  }

  async alarm(): Promise<void> {
    try {
      await Effect.runPromise(this.continuePendingDrainEffect());
    } catch {
      // Retry state is persisted by continuePendingDrainEffect().
    }
  }

  private continuePendingDrainEffect(): Effect.Effect<
    DeliveryDrainResult | { skipped: true },
    DeliveryPendingDrainStateError | DeliveryDrainFailureError | DeliveryRouteOperationError
  > {
    const storage = this.ctx.storage;
    const self = this;
    return Effect.gen(function* () {
      const storedPending = yield* Effect.tryPromise({
        try: () => storage.get(PENDING_DRAIN_KEY),
        catch: error => deliveryRouteOperationError("continue", error),
      });
      if (storedPending === undefined) return { skipped: true };
      const pending = yield* decodePendingDeliveryDrainFromStorage(storedPending);
      const result = yield* self.drainEffect(pending).pipe(
        Effect.catch(error =>
          self.scheduleDrainRetryEffect(pending).pipe(
            Effect.flatMap(() => Effect.fail(error)),
          )
        ),
      );
      yield* self.persistDrainContinuationEffect("continue", pending, result);
      return publicDrainResult(result);
    });
  }

  private wakeEffect(
    body: DeliveryWakeRequest,
  ): Effect.Effect<DeliveryDrainResult, DeliveryDrainFailureError | DeliveryRouteOperationError> {
    if (this.drainInFlight !== undefined) {
      return this.awaitDrainInFlight("wake", this.drainInFlight);
    }
    const pending = pendingDrainFromWake(body);
    const drain = Effect.runPromise(
      this.drainEffect(pending).pipe(
        Effect.tap(result => this.persistDrainContinuationEffect("wake", pending, result)),
        Effect.map(publicDrainResult),
      ),
    ).finally(() => {
      this.drainInFlight = undefined;
    });
    this.drainInFlight = drain;
    return this.awaitDrainInFlight("wake", drain);
  }

  private drainEffect(
    body: PendingDeliveryDrain,
  ): Effect.Effect<DeliveryDrainRunResult, DeliveryDrainFailureError> {
    const deploymentId = body.deploymentId;
    const limit = body.limit;
    const maxBatches = body.maxBatches;

    const leaseDurationMs = body.leaseDurationMs;
    const claimOwner = body.claimOwner;

    const self = this;
    return Effect.gen(function* () {
      let batches = 0;
      let claimed = 0;
      let acked = 0;
      let delivered = 0;
      let skipped = 0;
      const skipReasons: LiveQueryDeliverySkipReasons = {};
      let hasMore = false;
      let cursor = body.cursor;

      while (batches < maxBatches) {
        const page = yield* self.claimEffect(
          deploymentId,
          limit,
          leaseDurationMs,
          claimOwner,
          cursor,
        ).pipe(
          Effect.mapError(error =>
            newDeliveryDrainFailureError({
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
            })
          ),
        );
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
        const fanout = yield* deliverLiveQueryChangesToConnectionsEffect(
            self.env,
            deploymentId,
            changes,
        ).pipe(
          Effect.tapError(error =>
            self.reportDeliveryFailureEffect(
              deploymentId,
              page.deliveries,
              claimOwner,
              "fanout",
              error,
            )
          ),
          Effect.mapError(error => newDeliveryDrainFailureError({
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
          })),
        );
        delivered += fanout.delivered;
        skipped += fanout.skipped;
        addLiveQueryDeliverySkipReasons(skipReasons, fanout.skipReasons);

        const ack = yield* self.ackEffect(
          deploymentId,
          page.deliveries.map(delivery => delivery.deliveryId),
          claimOwner,
        ).pipe(
          Effect.tapError(error =>
            self.reportDeliveryFailureEffect(
              deploymentId,
              page.deliveries,
              claimOwner,
              "ack",
              error,
            )
          ),
          Effect.mapError(error => newDeliveryDrainFailureError({
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
          })),
        );
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
    });
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

  private persistDrainContinuationEffect(
    operation: DeliveryRouteOperation,
    pending: PendingDeliveryDrain,
    result: DeliveryDrainRunResult,
  ): Effect.Effect<void, DeliveryRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.persistDrainContinuation(pending, result),
      catch: error => deliveryRouteOperationError(operation, error),
    });
  }

  private scheduleDrainRetryEffect(
    pending: PendingDeliveryDrain,
  ): Effect.Effect<void, DeliveryRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.scheduleDrainRetry(pending),
      catch: error => deliveryRouteOperationError("continue", error),
    });
  }

  private awaitDrainInFlight(
    operation: DeliveryRouteOperation,
    drain: Promise<DeliveryDrainResult>,
  ): Effect.Effect<DeliveryDrainResult, DeliveryDrainFailureError | DeliveryRouteOperationError> {
    return Effect.tryPromise({
      try: () => drain,
      catch: error =>
        error instanceof DeliveryDrainFailureError
          ? error
          : deliveryRouteOperationError(operation, error),
    });
  }

  private claimEffect(
    deploymentId: string,
    limit: number,
    leaseDurationMs: number,
    claimOwner: string,
    cursor: LiveQueryDeliveryCursor | undefined,
  ) {
    return claimLiveQueryDeliveryBatchEffect(
      (path, body) => this.executorFetch(path, body),
      {
        deploymentId,
        limit,
        leaseDurationMs,
        claimOwner,
        cursor,
      },
    );
  }

  private ackEffect(
    deploymentId: string,
    deliveryIds: string[],
    claimOwner: string,
  ) {
    return ackLiveQueryDeliveryBatchEffect(
      (path, body) => this.executorFetch(path, body),
      {
        deploymentId,
        deliveryIds,
        claimOwner,
      },
    );
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

  private reportDeliveryFailureEffect(
    deploymentId: string,
    deliveries: LiveQueryDeliveryRecord[],
    claimOwner: string,
    stage: DeliveryFailureStage,
    error: unknown,
  ): Effect.Effect<void> {
    return Effect.tryPromise({
      try: () => this.reportDeliveryFailure(deploymentId, deliveries, claimOwner, stage, error),
      catch: reportError => reportError,
    }).pipe(
      Effect.catch(() => Effect.void),
    );
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

interface DeliveryRouteHandlers {
  wake(body: DeliveryWakeRequest): Effect.Effect<
    DeliveryDrainResult,
    DeliveryDrainFailureError | DeliveryRouteOperationError
  >;
  continuePendingDrain(): Effect.Effect<
    DeliveryDrainResult | { skipped: true },
    DeliveryPendingDrainStateError | DeliveryDrainFailureError | DeliveryRouteOperationError
  >;
}

const DELIVERY_JSON_ROUTE_PATHS = [
  "/wake",
  "/continue",
] as const;

type DeliveryJsonRoutePath = typeof DELIVERY_JSON_ROUTE_PATHS[number];

function isDeliveryJsonRoutePath(pathname: string): pathname is DeliveryJsonRoutePath {
  return (DELIVERY_JSON_ROUTE_PATHS as readonly string[]).includes(pathname);
}

const routeDeliveryDurableObject = Effect.fn("DeliveryDO.route")(
  function* (
    request: Request,
    pathname: DeliveryJsonRoutePath,
    handlers: DeliveryRouteHandlers,
  ): Effect.fn.Return<Response, DeliveryInternalRouteError> {
    switch (pathname) {
      case "/wake":
        return yield* routeDeliveryWake(request, handlers.wake);
      case "/continue":
        return yield* routeDeliveryContinue(handlers.continuePendingDrain);
    }
  },
);

const routeDeliveryWake = Effect.fn("DeliveryDO.routeWake")(
  function* (
    request: Request,
    wake: (
      body: DeliveryWakeRequest,
    ) => Effect.Effect<DeliveryDrainResult, DeliveryDrainFailureError | DeliveryRouteOperationError>,
  ) {
    const decoded = yield* decodeDeliveryWakeRequest(request);
    return yield* routeDeliveryDrainResult(() => wake(decoded));
  },
);

const routeDeliveryContinue = Effect.fn("DeliveryDO.routeContinue")(
  function* (
    continuePendingDrain: () => Effect.Effect<
      DeliveryDrainResult | { skipped: true },
      DeliveryPendingDrainStateError | DeliveryDrainFailureError | DeliveryRouteOperationError
    >,
  ) {
    return yield* routeDeliveryDrainResult(continuePendingDrain);
  },
);

function routeDeliveryDrainResult<A extends object>(
  execute: () => Effect.Effect<
    A,
    DeliveryRouteOperationError | DeliveryPendingDrainStateError | DeliveryDrainFailureError
  >,
): Effect.Effect<
  Response,
  DeliveryRouteOperationError | DeliveryPendingDrainStateError | DeliveryDrainFailureError
> {
  return execute().pipe(
    Effect.map(result => json(result)),
  );
}

type DeliveryInternalRouteError =
  | DeliveryWakeRouteError
  | DeliveryRouteOperationError
  | DeliveryPendingDrainStateError
  | DeliveryDrainFailureError;

function runDeliveryRoute(
  effect: Effect.Effect<Response, DeliveryInternalRouteError>,
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        RequestJsonError: recoverDeliveryInternalRouteError,
        DeliveryWakePayloadError: recoverDeliveryInternalRouteError,
        DeliveryRouteOperationError: recoverDeliveryInternalRouteError,
        DeliveryPendingDrainStateError: recoverDeliveryInternalRouteError,
        DeliveryDrainFailureError: recoverDeliveryInternalRouteError,
      }),
    ),
  );
}

function recoverDeliveryInternalRouteError(
  error: DeliveryInternalRouteError,
): Effect.Effect<Response> {
  return Effect.succeed(deliveryInternalRouteErrorToResponse(error));
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
  if (error instanceof DeliveryPendingDrainStateError) {
    return errorResponse(deliveryPendingDrainStateErrorToHttpError(error));
  }
  return errorResponse(deliveryWakeRouteErrorToHttpError(error));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

class DeliveryDrainFailureError extends Data.TaggedError("DeliveryDrainFailureError")<{
  readonly result: DeliveryDrainFailureResult;
  readonly message: string;
}> {}

function newDeliveryDrainFailureError(input: {
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
}): DeliveryDrainFailureError {
  const result = deliveryDrainFailureResult(input);
  return new DeliveryDrainFailureError({
    result,
    message: result.error,
  });
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
    status: deliveryFailureStatus(input.error),
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

function deliveryFailureStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (isDeliveryExecutorBoundaryError(error)) {
    return deliveryExecutorBoundaryErrorToHttpError(error).status;
  }
  if (error instanceof LiveQueryDeliveryTargetError) {
    return liveQueryDeliveryTargetErrorToHttpError(error).status;
  }
  return 500;
}

function publicDrainResult(result: DeliveryDrainRunResult): DeliveryDrainResult {
  const { continuationCursor: _continuationCursor, ...publicResult } = result;
  return publicResult;
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
