import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import { LiveQueryDeliveryChangePayloadError } from "../src/liveQueryDelivery";
import {
  decodePublicLiveQueryDeliveryRequest,
  decodePublicLiveQueryDeliveryRoutePayload,
  publicLiveQueryDeliveryRouteErrorToHttpError,
  publicLiveQueryDeliveryRouteErrorToHttpErrorEffect,
} from "../src/liveQueryDelivery/RouteBoundary";

describe("public live query delivery route boundary", () => {
  it("decodes public live query delivery route payloads through a named Effect boundary", async () => {
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRoutePayload({
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

    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRoutePayload({})))
      .rejects.toMatchObject({
        _tag: "LiveQueryDeliveryChangePayloadError",
        message: "Live query delivery body must be an object with a deliveries array.",
      });
  });

  it("decodes updated and failed delivery requests", async () => {
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRequest(jsonRequest({
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
        {
          kind: "failed",
          deploymentId: "deployment-a",
          connectionId: "connection:deployment-a:session-b",
          queryId: 2,
          functionPath: "users:list",
          argsJson: {},
          previousResultHash: "previous",
          errorMessage: "boom",
          errorData: { code: "QUERY_FAILED" },
        },
      ],
    })))).resolves.toEqual([
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
      {
        kind: "failed",
        deploymentId: "deployment-a",
        connectionId: "connection:deployment-a:session-b",
        queryId: 2,
        functionPath: "users:list",
        argsJson: {},
        previousResultHash: "previous",
        errorMessage: "boom",
        errorData: { code: "QUERY_FAILED" },
      },
    ]);
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRequest(jsonRequest({
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

  it("keeps invalid delivery envelopes typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRoutePayload({})))
      .rejects.toMatchObject({
        _tag: "LiveQueryDeliveryChangePayloadError",
        message: "Live query delivery body must be an object with a deliveries array.",
      });
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRoutePayload({
        deliveries: [
          {
            deploymentId: "deployment-a",
            connectionId: "connection:deployment-a:session-a",
            queryId: "1",
            functionPath: "users:get",
            argsJson: {},
            resultJson: {},
            previousResultHash: "previous",
            resultHash: "result",
          },
        ],
      }))).rejects.toMatchObject({
        _tag: "LiveQueryDeliveryChangePayloadError",
        message: "deliveries[0].queryId must be an integer.",
      });
  });

  it("exposes typed public live query delivery failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRoutePayload({})))
      .rejects.toMatchObject({
        _tag: "LiveQueryDeliveryChangePayloadError",
        message: "Live query delivery body must be an object with a deliveries array.",
      });

    await expect(Effect.runPromise(decodePublicLiveQueryDeliveryRequest(new Request(
      "https://flarex.test/deployments/deployment-a/sync/deliver-live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed public live query delivery route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicLiveQueryDeliveryRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new LiveQueryDeliveryChangePayloadError({
      message: "deliveries[0].queryId must be an integer.",
    });
    expect(publicLiveQueryDeliveryRouteErrorToHttpError(validationError)).toMatchObject({
      status: 400,
      message: "deliveries[0].queryId must be an integer.",
    });
  });

  it("maps typed public live query delivery route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    await expect(Effect.runPromise(Effect.flip(
      publicLiveQueryDeliveryRouteErrorToHttpErrorEffect(jsonError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new LiveQueryDeliveryChangePayloadError({
      message: "deliveries[0].queryId must be an integer.",
    });
    await expect(Effect.runPromise(Effect.flip(
      publicLiveQueryDeliveryRouteErrorToHttpErrorEffect(validationError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "deliveries[0].queryId must be an integer.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deployments/deployment-a/sync/deliver-live-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
