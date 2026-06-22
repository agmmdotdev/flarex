import { DurableObject } from "cloudflare:workers";
import { HttpError, json, readJson } from "./http";
import { deliveryObjectName } from "./routing";
import type { Env } from "./types";

type ReconcileLiveQueryDeliveriesRequest = {
  limit?: number;
  deliveryLimit?: number;
  maxBatches?: number;
};

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
  hasMore: boolean;
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

const DEFAULT_PENDING_DEPLOYMENT_LIMIT = 25;
const DEFAULT_DELIVERY_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 3;
const DEFAULT_STUCK_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_MIN_ATTEMPTS = 3;
const DEFAULT_DEAD_LETTER_REASON = "live query delivery stuck";
const PENDING_RERUN_KEY = "pendingLiveQueryRerun";
const CONTINUE_RERUN_ALARM_DELAY_MS = 100;
const RERUN_RETRY_ALARM_BASE_DELAY_MS = 250;
const RERUN_RETRY_ALARM_MAX_DELAY_MS = 30_000;

export class SchedulerDO extends DurableObject<Env> {
  private rerunInFlight: Promise<RerunResult> | undefined;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === "/reconcile/live-query-deliveries" &&
      request.method === "POST"
    ) {
      return json(
        await this.reconcileLiveQueryDeliveries(
          await readJson<ReconcileLiveQueryDeliveriesRequest>(request),
        ),
      );
    }
    if (
      url.pathname === "/dead-letter/live-query-deliveries" &&
      request.method === "POST"
    ) {
      return json(
        await this.deadLetterLiveQueryDeliveries(
          await readJson<unknown>(request),
        ),
      );
    }
    if (
      url.pathname === "/rerun/live-query-subscriptions" &&
      request.method === "POST"
    ) {
      return json(
        await this.rerunLiveQuerySubscriptions(
          await readJson<unknown>(request),
        ),
      );
    }
    if (
      url.pathname === "/continue-live-query-reruns" &&
      request.method === "POST"
    ) {
      return json(await this.continuePendingLiveQueryRerun());
    }
    return json({ service: "flarex-scheduler", status: "ok" });
  }

  async alarm(): Promise<void> {
    try {
      await this.continuePendingLiveQueryRerun();
    } catch {
      // Retry state is persisted by continuePendingLiveQueryRerun().
    }
  }

  private async reconcileLiveQueryDeliveries(
    body: ReconcileLiveQueryDeliveriesRequest,
  ): Promise<ReconcileResult> {
    const limit = optionalPositiveInteger(
      body.limit,
      DEFAULT_PENDING_DEPLOYMENT_LIMIT,
      "limit",
    );
    const deliveryLimit = optionalPositiveInteger(
      body.deliveryLimit,
      DEFAULT_DELIVERY_LIMIT,
      "deliveryLimit",
    );
    const maxBatches = optionalPositiveInteger(
      body.maxBatches,
      DEFAULT_MAX_BATCHES,
      "maxBatches",
    );
    const pending = await this.pendingDeployments(limit);
    const failed: ReconcileResult["failed"] = [];
    let woken = 0;

    for (const deployment of pending.deployments) {
      const response = await this.env.DELIVERIES
        .getByName(deliveryObjectName(deployment.deploymentId))
        .fetch("https://flarex.internal/wake", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            deploymentId: deployment.deploymentId,
            limit: deliveryLimit,
            maxBatches,
          }),
        });
      if (response.ok) {
        woken += 1;
      } else {
        failed.push({
          deploymentId: deployment.deploymentId,
          status: response.status,
          error: await response.text(),
        });
      }
    }

    return {
      deployments: pending.deployments.length,
      woken,
      failed,
      hasMore: pending.hasMore,
    };
  }

  private async rerunLiveQuerySubscriptions(body: unknown): Promise<RerunResult> {
    const request = rerunRequestFromBody(body);
    return this.runAndPersistLiveQueryRerun(pendingRerunFromRequest(request));
  }

  private async continuePendingLiveQueryRerun(): Promise<RerunResult | { skipped: true }> {
    const pending = await this.ctx.storage.get<PendingLiveQueryRerun>(
      PENDING_RERUN_KEY,
    );
    if (pending === undefined) return { skipped: true };
    return this.runAndPersistLiveQueryRerun(pending);
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
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.put(PENDING_RERUN_KEY, {
      ...pending,
      retryAttempt: 0,
    });
    await this.ctx.storage.setAlarm(Date.now() + CONTINUE_RERUN_ALARM_DELAY_MS);
  }

  private async scheduleRerunRetry(pending: PendingLiveQueryRerun): Promise<void> {
    const retryAttempt = pending.retryAttempt + 1;
    await this.ctx.storage.put(PENDING_RERUN_KEY, {
      ...pending,
      retryAttempt,
    });
    await this.ctx.storage.setAlarm(
      Date.now() + rerunRetryDelayMs(retryAttempt),
    );
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

  private async pendingDeployments(limit: number): Promise<PendingDeploymentsResult> {
    const response = await this.executorFetch(
      "/maintenance/live-queries/pending-deployments",
      { limit },
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
    oldestCreatedAt: stringFromUnknown(record.oldestCreatedAt, `${path}.oldestCreatedAt`),
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
    oldestCreatedAt: stringFromUnknown(record.oldestCreatedAt, "nextCursor.oldestCreatedAt"),
    deploymentId: stringFromUnknown(record.deploymentId, "nextCursor.deploymentId"),
  };
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

function validateConnectionId(connectionId: string): void {
  if (connectionId.startsWith("connection:")) return;
  throw new HttpError(502, `Invalid live query connection id ${connectionId}.`);
}
