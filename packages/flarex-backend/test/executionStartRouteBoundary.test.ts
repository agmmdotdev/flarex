import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseExecutionStartRouteRequest,
  parsePublicExecutionStartRouteRequest,
  readExecutionStartRequest,
  readPublicExecutionStartRequest,
} from "../src/execution/StartRouteBoundary";

describe("execution start route boundary", () => {
  it("decodes internal execution start requests through the protocol parser", async () => {
    await expect(readExecutionStartRequest(jsonRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "start-once",
    }))).resolves.toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "start-once",
    });
  });

  it("uses the public route deployment id over any body deployment id", async () => {
    await expect(readPublicExecutionStartRequest(jsonRequest({
      deploymentId: "body-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    }), "route-deployment")).resolves.toEqual({
      deploymentId: "route-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    });

    expect(parsePublicExecutionStartRouteRequest({
      deploymentId: "body-deployment",
      path: "users:list",
      args: [],
      projectId: "project-a",
    }, "route-deployment")).toEqual({
      deploymentId: "route-deployment",
      path: "users:list",
      args: [],
      projectId: "project-a",
    });
  });

  it("maps non-object public execution start bodies through the protocol boundary", () => {
    expect(() => parsePublicExecutionStartRouteRequest(null, "route-deployment"))
      .toThrow(HttpError);
    try {
      parsePublicExecutionStartRouteRequest("not an object", "route-deployment");
      throw new Error("Expected parsePublicExecutionStartRouteRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message:
          "Execution start request must include string deploymentId, string path, JSON args, and optional string partitionKey, projectId, idempotencyKey, and query or mutation kind.",
      });
    }
  });

  it("maps protocol failures to the backend 400 error boundary", () => {
    expect(() => parseExecutionStartRouteRequest(null))
      .toThrow(HttpError);
    try {
      parseExecutionStartRouteRequest({
        deploymentId: "deployment-a",
        path: "users:get",
        kind: "query",
      });
      throw new Error("Expected parseExecutionStartRouteRequest to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message:
          "Execution start request must include string deploymentId, string path, JSON args, and optional string partitionKey, projectId, idempotencyKey, and query or mutation kind.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readExecutionStartRequest(new Request("https://flarex.test/start", {
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
  return new Request("https://flarex.test/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
