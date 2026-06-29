import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeDeliveryWakeRequest,
  DeliveryWakeRouteValidationError,
  deliveryWakeRouteErrorToHttpError,
  parseDeliveryWakeRequest,
  parseDeliveryWakeRequestEffect,
  readDeliveryWakeRequest,
} from "../src/delivery/RouteBoundary";

describe("delivery route boundary", () => {
  it("decodes wake requests", async () => {
    await expect(readDeliveryWakeRequest(jsonRequest({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
    });
    await expect(Effect.runPromise(decodeDeliveryWakeRequest(jsonRequest({
      deploymentId: "deployment-a",
      limit: 3,
    })))).resolves.toEqual({
      deploymentId: "deployment-a",
      limit: 3,
    });
  });

  it("maps invalid wake bodies to 400", () => {
    expect(() => parseDeliveryWakeRequest(null))
      .toThrow(HttpError);
    try {
      parseDeliveryWakeRequest({
        deploymentId: "deployment-a",
        limit: 0,
      });
      throw new Error("Expected parseDeliveryWakeRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "limit must be a positive integer.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readDeliveryWakeRequest(new Request("https://flarex.test/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("exposes typed wake decoder failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(parseDeliveryWakeRequestEffect({
      deploymentId: "deployment-a",
      limit: 0,
    }))).rejects.toMatchObject({
      _tag: "DeliveryWakeRouteValidationError",
      message: "limit must be a positive integer.",
    });

    await expect(Effect.runPromise(decodeDeliveryWakeRequest(new Request("https://flarex.test/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed wake route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(deliveryWakeRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new DeliveryWakeRouteValidationError({
      message: "deploymentId must be a non-empty string.",
    });
    expect(deliveryWakeRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "deploymentId must be a non-empty string.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/wake", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
