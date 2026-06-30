import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  ackLiveQueryDeliveryBatchEffect,
  claimLiveQueryDeliveryBatchEffect,
  deliveryExecutorBoundaryErrorToHttpError,
  DeliveryExecutorRequestError,
  type DeliveryExecutorFetch,
} from "../src/delivery/ExecutorBoundary";

describe("delivery executor boundary", () => {
  it("claims and acks delivery batches through typed Effect helpers", async () => {
    const requests: Array<{ path: string; body: unknown }> = [];
    const executorFetch: DeliveryExecutorFetch = async (path, body) => {
      requests.push({ path, body });
      if (path === "/maintenance/live-queries/claim") {
        return Response.json({
          deliveries: [{
            deploymentId: "deployment-a",
            deliveryId: "delivery-1",
            connectionId: "connection:deployment-a:session-a",
            queryId: 1,
            payloadJson: { ok: true },
          }],
          hasMore: true,
          nextCursor: {
            createdAt: "2026-01-01T00:00:00.000Z",
            deliveryId: "delivery-1",
          },
        });
      }
      return Response.json({ delivered: 1 });
    };

    await expect(Effect.runPromise(claimLiveQueryDeliveryBatchEffect(executorFetch, {
      deploymentId: "deployment-a",
      limit: 10,
      leaseDurationMs: 30_000,
      claimOwner: "delivery:deployment-a:owner",
      cursor: undefined,
    }))).resolves.toMatchObject({
      deliveries: [{
        deploymentId: "deployment-a",
        deliveryId: "delivery-1",
      }],
      hasMore: true,
    });

    await expect(Effect.runPromise(ackLiveQueryDeliveryBatchEffect(executorFetch, {
      deploymentId: "deployment-a",
      deliveryIds: ["delivery-1"],
      claimOwner: "delivery:deployment-a:owner",
    }))).resolves.toEqual({ delivered: 1 });

    expect(requests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment-a",
          limit: 10,
          leaseDurationMs: 30_000,
          claimOwner: "delivery:deployment-a:owner",
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        body: {
          deploymentId: "deployment-a",
          deliveryIds: ["delivery-1"],
          claimOwner: "delivery:deployment-a:owner",
        },
      },
    ]);
  });

  it("exposes typed executor request failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(claimLiveQueryDeliveryBatchEffect(
      async () => {
        throw new Error("executor unavailable");
      },
      {
        deploymentId: "deployment-a",
        limit: 10,
        leaseDurationMs: 30_000,
        claimOwner: "delivery:deployment-a:owner",
        cursor: undefined,
      },
    )));

    expect(failure).toBeInstanceOf(DeliveryExecutorRequestError);
    expect(failure).toMatchObject({
      _tag: "DeliveryExecutorRequestError",
      operation: "claim",
      status: 500,
      message: "executor unavailable",
    });
    expect(deliveryExecutorBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 500,
      message: "executor unavailable",
    });
  });

  it("keeps non-OK claim responses typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(claimLiveQueryDeliveryBatchEffect(
      async () => Response.json({ error: "temporary delivery failure" }, { status: 503 }),
      {
        deploymentId: "deployment-a",
        limit: 10,
        leaseDurationMs: 30_000,
        claimOwner: "delivery:deployment-a:owner",
        cursor: undefined,
      },
    )));

    expect(failure).toMatchObject({
      _tag: "LiveQueryDeliveryResponseError",
      operation: "claim",
      status: 503,
      message: "Live query delivery claim failed with status 503.",
    });
    expect(deliveryExecutorBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "Live query delivery claim failed with status 503.",
    });
  });

  it("keeps invalid ack payloads typed until adapter mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(ackLiveQueryDeliveryBatchEffect(
      async () => Response.json({ delivered: -1 }),
      {
        deploymentId: "deployment-a",
        deliveryIds: ["delivery-1"],
        claimOwner: "delivery:deployment-a:owner",
      },
    )));

    expect(failure).toMatchObject({
      _tag: "LiveQueryDeliveryResponsePayloadError",
      operation: "ack",
      status: 502,
      message: "Live query delivery ack response.delivered must be a non-negative integer.",
    });
    expect(deliveryExecutorBoundaryErrorToHttpError(failure)).toMatchObject({
      status: 502,
      message: "Live query delivery ack response.delivered must be a non-negative integer.",
    });
  });
});
