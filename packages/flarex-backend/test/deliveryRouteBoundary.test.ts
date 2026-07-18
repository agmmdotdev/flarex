import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeDeliveryWakeRequest,
  decodeDeliveryWakeRoutePayload,
  deliveryWakeRouteErrorToHttpError,
} from "../src/delivery/RouteBoundary";
import {
  decodeDeliveryWakePayload,
  DeliveryWakePayloadError,
} from "../src/delivery/WakeRequest";
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
import { deliveryInternalRouteErrorToResponseEffect } from "../src/delivery/InternalRouteBoundary";

describe("delivery route boundary", () => {
  it("decodes delivery wake payloads through a shared typed boundary", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakePayload({
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
  });

  it("decodes delivery wake route payloads through a named Effect boundary", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakeRoutePayload({
      deploymentId: "deployment-a",
      limit: 5,
      ignored: true,
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      limit: 5,
    });

    await expect(Effect.runPromise(decodeDeliveryWakeRoutePayload({
      deploymentId: "deployment-a",
      limit: 0,
    }))).rejects.toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
    });
  });

  it("decodes wake requests", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakeRequest(jsonRequest({
      deploymentId: "deployment-a",
      limit: 10,
      maxBatches: 2,
      leaseDurationMs: 30_000,
      ignored: true,
    })))).resolves.toEqual({
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

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakeRequest(new Request("https://flarex.test/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toMatchObject({
      _tag: "RequestJsonError",
      message: "Request body must be JSON.",
    });
  });

  it("exposes typed wake decoder failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeDeliveryWakeRoutePayload({
      deploymentId: "deployment-a",
      limit: 0,
    }))).rejects.toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
    });

    await expect(Effect.runPromise(decodeDeliveryWakeRequest(new Request("https://flarex.test/wake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed wake route errors through the internal response adapter", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(deliveryWakeRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
    const jsonResponse = await Effect.runPromise(deliveryInternalRouteErrorToResponseEffect(jsonError));
    expect(jsonResponse.status).toBe(400);
    await expect(jsonResponse.json()).resolves.toEqual({
      error: "Request body must be JSON.",
    });

    const validationError = new DeliveryWakePayloadError({
      message: "deploymentId must be a non-empty string.",
    });
    expect(deliveryWakeRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "deploymentId must be a non-empty string.",
    });
    const validationResponse = await Effect.runPromise(
      deliveryInternalRouteErrorToResponseEffect(validationError),
    );
    expect(validationResponse.status).toBe(400);
    await expect(validationResponse.json()).resolves.toEqual({
      error: "deploymentId must be a non-empty string.",
    });
  });

  it("exposes shared typed wake payload failures before HTTP mapping", async () => {
    const failure = await Effect.runPromise(Effect.flip(decodeDeliveryWakePayload({
      deploymentId: "deployment-a",
      limit: 0,
    })));

    expect(failure).toBeInstanceOf(DeliveryWakePayloadError);
    expect(failure).toMatchObject({
      _tag: "DeliveryWakePayloadError",
      message: "limit must be a positive integer.",
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

    let cursorDeliveryIdReads = 0;
    const cursorFailure = await pendingDrainStateFailure({
      ...pending,
      cursor: {
        createdAt: "not-a-date",
        get deliveryId() {
          cursorDeliveryIdReads += 1;
          return "delivery-1";
        },
      },
    });
    expect(cursorFailure).toMatchObject({
      _tag: "DeliveryPendingDrainStateError",
      message: "pending delivery drain cursor.createdAt must be an ISO date string.",
    });
    expect(cursorDeliveryIdReads).toBe(0);

    let limitReads = 0;
    const firstFailure = await pendingDrainStateFailure({
      ...pending,
      deploymentId: "",
      get limit() {
        limitReads += 1;
        return 0;
      },
    });
    expect(firstFailure.message).toBe(
      "pending delivery drain deploymentId must be a non-empty string.",
    );
    expect(limitReads).toBe(0);
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
