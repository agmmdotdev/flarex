import { DurableObject } from "cloudflare:workers";
import { errorResponse, HttpError, json, readJson } from "./http";
import { projectIdFromRequestOrEnv } from "./project";
import { deliveryObjectName } from "./routing";
import { LIVE_QUERY_SCHEDULER_INTERNAL_PATHS } from "./schedulerRoutes";
import type { Env } from "./types";

type PendingDeploymentCursor = {
  oldestCreatedAt: string;
  deploymentId: string;
};

type PendingDeployment = {
  deploymentId: string;
  oldestCreatedAt: string;
  pending: number;
};

type PendingDeploymentsResult = {
  deployments: PendingDeployment[];
  nextCursor: PendingDeploymentCursor | null;
  hasMore: boolean;
};

type ReconcileResult = {
  deployments: number;
  woken: number;
  failed: Array<{ deploymentId: string; status: number; error: string }>;
  nextCursor: PendingDeploymentCursor | null;
  hasMore: boolean;
};

type PendingLiveQueryDeliveryReconcile = {
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  cursor: PendingDeploymentCursor;
  retryAttempt: number;
  nextRunAt: string;
};

type PendingDeliveryReconcileRun = {
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  retryAttempt: number;
  cursor?: PendingDeploymentCursor;
};

type ExpiredConnectionDeploymentCursor = {
  oldestExpiredAt: string;
  deploymentId: string;
};

type ExpiredConnectionDeployment = {
  deploymentId: string;
  projectId: string;
  oldestExpiredAt: string;
  expiredConnections: number;
};

type ExpiredConnectionDeploymentsResult = {
  deployments: ExpiredConnectionDeployment[];
  nextCursor: ExpiredConnectionDeploymentCursor | null;
  hasMore: boolean;
};

type ReconcileConnectionCleanupResult = {
  deployments: number;
  cleaned: number;
  deleted: number;
  deletedConnections: number;
  failed: Array<{ deploymentId: string; status: number; error: string }>;
  nextCursor: ExpiredConnectionDeploymentCursor | null;
  hasMore: boolean;
};

type PendingLiveQueryConnectionCleanup = {
  expiredAt: string;
  limit: number;
  cursor: ExpiredConnectionDeploymentCursor;
  retryAttempt: number;
  nextRunAt: string;
};

type RerunLiveQuerySubscriptionsRequest = {
  deploymentId?: string;
  projectId?: string;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
};

type PendingLiveQueryRerun = {
  deploymentId: string;
  projectId?: string;
  limit: number;
  deliveryLimit: number;
  maxBatches: number;
  retryAttempt: number;
  nextRunAt?: string;
};

type ExecutorLiveQueryRerunResult = {
  changed: unknown[];
  unchanged: unknown[];
  unsupported: unknown[];
  hasMoreStale: boolean;
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
  };
};

type DeadLetterLiveQueryDeliveriesRequest = {
  deploymentId?: string;
  olderThan?: string;
  stuckAfterMs?: number;
  minAttempts?: number;
  cursor?: unknown;
  limit?: number;
  reason?: string;
  deadLetteredAt?: string;
  maxBatches?: number;
};

type ExecutorDeadLetterStuckResult = {
  scanned: unknown[];
  deadLettered: unknown[];
  reconnectConnectionIds: string[];
  nextCursor: unknown;
  hasMore: boolean;
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

type ExecutorCleanupLiveQueryConnectionsResult = {
  deleted: number;
  deletedConnections: number;
};

type ParsedCleanupLiveQueryConnectionsRequest = {
  deploymentId: string;
  projectId: string;
  expiredAt?: string;
};

const DEFAULT_PENDING_DEPLOYMENT_LIMIT = 25;
const DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_SCAN_LIMIT = 100;
const DEFAULT_DELIVERY_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 3;
const DEFAULT_STUCK_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_MIN_ATTEMPTS = 3;
const DEFAULT_DEAD_LETTER_REASON = "live query delivery stuck";
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
    Promise<ReconcileResult>
  >();
  private rerunInFlight: Promise<RerunResult> | undefined;
  private readonly connectionCleanupInFlight = new Map<
    string,
    Promise<ReconcileConnectionCleanupResult>
  >();
  private freshConnectionCleanupInFlight:
    | Promise<ReconcileConnectionCleanupResult>
    | undefined;

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileDeliveries &&
        request.method === "POST"
      ) {
        return json(
          await this.reconcileLiveQueryDeliveries(
            await readJson<unknown>(request),
          ),
        );
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.reconcileConnections &&
        request.method === "POST"
      ) {
        return json(
          await this.reconcileLiveQueryConnections(
            await readJson<unknown>(request),
          ),
        );
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.deadLetterDeliveries &&
        request.method === "POST"
      ) {
        return json(
          await this.deadLetterLiveQueryDeliveries(
            await readJson<unknown>(request),
          ),
        );
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.cleanupConnections &&
        request.method === "POST"
      ) {
        return json(
          await this.cleanupLiveQueryConnections(
            await readJson<unknown>(request),
          ),
        );
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.rerunSubscriptions &&
        request.method === "POST"
      ) {
        return json(
          await this.rerunLiveQuerySubscriptions(
            await readJson<unknown>(request),
          ),
        );
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueDeliveries &&
        request.method === "POST"
      ) {
        return json(await this.continuePendingLiveQueryDeliveryReconcile());
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueReruns &&
        request.method === "POST"
      ) {
        return json(await this.continuePendingLiveQueryRerun());
      }
      if (
        url.pathname === LIVE_QUERY_SCHEDULER_INTERNAL_PATHS.continueConnectionCleanup &&
        request.method === "POST"
      ) {
        return json(await this.continuePendingLiveQueryConnectionCleanup());
      }
      return json({ service: "flarex-scheduler", status: "ok" });
    } catch (error) {
      return errorResponse(error);
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    await Promise.allSettled([
      this.continuePendingLiveQueryDeliveryReconcile({ respectNextRunAt: true, now }),
      this.continuePendingLiveQueryRerun({ respectNextRunAt: true, now }),
      this.continuePendingLiveQueryConnectionCleanup({ respectNextRunAt: true, now }),
    ]);
  }

  private async reconcileLiveQueryDeliveries(
    body: unknown,
  ): Promise<ReconcileResult> {
    const request = reconcileDeliveriesRequestFromBody(body);
    if (request.cursor === undefined) {
      const pending = await this.readPendingLiveQueryDeliveryReconcile();
      if (pending !== undefined) {
        if (!continuationIsDue(pending, Date.now())) {
          return pendingDeliveryReconcileResult(pending);
        }
        return this.runAndPersistDeliveryReconcile(pending);
      }
    }
    const pending = {
      limit: request.limit ?? DEFAULT_PENDING_DEPLOYMENT_LIMIT,
      deliveryLimit: request.deliveryLimit ?? DEFAULT_DELIVERY_LIMIT,
      maxBatches: request.maxBatches ?? DEFAULT_MAX_BATCHES,
      retryAttempt: 0,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    };
    return this.runAndPersistDeliveryReconcile(pending, {
      persistContinuation: request.cursor === undefined,
    });
  }

  private async continuePendingLiveQueryDeliveryReconcile(): Promise<
    ReconcileResult | { skipped: true }
  >;
  private async continuePendingLiveQueryDeliveryReconcile(options: {
    respectNextRunAt: true;
    now: number;
  }): Promise<ReconcileResult | { skipped: true }>;
  private async continuePendingLiveQueryDeliveryReconcile(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Promise<ReconcileResult | { skipped: true }> {
    const pending = await this.readPendingLiveQueryDeliveryReconcile();
    if (pending === undefined) return { skipped: true };
    if (
      options?.respectNextRunAt === true &&
      !continuationIsDue(pending, options.now ?? Date.now())
    ) {
      await this.refreshContinuationAlarm();
      return { skipped: true };
    }
    return this.runAndPersistDeliveryReconcile(pending);
  }

  private async readPendingLiveQueryDeliveryReconcile(): Promise<
    PendingLiveQueryDeliveryReconcile | undefined
  > {
    const value = await this.ctx.storage.get<unknown>(
      PENDING_DELIVERY_RECONCILE_KEY,
    );
    if (value === undefined) return undefined;
    return pendingDeliveryReconcileFromStorage(value);
  }

  private async runAndPersistDeliveryReconcile(
    pending: PendingDeliveryReconcileRun,
    options: { persistContinuation: boolean } = { persistContinuation: true },
  ): Promise<ReconcileResult> {
    const key = deliveryReconcileInFlightKey(pending, options);
    const existing = this.deliveryReconcileInFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const reconcile = this.runDeliveryReconcile(pending)
      .then(async result => {
        if (options.persistContinuation) {
          await this.persistDeliveryReconcileContinuation(pending, result);
        }
        return result;
      })
      .catch(async (error: unknown) => {
        if (options.persistContinuation && pending.cursor !== undefined) {
          await this.scheduleDeliveryReconcileRetry(pending);
        }
        throw error;
      })
      .finally(() => {
        this.deliveryReconcileInFlight.delete(key);
      });
    this.deliveryReconcileInFlight.set(key, reconcile);
    return reconcile;
  }

  private async runDeliveryReconcile(
    pending: PendingDeliveryReconcileRun,
  ): Promise<ReconcileResult> {
    const deployments = await this.pendingDeployments({
      limit: pending.limit,
      ...(pending.cursor === undefined ? {} : { cursor: pending.cursor }),
    });
    const failed: ReconcileResult["failed"] = [];
    let woken = 0;

    for (const deployment of deployments.deployments) {
      try {
        const delivery = await this.wakeDelivery({
          deploymentId: deployment.deploymentId,
          limit: pending.deliveryLimit,
          maxBatches: pending.maxBatches,
        });
        if (delivery.woken) {
          woken += 1;
          continue;
        }
        failed.push({
          deploymentId: deployment.deploymentId,
          status: delivery.status ?? 500,
          error: delivery.error ?? "Delivery wake failed without an error body.",
        });
      } catch (error) {
        failed.push({
          deploymentId: deployment.deploymentId,
          status: error instanceof HttpError ? error.status : 500,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      deployments: deployments.deployments.length,
      woken,
      failed,
      nextCursor: deployments.nextCursor,
      hasMore: deployments.hasMore,
    };
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
      throw new HttpError(
        502,
        "Pending delivery deployment scan returned hasMore without nextCursor.",
      );
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

  private async reconcileLiveQueryConnections(
    body: unknown,
  ): Promise<ReconcileConnectionCleanupResult> {
    const request = reconcileConnectionsRequestFromBody(body);
    if (request.cursor === undefined) {
      const pending = await this.readPendingLiveQueryConnectionCleanup();
      if (pending !== undefined) {
        if (!continuationIsDue(pending, Date.now())) {
          return pendingConnectionCleanupResult(pending);
        }
        return this.runAndPersistConnectionCleanup(pending);
      }
      if (this.freshConnectionCleanupInFlight !== undefined) {
        return this.freshConnectionCleanupInFlight;
      }
    }
    const expiredAt = request.expiredAt ?? new Date().toISOString();
    const limit = request.limit ?? DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_SCAN_LIMIT;
    const cleanup = this.runAndPersistConnectionCleanup({
      expiredAt,
      limit,
      retryAttempt: 0,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    }, { persistContinuation: request.cursor === undefined });
    if (request.cursor === undefined) {
      this.freshConnectionCleanupInFlight = cleanup.finally(() => {
        this.freshConnectionCleanupInFlight = undefined;
      });
      return this.freshConnectionCleanupInFlight;
    }
    return cleanup;
  }

  private async continuePendingLiveQueryConnectionCleanup(): Promise<
    ReconcileConnectionCleanupResult | { skipped: true }
  >;
  private async continuePendingLiveQueryConnectionCleanup(options: {
    respectNextRunAt: true;
    now: number;
  }): Promise<ReconcileConnectionCleanupResult | { skipped: true }>;
  private async continuePendingLiveQueryConnectionCleanup(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Promise<ReconcileConnectionCleanupResult | { skipped: true }> {
    const pending = await this.readPendingLiveQueryConnectionCleanup();
    if (pending === undefined) return { skipped: true };
    if (
      options?.respectNextRunAt === true &&
      !continuationIsDue(pending, options.now ?? Date.now())
    ) {
      await this.refreshContinuationAlarm();
      return { skipped: true };
    }
    return this.runAndPersistConnectionCleanup(pending);
  }

  private async readPendingLiveQueryConnectionCleanup(): Promise<
    PendingLiveQueryConnectionCleanup | undefined
  > {
    const value = await this.ctx.storage.get<unknown>(
      PENDING_CONNECTION_CLEANUP_KEY,
    );
    if (value === undefined) return undefined;
    return pendingConnectionCleanupFromStorage(value);
  }

  private async runAndPersistConnectionCleanup(
    pending: {
      expiredAt: string;
      limit: number;
      retryAttempt: number;
      cursor?: ExpiredConnectionDeploymentCursor;
    },
    options: { persistContinuation: boolean } = { persistContinuation: true },
  ): Promise<ReconcileConnectionCleanupResult> {
    const key = connectionCleanupInFlightKey(pending);
    const existing = this.connectionCleanupInFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const cleanup = this.runConnectionCleanup(pending)
      .then(async result => {
        if (options.persistContinuation) {
          await this.persistConnectionCleanupContinuation(pending, result);
        }
        return result;
      })
      .catch(async error => {
        if (options.persistContinuation && pending.cursor !== undefined) {
          await this.scheduleConnectionCleanupRetry(pending);
        }
        throw error;
      })
      .finally(() => {
        this.connectionCleanupInFlight.delete(key);
      });
    this.connectionCleanupInFlight.set(key, cleanup);
    return cleanup;
  }

  private async runConnectionCleanup(
    pending: {
      expiredAt: string;
      limit: number;
      cursor?: ExpiredConnectionDeploymentCursor;
    },
  ): Promise<ReconcileConnectionCleanupResult> {
    const candidates = await this.expiredConnectionDeployments({
      expiredAt: pending.expiredAt,
      limit: pending.limit,
      ...(pending.cursor === undefined ? {} : { cursor: pending.cursor }),
    });
    const failed: ReconcileConnectionCleanupResult["failed"] = [];
    let cleaned = 0;
    let deleted = 0;
    let deletedConnections = 0;

    for (const deployment of candidates.deployments) {
      try {
        const result = await this.cleanupExpiredLiveQueryConnections({
          deploymentId: deployment.deploymentId,
          projectId: deployment.projectId,
          expiredAt: pending.expiredAt,
        });
        cleaned += 1;
        deleted += result.deleted;
        deletedConnections += result.deletedConnections;
      } catch (error) {
        failed.push({
          deploymentId: deployment.deploymentId,
          status: error instanceof HttpError ? error.status : 500,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
  }

  private async persistConnectionCleanupContinuation(
    pending: {
      expiredAt: string;
      limit: number;
      retryAttempt: number;
      cursor?: ExpiredConnectionDeploymentCursor;
    },
    result: ReconcileConnectionCleanupResult,
  ): Promise<void> {
    if (!result.hasMore) {
      await this.ctx.storage.delete(PENDING_CONNECTION_CLEANUP_KEY);
      await this.refreshContinuationAlarm();
      return;
    }
    if (result.nextCursor === null) {
      throw new HttpError(
        502,
        "Expired connection deployment scan returned hasMore without nextCursor.",
      );
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

  private async scheduleConnectionCleanupRetry(
    pending: {
      expiredAt: string;
      limit: number;
      retryAttempt: number;
      cursor?: ExpiredConnectionDeploymentCursor;
    },
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

  private async rerunLiveQuerySubscriptions(body: unknown): Promise<RerunResult> {
    const request = rerunRequestFromBody(body);
    return this.runAndPersistLiveQueryRerun(pendingRerunFromRequest(request));
  }

  private async continuePendingLiveQueryRerun(): Promise<RerunResult | { skipped: true }>;
  private async continuePendingLiveQueryRerun(options: {
    respectNextRunAt: true;
    now: number;
  }): Promise<RerunResult | { skipped: true }>;
  private async continuePendingLiveQueryRerun(options?: {
    respectNextRunAt?: boolean;
    now?: number;
  }): Promise<RerunResult | { skipped: true }> {
    const pending = await this.readPendingLiveQueryRerun();
    if (pending === undefined) return { skipped: true };
    if (
      options?.respectNextRunAt === true &&
      !continuationIsDue(pending, options.now ?? Date.now())
    ) {
      await this.refreshContinuationAlarm();
      return { skipped: true };
    }
    return this.runAndPersistLiveQueryRerun(pending);
  }

  private async readPendingLiveQueryRerun(): Promise<
    PendingLiveQueryRerun | undefined
  > {
    const value = await this.ctx.storage.get<unknown>(PENDING_RERUN_KEY);
    if (value === undefined) return undefined;
    return pendingRerunFromStorage(value);
  }

  private async runAndPersistLiveQueryRerun(
    pending: PendingLiveQueryRerun,
  ): Promise<RerunResult> {
    if (this.rerunInFlight !== undefined) return this.rerunInFlight;
    const rerun = this.runLiveQueryRerun(pending)
      .then(async result => {
        await this.persistRerunContinuation(pending, result);
        return result;
      })
      .catch(async error => {
        await this.scheduleRerunRetry(pending);
        throw error;
      })
      .finally(() => {
        this.rerunInFlight = undefined;
      });
    this.rerunInFlight = rerun;
    return rerun;
  }

  private async runLiveQueryRerun(pending: PendingLiveQueryRerun): Promise<RerunResult> {
    const rerun = await this.rerunStaleLiveQuerySubscriptions({
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

    const wake = await this.wakeDelivery({
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

  private async rerunStaleLiveQuerySubscriptions(
    body: Record<string, unknown>,
  ): Promise<ExecutorLiveQueryRerunResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/rerun",
      body,
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query rerun failed with status ${response.status}.`,
      );
    }
    return executorLiveQueryRerunResultFromUnknown(
      await response.json().catch(() => null),
    );
  }

  private async wakeDelivery(input: {
    deploymentId: string;
    limit: number;
    maxBatches?: number;
  }): Promise<RerunResult["delivery"]> {
    const response = await this.env.DELIVERIES
      .getByName(deliveryObjectName(input.deploymentId))
      .fetch("https://flarex.internal/wake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: input.deploymentId,
          limit: input.limit,
          ...(input.maxBatches === undefined ? {} : { maxBatches: input.maxBatches }),
        }),
      });
    if (!response.ok) {
      return {
        woken: false,
        status: response.status,
        result: null,
        error: await response.text(),
      };
    }
    return {
      woken: true,
      status: response.status,
      result: await response.json().catch(() => null),
      error: null,
    };
  }

  private async deadLetterLiveQueryDeliveries(
    body: unknown,
  ): Promise<DeadLetterResult> {
    const request = deadLetterRequestFromBody(body);
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
      const page = await this.deadLetterStuckLiveQueryDeliveries({
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
        const result = await this.forceReconnect(connectionId, request.reason);
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
  }

  private async cleanupLiveQueryConnections(
    body: unknown,
  ): Promise<CleanupLiveQueryConnectionsResult> {
    const request = cleanupConnectionsRequestFromBody(body, this.env);
    const cleanup = await this.cleanupExpiredLiveQueryConnections({
      deploymentId: request.deploymentId,
      projectId: request.projectId,
      ...(request.expiredAt === undefined ? {} : { expiredAt: request.expiredAt }),
    });
    return {
      deploymentId: request.deploymentId,
      deleted: cleanup.deleted,
      deletedConnections: cleanup.deletedConnections,
    };
  }

  private async cleanupExpiredLiveQueryConnections(
    body: ParsedCleanupLiveQueryConnectionsRequest,
  ): Promise<ExecutorCleanupLiveQueryConnectionsResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/connections/cleanup",
      body,
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query connection cleanup failed with status ${response.status}.`,
      );
    }
    return cleanupConnectionsResultFromUnknown(
      await response.json().catch(() => null),
    );
  }

  private async expiredConnectionDeployments(
    body: Record<string, unknown>,
  ): Promise<ExpiredConnectionDeploymentsResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/expired-connection-deployments",
      body,
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query connection cleanup deployment scan failed with status ${response.status}.`,
      );
    }
    return expiredConnectionDeploymentsResultFromUnknown(
      await response.json().catch(() => null),
    );
  }

  private async deadLetterStuckLiveQueryDeliveries(
    body: Record<string, unknown>,
  ): Promise<ExecutorDeadLetterStuckResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/dead-letter-stuck",
      body,
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query dead-letter scan failed with status ${response.status}.`,
      );
    }
    return executorDeadLetterResultFromUnknown(
      await response.json().catch(() => null),
    );
  }

  private async forceReconnect(
    connectionId: string,
    reason: string,
  ): Promise<{ ok: boolean; status: number; error: string; closed: number }> {
    validateConnectionId(connectionId);
    const response = await this.env.CONNECTIONS
      .getByName(connectionId)
      .fetch("https://flarex.internal/force-reconnect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: await response.text(),
        closed: 0,
      };
    }
    const result = forceReconnectResultFromUnknown(
      await response.json().catch(() => null),
    );
    return {
      ok: true,
      status: response.status,
      error: "",
      closed: result.closed,
    };
  }

  private async pendingDeployments(input: {
    limit: number;
    cursor?: PendingDeploymentCursor;
  }): Promise<PendingDeploymentsResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/pending-deployments",
      {
        limit: input.limit,
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      },
    );
    if (!response.ok) {
      throw new HttpError(
        502,
        `Live query pending deployment scan failed with status ${response.status}.`,
      );
    }
    return pendingDeploymentsResultFromUnknown(
      await response.json().catch(() => null),
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

function executorUrl(env: Env, path: string): string {
  const base = env.FLAREX_EXECUTOR_URL ?? "https://flarex-executor.internal";
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.href;
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

function pendingDeploymentsResultFromUnknown(
  value: unknown,
): PendingDeploymentsResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Pending deployments response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.deployments)) {
    throw new HttpError(502, "Pending deployments response.deployments must be an array.");
  }
  return {
    deployments: record.deployments.map((deployment, index) =>
      pendingDeploymentFromUnknown(deployment, `deployments[${index}]`),
    ),
    nextCursor: pendingCursorFromUnknown(record.nextCursor),
    hasMore: booleanFromUnknown(record.hasMore, "hasMore"),
  };
}

function reconcileDeliveriesRequestFromBody(value: unknown): {
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
  cursor?: PendingDeploymentCursor;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query delivery reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    ...(body.limit === undefined
      ? {}
      : { limit: optionalPositiveInteger(body.limit, DEFAULT_PENDING_DEPLOYMENT_LIMIT, "limit") }),
    ...(body.deliveryLimit === undefined
      ? {}
      : {
          deliveryLimit: optionalPositiveInteger(
            body.deliveryLimit,
            DEFAULT_DELIVERY_LIMIT,
            "deliveryLimit",
          ),
        }),
    ...(body.maxBatches === undefined
      ? {}
      : {
          maxBatches: optionalPositiveInteger(
            body.maxBatches,
            DEFAULT_MAX_BATCHES,
            "maxBatches",
          ),
        }),
    ...(body.cursor === undefined
      ? {}
      : { cursor: pendingCursorFromRequest(body.cursor) }),
  };
}

function reconcileConnectionsRequestFromBody(value: unknown): {
  expiredAt?: string;
  limit?: number;
  cursor?: ExpiredConnectionDeploymentCursor;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query connection reconcile request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    ...(body.expiredAt === undefined
      ? {}
      : { expiredAt: dateStringFromRequest(body.expiredAt, "expiredAt") }),
    ...(body.limit === undefined
      ? {}
      : {
          limit: optionalPositiveInteger(
            body.limit,
            DEFAULT_EXPIRED_CONNECTION_DEPLOYMENT_SCAN_LIMIT,
            "limit",
          ),
        }),
    ...(body.cursor === undefined
      ? {}
      : { cursor: expiredConnectionCursorFromRequest(body.cursor) }),
  };
}

function rerunRequestFromBody(value: unknown): {
  deploymentId: string;
  projectId?: string;
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query rerun request body must be an object.");
  }
  const body = value as RerunLiveQuerySubscriptionsRequest;
  return {
    deploymentId: nonEmptyStringFromRequest(body.deploymentId, "deploymentId"),
    ...(body.projectId === undefined
      ? {}
      : { projectId: nonEmptyStringFromRequest(body.projectId, "projectId") }),
    ...(body.limit === undefined
      ? {}
      : { limit: optionalPositiveInteger(body.limit, DEFAULT_DELIVERY_LIMIT, "limit") }),
    ...(body.deliveryLimit === undefined
      ? {}
      : {
          deliveryLimit: optionalPositiveInteger(
            body.deliveryLimit,
            DEFAULT_DELIVERY_LIMIT,
            "deliveryLimit",
          ),
        }),
    ...(body.maxBatches === undefined
      ? {}
      : {
          maxBatches: optionalPositiveInteger(
            body.maxBatches,
            DEFAULT_MAX_BATCHES,
            "maxBatches",
          ),
        }),
  };
}

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
  if (value === undefined) return null;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS;
  }
  const record = value as Record<string, unknown>;
  if (record.nextRunAt === undefined) {
    return Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS;
  }
  if (typeof record.nextRunAt !== "string") {
    return Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS;
  }
  const nextRunAt = new Date(record.nextRunAt).getTime();
  if (Number.isNaN(nextRunAt)) return Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS;
  return nextRunAt;
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

function pendingDeliveryReconcileFromStorage(
  value: unknown,
): PendingLiveQueryDeliveryReconcile {
  const record = storageRecord(value, "pending live query delivery reconcile");
  return {
    limit: positiveIntegerFromStorage(record.limit, "pending delivery reconcile limit"),
    deliveryLimit: positiveIntegerFromStorage(
      record.deliveryLimit,
      "pending delivery reconcile deliveryLimit",
    ),
    maxBatches: positiveIntegerFromStorage(
      record.maxBatches,
      "pending delivery reconcile maxBatches",
    ),
    cursor: pendingCursorFromStorage(record.cursor, "pending delivery reconcile cursor"),
    retryAttempt: nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending delivery reconcile retryAttempt",
    ),
    nextRunAt:
      record.nextRunAt === undefined
        ? new Date(0).toISOString()
        : dateStringFromStorage(record.nextRunAt, "pending delivery reconcile nextRunAt"),
  };
}

function pendingConnectionCleanupFromStorage(
  value: unknown,
): PendingLiveQueryConnectionCleanup {
  const record = storageRecord(value, "pending live query connection cleanup");
  return {
    expiredAt: dateStringFromStorage(record.expiredAt, "pending connection cleanup expiredAt"),
    limit: positiveIntegerFromStorage(record.limit, "pending connection cleanup limit"),
    cursor: expiredConnectionCursorFromStorage(
      record.cursor,
      "pending connection cleanup cursor",
    ),
    retryAttempt: nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending connection cleanup retryAttempt",
    ),
    nextRunAt:
      record.nextRunAt === undefined
        ? new Date(0).toISOString()
        : dateStringFromStorage(record.nextRunAt, "pending connection cleanup nextRunAt"),
  };
}

function pendingRerunFromStorage(value: unknown): PendingLiveQueryRerun {
  const record = storageRecord(value, "pending live query rerun");
  const projectId =
    record.projectId === undefined
      ? undefined
      : nonEmptyStringFromStorage(record.projectId, "pending rerun projectId");
  return {
    deploymentId: nonEmptyStringFromStorage(record.deploymentId, "pending rerun deploymentId"),
    ...(projectId === undefined ? {} : { projectId }),
    limit: positiveIntegerFromStorage(record.limit, "pending rerun limit"),
    deliveryLimit: positiveIntegerFromStorage(
      record.deliveryLimit,
      "pending rerun deliveryLimit",
    ),
    maxBatches: positiveIntegerFromStorage(record.maxBatches, "pending rerun maxBatches"),
    retryAttempt: nonNegativeIntegerFromStorage(
      record.retryAttempt,
      "pending rerun retryAttempt",
    ),
    ...(record.nextRunAt === undefined
      ? {}
      : { nextRunAt: dateStringFromStorage(record.nextRunAt, "pending rerun nextRunAt") }),
  };
}

function pendingCursorFromStorage(
  value: unknown,
  path: string,
): PendingDeploymentCursor {
  const record = storageRecord(value, path);
  return {
    oldestCreatedAt: dateStringFromStorage(
      record.oldestCreatedAt,
      `${path}.oldestCreatedAt`,
    ),
    deploymentId: nonEmptyStringFromStorage(record.deploymentId, `${path}.deploymentId`),
  };
}

function expiredConnectionCursorFromStorage(
  value: unknown,
  path: string,
): ExpiredConnectionDeploymentCursor {
  const record = storageRecord(value, path);
  return {
    oldestExpiredAt: dateStringFromStorage(
      record.oldestExpiredAt,
      `${path}.oldestExpiredAt`,
    ),
    deploymentId: nonEmptyStringFromStorage(record.deploymentId, `${path}.deploymentId`),
  };
}

function storageRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new HttpError(500, `${field} must be an object.`);
}

function dateStringFromStorage(value: unknown, field: string): string {
  const text = nonEmptyStringFromStorage(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(500, `${field} must be an ISO date string.`);
}

function nonEmptyStringFromStorage(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(500, `${field} must be a non-empty string.`);
}

function positiveIntegerFromStorage(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  throw new HttpError(500, `${field} must be a positive integer.`);
}

function nonNegativeIntegerFromStorage(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new HttpError(500, `${field} must be a non-negative integer.`);
}

function executorLiveQueryRerunResultFromUnknown(
  value: unknown,
): ExecutorLiveQueryRerunResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Live query rerun response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.changed)) {
    throw new HttpError(502, "Live query rerun response.changed must be an array.");
  }
  if (!Array.isArray(record.unchanged)) {
    throw new HttpError(502, "Live query rerun response.unchanged must be an array.");
  }
  if (!Array.isArray(record.unsupported)) {
    throw new HttpError(502, "Live query rerun response.unsupported must be an array.");
  }
  return {
    changed: record.changed,
    unchanged: record.unchanged,
    unsupported: record.unsupported,
    hasMoreStale: booleanFromUnknown(record.hasMoreStale, "hasMoreStale"),
  };
}

function pendingDeploymentFromUnknown(
  value: unknown,
  path: string,
): PendingDeployment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, `${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    deploymentId: stringFromUnknown(record.deploymentId, `${path}.deploymentId`),
    oldestCreatedAt: dateStringFromUnknown(record.oldestCreatedAt, `${path}.oldestCreatedAt`),
    pending: nonNegativeIntegerFromUnknown(record.pending, `${path}.pending`),
  };
}

function pendingCursorFromUnknown(value: unknown): PendingDeploymentCursor | null {
  if (value === null) return null;
  if (typeof value !== "object" || value === undefined || Array.isArray(value)) {
    throw new HttpError(502, "Pending deployments response.nextCursor must be null or an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    oldestCreatedAt: dateStringFromUnknown(record.oldestCreatedAt, "nextCursor.oldestCreatedAt"),
    deploymentId: stringFromUnknown(record.deploymentId, "nextCursor.deploymentId"),
  };
}

function pendingCursorFromRequest(value: unknown): PendingDeploymentCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    oldestCreatedAt: dateStringFromRequest(
      record.oldestCreatedAt,
      "cursor.oldestCreatedAt",
    ),
    deploymentId: nonEmptyStringFromRequest(record.deploymentId, "cursor.deploymentId"),
  };
}

function expiredConnectionDeploymentsResultFromUnknown(
  value: unknown,
): ExpiredConnectionDeploymentsResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Expired connection deployments response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.deployments)) {
    throw new HttpError(502, "Expired connection deployments response.deployments must be an array.");
  }
  return {
    deployments: record.deployments.map((deployment, index) =>
      expiredConnectionDeploymentFromUnknown(deployment, `deployments[${index}]`),
    ),
    nextCursor: expiredConnectionCursorOrNullFromUnknown(record.nextCursor),
    hasMore: booleanFromUnknown(record.hasMore, "hasMore"),
  };
}

function expiredConnectionDeploymentFromUnknown(
  value: unknown,
  path: string,
): ExpiredConnectionDeployment {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, `${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    deploymentId: stringFromUnknown(record.deploymentId, `${path}.deploymentId`),
    projectId: stringFromUnknown(record.projectId, `${path}.projectId`),
    oldestExpiredAt: dateStringFromUnknown(record.oldestExpiredAt, `${path}.oldestExpiredAt`),
    expiredConnections: nonNegativeIntegerFromUnknown(
      record.expiredConnections,
      `${path}.expiredConnections`,
    ),
  };
}

function expiredConnectionCursorOrNullFromUnknown(
  value: unknown,
): ExpiredConnectionDeploymentCursor | null {
  if (value === null) return null;
  return expiredConnectionCursorFromUnknown(value, "nextCursor");
}

function expiredConnectionCursorFromRequest(
  value: unknown,
): ExpiredConnectionDeploymentCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "cursor must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    oldestExpiredAt: dateStringFromRequest(
      record.oldestExpiredAt,
      "cursor.oldestExpiredAt",
    ),
    deploymentId: nonEmptyStringFromRequest(
      record.deploymentId,
      "cursor.deploymentId",
    ),
  };
}

function expiredConnectionCursorFromUnknown(
  value: unknown,
  path: string,
): ExpiredConnectionDeploymentCursor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, `${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  return {
    oldestExpiredAt: dateStringFromUnknown(record.oldestExpiredAt, `${path}.oldestExpiredAt`),
    deploymentId: stringFromUnknown(record.deploymentId, `${path}.deploymentId`),
  };
}

function dateStringFromUnknown(value: unknown, field: string): string {
  const text = stringFromUnknown(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(502, `${field} must be an ISO date string.`);
}

function stringFromUnknown(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(502, `${field} must be a non-empty string.`);
}

function nonNegativeIntegerFromUnknown(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return value;
  }
  throw new HttpError(502, `${field} must be a non-negative integer.`);
}

function booleanFromUnknown(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  throw new HttpError(502, `${field} must be a boolean.`);
}

function deadLetterRequestFromBody(
  value: unknown,
): Required<Omit<DeadLetterLiveQueryDeliveriesRequest, "deploymentId" | "cursor">> & {
  deploymentId?: string;
  cursor?: unknown;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Dead-letter request body must be an object.");
  }
  const body = value as DeadLetterLiveQueryDeliveriesRequest;
  const olderThan = olderThanFromBody(body);
  return {
    ...(body.deploymentId === undefined
      ? {}
      : { deploymentId: nonEmptyStringFromRequest(body.deploymentId, "deploymentId") }),
    olderThan,
    stuckAfterMs: body.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS,
    minAttempts: optionalPositiveInteger(
      body.minAttempts,
      DEFAULT_MIN_ATTEMPTS,
      "minAttempts",
    ),
    ...(body.cursor === undefined ? {} : { cursor: body.cursor }),
    limit: optionalPositiveInteger(body.limit, DEFAULT_DELIVERY_LIMIT, "limit"),
    reason: body.reason === undefined
      ? DEFAULT_DEAD_LETTER_REASON
      : nonEmptyStringFromRequest(body.reason, "reason"),
    deadLetteredAt: body.deadLetteredAt === undefined
      ? new Date().toISOString()
      : dateStringFromRequest(body.deadLetteredAt, "deadLetteredAt"),
    maxBatches: optionalPositiveInteger(
      body.maxBatches,
      DEFAULT_MAX_BATCHES,
      "maxBatches",
    ),
  };
}

function cleanupConnectionsRequestFromBody(
  value: unknown,
  env: Env,
): ParsedCleanupLiveQueryConnectionsRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Live query connection cleanup request body must be an object.");
  }
  const body = value as Record<string, unknown>;
  return {
    deploymentId: nonEmptyStringFromRequest(body.deploymentId, "deploymentId"),
    projectId: projectIdFromRequestOrEnv(body.projectId, env),
    ...(body.expiredAt === undefined
      ? {}
      : { expiredAt: dateStringFromRequest(body.expiredAt, "expiredAt") }),
  };
}

function olderThanFromBody(body: DeadLetterLiveQueryDeliveriesRequest): string {
  if (body.olderThan !== undefined) {
    return dateStringFromRequest(body.olderThan, "olderThan");
  }
  const stuckAfterMs = optionalPositiveInteger(
    body.stuckAfterMs,
    DEFAULT_STUCK_AFTER_MS,
    "stuckAfterMs",
  );
  return new Date(Date.now() - stuckAfterMs).toISOString();
}

function dateStringFromRequest(value: unknown, field: string): string {
  const text = nonEmptyStringFromRequest(value, field);
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  throw new HttpError(400, `${field} must be an ISO date string.`);
}

function nonEmptyStringFromRequest(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HttpError(400, `${field} must be a non-empty string.`);
}

function executorDeadLetterResultFromUnknown(
  value: unknown,
): ExecutorDeadLetterStuckResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Dead-letter response must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.scanned)) {
    throw new HttpError(502, "Dead-letter response.scanned must be an array.");
  }
  if (!Array.isArray(record.deadLettered)) {
    throw new HttpError(502, "Dead-letter response.deadLettered must be an array.");
  }
  if (!Array.isArray(record.reconnectConnectionIds)) {
    throw new HttpError(
      502,
      "Dead-letter response.reconnectConnectionIds must be an array.",
    );
  }
  return {
    scanned: record.scanned,
    deadLettered: record.deadLettered,
    reconnectConnectionIds: record.reconnectConnectionIds.map((connectionId, index) =>
      stringFromUnknown(connectionId, `reconnectConnectionIds[${index}]`),
    ),
    nextCursor: record.nextCursor ?? null,
    hasMore: booleanFromUnknown(record.hasMore, "hasMore"),
  };
}

function forceReconnectResultFromUnknown(value: unknown): { closed: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "ConnectionDO force-reconnect response must be an object.");
  }
  return {
    closed: nonNegativeIntegerFromUnknown(
      (value as Record<string, unknown>).closed,
      "forceReconnect.closed",
    ),
  };
}

function cleanupConnectionsResultFromUnknown(
  value: unknown,
): ExecutorCleanupLiveQueryConnectionsResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(502, "Connection cleanup response must be an object.");
  }
  const record = value as Record<string, unknown>;
  return {
    deleted: nonNegativeIntegerFromUnknown(record.deleted, "cleanup.deleted"),
    deletedConnections: nonNegativeIntegerFromUnknown(
      record.deletedConnections,
      "cleanup.deletedConnections",
    ),
  };
}

function validateConnectionId(connectionId: string): void {
  if (connectionId.startsWith("connection:")) return;
  throw new HttpError(502, `Invalid live query connection id ${connectionId}.`);
}
