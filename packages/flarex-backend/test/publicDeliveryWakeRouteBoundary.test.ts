import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodePublicDeliveryWakeRequest,
  decodePublicDeliveryWakeRoutePayload,
} from "../src/delivery/PublicWakeRouteBoundary";
import {
  decodePublicDeliveryWakePayload,
  DeliveryWakePayloadError,
} from "../src/delivery/WakeRequest";
import { createBackendHarness } from "./backendHarness";

describe("public delivery wake route boundary", () => {
  it("decodes public delivery wake payloads through the shared source boundary", async () => {
    await expect(Effect.runPromise(decodePublicDeliveryWakePayload({
      deploymentId: "body-deployment",
      limit: 10,
      ignored: true,
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 10,
    });
  });

  it("decodes public delivery wake route payloads through a named Effect boundary", async () => {
    await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload({
      deploymentId: "body-deployment",
      limit: 5,
      ignored: true,
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 5,
    });

    await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload({
      limit: 0,
    }, "route-deployment"))).rejects.toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
    });
  });

  it("decodes wake requests with the route deployment id", async () => {
    await expect(Effect.runPromise(decodePublicDeliveryWakeRequest(jsonRequest({
      deploymentId: "body-deployment",
      limit: 3,
    }), "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 3,
    });
  });

  it("keeps invalid wake bodies typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload(null, "deployment-a")))
      .rejects.toMatchObject({
        _tag: "DeliveryWakePayloadError",
        message: "Delivery wake request body must be an object.",
      });
    const cases: Array<{
      field: "limit" | "maxBatches" | "leaseDurationMs";
      expected: string;
    }> = [
      { field: "limit", expected: "limit must be a positive integer." },
      { field: "maxBatches", expected: "maxBatches must be a positive integer." },
      {
        field: "leaseDurationMs",
        expected: "leaseDurationMs must be a positive integer.",
      },
    ];
    for (const testCase of cases) {
      await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload({
          [testCase.field]: 0,
        }, "deployment-a"))).rejects.toMatchObject({
          _tag: "DeliveryWakePayloadError",
          message: testCase.expected,
        });
    }
  });

  it("exposes typed public wake decoder failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload(null, "deployment-a")))
      .rejects.toMatchObject({
        _tag: "DeliveryWakePayloadError",
        message: "Delivery wake request body must be an object.",
      });

    await expect(Effect.runPromise(decodePublicDeliveryWakeRoutePayload({
      limit: 0,
    }, "deployment-a"))).rejects.toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
    });

    await expect(Effect.runPromise(decodePublicDeliveryWakeRequest(new Request(
      "https://flarex.test/deployments/deployment-a/sync/wake-delivery",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "deployment-a"))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps public wake route errors through the Worker adapter edge", async () => {
    const harness = await createBackendHarness();
    try {
      const malformedJson = await harness.mf.dispatchFetch(
        "http://flarex.test/deployments/deployment-a/sync/wake-delivery",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{",
        },
      );
      expect(malformedJson.status).toBe(400);
      await expect(malformedJson.json()).resolves.toEqual({
        error: "Request body must be JSON.",
      });

      const invalidPayload = await harness.mf.dispatchFetch(
        "http://flarex.test/deployments/deployment-a/sync/wake-delivery",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ limit: 0 }),
        },
      );
      expect(invalidPayload.status).toBe(400);
      await expect(invalidPayload.json()).resolves.toEqual({
        error: "limit must be a positive integer.",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("exposes shared typed public wake payload failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodePublicDeliveryWakePayload({
      limit: 0,
    }, "deployment-a")));

    expect(failure).toBeInstanceOf(DeliveryWakePayloadError);
    expect(failure).toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deployments/deployment-a/sync/wake-delivery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
