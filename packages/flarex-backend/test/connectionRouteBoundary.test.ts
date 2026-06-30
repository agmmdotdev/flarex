import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import { LiveQueryDeliveryChangePayloadError } from "../src/liveQueryDelivery";
import {
  connectionRouteErrorToHttpError,
  ConnectionRouteValidationError,
  decodeConnectionInvalidationRequest,
  decodeConnectionInvalidationRoutePayload,
  decodeConnectionLiveQueryDeliveryRequest,
  decodeConnectionLiveQueryDeliveryRoutePayload,
  parseConnectionInvalidationRequest,
  parseConnectionInvalidationRequestEffect,
  parseConnectionLiveQueryDeliveryRequest,
  parseConnectionLiveQueryDeliveryRequestEffect,
  readConnectionInvalidationRequest,
  readConnectionLiveQueryDeliveryRequest,
} from "../src/connection/RouteBoundary";
import {
  connectionRouteOperationError,
  connectionRouteOperationErrorToHttpError,
  ConnectionRouteOperationError,
} from "../src/connection/RouteOperationError";

describe("connection route boundary", () => {
  it("decodes connection invalidation route payloads through a named Effect boundary", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationRoutePayload({ queryId: 42 })))
      .resolves.toBe(42);

    await expect(Effect.runPromise(decodeConnectionInvalidationRoutePayload({ queryId: "42" })))
      .rejects.toMatchObject({
        _tag: "ConnectionRouteValidationError",
        message: "Invalidation queryId must be an integer.",
      });
  });

  it("decodes invalidation requests", async () => {
    await expect(readConnectionInvalidationRequest(jsonRequest({ queryId: 42 })))
      .resolves.toBe(42);
    expect(parseConnectionInvalidationRequest({ queryId: 7, invalidatedTs: 12 }))
      .toBe(7);
    await expect(Effect.runPromise(decodeConnectionInvalidationRequest(jsonRequest({ queryId: 9 }))))
      .resolves.toBe(9);
  });

  it("maps invalid invalidation bodies to 400", async () => {
    expect(() => parseConnectionInvalidationRequest({ queryId: "42" }))
      .toThrow(HttpError);
    await expect(readConnectionInvalidationRequest(new Request(
      "https://flarex.test/invalidate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("decodes live query delivery requests", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRoutePayload({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 3,
          functionPath: "users:get",
          argsJson: {},
          resultJson: { ok: true },
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    }))).resolves.toMatchObject([
      {
        kind: "updated",
        queryId: 3,
      },
    ]);

    await expect(readConnectionLiveQueryDeliveryRequest(jsonRequest({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 1,
          functionPath: "users:get",
          argsJson: { id: "1:user" },
          resultJson: { name: "Ada" },
          previousResultHash: "{\"name\":\"Grace\"}",
          resultHash: "{\"name\":\"Ada\"}",
        },
      ],
    }))).resolves.toEqual([
      {
        kind: "updated",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-a",
        queryId: 1,
        functionPath: "users:get",
        argsJson: { id: "1:user" },
        resultJson: { name: "Ada" },
        previousResultHash: "{\"name\":\"Grace\"}",
        resultHash: "{\"name\":\"Ada\"}",
      },
    ]);
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRequest(jsonRequest({
      deliveries: [
        {
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-a",
          queryId: 3,
          functionPath: "users:get",
          argsJson: {},
          resultJson: { ok: true },
          previousResultHash: "previous",
          resultHash: "result",
        },
      ],
    })))).resolves.toMatchObject([
      {
        kind: "updated",
        queryId: 3,
      },
    ]);
  });

  it("maps invalid live query delivery bodies to 400", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRoutePayload({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryChangePayloadError",
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });

    expect(() => parseConnectionLiveQueryDeliveryRequest(null))
      .toThrow(HttpError);
    try {
      parseConnectionLiveQueryDeliveryRequest({ deliveries: [{ queryId: 1 }] });
      throw new Error("Expected parseConnectionLiveQueryDeliveryRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deliveries[0].deploymentId must be a non-empty string.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readConnectionLiveQueryDeliveryRequest(new Request(
      "https://flarex.test/deliver/live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });

  it("exposes typed connection route failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(parseConnectionInvalidationRequestEffect({
      queryId: "42",
    }))).rejects.toMatchObject({
      _tag: "ConnectionRouteValidationError",
      message: "Invalidation queryId must be an integer.",
    });

    await expect(Effect.runPromise(parseConnectionLiveQueryDeliveryRequestEffect({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toMatchObject({
      _tag: "LiveQueryDeliveryChangePayloadError",
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });

    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRequest(new Request(
      "https://flarex.test/deliver/live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed connection route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(connectionRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new ConnectionRouteValidationError({
      message: "Invalidation queryId must be an integer.",
    });
    expect(connectionRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "Invalidation queryId must be an integer.",
    });

    const deliveryPayloadError = new LiveQueryDeliveryChangePayloadError({
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });
    expect(connectionRouteErrorToHttpError(deliveryPayloadError)).toMatchObject({
      status: 400,
      message: "deliveries[0].deploymentId must be a non-empty string.",
    });
  });

  it("preserves connection operation failures before HTTP mapping", () => {
    const cause = new HttpError(409, "Invalidation already in flight.");
    const httpFailure = connectionRouteOperationError("invalidate", cause);

    expect(httpFailure).toBeInstanceOf(ConnectionRouteOperationError);
    expect(httpFailure).toMatchObject({
      operation: "invalidate",
      status: 409,
      message: "Invalidation already in flight.",
      cause,
    });
    expect(connectionRouteOperationErrorToHttpError(httpFailure)).toMatchObject({
      status: 409,
      message: "Invalidation already in flight.",
    });

    const runtimeFailure = connectionRouteOperationError(
      "deliver-live-query",
      new Error("socket send failed"),
    );
    expect(runtimeFailure).toMatchObject({
      operation: "deliver-live-query",
      status: 500,
      message: "socket send failed",
    });
    expect(connectionRouteOperationErrorToHttpError(runtimeFailure)).toMatchObject({
      status: 500,
      message: "socket send failed",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deliver/live-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
