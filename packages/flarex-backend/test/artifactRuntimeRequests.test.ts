import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeExecutionArtifactInvokePayloadBody,
  ExecutionArtifactInvokePayloadError,
  parseExecutionArtifactInvokePayloadBody,
} from "../src/artifactRuntime/Requests";

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
});

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
