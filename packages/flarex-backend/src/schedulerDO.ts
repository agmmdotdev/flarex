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

const DEFAULT_PENDING_DEPLOYMENT_LIMIT = 25;
const DEFAULT_DELIVERY_LIMIT = 100;
const DEFAULT_MAX_BATCHES = 3;

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
