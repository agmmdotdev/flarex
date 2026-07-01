import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  dispatchPublicDeliveryWakeEffect,
  type PublicDeliveryWakeDispatchTarget,
} from "../src/delivery/PublicWakeDispatchBoundary";
import type { DeliveryWakeRequest } from "../src/delivery/RouteBoundary";

describe("public delivery wake dispatch boundary", () => {
  it("dispatches public delivery wake requests to the preserved internal route", async () => {
    const requests: DispatchedRequest[] = [];
    const forwarded = Response.json({ ok: true });
    const body = deliveryWakeRequest();

    const response = await Effect.runPromise(dispatchPublicDeliveryWakeEffect(
      deliveryTarget(requests, async () => forwarded),
      body,
    ));

    expect(response).toBe(forwarded);
    expect(requests).toEqual([{
      input: "https://flarex.internal/wake",
      method: "POST",
      contentType: "application/json",
      body: JSON.stringify(body),
    }]);
  });

  it("maps public delivery wake dispatch failures to the typed worker error source", async () => {
    const failure = await Effect.runPromise(Effect.flip(dispatchPublicDeliveryWakeEffect(
      failingDeliveryTarget("delivery wake unavailable"),
      deliveryWakeRequest(),
    )));

    expect(failure).toMatchObject({
      _tag: "PublicWorkerDispatchError",
      source: "delivery-wake",
      status: 500,
      message: "delivery wake unavailable",
    });
  });
});

type DispatchedRequest = {
  readonly input: string;
  readonly method: string | undefined;
  readonly contentType: string | null;
  readonly body: BodyInit | null | undefined;
};

function deliveryTarget(
  requests: DispatchedRequest[],
  respond: () => Promise<Response>,
): PublicDeliveryWakeDispatchTarget {
  return {
    fetch: async (input, init) => {
      requests.push({
        input,
        method: init?.method,
        contentType: new Headers(init?.headers).get("content-type"),
        body: init?.body,
      });
      return respond();
    },
  };
}

function failingDeliveryTarget(message: string): PublicDeliveryWakeDispatchTarget {
  return {
    fetch: async () => {
      throw new Error(message);
    },
  };
}

function deliveryWakeRequest(): DeliveryWakeRequest {
  return {
    deploymentId: "deployment-a",
    limit: 10,
    maxBatches: 2,
    leaseDurationMs: 30_000,
  };
}
