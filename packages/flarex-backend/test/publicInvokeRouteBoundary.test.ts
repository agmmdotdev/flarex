import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { InvokeProtocolValidationError } from "flarex-protocol/invoke";
import { RequestJsonError } from "../src/http";
import {
  decodePublicInvokeRouteRequest,
  decodePublicInvokeRoutePayload,
  invokeRequestFromPublicInvokeBodyEffect,
  MissingInvokePartitionKeyError,
  MissingInvokePathError,
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

});

function jsonRequest(body: unknown): Request {
  return new Request("https://flarex.test/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
