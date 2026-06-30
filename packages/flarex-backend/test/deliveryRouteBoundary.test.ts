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
import {
  decodePendingDeliveryDrainFromStorage,
  DeliveryPendingDrainStateError,
  deliveryPendingDrainStateErrorToHttpError,
  type PendingDeliveryDrain,
} from "../src/delivery/PendingDrainState";
import {
  DeliveryRouteOperationError,
  deliveryRouteOperationError,
  deliveryRouteOperationErrorToHttpError,
} from "../src/delivery/RouteOperationError";

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

  it("preserves delivery operation failures before HTTP mapping", () => {
    const cause = new HttpError(503, "Delivery drain temporarily unavailable.");
    const httpFailure = deliveryRouteOperationError("wake", cause);

    expect(httpFailure).toBeInstanceOf(DeliveryRouteOperationError);
    expect(httpFailure).toMatchObject({
      operation: "wake",
      status: 503,
      message: "Delivery drain temporarily unavailable.",
      cause,
    });
    expect(deliveryRouteOperationErrorToHttpError(httpFailure)).toMatchObject({
      status: 503,
      message: "Delivery drain temporarily unavailable.",
    });

    const runtimeFailure = deliveryRouteOperationError(
      "continue",
      new Error("pending drain storage failed"),
    );
    expect(runtimeFailure).toMatchObject({
      operation: "continue",
      status: 500,
      message: "pending drain storage failed",
    });
    expect(deliveryRouteOperationErrorToHttpError(runtimeFailure)).toMatchObject({
      status: 500,
      message: "pending drain storage failed",
    });
  });

  it("exposes typed pending drain storage state failures", async () => {
    const pending: PendingDeliveryDrain = {
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      claimOwner: "delivery:deployment-a:owner",
      retryAttempt: 1,
      cursor: {
        createdAt: "2026-01-01T00:00:00.000Z",
        deliveryId: "delivery-1",
      },
    };

    await expect(Effect.runPromise(decodePendingDeliveryDrainFromStorage(pending))).resolves.toEqual(pending);

    const objectFailure = await pendingDrainStateFailure(null);
    expect(objectFailure).toBeInstanceOf(DeliveryPendingDrainStateError);
    expect(objectFailure).toMatchObject({
      _tag: "DeliveryPendingDrainStateError",
      message: "Pending delivery drain state must be an object.",
    });

    const cursorFailure = await pendingDrainStateFailure({
      ...pending,
      cursor: {
        createdAt: "not-a-date",
        deliveryId: "delivery-1",
      },
    });
    expect(cursorFailure).toMatchObject({
      _tag: "DeliveryPendingDrainStateError",
      message: "pending delivery drain cursor.createdAt must be an ISO date string.",
    });
  });

  it("maps pending drain storage state errors at the adapter boundary", () => {
    expect(deliveryPendingDrainStateErrorToHttpError(
      new DeliveryPendingDrainStateError({
        message: "pending delivery drain limit must be a positive integer.",
      }),
    )).toMatchObject({
      status: 500,
      message: "pending delivery drain limit must be a positive integer.",
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

async function pendingDrainStateFailure(value: unknown): Promise<DeliveryPendingDrainStateError> {
  const failure = await Effect.runPromise(decodePendingDeliveryDrainFromStorage(value).pipe(
    Effect.catchTag("DeliveryPendingDrainStateError", error => Effect.succeed(error)),
  ));
  if (!(failure instanceof DeliveryPendingDrainStateError)) {
    throw new Error("Expected DeliveryPendingDrainStateError.");
  }
  return failure;
}
