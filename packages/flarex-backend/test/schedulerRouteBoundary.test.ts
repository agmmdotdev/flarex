import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseSchedulerConnectionReconcileRequest,
  parseSchedulerDeliveryReconcileRequest,
  readSchedulerConnectionReconcileRequest,
  readSchedulerDeliveryReconcileRequest,
} from "../src/scheduler/RouteBoundary";

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
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/reconcile/live-query-deliveries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
