import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodePublicSchedulerCleanupConnectionsRequest,
  decodePublicSchedulerConnectionReconcileRequest,
  decodePublicSchedulerDeadLetterDeliveriesRequest,
  decodePublicSchedulerDeliveryReconcileRequest,
  decodePublicSchedulerRerunSubscriptionsRequest,
  decodePublicSchedulerTriggerSubscriptionsRequest,
  publicSchedulerRouteErrorToHttpError,
  publicSchedulerRouteErrorToHttpErrorEffect,
} from "../src/scheduler/PublicRouteBoundary";
import {
  decodeSchedulerConnectionReconcilePayload,
  SchedulerRoutePayloadError,
} from "../src/scheduler/Requests";
import type { Env } from "../src/types";

describe("public scheduler route boundary", () => {
  it("shares scheduler maintenance payload decoders with internal routes", async () => {
    await expect(Effect.runPromise(decodeSchedulerConnectionReconcilePayload({
      expiredAt: "2026-06-23T00:00:05.000+00:00",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000+00:00",
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

  it("decodes delivery reconcile requests", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000+00:00",
        deploymentId: "deployment-a",
      },
      ignored: true,
    })))).resolves.toEqual({
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("keeps invalid delivery reconcile envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(jsonRequest(null))))
      .rejects.toMatchObject({
        _tag: "SchedulerRoutePayloadError",
        message: "Live query delivery reconcile request body must be an object.",
      });

    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(jsonRequest({
      cursor: {
        oldestCreatedAt: "not a date",
        deploymentId: "deployment-a",
      },
    })))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "cursor.oldestCreatedAt must be an ISO date string.",
    });
  });

  it("keeps malformed delivery reconcile JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(malformedJsonRequest(
      "/scheduler/live-query-deliveries/reconcile",
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes connection reconcile requests", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerConnectionReconcileRequest(jsonRequest(
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
    )))).resolves.toEqual({
      expiredAt: "2026-06-23T00:00:05.000Z",
      limit: 7,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("keeps invalid connection reconcile envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerConnectionReconcileRequest(jsonRequest(
      null,
      "/scheduler/live-query-connections/reconcile",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "Live query connection reconcile request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerConnectionReconcileRequest(jsonRequest(
      {
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment-a",
        },
      },
      "/scheduler/live-query-connections/reconcile",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "cursor.oldestExpiredAt must be an ISO date string.",
    });
  });

  it("keeps malformed connection reconcile JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerConnectionReconcileRequest(malformedJsonRequest(
      "/scheduler/live-query-connections/reconcile",
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes dead-letter delivery requests", async () => {
    const cursor = { deliveryId: "delivery-a" };

    await expect(Effect.runPromise(decodePublicSchedulerDeadLetterDeliveriesRequest(jsonRequest(
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
    )))).resolves.toEqual({
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

  it("keeps invalid dead-letter delivery envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeadLetterDeliveriesRequest(jsonRequest(
      null,
      "/scheduler/live-query-deliveries/dead-letter",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "Dead-letter request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerDeadLetterDeliveriesRequest(jsonRequest(
      { olderThan: "not a date" },
      "/scheduler/live-query-deliveries/dead-letter",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "olderThan must be an ISO date string.",
    });
  });

  it("keeps malformed dead-letter JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeadLetterDeliveriesRequest(malformedJsonRequest(
      "/scheduler/live-query-deliveries/dead-letter",
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes connection cleanup requests", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        expiredAt: "2026-06-23T00:00:10.000+00:00",
        ignored: true,
      },
      "/scheduler/live-query-connections/cleanup",
    ), env))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      expiredAt: "2026-06-23T00:00:10.000Z",
    });
  });

  it("uses configured project id for connection cleanup requests", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      { deploymentId: "deployment-a" },
      "/scheduler/live-query-connections/cleanup",
    ), env))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-default",
    });
  });

  it("keeps invalid connection cleanup envelopes typed before adapter mapping", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      null,
      "/scheduler/live-query-connections/cleanup",
    ), env))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "Live query connection cleanup request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        expiredAt: "not a date",
      },
      "/scheduler/live-query-connections/cleanup",
    ), env))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "expiredAt must be an ISO date string.",
    });
  });

  it("keeps malformed cleanup JSON typed before adapter mapping", async () => {
    const env = { FLAREX_PROJECT_ID: "project-default" } as Env;

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(malformedJsonRequest(
      "/scheduler/live-query-connections/cleanup",
    ), env))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes rerun subscription requests", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerRerunSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 5,
        deliveryLimit: 10,
        maxBatches: 2,
        ignored: true,
      },
      "/scheduler/live-query-subscriptions/rerun",
    )))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
  });

  it("keeps invalid rerun subscription envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerRerunSubscriptionsRequest(jsonRequest(
      null,
      "/scheduler/live-query-subscriptions/rerun",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "Live query rerun request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerRerunSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "",
        limit: 1,
      },
      "/scheduler/live-query-subscriptions/rerun",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "deploymentId must be a non-empty string.",
    });
  });

  it("keeps malformed rerun JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerRerunSubscriptionsRequest(malformedJsonRequest(
      "/scheduler/live-query-subscriptions/rerun",
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("decodes trigger subscription requests", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerTriggerSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        projectId: "project-a",
        limit: 5,
        deliveryLimit: 10,
        maxBatches: 2,
        ignored: true,
      },
      "/scheduler/live-query-subscriptions/trigger",
    )))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
    });
  });

  it("keeps invalid trigger subscription envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerTriggerSubscriptionsRequest(jsonRequest(
      null,
      "/scheduler/live-query-subscriptions/trigger",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "Live query rerun request body must be an object.",
    });

    await expect(Effect.runPromise(decodePublicSchedulerTriggerSubscriptionsRequest(jsonRequest(
      {
        deploymentId: "deployment-a",
        deliveryLimit: 0,
      },
      "/scheduler/live-query-subscriptions/trigger",
    )))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "deliveryLimit must be a positive integer.",
    });
  });

  it("keeps malformed trigger JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerTriggerSubscriptionsRequest(malformedJsonRequest(
      "/scheduler/live-query-subscriptions/trigger",
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("exposes typed public scheduler decoder failures", async () => {
    await expect(Effect.runPromise(decodePublicSchedulerDeliveryReconcileRequest(jsonRequest({
      limit: 5,
    })))).resolves.toEqual({ limit: 5 });

    await expect(Effect.runPromise(decodePublicSchedulerCleanupConnectionsRequest(jsonRequest(
      { deploymentId: "deployment-a" },
      "/scheduler/live-query-connections/cleanup",
    ), { FLAREX_PROJECT_ID: "" } as Env))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
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

    const validationError = new SchedulerRoutePayloadError({
      message: "deploymentId must be a non-empty string.",
    });
    expect(publicSchedulerRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "deploymentId must be a non-empty string.",
    });
  });

  it("maps typed public scheduler route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    const mappedJson = await Effect.runPromise(Effect.flip(
      publicSchedulerRouteErrorToHttpErrorEffect(jsonError),
    ));
    expect(mappedJson).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new SchedulerRoutePayloadError({
      message: "deploymentId must be a non-empty string.",
    });
    const mappedValidation = await Effect.runPromise(Effect.flip(
      publicSchedulerRouteErrorToHttpErrorEffect(validationError),
    ));
    expect(mappedValidation).toMatchObject({
      status: 400,
      message: "deploymentId must be a non-empty string.",
    });
  });

  it("exposes shared typed public scheduler payload failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodeSchedulerConnectionReconcilePayload({
      cursor: {
        oldestExpiredAt: "not a date",
        deploymentId: "deployment-a",
      },
    })));

    expect(failure).toBeInstanceOf(SchedulerRoutePayloadError);
    expect(failure).toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "cursor.oldestExpiredAt must be an ISO date string.",
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

function malformedJsonRequest(path: string): Request {
  return new Request(`https://flarex.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
}
