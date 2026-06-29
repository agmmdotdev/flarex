import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicSchedulerCleanupConnectionsRequest,
  decodePublicSchedulerConnectionReconcileRequest,
  decodePublicSchedulerDeadLetterDeliveriesRequest,
  decodePublicSchedulerDeliveryReconcileRequest,
  decodePublicSchedulerRerunSubscriptionsRequest,
  decodePublicSchedulerTriggerSubscriptionsRequest,
  parsePublicSchedulerCleanupConnectionsRequest,
  parsePublicSchedulerConnectionReconcileRequest,
  parsePublicSchedulerDeadLetterDeliveriesRequest,
  parsePublicSchedulerDeliveryReconcileRequest,
  parsePublicSchedulerRerunSubscriptionsRequest,
  parsePublicSchedulerTriggerSubscriptionsRequest,
  readPublicSchedulerCleanupConnectionsRequest,
  readPublicSchedulerDeadLetterDeliveriesRequest,
  readPublicSchedulerConnectionReconcileRequest,
  readPublicSchedulerDeliveryReconcileRequest,
  readPublicSchedulerRerunSubscriptionsRequest,
  readPublicSchedulerTriggerSubscriptionsRequest,
  publicSchedulerRouteErrorToHttpError,
} from "../src/scheduler/PublicRouteBoundary";
import { SchedulerRouteValidationError } from "../src/scheduler/RouteBoundary";
import type { Env } from "../src/types";

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

  it("decodes dead-letter delivery requests", async () => {
    const cursor = { deliveryId: "delivery-a" };
    await expect(readPublicSchedulerDeadLetterDeliveriesRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        olderThan: "2026-06-23T00:00:05.000+00:00",
        minAttempts: 4,
        cursor,
        limit: 7,
        reason: "stuck test delivery",
        deadLetteredAt: "2026-06-23T00:00:10.000+00:00",
        maxBatches: 2,
        ignored: true,
      },
      "/scheduler/live-query-deliveries/dead-letter",
    ))).resolves.toEqual({
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

  it("maps invalid dead-letter delivery envelopes to 400", () => {
    expect(() => parsePublicSchedulerDeadLetterDeliveriesRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerDeadLetterDeliveriesRequest({
        olderThan: "not a date",
      });
      throw new Error("Expected parsePublicSchedulerDeadLetterDeliveriesRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "olderThan must be an ISO date string.",
      });
    }
  });

  it("preserves malformed dead-letter JSON as the shared JSON body error", async () => {
    await expect(readPublicSchedulerDeadLetterDeliveriesRequest(new Request(
      "https://flarex.test/scheduler/live-query-deliveries/dead-letter",
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

  it("decodes connection cleanup requests", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    await expect(readPublicSchedulerCleanupConnectionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        expiredAt: "2026-06-23T00:00:10.000+00:00",
        ignored: true,
      },
      "/scheduler/live-query-connections/cleanup",
    ), env)).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000Z",
    });
  });

  it("uses configured project id for connection cleanup requests", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    expect(parsePublicSchedulerCleanupConnectionsRequest({
      deploymentId: "deployment-a",
    }, env)).toEqual({
      deploymentId: "deployment-a",
      projectId: "project-default",
    });
  });

  it("maps invalid connection cleanup envelopes to 400", () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    expect(() => parsePublicSchedulerCleanupConnectionsRequest(null, env))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerCleanupConnectionsRequest({
        deploymentId: "deployment-a",
        expiredAt: "not a date",
      }, env);
      throw new Error("Expected parsePublicSchedulerCleanupConnectionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "expiredAt must be an ISO date string.",
      });
    }
  });

  it("preserves malformed cleanup JSON as the shared JSON body error", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;
    await expect(readPublicSchedulerCleanupConnectionsRequest(new Request(
      "https://flarex.test/scheduler/live-query-connections/cleanup",
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

  it("decodes rerun subscription requests", async () => {
    await expect(readPublicSchedulerRerunSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 5,
        deliveryLimit: 10,
        maxBatches: 2,
        ignored: true,
      },
      "/scheduler/live-query-subscriptions/rerun",
    ))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
  });

  it("maps invalid rerun subscription envelopes to 400", () => {
    expect(() => parsePublicSchedulerRerunSubscriptionsRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerRerunSubscriptionsRequest({
        deploymentId: "",
        limit: 1,
      });
      throw new Error("Expected parsePublicSchedulerRerunSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deploymentId must be a non-empty string.",
      });
    }
  });

  it("preserves malformed rerun JSON as the shared JSON body error", async () => {
    await expect(readPublicSchedulerRerunSubscriptionsRequest(new Request(
      "https://flarex.test/scheduler/live-query-subscriptions/rerun",
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

  it("decodes trigger subscription requests", async () => {
    await expect(readPublicSchedulerTriggerSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 5,
        deliveryLimit: 10,
        maxBatches: 2,
        ignored: true,
      },
      "/scheduler/live-query-subscriptions/trigger",
    ))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
  });

  it("maps invalid trigger subscription envelopes to 400", () => {
    expect(() => parsePublicSchedulerTriggerSubscriptionsRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicSchedulerTriggerSubscriptionsRequest({
        deploymentId: "deployment-a",
        deliveryLimit: 0,
      });
      throw new Error("Expected parsePublicSchedulerTriggerSubscriptionsRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deliveryLimit must be a positive integer.",
      });
    }
  });

  it("preserves malformed trigger JSON as the shared JSON body error", async () => {
    await expect(readPublicSchedulerTriggerSubscriptionsRequest(new Request(
      "https://flarex.test/scheduler/live-query-subscriptions/trigger",
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

  it("exposes typed public scheduler decoder failures", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
    })))).resolves.toEqual({ limit: 5 });

    await expect(Effect.runPromise(decodePublicSchedulerConnectionReconcileRequest(jsonRequest(
      {
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment-a",
        },
      },
      "/scheduler/live-query-connections/reconcile",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRouteValidationError",
      message: "cursor.oldestExpiredAt must be an ISO date string.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerDeadLetterDeliveriesRequest(jsonRequest(
      null,
      "/scheduler/live-query-deliveries/dead-letter",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRouteValidationError",
      message: "Dead-letter request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      { deploymentId: "deployment-a" },
      "/scheduler/live-query-connections/cleanup",
    ), { FLAREX_PROJECT_ID: "" } as Env))).rejects.toMatchObject({
      _tag: "SchedulerRouteValidationError",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerRerunSubscriptionsRequest(jsonRequest(
      { deploymentId: "", limit: 1 },
      "/scheduler/live-query-subscriptions/rerun",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRouteValidationError",
      message: "deploymentId must be a non-empty string.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerTriggerSubscriptionsRequest(jsonRequest(
      { deploymentId: "deployment-a", deliveryLimit: 0 },
      "/scheduler/live-query-subscriptions/trigger",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRouteValidationError",
      message: "deliveryLimit must be a positive integer.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(new Request(
      "https://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed public scheduler route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicSchedulerRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new SchedulerRouteValidationError({
      message: "deploymentId must be a non-empty string.",
    });
    expect(publicSchedulerRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "deploymentId must be a non-empty string.",
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
