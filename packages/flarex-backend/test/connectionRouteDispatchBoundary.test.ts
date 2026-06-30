import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  dispatchConnectionInvalidationEffect,
  dispatchConnectionLiveQueryDeliveryEffect,
} from "../src/connection/RouteDispatchBoundary";
import { HttpError } from "../src/http";
import type { LiveQueryDeliveryChange } from "../src/liveQueryDelivery";

describe("connection route dispatch boundary", () => {
  it("dispatches decoded connection route operations", async () => {
    const invalidated: number[] = [];
    const delivered: LiveQueryDeliveryChange[][] = [];
    const invalidationResponse = Response.json({ ok: true, operation: "invalidate" });
    const deliveryResponse = Response.json({ ok: true, operation: "deliver-live-query" });
    const deliveries = [liveQueryDeliveryChange()];

    await expect(Effect.runPromise(dispatchConnectionInvalidationEffect(
      async queryId => {
        invalidated.push(queryId);
        return invalidationResponse;
      },
      42,
    ))).resolves.toBe(invalidationResponse);

    await expect(Effect.runPromise(dispatchConnectionLiveQueryDeliveryEffect(
      async changes => {
        delivered.push(changes);
        return deliveryResponse;
      },
      deliveries,
    ))).resolves.toBe(deliveryResponse);

    expect(invalidated).toEqual([42]);
    expect(delivered).toEqual([deliveries]);
  });

  it("maps connection route operation failures at the dispatch source", async () => {
    const invalidationFailure = await Effect.runPromise(Effect.flip(
      dispatchConnectionInvalidationEffect(
        async () => {
          throw new HttpError(409, "Invalidation already in flight.");
        },
        1,
      ),
    ));
    expect(invalidationFailure).toMatchObject({
      _tag: "ConnectionRouteOperationError",
      operation: "invalidate",
      status: 409,
      message: "Invalidation already in flight.",
    });

    const deliveryFailure = await Effect.runPromise(Effect.flip(
      dispatchConnectionLiveQueryDeliveryEffect(
        async () => {
          throw new Error("socket send failed");
        },
        [liveQueryDeliveryChange()],
      ),
    ));
    expect(deliveryFailure).toMatchObject({
      _tag: "ConnectionRouteOperationError",
      operation: "deliver-live-query",
      status: 500,
      message: "socket send failed",
    });
  });
});

function liveQueryDeliveryChange(): LiveQueryDeliveryChange {
  return {
    kind: "updated",
    deploymentId: "deployment-a",
    connectionId: "connection:deployment-a:session-a",
    queryId: 1,
    functionPath: "users:get",
    argsJson: { id: "1:user" },
    resultJson: { name: "Ada" },
    previousResultHash: "previous",
    resultHash: "result",
  };
}
