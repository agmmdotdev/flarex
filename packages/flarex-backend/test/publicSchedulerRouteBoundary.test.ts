import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePublicSchedulerConnectionReconcileRequest,
  parsePublicSchedulerDeliveryReconcileRequest,
  readPublicSchedulerConnectionReconcileRequest,
  readPublicSchedulerDeliveryReconcileRequest,
} from "../src/scheduler/PublicRouteBoundary";

describe("public scheduler route boundary", () => {
  it("decodes delivery reconcile requests", async () => {
    await expect(readPublicSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000+00:00",
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

  it("maps invalid delivery reconcile envelopes to 400", () => {
    expect(() => parsePublicSchedulerDeliveryReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerDeliveryReconcileRequest({
        cursor: {
          oldestCreatedAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parsePublicSchedulerDeliveryReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestCreatedAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicSchedulerDeliveryReconcileRequest(new Request(
      "https://flarex.test/scheduler/live-query-deliveries/reconcile",
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

  it("decodes connection reconcile requests", async () => {
    await expect(readPublicSchedulerConnectionReconcileRequest(jsonRequest(
      {
        expiredAt: "2026-06-23T00:00:05.000+00:00",
        limit: 7,
        cursor: {
          oldestExpiredAt: "2026-06-23T00:00:10.000+00:00",
          deploymentId: "deployment-a",
        },
        ignored: true,
      },
      "/scheduler/live-query-connections/reconcile",
    ))).resolves.toEqual({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("maps invalid connection reconcile envelopes to 400", () => {
    expect(() => parsePublicSchedulerConnectionReconcileRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerConnectionReconcileRequest({
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment-a",
        },
      });
      throw new Error("Expected parsePublicSchedulerConnectionReconcileRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "cursor.oldestExpiredAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed connection reconcile JSON as the shared JSON body error", async () => {
    await expect(readPublicSchedulerConnectionReconcileRequest(new Request(
      "https://flarex.test/scheduler/live-query-connections/reconcile",
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

function jsonRequest(
  body: unknown,
  path = "/scheduler/live-query-deliveries/reconcile",
): Request {
  return new Request(`https://flarex.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
