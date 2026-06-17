import { describe, expect, it } from "vitest";
import type { BackendExecutionArtifactStore } from "../src/artifactStore";
import { ServiceBindingExecutionArtifactRuntime } from "../src/artifactRuntime";
import type {
  ActiveDeploymentStatus,
  InvokeRequest,
  PushSourcePackage,
} from "../src/types";

describe("backend execution artifact runtime", () => {
  it("loads the active source package before invoking the runtime service", async () => {
    const sourcePackage = testSourcePackage();
    const calls: Array<{
      url: string;
      artifactId: string | null;
      sourcePackageHash: string | null;
      body: unknown;
    }> = [];
    const store: BackendExecutionArtifactStore = {
      put: async () => activeDeployment.executionArtifactRef,
      get: async ref => {
        expect(ref).toEqual(activeDeployment.executionArtifactRef);
        return sourcePackage;
      },
    };
    const runtime = new ServiceBindingExecutionArtifactRuntime({
      deploymentId: "deployment1",
      store,
      runtime: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          calls.push({
            url: request.url,
            artifactId: request.headers.get("x-flarex-artifact-id"),
            sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
            body: await request.json(),
          });
          return Response.json({ value: { ok: true } });
        },
      } as unknown as Fetcher,
    });
    const invokeRequest: InvokeRequest = {
      path: "users:get",
      args: { id: "1:user" },
      partitionKey: "user:1",
      kind: "query",
    };

    await expect(runtime.invoke(activeDeployment, invokeRequest)).resolves.toEqual({
      value: { ok: true },
    });
    expect(calls).toEqual([
      {
        url: "https://flarex-artifact-runtime.internal/invoke",
        artifactId: activeDeployment.executionArtifactRef.artifactId,
        sourcePackageHash: activeDeployment.executionArtifactRef.sourcePackageHash,
        body: {
          deploymentId: "deployment1",
          ref: activeDeployment.executionArtifactRef,
          sourcePackage,
          request: invokeRequest,
        },
      },
    ]);
  });
});

const activeDeployment: ActiveDeploymentStatus = {
  activePushId: "push1",
  activatedAt: 1,
  schemaVersion: 1,
  executionArtifactRef: {
    runtime: "dynamic-worker",
    artifactId: "artifact_1234567890abcdef1234567890abcdef",
    sourcePackageHash: "a".repeat(64),
    executionModule: "_flarex/execution.js",
  },
  sourcePackage: testSourcePackage(),
  analysis: {
    schema: { version: 1, tables: [], indexes: [] },
    functions: { functions: [{ path: "users:get", kind: "query" }] },
  },
  codegenAnalysis: {
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  },
};

function testSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const get = {};",
      },
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
  };
}
