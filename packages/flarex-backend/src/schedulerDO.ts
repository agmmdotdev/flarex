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

export class SchedulerDO extends DurableObject<Env> {
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
    return json({ service: "flarex-scheduler", status: "ok" });
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
    const rerun = await this.rerunStaleLiveQuerySubscriptions({
      deploymentId: request.deploymentId,
      ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    });

    if (rerun.changed.length === 0) {
      return {
        deploymentId: request.deploymentId,
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
      deploymentId: request.deploymentId,
      limit: request.deliveryLimit ?? request.limit ?? DEFAULT_DELIVERY_LIMIT,
      ...(request.maxBatches === undefined ? {} : { maxBatches: request.maxBatches }),
    });

    return {
      deploymentId: request.deploymentId,
      changed: rerun.changed.length,
      unchanged: rerun.unchanged.length,
      unsupported: rerun.unsupported.length,
      hasMoreStale: rerun.hasMoreStale,
      delivery: wake,
    };
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
