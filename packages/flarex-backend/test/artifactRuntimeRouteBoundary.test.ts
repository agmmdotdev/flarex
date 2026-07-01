import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { RequestJsonError } from "../src/http";
import {
  decodeExecutionArtifactInvokePayload,
  decodeExecutionArtifactInvokeRoutePayload,
  ExecutionArtifactInvokePayloadError,
  executionArtifactInvokeRouteErrorToHttpError,
} from "../src/artifactRuntime/RouteBoundary";

describe("artifact runtime route boundary", () => {
  it("decodes execution artifact invoke payloads", async () => {
    const payload = testPayload();

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest(payload))))
      .resolves.toEqual(payload);
    await expect(Effect.runPromise(decodeExecutionArtifactInvokeRoutePayload(payload)))
      .resolves.toEqual(payload);
  });

  it("keeps invalid payload failures typed before HTTP mapping", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayload(jsonRequest({
      deploymentId: "deployment-a",
      ref: { artifactId: "artifact-a" },
    })))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
    await expect(Effect.runPromise(decodeExecutionArtifactInvokeRoutePayload(null)))
      .rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });

  it("maps typed invalid payload failures to HttpError at the adapter edge", () => {
    const httpError = executionArtifactInvokeRouteErrorToHttpError(
      new ExecutionArtifactInvokePayloadError({
        message: "Invalid execution artifact invoke payload.",
      }),
    );
    expect(httpError).toMatchObject({
      status: 400,
      message: "Invalid execution artifact invoke payload.",
    });
  });

  it("keeps malformed JSON typed before HTTP mapping", async () => {
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
