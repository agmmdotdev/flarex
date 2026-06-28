import { describe, expect, it } from "vitest";
import {
  parsePublicLiveQueryDeliveryRequest,
  readPublicLiveQueryDeliveryRequest,
} from "../src/liveQueryDelivery/RouteBoundary";

describe("public live query delivery route boundary", () => {
  it("decodes updated and failed delivery requests", async () => {
    await expect(readPublicLiveQueryDeliveryRequest(jsonRequest({
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
  });

  it("maps invalid delivery envelopes to 400", () => {
    try {
      parsePublicLiveQueryDeliveryRequest({});
      throw new Error("Expected parsePublicLiveQueryDeliveryRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "Live query delivery body must be an object with a deliveries array.",
      });
    }
    try {
      parsePublicLiveQueryDeliveryRequest({
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
      });
      throw new Error("Expected parsePublicLiveQueryDeliveryRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "deliveries[0].queryId must be an integer.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicLiveQueryDeliveryRequest(new Request(
      "https://flarex.test/deployments/deployment-a/sync/deliver-live-query",
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
  return new Request("https://flarex.test/deployments/deployment-a/sync/deliver-live-query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
