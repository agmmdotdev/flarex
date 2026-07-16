import { Effect } from "effect";
import { executionIdentityFingerprint } from "flarex-protocol/auth";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodePublicLiveQueryDeliveryRequest,
  decodePublicLiveQueryDeliveryRoutePayload,
} from "../src/liveQueryDelivery/RouteBoundary";
import { createBackendHarness } from "./backendHarness";

const anonymousIdentityFingerprint = executionIdentityFingerprint({ kind: "anonymous" });

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
          identityFingerprint: anonymousIdentityFingerprint,
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
          identityFingerprint: anonymousIdentityFingerprint,
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
        identityFingerprint: anonymousIdentityFingerprint,
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
        identityFingerprint: anonymousIdentityFingerprint,
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

  it("maps public live query delivery route errors through the Worker adapter edge", async () => {
    const harness = await createBackendHarness();
    try {
      const malformedJson = await harness.mf.dispatchFetch(
        "http://flarex.test/deployments/deployment-a/sync/deliver-live-query",
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
        "http://flarex.test/deployments/deployment-a/sync/deliver-live-query",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deliveries: [{ queryId: "1" }] }),
        },
      );
      expect(invalidPayload.status).toBe(400);
      await expect(invalidPayload.json()).resolves.toEqual({
        error: "deliveries[0].deploymentId must be a non-empty string.",
      });
    } finally {
      await harness.dispose();
    }
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deployments/deployment-a/sync/deliver-live-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
