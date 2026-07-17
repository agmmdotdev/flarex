import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeSchedulerCleanupConnectionsRouteBodyEffect,
  decodeSchedulerConnectionReconcilePayloadEffect,
  decodeSchedulerDeadLetterDeliveriesPayloadEffect,
  decodeSchedulerDeliveryReconcilePayloadEffect,
  decodeSchedulerRerunSubscriptionsPayloadEffect,
  SchedulerCleanupConnectionsRouteBodySchema,
  SchedulerConnectionReconcileRequestSchema,
  SchedulerDeadLetterDeliveriesRequestSchema,
  SchedulerDeliveryReconcileRequestSchema,
  SchedulerRoutePayloadError,
} from "../src/scheduler";

const decodeSchedulerDeliveryReconcileRequest = Schema.decodeUnknownSync(
  SchedulerDeliveryReconcileRequestSchema,
);
const decodeSchedulerConnectionReconcileRequest = Schema.decodeUnknownSync(
  SchedulerConnectionReconcileRequestSchema,
);
const decodeSchedulerDeadLetterDeliveriesRequest = Schema.decodeUnknownSync(
  SchedulerDeadLetterDeliveriesRequestSchema,
);
const decodeSchedulerCleanupConnectionsRouteBody = Schema.decodeUnknownSync(
  SchedulerCleanupConnectionsRouteBodySchema,
);

describe("scheduler protocol schemas", () => {
  it("decodes delivery reconcile route bodies", async () => {
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcilePayloadEffect({
      limit: 10,
      deliveryLimit: 5,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-01-01T00:00:00.000Z",
        deploymentId: "deployment-a",
      },
      ignored: true,
    }))).resolves.toEqual({
      limit: 10,
      deliveryLimit: 5,
      maxBatches: 2,
      cursor: {
        oldestCreatedAt: "2026-01-01T00:00:00.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("decodes connection reconcile route bodies", async () => {
    await expect(Effect.runPromise(decodeSchedulerConnectionReconcilePayloadEffect({
      expiredAt: "2026-01-01T00:00:00Z",
      limit: 25,
      cursor: {
        oldestExpiredAt: "2026-01-01T00:00:00Z",
        deploymentId: "deployment-a",
      },
    }))).resolves.toEqual({
      expiredAt: "2026-01-01T00:00:00.000Z",
      limit: 25,
      cursor: {
        oldestExpiredAt: "2026-01-01T00:00:00.000Z",
        deploymentId: "deployment-a",
      },
    });
  });

  it("decodes rerun subscription route bodies", async () => {
    await expect(Effect.runPromise(decodeSchedulerRerunSubscriptionsPayloadEffect({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 10,
      deliveryLimit: 5,
      maxBatches: 2,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: "project-a",
      limit: 10,
      deliveryLimit: 5,
      maxBatches: 2,
    });
  });

  it("decodes dead-letter route bodies with scheduler defaults", async () => {
    const request = await Effect.runPromise(decodeSchedulerDeadLetterDeliveriesPayloadEffect({}));

    expect(request).toMatchObject({
      stuckAfterMs: 300_000,
      minAttempts: 3,
      limit: 100,
      reason: "live query delivery stuck",
      maxBatches: 3,
    });
    expect(new Date(request.olderThan).getTime()).not.toBeNaN();
    expect(new Date(request.deadLetteredAt).getTime()).not.toBeNaN();
  });

  it("decodes cleanup route bodies before backend env fallback", async () => {
    await expect(Effect.runPromise(decodeSchedulerCleanupConnectionsRouteBodyEffect({
      deploymentId: "deployment-a",
      expiredAt: "2026-01-01T00:00:00Z",
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      projectId: undefined,
      expiredAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("keeps scheduler decode failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcilePayloadEffect(null)))
      .rejects.toMatchObject({
        _tag: "SchedulerRoutePayloadError",
        message: "Live query delivery reconcile request body must be an object.",
      });

    await expect(Effect.runPromise(decodeSchedulerConnectionReconcilePayloadEffect({
      cursor: { oldestExpiredAt: "bad", deploymentId: "deployment-a" },
    }))).rejects.toBeInstanceOf(SchedulerRoutePayloadError);

    await expect(Effect.runPromise(decodeSchedulerRerunSubscriptionsPayloadEffect({
      deploymentId: "",
    }))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "deploymentId must be a non-empty string.",
    });
  });

  it("preserves the first scheduler field failure", async () => {
    await expect(Effect.runPromise(decodeSchedulerDeliveryReconcilePayloadEffect({
      limit: 0,
      deliveryLimit: 0,
      maxBatches: 0,
    }))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "limit must be a positive integer.",
    });

    await expect(Effect.runPromise(decodeSchedulerRerunSubscriptionsPayloadEffect({
      deploymentId: "",
      projectId: "",
      limit: 0,
    }))).rejects.toMatchObject({
      _tag: "SchedulerRoutePayloadError",
      message: "deploymentId must be a non-empty string.",
    });
  });

  it("exposes scheduler schemas for normalized payloads", () => {
    expect(decodeSchedulerDeliveryReconcileRequest({ limit: 1 })).toEqual({ limit: 1 });
    expect(decodeSchedulerConnectionReconcileRequest({ expiredAt: "2026-01-01T00:00:00.000Z" }))
      .toEqual({ expiredAt: "2026-01-01T00:00:00.000Z" });
    expect(decodeSchedulerDeadLetterDeliveriesRequest({
      olderThan: "2026-01-01T00:00:00.000Z",
      stuckAfterMs: 1,
      minAttempts: 1,
      limit: 1,
      reason: "manual",
      deadLetteredAt: "2026-01-01T00:00:01.000Z",
      maxBatches: 1,
    })).toEqual({
      olderThan: "2026-01-01T00:00:00.000Z",
      stuckAfterMs: 1,
      minAttempts: 1,
      limit: 1,
      reason: "manual",
      deadLetteredAt: "2026-01-01T00:00:01.000Z",
      maxBatches: 1,
    });
    expect(decodeSchedulerCleanupConnectionsRouteBody({ deploymentId: "deployment-a" }))
      .toEqual({ deploymentId: "deployment-a" });
  });
});
