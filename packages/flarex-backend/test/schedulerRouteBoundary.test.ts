import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseSchedulerCleanupConnectionsRequest,
  parseSchedulerDeadLetterDeliveriesRequest,
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeliveryReconcileRequest,
  parseSchedulerRerunSubscriptionsRequest,
  readSchedulerCleanupConnectionsRequest,
  readSchedulerDeadLetterDeliveriesRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeliveryReconcileRequest,
  readSchedulerRerunSubscriptionsRequest,
} from "../src/scheduler/RouteBoundary";
import type { Env } from "../src/types";

describe("scheduler route boundary", () => {
  it("decodes delivery reconcile requests", async () => {
    await expect(readSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("maps invalid delivery reconcile bodies to 400", () => {
    expect(() => parseSchedulerDeliveryReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerDeliveryReconcileRequest({
        cursor: {
          oldestCreatedAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parseSchedulerDeliveryReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestCreatedAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readSchedulerDeliveryReconcileRequest(new Request(
      "https://flarex.test/reconcile/live-query-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes connection cleanup reconcile requests", async () => {
    await expect(readSchedulerConnectionReconcileRequest(jsonRequest({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("maps invalid connection cleanup reconcile bodies to 400", () => {
    expect(() => parseSchedulerConnectionReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerConnectionReconcileRequest({
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parseSchedulerConnectionReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestExpiredAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed connection cleanup reconcile JSON as the shared JSON body error", async () => {
    await expect(readSchedulerConnectionReconcileRequest(new Request(
      "https://flarex.test/reconcile/live-query-connections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes live query subscription rerun requests", async () => {
    await expect(readSchedulerRerunSubscriptionsRequest(jsonRequest({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
  });

  it("maps invalid live query subscription rerun bodies to 400", () => {
    expect(() => parseSchedulerRerunSubscriptionsRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerRerunSubscriptionsRequest({
        deploymentId: "",
        limit: 1,
      });
      throw new Error("Expected parseSchedulerRerunSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deploymentId must be a non-empty string.",
      });
    }
  });

  it("maps invalid live query subscription rerun limits to 400", () => {
    try {
      parseSchedulerRerunSubscriptionsRequest({
        deploymentId: "deployment-a",
        maxBatches: 0,
      });
      throw new Error("Expected parseSchedulerRerunSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "maxBatches must be a positive integer.",
      });
    }
  });

  it("preserves malformed live query subscription rerun JSON as the shared JSON body error", async () => {
    await expect(readSchedulerRerunSubscriptionsRequest(new Request(
      "https://flarex.test/rerun/live-query-subscriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes dead-letter delivery requests", async () => {
    const cursor = { deliveryId: "delivery-a" };
    await expect(readSchedulerDeadLetterDeliveriesRequest(jsonRequest({
      deploymentId: "deployment-a",
      olderThan: "2026-06-23T00:00:05.000Z",
      minAttempts: 4,
      cursor,
      limit: 7,
      reason: "stuck test delivery",
      deadLetteredAt: "2026-06-23T00:00:10.000Z",
      maxBatches: 2,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 5 * 60 * 1000,
      minAttempts: 4,
      cursor,
      limit: 7,
      reason: "stuck test delivery",
      deadLetteredAt: "2026-06-23T00:00:10.000Z",
      maxBatches: 2,
    });
  });

  it("preserves dead-letter request defaults", () => {
    const before = Date.now();
    const request = parseSchedulerDeadLetterDeliveriesRequest({});
    const after = Date.now();

    expect(request.stuckAfterMs).toBe(5 * 60 * 1000);
    expect(request.minAttempts).toBe(3);
    expect(request.limit).toBe(100);
    expect(request.reason).toBe("live query delivery stuck");
    expect(request.maxBatches).toBe(3);
    expect(new Date(request.olderThan).getTime()).toBeGreaterThanOrEqual(
      before - request.stuckAfterMs,
    );
    expect(new Date(request.olderThan).getTime()).toBeLessThanOrEqual(
      after - request.stuckAfterMs,
    );
    expect(new Date(request.deadLetteredAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(request.deadLetteredAt).getTime()).toBeLessThanOrEqual(after);
  });

  it("preserves explicit dead-letter olderThan precedence over stuckAfterMs", () => {
    expect(parseSchedulerDeadLetterDeliveriesRequest({
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 0,
    })).toMatchObject({
      olderThan: "2026-06-23T00:00:05.000Z",
      stuckAfterMs: 5 * 60 * 1000,
    });
  });

  it("maps invalid dead-letter delivery bodies to 400", () => {
    expect(() => parseSchedulerDeadLetterDeliveriesRequest(null))
      .toThrow(HttpError);
    try {
      parseSchedulerDeadLetterDeliveriesRequest({
        olderThan: "not a date",
      });
      throw new Error("Expected parseSchedulerDeadLetterDeliveriesRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "olderThan must be an ISO date string.",
      });
    }
  });

  it("maps invalid dead-letter delivery limits to 400", () => {
    try {
      parseSchedulerDeadLetterDeliveriesRequest({
        stuckAfterMs: 0,
      });
      throw new Error("Expected parseSchedulerDeadLetterDeliveriesRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "stuckAfterMs must be a positive integer.",
      });
    }
  });

  it("preserves malformed dead-letter delivery JSON as the shared JSON body error", async () => {
    await expect(readSchedulerDeadLetterDeliveriesRequest(new Request(
      "https://flarex.test/dead-letter/live-query-deliveries",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes live query connection cleanup requests", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    await expect(readSchedulerCleanupConnectionsRequest(jsonRequest({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000+00:00",
      ignored: true,
    }), env)).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000Z",
    });
  });

  it("uses the configured project id for cleanup requests without projectId", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    expect(parseSchedulerCleanupConnectionsRequest({
      deploymentId: "deployment-a",
    }, env)).toEqual({
      deploymentId: "deployment-a",
      projectId: "project-default",
    });
  });

  it("maps invalid live query connection cleanup bodies to 400", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    expect(() => parseSchedulerCleanupConnectionsRequest(null, env))
      .toThrow(HttpError);
    try {
      parseSchedulerCleanupConnectionsRequest({
        deploymentId: "deployment-a",
        expiredAt: "not a date",
      }, env);
      throw new Error("Expected parseSchedulerCleanupConnectionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "expiredAt must be an ISO date string.",
      });
    }
  });

  it("requires projectId when cleanup request env has no project id", () => {
    const env = {} as Env;

    expect(() => parseSchedulerCleanupConnectionsRequest({
      deploymentId: "deployment-a",
    }, env)).toThrowError(
      "projectId is required when FLAREX_PROJECT_ID is not configured.",
    );
  });

  it("preserves malformed live query connection cleanup JSON as the shared JSON body error", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(readSchedulerCleanupConnectionsRequest(new Request(
      "https://flarex.test/cleanup/live-query-connections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), env)).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/reconcile/live-query-deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
