import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import {
  decodeExecutionArtifactInvokePayloadBodyEffect,
  executionArtifactErrorBodyMessage,
  executionArtifactInvokePayload,
  ExecutionArtifactInvokePayloadError,
  materializedExecutionArtifactInvokePayload,
  type MaterializedExecutionArtifactInvokePayload,
} from "../src/artifact-runtime";

describe("artifact runtime protocol payload decoders", () => {
  it("reads conventional execution artifact error bodies", () => {
    const inherited = Object.create({ error: "inherited failure" }) as object;
    const arrayBody: unknown[] = [];
    Object.assign(arrayBody, { error: "array failure" });

    expect(executionArtifactErrorBodyMessage({ error: "artifact failed" }))
      .toBe("artifact failed");
    expect(executionArtifactErrorBodyMessage({ error: 0 })).toBe("0");
    expect(executionArtifactErrorBodyMessage(inherited)).toBe("inherited failure");
    expect(executionArtifactErrorBodyMessage(arrayBody)).toBe("array failure");
    expect(executionArtifactErrorBodyMessage({ message: "not conventional" }))
      .toBeUndefined();
    expect(executionArtifactErrorBodyMessage([])).toBeUndefined();
    expect(executionArtifactErrorBodyMessage(null)).toBeUndefined();
  });

  it("does not hide unexpected error-body member failures", () => {
    const body = Object.defineProperty({}, "error", {
      get(): never {
        throw new Error("hostile error getter");
      },
    });

    expect(() => executionArtifactErrorBodyMessage(body))
      .toThrow("hostile error getter");
    expect(() => executionArtifactErrorBodyMessage({
      error: Object.create(null),
    })).toThrow(TypeError);
    expect(() => executionArtifactErrorBodyMessage(new Proxy({}, {
      has(): never {
        throw new Error("hostile error membership");
      },
    }))).toThrow("hostile error membership");
  });

  it("decodes execution artifact invoke payloads", async () => {
    const payload = testPayload();

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect(payload)))
      .resolves
      .toEqual(payload);
  });

  it("builds ref-only execution artifact invoke payloads", () => {
    const payload = executionArtifactInvokePayload({
      deploymentId: "deployment-a",
      ref: testPayload().ref,
      request: testPayload().request,
    });

    expect(payload).toEqual({
      deploymentId: "deployment-a",
      identity: { kind: "anonymous" },
      ref: testPayload().ref,
      request: testPayload().request,
    });
    expect(Object.prototype.hasOwnProperty.call(payload, "sourcePackage")).toBe(false);
  });

  it("builds execution artifact invoke payloads with explicit user identity", () => {
    const payload = executionArtifactInvokePayload({
      deploymentId: "deployment-a",
      identity: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user-1",
          subject: "user-1",
          issuer: "https://auth.example.com",
        },
      },
      ref: testPayload().ref,
      request: testPayload().request,
    });

    expect(payload.identity).toEqual({
      kind: "user",
      user: {
        tokenIdentifier: "issuer|user-1",
        subject: "user-1",
        issuer: "https://auth.example.com",
      },
    });
  });

  it("builds materialized execution artifact invoke payloads with source packages", () => {
    const payload = materializedExecutionArtifactInvokePayload({
      deploymentId: "deployment-a",
      ref: testPayload().ref,
      sourcePackage: testPayload().sourcePackage,
      request: testPayload().request,
    });

    expect(payload).toEqual(testPayload());
  });

  it("keeps execution artifact invoke payload failures typed", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      deploymentId: "deployment-a",
      ref: { artifactId: "artifact-a" },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect(null)))
      .rejects.toMatchObject({
        _tag: "ExecutionArtifactInvokePayloadError",
        message: "Invalid execution artifact invoke payload.",
      });
  });

  it("rejects invalid nested execution artifact references", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      ref: {},
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });

  it("rejects invalid nested invoke requests", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      request: {},
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      request: {
        args: {},
      },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      request: {
        path: "users:get",
      },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      request: {
        path: "users:get",
        args: {},
        kind: "subscription",
      },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);

    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      identity: {
        kind: "user",
        user: {
          subject: "user-1",
          issuer: "https://auth.example.com",
        },
      },
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });

  it("rejects invalid present source packages", async () => {
    await expect(Effect.runPromise(decodeExecutionArtifactInvokePayloadBodyEffect({
      ...testPayload(),
      sourcePackage: {},
    }))).rejects.toBeInstanceOf(ExecutionArtifactInvokePayloadError);
  });
});

function testPayload(): MaterializedExecutionArtifactInvokePayload {
  return {
    deploymentId: "deployment-a",
    identity: { kind: "anonymous" },
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
