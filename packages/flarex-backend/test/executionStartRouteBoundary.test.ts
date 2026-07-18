import { Effect } from "effect";
import { ExecutionProtocolValidationError } from "flarex-protocol/execution";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodeExecutionStartRoutePayload,
  decodeExecutionStartRouteRequest,
  decodePublicExecutionStartRoutePayload,
  decodePublicExecutionStartRouteRequest,
} from "../src/execution/StartRouteBoundary";
import { executionRouteDecodeErrorToHttpError } from "../src/execution/RouteDecodeError";

describe("execution start route boundary", () => {
  it("decodes internal execution start requests through the protocol parser", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRouteRequest(jsonRequest({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "start-once",
    })))).resolves.toEqual({
      deploymentId: "deployment-a",
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "1:user",
      kind: "query",
      idempotencyKey: "start-once",
    });

    await expect(Effect.runPromise(decodeExecutionStartRoutePayload({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
    }))).resolves.toEqual({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
    });
  });

  it("uses the public route deployment id over any body deployment id", async () => {
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

  it("keeps protocol failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodeExecutionStartRoutePayload({
      deploymentId: "deployment-a",
      path: "users:get",
      kind: "query",
    }))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
    await expect(Effect.runPromise(decodePublicExecutionStartRoutePayload(
      "not an object",
      "route-deployment",
    ))).rejects.toBeInstanceOf(ExecutionProtocolValidationError);
  });

  it("keeps malformed JSON typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionStartRouteRequest(new Request(
      "https://flarex.test/start",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps execution route decode errors at the shared boundary", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(executionRouteDecodeErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = await Effect.runPromise(
      Effect.flip(decodeExecutionStartRoutePayload(null)),
    );
    expect(protocolError).toBeInstanceOf(ExecutionProtocolValidationError);
    expect(executionRouteDecodeErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message: protocolError.message,
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
