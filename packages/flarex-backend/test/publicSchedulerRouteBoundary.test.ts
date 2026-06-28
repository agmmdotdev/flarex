import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePublicSchedulerDeliveryReconcileRequest,
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
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/scheduler/live-query-deliveries/reconcile", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
