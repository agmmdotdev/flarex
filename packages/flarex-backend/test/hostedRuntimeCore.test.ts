import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";
import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import {
  type ExecutionArtifactInvokePayload,
} from "../src/artifactRuntime";
import {
  R2BackendExecutionArtifactStore,
  type R2BucketLike,
} from "../src/artifactStore";
import { decodeExecutionArtifactInvokePayloadBody } from "../src/artifactRuntime/Requests";
import { createBackendHarness, type BackendHarness } from "./backendHarness";
import {
  finishPush,
  getActiveDeployment,
  startSourceOnlyPush,
  testLifecycleAnalysis,
  testLifecycleCodegenAnalysis,
  testLifecycleSourcePackage,
} from "./lifecycleFixture";

describe("hosted runtime core", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("pushes source through analyzer, persists R2 artifact, activates, and invokes the runtime binding", async () => {
    const deploymentId = "hosted-runtime-core";
    const sourcePackage = testLifecycleSourcePackage();
    const analyzerRequests: unknown[] = [];
    const runtimeCalls: Array<{
      readonly authorization: string | null;
      readonly artifactId: string | null;
      readonly sourcePackageHash: string | null;
      readonly body: ExecutionArtifactInvokePayload;
    }> = [];

    const harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "runtime-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
        FLAREX_PROJECT_ID: "project-hosted",
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_ANALYZER: async request => {
          analyzerRequests.push(await request.json());
          return Response.json({
            analysis: testLifecycleAnalysis(),
            codegenAnalysis: testLifecycleCodegenAnalysis(),
            diagnostics: [{ level: "log", message: "hosted analysis ok" }],
          });
        },
        FLAREX_ARTIFACT_RUNTIME: async request => {
          const body = await decodeRuntimePayload(await request.json());
          runtimeCalls.push({
            authorization: request.headers.get("authorization"),
            artifactId: request.headers.get("x-flarex-artifact-id"),
            sourcePackageHash: request.headers.get("x-flarex-source-package-hash"),
            body,
          });
          return Response.json({
            value: {
              runtime: "hosted",
              path: requestPathFromRuntimePayload(body),
            },
          });
        },
      },
    });
    harnesses.push(harness);

    const started = await startSourceOnlyPush(harness, deploymentId, {
      sourcePackage,
    });
    expect(started).toMatchObject({
      state: "analyzed",
      diagnostics: [{ level: "log", message: "hosted analysis ok" }],
      codegenAnalysis: testLifecycleCodegenAnalysis(),
    });
    expect(analyzerRequests).toEqual([{ deploymentId, sourcePackage }]);

    const ref = await executionArtifactRefForSourcePackage(sourcePackage);
    const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
    await expect(
      new R2BackendExecutionArtifactStore(r2BucketLike(bucket)).get(ref),
    ).resolves.toEqual(sourcePackage);

    const finish = await finishPush(harness, deploymentId, started.pushId);
    expect(finish.result).toBe("activated");

    const active = await getActiveDeployment(harness, deploymentId);
    expect(active.executionArtifactRef).toEqual(ref);

    const invoke = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/invoke`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "users:get",
          kind: "query",
          partitionKey: "user:1",
          args: { id: "1:user" },
        }),
      },
    );
    expect(invoke.ok).toBe(true);
    await expect(invoke.json()).resolves.toEqual({
      value: { runtime: "hosted", path: "users:get" },
    });

    expect(runtimeCalls).toEqual([
      {
        authorization: "Bearer runtime-secret",
        artifactId: ref.artifactId,
        sourcePackageHash: ref.sourcePackageHash,
        body: {
          deploymentId,
          ref,
          request: {
            path: "users:get",
            kind: "query",
            partitionKey: "user:1",
            args: { id: "1:user" },
          },
        },
      },
    ]);
  });
});

function decodeRuntimePayload(value: unknown): Promise<ExecutionArtifactInvokePayload> {
  return Effect.runPromise(decodeExecutionArtifactInvokePayloadBody(value));
}

function requestPathFromRuntimePayload(value: unknown): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !("request" in value) ||
    typeof value.request !== "object" ||
    value.request === null ||
    !("path" in value.request) ||
    typeof value.request.path !== "string"
  ) {
    return "unknown";
  }
  return value.request.path;
}

function r2BucketLike(value: unknown): R2BucketLike {
  if (!isR2BucketLike(value)) {
    throw new Error("Miniflare ARTIFACTS bucket does not implement the R2 artifact store API.");
  }
  return value;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
}
