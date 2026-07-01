import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { HttpError, RequestJsonError } from "../src/http";
import {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
  parseExecutionArtifactInvokePayloadBody,
} from "../src/artifactRuntime/Requests";
import {
  decodeExecutionArtifactInvokePayload,
  executionArtifactInvokeRouteErrorToHttpErrorEffect,
  parseExecutionArtifactInvokePayload,
  readExecutionArtifactInvokePayload,
} from "../src/artifactRuntime/RouteBoundary";

describe("artifact runtime request payloads", () => {
  it("decodes execution artifact invoke payloads through the shared source boundary", async () => {
    const payload = testPayload();

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBody(payload)))
      .resolves
      .toEqual(payload);
    expect(parseExecutionArtifactInvokePayloadBody(payload)).toEqual(payload);
  });

  it("keeps invalid invoke payload failures typed before route HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBody({
      deploymentId: "deployment-a",
      ref: { artifactId: "artifact-a" },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    expect(() => parseExecutionArtifactInvokePayloadBody(null))
      .toThrow(ExecutionArtifactInvokePayloadError);
  });

  it("decodes runtime invoke route requests through a typed Effect boundary", async () => {
    const payload = testPayload();

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest(payload))))
      .resolves
      .toEqual(payload);
    await expect(readExecutionArtifactInvokePayload(jsonRequest(payload)))
      .resolves
      .toEqual(payload);
  });

  it("exposes runtime invoke route failures before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(new Request("https://runtime.test/invoke", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    })))).rejects.toBeInstanceOf(RequestJsonError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest({
      deploymentId: "deployment-a",
      ref: { artifactId: "artifact-a" },
    })))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });

  it("maps runtime invoke route errors through a named adapter effect", async () => {
    const jsonError = new RequestJsonError({
      message: "Request body must be JSON.",
      cause: new SyntaxError("Unexpected end of JSON input"),
    });
    await expect(Effect.runPromise(Effect.flip(
      executionArtifactInvokeRouteErrorToHttpErrorEffect(jsonError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Request body must be JSON.",
    });

    const validationError = new ExecutionArtifactInvokePayloadError({
      message: "Invalid execution artifact invoke payload.",
    });
    await expect(Effect.runPromise(Effect.flip(
      executionArtifactInvokeRouteErrorToHttpErrorEffect(validationError),
    ))).resolves.toMatchObject({
      status: 400,
      message: "Invalid execution artifact invoke payload.",
    });

    expect(() => parseExecutionArtifactInvokePayload(null))
      .toThrow(HttpError);
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
