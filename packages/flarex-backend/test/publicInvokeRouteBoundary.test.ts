import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { InvokeProtocolValidationError } from "flarex-protocol/invoke";
import { RequestJsonError } from "../src/http";
import {
  decodePublicInvokeRouteRequest,
  decodePublicInvokeRoutePayload,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokeDeploymentError,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
  publicInvokeRouteErrorToHttpError,
  publicInvokeRouteErrorToHttpErrorEffect,
} from "../src/invoke/PublicInvokeRouteBoundary";

describe("public invoke route boundary", () => {
  it("decodes public invoke requests through the protocol parser", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRouteRequest(jsonRequest({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
      kind: "query",
    })))).resolves.toEqual({
      deploymentId: "deployment-b",
      path: "users:list",
      args: {},
      kind: "query",
    });
    await expect(Effect.runPromise(decodePublicInvokeRoutePayload({
      deploymentId: "deployment-c",
      path: "users:get",
      args: { id: "1:user" },
      kind: "query",
    }))).resolves.toEqual({
      deploymentId: "deployment-c",
      path: "users:get",
      args: { id: "1:user" },
      kind: "query",
    });
  });

  it("keeps omitted args omitted for the Worker invoke defaulting boundary", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRoutePayload({
      path: "users:list",
      kind: "query",
    }))).resolves.toEqual({
      path: "users:list",
      kind: "query",
    });
  });

  it("builds typed invoke requests before Worker execution", async () => {
    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      path: "users:list",
      kind: "query",
    }))).resolves.toEqual({
      path: "users:list",
      args: null,
      kind: "query",
    });

    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      args: null,
    }))).rejects.toBeInstanceOf(MissingInvokePathError);

    await expect(Effect.runPromise(invokeRequestFromPublicInvokeBodyEffect({
      path: "users:list",
      partitionKey: "",
    }))).rejects.toBeInstanceOf(MissingInvokePartitionKeyError);
  });

  it("keeps protocol failures typed before adapter mapping", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRoutePayload(null)))
      .rejects.toBeInstanceOf(InvokeProtocolValidationError);
    await expect(Effect.runPromise(decodePublicInvokeRoutePayload({ args: new Date(0) })))
      .rejects.toBeInstanceOf(InvokeProtocolValidationError);
  });

  it("exposes typed protocol failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRouteRequest(jsonRequest({
      kind: "action",
    })))).rejects.toBeInstanceOf(InvokeProtocolValidationError);
  });

  it("keeps malformed JSON in the typed body error channel", async () => {
    await expect(Effect.runPromise(decodePublicInvokeRouteRequest(new Request("https://flarex.test/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);
  });

  it("maps typed invoke route errors at the adapter boundary", () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    expect(publicInvokeRouteErrorToHttpError(jsonError)).toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new InvokeProtocolValidationError({
      schema: "PublicInvokeRequestBody",
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
      cause: null,
    });
    expect(publicInvokeRouteErrorToHttpError(protocolError)).toMatchObject({
      status: 400,
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
    });

    expect(publicInvokeRouteErrorToHttpError(new MissingInvokeDeploymentError())).toMatchObject({
      status: 400,
      message: "Missing deployment id.",
    });

    expect(publicInvokeRouteErrorToHttpError(new MissingInvokePathError())).toMatchObject({
      status: 400,
      message: "Missing function path.",
    });

    expect(publicInvokeRouteErrorToHttpError(new MissingInvokePartitionKeyError())).toMatchObject({
      status: 400,
      message: "Missing partition key.",
    });
  });

  it("maps typed invoke route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    await expect(Effect.runPromise(Effect.flip(
      publicInvokeRouteErrorToHttpErrorEffect(jsonError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const protocolError = new InvokeProtocolValidationError({
      schema: "PublicInvokeRequestBody",
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
      cause: null,
    });
    await expect(Effect.runPromise(Effect.flip(
      publicInvokeRouteErrorToHttpErrorEffect(protocolError),
    ))).resolves.toMatchObject({
      status: 400,
      message:
        "Invoke request body may include string deploymentId, path, partitionKey, idempotencyKey, query or mutation kind, and JSON args.",
    });

    await expect(Effect.runPromise(Effect.flip(
      publicInvokeRouteErrorToHttpErrorEffect(new MissingInvokeDeploymentError()),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Missing deployment id.",
    });

    await expect(Effect.runPromise(Effect.flip(
      publicInvokeRouteErrorToHttpErrorEffect(new MissingInvokePathError()),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Missing function path.",
    });

    await expect(Effect.runPromise(Effect.flip(
      publicInvokeRouteErrorToHttpErrorEffect(new MissingInvokePartitionKeyError()),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Missing partition key.",
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
