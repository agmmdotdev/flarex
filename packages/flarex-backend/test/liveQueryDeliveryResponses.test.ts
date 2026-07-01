import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeLiveQueryDeliveryAckPayload,
  decodeLiveQueryDeliveryClaimPayload,
  liveQueryDeliveryResponsePayloadErrorToHttpErrorEffect,
} from "../src/liveQueryDeliveryResponses";

describe("live query delivery response payload boundaries", () => {
  it("exposes typed claim and ack payload successes before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryClaimPayload({
      deliveries: [{
        deploymentId: "deployment1",
        deliveryId: "delivery1",
        connectionId: "connection1",
        queryId: 1,
        payloadJson: { type: "QueryUpdated" },
      }],
      nextCursor: {
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveryId: "delivery1",
      },
      hasMore: true,
    }))).resolves.toEqual({
      deliveries: [{
        deploymentId: "deployment1",
        deliveryId: "delivery1",
        connectionId: "connection1",
        queryId: 1,
        payloadJson: { type: "QueryUpdated" },
      }],
      nextCursor: {
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveryId: "delivery1",
      },
      hasMore: true,
    });

    await expect(Effect.runPromise(decodeLiveQueryDeliveryAckPayload({
      delivered: 2,
    }))).resolves.toEqual({ delivered: 2 });
  });

  it("exposes typed claim payload failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeLiveQueryDeliveryClaimPayload({
      deliveries: [],
      nextCursor: null,
      hasMore: true,
    }))).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryResponsePayloadError",
      operation: "claim",
      status: 502,
      message: "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
    });
  });

  it("maps typed delivery payload failures to the existing 502 adapter shape", async () => {
    await expect(
      Effect.runPromise(
        decodeLiveQueryDeliveryAckPayload({ delivered: -1 }).pipe(
          Effect.catch(liveQueryDeliveryResponsePayloadErrorToHttpErrorEffect),
        ),
      ),
    ).rejects.toMatchObject({
      name: "HttpError",
      status: 502,
      message: "Live query delivery ack response.delivered must be a non-negative integer.",
    });
  });
});
