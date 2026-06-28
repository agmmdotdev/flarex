import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http";
import {
  parseExecutionArtifactInvokePayload,
  readExecutionArtifactInvokePayload,
} from "../src/artifactRuntime/RouteBoundary";

describe("artifact runtime route boundary", () => {
  it("decodes execution artifact invoke payloads", async () => {
    const payload = testPayload();

    await expect(readExecutionArtifactInvokePayload(jsonRequest(payload)))
      .resolves.toEqual(payload);
    expect(parseExecutionArtifactInvokePayload(payload)).toEqual(payload);
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

  it("preserves malformed JSON as the existing invalid payload error", async () => {
    await expect(readExecutionArtifactInvokePayload(new Request(
      "https://runtime.test/invoke",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      },
    ))).rejects.toMatchObject({
      status: 400,
      message: "Invalid execution artifact invoke payload.",
    });
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
