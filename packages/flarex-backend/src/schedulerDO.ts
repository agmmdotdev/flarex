import { DurableObject } from "cloudflare:workers";
import { HttpError, json } from "./http";
import { fetchExecutorJson } from "./executorHttp";
import { deliveryObjectName } from "./routing";
import { Effect } from "effect";
import {
  DEFAULT_DELIVERY_LIMIT,
  DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_SCAN_LIMIT,
  DEFAULT_MAX_BATCHES,
  DEFAULT_PENDING_DEPLOYMENT_LIMIT,
} from "./scheduler/Defaults";
import {
  decodeSchedulerCleanupConnectionsRequest,
  decodeSchedulerConnectionReconcileRequest,
  decodeSchedulerDeadLetterDeliveriesRequest,
  decodeSchedulerDeliveryReconcileRequest,
  decodeSchedulerRerunSubscriptionsRequest,
  type SchedulerCleanupConnectionsRequest,
  type SchedulerConnectionReconcileRequest,
  type SchedulerDeadLetterDeliveriesRequest,
  type SchedulerDeliveryReconcileRequest,
  type SchedulerRerunSubscriptionsRequest,
} from "./scheduler/RouteBoundary";
import {
  SchedulerRouteOperationError,
  schedulerRouteOperationError,
  type SchedulerRouteOperation,
} from "./scheduler/RouteOperationError";
import {
  isSchedulerRuntimeError,
  missingSchedulerContinuationCursor,
  type SchedulerRuntimeError,
} from "./scheduler/RuntimeError";
import {
  continuationNextRunAtFromStorage,
  decodePendingDeliveryReconcileFromStorage,
  decodePendingConnectionCleanupFromStorage,
  decodePendingRerunFromStorage,
  SchedulerPendingStateError,
  type PendingLiveQueryConnectionCleanup,
  type PendingLiveQueryDeliveryReconcile,
  type PendingLiveQueryRerun,
} from "./scheduler/PendingState";
import {
  cleanupExpiredLiveQueryConnectionsEffect,
  deadLetterStuckLiveQueryDeliveriesEffect,
  expiredConnectionDeploymentsEffect,
  isSchedulerMaintenanceBoundaryError,
  pendingDeploymentsEffect,
  rerunStaleLiveQuerySubscriptionsEffect,
  schedulerMaintenanceBoundaryErrorToHttpError,
  type SchedulerMaintenanceBoundaryError,
} from "./scheduler/MaintenanceBoundary";
import {
  isDeliveryDrainFailureResult,
  isSchedulerDeliveryWakeBoundaryError,
  schedulerDeliveryWakeBoundaryErrorToHttpError,
  wakeDeliveryEffect,
  type SchedulerDeliveryWakeBoundaryError,
  type SchedulerDeliveryWakeResult,
} from "./scheduler/DeliveryWakeBoundary";
import {
  forceReconnectEffect,
  type SchedulerForceReconnectBoundaryError,
  type SchedulerForceReconnectInput,
  type SchedulerForceReconnectResult,
} from "./scheduler/ForceReconnectBoundary";
import {
  routeSchedulerContinueConnectionCleanup,
  routeSchedulerEffectJsonResult,
  runSchedulerRoute,
  type SchedulerInternalRouteError,
} from "./scheduler/InternalRouteBoundary";
import {
  SchedulerResponseError,
  SchedulerResponsePayloadError,
  type ExecutorCleanupLiveQueryConnectionsResult,
  type ExecutorDeadLetterStuckResult,
  type ExecutorLiveQueryRerunResult,
  type ExpiredConnectionDeploymentCursor,
  type ExpiredConnectionDeploymentsResult,
  type PendingDeploymentCursor,
  type PendingDeploymentsResult,
} from "./scheduler/Responses";
import {
  LIVE_QUERY_SCHEDULER_INTERNAL_PATHS,
  type LiveQuerySchedulerInternalPath,
} from "./schedulerRoutes";
import type { DeliveryDrainFailureResult } from "./deliveryDO";
import type { Env } from "./types";

type ReconcileResult = {
  deployments: number;
  woken: number;
  failed: DeliveryWakeFailure[];
  nextCursor: PendingDeploymentCursor | null;
  hasMore: boolean;
};

type DeliveryWakeFailure = {
  deploymentId: string;
  status: number;
  error: string;
  failure?: DeliveryDrainFailureResult["failure"];
  summary?: DeliveryDrainFailureResult["summary"];
};

type PendingDeliveryReconcileRun = {
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  retryAttempt: number;
  cursor?: PendingDeploymentCursor;
};

type SchedulerDeliveryReconcileError =
  | SchedulerPendingStateError
  | SchedulerMaintenanceBoundaryError
  | SchedulerDeliveryWakeBoundaryError
  | SchedulerRuntimeError
  | SchedulerRouteOperationError;

type PendingConnectionCleanupRun = {
  expiredAt: string;
  limit: number;
  retryAttempt: number;
  cursor?: ExpiredConnectionDeploymentCursor;
};

type SchedulerConnectionCleanupError =
  | SchedulerPendingStateError
  | SchedulerMaintenanceBoundaryError
  | SchedulerRuntimeError
  | SchedulerRouteOperationError;

type SchedulerRerunError =
  | SchedulerPendingStateError
  | SchedulerMaintenanceBoundaryError
  | SchedulerDeliveryWakeBoundaryError
  | SchedulerRouteOperationError;

type SchedulerDeadLetterError =
  | SchedulerMaintenanceBoundaryError
  | SchedulerForceReconnectBoundaryError
  | SchedulerRouteOperationError;

type ReconcileConnectionCleanupResult = {
  deployments: number;
  cleaned: number;
  deleted: number;
  deletedConnections: number;
  failed: Array<{ deploymentId: string; status: number; error: string }>;
  nextCursor: ExpiredConnectionDeploymentCursor | null;
  hasMore: boolean;
};

type RerunResult = {
  deploymentId: string;
  changed: number;
  unchanged: number;
  unsupported: number;
  hasMoreStale: boolean;
  delivery: {
    woken: boolean;
    status: number | null;
    result: unknown;
    error: string | null;
    failure?: DeliveryDrainFailureResult["failure"];
  };
};

type DeadLetterResult = {
  batches: number;
  scanned: number;
  deadLettered: number;
  reconnectTargets: number;
  reconnected: number;
  failed: Array<{ connectionId: string; status: number; error: string }>;
  nextCursor: unknown;
  hasMore: boolean;
};

type CleanupLiveQueryConnectionsResult = {
  deploymentId: string;
  deleted: number;
  deletedConnections: number;
};

const PENDING_DELIVERY_RECONCILE_KEY = "pendingLiveQueryDeliveryReconcile";
const PENDING_RERUN_KEY = "pendingLiveQueryRerun";
const PENDING_CONNECTION_CLEANUP_KEY = "pendingLiveQueryConnectionCleanup";
const CONTINUE_DELIVERY_RECONCILE_ALARM_DELAY_MS = 100;
const DELIVERY_RECONCILE_RETRY_ALARM_BASE_DELAY_MS = 250;
const DELIVERY_RECONCILE_RETRY_ALARM_MAX_DELAY_MS = 30_000;
const CONTINUE_CONNECTION_CLEANUP_ALARM_DELAY_MS = 100;
const CONNECTION_CLEANUP_RETRY_ALARM_BASE_DELAY_MS = 250;
const CONNECTION_CLEANUP_RETRY_ALARM_MAX_DELAY_MS = 30_000;
const CONTINUE_RERUN_ALARM_DELAY_MS = 100;
const RERUN_RETRY_ALARM_BASE_DELAY_MS = 250;
const RERUN_RETRY_ALARM_MAX_DELAY_MS = 30_000;

export class SchedulerDO extends DurableObject<Env> {
  private readonly deliveryReconcileInFlight = new Map<
    string,
    Effect.Effect<ReconcileResult, SchedulerDeliveryReconcileError>
  >();
  private rerunInFlight: Effect.Effect<RerunResult, SchedulerRerunError> | undefined;
  private readonly connectionCleanupInFlight = new Map<
    string,
    Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError>
  >();
  private freshConnectionCleanupInFlight:
    | Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError>
    | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && isLiveQuerySchedulerInternalPath(url.pathname)) {
      return runSchedulerRoute(
        routeSchedulerDurableObject(request, url.pathname, this.env, {
          reconcileDeliveries: body => this.reconcileLiveQueryDeliveriesEffect(body),
          reconcileConnections: body => this.reconcileLiveQueryConnectionsEffect(body),
          deadLetterDeliveries: body => this.deadLetterLiveQueryDeliveriesEffect(body),
          cleanupConnections: body => this.cleanupLiveQueryConnectionsEffect(body),
          rerunSubscriptions: body => this.rerunLiveQuerySubscriptionsEffect(body),
          continueDeliveries: () => this.continuePendingLiveQueryDeliveryReconcileEffect(),
          continueReruns: () => this.continuePendingLiveQueryRerunEffect(),
          continueConnectionCleanup: () =>
            this.continuePendingLiveQueryConnectionCleanupEffect(),
        }),
      );
    }
    return json({ service: "flarex-scheduler", status: "ok" });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    // Deliberate runtime bridge: Cloudflare alarm callbacks return Promises.
    await Effect.runPromise(runSchedulerAlarmContinuations({
      continueDeliveries: this.continuePendingLiveQueryDeliveryReconcileEffect({
        respectNextRunAt: true,
        now,
      }),
      continueReruns: this.continuePendingLiveQueryRerunEffect({
        respectNextRunAt: true,
        now,
      }),
      continueConnectionCleanup: this.continuePendingLiveQueryConnectionCleanupEffect({
        respectNextRunAt: true,
        now,
      }),
    }));
  }

  private reconcileLiveQueryDeliveriesEffect(
    request: SchedulerDeliveryReconcileRequest,
  ): Effect.Effect<ReconcileResult, SchedulerDeliveryReconcileError> {
    const self = this;
    return Effect.gen(function* () {
      if (request.cursor === undefined) {
        const pending = yield* self.readPendingLiveQueryDeliveryReconcileEffect(
          "delivery-reconcile",
        );
        if (pending !== undefined) {
          if (!continuationIsDue(pending, Date.now())) {
            return pendingDeliveryReconcileResult(pending);
          }
          return yield* self.runAndPersistDeliveryReconcileEffect(
            pending,
            { persistContinuation: true },
            "delivery-reconcile",
          );
        }
      }
      return yield* self.runAndPersistDeliveryReconcileEffect(
        {
          limit: request.limit ?? DEFAULT_PENDING_DEPLOYMENT_LIMIT,
          deliveryLimit: request.deliveryLimit ?? DEFAULT_DELIVERY_LIMIT,
          maxBatches: request.maxBatches ?? DEFAULT_MAX_BATCHES,
          retryAttempt: 0,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        },
        { persistContinuation: request.cursor === undefined },
        "delivery-reconcile",
      );
    });
  }

  private continuePendingLiveQueryDeliveryReconcileEffect(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Effect.Effect<
    ReconcileResult | { skipped: true },
    SchedulerDeliveryReconcileError
  > {
    const self = this;
    return Effect.gen(function* () {
      const pending = yield* self.readPendingLiveQueryDeliveryReconcileEffect(
        "continue-deliveries",
      );
      if (pending === undefined) return { skipped: true };
      if (
        options?.respectNextRunAt === true &&
        !continuationIsDue(pending, options.now ?? Date.now())
      ) {
        yield* self.refreshContinuationAlarmEffect("continue-deliveries");
        return { skipped: true };
      }
      return yield* self.runAndPersistDeliveryReconcileEffect(
        pending,
        { persistContinuation: true },
        "continue-deliveries",
      );
    });
  }

  private readPendingLiveQueryDeliveryReconcileEffect(
    operation: SchedulerRouteOperation,
  ): Effect.Effect<
    PendingLiveQueryDeliveryReconcile | undefined,
    SchedulerPendingStateError | SchedulerRouteOperationError
  > {
    const storage = this.ctx.storage;
    return Effect.gen(function* () {
      const value = yield* Effect.tryPromise({
        try: () => storage.get<unknown>(PENDING_DELIVERY_RECONCILE_KEY),
        catch: error => schedulerRouteOperationError(operation, error),
      });
      if (value === undefined) return undefined;
      return yield* decodePendingDeliveryReconcileFromStorage(value);
    });
  }

  private runAndPersistDeliveryReconcileEffect(
    pending: PendingDeliveryReconcileRun,
    options: { persistContinuation: boolean },
    operation: SchedulerRouteOperation,
  ): Effect.Effect<ReconcileResult, SchedulerDeliveryReconcileError> {
    const key = deliveryReconcileInFlightKey(pending, options);
    const existing = this.deliveryReconcileInFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const self = this;
    const reconcile = this.runDeliveryReconcileEffect(pending).pipe(
      Effect.tap(result =>
        options.persistContinuation
          ? this.persistDeliveryReconcileContinuationEffect(
              pending,
              result,
              operation,
            )
          : Effect.void
      ),
      Effect.catch(error => {
        if (!options.persistContinuation || pending.cursor === undefined) {
          return Effect.fail(error);
        }
        return this.scheduleDeliveryReconcileRetryEffect(pending, operation).pipe(
          Effect.flatMap(() => Effect.fail(error)),
        );
      }),
    );
    const reconcileWithRelease = reconcile.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          self.deliveryReconcileInFlight.delete(key);
        }),
      ),
    );
    return Effect.gen(function* () {
      const inFlight = yield* Effect.cached(reconcileWithRelease);
      self.deliveryReconcileInFlight.set(key, inFlight);
      return yield* inFlight;
    });
  }

  private runDeliveryReconcileEffect(
    pending: PendingDeliveryReconcileRun,
  ): Effect.Effect<
    ReconcileResult,
    SchedulerMaintenanceBoundaryError | SchedulerDeliveryWakeBoundaryError
  > {
    const self = this;
    return Effect.gen(function* () {
      const deployments = yield* self.pendingDeploymentsEffect({
        limit: pending.limit,
        ...(pending.cursor === undefined ? {} : { cursor: pending.cursor }),
      });
      const failed: ReconcileResult["failed"] = [];
      let woken = 0;

      for (const deployment of deployments.deployments) {
        const delivery = yield* self.wakeDeliveryEffect({
          deploymentId: deployment.deploymentId,
          limit: pending.deliveryLimit,
          maxBatches: pending.maxBatches,
        }).pipe(
          Effect.matchEffect({
            onFailure: error => Effect.succeed({ ok: false as const, error }),
            onSuccess: result => Effect.succeed({ ok: true as const, result }),
          }),
        );
        if (!delivery.ok) {
          failed.push({
            deploymentId: deployment.deploymentId,
            status: schedulerServiceFailureStatus(delivery.error),
            error: schedulerServiceFailureMessage(delivery.error),
          });
          continue;
        }
        if (delivery.result.woken) {
          woken += 1;
          continue;
        }
        failed.push({
          deploymentId: deployment.deploymentId,
          status: delivery.result.status ?? 500,
          error: delivery.result.error ?? "Delivery wake failed without an error body.",
          ...(delivery.result.failure === undefined ? {} : { failure: delivery.result.failure }),
          ...(isDeliveryDrainFailureResult(delivery.result.result)
            ? { summary: delivery.result.result.summary }
            : {}),
        });
      }

      return {
        deployments: deployments.deployments.length,
        woken,
        failed,
        nextCursor: deployments.nextCursor,
        hasMore: deployments.hasMore,
      };
    });
  }
  private async persistDeliveryReconcileContinuation(
    pending: PendingDeliveryReconcileRun,
    result: ReconcileResult,
  ): Promise<void> {
    if (!result.hasMore) {
      await this.ctx.storage.delete(PENDING_DELIVERY_RECONCILE_KEY);
      await this.refreshContinuationAlarm();
      return;
    }
    if (result.nextCursor === null) {
      throw missingSchedulerContinuationCursor("delivery-reconcile");
    }
    const nextRunAt = new Date(
      Date.now() + CONTINUE_DELIVERY_RECONCILE_ALARM_DELAY_MS,
    ).toISOString();
    await this.ctx.storage.put(PENDING_DELIVERY_RECONCILE_KEY, {
      limit: pending.limit,
      deliveryLimit: pending.deliveryLimit,
      maxBatches: pending.maxBatches,
      cursor: result.nextCursor,
      retryAttempt: 0,
      nextRunAt,
    } satisfies PendingLiveQueryDeliveryReconcile);
    await this.refreshContinuationAlarm();
  }

  private persistDeliveryReconcileContinuationEffect(
    pending: PendingDeliveryReconcileRun,
    result: ReconcileResult,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRuntimeError | SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.persistDeliveryReconcileContinuation(pending, result),
      catch: error =>
        isSchedulerRuntimeError(error)
          ? error
          : schedulerRouteOperationError(operation, error),
    });
  }

  private async scheduleDeliveryReconcileRetry(
    pending: PendingDeliveryReconcileRun,
  ): Promise<void> {
    if (pending.cursor === undefined) return;
    const retryAttempt = pending.retryAttempt + 1;
    const nextRunAt = new Date(
      Date.now() + deliveryReconcileRetryDelayMs(retryAttempt),
    ).toISOString();
    await this.ctx.storage.put(PENDING_DELIVERY_RECONCILE_KEY, {
      limit: pending.limit,
      deliveryLimit: pending.deliveryLimit,
      maxBatches: pending.maxBatches,
      cursor: pending.cursor,
      retryAttempt,
      nextRunAt,
    } satisfies PendingLiveQueryDeliveryReconcile);
    await this.refreshContinuationAlarm();
  }

  private scheduleDeliveryReconcileRetryEffect(
    pending: PendingDeliveryReconcileRun,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.scheduleDeliveryReconcileRetry(pending),
      catch: error => schedulerRouteOperationError(operation, error),
    });
  }

  private reconcileLiveQueryConnectionsEffect(
    request: SchedulerConnectionReconcileRequest,
  ): Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError> {
    const self = this;
    return Effect.gen(function* () {
      if (request.cursor === undefined) {
        const pending = yield* self.readPendingLiveQueryConnectionCleanupEffect(
          "connection-reconcile",
        );
        if (pending !== undefined) {
          if (!continuationIsDue(pending, Date.now())) {
            return pendingConnectionCleanupResult(pending);
          }
          return yield* self.runAndPersistConnectionCleanupEffect(
            pending,
            { persistContinuation: true },
            "connection-reconcile",
          );
        }
        if (self.freshConnectionCleanupInFlight !== undefined) {
          return yield* self.freshConnectionCleanupInFlight;
        }
      }
      const expiredAt = request.expiredAt ?? new Date().toISOString();
      const limit = request.limit ?? DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_SCAN_LIMIT;
      const cleanup = self.runAndPersistConnectionCleanupEffect(
        {
          expiredAt,
          limit,
          retryAttempt: 0,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        },
        { persistContinuation: request.cursor === undefined },
        "connection-reconcile",
      );
      if (request.cursor !== undefined) {
        return yield* cleanup;
      }
      const cleanupWithRelease = cleanup.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            self.freshConnectionCleanupInFlight = undefined;
          }),
        ),
      );
      const inFlight = yield* Effect.cached(cleanupWithRelease);
      self.freshConnectionCleanupInFlight = inFlight;
      return yield* inFlight;
    });
  }

  private continuePendingLiveQueryConnectionCleanupEffect(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Effect.Effect<
    ReconcileConnectionCleanupResult | { skipped: true },
    SchedulerConnectionCleanupError
  > {
    const self = this;
    return Effect.gen(function* () {
      const pending = yield* self.readPendingLiveQueryConnectionCleanupEffect(
        "continue-connection-cleanup",
      );
      if (pending === undefined) return { skipped: true };
      if (
        options?.respectNextRunAt === true &&
        !continuationIsDue(pending, options.now ?? Date.now())
      ) {
        yield* self.refreshContinuationAlarmEffect("continue-connection-cleanup");
        return { skipped: true };
      }
      return yield* self.runAndPersistConnectionCleanupEffect(
        pending,
        { persistContinuation: true },
        "continue-connection-cleanup",
      );
    });
  }

  private readPendingLiveQueryConnectionCleanupEffect(
    operation: SchedulerRouteOperation,
  ): Effect.Effect<
    PendingLiveQueryConnectionCleanup | undefined,
    SchedulerPendingStateError | SchedulerRouteOperationError
  > {
    const storage = this.ctx.storage;
    return Effect.gen(function* () {
      const value = yield* Effect.tryPromise({
        try: () => storage.get<unknown>(PENDING_CONNECTION_CLEANUP_KEY),
        catch: error => schedulerRouteOperationError(operation, error),
      });
      if (value === undefined) return undefined;
      return yield* decodePendingConnectionCleanupFromStorage(value);
    });
  }

  private runAndPersistConnectionCleanupEffect(
    pending: PendingConnectionCleanupRun,
    options: { persistContinuation: boolean },
    operation: SchedulerRouteOperation,
  ): Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError> {
    const key = connectionCleanupInFlightKey(pending);
    const existing = this.connectionCleanupInFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const self = this;
    const cleanup = this.runConnectionCleanupEffect(pending).pipe(
      Effect.tap(result =>
        options.persistContinuation
          ? this.persistConnectionCleanupContinuationEffect(
              pending,
              result,
              operation,
            )
          : Effect.void
      ),
      Effect.catch(error => {
        if (!options.persistContinuation || pending.cursor === undefined) {
          return Effect.fail(error);
        }
        return this.scheduleConnectionCleanupRetryEffect(pending, operation).pipe(
          Effect.flatMap(() => Effect.fail(error)),
        );
      }),
    );
    const cleanupWithRelease = cleanup.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          self.connectionCleanupInFlight.delete(key);
        }),
      ),
    );
    return Effect.gen(function* () {
      const inFlight = yield* Effect.cached(cleanupWithRelease);
      self.connectionCleanupInFlight.set(key, inFlight);
      return yield* inFlight;
    });
  }

  private runConnectionCleanupEffect(
    pending: PendingConnectionCleanupRun,
  ): Effect.Effect<
    ReconcileConnectionCleanupResult,
    SchedulerMaintenanceBoundaryError
  > {
    const self = this;
    return Effect.gen(function* () {
      const candidates = yield* self.expiredConnectionDeploymentsEffect({
        expiredAt: pending.expiredAt,
        limit: pending.limit,
        ...(pending.cursor === undefined ? {} : { cursor: pending.cursor }),
      });
      const failed: ReconcileConnectionCleanupResult["failed"] = [];
      let cleaned = 0;
      let deleted = 0;
      let deletedConnections = 0;

      for (const deployment of candidates.deployments) {
        const cleanup = yield* self.cleanupExpiredLiveQueryConnectionsEffect({
          deploymentId: deployment.deploymentId,
          projectId: deployment.projectId,
          expiredAt: pending.expiredAt,
        }).pipe(
          Effect.matchEffect({
            onFailure: error => Effect.succeed({ ok: false as const, error }),
            onSuccess: result => Effect.succeed({ ok: true as const, result }),
          }),
        );
        if (cleanup.ok) {
          cleaned += 1;
          deleted += cleanup.result.deleted;
          deletedConnections += cleanup.result.deletedConnections;
          continue;
        }
        failed.push({
          deploymentId: deployment.deploymentId,
          status: schedulerServiceFailureStatus(cleanup.error),
          error: schedulerServiceFailureMessage(cleanup.error),
        });
      }

      return {
        deployments: candidates.deployments.length,
        cleaned,
        deleted,
        deletedConnections,
        failed,
        nextCursor: candidates.nextCursor,
        hasMore: candidates.hasMore,
      };
    });
  }

  private async persistConnectionCleanupContinuation(
    pending: PendingConnectionCleanupRun,
    result: ReconcileConnectionCleanupResult,
  ): Promise<void> {
    if (!result.hasMore) {
      await this.ctx.storage.delete(PENDING_CONNECTION_CLEANUP_KEY);
      await this.refreshContinuationAlarm();
      return;
    }
    if (result.nextCursor === null) {
      throw missingSchedulerContinuationCursor("connection-cleanup");
    }
    const nextRunAt = new Date(
      Date.now() + CONTINUE_CONNECTION_CLEANUP_ALARM_DELAY_MS,
    ).toISOString();
    await this.ctx.storage.put(PENDING_CONNECTION_CLEANUP_KEY, {
      expiredAt: pending.expiredAt,
      limit: pending.limit,
      cursor: result.nextCursor,
      retryAttempt: 0,
      nextRunAt,
    } satisfies PendingLiveQueryConnectionCleanup);
    await this.refreshContinuationAlarm();
  }

  private persistConnectionCleanupContinuationEffect(
    pending: PendingConnectionCleanupRun,
    result: ReconcileConnectionCleanupResult,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRuntimeError | SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.persistConnectionCleanupContinuation(pending, result),
      catch: error =>
        isSchedulerRuntimeError(error)
          ? error
          : schedulerRouteOperationError(operation, error),
    });
  }

  private async scheduleConnectionCleanupRetry(
    pending: PendingConnectionCleanupRun,
  ): Promise<void> {
    if (pending.cursor === undefined) return;
    const retryAttempt = pending.retryAttempt + 1;
    const nextRunAt = new Date(
      Date.now() + connectionCleanupRetryDelayMs(retryAttempt),
    ).toISOString();
    await this.ctx.storage.put(PENDING_CONNECTION_CLEANUP_KEY, {
      expiredAt: pending.expiredAt,
      limit: pending.limit,
      cursor: pending.cursor,
      retryAttempt,
      nextRunAt,
    } satisfies PendingLiveQueryConnectionCleanup);
    await this.refreshContinuationAlarm();
  }

  private scheduleConnectionCleanupRetryEffect(
    pending: PendingConnectionCleanupRun,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.scheduleConnectionCleanupRetry(pending),
      catch: error => schedulerRouteOperationError(operation, error),
    });
  }

  private refreshContinuationAlarmEffect(
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.refreshContinuationAlarm(),
      catch: error => schedulerRouteOperationError(operation, error),
    });
  }

  private rerunLiveQuerySubscriptionsEffect(
    request: SchedulerRerunSubscriptionsRequest,
  ): Effect.Effect<RerunResult, SchedulerRerunError> {
    return this.runAndPersistLiveQueryRerunEffect(
      pendingRerunFromRequest(request),
      "rerun-subscriptions",
    );
  }

  private continuePendingLiveQueryRerunEffect(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Effect.Effect<RerunResult | { skipped: true }, SchedulerRerunError> {
    const self = this;
    return Effect.gen(function* () {
      const pending = yield* self.readPendingLiveQueryRerunEffect(
        "continue-reruns",
      );
      if (pending === undefined) return { skipped: true };
      if (
        options?.respectNextRunAt === true &&
        !continuationIsDue(pending, options.now ?? Date.now())
      ) {
        yield* self.refreshContinuationAlarmEffect("continue-reruns");
        return { skipped: true };
      }
      return yield* self.runAndPersistLiveQueryRerunEffect(
        pending,
        "continue-reruns",
      );
    });
  }

  private readPendingLiveQueryRerunEffect(
    operation: SchedulerRouteOperation,
  ): Effect.Effect<
    PendingLiveQueryRerun | undefined,
    SchedulerPendingStateError | SchedulerRouteOperationError
  > {
    const storage = this.ctx.storage;
    return Effect.gen(function* () {
      const value = yield* Effect.tryPromise({
        try: () => storage.get<unknown>(PENDING_RERUN_KEY),
        catch: error => schedulerRouteOperationError(operation, error),
      });
      if (value === undefined) return undefined;
      return yield* decodePendingRerunFromStorage(value);
    });
  }

  private runAndPersistLiveQueryRerunEffect(
    pending: PendingLiveQueryRerun,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<RerunResult, SchedulerRerunError> {
    if (this.rerunInFlight !== undefined) return this.rerunInFlight;
    const self = this;
    const rerun = this.runLiveQueryRerunEffect(pending).pipe(
      Effect.tap(result =>
        this.persistRerunContinuationEffect(pending, result, operation)
      ),
      Effect.catch(error =>
        this.scheduleRerunRetryEffect(pending, operation).pipe(
          Effect.flatMap(() => Effect.fail(error)),
        )
      ),
      Effect.ensuring(
        Effect.sync(() => {
          self.rerunInFlight = undefined;
        }),
      ),
    );
    return Effect.gen(function* () {
      const inFlight = yield* Effect.cached(rerun);
      self.rerunInFlight = inFlight;
      return yield* inFlight;
    });
  }

  private runLiveQueryRerunEffect(
    pending: PendingLiveQueryRerun,
  ): Effect.Effect<
    RerunResult,
    SchedulerMaintenanceBoundaryError | SchedulerDeliveryWakeBoundaryError
  > {
    const self = this;
    return Effect.gen(function* () {
      const rerun = yield* self.rerunStaleLiveQuerySubscriptionsEffect({
        deploymentId: pending.deploymentId,
        ...(pending.projectId === undefined ? {} : { projectId: pending.projectId }),
        limit: pending.limit,
      });

      if (rerun.changed.length === 0) {
        return {
          deploymentId: pending.deploymentId,
          changed: 0,
          unchanged: rerun.unchanged.length,
          unsupported: rerun.unsupported.length,
          hasMoreStale: rerun.hasMoreStale,
          delivery: {
            woken: false,
            status: null,
            result: null,
            error: null,
          },
        };
      }

      const wake = yield* self.wakeDeliveryEffect({
        deploymentId: pending.deploymentId,
        limit: pending.deliveryLimit,
        maxBatches: pending.maxBatches,
      });

      return {
        deploymentId: pending.deploymentId,
        changed: rerun.changed.length,
        unchanged: rerun.unchanged.length,
        unsupported: rerun.unsupported.length,
        hasMoreStale: rerun.hasMoreStale,
        delivery: wake,
      };
    });
  }

  private async persistRerunContinuation(
    pending: PendingLiveQueryRerun,
    result: RerunResult,
  ): Promise<void> {
    if (!result.hasMoreStale) {
      await this.ctx.storage.delete(PENDING_RERUN_KEY);
      await this.refreshContinuationAlarm();
      return;
    }
    const nextRunAt = new Date(Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS).toISOString();
    await this.ctx.storage.put(PENDING_RERUN_KEY, {
      ...pending,
      retryAttempt: 0,
      nextRunAt,
    });
    await this.refreshContinuationAlarm();
  }

  private persistRerunContinuationEffect(
    pending: PendingLiveQueryRerun,
    result: RerunResult,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.persistRerunContinuation(pending, result),
      catch: error => schedulerRouteOperationError(operation, error),
    });
  }

  private async scheduleRerunRetry(pending: PendingLiveQueryRerun): Promise<void> {
    const retryAttempt = pending.retryAttempt + 1;
    const nextRunAt = new Date(
      Date.now() + rerunRetryDelayMs(retryAttempt),
    ).toISOString();
    await this.ctx.storage.put(PENDING_RERUN_KEY, {
      ...pending,
      retryAttempt,
      nextRunAt,
    });
    await this.refreshContinuationAlarm();
  }

  private scheduleRerunRetryEffect(
    pending: PendingLiveQueryRerun,
    operation: SchedulerRouteOperation,
  ): Effect.Effect<void, SchedulerRouteOperationError> {
    return Effect.tryPromise({
      try: () => this.scheduleRerunRetry(pending),
      catch: error => schedulerRouteOperationError(operation, error),
    });
  }

  private async refreshContinuationAlarm(): Promise<void> {
    const [
      pendingDeliveryReconcileValue,
      pendingRerunValue,
      pendingConnectionCleanupValue,
    ] = await Promise.all([
      this.ctx.storage.get<unknown>(PENDING_DELIVERY_RECONCILE_KEY),
      this.ctx.storage.get<unknown>(PENDING_RERUN_KEY),
      this.ctx.storage.get<unknown>(PENDING_CONNECTION_CLEANUP_KEY),
    ]);
    const nextRunAts = [
      continuationNextRunAt(pendingDeliveryReconcileValue),
      continuationNextRunAt(pendingRerunValue),
      continuationNextRunAt(pendingConnectionCleanupValue),
    ].filter((nextRunAt): nextRunAt is number => nextRunAt !== null);
    const nextRunAt = Math.min(...nextRunAts);
    if (Number.isFinite(nextRunAt)) {
      await this.ctx.storage.setAlarm(nextRunAt);
      return;
    }
    await this.ctx.storage.deleteAlarm();
  }

  private rerunStaleLiveQuerySubscriptionsEffect(
    body: Record<string, unknown>,
  ): Effect.Effect<
    ExecutorLiveQueryRerunResult,
    SchedulerMaintenanceBoundaryError
  > {
    return rerunStaleLiveQuerySubscriptionsEffect(
      (path, body) => fetchExecutorJson(this.env, path, body),
      body,
    );
  }

  private wakeDeliveryEffect(input: {
    deploymentId: string;
    limit: number;
    maxBatches?: number;
  }): Effect.Effect<SchedulerDeliveryWakeResult, SchedulerDeliveryWakeBoundaryError> {
    return wakeDeliveryEffect(
      fetchInput =>
        this.env.DELIVERIES
          .getByName(deliveryObjectName(fetchInput.deploymentId))
          .fetch("https://flarex.internal/wake", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              deploymentId: fetchInput.deploymentId,
              limit: fetchInput.limit,
              ...(fetchInput.maxBatches === undefined
                ? {}
                : { maxBatches: fetchInput.maxBatches }),
            }),
          }),
      input,
    );
  }

  private deadLetterLiveQueryDeliveriesEffect(
    request: SchedulerDeadLetterDeliveriesRequest,
  ): Effect.Effect<DeadLetterResult, SchedulerDeadLetterError> {
    return runDeadLetterLiveQueryDeliveriesEffect(
      request,
      body => this.deadLetterStuckLiveQueryDeliveriesEffect(body),
      input => this.forceReconnectEffect(input),
    );
  }

  private cleanupLiveQueryConnectionsEffect(
    request: SchedulerCleanupConnectionsRequest,
  ): Effect.Effect<CleanupLiveQueryConnectionsResult, SchedulerMaintenanceBoundaryError> {
    return this.cleanupExpiredLiveQueryConnectionsEffect({
      deploymentId: request.deploymentId,
      projectId: request.projectId,
      ...(request.expiredAt === undefined ? {} : { expiredAt: request.expiredAt }),
    }).pipe(
      Effect.map(cleanup => ({
        deploymentId: request.deploymentId,
        deleted: cleanup.deleted,
        deletedConnections: cleanup.deletedConnections,
      })),
    );
  }

  private cleanupExpiredLiveQueryConnectionsEffect(
    body: SchedulerCleanupConnectionsRequest,
  ): Effect.Effect<
    ExecutorCleanupLiveQueryConnectionsResult,
    SchedulerMaintenanceBoundaryError
  > {
    return cleanupExpiredLiveQueryConnectionsEffect(
      (path, body) => fetchExecutorJson(this.env, path, body),
      body,
    );
  }

  private expiredConnectionDeploymentsEffect(
    body: Record<string, unknown>,
  ): Effect.Effect<
    ExpiredConnectionDeploymentsResult,
    SchedulerMaintenanceBoundaryError
  > {
    return expiredConnectionDeploymentsEffect(
      (path, body) => fetchExecutorJson(this.env, path, body),
      body,
    );
  }

  private deadLetterStuckLiveQueryDeliveriesEffect(
    body: Record<string, unknown>,
  ): Effect.Effect<
    ExecutorDeadLetterStuckResult,
    SchedulerMaintenanceBoundaryError
  > {
    return deadLetterStuckLiveQueryDeliveriesEffect(
      (path, body) => fetchExecutorJson(this.env, path, body),
      body,
    );
  }

  private forceReconnectEffect(
    input: SchedulerForceReconnectInput,
  ): Effect.Effect<
    SchedulerForceReconnectResult,
    SchedulerForceReconnectBoundaryError
  > {
    return forceReconnectEffect(
      reconnectInput =>
        this.env.CONNECTIONS
          .getByName(reconnectInput.connectionId)
          .fetch("https://flarex.internal/force-reconnect", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: reconnectInput.reason }),
          }),
      input,
    );
  }

  private pendingDeploymentsEffect(input: {
    limit: number;
    cursor?: PendingDeploymentCursor;
  }): Effect.Effect<
    PendingDeploymentsResult,
    SchedulerMaintenanceBoundaryError
  > {
    return pendingDeploymentsEffect(
      (path, body) => fetchExecutorJson(this.env, path, body),
      {
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
    );
  }

}

interface SchedulerRouteHandlers {
  reconcileDeliveries(
    body: SchedulerDeliveryReconcileRequest,
  ): Effect.Effect<ReconcileResult, SchedulerDeliveryReconcileError>;
  reconcileConnections(
    body: SchedulerConnectionReconcileRequest,
  ): Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError>;
  deadLetterDeliveries(
    body: SchedulerDeadLetterDeliveriesRequest,
  ): Effect.Effect<DeadLetterResult, SchedulerDeadLetterError>;
  cleanupConnections(
    body: SchedulerCleanupConnectionsRequest,
  ): Effect.Effect<CleanupLiveQueryConnectionsResult, SchedulerMaintenanceBoundaryError>;
  rerunSubscriptions(
    body: SchedulerRerunSubscriptionsRequest,
  ): Effect.Effect<RerunResult, SchedulerRerunError>;
  continueDeliveries(): Effect.Effect<
    ReconcileResult | { skipped: true },
    SchedulerDeliveryReconcileError
  >;
  continueReruns(): Effect.Effect<
    RerunResult | { skipped: true },
    SchedulerRerunError
  >;
  continueConnectionCleanup(): Effect.Effect<
    ReconcileConnectionCleanupResult | { skipped: true },
    SchedulerConnectionCleanupError
  >;
}

function isLiveQuerySchedulerInternalPath(
  pathname: string,
): pathname is LiveQuerySchedulerInternalPath {
  return (Object.values(LIVE_QUERY_SCHEDULER_INTERNAL_PATHS) as readonly string[])
    .includes(pathname);
}

const routeSchedulerDurableObject = Effect.fn("SchedulerDO.route")(
  function* (
    request: Request,
    pathname: LiveQuerySchedulerInternalPath,
    env: Env,
    handlers: SchedulerRouteHandlers,
  ): Effect.fn.Return<Response, SchedulerInternalRouteError> {
    switch (pathname) {
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries:
        return yield* routeSchedulerDeliveryReconcile(request, handlers.reconcileDeliveries);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections:
        return yield* routeSchedulerConnectionReconcile(request, handlers.reconcileConnections);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries:
        return yield* routeSchedulerDeadLetterDeliveries(request, handlers.deadLetterDeliveries);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections:
        return yield* routeSchedulerCleanupConnections(request, env, handlers.cleanupConnections);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions:
        return yield* routeSchedulerRerunSubscriptions(request, handlers.rerunSubscriptions);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueDeliveries:
        return yield* routeSchedulerContinueDeliveries(handlers.continueDeliveries);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueReruns:
        return yield* routeSchedulerContinueReruns(handlers.continueReruns);
      case LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueConnectionCleanup:
        return yield* routeSchedulerContinueConnectionCleanup(
          handlers.continueConnectionCleanup,
        );
    }
  },
);

const routeSchedulerDeliveryReconcile = Effect.fn("SchedulerDO.routeDeliveryReconcile")(
  function* (
    request: Request,
    reconcile: (
      body: SchedulerDeliveryReconcileRequest,
    ) => Effect.Effect<ReconcileResult, SchedulerDeliveryReconcileError>,
  ) {
    const body = yield* decodeSchedulerDeliveryReconcileRequest(request);
    return yield* routeSchedulerEffectJsonResult(
      () => reconcile(body),
    );
  },
);

const routeSchedulerConnectionReconcile = Effect.fn("SchedulerDO.routeConnectionReconcile")(
  function* (
    request: Request,
    reconcile: (
      body: SchedulerConnectionReconcileRequest,
    ) => Effect.Effect<ReconcileConnectionCleanupResult, SchedulerConnectionCleanupError>,
  ) {
    const body = yield* decodeSchedulerConnectionReconcileRequest(request);
    return yield* routeSchedulerEffectJsonResult(
      () => reconcile(body),
    );
  },
);

const routeSchedulerDeadLetterDeliveries = Effect.fn("SchedulerDO.routeDeadLetterDeliveries")(
  function* (
    request: Request,
    deadLetter: (
      body: SchedulerDeadLetterDeliveriesRequest,
    ) => Effect.Effect<DeadLetterResult, SchedulerDeadLetterError>,
  ) {
    const body = yield* decodeSchedulerDeadLetterDeliveriesRequest(request);
    return yield* routeSchedulerEffectJsonResult(() => deadLetter(body));
  },
);

const routeSchedulerCleanupConnections = Effect.fn("SchedulerDO.routeCleanupConnections")(
  function* (
    request: Request,
    env: Env,
    cleanup: (
      body: SchedulerCleanupConnectionsRequest,
    ) => Effect.Effect<CleanupLiveQueryConnectionsResult, SchedulerMaintenanceBoundaryError>,
  ) {
    const body = yield* decodeSchedulerCleanupConnectionsRequest(request, env);
    return yield* routeSchedulerEffectJsonResult(
      () => cleanup(body),
    );
  },
);

const routeSchedulerRerunSubscriptions = Effect.fn("SchedulerDO.routeRerunSubscriptions")(
  function* (
    request: Request,
    rerun: (
      body: SchedulerRerunSubscriptionsRequest,
    ) => Effect.Effect<RerunResult, SchedulerRerunError>,
  ) {
    const body = yield* decodeSchedulerRerunSubscriptionsRequest(request);
    return yield* routeSchedulerEffectJsonResult(
      () => rerun(body),
    );
  },
);

const routeSchedulerContinueDeliveries = Effect.fn("SchedulerDO.routeContinueDeliveries")(
  function* (
    continueDeliveries: () => Effect.Effect<
      ReconcileResult | { skipped: true },
      SchedulerDeliveryReconcileError
    >,
  ) {
    return yield* routeSchedulerEffectJsonResult(
      continueDeliveries,
    );
  },
);

const routeSchedulerContinueReruns = Effect.fn("SchedulerDO.routeContinueReruns")(
  function* (
    continueReruns: () => Effect.Effect<
      RerunResult | { skipped: true },
      SchedulerRerunError
    >,
  ) {
    return yield* routeSchedulerEffectJsonResult(continueReruns);
  },
);

const runSchedulerAlarmContinuations = Effect.fn(
  "SchedulerDO.runAlarmContinuations",
)(function* (
  continuations: {
    readonly continueDeliveries: Effect.Effect<
      ReconcileResult | { skipped: true },
      SchedulerDeliveryReconcileError
    >;
    readonly continueReruns: Effect.Effect<
      RerunResult | { skipped: true },
      SchedulerRerunError
    >;
    readonly continueConnectionCleanup: Effect.Effect<
      ReconcileConnectionCleanupResult | { skipped: true },
      SchedulerConnectionCleanupError
    >;
  },
): Effect.fn.Return<void> {
  // Alarm continuations are best-effort bridge effects: each continuation
  // persists retry state before failing, and the alarm must still attempt the
  // remaining continuation families.
  yield* continuations.continueDeliveries.pipe(
    Effect.catch(() => Effect.void),
    Effect.asVoid,
  );
  yield* continuations.continueReruns.pipe(
    Effect.catch(() => Effect.void),
    Effect.asVoid,
  );
  yield* continuations.continueConnectionCleanup.pipe(
    Effect.catch(() => Effect.void),
    Effect.asVoid,
  );
});

const runDeadLetterLiveQueryDeliveriesEffect = Effect.fn(
  "SchedulerDO.deadLetterLiveQueryDeliveries",
)(
  function* (
    request: SchedulerDeadLetterDeliveriesRequest,
    deadLetterStuck: (
      body: Record<string, unknown>,
    ) => Effect.Effect<ExecutorDeadLetterStuckResult, SchedulerMaintenanceBoundaryError>,
    forceReconnect: (
      input: SchedulerForceReconnectInput,
    ) => Effect.Effect<SchedulerForceReconnectResult, SchedulerForceReconnectBoundaryError>,
  ): Effect.fn.Return<DeadLetterResult, SchedulerDeadLetterError> {
    const failed: DeadLetterResult["failed"] = [];
    const reconnectedConnectionIds = new Set<string>();
    let reconnectTargets = 0;
    let scanned = 0;
    let deadLettered = 0;
    let cursor = request.cursor;
    let nextCursor: unknown = null;
    let hasMore = false;
    let batches = 0;

    for (let batchIndex = 0; batchIndex < request.maxBatches; batchIndex += 1) {
      const page = yield* deadLetterStuck({
        ...(request.deploymentId === undefined
          ? {}
          : { deploymentId: request.deploymentId }),
        olderThan: request.olderThan,
        minAttempts: request.minAttempts,
        ...(cursor === undefined || cursor === null ? {} : { cursor }),
        limit: request.limit,
        reason: request.reason,
        deadLetteredAt: request.deadLetteredAt,
      });
      batches += 1;
      scanned += page.scanned.length;
      deadLettered += page.deadLettered.length;
      reconnectTargets += page.reconnectConnectionIds.length;

      for (const connectionId of page.reconnectConnectionIds) {
        if (reconnectedConnectionIds.has(connectionId)) continue;
        const result = yield* forceReconnect({
          connectionId,
          reason: request.reason,
        });
        if (result.ok) {
          reconnectedConnectionIds.add(connectionId);
          continue;
        }
        failed.push({
          connectionId,
          status: result.status,
          error: result.error,
        });
      }

      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
      if (!page.hasMore) break;
      cursor = page.nextCursor;
    }

    return {
      batches,
      scanned,
      deadLettered,
      reconnectTargets,
      reconnected: reconnectedConnectionIds.size,
      failed,
      nextCursor,
      hasMore,
    };
  },
);

function pendingRerunFromRequest(request: {
  deploymentId: string;
  projectId?: string;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
}): PendingLiveQueryRerun {
  return {
    deploymentId: request.deploymentId,
    ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
    limit: request.limit ?? DEFAULT_DELIVERY_LIMIT,
    deliveryLimit: request.deliveryLimit ?? request.limit ?? DEFAULT_DELIVERY_LIMIT,
    maxBatches: request.maxBatches ?? DEFAULT_MAX_BATCHES,
    retryAttempt: 0,
  };
}

function rerunRetryDelayMs(retryAttempt: number): number {
  return Math.min(
    RERUN_RETRY_ALARM_BASE_DELAY_MS * 2 ** Math.max(0, retryAttempt - 1),
    RERUN_RETRY_ALARM_MAX_DELAY_MS,
  );
}

function deliveryReconcileRetryDelayMs(retryAttempt: number): number {
  return Math.min(
    DELIVERY_RECONCILE_RETRY_ALARM_BASE_DELAY_MS * 2 ** Math.max(0, retryAttempt - 1),
    DELIVERY_RECONCILE_RETRY_ALARM_MAX_DELAY_MS,
  );
}

function connectionCleanupRetryDelayMs(retryAttempt: number): number {
  return Math.min(
    CONNECTION_CLEANUP_RETRY_ALARM_BASE_DELAY_MS * 2 ** Math.max(0, retryAttempt - 1),
    CONNECTION_CLEANUP_RETRY_ALARM_MAX_DELAY_MS,
  );
}

function pendingDeliveryReconcileResult(
  pending: PendingLiveQueryDeliveryReconcile,
): ReconcileResult {
  return {
    deployments: 0,
    woken: 0,
    failed: [],
    nextCursor: pending.cursor,
    hasMore: true,
  };
}

function pendingConnectionCleanupResult(
  pending: PendingLiveQueryConnectionCleanup,
): ReconcileConnectionCleanupResult {
  return {
    deployments: 0,
    cleaned: 0,
    deleted: 0,
    deletedConnections: 0,
    failed: [],
    nextCursor: pending.cursor,
    hasMore: true,
  };
}

function continuationIsDue(
  pending: { nextRunAt?: string },
  now: number,
): boolean {
  if (pending.nextRunAt === undefined) return true;
  return new Date(pending.nextRunAt).getTime() <= now;
}

function continuationNextRunAt(value: unknown): number | null {
  return continuationNextRunAtFromStorage(value, CONTINUE_RERUN_ALARM_DELAY_MS);
}

function deliveryReconcileInFlightKey(
  input: PendingDeliveryReconcileRun,
  options: { persistContinuation: boolean },
): string {
  return JSON.stringify({
    owner: options.persistContinuation ? "durable" : "stateless",
    limit: input.limit,
    deliveryLimit: input.deliveryLimit,
    maxBatches: input.maxBatches,
    cursor: input.cursor ?? null,
  });
}

function connectionCleanupInFlightKey(input: {
  expiredAt: string;
  limit: number;
  cursor?: ExpiredConnectionDeploymentCursor;
}): string {
  return JSON.stringify({
    expiredAt: input.expiredAt,
    limit: input.limit,
    cursor: input.cursor ?? null,
  });
}

function schedulerServiceFailureStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (isSchedulerMaintenanceBoundaryError(error)) {
    return schedulerMaintenanceBoundaryErrorToHttpError(error).status;
  }
  if (isSchedulerDeliveryWakeBoundaryError(error)) {
    return schedulerDeliveryWakeBoundaryErrorToHttpError(error).status;
  }
  if (error instanceof SchedulerResponseError) return 502;
  if (error instanceof SchedulerResponsePayloadError) return error.status;
  if (isSchedulerRuntimeError(error)) return 502;
  return 500;
}

function schedulerServiceFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function schedulerConnectionCleanupError(
  operation: SchedulerRouteOperation,
  error: unknown,
): SchedulerConnectionCleanupError {
  if (
    error instanceof SchedulerPendingStateError ||
    isSchedulerMaintenanceBoundaryError(error) ||
    isSchedulerRuntimeError(error) ||
    error instanceof SchedulerRouteOperationError
  ) {
    return error;
  }
  return schedulerRouteOperationError(operation, error);
}
