import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeExecutionStartRouteRequest,
  decodeExecutionStartRoutePayload,
  decodePublicExecutionStartRouteRequest,
  decodePublicExecutionStartRoutePayload,
  executionStartRouteErrorToHttpError,
  parseExecutionStartRouteRequest,
  parseExecutionStartRouteRequestEffect,
  parsePublicExecutionStartRouteRequest,
  parsePublicExecutionStartRouteRequestEffect,
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
    await expect(Effect.runPromise(decodeExecutionStartRouteRequest(jsonRequest({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
    })))).resolves.toEqual({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
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
    await expect(Effect.runPromise(decodePublicExecutionStartRouteRequest(jsonRequest({
      deploymentId: "body-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    }), "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    });
    await expect(Effect.runPromise(decodePublicExecutionStartRoutePayload({
      deploymentId: "body-deployment",
      path: "users:get",
      args: null,
      kind: "query",
    }, "route-deployment"))).resolves.toEqual({
      deploymentId: "route-deployment",
      path: "users:get",
      args: null,
      kind: "query",
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

  it("exposes typed execution start failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRoutePayload({
      deploymentId: "deployment-a",
      path: "users:get",
      kind: "query",
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(parseExecutionStartRouteRequestEffect({
      deploymentId: "deployment-a",
      path: "users:get",
      kind: "query",
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodePublicExecutionStartRoutePayload(
      "not an object",
      "route-deployment",
    ))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(parsePublicExecutionStartRouteRequestEffect(
      "not an object",
      "route-deployment",
    ))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);

    await expect(Effect.runPromise(decodeExecutionStartRouteRequest(new Request(
      "https://flarex.test/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed execution start route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(executionStartRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new ExecutionProtocolValidationError({
      schema: "ExecutionStartRequest",
      message: "Execution start request must include JSON args.",
      cause: null,
    });
    expect(executionStartRouteErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message: "Execution start request must include JSON args.",
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
