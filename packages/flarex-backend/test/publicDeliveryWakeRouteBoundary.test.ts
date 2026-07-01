import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodePublicDeliveryWakeRequest,
  decodePublicDeliveryWakeRoutePayload,
  parsePublicDeliveryWakeRequest,
  parsePublicDeliveryWakeRequestEffect,
  publicDeliveryWakeRouteErrorToHttpError,
  publicDeliveryWakeRouteErrorToHttpErrorEffect,
  readPublicDeliveryWakeRequest,
} from "../src/delivery/PublicWakeRouteBoundary";
import {
  decodePublicDeliveryWakePayload,
  DeliveryWakePayloadError,
} from "../src/delivery/WakeRequest";

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
    await expect(readPublicDeliveryWakeRequest(jsonRequest({
      deploymentId: "body-deployment",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    }), "route-deployment")).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
    });
    await expect(Effect.runPromise(decodePublicDeliveryWakeRequest(jsonRequest({
      deploymentId: "body-deployment",
      limit: 3,
    }), "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      limit: 3,
    });
  });

  it("maps invalid wake bodies to 400", () => {
    expect(() => parsePublicDeliveryWakeRequest(null, "deployment-a"))
      .toThrow(HttpError);

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
      try {
        parsePublicDeliveryWakeRequest({
          [testCase.field]: 0,
        }, "deployment-a");
        throw new Error("Expected parsePublicDeliveryWakeRequest to fail.");
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          message: testCase.expected,
        });
      }
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicDeliveryWakeRequest(new Request(
      "https://flarex.test/deployments/deployment-a/sync/wake-delivery",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ), "deployment-a")).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("exposes typed public wake decoder failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(parsePublicDeliveryWakeRequestEffect(null, "deployment-a")))
      .rejects.toMatchObject({
        _tag: "DeliveryWakePayloadError",
        message: "Delivery wake request body must be an object.",
      });

    await expect(Effect.runPromise(parsePublicDeliveryWakeRequestEffect({
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

  it("maps typed public wake route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicDeliveryWakeRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new DeliveryWakePayloadError({
      message: "limit must be a positive integer.",
    });
    expect(publicDeliveryWakeRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "limit must be a positive integer.",
    });
  });

  it("maps typed public wake route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    const mappedJson = await Effect.runPromise(Effect.flip(
      publicDeliveryWakeRouteErrorToHttpErrorEffect(jsonError),
    ));
    expect(mappedJson).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new DeliveryWakePayloadError({
      message: "limit must be a positive integer.",
    });
    const mappedValidation = await Effect.runPromise(Effect.flip(
      publicDeliveryWakeRouteErrorToHttpErrorEffect(validationError),
    ));
    expect(mappedValidation).toMatchObject({
      status: 400,
      message: "limit must be a positive integer.",
    });
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
