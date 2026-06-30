import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  cleanupExpiredLiveQueryConnectionsEffect,
  expiredConnectionDeploymentsEffect,
  pendingDeploymentsEffect,
  schedulerMaintenanceBoundaryErrorToHttpError,
  SchedulerMaintenanceRequestError,
  type SchedulerMaintenanceFetch,
} from "../src/scheduler/MaintenanceBoundary";

describe("scheduler maintenance boundary", () => {
  it("decodes pending deployment, expired deployment, and connection cleanup responses", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const schedulerFetch: SchedulerMaintenanceFetch = async (path, body) => {
      requests.push({ path, body });
      if (path === "/maintenance/live-queries/pending-deployments") {
        return Response.json({
          deployments: [{
            deploymentId: "deployment-pending",
            oldestCreatedAt: "2026-01-01T00:00:00.000Z",
            pending: 2,
          }],
          nextCursor: null,
          hasMore: false,
        });
      }
      if (path === "/maintenance/live-queries/expired-connection-deployments") {
        return Response.json({
          deployments: [{
            deploymentId: "deployment-a",
            projectId: "project-a",
            oldestExpiredAt: "2026-01-01T00:00:00.000Z",
            expiredConnections: 2,
          }],
          nextCursor: null,
          hasMore: false,
        });
      }
      return Response.json({ deleted: 3, deletedConnections: 2 });
    };

    await expect(Effect.runPromise(pendingDeploymentsEffect(schedulerFetch, {
      limit: 5,
    }))).resolves.toEqual({
      deployments: [{
        deploymentId: "deployment-pending",
        oldestCreatedAt: "2026-01-01T00:00:00.000Z",
        pending: 2,
      }],
      nextCursor: null,
      hasMore: false,
    });

    await expect(Effect.runPromise(expiredConnectionDeploymentsEffect(schedulerFetch, {
      expiredAt: "2026-01-01T00:01:00.000Z",
      limit: 5,
    }))).resolves.toEqual({
      deployments: [{
        deploymentId: "deployment-a",
        projectId: "project-a",
        oldestExpiredAt: "2026-01-01T00:00:00.000Z",
        expiredConnections: 2,
      }],
      nextCursor: null,
      hasMore: false,
    });

    await expect(Effect.runPromise(cleanupExpiredLiveQueryConnectionsEffect(schedulerFetch, {
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-01-01T00:01:00.000Z",
    }))).resolves.toEqual({
      deleted: 3,
      deletedConnections: 2,
    });

    expect(requests).toEqual([
      {
        path: "/maintenance/live-queries/pending-deployments",
        body: {
          limit: 5,
        },
      },
      {
        path: "/maintenance/live-queries/expired-connection-deployments",
        body: {
          expiredAt: "2026-01-01T00:01:00.000Z",
          limit: 5,
        },
      },
      {
        path: "/maintenance/live-queries/connections/cleanup",
        body: {
          deploymentId: "deployment-a",
          projectId: "project-a",
          expiredAt: "2026-01-01T00:01:00.000Z",
        },
      },
    ]);
  });

  it("exposes typed maintenance request failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      expiredConnectionDeploymentsEffect(
        async () => {
          throw new Error("executor unavailable");
        },
        {
          expiredAt: "2026-01-01T00:01:00.000Z",
          limit: 5,
        },
      ),
    ));

    expect(failure).toBeInstanceOf(SchedulerMaintenanceRequestError);
    expect(failure).toMatchObject({
      _tag: "SchedulerMaintenanceRequestError",
      operation: "expiredConnectionDeployments",
      status: 500,
      message: "executor unavailable",
    });
    expect(schedulerMaintenanceBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 500,
      message: "executor unavailable",
    });
  });

  it("keeps non-OK cleanup responses typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      cleanupExpiredLiveQueryConnectionsEffect(
        async () => Response.json({ error: "temporarily unavailable" }, { status: 503 }),
        {
          deploymentId: "deployment-a",
          projectId: "project-a",
        },
      ),
    ));

    expect(failure).toMatchObject({
      _tag: "SchedulerResponseError",
      operation: "cleanupConnections",
      status: 503,
      message: "Live query connection cleanup failed with status 503.",
    });
    expect(schedulerMaintenanceBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "Live query connection cleanup failed with status 503.",
    });
  });

  it("keeps malformed scan payloads typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(
      expiredConnectionDeploymentsEffect(
        async () => Response.json({ deployments: "bad", nextCursor: null, hasMore: false }),
        {
          expiredAt: "2026-01-01T00:01:00.000Z",
          limit: 5,
        },
      ),
    ));

    expect(failure).toMatchObject({
      _tag: "SchedulerResponsePayloadError",
      operation: "expiredConnectionDeployments",
      status: 502,
      message: "Expired connection deployments response.deployments must be an array.",
    });
    expect(schedulerMaintenanceBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "Expired connection deployments response.deployments must be an array.",
    });
  });
});
