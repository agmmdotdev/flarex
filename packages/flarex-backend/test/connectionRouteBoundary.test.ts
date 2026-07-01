import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import { LiveQueryDeliveryChangePayloadError } from "../src/liveQueryDelivery";
import {
  ConnectionRouteValidationError,
  decodeConnectionInvalidationRequest,
  decodeConnectionInvalidationRoutePayload,
  decodeConnectionLiveQueryDeliveryRequest,
  decodeConnectionLiveQueryDeliveryRoutePayload,
} from "../src/connection/RouteBoundary";
import {
  connectionRouteOperationError,
  connectionRouteOperationErrorToHttpError,
  connectionRouteOperationErrorToHttpErrorEffect,
  ConnectionRouteOperationError,
} from "../src/connection/RouteOperationError";
import { createBackendHarness } from "./backendHarness";
import type { Env } from "../src/types";

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
    await expect(Effect.runPromise(decodeConnectionInvalidationRequest(jsonRequest({ queryId: 9 }))))
      .resolves.toBe(9);
  });

  it("keeps invalid invalidation bodies typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationRequest(jsonRequest({ queryId: "42" }))))
      .rejects.toBeInstanceOf(ConnectionRouteValidationError);
    await expect(Effect.runPromise(decodeConnectionInvalidationRoutePayload({})))
      .rejects.toMatchObject({
        _tag: "ConnectionRouteValidationError",
        message: "Invalidation queryId must be an integer.",
      });
    await expect(Effect.runPromise(decodeConnectionInvalidationRoutePayload(null)))
      .rejects.toMatchObject({
        _tag: "ConnectionRouteValidationError",
        message: "Invalidation queryId must be an integer.",
      });
  });

  it("keeps malformed invalidation JSON typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationRequest(new Request(
      "https://flarex.test/invalidate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
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

  it("keeps invalid live query delivery bodies typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRoutePayload({
      deliveries: [{ queryId: 1 }],
    }))).rejects.toBeInstanceOf(LiveQueryDeliveryChangePayloadError);

    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRequest(jsonRequest({
      deliveries: [{ queryId: 1 }],
    })))).rejects.toBeInstanceOf(LiveQueryDeliveryChangePayloadError);
  });

  it("keeps malformed live query delivery JSON typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRequest(new Request(
      "https://flarex.test/deliver/live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("exposes typed connection route failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeConnectionInvalidationRoutePayload({
      queryId: "42",
    }))).rejects.toMatchObject({
      _tag: "ConnectionRouteValidationError",
      message: "Invalidation queryId must be an integer.",
    });

    await expect(Effect.runPromise(decodeConnectionLiveQueryDeliveryRoutePayload({
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

  it("maps typed connection route errors through the ConnectionDO adapter edge", async () => {
    const harness = await createBackendHarness();
    try {
      const env = await harness.mf.getBindings<Env>();
      const connection = env.CONNECTIONS.getByName("connection:route-boundary:session-a");

      const malformedJson = await connection.fetch("https://flarex.internal/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });
      expect(malformedJson.status).toBe(400);
      await expect(malformedJson.json()).resolves.toEqual({
        error: "Request body must be JSON.",
      });

      const invalidInvalidation = await connection.fetch("https://flarex.internal/invalidate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryId: "42" }),
      });
      expect(invalidInvalidation.status).toBe(400);
      await expect(invalidInvalidation.json()).resolves.toEqual({
        error: "Invalidation queryId must be an integer.",
      });

      const invalidDelivery = await connection.fetch("https://flarex.internal/deliver/live-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deliveries: [{ queryId: 1 }] }),
      });
      expect(invalidDelivery.status).toBe(400);
      await expect(invalidDelivery.json()).resolves.toEqual({
        error: "deliveries[0].deploymentId must be a non-empty string.",
      });
    } finally {
      await harness.dispose();
    }
  });

  it("maps typed connection operation errors through named adapter effects", async () => {
    const operationError = connectionRouteOperationError(
      "deliver-live-query",
      new Error("socket send failed"),
    );
    await expect(Effect.runPromise(Effect.flip(
      connectionRouteOperationErrorToHttpErrorEffect(operationError),
    ))).resolves.toMatchObject({
      status: 500,
      message: "socket send failed",
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
