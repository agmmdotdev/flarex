import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parsePublicInvokeRouteRequest,
  readPublicInvokeRequest,
} from "../src/invoke/PublicInvokeRouteBoundary";

describe("public invoke route boundary", () => {
  it("decodes public invoke requests through the protocol parser", async () => {
    await expect(readPublicInvokeRequest(jsonRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "invoke-once",
    });
  });

  it("keeps omitted args omitted for the Worker invoke defaulting boundary", () => {
    expect(parsePublicInvokeRouteRequest({
      path: "users:list",
      kind: "query",
    })).toEqual({
      path: "users:list",
      kind: "query",
    });
  });

  it("maps protocol failures to the backend 400 error boundary", () => {
    expect(() => parsePublicInvokeRouteRequest(null))
      .toThrow(HttpError);
    try {
      parsePublicInvokeRouteRequest({ args: new Date(0) });
      throw new Error("Expected parsePublicInvokeRouteRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message:
          "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readPublicInvokeRequest(new Request("https://flarex.test/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
