import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseConnectionInvalidationRequest,
  parseConnectionLiveQueryDeliveryRequest,
  readConnectionInvalidationRequest,
  readConnectionLiveQueryDeliveryRequest,
} from "../src/connection/RouteBoundary";

describe("connection route boundary", () => {
  it("decodes invalidation requests", async () => {
    await expect(readConnectionInvalidationRequest(jsonRequest({ queryId: 42 })))
      .resolves.toBe(42);
    expect(parseConnectionInvalidationRequest({ queryId: 7, invalidatedTs: 12 }))
      .toBe(7);
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
  });

  it("maps invalid live query delivery bodies to 400", () => {
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
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/deliver/live-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
