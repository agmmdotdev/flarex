import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeExecutionArtifactInvokePayload,
  decodeExecutionArtifactInvokeRoutePayload,
  ExecutionArtifactInvokePayloadError,
  executionArtifactInvokeRouteErrorToHttpError,
  parseExecutionArtifactInvokePayload,
  parseExecutionArtifactInvokePayloadEffect,
  readExecutionArtifactInvokePayload,
} from "../src/artifactRuntime/RouteBoundary";

describe("artifact runtime route boundary", () => {
  it("decodes execution artifact invoke payloads", async () => {
    const payload = testPayload();

    await expect(readExecutionArtifactInvokePayload(jsonRequest(payload)))
      .resolves.toEqual(payload);
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest(payload))))
      .resolves.toEqual(payload);
    await expect(Effect.runPromise(decodeExecutionArtifactInvokeRoutePayload(payload)))
      .resolves.toEqual(payload);
    expect(parseExecutionArtifactInvokePayload(payload)).toEqual(payload);
    await expect(Effect.runPromise(parseExecutionArtifactInvokePayloadEffect(payload)))
      .resolves.toEqual(payload);
  });

  it("maps invalid execution artifact invoke payloads to 400", () => {
    expect(() => parseExecutionArtifactInvokePayload(null))
      .toThrow(HttpError);
    try {
      parseExecutionArtifactInvokePayload({
        deploymentId: "deployment-a",
        ref: { artifactId: "artifact-a" },
      });
      throw new Error("Expected parseExecutionArtifactInvokePayload to fail.");
    } catch (error) {
      expect(error).toMatchObject({
        status: 400,
        message: "Invalid execution artifact invoke payload.",
      });
    }
  });

  it("exposes typed invalid payload failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest({
      deploymentId: "deployment-a",
      ref: { artifactId: "artifact-a" },
    })))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
    await expect(Effect.runPromise(decodeExecutionArtifactInvokeRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
    await expect(Effect.runPromise(parseExecutionArtifactInvokePayloadEffect(null)))
      .rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });

  it("maps typed invalid payload failures to HttpError at the adapter edge", async () => {
    try {
      await Effect.runPromise(parseExecutionArtifactInvokePayloadEffect(null));
      throw new Error("Expected parseExecutionArtifactInvokePayloadEffect to fail.");
    } catch (error) {
      const httpError = executionArtifactInvokeRouteErrorToHttpError(
        error as Parameters<typeof executionArtifactInvokeRouteErrorToHttpError>[0],
      );
      expect(httpError).toMatchObject({
        status: 400,
        message: "Invalid execution artifact invoke payload.",
      });
    }
  });

  it("preserves malformed JSON as the shared JSON body error", async () => {
    await expect(readExecutionArtifactInvokePayload(new Request(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(new Request(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    )))).rejects.toBeInstanceOf(RequestJsonError);
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://runtime.test/invoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function testPayload() {
  return {
    deploymentId: "deployment-a",
    ref: {
      runtime: "dynamic-worker",
      artifactId: "artifact_1234567890abcdef1234567890abcdef",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
    },
    sourcePackage: {
      modules: [
        {
          path: "_flarex/execution.js",
          environment: "isolate",
          sha256: "a".repeat(64),
          source: "export default {};",
        },
      ],
      functions: [],
      execution: "_flarex/execution.js",
    },
    request: {
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "user:1",
      kind: "query",
    },
  };
}
